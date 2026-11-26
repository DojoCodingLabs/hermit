// SL-24 and Q69: how the night shift gets woken. Every rule (window, guards, unattended cage, resume, the run
// lock) lives in @hermit/night and @hermit/runtime and is tested there. Two wakers reach it:
// - WorkManager, while the phone charges, starts a foreground service that runs the headless task
//   (../night-task.ts, registered in index.ts). This works with Hermit closed.
// - This in-app timer, a fallback only while the app is alive and background scheduling isn't active.
// The run lock in the database keeps them, and the debug "run now", to one pass at a time.
// SL-26: "Delete everything" raises a process-wide flag first; a pass in flight stops before its next write,
// no new pass starts, and the erase waits for it and removes the schedule, the service and its preferences.
import type { Hermit } from "@hermit/runtime";
import { inAppWakeDue, IN_APP_WAKE_MS, nightBackgroundView, nightWakePlan, scheduleAction, type BackgroundStatus } from "@hermit/night";
import { HermitNight } from "../../modules/hermit-night";
import { t } from "../i18n";
import { nightConditions } from "./device";

let timer: ReturnType<typeof setInterval> | undefined;
let lastWake: number | undefined;
let running: ReturnType<Hermit["night"]["run"]> | undefined;
let live: Hermit | undefined;
let erasing = false;

/** Whether an erase began in this process (the headless task checks it before its own writes). */
export function nightErasing(): boolean {
  return erasing;
}

/** SL-26: set when "Delete everything" starts (or resumes); a night pass checks it before every write. */
export function beginNightErase(): void {
  erasing = true;
}

/**
 * The erase's night step: no new pass, the pass in flight aborted and waited for, then the native schedule
 * cancelled, the service stopped and the native preferences deleted.
 */
export async function stopNightShiftForErase(): Promise<void> {
  erasing = true;
  if (timer) clearInterval(timer);
  timer = undefined;
  await running?.catch(() => {});
  HermitNight?.stopAll();
}

/** The runtime the app opened in this JavaScript context, if any (the headless task reuses it). */
export function liveHermit(): Hermit | undefined {
  return live;
}

/** One wake now (the debug "run now" passes manual: it skips the window and the screen check only). */
export function wakeNightShift(hermit: Hermit, opts: { manual?: boolean } = {}): ReturnType<Hermit["night"]["run"]> {
  if (erasing) return Promise.resolve(undefined);
  running ??= hermit.night
    .run({ conditions: nightConditions, noticeTitle: t("HM-NIGHT-02.notice"), aborted: () => erasing, ...(opts.manual ? { manual: true } : {}) })
    .finally(() => {
      running = undefined;
    });
  return running;
}

/** What the native scheduler reports, or undefined when this build has none or it can't be read. */
export function backgroundStatus(): BackgroundStatus | undefined {
  if (!HermitNight) return undefined;
  try {
    const s = HermitNight.status();
    return {
      supported: true,
      scheduled: s.scheduled,
      ignoringBatteryOptimizations: s.ignoringBatteryOptimizations,
      notificationsAllowed: s.notificationsAllowed,
      ...(s.lastStartedAt ? { lastStartedAt: s.lastStartedAt } : {}),
      ...(s.lastBlockedAt ? { lastBlockedAt: s.lastBlockedAt } : {}),
    };
  } catch {
    return undefined;
  }
}

/** Brings the native schedule in line with the saved settings (after a save, at launch, after a headless pass). */
export async function syncNightSchedule(hermit: Hermit): Promise<void> {
  if (!HermitNight || erasing) return;
  const desired = nightWakePlan(await hermit.night.settings());
  const s = HermitNight.status();
  const stored = s.periodMinutes > 0 && s.startMinute >= 0 && s.endMinute >= 0 ? { plan: { periodMinutes: s.periodMinutes, startMinute: s.startMinute, endMinute: s.endMinute } } : {};
  const title = t("HM-NIGHT-01.background.notifyTitle");
  let action = scheduleAction(desired, { scheduled: s.scheduled, ...stored });
  // The ongoing notice follows the app's language: a changed language re-stores the same plan with new copy.
  if (action.kind === "none" && desired && s.title !== title) action = { kind: "enqueue", plan: desired };
  if (action.kind === "enqueue") HermitNight.schedule(action.plan.startMinute, action.plan.endMinute, action.plan.periodMinutes, title, t("HM-NIGHT-01.background.notifyText"));
  else if (action.kind === "cancel") HermitNight.cancel();
}

/** Opens Android's battery optimization list. Offered on HM-NIGHT-01, never required. */
export function openBatterySettings(): boolean {
  try {
    return HermitNight?.openBatterySettings() ?? false;
  } catch {
    return false;
  }
}

const warn = (err: unknown) => console.warn("[hermit] night shift wake failed:", err instanceof Error ? err.message : String(err));

export function startNightScheduler(hermit: Hermit): () => void {
  live = hermit;
  void syncNightSchedule(hermit).catch(warn);
  timer ??= setInterval(() => {
    void (async () => {
      const now = Date.now();
      const state = nightBackgroundView((await hermit.night.settings()).enabled, backgroundStatus()).state;
      if (!inAppWakeDue(lastWake, now, state)) return;
      lastWake = now;
      await wakeNightShift(hermit);
    })().catch(warn);
  }, IN_APP_WAKE_MS);
  return () => {
    if (timer) clearInterval(timer);
    timer = undefined;
    live = undefined;
  };
}
