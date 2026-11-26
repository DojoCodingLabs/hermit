// HM-SET-06: quiet mode and motion for every screen. The rule is `appearance` in @hermit/runtime; this file
// only feeds it the stored switch (ENT-Setting `appearance.quiet`) and the phone's "remove animations" setting.
import { useEffect, useSyncExternalStore } from "react";
import { AccessibilityInfo } from "react-native";
import { QUIET_SETTING, appearance, quietSettingValue, type Appearance, type Hermit } from "@hermit/runtime";
import { useHermit } from "./hermit-context";

let stored: string | undefined;
let systemReduceMotion = false;
// Until the switch is read, the mascot waits: a quiet-mode user never sees it flash in. The text is already there.
let loaded = false;
let loadedFrom: Hermit | undefined;
let watching = false;
let current: Appearance = snapshot();
const listeners = new Set<() => void>();

function snapshot(): Appearance {
  const a = appearance({ quiet: stored, systemReduceMotion });
  return loaded ? a : { ...a, showMascot: false };
}

function publish() {
  current = snapshot();
  for (const l of listeners) l();
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

function watchSystem() {
  if (watching) return;
  watching = true;
  const set = (on: boolean) => {
    systemReduceMotion = on;
    publish();
  };
  void AccessibilityInfo.isReduceMotionEnabled().then(set, () => {});
  AccessibilityInfo.addEventListener("reduceMotionChanged", set);
}

export function useAppearance(): Appearance {
  const { status } = useHermit();
  useEffect(() => {
    watchSystem();
    if (status.kind === "not_wired" || status.kind === "failed") {
      // No settings to read (dev build or a failed start): the defaults hold and the mascot shows.
      if (!loaded) {
        loaded = true;
        publish();
      }
      return;
    }
    if (status.kind !== "ready" || loadedFrom === status.hermit) return;
    loadedFrom = status.hermit;
    status.hermit.settings.get(QUIET_SETTING).then(
      (v) => {
        stored = v;
        loaded = true;
        publish();
      },
      () => {
        loaded = true;
        publish();
      },
    );
  }, [status]);
  return useSyncExternalStore(subscribe, () => current);
}

/** Stores the switch first; screens change only once it is saved, so a failed save changes nothing. */
export async function setQuiet(hermit: Hermit, on: boolean): Promise<void> {
  const value = quietSettingValue(on);
  await hermit.settings.set(QUIET_SETTING, value);
  stored = value;
  loaded = true;
  publish();
}

/** For a component that can't call a hook where it decides (after an early return, like the approval sheet). */
export function motionNow(): boolean {
  return current.motion;
}
