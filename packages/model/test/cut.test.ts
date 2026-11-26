import { describe, expect, test } from "vitest";
import type { Msg } from "@hermit/core";
import { firstWinSkills } from "@hermit/skills";
import type { CompletionEngine, EngineRequest, EngineResult } from "../src/engine.ts";
import { createModelPort } from "../src/port.ts";
import { profileById } from "../src/profile.ts";
import { ContinuationFilter, continuationPart, endAtBoundary } from "../src/reply-cut.ts";

// Q155: a reply that used up its tokens is never shown as finished. Every words path of the port says it was cut, and
// Seguir writes the next part with words only: no tools, no schema, nothing the cage decides.

function engine(replies: Array<Partial<EngineResult> & { tokens?: string[] }>) {
  const requests: EngineRequest[] = [];
  let i = 0;
  const e: CompletionEngine = {
    async complete(req) {
      requests.push(req);
      if (req.signal?.aborted) throw new Error("Stopped by the user.");
      const r = replies[i++] ?? {};
      for (const t of r.tokens ?? []) req.onToken?.(t);
      return { text: r.text ?? "", toolCalls: r.toolCalls ?? [], ...(r.stop ? { stop: r.stop } : {}) };
    },
  };
  return { e, requests };
}

const ctx = () => ({ language: "es-419" as const, now: "2026-11-11T18:20:00-06:00 (Wednesday)", profile: [] });
const native = profileById("botpsy-q4-native-think256")!;
const twoStage = profileById("botpsy-q4-two-stage-nothink")!;
const menu = firstWinSkills.map((s) => s.id);
const asked = (content: string): Msg[] => [{ role: "user", content }];

const LONG = "Mañana tienes tres cosas. El dentista a las 9:30 y la reunión con Pedro a las 15:00. Además vence el pago de la lu";

describe("a cut reply says so (never silent)", () => {
  test("a plain answer from the pick that ran out of tokens is respond with cut, trimmed back to its last whole sentence", async () => {
    const { e } = engine([{ text: LONG, stop: "length" }]);
    const r = await createModelPort(e, native, firstWinSkills, ctx).pick({ prefixCacheKey: "k", messages: asked("háblame del océano pacífico"), menu });
    expect(r).toEqual({ choice: "respond", text: "Mañana tienes tres cosas. El dentista a las 9:30 y la reunión con Pedro a las 15:00.", cut: true });
  });

  test("an answer that ended on its own is not cut", async () => {
    const { e } = engine([{ text: "Hola, aquí estoy.", stop: "end" }]);
    expect(await createModelPort(e, native, firstWinSkills, ctx).pick({ prefixCacheKey: "k", messages: asked("hola, ¿cómo estás?"), menu })).toEqual({ choice: "respond", text: "Hola, aquí estoy." });
  });

  test("a cut answer that happens to hold a question is still the answer, not a question back", async () => {
    const text = "¿Sabías que el arroz con leche es un postre muy antiguo? Se prepara con arroz, leche, azúcar y canela. Primero se lava el arroz y luego se coc";
    const { e } = engine([{ text, stop: "length" }]);
    const r = await createModelPort(e, native, firstWinSkills, ctx).pick({ prefixCacheKey: "k", messages: asked("háblame del arroz con leche"), menu });
    expect(r.choice).toBe("respond");
    expect(r.cut).toBe(true);
  });

  test("the out-of-scope answer (no tools offered) says it was cut too", async () => {
    const { e, requests } = engine([{ text: "No puedo hacer compras desde aquí. Lo que sí puedo hacer es recordarte que compres el boleto, anotar los datos del vuelo o", stop: "length" }]);
    const r = await createModelPort(e, native, firstWinSkills, ctx).pick({ prefixCacheKey: "k", messages: asked("cómprame un boleto a Lima"), menu });
    expect(requests[0]!.tools).toBeUndefined();
    // Its one whole sentence is too little of it to fall back to: it ends at its last whole word, and the cut is said.
    expect(r).toEqual({ choice: "respond", text: "No puedo hacer compras desde aquí. Lo que sí puedo hacer es recordarte que compres el boleto, anotar los datos del vuelo", cut: true });
  });

  test("the reply prompt says when it was cut; a finished reply carries no flag", async () => {
    const msgs: Msg[] = [{ role: "user", content: "¿qué tengo mañana?" }, { role: "assistant", content: '{"skill":"calendar_read","args":{}}' }, { role: "tool", content: "Dentista 9:30, Pedro 15:00" }];
    const cut = engine([{ text: LONG, stop: "length" }]);
    expect(await createModelPort(cut.e, twoStage, firstWinSkills, ctx).respond({ prefixCacheKey: "k", messages: msgs }, () => {})).toEqual({ text: "Mañana tienes tres cosas. El dentista a las 9:30 y la reunión con Pedro a las 15:00.", cut: true });
    const whole = engine([{ text: "Dentista a las 9:30 y Pedro a las 15:00.", stop: "end" }]);
    expect(await createModelPort(whole.e, twoStage, firstWinSkills, ctx).respond({ prefixCacheKey: "k", messages: msgs }, () => {})).toEqual({ text: "Dentista a las 9:30 y Pedro a las 15:00." });
  });

  test("tokens spent thinking with nothing written is not a cut reply: it is retried, then the fixed fallback", async () => {
    const { e, requests } = engine([{ text: "", stop: "length" }, { text: "", stop: "length" }]);
    const r = await createModelPort(e, twoStage, firstWinSkills, ctx).respond({ prefixCacheKey: "k", messages: asked("hola") }, () => {});
    expect(requests).toHaveLength(2);
    expect(r).toEqual({ text: "¿Me lo dices de otra forma?" });
  });
});

describe("Seguir: the next part of a cut reply, words only", () => {
  const partial = "Ingredientes:\n- 1 taza de arroz\n- 1 litro de leche";
  const history: Msg[] = [{ role: "user", content: "dame la receta del arroz con leche" }, { role: "assistant", content: partial }];

  test("the conversation goes with the reply so far and a request to go on; no tools, no schema, no thinking", async () => {
    const { e, requests } = engine([{ text: "- 1 taza de azúcar\n\nPasos:\n1. Lava el arroz.", tokens: ["- 1 taza de azúcar\n\nPasos:\n1. Lava el arroz."], stop: "end" }]);
    const shown: string[] = [];
    const port = createModelPort(e, native, firstWinSkills, ctx);
    const next = await port.continueReply!({ prefixCacheKey: "k", messages: history }, (t) => shown.push(t));
    expect(next).toEqual({ text: "\n- 1 taza de azúcar\n\nPasos:\n1. Lava el arroz." });
    const req = requests[0]!;
    expect(req.tools).toBeUndefined();
    expect(req.jsonSchema).toBeUndefined();
    expect(req.toolChoice).toBeUndefined();
    expect(req.thinking).toEqual({ enabled: false });
    // The reply so far is the last assistant turn; then the user's side asks to go on, in the user's language.
    expect(req.messages.at(-2)).toEqual({ role: "assistant", content: partial });
    expect(req.messages.at(-1)!.role).toBe("user");
    expect(req.messages.at(-1)!.content).toMatch(/sigue/i);
    expect(req.messages[0]!.content).toMatch(/Spanish/);
    // What streams is exactly what gets appended.
    expect(shown.join("")).toBe(next.text);
  });

  test("a continuation that ran out of tokens too is still cut, so Seguir can be tapped again", async () => {
    const { e } = engine([{ text: "- 1 taza de azúcar\n- canela en rama\n\nPasos:\n1. Lava el arroz y ponlo a her", stop: "length" }]);
    expect(await createModelPort(e, native, firstWinSkills, ctx).continueReply!({ prefixCacheKey: "k", messages: history }, () => {})).toEqual({ text: "\n- 1 taza de azúcar\n- canela en rama", cut: true });
  });

  test("only a reply can be continued, and a stopped turn starts nothing", async () => {
    const { e, requests } = engine([{ text: "x" }]);
    const port = createModelPort(e, native, firstWinSkills, ctx);
    await expect(port.continueReply!({ prefixCacheKey: "k", messages: [{ role: "user", content: "hola" }] }, () => {})).rejects.toThrow();
    await expect(port.continueReply!({ prefixCacheKey: "k", messages: [...history, { role: "assistant", content: '{"skill":"remind","args":{}}' }] }, () => {})).rejects.toThrow();
    const stop = new AbortController();
    stop.abort();
    await expect(port.continueReply!({ prefixCacheKey: "k", messages: history, signal: stop.signal }, () => {})).rejects.toThrow();
    expect(requests).toHaveLength(0);
  });

  // Review 2026-11-25: an empty part is the runtime's cue to say "nothing more to add" and end Seguir
  // (long-answers.test.ts); it is never flagged cut, so Seguir is not offered again for nothing.
  test("visible reasoning is never appended; nothing new, however it ended, is an empty part and never cut", async () => {
    const reasoning = engine([{ text: "The user wants me to continue the recipe. I should list the steps.", stop: "end" }, { text: "", stop: "end" }]);
    expect(await createModelPort(reasoning.e, native, firstWinSkills, ctx).continueReply!({ prefixCacheKey: "k", messages: history }, () => {})).toEqual({ text: "" });
    // Only lines the reply already says, until the tokens ran out: still nothing new.
    const loop = engine([{ text: "- 1 taza de arroz\n- 1 litro de leche\n- 1 taza de arroz\n- 1 litro de leche\n- 1 taza", stop: "length" }]);
    expect(await createModelPort(loop.e, native, firstWinSkills, ctx).continueReply!({ prefixCacheKey: "k", messages: history }, () => {})).toEqual({ text: "" });
  });

  // Review 2026-11-25: the long answer read only the last 7 messages, which after a turn with several tool calls held no
  // words of the user's: the model went on without the request in view.
  test("after a turn with several tool calls, the user's request still leads what Seguir reads", async () => {
    const call = (skill: string) => ({ role: "assistant" as const, content: `{"skill":"${skill}","args":{}}` });
    const long: Msg[] = [
      { role: "user", content: "dame una receta de arroz con leche para 8 personas" },
      call("recall"), { role: "tool", content: "Nada guardado." },
      call("recall"), { role: "tool", content: "Nada guardado." },
      call("recall"), { role: "tool", content: "Nada guardado." },
      call("recall"), { role: "tool", content: "Nada guardado." },
      { role: "assistant", content: partial },
    ];
    const { e, requests } = engine([{ text: "- 1 taza de azúcar", stop: "end" }]);
    await createModelPort(e, native, firstWinSkills, ctx).continueReply!({ prefixCacheKey: "k", messages: long }, () => {});
    const sent = requests[0]!.messages;
    // The long prompt, then the request in the user's own words, then the latest exchange, then the ask to go on.
    expect(sent[1]).toEqual({ role: "user", content: "dame una receta de arroz con leche para 8 personas" });
    expect(sent.at(-2)).toEqual({ role: "assistant", content: partial });
    expect(sent.filter((m) => m.content.includes("dame una receta"))).toHaveLength(1);
  });
});

describe("joining a continuation", () => {
  test("a cut reply ends at its last whole line or sentence, when that keeps most of it", () => {
    expect(endAtBoundary("Primero. Segundo paso largo. Tercero a medi")).toBe("Primero. Segundo paso largo.");
    expect(endAtBoundary("Ingredientes:\n- 1 taza de arroz\n- 1 litro de le")).toBe("Ingredientes:\n- 1 taza de arroz");
    // A list marker left alone at the end goes too.
    expect(endAtBoundary("Pasos:\n1. Lava el arroz.\n2. Hierve la leche.\n3.")).toBe("Pasos:\n1. Lava el arroz.\n2. Hierve la leche.");
    // Nothing to fall back to without losing most of it: it ends at its last whole word (review 2026-11-25: half a word
    // joined the next part as "lí nea"). A word the stream already ended with a space is whole; a lone piece stays.
    expect(endAtBoundary("Una sola frase muy larga que nunca termina y sigue sin punto ni salto de lí")).toBe("Una sola frase muy larga que nunca termina y sigue sin punto ni salto de");
    expect(endAtBoundary("Una sola frase muy larga que nunca termina y sigue sin punto ni salto ")).toBe("Una sola frase muy larga que nunca termina y sigue sin punto ni salto");
    expect(endAtBoundary("Muchísimas")).toBe("Muchísimas");
    expect(endAtBoundary("Ya termina bien.")).toBe("Ya termina bien.");
    // A heading left with nothing under it goes too: the next part starts with it.
    expect(endAtBoundary("Ingredientes:\n- 1 taza de arroz\n- 1 litro de leche\n\nPasos:\n1. Lava el arr")).toBe("Ingredientes:\n- 1 taza de arroz\n- 1 litro de leche");
  });

  test("what the reply already says is dropped: a repeated last line, a restart from the top, a preface", () => {
    const partial = "Ingredientes:\n- 1 taza de arroz\n- 1 litro de leche";
    expect(continuationPart(partial, "- 1 litro de leche\n- 1 taza de azúcar")).toBe("\n- 1 taza de azúcar");
    expect(continuationPart(partial, "Ingredientes:\n- 1 taza de arroz\n- 1 litro de leche\n- canela")).toBe("\n- canela");
    expect(continuationPart(partial, "Claro, sigo:\n- canela")).toBe("\n- canela");
    expect(continuationPart(partial, "Here is the rest:\n\n- canela")).toBe("\n- canela");
    // The end of the last sentence said again at the start.
    expect(continuationPart("Hierve la leche con la canela", "con la canela y agrega el arroz.")).toBe(" y agrega el arroz.");
    // A new sentence after a whole one, a new block after a list.
    expect(continuationPart("Lava el arroz.", "Luego hierve la leche.")).toBe(" Luego hierve la leche.");
    expect(continuationPart(partial, "Pasos:\n1. Lava el arroz.")).toBe("\n\nPasos:\n1. Lava el arroz.");
    expect(continuationPart(partial, "")).toBe("");
    expect(continuationPart(partial, "- 1 litro de leche")).toBe("");
  });

  // Measured on the Mac lab (2026-11-24): after Seguir, 3 of 5 joined answers said lines twice.
  test("a restart behind a preface the list doesn't know, or with new numbers, is dropped wherever it starts", () => {
    const list = "Ideas:\n1. Un juego de maracas.\n2. Un taller de pintura.\n3. Una búsqueda del tesoro.";
    expect(continuationPart(list, "Aquí está el contenido que se espera:\n\n1. Un juego de maracas.\n2. Un taller de pintura.\n3. Una búsqueda del tesoro.\n4. Un show de títeres.")).toBe("\n4. Un show de títeres.");
    expect(continuationPart(list, "Siguen los pasos siguientes:\n1. Un juego de maracas.\n5. Un concurso de baile.")).toBe("\n4. Un concurso de baile.");
    // The same item under another number, anywhere: the model looping.
    const steps = "Pasos:\n1. Apaga el motor.\n2. Afloja las tuercas.";
    expect(continuationPart(steps, "3. Levanta el auto con la gata.\n4. Afloja las tuercas.\n5. Saca la llanta.")).toBe("\n3. Levanta el auto con la gata.\n4. Saca la llanta.");
    // A line this part already said once is not said again.
    expect(continuationPart(steps, "3. Saca la llanta.\n4. Saca la llanta.\n5. Pon la de repuesto.")).toBe("\n3. Saca la llanta.\n4. Pon la de repuesto.");
    // A heading left with nothing new under it goes too.
    expect(continuationPart(steps, "Pasos:\n1. Apaga el motor.\n2. Afloja las tuercas.")).toBe("");
    // A new list after a heading keeps its own numbers.
    expect(continuationPart(steps, "Consejos:\n1. Revisa la presión.")).toBe("\n\nConsejos:\n1. Revisa la presión.");
  });

  test("streamed in pieces, what reaches the screen is what the whole would give, and nothing repeated ever shows", () => {
    const list = "Ideas:\n1. Un juego de maracas.\n2. Un taller de pintura.";
    const next = "Aquí está el contenido que se espera:\n1. Un juego de maracas.\n2. Un taller de pintura.\n3. Una búsqueda del tesoro con pistas escondidas en el jardín.\n4. Un show de títeres.";
    for (const size of [1, 3, 7, 40]) {
      const f = new ContinuationFilter(list);
      let shown = "";
      for (const piece of next.match(new RegExp(`[\\s\\S]{1,${size}}`, "g"))!) shown += f.push(piece);
      shown += f.end();
      expect(shown, `pieces of ${size}`).toBe(continuationPart(list, next));
    }
    // A clearly new line shows before it is finished: the screen keeps up with the words.
    const f = new ContinuationFilter(list);
    expect(f.push("3. Una búsqueda del tesoro con pist")).toBe("\n3. Una búsqueda del tesoro con pist");
    expect(f.push("as escondidas.")).toBe("as escondidas.");
  });

  // Review 2026-11-25, finding 1: a reply that ends at a whole word mid-sentence (a Stop, or the cap with no whole
  // sentence to fall back to) joins the next part with one space, and a word the model says again is said once.
  test("a reply that ends mid-sentence at a whole word joins the next words without doubling one", () => {
    const said = "Pon la leche en una olla con la canela y la cáscara de limón y espera a que hierva, luego agrega la";
    expect(continuationPart(said, "mantequilla y el azúcar.")).toBe(" mantequilla y el azúcar.");
    expect(continuationPart(said, "la mantequilla y el azúcar.")).toBe(" mantequilla y el azúcar.");
    expect(continuationPart(said, "agrega la mantequilla y el azúcar.")).toBe(" mantequilla y el azúcar.");
    // Only whole words: "la" said again is one, "lata" is a new word; and a word or two only as written: "Arroz" starts
    // a sentence of its own after "…el arroz".
    expect(continuationPart(said, "lata de leche condensada.")).toBe(" lata de leche condensada.");
    expect(continuationPart("Lava el arroz", "Arroz lavado, ahora hierve la leche.")).toBe(" Arroz lavado, ahora hierve la leche.");
    // A list item that stopped mid-line goes on on the same line; a new item still starts its own.
    const items = "Ingredientes:\n- 1 taza de arroz\n- Una búsqueda del tesoro con pistas escondidas por todo el jardín y premios para cada equipo que";
    expect(continuationPart(items, "llegue primero.\n- canela")).toBe(" llegue primero.\n- canela");
    expect(continuationPart("Ingredientes:\n- 1 taza de arroz\n- 1 litro de leche", "- canela")).toBe("\n- canela");
  });

  // Review 2026-11-25, finding 3: a line said before is a repeat in the list it belongs to, or anywhere while a restart
  // may be going on; under a new heading a short one is real ("- sal" in a second list).
  test("a second list keeps its own items, even ones the first list had", () => {
    const partial = "Ingredientes:\n- 500 g de pollo\n- sal\n- pimienta";
    // After something new.
    expect(continuationPart(partial, "- 1 cebolla\n\nPara la salsa:\n- 1 taza de crema\n- sal\n- ajo")).toBe("\n- 1 cebolla\n\nPara la salsa:\n- 1 taza de crema\n- sal\n- ajo");
    // As the very first lines.
    expect(continuationPart(partial, "Para la salsa:\n- sal\n- 1 taza de crema")).toBe("\n\nPara la salsa:\n- sal\n- 1 taza de crema");
    expect(continuationPart(partial, "Para la salsa:\n- sal\n- pimienta\n- 1 taza de crema")).toBe("\n\nPara la salsa:\n- sal\n- pimienta\n- 1 taza de crema");
    // Still in the same list, it is the model looping: dropped.
    expect(continuationPart(partial, "- 1 cebolla\n- sal\n- ajo")).toBe("\n- 1 cebolla\n- ajo");
    // A long line said again is a loop wherever it comes.
    const steps = "Pasos:\n1. Precalienta el horno a 180 grados y engrasa el molde.";
    expect(continuationPart(steps, "2. Mezcla la harina.\n\nPara el relleno:\n- Pica la fruta.\n- Precalienta el horno a 180 grados y engrasa el molde.\n- Rellena el molde.")).toBe("\n2. Mezcla la harina.\n\nPara el relleno:\n- Pica la fruta.\n- Rellena el molde.");
    // A heading said again over new lines is a part of its own (a second recipe's "Ingredientes:").
    expect(continuationPart(partial, "## Relleno\nIngredientes:\n- 200 g de queso")).toBe("\n\n## Relleno\nIngredientes:\n- 200 g de queso");
  });

  test("a restart behind a title the reply doesn't know is still dropped, title and all, from a list's opening lines or under a heading said again", () => {
    const partial = "Ingredientes:\n- 1 taza de arroz\n- 1 litro de leche\n- canela";
    expect(continuationPart(partial, "Ingredientes para 4:\n- 1 taza de arroz\n- 1 litro de leche\n- canela\n- 1 taza de azúcar")).toBe("\n- 1 taza de azúcar");
    expect(continuationPart(partial, "Receta completa:\n\nIngredientes:\n- 1 taza de arroz\n- canela\n- 1 taza de azúcar")).toBe("\n- 1 taza de azúcar");
    // Streamed in pieces, the same.
    const next = "Para la salsa:\n- sal\n- 1 taza de crema de leche bien fría\n- ajo";
    for (const size of [1, 4, 9]) {
      const f = new ContinuationFilter("Ingredientes:\n- 500 g de pollo\n- sal");
      let shown = "";
      for (const piece of next.match(new RegExp(`[\\s\\S]{1,${size}}`, "g"))!) shown += f.push(piece);
      shown += f.end();
      expect(shown, `pieces of ${size}`).toBe(continuationPart("Ingredientes:\n- 500 g de pollo\n- sal", next));
    }
  });

  test("a heading with words of its own is never taken for a preface", () => {
    const partial = "Para la base:\n- 200 g de galletas\n- 100 g de mantequilla";
    expect(continuationPart(partial, "Ingredientes para el resto de la masa:\n- 2 huevos")).toBe("\n\nIngredientes para el resto de la masa:\n- 2 huevos");
    expect(continuationPart(partial, "Here are the remaining steps:\n- 2 huevos")).toBe("\n- 2 huevos");
  });
});
