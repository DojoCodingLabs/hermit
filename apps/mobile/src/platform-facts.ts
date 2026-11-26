// What the runtime plan and the floor check read about the platform, from the native module's raw facts. Pure: tested
// under Node with node --test (platform-facts.test.ts).
import type { PhoneFacts } from "@hermit/eval";
import type { HardwareFacts } from "@hermit/model";

export interface NativeHardwareFacts {
  clusters: Array<{ cpus: number[]; maxFreqKHz: number }>;
  logicalCores: number;
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
}

export interface NativeThermal {
  status: number;
  headroom: number;
  powerSave: boolean;
}

/** The runtime's platform for this OS (React Native's Platform.OS). */
export function hardwarePlatform(os: string): "android" | "ios" {
  return os === "ios" ? "ios" : "android";
}

/** The runtime's hardware facts. `allowed` is Android's cpuset, already checked; iOS has none. */
export function hardwareFactsFor(os: string, h: NativeHardwareFacts, allowed: number[] | undefined): HardwareFacts {
  const platform = hardwarePlatform(os);
  return {
    platform,
    model: h.model,
    soc: h.soc,
    totalRamBytes: h.totalRamBytes,
    isLowRamDevice: h.isLowRamDevice,
    clusters: h.clusters,
    logicalCores: h.logicalCores,
    ...(platform === "android" && allowed ? { allowedCpus: allowed } : {}),
    ...(platform === "ios" && h.performanceCores !== undefined ? { performanceCores: h.performanceCores } : {}),
    cpuFeatures: { dotprod: h.dotprod, i8mm: h.i8mm, sve2: h.sve2, sme2: h.sme2 },
  };
}

/**
 * iOS ProcessInfo.ThermalState (nominal 0, fair 1, serious 2, critical 3) on Android's THERMAL_STATUS_* scale, which the
 * runtime and the Device lab read (pause at 3 or more, resume at 1 or less): nominal 0, fair 1, serious 3, critical 4.
 * An unknown state is NaN, never cool.
 */
const IOS_THERMAL: readonly number[] = [0, 1, 3, 4];

export function thermalFromNative(os: string, t: NativeThermal): NativeThermal {
  if (hardwarePlatform(os) !== "ios") return t;
  const status = Number.isInteger(t.status) && t.status >= 0 && t.status < IOS_THERMAL.length ? IOS_THERMAL[t.status]! : Number.NaN;
  return { ...t, status };
}

/**
 * The Device lab's facts on an iPhone, from what the app already reads: expo-device's maker, model name and iOS
 * version, and the native module's model identifier (hw.machine), memory, cores and CPU features. Nothing Android-only:
 * iOS has no chip name, API level, ABI, low-memory flag, clocks or cpusets to give.
 */
export function iosLabFacts(d: { manufacturer?: string | null; modelName?: string | null; osVersion?: string | null }, h: NativeHardwareFacts, batterySaver: boolean): PhoneFacts {
  return {
    platform: "ios",
    manufacturer: d.manufacturer ?? "Apple",
    model: d.modelName ?? h.model,
    modelId: h.model,
    ...(d.osVersion ? { iosVersion: d.osVersion } : {}),
    totalRamBytes: h.totalRamBytes,
    logicalCores: h.logicalCores,
    cpuFeatures: { dotprod: h.dotprod, i8mm: h.i8mm, sve2: h.sve2, sme2: h.sme2 },
    batterySaver,
  };
}

/** A byte count from native code as a plain number. On iOS, expo-file-system returns 64-bit sizes as BigInt. */
export function byteCount(n: number | bigint): number {
  return Number(n);
}
