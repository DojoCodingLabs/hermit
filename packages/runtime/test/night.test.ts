/**
 * SL-24: the night shift through the composition root. Only the engine, alarms, calendar, WhatsApp reply and
 * the approval sheet are fakes; the schema, the cage, the signed log and the stores are the real ones.
 */
import { describe, expect, test } from "vitest";
import { nodeSql } from "@hermit/sql-node";
import { ed25519Signer, verifyChain } from "@hermit/cage";
import type { ApprovalRequest } from "@hermit/core";
import { profileById, type CompletionEngine, type EngineRequest } from "@hermit/model";
import { DEFAULT_NIGHT_SETTINGS, type DeviceState } from "@hermit/night";
import { createHermit } from "../src/hermit.ts";
import { recordingQueue } from "./bot-harness.ts";

const PROFILE = profileById("botpsy-q4-two-stage-nothink")!;
/** 2026-11-14 at hh:mm in Costa Rica (UTC-6). */
const at = (hh: number, mm = 0) => Date.UTC(2026, 10, 14, hh + 6, mm);
const COOL: DeviceState = { charging: true, batteryPercent: 90, thermalStatus: 0, screenOn: false, network: "wifi" };
const SIGNER = ed25519Signer(new Uint8Array(32).fill(5));

function setup() {
  const sql = nodeSql();
  const requests: EngineRequest[] = [];
  const engine: CompletionEngine = {
    async complete(req) {
      requests.push(req);
      return { text: '{"answer":"Ana pregunta si se ven mañana a las 8.","quotes":[]}', toolCalls: [] };
    },
  };
  const rq = recordingQueue(engine);
  const notices: Array<{ id: string; at: number; title: string }> = [];
  const sheets: ApprovalRequest[] = [];
  const clock = { now: at(2) };
  let n = 0;
  const hermit = createHermit(
    {
      sql,
      signer: SIGNER,
      notifier: { schedule: async (x) => (notices.push(x), "n"), cancel: async () => {} },
      calendar: { list: async () => [{ title: "Dentista", start: at(10), end: at(11) }], add: async () => {}, calendars: async () => [] },
      replySender: { send: async () => "sent" },
      engine: rq.engine,
      queue: rq.queue,
      approvals: { request: async (r) => (sheets.push(r), { kind: "denied" }) },
      now: () => clock.now,
      timeZone: () => "America/Costa_Rica",
      language: () => "es-419",
      newId: () => `id${++n}`,
    },
    PROFILE,
  );
  return { hermit, sql, requests, notices, sheets, clock, queued: rq.queued, unqueuedCalls: rq.unqueuedCalls };
}

const on = { ...DEFAULT_NIGHT_SETTINGS, enabled: true };

describe("night shift in the runtime (SL-24)", () => {
  test("settings are off until saved; an invalid choice is refused and nothing changes", async () => {
    const w = setup();
    await w.hermit.init();
    expect(await w.hermit.night.settings()).toEqual(DEFAULT_NIGHT_SETTINGS);
    expect(await w.hermit.night.saveSettings({ ...on, window: { start: "02:00", end: "02:00" } })).toEqual(["empty_window"]);
    expect((await w.hermit.night.settings()).enabled).toBe(false);
    expect(await w.hermit.night.saveSettings(on)).toEqual([]);
    expect(await w.hermit.night.settings()).toEqual(on);
  });

  test("a night runs unattended, asks nothing, keeps the briefing and announces it at the chosen time", async () => {
    const w = setup();
    await w.hermit.init();
    await w.hermit.night.saveSettings(on);
    await w.hermit.messages.ingest({ packageName: "com.whatsapp", conversationKey: "ana", title: "Ana", sender: "Ana", text: "¿Mañana a las 8?", postedAt: at(1), notificationKey: "k1" });
    const b = (await w.hermit.night.run({ conditions: () => COOL, noticeTitle: "Tu resumen de la mañana está listo" }))!;
    expect(b.jobs.map((j) => j.status)).toEqual(["ran", "ran", "ran"]);
    expect(await w.hermit.night.briefing()).toEqual(b);
    expect(w.sheets).toEqual([]);
    // The only model call is the quarantined reader: no tools, a JSON schema, the messages wrapped as untrusted.
    expect(w.requests).toHaveLength(1);
    expect(w.requests[0]!.tools).toBeUndefined();
    // Multi-bot (Task 10): the night's reader waited its turn in the run queue, as a routine.
    expect(w.unqueuedCalls()).toBe(0);
    expect(w.queued).toEqual(["routine"]);
    expect(w.requests[0]!.jsonSchema).toBeTruthy();
    expect(b.sections.find((s) => s.job === "messages")).toMatchObject({ untrusted: true, summary: "Ana pregunta si se ven mañana a las 8." });
    expect(w.notices).toEqual([{ id: "briefing-2026-11-14", at: at(7), title: "Tu resumen de la mañana está listo" }]);
    // Run again in the same night: nothing reruns and the notice isn't repeated.
    await w.hermit.night.run({ conditions: () => COOL, noticeTitle: "x" });
    expect(w.notices).toHaveLength(1);
    const { rows, chain } = await w.hermit.activity();
    expect(chain.kind).toBe("verified");
    expect(rows.filter((r) => r.skill.startsWith("night.")).map((r) => r.mark)).toEqual(["ran", "ran", "ran"]);
  });

  test("heat at the start: nothing runs and the briefing says why; the window closing turns it into a skip", async () => {
    const w = setup();
    await w.hermit.init();
    await w.hermit.night.saveSettings(on);
    const b = (await w.hermit.night.run({ conditions: () => ({ ...COOL, thermalStatus: 3 }), noticeTitle: "x" }))!;
    expect(b.stop).toBe("hot");
    expect(w.requests).toEqual([]);
    expect(w.notices).toEqual([]);
    w.clock.now = at(6, 30);
    const closed = (await w.hermit.night.run({ conditions: () => COOL, noticeTitle: "Listo" }))!;
    expect(closed.closed).toBe(true);
    expect(closed.jobs.every((j) => j.status === "skipped" && j.reason === "hot")).toBe(true);
    expect(w.notices).toHaveLength(1);
    const entries = await (await import("@hermit/cage")).createAuditLog(w.sql, SIGNER).entries();
    expect(verifyChain(entries, await SIGNER.publicKey())).toEqual({ ok: true });
  });

  test("outside the window, or switched off, a wake does nothing at all", async () => {
    const w = setup();
    await w.hermit.init();
    expect(await w.hermit.night.run({ conditions: () => COOL, noticeTitle: "x" })).toBeUndefined();
    await w.hermit.night.saveSettings(on);
    w.clock.now = at(12);
    expect(await w.hermit.night.run({ conditions: () => COOL, noticeTitle: "x" })).toBeUndefined();
    expect(w.requests).toEqual([]);
    expect(w.notices).toEqual([]);
    expect((await w.hermit.activity()).chain.kind).toBe("empty");
  });

  test("Q69: two wakes at once (headless task and in-app timer) run the night once", async () => {
    const w = setup();
    await w.hermit.init();
    await w.hermit.night.saveSettings(on);
    const [a, b] = await Promise.all([
      w.hermit.night.run({ conditions: () => COOL, noticeTitle: "x" }),
      w.hermit.night.run({ conditions: () => COOL, noticeTitle: "x" }),
    ]);
    const { rows } = await w.hermit.activity();
    expect(rows.filter((r) => r.skill.startsWith("night."))).toHaveLength(3);
    expect(w.notices).toHaveLength(1);
    expect([a, b].some((x) => x?.jobs.every((j) => j.status === "ran"))).toBe(true);
    // The lock is released after the run: the next wake can take it.
    const [row] = await w.sql.query<{ value: string }>("SELECT value FROM settings WHERE key = 'night.lock'");
    expect(row).toBeUndefined();
  });

  test("Q69: a live lock held elsewhere means this wake does nothing; an expired one is taken over", async () => {
    const w = setup();
    await w.hermit.init();
    await w.hermit.night.saveSettings(on);
    await w.sql.exec("INSERT INTO settings (key, value) VALUES ('night.lock', ?)", [JSON.stringify({ owner: "other", until: at(3) })]);
    expect(await w.hermit.night.run({ conditions: () => COOL, noticeTitle: "x" })).toBeUndefined();
    expect(w.requests).toEqual([]);
    expect((await w.hermit.activity()).chain.kind).toBe("empty");
    w.clock.now = at(3);
    const b = (await w.hermit.night.run({ conditions: () => COOL, noticeTitle: "x" }))!;
    expect(b.jobs.map((j) => j.status)).toEqual(["ran", "ran", "ran"]);
  });

  test("SL-26 with Q69: an erase that begins mid-pass stops it; nothing is written after, not even the lock release", async () => {
    const w = setup();
    await w.hermit.init();
    await w.hermit.night.saveSettings(on);
    await w.hermit.messages.ingest({ packageName: "com.whatsapp", conversationKey: "ana", title: "Ana", sender: "Ana", text: "Hola", postedAt: at(1), notificationKey: "k1" });
    // node:sqlite runs each query when it is called, so starting all three at once reads one instant.
    const snapshot = () => Promise.all([
      w.sql.query("SELECT * FROM audit"),
      w.sql.query("SELECT body FROM briefings"),
      w.sql.query("SELECT key, value FROM settings ORDER BY key"),
    ]);
    let erasing = false;
    let atErase: ReturnType<typeof snapshot> | undefined;
    // The erase begins while the model summarizes the messages.
    const record = w.requests.push.bind(w.requests);
    w.requests.push = (...r) => {
      erasing = true;
      atErase = snapshot();
      return record(...r);
    };
    expect(await w.hermit.night.run({ conditions: () => COOL, noticeTitle: "x", aborted: () => erasing })).toBeUndefined();
    expect(atErase).toBeDefined();
    const before = await atErase!;
    expect(before[0].length).toBeGreaterThan(0);
    expect(await snapshot()).toEqual(before);
    expect(w.notices).toEqual([]);
  });

  test("a suggestion that isn't there is gone, and nothing is asked", async () => {
    const w = setup();
    await w.hermit.init();
    expect(await w.hermit.night.act("nope", "nope")).toBe("gone");
    expect(w.sheets).toEqual([]);
  });
});
