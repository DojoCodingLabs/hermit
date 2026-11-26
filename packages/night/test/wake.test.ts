import { describe, expect, test } from "vitest";
import {
  CLOSE_GRACE_MINUTES, inAppWakeDue, nightBackgroundView, nightWakePlan, NIGHT_WAKE_PERIOD_MINUTES, scheduleAction, wakeGateOpen,
  type BackgroundStatus, type NightWakePlan,
} from "../src/index.ts";
import { settings } from "./helpers.ts";

const status = (over: Partial<BackgroundStatus> = {}): BackgroundStatus => ({
  supported: true, scheduled: true, ignoringBatteryOptimizations: true, notificationsAllowed: true, ...over,
});

describe("the night window as a WorkManager schedule (Q69)", () => {
  test("off, or a setting that isn't valid, schedules nothing", () => {
    expect(nightWakePlan(settings({ enabled: false }))).toBeUndefined();
    expect(nightWakePlan(settings({ window: { start: "02:00", end: "02:00" } }))).toBeUndefined();
    expect(nightWakePlan(settings({ jobs: [] }))).toBeUndefined();
  });

  test("a periodic wake at WorkManager's floor, gated to the window plus a grace to close the night", () => {
    const plan = nightWakePlan(settings({ window: { start: "01:00", end: "06:00" }, briefingAt: "07:00" }))!;
    expect(plan).toEqual({ periodMinutes: NIGHT_WAKE_PERIOD_MINUTES, startMinute: 60, endMinute: 6 * 60 + CLOSE_GRACE_MINUTES });
    expect(NIGHT_WAKE_PERIOD_MINUTES).toBe(15);
  });

  test("a window across midnight wraps, and the grace never makes the gate the whole day", () => {
    expect(nightWakePlan(settings({ window: { start: "23:00", end: "05:00" }, briefingAt: "07:00" }))).toMatchObject({ startMinute: 23 * 60, endMinute: 5 * 60 + CLOSE_GRACE_MINUTES });
    // 23:30 to 23:00 leaves 30 minutes outside the window: the grace shrinks so at least one minute stays closed.
    const tight = nightWakePlan(settings({ window: { start: "23:30", end: "23:00" }, briefingAt: "23:10" }))!;
    expect(tight.endMinute).toBe(23 * 60 + 29);
    expect(wakeGateOpen(23 * 60 + 29, tight)).toBe(false);
    expect(wakeGateOpen(23 * 60 + 28, tight)).toBe(true);
    // The grace wraps past midnight too.
    expect(nightWakePlan(settings({ window: { start: "20:00", end: "23:30" }, briefingAt: "07:00" }))).toMatchObject({ endMinute: 30 });
  });

  test("the gate the worker checks before booting JavaScript (mirrored in NightWakeWorker.kt)", () => {
    const plan: NightWakePlan = { periodMinutes: 15, startMinute: 60, endMinute: 420 };
    expect(wakeGateOpen(59, plan)).toBe(false);
    expect(wakeGateOpen(60, plan)).toBe(true);
    expect(wakeGateOpen(419, plan)).toBe(true);
    expect(wakeGateOpen(420, plan)).toBe(false);
    const wraps: NightWakePlan = { periodMinutes: 15, startMinute: 23 * 60, endMinute: 6 * 60 };
    expect(wakeGateOpen(23 * 60 + 30, wraps)).toBe(true);
    expect(wakeGateOpen(2 * 60, wraps)).toBe(true);
    expect(wakeGateOpen(12 * 60, wraps)).toBe(false);
  });
});

describe("reschedule decisions", () => {
  const plan = nightWakePlan(settings())!;

  test("turned on, or the window changed: enqueue; same plan already scheduled: nothing", () => {
    expect(scheduleAction(plan, { scheduled: false })).toEqual({ kind: "enqueue", plan });
    expect(scheduleAction(plan, { scheduled: true, plan })).toEqual({ kind: "none" });
    expect(scheduleAction(plan, { scheduled: true, plan: { ...plan, startMinute: 0 } })).toEqual({ kind: "enqueue", plan });
    // Scheduled natively but the stored plan is unreadable: enqueue again (UPDATE keeps one unique work).
    expect(scheduleAction(plan, { scheduled: true })).toEqual({ kind: "enqueue", plan });
  });

  test("turned off: cancel once; already off: nothing", () => {
    expect(scheduleAction(undefined, { scheduled: true, plan })).toEqual({ kind: "cancel" });
    expect(scheduleAction(undefined, { scheduled: false })).toEqual({ kind: "none" });
  });
});

describe("the in-app timer is only a fallback", () => {
  test("it wakes while the app is alive only when background scheduling isn't active", () => {
    expect(inAppWakeDue(undefined, 1_000, "active")).toBe(false);
    expect(inAppWakeDue(undefined, 1_000, "limited")).toBe(true);
    expect(inAppWakeDue(undefined, 1_000, "blocked")).toBe(true);
    expect(inAppWakeDue(undefined, 1_000, "unsupported")).toBe(true);
    expect(inAppWakeDue(1_000, 1_000 + 14 * 60_000, "blocked")).toBe(false);
    expect(inAppWakeDue(1_000, 1_000 + 15 * 60_000, "blocked")).toBe(true);
    expect(inAppWakeDue(undefined, 1_000, "off")).toBe(false);
  });
});

describe("HM-NIGHT-01 background line", () => {
  const now = Date.UTC(2026, 10, 14, 12);

  test("off while the night shift is off", () => {
    expect(nightBackgroundView(false, status())).toMatchObject({ state: "off", lineKey: "HM-NIGHT-01.background.off" });
    expect(nightBackgroundView(false, status()).batteryActionKey).toBeUndefined();
  });

  test("no native scheduler (an old build): it runs only while Hermit is open", () => {
    expect(nightBackgroundView(true, undefined)).toMatchObject({ state: "unsupported", lineKey: "HM-NIGHT-01.background.unsupported" });
    expect(nightBackgroundView(true, status({ supported: false })).state).toBe("unsupported");
  });

  test("on and not limited by the system: active, no action offered", () => {
    const v = nightBackgroundView(true, status());
    expect(v).toMatchObject({ state: "active", lineKey: "HM-NIGHT-01.background.active" });
    expect(v.batteryActionKey).toBeUndefined();
  });

  test("not scheduled yet: pending until saved", () => {
    expect(nightBackgroundView(true, status({ scheduled: false }))).toMatchObject({ state: "pending", lineKey: "HM-NIGHT-01.background.pending" });
  });

  test("battery optimization on: a clear line and an offer to open the settings, never required", () => {
    const v = nightBackgroundView(true, status({ ignoringBatteryOptimizations: false }));
    expect(v).toMatchObject({ state: "limited", lineKey: "HM-NIGHT-01.background.limited", batteryActionKey: "HM-NIGHT-01.background.openBattery", optionalKey: "HM-NIGHT-01.background.optional" });
  });

  test("Android refused the last wake: blocked, said plainly, with the same optional offer", () => {
    const v = nightBackgroundView(true, status({ ignoringBatteryOptimizations: false, lastBlockedAt: now - 3_600_000, lastStartedAt: now - 7 * 86_400_000 }));
    expect(v).toMatchObject({ state: "blocked", lineKey: "HM-NIGHT-01.background.blocked", batteryActionKey: "HM-NIGHT-01.background.openBattery" });
    // A refusal older than the last good start is history, not the current state.
    expect(nightBackgroundView(true, status({ ignoringBatteryOptimizations: false, lastBlockedAt: now - 7_200_000, lastStartedAt: now - 3_600_000 })).state).toBe("limited");
    // The user then turned optimization off: active again.
    expect(nightBackgroundView(true, status({ lastBlockedAt: now - 3_600_000 })).state).toBe("active");
  });

  test("notifications off: the ongoing notice can't show, said as a note", () => {
    expect(nightBackgroundView(true, status({ notificationsAllowed: false })).noteKey).toBe("HM-NIGHT-01.background.noNotifications");
    expect(nightBackgroundView(true, status()).noteKey).toBeUndefined();
  });
});
