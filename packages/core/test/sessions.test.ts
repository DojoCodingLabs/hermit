import { beforeEach, describe, expect, test } from "vitest";
import { nodeSql } from "@hermit/sql-node";
import type { SqlPort } from "../src/ports.ts";
import { migrate } from "../src/schema.ts";
import { createSessions } from "../src/sessions.ts";

let sql: SqlPort;
beforeEach(async () => {
  sql = nodeSql();
  await migrate(sql);
});

describe("sessions and history (ENT-Session, ENT-ChatTurn)", () => {
  test("keeps history in order with untrusted flags", async () => {
    const s = createSessions(sql);
    await s.start({ id: "s1", attended: true });
    await s.addTurn("s1", { role: "user", text: "did Ana text me?", untrusted: false, at: 1 });
    await s.addTurn("s1", { role: "tool", text: "Ana: where are you", untrusted: true, at: 2 });
    expect(await s.history("s1")).toEqual([
      { role: "user", content: "did Ana text me?" },
      { role: "tool", content: "Ana: where are you", untrusted: true },
    ]);
  });

  test("history returns the most recent turns, oldest first", async () => {
    const s = createSessions(sql);
    await s.start({ id: "s1", attended: true });
    for (let i = 1; i <= 5; i++) await s.addTurn("s1", { role: "user", text: `m${i}`, untrusted: false, at: i });
    expect((await s.history("s1", 2)).map((m) => m.content)).toEqual(["m4", "m5"]);
  });

  test("taint is sticky and survives a restart", async () => {
    const s = createSessions(sql);
    await s.start({ id: "s1", attended: true });
    await s.markTainted("s1", { kind: "inbound_message", ref: "wa:1", at: 5 });
    const afterRestart = await createSessions(sql).load("s1");
    expect(afterRestart!.taint.length).toBeGreaterThan(0);
  });

  test("unattended sessions are marked so the cage turns asks into denies", async () => {
    const s = await createSessions(sql).start({ id: "night", attended: false });
    expect(s.unattended).toBe(true);
  });
  test("the history window moves in steps of half the limit, so the prompt's start stays put between steps", async () => {
    const s = createSessions(sql);
    await s.start({ id: "w", attended: true });
    const starts: string[] = [];
    for (let i = 1; i <= 12; i++) {
      await s.addTurn("w", { role: "user", text: `m${i}`, untrusted: false, at: i });
      starts.push((await s.history("w", 4))[0]!.content);
    }
    expect(starts).toEqual(["m1", "m1", "m1", "m1", "m3", "m3", "m5", "m5", "m7", "m7", "m9", "m9"]);
    const h = await s.history("w", 4);
    expect(h.length).toBeGreaterThanOrEqual(2);
    expect(h.length).toBeLessThanOrEqual(4);
  });
});

// US-CHAT-07: the conversation is kept across restarts and can be cleared.
describe("keep and clear the conversation (US-CHAT-07)", () => {
  test("latest finds the newest attended session after a restart", async () => {
    let t = 0;
    const s = createSessions(sql, () => ++t);
    await s.start({ id: "old", attended: true });
    await s.start({ id: "new", attended: true });
    await s.start({ id: "night", attended: false });
    expect(await createSessions(sql).latest()).toBe("new");
  });

  test("latest is undefined before any session", async () => {
    expect(await createSessions(sql).latest()).toBeUndefined();
  });

  test("the transcript holds what the user saw: their words and Hermit's final answers", async () => {
    const s = createSessions(sql);
    await s.start({ id: "s1", attended: true });
    await s.addTurn("s1", { role: "user", text: "did Ana text me?", untrusted: false, at: 1 });
    await s.addTurn("s1", { role: "assistant", text: '{"skill":"read_messages","args":{}}', untrusted: false, at: 2 });
    await s.addTurn("s1", { role: "tool", text: "Ana: where are you", untrusted: true, at: 3 });
    await s.addTurn("s1", { role: "assistant", text: "Ana asks where you are.", untrusted: true, outcome: "reply", at: 4 });
    await s.addTurn("s1", { role: "user", text: "remind me", untrusted: false, at: 5 });
    await s.addTurn("s1", { role: "assistant", text: "At what time?", untrusted: false, outcome: "question", at: 6 });
    expect(await createSessions(sql).transcript("s1")).toEqual([
      { kind: "user", text: "did Ana text me?" },
      { kind: "reply", text: "Ana asks where you are." },
      { kind: "user", text: "remind me" },
      { kind: "question", text: "At what time?" },
    ]);
  });

  // Q155: a reply that stopped short (at its token cap, or stopped by the user while it was written) comes back after a
  // restart still saying so, and Seguir grows it in place: one bubble, one message for the model.
  test("a reply that stopped short is kept as such, and Seguir grows it in place", async () => {
    const s = createSessions(sql);
    await s.start({ id: "s1", attended: true });
    await s.addTurn("s1", { role: "user", text: "dame una receta de arroz con leche", untrusted: false, at: 1 });
    await s.addTurn("s1", { role: "assistant", text: "Ingredientes:\n- 1 taza de arroz", untrusted: false, outcome: "cut", at: 2 });
    expect(await s.transcript("s1")).toEqual([
      { kind: "user", text: "dame una receta de arroz con leche" },
      { kind: "reply", text: "Ingredientes:\n- 1 taza de arroz", cut: true },
    ]);
    const last = await s.lastReply("s1");
    expect(last).toMatchObject({ text: "Ingredientes:\n- 1 taza de arroz", cut: true, stopped: false, untrusted: false });
    await s.extendReply("s1", last!.id, "Ingredientes:\n- 1 taza de arroz\n- 1 litro de leche", "reply");
    expect(await createSessions(sql).transcript("s1")).toEqual([
      { kind: "user", text: "dame una receta de arroz con leche" },
      { kind: "reply", text: "Ingredientes:\n- 1 taza de arroz\n- 1 litro de leche" },
    ]);
    expect((await s.history("s1")).map((m) => m.content)).toEqual(["dame una receta de arroz con leche", "Ingredientes:\n- 1 taza de arroz\n- 1 litro de leche"]);
    expect(await s.lastReply("s1")).toMatchObject({ cut: false });
  });

  test("a reply the user stopped is kept as stopped; only the session's very last turn is a reply Seguir can grow", async () => {
    const s = createSessions(sql);
    await s.start({ id: "s1", attended: true });
    await s.addTurn("s1", { role: "user", text: "explícame en detalle cómo funciona", untrusted: false, at: 1 });
    await s.addTurn("s1", { role: "assistant", text: "Primero, el teléfono", untrusted: false, outcome: "stopped", at: 2 });
    expect(await s.transcript("s1")).toEqual([
      { kind: "user", text: "explícame en detalle cómo funciona" },
      { kind: "reply", text: "Primero, el teléfono", cut: true, stopped: true },
    ]);
    expect(await s.lastReply("s1")).toMatchObject({ cut: true, stopped: true });
    // A newer turn means that reply is history now: nothing to grow.
    await s.addTurn("s1", { role: "user", text: "gracias", untrusted: false, at: 3 });
    expect(await s.lastReply("s1")).toBeUndefined();
    // A question or a tool call last is not a reply either.
    await s.addTurn("s1", { role: "assistant", text: "¿Algo más?", untrusted: false, outcome: "question", at: 4 });
    expect(await s.lastReply("s1")).toBeUndefined();
    // Growing someone else's row, or another session's, changes nothing.
    await s.start({ id: "s2", attended: true });
    await s.addTurn("s2", { role: "assistant", text: "Otra", untrusted: false, outcome: "cut", at: 5 });
    const other = await s.lastReply("s2");
    await s.extendReply("s1", other!.id, "cambiado", "reply");
    expect((await s.lastReply("s2"))!.text).toBe("Otra");
  });

  test("the transcript keeps the newest entries when it is long", async () => {
    const s = createSessions(sql);
    await s.start({ id: "s1", attended: true });
    for (let i = 1; i <= 5; i++) await s.addTurn("s1", { role: "user", text: `m${i}`, untrusted: false, at: i });
    expect((await s.transcript("s1", 2)).map((e) => e.text)).toEqual(["m4", "m5"]);
  });

  test("clear removes every session and turn, and a tainted session goes with it", async () => {
    const s = createSessions(sql);
    await s.start({ id: "s1", attended: true });
    await s.addTurn("s1", { role: "user", text: "hello", untrusted: false, at: 1 });
    await s.markTainted("s1", { kind: "inbound_message", ref: "wa:1", at: 2 });
    await s.clear();
    expect(await s.load("s1")).toBeUndefined();
    expect(await s.history("s1")).toEqual([]);
    expect(await s.latest()).toBeUndefined();
  });

  test("clear leaves memory notes and the signed log alone", async () => {
    await sql.exec("INSERT INTO notes (fact, tainted, created_at) VALUES ('Ana likes tea', 0, 1)");
    await sql.exec("INSERT INTO audit (seq, ts, session_id, event, prev_hash, hash, sig) VALUES (1, 1, 's1', 'executed', 'p', 'h', 's')");
    const s = createSessions(sql);
    await s.start({ id: "s1", attended: true });
    await s.clear();
    expect(await sql.query("SELECT fact FROM notes")).toHaveLength(1);
    expect(await sql.query("SELECT seq FROM audit")).toHaveLength(1);
  });
});

describe("sessions per bot", () => {
  const clock = { t: 0 };
  let s: ReturnType<typeof createSessions>;
  const say = (id: string, text: string, at: number) => s.addTurn(id, { role: "user", text, untrusted: false, at });
  beforeEach(() => {
    clock.t = 0;
    s = createSessions(sql, () => clock.t);
  });

  test("latest and clear are per bot", async () => {
    clock.t = 1; await s.start({ id: "s1", attended: true }); await say("s1", "hola", 5);
    clock.t = 2; await s.start({ id: "s2", attended: true, botId: "b1" });
    expect(await s.latest("hermit")).toBe("s1");
    expect(await s.latest()).toBe("s1");
    expect(await s.latest("b1")).toBe("s2");
    await s.clear("b1");
    expect(await s.load("s2")).toBeUndefined();
    expect(await s.history("s1")).toHaveLength(1);
  });
  test("a session started without a bot is Hermit's", async () => {
    await s.start({ id: "n1", attended: false });
    expect((await s.load("n1"))?.botId).toBe("hermit");
  });
  test("latest is the session with the newest activity, a fresh start included", async () => {
    clock.t = 1; await s.start({ id: "a", attended: true, botId: "b1" });
    await say("a", "x", 10);
    clock.t = 20; await s.start({ id: "b", attended: true, botId: "b1" });
    expect(await s.latest("b1")).toBe("b");
    await say("a", "y", 30);
    expect(await s.latest("b1")).toBe("a");
  });
  test("the first user words title the chat, once", async () => {
    await s.start({ id: "a", attended: true, botId: "b1" });
    await say("a", "Busca un hotel para José «Pepe» Ruiz\nen Lisboa", 2);
    await say("a", "otra cosa", 3);
    expect((await s.chats("b1")).find((c) => c.id === "a")?.title).toBe("Busca un hotel para José 'Pepe' Ruiz en Lisboa");
  });
  test("a first turn with no words leaves the chat untitled until a turn has some", async () => {
    await s.start({ id: "a", attended: true, botId: "b1" });
    await say("a", " \n\t ", 2);
    expect((await s.chats("b1")).find((c) => c.id === "a")?.title).toBeUndefined();
    await say("a", "Hola Pepe", 3);
    expect((await s.chats("b1")).find((c) => c.id === "a")?.title).toBe("Hola Pepe");
  });
  test("chats lists only that bot's attended chats, newest activity first", async () => {
    clock.t = 1; await s.start({ id: "s1", attended: true }); await s.start({ id: "n1", attended: false });
    clock.t = 2; await s.start({ id: "a", attended: true, botId: "b1" });
    clock.t = 3; await s.start({ id: "b", attended: true, botId: "b1" });
    expect((await s.chats("b1")).map((c) => c.id)).toEqual(["b", "a"]);
    expect((await s.chats("hermit")).map((c) => c.id)).toEqual(["s1"]);
  });
});
