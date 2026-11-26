/**
 * SL-30: HM-REM-01 (upcoming reminders, cancel through the cage and the signed log) and HM-CAL-02
 * (the calendar Hermit writes to, stored in ENT-Setting and used by calendar_add).
 */
import { describe, expect, test } from "vitest";
import { nodeSql } from "@hermit/sql-node";
import type { CalendarEvent, PhoneCalendar } from "@hermit/core";
import { ed25519Signer } from "@hermit/cage";
import { profileById, type CompletionEngine } from "@hermit/model";
import { createHermit } from "../src/hermit.ts";

const PROFILE = profileById("botpsy-q4-two-stage-nothink")!;
const NOW = Date.UTC(2026, 10, 12, 0, 0);
const HOUR = 3_600_000;

function setup(script: string[] = [], calendars: PhoneCalendar[] = []) {
  const sql = nodeSql();
  let i = 0;
  const engine: CompletionEngine = { complete: async () => ({ text: script[i++] ?? '{"choice":"respond"}', toolCalls: [] }) };
  const cancelledAlarms: string[] = [];
  const added: Array<{ event: CalendarEvent; calendarId: string | undefined }> = [];
  let n = 0;
  const hermit = createHermit(
    {
      sql,
      signer: ed25519Signer(new Uint8Array(32).fill(4)),
      notifier: { schedule: async () => "n", cancel: async (id) => void cancelledAlarms.push(id) },
      calendar: {
        list: async () => [],
        add: async (event, opts) => void added.push({ event, calendarId: opts?.calendarId }),
        calendars: async () => calendars,
      },
      replySender: { send: async () => "sent" },
      engine,
      approvals: { request: async (r) => ({ kind: "approved", biometric: true, argsHash: r.call.argsHash }) },
      now: () => NOW,
      timeZone: () => "America/Costa_Rica",
      language: () => "es-419",
      newId: () => `id${++n}`,
    },
    PROFILE,
  );
  const reminder = (text: string, at: number, state = "pending") =>
    sql.exec("INSERT INTO reminders (text, at, state, created_at, notification_id) VALUES (?, ?, ?, ?, ?)", [text, at, state, NOW, `alarm-${text}`]);
  return { hermit, sql, reminder, cancelledAlarms, added };
}

describe("HM-REM-01: upcoming reminders", () => {
  test("pending reminders only, soonest first", async () => {
    const w = setup();
    await w.hermit.init();
    await w.reminder("Banco", NOW + 5 * HOUR);
    await w.reminder("Mamá", NOW + 2 * HOUR);
    await w.reminder("Viejo", NOW + HOUR, "cancelled");
    await w.reminder("Ya sonó", NOW - HOUR, "fired");
    expect((await w.hermit.reminders.upcoming()).map((r) => r.text)).toEqual(["Mamá", "Banco"]);
  });

  test("none yet is an empty list (ST-EMPTY-FIRST)", async () => {
    const w = setup();
    await w.hermit.init();
    expect(await w.hermit.reminders.upcoming()).toEqual([]);
  });

  test("cancel from the screen goes through the cage, cancels the alarm, and is in the signed log", async () => {
    const w = setup();
    await w.hermit.init();
    await w.reminder("Mamá", NOW + 2 * HOUR);
    const [r] = await w.hermit.reminders.upcoming();

    expect(await w.hermit.reminders.cancel(r!.id)).toBe("cancelled");
    expect(await w.hermit.reminders.upcoming()).toEqual([]);
    expect(w.cancelledAlarms).toEqual(["alarm-Mamá"]);

    const { rows, chain } = await w.hermit.activity();
    expect(chain.kind).toBe("verified");
    expect(rows.map((x) => [x.skill, x.mark])).toEqual([["reminder_cancel", "ran"]]);
    const events = (await w.sql.query<{ event: string; decision: string | null; outcome: string | null }>("SELECT event, decision, outcome FROM audit ORDER BY seq"))
      .map((e) => [e.event, e.decision ?? e.outcome]);
    expect(events).toEqual([["call_proposed", null], ["policy_decided", "allow"], ["executed", "ok"]]);
  });

  test("a reminder that already fired or was cancelled elsewhere is reported gone and logged as failed", async () => {
    const w = setup();
    await w.hermit.init();
    await w.reminder("Mamá", NOW + 2 * HOUR);
    const [r] = await w.hermit.reminders.upcoming();
    await w.sql.exec("UPDATE reminders SET state = 'fired' WHERE id = ?", [r!.id]);

    expect(await w.hermit.reminders.cancel(r!.id)).toBe("gone");
    expect(w.cancelledAlarms).toEqual([]);
    const { rows } = await w.hermit.activity();
    expect(rows.map((x) => [x.skill, x.mark])).toEqual([["reminder_cancel", "failed"]]);
  });
});

describe("HM-CAL-02: the calendar Hermit writes to", () => {
  const work: PhoneCalendar = { id: "w", title: "Trabajo", writable: true };
  const home: PhoneCalendar = { id: "h", title: "Personal", writable: true, primary: true };
  const holidays: PhoneCalendar = { id: "x", title: "Feriados", writable: false };

  test("lists the phone's writable calendars with the primary selected until the user chooses", async () => {
    const w = setup([], [work, holidays, home]);
    await w.hermit.init();
    expect(await w.hermit.calendars.choice()).toEqual({ options: [home, work], selectedId: "h", chosenGone: false });
  });

  test("the choice is stored in ENT-Setting and calendar_add writes there", async () => {
    const w = setup(['{"choice":"calendar_add","args":{"title":"Dentista","start":"2026-11-13T10:00:00","end":"2026-11-13T11:00:00"}}', '{"choice":"respond"}', "Listo."], [work, home]);
    await w.hermit.init();
    await w.hermit.calendars.choose("w");
    expect(await w.hermit.settings.get("calendar.id")).toBe("w");
    expect((await w.hermit.calendars.choice()).selectedId).toBe("w");

    const s = await w.hermit.startSession();
    await w.hermit.send(s, "agenda el dentista mañana a las 10");
    expect(w.added.map((a) => [a.event.title, a.calendarId])).toEqual([["Dentista", "w"]]);
  });

  test("with no choice, calendar_add leaves the target to the adapter's fallback", async () => {
    const w = setup(['{"choice":"calendar_add","args":{"title":"Dentista","start":"2026-11-13T10:00:00","end":"2026-11-13T11:00:00"}}', '{"choice":"respond"}', "Listo."], [work, home]);
    await w.hermit.init();
    const s = await w.hermit.startSession();
    await w.hermit.send(s, "agenda el dentista mañana a las 10");
    expect(w.added.map((a) => a.calendarId)).toEqual([undefined]);
  });

  test("a read-only or unknown calendar can't be chosen", async () => {
    const w = setup([], [work, holidays]);
    await w.hermit.init();
    await expect(w.hermit.calendars.choose("x")).rejects.toThrow();
    await expect(w.hermit.calendars.choose("nope")).rejects.toThrow();
    expect(await w.hermit.settings.get("calendar.id")).toBeUndefined();
  });

  test("a stored calendar that was deleted is flagged and writes fall back", async () => {
    const w = setup([], [work, home]);
    await w.hermit.init();
    await w.hermit.settings.set("calendar.id", "deleted");
    expect(await w.hermit.calendars.choice()).toMatchObject({ selectedId: "h", chosenGone: true });
  });
});
