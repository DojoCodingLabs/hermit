import type { SettingKey } from "./hermit.ts";

/**
 * HM-SET-06 (US-SET-06, US-CHAT-08): quiet mode and motion. Quiet mode is the user's switch: it hides the
 * mascot everywhere and turns off motion; the text beside the mascot always stays. The phone's "remove
 * animations" setting turns off motion on its own but keeps the mascot, whose pose then changes without
 * animation (Q52, the reduced motion rule in the states spec).
 */
export const QUIET_SETTING = "appearance.quiet" satisfies SettingKey;

export interface Appearance {
  /** The user's switch on HM-SET-06. */
  quiet: boolean;
  showMascot: boolean;
  /** Pulses, slides and fades. Off in quiet mode and whenever the phone removes animations. */
  motion: boolean;
  /** The phone's own setting, so HM-SET-06 can say why motion is off with quiet mode off. */
  systemReduceMotion: boolean;
}

/** `quiet` is the stored value: "1" is on; absent or anything else is off, so a bad value never hides the mascot. */
export function appearance(input: { quiet: string | undefined; systemReduceMotion: boolean }): Appearance {
  const quiet = input.quiet === "1";
  return { quiet, showMascot: !quiet, motion: !quiet && !input.systemReduceMotion, systemReduceMotion: input.systemReduceMotion };
}

export function quietSettingValue(on: boolean): "1" | "0" {
  return on ? "1" : "0";
}
