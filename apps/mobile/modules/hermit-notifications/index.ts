import { NativeModule, requireNativeModule } from "expo";
import type { CapturedNotification } from "@hermit/core";

type Events = { onCapture(event: CapturedNotification): void };

declare class HermitNotificationsNative extends NativeModule<Events> {
  isEnabled(): boolean;
  openSettings(): void;
  drainQueue(): Promise<CapturedNotification[]>;
  reply(handle: string, text: string): Promise<"sent" | "stale">;
  sha256File(uri: string): Promise<string>;
  hardwareFacts(): Promise<{
    clusters: Array<{ cpus: number[]; maxFreqKHz: number }>;
    logicalCores: number;
    /** The cores this process may run on when read (Android's cpuset); empty when unreadable, absent on older builds. */
    allowedCpus?: number[];
    totalRamBytes: number;
    isLowRamDevice: boolean;
    soc: string;
    model: string;
    dotprod: boolean;
    i8mm: boolean;
    sve2: boolean;
    sme2: boolean;
    /** iOS only: performance cores (hw.perflevel0.physicalcpu). */
    performanceCores?: number;
  }>;
  /**
   * The cores this process may run on right now (Cpus_allowed_list: the cpuset with the affinity mask) and the cpuset's
   * path ("/foreground", "/top-app", "/background"). Cheap, read at each call. Empty and "" when unreadable; missing on
   * builds before 2026-11-24 (the call throws).
   */
  allowedCpus(): { cpus: number[]; cpuset: string };
  /**
   * The Device lab: Build.SOC_MANUFACTURER and Build.SOC_MODEL (Android 12 and later), the Hardware line of /proc/cpuinfo
   * and Build.HARDWARE; "" for what isn't there. Missing on builds before the Device lab (the call throws).
   */
  chipFacts(): { socManufacturer: string; socModel: string; cpuinfoHardware: string; hardware: string };
  /** The Device lab keeps the screen on while it runs (a window flag). False without an activity. */
  keepScreenOn(on: boolean): Promise<boolean>;
  /** status: Android THERMAL_STATUS_* (0 none to 6 shutdown); headroom: NaN when unsupported. */
  thermal(): { status: number; headroom: number; powerSave: boolean };
  /** SL-24: charging, battery level (0 to 100, negative when unsupported) and whether the screen is on. */
  power(): { charging: boolean; batteryPercent: number; screenOn: boolean };
}

/** The WhatsApp notification listener (SL-06, SL-12). Android only. */
export const HermitNotifications = requireNativeModule<HermitNotificationsNative>("HermitNotifications");
