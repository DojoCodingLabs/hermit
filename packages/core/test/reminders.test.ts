import { beforeEach, describe, expect, test } from "vitest";
import { nodeSql } from "@hermit/sql-node";
import { migrate } from "../src/schema.ts";
import { createReminders, ReminderError, type Reminders } from "../src/reminders.ts";
import type { NotifierPort } from "../src/ports.ts";

const NOW = Date.UTC(2026, 10, 12, 0, 0); // 2026-11-11 18:00 in Costa Rica
let reminders: Reminders;
let scheduled: Array<{ id: string; at: number; title: string }>;
let cancelled: string[];
let failNext = false;

beforeEach(async () => {
  const sql = nodeSql();
  await migrate(sql);
  scheduled = [];
  cancelled = [];
  failNext = false;
  const notifier: NotifierPort = {
    async schedule(n) {
      if (failNext) throw new Error("alarm permission missing");
      scheduled.push(n);
      return `n-${n.id}`;
    },
    async cancel(id) {
      cancelled.push(id);
    },
  };
  reminders = createReminders(sql, notifier, { timeZone: "America/Costa_Rica", now: () => NOW });
});

describe("reminders (FR-REM-01, FR-REM-02)", () => {
  test("schedules a local alarm at the right instant", async () => {
    const r = await reminders.schedule("Call Mom", "2026-11-11T21:00");
    expect(r.state).toBe("pending");
    expect(r.at).toBe(Date.UTC(2026, 10, 12, 3, 0));
    expect(scheduled).toEqual([{ id: String(r.id), at: r.at, title: "Call Mom" }]);
  });

  test("a past year from the model is repaired to the next matching date", async () => {
    const r = await reminders.schedule("Comprar pan", "2024-11-12T07:00");
    expect(r.at).toBe(Date.UTC(2026, 10, 12, 13, 0)); // 07:00 Costa Rica tomorrow
    const later = await reminders.schedule("Año nuevo", "2025-01-01T09:00");
    expect(new Date(later.at).getUTCFullYear()).toBe(2027);
  });

  test("refuses the past, more than a year ahead, nonsense and empty text", async () => {
    await expect(reminders.schedule("x", "2026-11-11T17:00")).rejects.toMatchObject({ code: "in_past" });
    await expect(reminders.schedule("x", "2026-11-11T17:00")).rejects.toThrow("It is now Wednesday, November 11, 2026, 18:00 (today);");
    await expect(reminders.schedule("x", "2028-01-01T09:00")).rejects.toMatchObject({ code: "too_far" });
    await expect(reminders.schedule("x", "tonight")).rejects.toMatchObject({ code: "bad_time" });
    await expect(reminders.schedule("   ", "2026-11-11T21:00")).rejects.toMatchObject({ code: "empty" });
    expect(scheduled).toEqual([]);
  });

  test("if the alarm can't be set, no reminder is saved", async () => {
    failNext = true;
    await expect(reminders.schedule("Call Mom", "2026-11-11T21:00")).rejects.toThrow(/alarm/);
    expect(await reminders.pending()).toEqual([]);
  });

  test("follows the lifecycle and nothing else", async () => {
    const r = await reminders.schedule("Call Mom", "2026-11-11T21:00");
    await reminders.transition(r.id, "fired");
    await reminders.transition(r.id, "done");
    await expect(reminders.transition(r.id, "pending")).rejects.toBeInstanceOf(ReminderError);
  });

  test("cancelling removes the alarm", async () => {
    const r = await reminders.schedule("Call Mom", "2026-11-11T21:00");
    await reminders.cancel(r.id);
    expect(cancelled).toEqual([`n-${r.id}`]);
    expect(await reminders.pending()).toEqual([]);
  });
});
