/**
 * The device guards (FR-NIGHT-01, NFR-04, US-NIGHT-04). Checked before every job and between its steps; any
 * blocker pauses the night shift, and it resumes on a later wake when every guard is clear again.
 */
export interface DeviceState {
  charging: boolean;
  /** 0 to 100. */
  batteryPercent: number;
  /** Android PowerManager THERMAL_STATUS_* (0 none, 1 light, 2 moderate, 3 severe, 4 critical, 5 emergency, 6 shutdown). */
  thermalStatus: number;
  screenOn: boolean;
  network: "wifi" | "cellular" | "none";
}

export type PauseReason = "hot" | "battery_low" | "not_charging" | "screen_on" | "no_wifi";

/** NFR-04: below 30% the night shift pauses. */
export const BATTERY_FLOOR_PERCENT = 30;
/**
 * NFR-04 says "above the platform's moderate thermal status". Built conservatively: moderate itself already
 * pauses (Q65), so a phone that is getting warm is never pushed into severe by Hermit.
 */
export const THERMAL_PAUSE_STATUS = 2;

/** What the app reports when it can't read the phone: every guard fails closed. */
export const UNKNOWN_DEVICE: DeviceState = Object.freeze({ charging: false, batteryPercent: Number.NaN, thermalStatus: Number.NaN, screenOn: true, network: "none" as const });

/**
 * Every reason the night shift can't run now, most important first (heat). A reading that isn't a number
 * counts as a blocker. `manual` is the debug "run now" on HM-NIGHT-01: the screen is on because the user just
 * tapped, so only that check is skipped; heat, battery and the charger still apply.
 */
export function blockers(state: DeviceState, opts: { needsNetwork: boolean; manual?: boolean }): PauseReason[] {
  const out: PauseReason[] = [];
  if (!Number.isFinite(state.thermalStatus) || state.thermalStatus >= THERMAL_PAUSE_STATUS) out.push("hot");
  if (!Number.isFinite(state.batteryPercent) || state.batteryPercent < BATTERY_FLOOR_PERCENT) out.push("battery_low");
  if (!state.charging) out.push("not_charging");
  if (state.screenOn && !opts.manual) out.push("screen_on");
  if (opts.needsNetwork && state.network !== "wifi") out.push("no_wifi");
  return out;
}
