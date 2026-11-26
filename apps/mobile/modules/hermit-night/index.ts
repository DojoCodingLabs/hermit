import { NativeModule, requireOptionalNativeModule } from "expo";

/** What HermitNightModule.status() returns. Times are epoch ms, null when it never happened. */
export interface NativeNightStatus {
  scheduled: boolean;
  startMinute: number;
  endMinute: number;
  periodMinutes: number;
  title: string | null;
  ignoringBatteryOptimizations: boolean;
  notificationsAllowed: boolean;
  lastWakeAt: number | null;
  lastStartedAt: number | null;
  lastBlockedAt: number | null;
  lastFallbackAt: number | null;
}

declare class HermitNightNative extends NativeModule {
  schedule(startMinute: number, endMinute: number, periodMinutes: number, title: string, text: string): void;
  cancel(): void;
  /** SL-26: cancels the schedule, stops the service and deletes the native preferences. */
  stopAll(): boolean;
  status(): NativeNightStatus;
  openBatterySettings(): boolean;
}

/** Q69: the WorkManager wake and its foreground service. Android only; undefined in a build without it. */
export const HermitNight = requireOptionalNativeModule<HermitNightNative>("HermitNight") ?? undefined;
