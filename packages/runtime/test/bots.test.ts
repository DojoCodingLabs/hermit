/**
 * Multi-bot (Task 11): the bots and modes the app's screens call. The roster, create, update, pin, hide, duplicate,
 * reset, delete and notes; the global mode and each bot's own, with Don't ask behind the typed word and the fingerprint;
 * every change in the signed log by id and code only. Synthetic names only.
 */
import { describe, expect, test, vi } from "vitest";
import { nodeSql } from "@hermit/sql-node";
import {
  conversationId, createBotsStore, createMemory, createSessions, MAX_BOTS, migrate,
  type Bot, type BotSources, type SkillGroup,
} from "@hermit/core";
import { createAuditLog, ed25519Signer } from "@hermit/cage";
import type { BotChange, BotPatch, BotProposalView, HermitBotsApi, NewBot } from "../src/bot-api.ts";
import { createBotsApi, type BotProposals } from "../src/bots.ts";
import { copy, NOW, setup } from "./bot-harness.ts";

const none: BotSources = { sites: [], connectors: [] };
const META: NewBot = { name: "Noticias", role: "Resumes las noticias de tus temas.", grants: ["web_read"], sources: { sites: ["facebook.com"], connectors: [] }, mode: null };
const INBOX: NewBot = { name: "Correo", role: "Ordenas el correo.", grants: ["mail_read"], sources: { sites: [], connectors: [] }, mode: null };

/** The bot a change made; a refusal fails the test with its reason. */
function made(change: BotChange): Bot {
  if (change.kind !== "done") throw new Error(`Refused: ${change.reason}.`);
  return change.bot;
}

test("the roster: Hermit first, pins next, then the newest activity; hidden apart", async () => {
  const w = await setup(['{"choice":"respond"}', "Hola."]); const h = w.hermit;
  const meta = made(await h.bots.create(META));
  await h.bots.pin(meta.id, true);
  await h.send(await h.resumeSession("b1"), "hola");
  await h.bots.hide("b2", true);
  const r = await h.bots.roster();
  expect(r.rows.map((x) => x.bot.name)).toEqual(["Hermit", "Noticias", "Viajes"]);
  expect(r.hidden.map((x) => x.bot.name)).toEqual(["Recetas"]);
  expect(r.rows.find((x) => x.bot.id === meta.id)!.lastAt).toBe(meta.createdAt);
});
test("search finds bots by name and chats by title, ignoring case and accents", async () => {
  const w = await setup(['{"choice":"respond"}', "Busco."]); const h = w.hermit;
  await h.send(await h.resumeSession("b1"), "Busca a José en Lisboa");
  expect((await h.bots.roster({ query: "VIAJ" })).rows.map((x) => x.bot.id)).toEqual(["b1"]);
  expect((await h.bots.roster({ query: "jose" })).rows.map((x) => x.bot.id)).toEqual(["b1"]);
});
test("granting mail send, logins or pay needs the fingerprint", async () => {
  const w = await setup([]); const h = w.hermit;
  w.fingerprint = false;
  expect(await h.bots.create({ ...INBOX, grants: ["mail_read", "mail_send"] })).toEqual({ kind: "refused", reason: "fingerprint_declined" });
  w.fingerprint = true;
  expect((await h.bots.create({ ...INBOX, grants: ["mail_read", "mail_send"] })).kind).toBe("done");
  expect((await h.bots.create(INBOX)).kind).toBe("done");
  expect(w.confirmCalls).toBe(2);
});
// Fix round 1 (the coordinator's ruling) changed the last steps: going back to the global mode needs nothing, since the
// global took the word and the fingerprint when it was set; a bot's own Don't ask still takes both, also under it.
test("Don't ask needs the typed word and the fingerprint, for the global mode and for a bot's own, also under the global one", async () => {
  const w = await setup([]); const h = w.hermit;
  expect(await h.modes.setBot("b1", "dont_ask", { typed: "ok" })).toBe("word_mismatch");
  w.fingerprint = false;
  expect(await h.modes.setBot("b1", "dont_ask", { typed: "entiendo" })).toBe("fingerprint_declined");
  w.fingerprint = true;
  expect(await h.modes.setBot("b1", "dont_ask", { typed: "entiendo" })).toBe("set");
  expect(await h.modes.setGlobal("auto")).toBe("set");
  expect([await h.modes.of("b1"), await h.modes.of("b2")]).toEqual(["dont_ask", "auto"]);
  expect(await h.modes.setGlobal("dont_ask", { typed: "entiendo" })).toBe("set");
  expect(await h.modes.setBot("b2", "ask")).toBe("set");
  expect(await h.modes.setBot("b2", null)).toBe("set");
  expect(await h.modes.setBot("b2", "dont_ask")).toBe("word_mismatch");
  expect(await h.modes.setBot("b2", "dont_ask", { typed: "I understand" })).toBe("set");
});
test("Hermit's name, role and grants don't change in wave 1", async () => {
  const w = await setup([]); const h = w.hermit;
  for (const patch of [{ name: "X" }, { role: "Y" }, { grants: ["notes"] as SkillGroup[] }]) expect(await h.bots.update("hermit", patch)).toEqual({ kind: "refused", reason: "primary" });
});
// The coordinator's ruling on concern 1 changed "and mode": a copy never takes the original's own mode (see below).
test("duplicate copies the role, grants and sources, never the chats, notes or its own mode", async () => {
  const w = await setup([]); const h = w.hermit;
  const c = made(await h.bots.duplicate("b1"));
  expect(c).toMatchObject({ name: "Viajes 2", role: "Planeas los viajes de la familia Prueba con sitios de transporte.", grants: ["notes", "web_read"] });
  expect((await h.bots.notes(c.id)).notes.filter((n) => !n.shared)).toEqual([]);
  expect(await h.bots.chats(c.id)).toEqual([]);
  expect(await h.bots.duplicate("hermit")).toEqual({ kind: "refused", reason: "primary" });
});
test("reset keeps the notes and settings", async () => {
  const w = await setup([]); const h = w.hermit;
  const r = await h.bots.reset("b1");
  expect(r.kind).toBe("done");
  expect((await h.bots.chats("b1")).map((c) => c.id)).toEqual([r.kind === "done" ? r.sessionId : ""]);
  expect((await h.bots.notes("b1")).notes.map((n) => n.fact)).toContain("boleto a Lisboa para el viernes");
});
test("delete erases the bot's chats and notes, and never Hermit", async () => {
  const w = await setup([]); const h = w.hermit;
  expect((await h.bots.remove("b1")).kind).toBe("done");
  expect(await h.bots.get("b1")).toBeUndefined();
  expect(await w.sql.query("SELECT COUNT(*) AS n FROM notes WHERE bot_id = 'b1'")).toEqual([{ n: 0 }]);
  expect(await h.bots.remove("hermit")).toEqual({ kind: "refused", reason: "primary" });
});
test("remove and reset refuse while the bot's turn runs", async () => {
  const w = await setup(['{"choice":"respond"}', "Listo."], { hold: true }); const h = w.hermit;
  const running = h.send(await h.resumeSession("b1"), "investiga");
  expect(await h.bots.remove("b1")).toEqual({ kind: "refused", reason: "busy" });
  expect(await h.bots.reset("b1")).toEqual({ kind: "refused", reason: "busy" });
  w.release(); await running;
  expect((await h.bots.remove("b1")).kind).toBe("done");
});
test("every bot change is in the signed log by id, never by name, role or note; Activity reads the name when it shows the row", async () => {
  const w = await setup([]); const h = w.hermit;
  const meta = made(await h.bots.create(META));
  const log = JSON.stringify(await w.auditEntries());
  expect(log).toContain('"reason":"bot.created"');
  for (const x of ["Noticias", "temas", "Lisboa"]) expect(log).not.toContain(x);
  // Task 18 (ruling 3): the row carries the bot it changed, and HM-ACT-01 shows the name the bot has now.
  expect((await h.activity()).rows.find((r) => r.skill === "bot")).toMatchObject({ reason: "bot.created", bot: meta.id, botName: "Noticias" });
});

// The controller's rulings for this task, one test (or more) each.
describe("the permission mode is written only by modes, with their checks (ruling 1)", () => {
  test("a direct settings write of the mode is refused, and so is Don't ask without the word", async () => {
    const w = await setup([]); const h = w.hermit;
    await expect(h.settings.set("bots.mode", "dont_ask")).rejects.toThrow(/modes\.setGlobal/);
    await expect(h.settings.set("bots.mode", "ask")).rejects.toThrow(/modes\.setGlobal/);
    expect(await h.modes.global()).toBe("ask");
    expect(await h.modes.setGlobal("dont_ask")).toBe("word_mismatch");
    expect(await h.modes.setGlobal("dont_ask", { typed: "ok" })).toBe("word_mismatch");
    expect([await h.modes.global(), await h.modes.of("b1"), w.confirmCalls]).toEqual(["ask", "ask", 0]);
    // Every other setting still writes.
    await h.settings.set("appearance.quiet", "1");
    expect(await h.settings.get("appearance.quiet")).toBe("1");
  });

  test("a bot's own mode isn't one of its settings: update refuses a patch that carries one", async () => {
    const w = await setup([]); const h = w.hermit;
    await expect(h.bots.update("b1", { mode: "dont_ask" } as BotPatch)).rejects.toThrow(/modes\.setBot/);
    expect([await h.modes.of("b1"), (await h.bots.get("b1"))!.mode, w.confirmCalls]).toEqual(["ask", null, 0]);
  });

  test("the global mode set through modes is the one every bot without its own runs in", async () => {
    const w = await setup([]); const h = w.hermit;
    w.fingerprint = false;
    expect(await h.modes.setGlobal("dont_ask", { typed: "entiendo" })).toBe("fingerprint_declined");
    expect(await h.modes.global()).toBe("ask");
    w.fingerprint = true;
    expect(await h.modes.setGlobal("dont_ask", { typed: "Entiendo." })).toBe("set");
    expect([await h.modes.global(), await h.modes.of("b2"), (await h.bots.roster()).rows.map((r) => r.mode)]).toEqual(["dont_ask", "dont_ask", ["dont_ask", "dont_ask", "dont_ask"]]);
    // Going down asks nothing.
    expect(await h.modes.setGlobal("ask")).toBe("set");
    expect(w.confirmCalls).toBe(2);
  });
});

describe("Activity says a mode ran a step, and which bot (ruling 2)", () => {
  const REPLY = JSON.stringify({ choice: "reply_message", args: { conversationId: conversationId("whatsapp", "ana"), text: "Sí voy" } });

  test("a step Don't ask let run is ran with the mode and the bot's name, never approved; the id outlives the bot", async () => {
    // The reply answers in code's words once sent (W1), so the pick is the whole script.
    const w = await setup([REPLY]); const h = w.hermit;
    const bot = made(await h.bots.create({ name: "Respuestas", role: "Respondes mensajes.", grants: ["messages_read", "messages_reply"], sources: none, mode: "dont_ask" }, { typed: "entiendo" }));
    await h.send(await h.resumeSession(bot.id), "dile a Ana que sí voy");
    expect([w.sent, w.sheets, w.left()]).toEqual([["Sí voy"], [], 0]);
    const row = (await h.activity()).rows.find((r) => r.skill === "reply_message");
    expect(row).toMatchObject({ mark: "ran", reason: "mode.dont_ask", bot: bot.id, botName: "Respuestas" });
    // The log keeps the bot's id after the bot is gone; its name went with it.
    expect((await h.bots.remove(bot.id)).kind).toBe("done");
    const after = (await h.activity()).rows.find((r) => r.skill === "reply_message");
    expect(after).toMatchObject({ mark: "ran", reason: "mode.dont_ask", bot: bot.id });
    expect(after).not.toHaveProperty("botName");
    expect(JSON.stringify(await w.auditEntries())).not.toContain("Respuestas");
  });

  test("in Ask the same step is the user's approval, as today", async () => {
    const w = await setup([REPLY]); const h = w.hermit;
    const bot = made(await h.bots.create({ name: "Respuestas", role: "Respondes mensajes.", grants: ["messages_read", "messages_reply"], sources: none, mode: null }));
    await h.send(await h.resumeSession(bot.id), "dile a Ana que sí voy");
    expect([w.sent, w.sheets.map((s) => s.call.skill), w.left()]).toEqual([["Sí voy"], ["reply_message"], 0]);
    const row = (await h.activity()).rows.find((r) => r.skill === "reply_message");
    expect(row).toMatchObject({ mark: "approved", bot: bot.id, botName: "Respuestas" });
    expect(row).not.toHaveProperty("reason");
  });
});

describe("the fingerprint on create and update (ruling 4)", () => {
  test("changing a bot's permissions asks only when it newly holds mail send, logins or pay; a copy asks as creating does", async () => {
    const w = await setup([]); const h = w.hermit;
    w.fingerprint = false;
    expect(await h.bots.update("b2", { grants: ["notes", "mail_send"] })).toEqual({ kind: "refused", reason: "fingerprint_declined" });
    expect((await h.bots.get("b2"))!.grants).toEqual(["notes"]);
    w.fingerprint = true;
    expect(made(await h.bots.update("b2", { grants: ["notes", "mail_send"] })).grants).toEqual(["notes", "mail_send"]);
    // Already held, or a group that needs nothing: no fingerprint.
    expect(made(await h.bots.update("b2", { name: "Cocina", grants: ["calendar", "notes", "mail_send"] }))).toMatchObject({ name: "Cocina", grants: ["calendar", "notes", "mail_send"] });
    expect(w.confirmCalls).toBe(2);
    w.fingerprint = false;
    expect(await h.bots.duplicate("b2")).toEqual({ kind: "refused", reason: "fingerprint_declined" });
    expect(w.confirmCalls).toBe(3);
  });

  test("the fingerprint is asked once per change, with code's words for what it confirms", async () => {
    const w = await setup([]); const h = w.hermit;
    made(await h.bots.create({ ...INBOX, grants: ["mail_send"], mode: "dont_ask" }, { typed: "entiendo" }));
    made(await h.bots.update("b1", { grants: ["notes", "web_read", "wallet_pay"] }));
    expect(w.prompts).toEqual([copy("es-419", "HM-BOT-04.fingerprintPrompt.dontAsk"), copy("es-419", "HM-BOT-04.fingerprintPrompt.grant")]);
  });

  test("a bot made with its own Don't ask needs the word, then the fingerprint; one that inherits the global needs neither", async () => {
    const w = await setup([]); const h = w.hermit;
    expect(await h.bots.create({ ...META, mode: "dont_ask" })).toEqual({ kind: "refused", reason: "word_mismatch" });
    expect(w.confirmCalls).toBe(0);
    expect(made(await h.bots.create({ ...META, mode: "dont_ask" }, { typed: "i understand!" })).mode).toBe("dont_ask");
    expect(await h.modes.setGlobal("dont_ask", { typed: "entiendo" })).toBe("set");
    expect(w.confirmCalls).toBe(2);
    // The global Don't ask took the word and the fingerprint when it was set: a new bot that inherits it asks nothing more.
    const inherits = made(await h.bots.create(META));
    expect([inherits.mode, await h.modes.of(inherits.id), w.confirmCalls]).toEqual([null, "dont_ask", 2]);
    // A Don't ask of its own still does, also under the global one: it outlives the global going down.
    expect(await h.bots.create({ ...META, mode: "dont_ask" })).toEqual({ kind: "refused", reason: "word_mismatch" });
    expect(w.confirmCalls).toBe(2);
  });
});

describe("a copy starts with no mode of its own (the coordinator's ruling on concern 1)", () => {
  test("a copy of a bot with its own Don't ask has no mode of its own: it runs in the global mode", async () => {
    const w = await setup([]); const h = w.hermit;
    expect(await h.modes.setBot("b1", "dont_ask", { typed: "entiendo" })).toBe("set");
    const asked = w.confirmCalls;
    const twin = made(await h.bots.duplicate("b1"));
    expect([twin.mode, await h.modes.of(twin.id), await h.modes.of("b1"), w.confirmCalls - asked]).toEqual([null, "ask", "dont_ask", 0]);
    // It has no mode, so none is logged for it.
    expect((await w.auditEntries()).filter((e) => e.sessionId === twin.id).map((e) => e.reason)).toEqual(["bot.duplicated"]);
  });

  test("with the global mode at Don't ask, any bot is duplicated without the word", async () => {
    const w = await setup([]); const h = w.hermit;
    expect(await h.modes.setGlobal("dont_ask", { typed: "entiendo" })).toBe("set");
    expect(await h.modes.setBot("b2", "ask")).toBe("set");
    const asked = w.confirmCalls;
    for (const id of ["b1", "b2"]) {
      const twin = made(await h.bots.duplicate(id));
      expect([twin.mode, await h.modes.of(twin.id)], id).toEqual([null, "dont_ask"]);
    }
    expect(w.confirmCalls).toBe(asked);
  });

  test("a copy of a bot holding pay asks for the fingerprint, as creating it would", async () => {
    const w = await setup([]); const h = w.hermit;
    made(await h.bots.update("b2", { grants: ["notes", "wallet_pay"] }));
    expect(w.confirmCalls).toBe(1);
    w.fingerprint = false;
    expect(await h.bots.duplicate("b2")).toEqual({ kind: "refused", reason: "fingerprint_declined" });
    w.fingerprint = true;
    expect(made(await h.bots.duplicate("b2")).grants).toEqual(["notes", "wallet_pay"]);
    expect([w.confirmCalls, w.prompts.at(-1)]).toEqual([3, copy("es-419", "HM-BOT-04.fingerprintPrompt.grant")]);
  });
});

describe("only a bot's own mode counts for setBot (the coordinator's ruling, fix round 1)", () => {
  test("under a global Don't ask, a bot's own Don't ask still takes the word and the fingerprint, and outlives the global going down", async () => {
    const w = await setup([]); const h = w.hermit;
    expect(await h.modes.setGlobal("dont_ask", { typed: "entiendo" })).toBe("set");
    const asked = w.confirmCalls;
    expect(await h.modes.setBot("b1", "dont_ask")).toBe("word_mismatch");
    expect(w.confirmCalls).toBe(asked);
    w.fingerprint = false;
    expect(await h.modes.setBot("b1", "dont_ask", { typed: "I understand" })).toBe("fingerprint_declined");
    expect((await h.bots.get("b1"))!.mode).toBeNull();
    w.fingerprint = true;
    expect(await h.modes.setBot("b1", "dont_ask", { typed: "I understand" })).toBe("set");
    expect([w.confirmCalls - asked, w.prompts.at(-1)]).toEqual([2, copy("es-419", "HM-BOT-04.fingerprintPrompt.dontAsk")]);
    // Confirmed for b1 itself, so it stays when the global goes back down; b2, which inherits, follows the global.
    expect(await h.modes.setGlobal("ask")).toBe("set");
    expect([await h.modes.of("b1"), await h.modes.of("b2")]).toEqual(["dont_ask", "ask"]);
    // The Don't ask it already has asks nothing.
    expect(await h.modes.setBot("b1", "dont_ask")).toBe("set");
    expect(w.confirmCalls - asked).toBe(2);
  });

  test("a lower mode, or back to the global mode, needs nothing, also under a global Don't ask", async () => {
    const w = await setup([]); const h = w.hermit;
    expect(await h.modes.setBot("b1", "dont_ask", { typed: "entiendo" })).toBe("set");
    expect(await h.modes.setGlobal("dont_ask", { typed: "entiendo" })).toBe("set");
    expect(await h.modes.setBot("b2", "auto")).toBe("set");
    const asked = w.confirmCalls;
    // Back to the global: it took the word and the fingerprint when it was set.
    expect(await h.modes.setBot("b2", null)).toBe("set");
    expect([(await h.bots.get("b2"))!.mode, await h.modes.of("b2")]).toEqual([null, "dont_ask"]);
    expect(await h.modes.setBot("b1", "auto")).toBe("set");
    expect(await h.modes.setBot("b1", null)).toBe("set");
    expect(await h.modes.setBot("b2", "ask")).toBe("set");
    expect([await h.modes.of("b1"), await h.modes.of("b2"), w.confirmCalls]).toEqual(["dont_ask", "ask", asked]);
  });
});

describe("the rest of the bots API", () => {
  test("a row says the mode in effect and the bot's latest words", async () => {
    const w = await setup(['{"choice":"respond"}', "Hola."]); const h = w.hermit;
    await h.send(await h.resumeSession("b1"), "hola");
    expect(await h.modes.setBot("b2", "auto")).toBe("set");
    const rows = (await h.bots.roster()).rows;
    expect(rows.map((r) => [r.bot.id, r.mode])).toEqual([["hermit", "ask"], ["b1", "ask"], ["b2", "auto"]]);
    expect(rows[1]!.preview).toEqual({ who: "bot", text: "Hola." });
    expect(rows[2]).not.toHaveProperty("preview");
  });

  test("Hermit is never hidden, pinned, deleted, duplicated or edited; a bot that doesn't exist is not_found", async () => {
    const w = await setup([]); const h = w.hermit;
    const primary = { kind: "refused", reason: "primary" };
    expect([await h.bots.hide("hermit", true), await h.bots.pin("hermit", true), await h.bots.update("hermit", { sources: none })]).toEqual([primary, primary, primary]);
    const gone = { kind: "refused", reason: "not_found" };
    expect([await h.bots.update("b9", { name: "X" }), await h.bots.duplicate("b9"), await h.bots.pin("b9", true), await h.bots.hide("b9", true), await h.bots.remove("b9"), await h.bots.reset("b9")])
      .toEqual([gone, gone, gone, gone, gone, gone]);
    expect([await h.modes.setBot("b9", "auto"), await h.bots.get("b9"), await h.bots.notes("b9")]).toEqual(["not_found", undefined, { notes: [] }]);
  });

  test("the store's limits come back as refusals, before any fingerprint", async () => {
    const w = await setup([]); const h = w.hermit;
    expect(await h.bots.create({ ...META, name: " " })).toEqual({ kind: "refused", reason: "name_empty" });
    expect(await h.bots.create({ ...META, name: "x".repeat(41) })).toEqual({ kind: "refused", reason: "name_too_long" });
    expect(await h.bots.create({ ...META, role: "x".repeat(801) })).toEqual({ kind: "refused", reason: "role_too_long" });
    expect(await h.bots.create({ ...META, sources: { sites: ["192.168.0.1"], connectors: [] } })).toEqual({ kind: "refused", reason: "bad_site" });
    const meta = made(await h.bots.create(META));
    made(await h.bots.pin("b1", true));
    made(await h.bots.pin("b2", true));
    expect(await h.bots.pin(meta.id, true)).toEqual({ kind: "refused", reason: "too_many_pins" });
    for (let i = (await w.store.list()).length; i < MAX_BOTS; i++) await w.store.create({ id: `x${i}`, name: `Bot ${i}`, role: "", grants: [], sources: none, mode: null });
    expect(await h.bots.create({ ...INBOX, grants: ["mail_send"] })).toEqual({ kind: "refused", reason: "too_many_bots" });
    expect(await h.bots.duplicate("b1")).toEqual({ kind: "refused", reason: "too_many_bots" });
    expect(w.confirmCalls).toBe(0);
  });

  test("notes: a bot's own and the shared ones; a bot shares its own, and only Hermit deletes a shared one", async () => {
    const w = await setup([]); const h = w.hermit;
    const own = (await h.bots.notes("b2")).notes.find((n) => n.fact === "receta de arroz con leche")!;
    const shared = (await h.bots.notes("b2")).notes.find((n) => n.shared)!;
    expect(shared.fact).toBe("me llamo Ana Prueba");
    expect(await h.bots.deleteNote("b2", shared.id)).toBe(false);
    expect(await h.bots.shareNote("b2", own.id)).toBe(true);
    expect((await h.bots.notes("b1")).notes.map((n) => n.fact)).toContain("receta de arroz con leche");
    expect(await h.bots.deleteNote("hermit", own.id)).toBe(true);
    expect((await h.bots.notes("b2")).notes.map((n) => n.fact)).not.toContain("receta de arroz con leche");
    // A deleted note leaves the same trace as HM-MEM-01's delete: the forget skill and a hash, never the fact; and, like a
    // share, the bot whose note it was (Task 18 fix round 1), so HM-ACT-01 names it.
    const entries = await w.auditEntries();
    expect(entries.filter((e) => e.skill === "forget").map((e) => [e.event, e.outcome ?? null, e.bot])).toEqual([["call_proposed", null, "hermit"], ["executed", "ok", "hermit"]]);
    expect(JSON.stringify(entries)).not.toContain("arroz");
    const { rows, chain } = await h.activity();
    expect(rows.find((r) => r.skill === "forget")).toMatchObject({ mark: "ran", bot: "hermit", botName: "Hermit" });
    expect(chain.kind).toBe("verified");
  });

  test("each change logs one code by the bot's id; a change that changes nothing logs nothing", async () => {
    const w = await setup([]); const h = w.hermit;
    const meta = made(await h.bots.create(META));
    made(await h.bots.update(meta.id, { role: "Revisas campañas." }));
    made(await h.bots.update(meta.id, { grants: ["web_read", "notes"] }));
    const twin = made(await h.bots.duplicate(meta.id));
    made(await h.bots.pin(meta.id, true));
    made(await h.bots.hide(twin.id, true));
    expect((await h.bots.reset(meta.id)).kind).toBe("done");
    expect(await h.modes.setBot(meta.id, "auto")).toBe("set");
    expect(await h.modes.setBot(meta.id, null)).toBe("set");
    expect(await h.modes.setGlobal("auto")).toBe("set");
    made(await h.bots.remove(twin.id));
    // Nothing changes: no entry.
    made(await h.bots.pin(meta.id, true));
    made(await h.bots.hide("b1", false));
    made(await h.bots.update(meta.id, {}));
    expect(await h.modes.setBot(meta.id, null)).toBe("set");
    expect(await h.modes.setGlobal("auto")).toBe("set");
    const bot = (await w.auditEntries()).filter((e) => e.event === "bot");
    expect(bot.map((e) => [e.sessionId, e.reason])).toEqual([
      [meta.id, "bot.created"], [meta.id, "bot.updated"], [meta.id, "bot.granted"], [twin.id, "bot.duplicated"], [meta.id, "bot.pinned"],
      [twin.id, "bot.hidden"], [meta.id, "bot.reset"], [meta.id, "mode.auto"], [meta.id, "mode.inherit"], ["user", "mode.auto"], [twin.id, "bot.deleted"],
    ]);
    expect(bot.every((e) => e.skill === "bot" && e.outcome === "ok")).toBe(true);
    // Task 18 (ruling 3): each row carries the bot it changed, inside the signed entry; the global mode is about no bot.
    expect(bot.map((e) => e.bot ?? null)).toEqual(bot.map((e) => (e.sessionId === "user" ? null : e.sessionId)));
    expect((await h.activity()).chain.kind).toBe("verified");
  });

  test("sharing a note is logged by the bot's id and a code, never the note; a share that changes nothing logs nothing", async () => {
    const w = await setup([]); const h = w.hermit;
    const own = (await h.bots.notes("b2")).notes.find((n) => n.fact === "receta de arroz con leche")!;
    expect(await h.bots.shareNote("b2", own.id)).toBe(true);
    expect(await h.bots.shareNote("b2", own.id)).toBe(false);
    const rows = (await w.auditEntries()).filter((e) => e.event === "bot");
    expect(rows.map((e) => [e.sessionId, e.reason, e.bot])).toEqual([["b2", "bot.note_shared", "b2"]]);
    expect(JSON.stringify(await w.auditEntries())).not.toContain("arroz");
    const { rows: shown, chain } = await h.activity();
    expect(shown.find((r) => r.reason === "bot.note_shared")).toMatchObject({ skill: "bot", mark: "ran", bot: "b2", botName: "Recetas" });
    expect(chain.kind).toBe("verified");
  });

  test("a deleted bot's rows keep its id and lose its name, so HM-ACT-01 says the bot is gone", async () => {
    const w = await setup([]); const h = w.hermit;
    const meta = made(await h.bots.create(META));
    made(await h.bots.remove(meta.id));
    const rows = (await h.activity()).rows.filter((r) => r.bot === meta.id);
    expect(rows.map((r) => r.reason)).toEqual(["bot.deleted", "bot.created"]);
    for (const r of rows) expect(r).not.toHaveProperty("botName");
  });

  test("Hermit is the bots API the app calls", async () => {
    const w = await setup([]);
    const app: HermitBotsApi = w.hermit;
    expect(Object.keys(app.bots).sort()).toEqual(["chats", "create", "deleteNote", "duplicate", "get", "hide", "notes", "pin", "proposal", "remove", "reset", "roster", "shareNote", "update"]);
    expect(Object.keys(app.modes).sort()).toEqual(["global", "of", "setBot", "setGlobal"]);
  });

  test("no notifications in wave 1 (ruling 3): no call for them, and a patch can't switch them", async () => {
    const w = await setup([]); const h = w.hermit;
    expect(h.bots).not.toHaveProperty("notify");
    expect(made(await h.bots.update("b1", { notify: false } as BotPatch)).notify).toBe(true);
    expect((await w.auditEntries()).filter((e) => e.event === "bot")).toEqual([]);
  });
});

describe("a proposal's offer (F-M15)", () => {
  const OFFER: BotProposalView = {
    offerId: "o1", name: "Viajes", role: "Planeas los viajes de la familia Prueba.", look: { shape: "whelk", color: "sand" }, grants: ["web_read"], sources: none, tainted: false, needsFingerprint: false, mode: "ask",
  };
  const input = (p: BotProposalView): NewBot => ({ name: p.name, role: p.role, look: p.look, grants: p.grants, sources: p.sources, mode: null });

  /** Offers that can be read and used once, as Task 12's will be. */
  function offers(views: BotProposalView[]): BotProposals & { used: string[] } {
    const left = new Map(views.map((v) => [v.offerId, v]));
    const used: string[] = [];
    return {
      used,
      offer: async () => { throw new Error("No offers are made in this test."); },
      peek: (id) => left.get(id),
      claim: (id) => {
        const v = left.get(id);
        if (v) {
          left.delete(id);
          used.push(id);
        }
        return v;
      },
    };
  }

  /** The bots API over a fresh database, as createHermit wires it, with these offers and this fingerprint. */
  async function api(proposals: BotProposals, confirm: (prompt: string) => Promise<boolean> = async () => true) {
    const sql = nodeSql();
    await migrate(sql);
    const values = new Map<string, string>();
    let n = 0;
    return createBotsApi({
      store: createBotsStore(sql, () => NOW), sessions: createSessions(sql, () => NOW), memory: createMemory(sql),
      settings: { get: async (k) => values.get(k), set: async (k, v) => void values.set(k, v) },
      audit: createAuditLog(sql, ed25519Signer(new Uint8Array(32).fill(3))),
      clear: async () => "s", busy: () => false, confirm, proposals, newId: () => `n${++n}`, now: () => NOW,
    });
  }

  test("without proposals wired, there is no offer to read or use", async () => {
    const w = await setup([]); const h = w.hermit;
    expect(h.bots.proposal("o1")).toBeUndefined();
    expect(await h.bots.create(META, { offerId: "o1" })).toEqual({ kind: "refused", reason: "offer_gone" });
  });

  test("an offer is used once, only when its bot is made; a tainted one needs the review", async () => {
    const tainted = { ...OFFER, offerId: "o2", tainted: true };
    const p = offers([OFFER, tainted]);
    const { bots } = await api(p);
    expect(bots.proposal("o1")).toEqual(OFFER);
    // A refused create keeps the offer for another try.
    expect(await bots.create({ ...input(OFFER), name: " " }, { offerId: "o1" })).toEqual({ kind: "refused", reason: "name_empty" });
    expect((await bots.create(input(OFFER), { offerId: "o1" })).kind).toBe("done");
    expect(await bots.create(input(OFFER), { offerId: "o1" })).toEqual({ kind: "refused", reason: "offer_gone" });
    expect(await bots.create(input(tainted), { offerId: "o2" })).toEqual({ kind: "refused", reason: "needs_review" });
    expect((await bots.create(input(tainted), { offerId: "o2", reviewed: true })).kind).toBe("done");
    expect(p.used).toEqual(["o1", "o2"]);
  });

  test("two creates from one offer at once: the second finds it gone", async () => {
    let answer: ((yes: boolean) => void) | undefined;
    const p = offers([OFFER]);
    const { bots } = await api(p, () => new Promise((resolve) => (answer = resolve)));
    const first = bots.create({ ...input(OFFER), grants: ["mail_send"] }, { offerId: "o1" });
    await vi.waitFor(() => expect(answer).toBeDefined());
    expect(await bots.create(input(OFFER), { offerId: "o1" })).toEqual({ kind: "refused", reason: "offer_gone" });
    answer!(true);
    expect((await first).kind).toBe("done");
    expect(p.used).toEqual(["o1"]);
  });
});

describe("refuse turns, startSession and resumeSession while a bot is being cleared (#108)", () => {
  function defer() {
    let open = () => {};
    const promise = new Promise<void>((resolve) => {
      open = resolve;
    });
    return { promise, open };
  }

  /** Wraps a SqlPort so the first write matching `match` waits on a deferred gate. */
  function holdSqlOn(match: RegExp) {
    const base = nodeSql();
    const gate = defer();
    const entered = defer();
    let held = false;
    const sql: typeof base = {
      exec: async (q, params) => {
        if (!held && match.test(q)) {
          held = true;
          entered.open();
          await gate.promise;
        }
        return base.exec(q, params);
      },
      query: (q, params) => base.query(q, params),
      transaction: (fn) => base.transaction((tx) => fn({
        ...tx,
        exec: async (q, params) => {
          if (!held && match.test(q)) {
            held = true;
            entered.open();
            await gate.promise;
          }
          return tx.exec(q, params);
        },
      })),
      close: () => base.close(),
    };
    return { sql, entered: entered.promise, release: gate.open };
  }

  test("bots.reset refuses a concurrent send, startSession, and resumeSession without orphan chat_turns", async () => {
    const h = holdSqlOn(/DELETE FROM sessions WHERE bot_id = \?/i);
    const { createHermit } = await import("../src/hermit.ts");
    const { PROFILE } = await import("./bot-harness.ts");
    const store = createBotsStore(h.sql, () => NOW);
    await migrate(h.sql);
    await store.create({ id: "b1", name: "Viajes", role: "Planeas viajes.", grants: ["notes"], sources: none, mode: null });
    let n = 0;
    const hermit = createHermit({
      sql: h.sql,
      signer: ed25519Signer(new Uint8Array(32).fill(8)),
      notifier: { schedule: async () => "n", cancel: async () => {} },
      calendar: { list: async () => [], add: async () => {}, calendars: async () => [] },
      replySender: { send: async () => "sent" },
      engine: { complete: async () => ({ text: '{"choice":"respond"}', toolCalls: [] }) },
      approvals: { request: async () => ({ kind: "denied" }) },
      now: () => NOW,
      timeZone: () => "America/Costa_Rica",
      language: () => "es-419",
      newId: () => `id${++n}`,
      copy,
    }, PROFILE);

    const oldSession = await hermit.resumeSession("b1");
    const resetting = hermit.bots.reset("b1");
    await h.entered;

    const refused = await hermit.send(oldSession, "hola durante reset");
    expect(refused).toEqual({ kind: "reply", text: copy("es-419", "HM-BOT-02.clearing") });
    await expect(hermit.startSession({ botId: "b1" })).rejects.toThrow();
    await expect(hermit.resumeSession("b1")).rejects.toThrow();

    h.release();
    const res = await resetting;
    expect(res.kind).toBe("done");
    const orphans = await h.sql.query("SELECT id FROM chat_turns WHERE session_id NOT IN (SELECT id FROM sessions)");
    expect(orphans).toEqual([]);
  });

  test("bots.remove refuses a concurrent send, startSession, and resumeSession without orphan chat_turns", async () => {
    const h = holdSqlOn(/DELETE FROM bots WHERE id = \?/i);
    const { createHermit } = await import("../src/hermit.ts");
    const { PROFILE } = await import("./bot-harness.ts");
    await migrate(h.sql);
    const store = createBotsStore(h.sql, () => NOW);
    await store.create({ id: "b1", name: "Viajes", role: "Planeas viajes.", grants: ["notes"], sources: none, mode: null });
    let n = 0;
    const hermit = createHermit({
      sql: h.sql,
      signer: ed25519Signer(new Uint8Array(32).fill(8)),
      notifier: { schedule: async () => "n", cancel: async () => {} },
      calendar: { list: async () => [], add: async () => {}, calendars: async () => [] },
      replySender: { send: async () => "sent" },
      engine: { complete: async () => ({ text: '{"choice":"respond"}', toolCalls: [] }) },
      approvals: { request: async () => ({ kind: "denied" }) },
      now: () => NOW,
      timeZone: () => "America/Costa_Rica",
      language: () => "en",
      newId: () => `id${++n}`,
      copy,
    }, PROFILE);

    const oldSession = await hermit.resumeSession("b1");
    const removing = hermit.bots.remove("b1");
    await h.entered;

    const refused = await hermit.send(oldSession, "hello during remove");
    expect(refused).toEqual({ kind: "reply", text: copy("en", "HM-BOT-02.clearing") });
    await expect(hermit.startSession({ botId: "b1" })).rejects.toThrow();
    await expect(hermit.resumeSession("b1")).rejects.toThrow();

    h.release();
    const res = await removing;
    expect(res.kind).toBe("done");
    const orphans = await h.sql.query("SELECT id FROM chat_turns WHERE session_id NOT IN (SELECT id FROM sessions)");
    expect(orphans).toEqual([]);
  });

  test("clearConversation refuses a concurrent send without orphan chat_turns", async () => {
    const h = holdSqlOn(/DELETE FROM sessions WHERE bot_id = \?/i);
    const { createHermit } = await import("../src/hermit.ts");
    const { PROFILE } = await import("./bot-harness.ts");
    await migrate(h.sql);
    let n = 0;
    const hermit = createHermit({
      sql: h.sql,
      signer: ed25519Signer(new Uint8Array(32).fill(8)),
      notifier: { schedule: async () => "n", cancel: async () => {} },
      calendar: { list: async () => [], add: async () => {}, calendars: async () => [] },
      replySender: { send: async () => "sent" },
      engine: { complete: async () => ({ text: '{"choice":"respond"}', toolCalls: [] }) },
      approvals: { request: async () => ({ kind: "denied" }) },
      now: () => NOW,
      timeZone: () => "America/Costa_Rica",
      language: () => "es-419",
      newId: () => `id${++n}`,
      copy,
    }, PROFILE);

    const oldSession = await hermit.resumeSession();
    const clearing = hermit.clearConversation();
    await h.entered;

    const refused = await hermit.send(oldSession, "hola durante clear");
    expect(refused).toEqual({ kind: "reply", text: copy("es-419", "HM-BOT-02.clearing") });

    h.release();
    const fresh = await clearing;
    expect(fresh).toBeTruthy();
    const orphans = await h.sql.query("SELECT id FROM chat_turns WHERE session_id NOT IN (SELECT id FROM sessions)");
    expect(orphans).toEqual([]);
  });
});
