/**
 * US-SET-09: the optional app lock. Pure timing rules; the app feeds it AppState changes and the
 * fingerprint prompts it opens, and renders the lock screen when `locked`.
 *
 * - On open: locked when the lock is on.
 * - After the app was away (phone locked, another app) for at least the grace period: locked again.
 *   A quick trip to another app or to a settings page Hermit opened does not lock.
 * - Hermit's own fingerprint prompts (an approval, the unlock itself) can send the app to the background
 *   on some phones; a short time away (under PROMPT_GRACE_MS) while a prompt is open doesn't lock, so an
 *   approval is not interrupted. Longer, the prompt doesn't matter: leaving during a prompt still locks.
 * - While locked, an open approval sheet is hidden, not denied: it stays pending (and can expire on its
 *   own, ST-EXPIRED), and shows again after the unlock.
 */
export const LOCK_GRACE_MS = 60_000;

/** How long a trip away during Hermit's own fingerprint prompt is put down to the prompt, not to the user leaving. */
export const PROMPT_GRACE_MS = 15_000;

export interface LockState {
  enabled: boolean;
  locked: boolean;
  /** When the app first left the screen since it was last seen, if it has. */
  hiddenAt?: number;
  /** Hermit's own fingerprint prompts currently open. */
  prompts: number;
}

export type LockEvent =
  | { type: "background"; at: number }
  | { type: "foreground"; at: number }
  | { type: "prompt_open" }
  | { type: "prompt_close" }
  | { type: "unlocked" }
  | { type: "enable" }
  | { type: "disable" };

export function initialLock(enabled: boolean): LockState {
  return { enabled, locked: enabled, prompts: 0 };
}

/** The state with no time away recorded (the app is on screen again). */
function seen(s: LockState): LockState {
  const next = { ...s };
  delete next.hiddenAt;
  return next;
}

/**
 * Time away is measured on the wall clock (Android gives JS no monotonic clock that runs while the app sleeps), so a
 * clock set backwards would read as a negative absence: that locks too, failing closed, as does anything not a number.
 */
export function lockedAfter(awayMs: number, graceMs: number): boolean {
  return !(awayMs >= 0 && awayMs < graceMs);
}

export function lockReducer(s: LockState, e: LockEvent, graceMs: number = LOCK_GRACE_MS): LockState {
  switch (e.type) {
    case "background":
      if (!s.enabled || s.hiddenAt !== undefined) return s;
      return { ...s, hiddenAt: e.at };
    case "foreground":
      if (s.hiddenAt === undefined) return s;
    {
      // Away briefly during Hermit's own prompt: the prompt caused it, so it doesn't lock. Past PROMPT_GRACE_MS
      // (or a negative time) it is a real absence, prompt open or not, and locks like any other.
      const grace = s.prompts > 0 ? Math.min(graceMs, PROMPT_GRACE_MS) : graceMs;
      return { ...seen(s), locked: s.locked || (s.enabled && lockedAfter(e.at - s.hiddenAt, grace)) };
    }
    case "prompt_open":
      return { ...s, prompts: s.prompts + 1 };
    case "prompt_close":
      // The time away is kept: if the phone cancelled the prompt because the user left the app,
      // the return still counts that absence (a prompt's own trip away is seconds, under the grace).
      return { ...s, prompts: Math.max(0, s.prompts - 1) };
    case "unlocked":
      return { ...seen(s), locked: false };
    case "enable":
      return { ...s, enabled: true, locked: false };
    case "disable":
      return { ...seen(s), enabled: false, locked: false };
  }
}

/** The approval sheet renders only while unlocked; a locked app keeps the request pending underneath. */
export function showApprovals(s: LockState): boolean {
  return !s.locked;
}
