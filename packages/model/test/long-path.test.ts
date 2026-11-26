import { describe, expect, test } from "vitest";
import { skillId, type Msg, type SkillDef } from "@hermit/core";
import { firstWinSkills } from "@hermit/skills";
import type { CompletionEngine, EngineRequest, EngineResult } from "../src/engine.ts";
import { createModelPort } from "../src/port.ts";
import { profileById } from "../src/profile.ts";

// Q155: when the user's own words ask for a long answer and nothing on the menu is routed for them, the answer is
// words only: a prompt that allows structure, no tools offered, and the long cap the phone allows right now.

function engine(replies: Array<Partial<EngineResult> & { tokens?: string[] }>) {
  const requests: EngineRequest[] = [];
  let i = 0;
  const e: CompletionEngine = {
    async complete(req) {
      requests.push(req);
      const r = replies[i++] ?? {};
      for (const t of r.tokens ?? []) req.onToken?.(t);
      return { text: r.text ?? "", toolCalls: r.toolCalls ?? [], ...(r.stop ? { stop: r.stop } : {}) };
    },
  };
  return { e, requests };
}

const ctx = () => ({ language: "es-419" as const, now: "2026-11-11T18:20:00-06:00 (Wednesday)", profile: ["Es vegetariana"] });
const native = profileById("botpsy-q4-native-think256")!;
const twoStage = profileById("botpsy-q4-two-stage-nothink")!;
const menu = firstWinSkills.map((s) => s.id);
const asked = (content: string): Msg[] => [{ role: "user", content }];
const RECIPE = "Arroz con leche\n\nIngredientes:\n- 1 taza de arroz\n- 1 litro de leche\n\nPasos:\n1. Lava el arroz.\n2. Hiérvelo con la leche.";

describe("a long answer when asked", () => {
  test("a recipe is words only: the long prompt, no tools, the long cap, streamed", async () => {
    const { e, requests } = engine([{ text: RECIPE, tokens: RECIPE.match(/[\s\S]{1,8}/g)!, stop: "end" }]);
    const shown: string[] = [];
    const words: string[] = [];
    const r = await createModelPort(e, native, firstWinSkills, ctx).pick({ prefixCacheKey: "k", messages: asked("dame una receta de arroz con leche"), menu, live: { onToken: (t) => shown.push(t), onWords: () => words.push("words") } });
    expect(r).toEqual({ choice: "respond", text: RECIPE, streamed: true });
    expect(requests).toHaveLength(1);
    const req = requests[0]!;
    expect(req.tools).toBeUndefined();
    expect(req.jsonSchema).toBeUndefined();
    expect(req.longForm).toBe(true);
    expect(req.maxTokens).toBe(800);
    expect(req.thinking).toEqual(native.longThinking?.mode === "on" ? { enabled: true, budgetTokens: native.longThinking.budgetTokens } : { enabled: false });
    const system = req.messages[0]!.content;
    expect(system).not.toContain("Menu:");
    expect(system).toMatch(/ingredients/i);
    expect(system).toMatch(/numbered/i);
    expect(system).toContain("Spanish (Latin America)");
    // The user's saved facts still reach it (a vegetarian gets a vegetarian recipe).
    expect(system).toContain("Es vegetariana");
    // Q172 (built with the recommended option): medicines, health, money and safety stay general, with a professional.
    expect(system).toMatch(/medicines, health, money or safety/);
    expect(shown.join("")).toBe(RECIPE);
    expect(words).toEqual(["words"]);
  });

  test("the two-stage format takes the same path: no choice to make, words only", async () => {
    const { e, requests } = engine([{ text: RECIPE, stop: "end" }]);
    const r = await createModelPort(e, twoStage, firstWinSkills, ctx).pick({ prefixCacheKey: "k", messages: asked("¿cómo se prepara el arroz con leche?"), menu });
    expect(r).toEqual({ choice: "respond", text: RECIPE });
    expect(requests[0]!.jsonSchema).toBeUndefined();
    expect(requests[0]!.longForm).toBe(true);
  });

  test("a long answer that runs out of tokens is cut, like any other", async () => {
    const { e } = engine([{ text: `${RECIPE}\n3. Agrega el azúcar y la can`, stop: "length" }]);
    expect(await createModelPort(e, native, firstWinSkills, ctx).pick({ prefixCacheKey: "k", messages: asked("give me a recipe for rice pudding"), menu })).toMatchObject({ choice: "respond", text: RECIPE, cut: true });
  });

  test("words that only look like it go to the normal pick, tools and all", async () => {
    for (const said of ["renueva mi receta en la farmacia", "¿qué hay en mi lista de compras?", "¿cuál es el río más largo del mundo?"]) {
      const { e, requests } = engine([{ text: "Claro.", stop: "end" }]);
      await createModelPort(e, native, firstWinSkills, ctx).pick({ prefixCacheKey: "k", messages: asked(said), menu });
      expect(requests[0]!.longForm, said).toBeUndefined();
      expect(requests[0]!.tools, said).toBeDefined();
    }
  });

  test("a skill the router found for the words keeps them: a reminder about a recipe is a reminder", async () => {
    const { e, requests } = engine([{ toolCalls: [{ name: "remind", arguments: { text: "Hacer la receta", at: "2026-11-12T18:00" } }] }]);
    const r = await createModelPort(e, native, firstWinSkills, ctx).pick({ prefixCacheKey: "k", messages: asked("recuérdame mañana a las 6 hacer la receta de la tía"), menu });
    expect(r.choice).toBe("remind");
    expect(requests[0]!.longForm).toBeUndefined();
  });

  test("a tool routed for this turn (an installed MCP or connector tool) keeps the turn: the model may use it", async () => {
    const extra: SkillDef = { id: skillId("mcp_m1_recipes"), version: 1, menuLine: "recipes (MCP tool): Find recipes.", args: { type: "object", properties: { q: { type: "string" } } }, risk: "network", producesUntrusted: true, describeAction: () => ({ title: "t", lines: [], binding: "b" }) };
    const { e, requests } = engine([{ toolCalls: [{ name: "mcp_m1_recipes", arguments: { q: "arroz con leche" } }] }]);
    const r = await createModelPort(e, native, firstWinSkills, ctx, { extraSkills: () => [extra] }).pick({ prefixCacheKey: "k", messages: asked("dame una receta de arroz con leche"), menu: [...menu, extra.id] });
    expect(r.choice).toBe("mcp_m1_recipes");
    expect(requests[0]!.longForm).toBeUndefined();
  });

  test("the cap is bounded by the context the prompt and history leave", async () => {
    const long: Msg[] = [];
    // Long even after the history is trimmed to the latest turns.
    for (let i = 0; i < 12; i++) long.push({ role: "user", content: "x".repeat(6000) }, { role: "assistant", content: "y".repeat(2000) });
    const { e, requests } = engine([{ text: RECIPE, stop: "end" }]);
    await createModelPort(e, native, firstWinSkills, ctx).pick({ prefixCacheKey: "k", messages: [...long, { role: "user", content: "dame una receta de arroz con leche" }], menu });
    expect(requests[0]!.maxTokens).toBeLessThan(800);
    expect(requests[0]!.maxTokens).toBeGreaterThanOrEqual(native.maxReplyTokens);
  });

  test("Seguir on a long answer goes on with the long prompt and cap", async () => {
    const { e, requests } = engine([{ text: "3. Agrega el azúcar.", stop: "end" }]);
    const history: Msg[] = [{ role: "user", content: "dame una receta de arroz con leche" }, { role: "assistant", content: RECIPE }];
    expect(await createModelPort(e, native, firstWinSkills, ctx).continueReply!({ prefixCacheKey: "k", messages: history }, () => {})).toEqual({ text: "\n3. Agrega el azúcar." });
    expect(requests[0]!.longForm).toBe(true);
    expect(requests[0]!.maxTokens).toBe(800);
    expect(requests[0]!.messages[0]!.content).toMatch(/numbered/i);
  });

  // The S26 on 2026-11-24: a call's first token took 8 to 20 s, all of it reading a prompt of about 4,400 tokens.
  // A long answer reads far less: no menu or tool block, and only the latest turns of the history.
  test("a long answer reads only the latest turns: at most six messages of history, starting at the user's", async () => {
    const long: Msg[] = [];
    for (let i = 0; i < 10; i++) long.push({ role: "user", content: `pregunta ${i}` }, { role: "assistant", content: `respuesta ${i}` });
    const { e, requests } = engine([{ text: RECIPE, stop: "end" }]);
    await createModelPort(e, native, firstWinSkills, ctx).pick({ prefixCacheKey: "k", messages: [...long, { role: "user", content: "dame una receta de arroz con leche" }], menu });
    const sent = requests[0]!.messages;
    expect(sent[0]!.role).toBe("system");
    // The system prompt, six messages of history and the request.
    expect(sent.length).toBeLessThanOrEqual(8);
    expect(sent[1]!.role).toBe("user");
    expect(sent.at(-1)).toEqual({ role: "user", content: "dame una receta de arroz con leche" });
    expect(sent.map((m) => m.content)).toContain("respuesta 9");
  });

  test("its prompt holds still through the hour under the turn's long key, so Seguir reuses what the phone already read", async () => {
    let minute = 20;
    const clock = () => ({ ...ctx(), now: `Wednesday, November 11, 2026, 18:${minute} local time (today is 2026-11-11; tomorrow is Thursday 2026-11-12)` });
    const { e, requests } = engine([{ text: RECIPE, stop: "length" }, { text: "3. Sirve frío.", stop: "end" }]);
    const port = createModelPort(e, native, firstWinSkills, clock);
    const ask = asked("dame una receta de arroz con leche");
    await port.pick({ prefixCacheKey: "k", messages: ask, menu });
    minute = 47;
    await port.continueReply!({ prefixCacheKey: "k", messages: [...ask, { role: "assistant", content: RECIPE }] }, () => {});
    expect(requests[0]!.messages[0]!.content).toBe(requests[1]!.messages[0]!.content);
    expect(requests[0]!.messages[0]!.content).toContain("between 18:00 and 19:00 local time");
    expect(requests[0]!.cacheKey).toBe(`k:long:${native.id}`);
    expect(requests[1]!.cacheKey).toBe(requests[0]!.cacheKey);
  });

  // Multi-bot (spec 6.6): one prompt-cache key per bot. A long answer and its Seguir carry a long key derived from the
  // turn's, so two bots never share one, and the turn's own key keeps the bot's normal prompt.
  test("a long answer, its Seguir and a long reply after a result carry the turn's long key, one per bot", async () => {
    const { e, requests } = engine([{ text: RECIPE, stop: "length" }, { text: "3. Sirve frío.", stop: "end" }, { text: RECIPE, stop: "end" }]);
    const ask = asked("dame una receta de arroz con leche");
    const b1 = createModelPort(e, native, firstWinSkills, ctx);
    await b1.pick({ prefixCacheKey: "hermit-v1:b1", messages: ask, menu });
    await b1.continueReply!({ prefixCacheKey: "hermit-v1:b1", messages: [...ask, { role: "assistant", content: RECIPE }] }, () => {});
    const after: Msg[] = [{ role: "user", content: "explícame en detalle cómo se hace el arroz con leche" }, { role: "assistant", content: '{"skill":"recall","args":{"query":"arroz"}}' }, { role: "tool", content: "Nothing saved about that." }];
    await createModelPort(e, twoStage, firstWinSkills, ctx).respond({ prefixCacheKey: "hermit-v1:b2", messages: after }, () => {});
    expect(requests.map((r) => [r.longForm, r.cacheKey])).toEqual([
      [true, `hermit-v1:b1:long:${native.id}`],
      [true, `hermit-v1:b1:long:${native.id}`],
      [true, `hermit-v1:b2:long:${twoStage.id}`],
    ]);
  });

  // On the S26 a prompt read costs 8 to 20 s: a long answer must never take the key the bot's normal turns read under.
  test("a normal turn after a long answer and its Seguir reads under the turn's key, untouched", async () => {
    const { e, requests } = engine([{ text: "Hola.", stop: "end" }, { text: RECIPE, stop: "length" }, { text: "3. Sirve frío.", stop: "end" }, { text: "De nada.", stop: "end" }]);
    const port = createModelPort(e, native, firstWinSkills, ctx);
    await port.pick({ prefixCacheKey: "hermit-v1:b1", messages: asked("hola"), menu });
    const ask = asked("dame una receta de arroz con leche");
    await port.pick({ prefixCacheKey: "hermit-v1:b1", messages: ask, menu });
    await port.continueReply!({ prefixCacheKey: "hermit-v1:b1", messages: [...ask, { role: "assistant", content: RECIPE }] }, () => {});
    await port.pick({ prefixCacheKey: "hermit-v1:b1", messages: [...ask, { role: "assistant", content: RECIPE }, { role: "user", content: "gracias" }], menu });
    expect(requests.map((r) => r.cacheKey)).toEqual([`hermit-v1:b1:${native.id}`, `hermit-v1:b1:long:${native.id}`, `hermit-v1:b1:long:${native.id}`, `hermit-v1:b1:${native.id}`]);
  });

  test("the reply prompt after a result answers long when the user's words asked for it", async () => {
    const msgs: Msg[] = [{ role: "user", content: "explícame en detalle qué es la inflación" }, { role: "assistant", content: '{"skill":"recall","args":{"query":"inflación"}}' }, { role: "tool", content: "Nothing saved about that." }];
    const { e, requests } = engine([{ text: "La inflación es el alza sostenida de los precios.", stop: "end" }]);
    await createModelPort(e, twoStage, firstWinSkills, ctx).respond({ prefixCacheKey: "k", messages: msgs }, () => {});
    expect(requests[0]!.longForm).toBe(true);
    expect(requests[0]!.maxTokens).toBe(800);
  });
});
