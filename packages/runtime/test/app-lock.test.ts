import { describe, expect, test } from "vitest";
import { initialLock, LOCK_GRACE_MS, lockedAfter, PROMPT_GRACE_MS, lockReducer, showApprovals, type LockEvent, type LockState } from "../src/app-lock.ts";

const run = (events: LockEvent[], from: LockState) => events.reduce((s, e) => lockReducer(s, e), from);

describe("app lock (US-SET-09)", () => {
  test("locked on open when the lock is on, open when it is off", () => {
    expect(initialLock(true).locked).toBe(true);
    expect(initialLock(false).locked).toBe(false);
  });

  test("a biometric unlock opens it", () => {
    expect(run([{ type: "unlocked" }], initialLock(true)).locked).toBe(false);
  });

  test("locks again after the phone was away longer than the grace period", () => {
    const s = run([{ type: "unlocked" }, { type: "background", at: 1_000 }, { type: "foreground", at: 1_000 + LOCK_GRACE_MS }], initialLock(true));
    expect(s.locked).toBe(true);
  });

  test("a quick switch to another app (or to a settings page) does not lock", () => {
    const s = run([{ type: "unlocked" }, { type: "background", at: 1_000 }, { type: "foreground", at: 1_000 + LOCK_GRACE_MS - 1 }], initialLock(true));
    expect(s.locked).toBe(false);
  });

  test("the time away counts from the first time the app left the screen", () => {
    const s = run([
      { type: "unlocked" },
      { type: "background", at: 0 },
      { type: "background", at: LOCK_GRACE_MS - 10 },
      { type: "foreground", at: LOCK_GRACE_MS },
    ], initialLock(true));
    expect(s.locked).toBe(true);
  });

  test("never locks when the lock is off", () => {
    const s = run([{ type: "background", at: 0 }, { type: "foreground", at: 10 * LOCK_GRACE_MS }], initialLock(false));
    expect(s.locked).toBe(false);
  });

  test("Hermit's own fingerprint prompt (an approval) never locks the app behind itself", () => {
    const s = run([
      { type: "unlocked" },
      { type: "prompt_open" },
      { type: "background", at: 0 },
      { type: "foreground", at: PROMPT_GRACE_MS - 1 },
      { type: "prompt_close" },
    ], initialLock(true));
    expect(s.locked).toBe(false);
    // And the away time from the prompt does not carry over to the next real trip away.
    const after = run([{ type: "background", at: 3 * LOCK_GRACE_MS }, { type: "foreground", at: 3 * LOCK_GRACE_MS + 5 }], s);
    expect(after.locked).toBe(false);
  });

  test("leaving the app for real after the prompt closed still locks", () => {
    const s = run([
      { type: "unlocked" },
      { type: "prompt_open" },
      { type: "prompt_close" },
      { type: "background", at: 0 },
      { type: "foreground", at: LOCK_GRACE_MS },
    ], initialLock(true));
    expect(s.locked).toBe(true);
  });

  test("leaving the app while a prompt is open still locks on return when the phone cancelled the prompt", () => {
    const s = run([
      { type: "unlocked" },
      { type: "prompt_open" },
      { type: "background", at: 0 },
      { type: "prompt_close" },
      { type: "foreground", at: 10 * LOCK_GRACE_MS },
    ], initialLock(true));
    expect(s.locked).toBe(true);
  });

  // The prompt exemption covers only the seconds a prompt's own trip away takes: leaving the app during a
  // fingerprint prompt and coming back later must not skip the lock.
  const duringPrompt = (awayMs: number) =>
    run([
      { type: "unlocked" },
      { type: "prompt_open" },
      { type: "background", at: 1_000_000 },
      { type: "foreground", at: 1_000_000 + awayMs },
    ], initialLock(true));

  test("away 10 s during an open prompt stays open", () => {
    expect(duringPrompt(10_000).locked).toBe(false);
  });

  test("away 2 min during an open prompt locks, even with the prompt still open", () => {
    const s = duringPrompt(2 * 60_000);
    expect(s.prompts).toBe(1);
    expect(s.locked).toBe(true);
  });

  test("away past the prompt grace but under the normal grace, during a prompt, locks", () => {
    expect(PROMPT_GRACE_MS).toBeLessThan(LOCK_GRACE_MS);
    expect(duringPrompt(PROMPT_GRACE_MS).locked).toBe(true);
  });

  test("a negative time away during an open prompt (clock set backwards) locks", () => {
    expect(duringPrompt(-5_000).locked).toBe(true);
  });

  test("an extra prompt_close never makes the count negative", () => {
    const s = run([{ type: "prompt_close" }, { type: "prompt_close" }, { type: "prompt_open" }], initialLock(false));
    expect(s.prompts).toBe(1);
  });

  test("turning the lock on does not lock right away; turning it off unlocks", () => {
    const on = lockReducer(initialLock(false), { type: "enable" });
    expect(on).toMatchObject({ enabled: true, locked: false });
    expect(lockReducer(initialLock(true), { type: "disable" })).toMatchObject({ enabled: false, locked: false });
  });

  test("while locked, an open approval sheet is hidden, not denied; it returns after unlock", () => {
    const locked = run([{ type: "unlocked" }, { type: "background", at: 0 }, { type: "foreground", at: LOCK_GRACE_MS }], initialLock(true));
    expect(showApprovals(locked)).toBe(false);
    expect(showApprovals(lockReducer(locked, { type: "unlocked" }))).toBe(true);
  });
});

describe("lockedAfter: a clock set backwards fails closed", () => {
  test("locks on a negative absence, at or past the grace, and on anything not a number", () => {
    expect(lockedAfter(-1, 60_000)).toBe(true);
    expect(lockedAfter(60_000, 60_000)).toBe(true);
    expect(lockedAfter(Number.NaN, 60_000)).toBe(true);
    expect(lockedAfter(59_999, 60_000)).toBe(false);
    expect(lockedAfter(0, 60_000)).toBe(false);
  });
});
