import { validateNightSettings, type NightSettings } from "./settings.ts";

/*
 * Q69: the night shift is woken by WorkManager with a charging constraint, which starts a foreground service
 * that boots JavaScript headlessly for one pass. The native side stays thin: it gets a plan from here, checks
 * the gate below before booting anything, and leaves every rule (window, guards, cage, resume) to runNightShift.
 */

/** WorkManager's minimum period for periodic work. */
export const NIGHT_WAKE_PERIOD_MINUTES = 15;
/**
 * After the window ends the worker keeps waking for this long, so a night that was paused gets closed (its
 * jobs skipped with their reason) and the morning notice is scheduled without the app being opened.
 */
export const CLOSE_GRACE_MINUTES = 60;

const DAY = 24 * 60;

/** What the native scheduler stores: wake every `periodMinutes` while charging, boot JS only inside the gate. */
export interface NightWakePlan {
  periodMinutes: number;
  /** Local minutes since midnight, the gate is [startMinute, endMinute) and may cross midnight. */
  startMinute: number;
  endMinute: number;
}

const minutes = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

/** The schedule for these settings; undefined when nothing should be scheduled (off or invalid). */
export function nightWakePlan(s: NightSettings): NightWakePlan | undefined {
  if (!s.enabled || validateNightSettings(s).length) return undefined;
  const start = minutes(s.window.start);
  const end = minutes(s.window.end);
  // The time outside the window; the grace always leaves at least one minute of it closed.
  const outside = (start - end + DAY) % DAY;
  const grace = Math.max(0, Math.min(CLOSE_GRACE_MINUTES, outside - 1));
  return { periodMinutes: NIGHT_WAKE_PERIOD_MINUTES, startMinute: start, endMinute: (end + grace) % DAY };
}

/** Whether a wake at this local minute boots JavaScript. NightWakeWorker.kt has the same three lines. */
export function wakeGateOpen(localMinute: number, plan: NightWakePlan): boolean {
  const { startMinute: s, endMinute: e } = plan;
  if (s === e) return false;
  return s < e ? localMinute >= s && localMinute < e : localMinute >= s || localMinute < e;
}

export type ScheduleAction = { kind: "enqueue"; plan: NightWakePlan } | { kind: "cancel" } | { kind: "none" };

const samePlan = (a: NightWakePlan, b: NightWakePlan) => a.periodMinutes === b.periodMinutes && a.startMinute === b.startMinute && a.endMinute === b.endMinute;

/**
 * What to tell the native scheduler after the settings were saved or the app started. A reboot is handled
 * natively (the boot receiver re-enqueues the stored plan), since no JavaScript runs then.
 */
export function scheduleAction(desired: NightWakePlan | undefined, current: { scheduled: boolean; plan?: NightWakePlan }): ScheduleAction {
  if (!desired) return current.scheduled ? { kind: "cancel" } : { kind: "none" };
  if (current.scheduled && current.plan && samePlan(current.plan, desired)) return { kind: "none" };
  return { kind: "enqueue", plan: desired };
}

/** What the native module reports (HermitNight.status()). Times are epoch ms, absent when it never happened. */
export interface BackgroundStatus {
  /** The native scheduler is in this build. */
  supported: boolean;
  scheduled: boolean;
  /** The user turned battery optimization off for Hermit (Android's exemption for starting the service). */
  ignoringBatteryOptimizations: boolean;
  /** Android 13+: whether the ongoing "night shift" notification can show. */
  notificationsAllowed: boolean;
  /** The service started from a wake. */
  lastStartedAt?: number;
  /** Android refused to start the service from a wake (ForegroundServiceStartNotAllowedException). */
  lastBlockedAt?: number;
}

export type BackgroundState = "off" | "unsupported" | "pending" | "active" | "limited" | "blocked";

export interface NightBackgroundView {
  state: BackgroundState;
  lineKey: string;
  /** Offered, never required: opens Android's battery optimization list. */
  batteryActionKey?: "HM-NIGHT-01.background.openBattery";
  optionalKey?: "HM-NIGHT-01.background.optional";
  noteKey?: "HM-NIGHT-01.background.noNotifications";
}

/** HM-NIGHT-01's background line: whether the night shift can wake on its own, and what limits it. */
export function nightBackgroundView(enabled: boolean, status: BackgroundStatus | undefined): NightBackgroundView {
  const line = (state: BackgroundState): NightBackgroundView => ({ state, lineKey: `HM-NIGHT-01.background.${state}` });
  if (!enabled) return line("off");
  if (!status?.supported) return line("unsupported");
  const note = status.notificationsAllowed ? {} : { noteKey: "HM-NIGHT-01.background.noNotifications" as const };
  if (!status.scheduled) return { ...line("pending"), ...note };
  if (status.ignoringBatteryOptimizations) return { ...line("active"), ...note };
  const blocked = status.lastBlockedAt !== undefined && (status.lastStartedAt === undefined || status.lastBlockedAt > status.lastStartedAt);
  return {
    ...line(blocked ? "blocked" : "limited"),
    batteryActionKey: "HM-NIGHT-01.background.openBattery",
    optionalKey: "HM-NIGHT-01.background.optional",
    ...note,
  };
}

/** How often the in-app timer wakes the night shift while the app is alive. */
export const IN_APP_WAKE_MS = NIGHT_WAKE_PERIOD_MINUTES * 60_000;

/**
 * The in-app timer is a fallback: it wakes only while the app is alive and background scheduling isn't
 * doing the job, at most once per interval. The run lock still guarantees one run at a time either way.
 */
export function inAppWakeDue(lastWake: number | undefined, now: number, background: BackgroundState): boolean {
  if (background === "off" || background === "active") return false;
  return lastWake === undefined || now - lastWake >= IN_APP_WAKE_MS;
}
