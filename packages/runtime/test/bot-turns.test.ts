/**
 * Multi-bot (Task 10): every turn runs as its bot, with the bot's session, notes, grants, sources, mode, role and cache
 * key, and every model call waits its turn in the run queue. With no bots and Ask mode, Hermit behaves as before.
 */
import { readFileSync } from "node:fs";
import { describe, expect, test, vi } from "vitest";
import { createMemory, SKILL_GROUPS, type NewBotRow, type WebHop } from "@hermit/core";
import type { StepEvent } from "@hermit/agent";
import { profileById } from "@hermit/model";
import { cacheKeyFor } from "../src/bot-api.ts";
import { CHARGING, copy, LONG_CUT_SCRIPT, menuIn, NOW, PROFILE, seedNightMail, setup, setupFrom16 } from "./bot-harness.ts";

const none = { sites: [], connectors: [] };
const SITE = "https://registros.example.org/familia";
const READ = (url: string) => JSON.stringify({ choice: "read_web", args: { url } });
const SUMMARY = JSON.stringify({ answer: "El registro nombra a la familia Prueba en 1890.", quotes: ["familia Prueba, 1890"] });
const page = (url: string): WebHop => ({ kind: "page", url, status: 200, contentType: "text/html", body: "<html><head><title>Registro</title></head><body><p>familia Prueba, 1890</p></body></html>", truncated: false });
const PAGES = { [SITE]: page(SITE) };
/** A calendar read the model fills right: tomorrow, whole. */
const CAL_TOMORROW = '{"choice":"calendar_read","args":{"from":"2026-11-12T00:00:00","to":"2026-11-13T00:00:00"}}';
/** The cage's reason when, alone, private data and the web would meet in one run (modes.ts). */
const SPLIT ="Alone, a bot can't read private data and use the web in the same run. It waits as a suggestion.";

test("Hermit resumes its kept chat after the upgrade", async () => {
  const w = await setupFrom16({ sessions: [["s1", 1]], turns: [["s1", "user", "hola"]] });
  expect(await w.hermit.resumeSession()).toBe("s1");
  expect((await w.hermit.transcript("s1")).entries).toEqual([{ kind: "user", text: "hola" }]);
});
test("each bot resumes its own chat", async () => {
  const w = await setup([]);
  const s = await w.hermit.resumeSession("b1");
  expect(s).not.toBe(await w.hermit.resumeSession());
  expect(await w.hermit.resumeSession("b1")).toBe(s);
});
test("a bot's turn carries its role, its notes and the shared profile, and its own cache key", async () => {
  const w = await setup(['{"choice":"respond"}', "Sé poco aún."]);
  await w.hermit.send(await w.hermit.resumeSession("b1"), "¿qué sabes del boleto?");
  const sys = w.requests[0]!.messages[0]!.content;
  expect(sys).toContain("You are Viajes");
  expect(sys).toContain("- boleto a Lisboa para el viernes");
  expect(sys).toContain("- me llamo Ana Prueba");
  expect(sys).not.toContain("arroz");
  expect(w.requests[0]!.cacheKey).toBe(`hermit-v1:b1:${PROFILE.id}`);
});
test("Hermit with bots around: today's prompt, every skill, its own cache key", async () => {
  const w = await setup(['{"choice":"respond"}', "Hola."]);
  await w.hermit.send(await w.hermit.resumeSession(), "hola");
  expect(w.requests[0]!.messages[0]!.content).not.toContain("Your role");
  expect(menuIn(w.requests[0]!)).toEqual(expect.arrayContaining(["calendar_read", "reply_message", "remember"]));
  expect(w.requests[0]!.cacheKey).toBe(`hermit-v1:hermit:${PROFILE.id}`);
});
test("a bot is offered only what it holds", async () => {
  const w = await setup(['{"choice":"respond"}', "Hola."]);
  await w.hermit.send(await w.hermit.resumeSession("b1"), "hola");
  const offered = menuIn(w.requests[0]!);
  expect(offered).toEqual(expect.arrayContaining(["remember", "recall", "read_web"]));
  for (const id of ["calendar_read", "reply_message", "connect_service", "create_bot"]) expect(offered).not.toContain(id);
});
test("a skill outside the grants never runs, whatever the model names", async () => {
  const w = await setup(['{"choice":"calendar_read","args":{}}', '{"choice":"respond"}', "Listo."]);
  await w.hermit.send(await w.hermit.resumeSession("b1"), "lee mi calendario");
  expect(w.calendarReads).toBe(0);
});
test("a skill outside the grants never runs, even with valid arguments and words that route nowhere", async () => {
  const w = await setup([CAL_TOMORROW, "Hola."]);
  await w.hermit.send(await w.hermit.resumeSession("b1"), "hola");
  expect([w.calendarReads, w.left()]).toEqual([0, 0]);
  // The same pick in Hermit's chat reads the calendar: the arguments were good, the grant was missing.
  w.say(CAL_TOMORROW);
  await w.hermit.send(await w.hermit.resumeSession(), "hola");
  expect([w.calendarReads, w.left()]).toEqual([1, 0]);
});
test("a bot that lacks the skill answers in code's words", async () => {
  const w = await setup([]);
  const view = await w.hermit.send(await w.hermit.resumeSession("b1"), "¿qué tengo mañana?");
  expect(view).toMatchObject({ kind: "reply", text: copy("es-419", "HM-BOT-02.withheld", { what: copy("es-419", "HM-BOT-02.what.calendar") }) });
  expect(w.requests).toHaveLength(0);
});
test("a request for a skill the bot lacks is refused even when the reads that ride along are held", async () => {
  const w = await setup([]);
  await w.store.create({ id: "b3", name: "Lector", role: "Lees los mensajes.", grants: ["messages_read"], sources: none, mode: null });
  const s = await w.hermit.resumeSession("b3");
  // "dile a Ana que voy tarde" routes to reply_message and read_messages: the reply is the request, the read only finds the chat.
  const es = await w.hermit.send(s, "dile a Ana Prueba que voy tarde");
  expect(es).toMatchObject({ kind: "reply", text: copy("es-419", "HM-BOT-02.withheld", { what: copy("es-419", "HM-BOT-02.what.messages_reply") }) });
  const en = await w.hermit.send(s, "reply to Ana Prueba that I'll be late");
  expect(en).toMatchObject({ kind: "reply", text: copy("en", "HM-BOT-02.withheld", { what: copy("en", "HM-BOT-02.what.messages_reply") }) });
  expect(w.requests).toHaveLength(0);
});
test("a bot that holds the reply is not refused for the read it lacks", async () => {
  const w = await setup(['{"choice":"respond"}', "Listo."]);
  await w.store.create({ id: "b4", name: "Respondedor", role: "Respondes mensajes.", grants: ["messages_reply"], sources: none, mode: null });
  const view = await w.hermit.send(await w.hermit.resumeSession("b4"), "dile a Ana Prueba que voy tarde");
  expect(JSON.stringify(view)).not.toContain(copy("es-419", "HM-BOT-02.what.messages_read"));
  expect(w.requests.length).toBeGreaterThan(0);
});
test("a question about whether someone replied goes to the read-only bot's read skill, in both languages, with or without the question marks", async () => {
  const says = [
    "did Carlos Demo answer my message?", "any msg from Ana Prueba?", "what did Ana Prueba tell Carlos Demo?", "¿ya contesta Ana Prueba mis mensajes?",
    "do I have an answer from Carlos Demo", "is there a reply to my message from Ana Prueba", "read me the last msg from Ana Prueba", "ya contesta Ana Prueba mis mensajes",
    "¿ya contestó Ana Prueba?", "ya contestó Ana Prueba",
    "has Ana Prueba replied", "do I have a reply from Ana Prueba", "is there a reply to my message from Carlos Demo", "read me the last message from Ana Prueba",
    "¿ya contestó Ana Prueba?", "ya respondió Carlos Demo", "¿tengo respuesta de Ana Prueba?", "¿hay respuesta de Carlos Demo?", "léeme el último mensaje de Ana Prueba",
  ];
  for (const say of says) {
    const w = await setup(['{"choice":"respond"}', "Nada nuevo."]);
    await w.store.create({ id: "b3", name: "Lector", role: "Lees los mensajes.", grants: ["messages_read"], sources: none, mode: null });
    const view = await w.hermit.send(await w.hermit.resumeSession("b3"), say);
    expect.soft(JSON.stringify(view), say).not.toMatch(/permiso|not allowed/);
    expect.soft(w.requests.length, say).toBeGreaterThan(0);
  }
});
test("a polite or conditional command to reply is refused by code for a read-only bot, in both languages", async () => {
  const says = [
    ["can you tell Ana Prueba I'm running late?", "en"], ["cuando puedas, dile a Ana Prueba que voy tarde", "es-419"], ["when you can, reply to Ana Prueba that I'll be late", "en"],
    ["¿puedes decirle a Ana Prueba que voy tarde? dile que llego en 10", "es-419"],
    ["you have to reply to Ana Prueba that I'm running late", "en"], ["Hermit has to reply to Ana Prueba that I'm late", "en"],
    ["Ana Prueba me escribió y quiere saber si voy, dile que sí", "es-419"], ["Ana Prueba me escribió a las 3, dile que sí", "es-419"],
    ["no hay respuesta de Ana Prueba, dile que voy tarde", "es-419"],
    ["you have to text Ana Prueba that I'm running late", "en"], ["I have to answer Ana Prueba, tell her I'm late", "en"],
    ["you'll have to write to Ana Prueba: tell her I'm running late", "en"], ["Carlos Demo me escribió a mí, contéstale que sí", "es-419"],
    ["Ana Prueba contestó a mi mensaje, contéstale que voy tarde", "es-419"],
    ["send a reply to Ana Prueba that I'm late", "en"], ["write a reply to Ana Prueba saying I'm late", "en"],
    ["please send an answer to Ana Prueba: I'm late", "en"], ["post the reply to Ana Prueba now", "en"],
  ] as const;
  for (const [say, lang] of says) {
    const w = await setup([]);
    await w.store.create({ id: "b3", name: "Lector", role: "Lees los mensajes.", grants: ["messages_read"], sources: none, mode: null });
    const view = await w.hermit.send(await w.hermit.resumeSession("b3"), say);
    expect.soft(view, say).toMatchObject({ kind: "reply", text: copy(lang, "HM-BOT-02.withheld", { what: copy(lang, "HM-BOT-02.what.messages_reply") }) });
    expect.soft(w.requests, say).toHaveLength(0);
  }
});
test("every group has its withheld words in both locales", () => {
  for (const g of SKILL_GROUPS) for (const lang of ["es-419", "en"] as const) expect(copy(lang, `HM-BOT-02.what.${g}`), `${lang} ${g}`).toBeTruthy();
});
test("clear conversation clears one bot, and nothing while its turn runs", async () => {
  const w = await setup(['{"choice":"respond"}', "Hola.", '{"choice":"respond"}', "Busco.", '{"choice":"respond"}', "Listo."], { hold: true });
  const h = await w.hermit.resumeSession(); const b1 = await w.hermit.resumeSession("b1");
  const first = w.hermit.send(h, "hola"); w.release(); await first;
  const running = w.hermit.send(b1, "investiga");
  expect(await w.hermit.clearConversation("b1")).toBe(b1);
  w.release(); await running;
  const fresh = await w.hermit.clearConversation("b1");
  expect((await w.sessions.chats("b1")).map((c) => c.id)).toEqual([fresh]);
  expect((await w.hermit.transcript(h)).entries).toHaveLength(2);
});
test("no engine call bypasses the queue, and no cache key is Hermit's by accident", () => {
  const src = readFileSync(new URL("../src/hermit.ts", import.meta.url), "utf8");
  expect(src.match(/ports\.engine/g)).toHaveLength(1);
  expect(src).toMatch(/const engineAt = \(priority: RunPriority\)(: CompletionEngine)? => queuedEngine\(ports\.engine, queue, priority\)/);
  expect(src).not.toMatch(/"hermit-v1"/);
});
test("a chat turn, Seguir and the night run at their priorities, and Seguir keeps the bot's key", async () => {
  const w = await setup(LONG_CUT_SCRIPT);   // a reply cut at its cap, then Seguir's part (the long-answers.test.ts script)
  const s = await w.hermit.resumeSession("b1");
  await w.hermit.send(s, "dame una receta larga"); await w.hermit.continueReply(s);
  // Seguir keeps the bot's key: the long key of b1's own (coordinator's ruling on concern 1), never another bot's.
  expect(w.requests.at(-1)!.cacheKey!.startsWith(cacheKeyFor("b1"))).toBe(true);
  expect(w.requests.at(-1)!.cacheKey).toBe(`${cacheKeyFor("b1")}:long:${PROFILE.id}`);
  await w.hermit.night.run({ conditions: () => CHARGING, noticeTitle: "x", manual: true });   // CHARGING: night.test.ts's device state
  expect(new Set(w.queued)).toEqual(new Set(["user", "reply", "routine"]));
  expect(w.unqueuedCalls()).toBe(0);
});
test("with every mode at Don't ask, the night shift still only reads and proposes", async () => {
  const w = await setup([]);
  // Only modes writes the mode (Task 11): with the typed word and the fingerprint.
  expect(await w.hermit.modes.setGlobal("dont_ask", { typed: "entiendo" })).toBe("set");
  await seedNightMail(w);   // night.test.ts's mail fixture: an unread message from a known sender
  const b = await w.hermit.night.run({ conditions: () => CHARGING, noticeTitle: "x", manual: true });
  expect(w.sent).toEqual([]);
  expect(b?.suggestions.every((x) => x.status === "pending")).toBe(true);
  // Something was proposed (the reply draft to the known sender), and nothing ran for it.
  expect(b?.suggestions.map((x) => x.skill)).toEqual(["mail_draft"]);
  // The screens' own actions pass no bot either: the morning's Review is the normal sheet, and HM-MAIL-04's Send still
  // asks, with the fingerprint.
  expect(await w.hermit.night.act(b!.id, b!.suggestions[0]!.id)).toBe("done");
  expect(await w.hermit.mailSend!({ skill: "mail_send", args: { to: "luis@prueba.example", subject: "Almuerzo", body: "Sí voy." } })).toBe("sent");
  expect(w.sheets.map((r) => r.call.skill)).toEqual(["mail_draft", "mail_send"]);
  expect(w.sheets[1]!.requireBiometric).toBe(true);
});
test("two bots' turns interleaved through the queue keep their own values", async () => {
  const w = await setup(['{"choice":"respond"}', "Uno.", '{"choice":"respond"}', "Dos."]);
  await Promise.all([w.hermit.send(await w.hermit.resumeSession("b1"), "¿qué sabes?"), w.hermit.send(await w.hermit.resumeSession("b2"), "¿qué sabes?")]);
  for (const r of w.requests.filter((x) => x.cacheKey)) {
    const sys = r.messages[0]!.content;
    const [own, other] = r.cacheKey!.includes(":b1:") ? [["Viajes", "Lisboa"], ["Recetas", "arroz"]] : [["Recetas", "arroz"], ["Viajes", "Lisboa"]];
    for (const x of own) expect(sys).toContain(x);
    for (const x of other) expect(sys).not.toContain(x);
  }
  // Both bots' picks went through: each kept its own key.
  expect(w.requests.filter((x) => x.cacheKey).map((x) => x.cacheKey).sort()).toEqual([`hermit-v1:b1:${PROFILE.id}`, `hermit-v1:b2:${PROFILE.id}`]);
});

// Review Focus 5, call by call: b2's turn starts while b1's first call waits, so b1's reply prompt is built after b2's
// turn has read its own notes. Shared per-turn state would put b2's values into it.
test("two bots' turns alternating call by call: every prompt, picks and replies, holds only its own bot's values", async () => {
  const w = await setup(['{"choice":"respond"}', '{"choice":"respond"}', "Uno.", "Dos."], { hold: true });
  const one = w.hermit.send(await w.hermit.resumeSession("b1"), "¿qué sabes de mi familia?");
  await vi.waitFor(() => expect(w.requests).toHaveLength(1));
  const two = w.hermit.send(await w.hermit.resumeSession("b2"), "¿qué cocino hoy?");
  await vi.waitFor(() => expect(w.queued).toHaveLength(2));
  w.release();
  expect([await one, await two]).toEqual([{ kind: "reply", text: "Uno." }, { kind: "reply", text: "Dos." }]);
  const whose = (r: (typeof w.requests)[number]) => (JSON.stringify(r.messages).includes("familia") ? "b1" : "b2");
  // b1's pick, b2's pick, then their replies: the turns took turns.
  expect(w.requests.map(whose)).toEqual(["b1", "b2", "b1", "b2"]);
  for (const r of w.requests) {
    const sys = r.messages[0]!.content;
    const [own, other] = whose(r) === "b1" ? [["Viajes", "Lisboa"], ["Recetas", "arroz"]] : [["Recetas", "arroz"], ["Viajes", "Lisboa"]];
    for (const x of own) expect(sys).toContain(x);
    for (const x of other) expect(sys).not.toContain(x);
  }
});

// The coordinator's ruling on concern 1: a long answer and its Seguir keep a long key of the bot's own, so the key the
// bot's normal turns read under keeps their prompt (on the S26 a prompt read costs 8 to 20 s), and no two bots share one.
test("a long answer and its Seguir keep a long key of the bot's own; the bot's next normal turn reads under its turn key", async () => {
  const w = await setup(['{"choice":"respond"}', "Hola.", ...LONG_CUT_SCRIPT, '{"choice":"respond"}', "De nada.", LONG_CUT_SCRIPT[0]!]);
  const b1 = await w.hermit.resumeSession("b1");
  await w.hermit.send(b1, "hola");
  const turnKey = `${cacheKeyFor("b1")}:${PROFILE.id}`;
  expect(w.requests[0]!.cacheKey).toBe(turnKey);
  let from = w.requests.length;
  await w.hermit.send(b1, "dame una receta larga");
  await w.hermit.continueReply(b1);
  const longKey = `${cacheKeyFor("b1")}:long:${PROFILE.id}`;
  expect(w.requests.slice(from).map((r) => r.cacheKey)).toEqual([longKey, longKey]);
  from = w.requests.length;
  await w.hermit.send(b1, "gracias");
  expect(w.requests[from]!.cacheKey).toBe(turnKey);
  // Another bot's long answer has a long key of its own.
  from = w.requests.length;
  await w.hermit.send(await w.hermit.resumeSession("b2"), "dame una receta larga");
  expect(w.requests[from]!.cacheKey).toBe(`${cacheKeyFor("b2")}:long:${PROFILE.id}`);
  expect(w.left()).toBe(0);
});

// Multi-bot: "the signed log records bot ids", through the composition root. Every step of a chat turn names the bot it ran
// as (Hermit's chat names Hermit), so the log still says which bot acted after its chats are cleared; the night shift and
// the screens' own acts name none; old and new entries make one chain that verifies, and Activity shows the bot.
test("the signed log names the bot of every step of a chat turn; the night shift and the screens' own acts name none", async () => {
  const w = await setup([READ(SITE), SUMMARY, '{"choice":"remember","args":{"fact":"me gusta el café"}}'], { pages: PAGES });
  const b1 = await w.hermit.resumeSession("b1");
  await w.hermit.send(b1, `lee ${SITE}`);
  const h = await w.hermit.resumeSession();
  await w.hermit.send(h, "recuerda que me gusta el café");
  await seedNightMail(w);
  await w.hermit.night.run({ conditions: () => CHARGING, noticeTitle: "x", manual: true });
  expect(await w.hermit.mailSend!({ skill: "mail_send", args: { to: "luis@prueba.example", subject: "Hola", body: "Sí voy." } })).toBe("sent");
  const entries = await w.sql.query<{ session_id: string; event: string; bot_id: string | null }>("SELECT session_id, event, bot_id FROM audit ORDER BY seq");
  const of = (session: string) => entries.filter((e) => e.session_id === session).map((e) => e.bot_id);
  expect(new Set(entries.filter((e) => e.session_id === b1).map((e) => e.event))).toEqual(new Set(["call_proposed", "policy_decided", "approval", "executed", "taint_added"]));
  expect(of(b1)).toEqual(of(b1).map(() => "b1"));
  expect(of(h).length).toBeGreaterThan(0);
  expect(of(h)).toEqual(of(h).map(() => "hermit"));
  const others = entries.filter((e) => e.session_id !== b1 && e.session_id !== h);
  expect(others.length).toBeGreaterThan(0);
  expect(others.filter((e) => e.bot_id !== null)).toEqual([]);
  // Clearing the bot's chat leaves the log saying which bot acted.
  await w.hermit.clearConversation("b1");
  expect((await w.sql.query<{ n: number }>("SELECT COUNT(*) AS n FROM audit WHERE bot_id = 'b1'"))[0]!.n).toBe(of(b1).length);
  const { rows, chain } = await w.hermit.activity();
  expect(chain.kind).toBe("verified");
  expect(rows.find((r) => r.skill === "read_web")).toMatchObject({ bot: "b1" });
  expect(rows.find((r) => r.skill === "remember")).toMatchObject({ bot: "hermit" });
  expect(rows.filter((r) => r.skill.startsWith("night.") || r.skill === "mail_send").filter((r) => "bot" in r)).toEqual([]);
  expect((await w.hermit.activityEntry(rows.find((r) => r.skill === "read_web")!.seq))!.map((d) => d.bot)).toEqual(of(b1));
  expect(w.left()).toBe(0);
});

describe("priority holds per turn (Task 8 ruling)", () => {
  test("the chat's turn holds 'user' and Seguir holds 'reply', each until it ends", async () => {
    const w = await setup(LONG_CUT_SCRIPT);
    const s = await w.hermit.resumeSession("b1");
    await w.hermit.send(s, "dame una receta larga");
    await w.hermit.continueReply(s);
    expect(w.held).toEqual(["user", "reply"]);
  });

  test("while the user's turn runs, the night's call waits for the whole turn, not just the call that runs", async () => {
    const w = await setup(['{"choice":"respond"}', "Hola."], { hold: true });
    const turn = w.hermit.send(await w.hermit.resumeSession(), "hola");
    await vi.waitFor(() => expect(w.requests).toHaveLength(1));
    const night = w.hermit.night.run({ conditions: () => CHARGING, noticeTitle: "x", manual: true });
    // The night's reader is in line while the turn's first call runs.
    await vi.waitFor(() => expect(w.queued).toEqual(["user", "routine"]));
    w.release();
    await turn;
    await night;
    // The turn's second call went before it, though it asked for its slot after the reader did.
    const source = (r: (typeof w.requests)[number]) => (JSON.stringify(r.messages).includes("registro civil") ? "night" : "turn");
    expect(w.requests.map(source)).toEqual(["turn", "turn", "night"]);
    expect(w.queued).toEqual(["user", "routine", "user"]);
  });
});

describe("Hermit stays itself (Task 9 ruling)", () => {
  test("Hermit has no role block: its prompts with bots around are the same as without them", async () => {
    const withBots = await setup(['{"choice":"respond"}', "Hola."]);
    const alone = await setupFrom16({ sessions: [], turns: [] });
    await createMemory(alone.sql).remember("me llamo Ana Prueba", { tainted: false, kinds: [], now: NOW - 1000 });
    alone.say('{"choice":"respond"}', "Hola.");
    for (const w of [withBots, alone]) await w.hermit.send(await w.hermit.resumeSession(), "hola");
    expect(withBots.requests).toHaveLength(2);
    expect(withBots.requests.map((r) => r.messages)).toEqual(alone.requests.map((r) => r.messages));
  });
});

describe("facts for the cage (Tasks 6 and 7 rulings)", () => {
  test("every turn runs as its bot: the bot's mode decides its steps", async () => {
    const w = await setup([READ(SITE), SUMMARY], { pages: PAGES });
    // Ask: a page on a site not approved yet asks.
    await w.hermit.send(await w.hermit.resumeSession("b1"), `lee ${SITE}`);
    expect(w.sheets.map((r) => r.call.skill)).toEqual(["read_web"]);
    // Auto: a low step whose address is in the user's own words runs without a sheet, and says the mode ran it.
    await w.store.update("b1", { mode: "auto" });
    const events: StepEvent[] = [];
    w.say(READ(SITE), SUMMARY);
    await w.hermit.send(await w.hermit.newChat("b1"), `lee ${SITE}`, { onEvent: (e) => events.push(e) });
    expect(w.sheets).toHaveLength(1);
    expect(events).toContainEqual({ kind: "approved", skill: "read_web", byMode: "auto" });
    expect(w.fetched).toEqual([SITE, SITE]);
    expect(w.left()).toBe(0);
  });

  test("a name is looked up only for a bot that holds the contacts, and only for a skill it holds", async () => {
    const DIAL = '{"choice":"dial","args":{"person":"mi mamá"}}';
    const w = await setup([], { people: true });
    await w.store.create({ id: "b3", name: "Llamadas", role: "Llamas a la familia.", grants: ["apps"], sources: none, mode: null });
    await w.store.create({ id: "b4", name: "Agenda", role: "Ordenas tus contactos.", grants: ["apps", "contacts"], sources: none, mode: null });
    await w.store.create({ id: "b5", name: "Contactos", role: "Buscas personas.", grants: ["contacts"], sources: none, mode: null });
    // Holds the dialer, not the contacts: nobody is looked up, and the dialer opens for the user to choose.
    w.say(DIAL);
    await w.hermit.send(await w.hermit.resumeSession("b3"), "llama a mi mamá");
    expect([w.contactReads, w.left()]).toEqual([0, 0]);
    // Holds the contacts, not the dialer: the model names it anyway; it isn't on the menu, so nobody is looked up.
    w.say(DIAL, "Hola.");
    await w.hermit.send(await w.hermit.resumeSession("b5"), "hola");
    expect([w.contactReads, w.left()]).toEqual([0, 0]);
    // Holds both: the name is looked up, as it is for Hermit.
    w.say(DIAL);
    await w.hermit.send(await w.hermit.resumeSession("b4"), "llama a mi mamá");
    expect([w.contactReads, w.left()]).toEqual([1, 0]);
    w.say(DIAL);
    await w.hermit.send(await w.hermit.resumeSession(), "llama a mi mamá");
    expect([w.contactReads, w.left()]).toEqual([2, 0]);
    expect(w.opened).toHaveLength(3);
  });

  test("a session's turns share one live session: what an alone run read stays read on its next turn", async () => {
    const w = await setup([CAL_TOMORROW], { pages: PAGES });
    await w.store.create({ id: "b3", name: "Investigadora", role: "Investigas registros.", grants: ["calendar", "web_read"], sources: { sites: ["registros.example.org"], connectors: [] }, mode: null });
    const alone = await w.hermit.startSession({ attended: false, botId: "b3" });
    await w.hermit.send(alone, "revisa mi calendario");
    expect([w.calendarReads, w.left()]).toEqual([1, 0]);
    // The same session's next turn: it read private data, so alone it can't use the web, not even its own site.
    const events: StepEvent[] = [];
    w.say(READ(SITE), '{"choice":"respond"}', "No pude.");
    await w.hermit.send(alone, `lee ${SITE}`, { onEvent: (e) => events.push(e) });
    expect(events).toContainEqual({ kind: "blocked", skill: "read_web", reason: SPLIT });
    expect([w.fetched, w.left()]).toEqual([[], 0]);
    // A fresh alone run that read nothing private reads its own site.
    w.say(READ(SITE), SUMMARY);
    await w.hermit.send(await w.hermit.startSession({ attended: false, botId: "b3" }), `lee ${SITE}`);
    expect([w.fetched, w.left()]).toEqual([[SITE], 0]);
  });
});

// Security review 00:40: a note keeps what its session had read, so the alone split holds across runs.
describe("notes carry what they were read from", () => {
  const investigator = (id: string): NewBotRow & { id: string } => ({
    id, name: "Investigadora", role: "Investigas registros.", grants: ["calendar", "notes", "web_read"], sources: { sites: ["registros.example.org"], connectors: [] }, mode: null,
  });

  test("a prompt built for a bot whose notes hold private data has it in the session's reads before the turn's first step", async () => {
    const w = await setup([READ(SITE), '{"choice":"respond"}', "No."], { pages: PAGES });
    await w.store.create(investigator("b3"));
    await createMemory(w.sql).forBot("b3").remember("dentista el viernes a las 10", { tainted: false, kinds: ["private"] });
    const events: StepEvent[] = [];
    await w.hermit.send(await w.hermit.startSession({ attended: false, botId: "b3" }), `lee ${SITE}`, { onEvent: (e) => events.push(e) });
    // The note is in the prompt, and the turn's very first step, a page on the bot's own site, is refused by the split.
    expect(w.requests[0]!.messages[0]!.content).toContain("dentista el viernes a las 10");
    expect(events.find((e) => e.kind === "blocked" || e.kind === "executed")).toEqual({ kind: "blocked", skill: "read_web", reason: SPLIT });
    expect([w.fetched, w.left()]).toEqual([[], 0]);
  });

  test("private data a bot read alone and noted, recalled in its next alone run, can't leave on the web", async () => {
    const w = await setup([CAL_TOMORROW, '{"choice":"remember","args":{"fact":"dentista el viernes a las 10"}}'], { pages: PAGES });
    await w.store.create(investigator("b3"));
    await w.hermit.send(await w.hermit.startSession({ attended: false, botId: "b3" }), "revisa mi calendario y recuerda que tengo dentista el viernes a las 10");
    expect(w.left()).toBe(0);
    // Saved after a read that taints, so never in a prompt; it keeps the private read all the same.
    expect((await createMemory(w.sql).forBot("b3").recall("dentista"))[0]).toMatchObject({ tainted: true, kinds: ["private"] });
    const events: StepEvent[] = [];
    w.say('{"choice":"recall","args":{"query":"dentista"}}', READ(SITE), '{"choice":"respond"}', "No.");
    await w.hermit.send(await w.hermit.startSession({ attended: false, botId: "b3" }), "sigue con la investigación", { onEvent: (e) => events.push(e) });
    expect(events).toContainEqual({ kind: "executed", skill: "recall", ok: true });
    expect(events).toContainEqual({ kind: "blocked", skill: "read_web", reason: SPLIT });
    expect([w.fetched, w.left()]).toEqual([[], 0]);
  });
});

describe("sessions per bot", () => {
  test("a new chat starts fresh for that bot; its older chats stay", async () => {
    const w = await setup(['{"choice":"respond"}', "Hola."]);
    const first = await w.hermit.resumeSession("b1");
    await w.hermit.send(first, "hola");
    const fresh = await w.hermit.newChat("b1");
    expect(fresh).not.toBe(first);
    expect(await w.hermit.resumeSession("b1")).toBe(fresh);
    expect((await w.sessions.chats("b1")).map((c) => c.id)).toEqual([fresh, first]);
  });

  test("a chat for a bot that doesn't exist is refused", async () => {
    const w = await setup([]);
    await expect(w.hermit.newChat("b9")).rejects.toThrow(/no bot/i);
    await expect(w.hermit.resumeSession("b9")).rejects.toThrow(/no bot/i);
  });

  test("warming reads the bot's own prompt under its own key, at the user's priority", async () => {
    const stable = profileById("botpsy-q4-native-think256-stable")!;
    const w = await setup([], { profile: stable });
    await w.hermit.resumeSession("b1");
    await vi.waitFor(() => expect(w.requests).toHaveLength(1));
    expect(w.requests[0]).toMatchObject({ prefill: true, cacheKey: `hermit-v1:b1:${stable.id}` });
    expect(w.requests[0]!.messages[0]!.content).toContain("You are Viajes");
    expect(w.queued).toEqual(["user"]);
    expect(w.unqueuedCalls()).toBe(0);
  });
});
