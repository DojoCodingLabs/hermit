// Q69: the headless night pass. NightService (or, when Android refuses the foreground service, the WorkManager
// worker itself) boots JavaScript without a screen and runs this once. It opens the encrypted database and the
// runtime, runs one wake with the same guards as ever (heat, battery, charger, screen, Wi-Fi for mail) and
// returns, which ends the task and stops the service. Safe to run twice: the run lock in the database lets
// only one pass through, and a finished night isn't run again.
import { createHermit } from "@hermit/runtime";
import { PROFILES, profileForPlan } from "@hermit/model";
import { createPorts, devicePlan, liveHermit, nightErasing, releaseModel, setOutboundSink, syncNightSchedule, wakeNightShift } from "./adapters";
import { pendingErase } from "./adapters/erase";

/** Nobody is there to approve at night: anything that would ask is refused (the night shift never asks anyway). */
const noApprovals = { request: async () => ({ kind: "denied" as const }) };

export async function nightHeadlessTask(): Promise<void> {
  try {
    // The app is open in this JavaScript context: use its runtime, never a second one.
    const live = liveHermit();
    if (live) {
      await wakeNightShift(live);
      return;
    }
    // SL-26: an interrupted erase finishes in the app first; nothing opens the database before that. A pass
    // that is running when an erase starts stops before its next write (beginNightErase, the run's `aborted`).
    if (nightErasing() || (await pendingErase())) return;
    const ports = await createPorts(noApprovals);
    const plan = await devicePlan();
    const hermit = createHermit(ports, plan ? profileForPlan(PROFILES[0]!, plan) : PROFILES[0]!);
    // init migrates (a write): not once an erase began.
    if (nightErasing()) return;
    await hermit.init();
    // FR-PRIV-02: hosts reached at night (email, when it is on) count on the privacy screen too, until an erase.
    setOutboundSink((url) => (nightErasing() ? Promise.resolve() : hermit.hosts.record(url)));
    try {
      await wakeNightShift(hermit);
      // The settings may have changed (or been erased) since the plan was stored.
      await syncNightSchedule(hermit);
    } finally {
      // Free the model's memory unless the app opened in the meantime and may use it.
      if (!liveHermit()) await releaseModel();
    }
  } catch (err) {
    console.warn("[hermit] headless night pass failed:", err instanceof Error ? `${err.name}: ${err.message}` : String(err));
  }
}
