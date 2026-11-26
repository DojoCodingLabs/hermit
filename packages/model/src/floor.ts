/**
 * SL-43: the device floor check (US-ONB-06, NFR-05, PDR-025). Pure rules over what the phone says about
 * itself, run before the model download so a phone below the floor never spends data on a model it can't run.
 * A fact the phone couldn't read never blocks: "below the floor" needs evidence (Q103).
 */
export interface FloorFacts {
  platform: "android" | "ios";
  /** Build.VERSION.SDK_INT. */
  apiLevel?: number;
  /** Build.SUPPORTED_ABIS, e.g. ["arm64-v8a", "armeabi-v7a"]. */
  abis?: string[];
  /** ActivityManager.MemoryInfo.totalMem: what Android reports, below the marketed size. */
  totalRamBytes?: number;
  /** ActivityManager.isLowRamDevice (Android Go). */
  isLowRamDevice?: boolean;
  /** ARMv8.2 dot product (asimddp); without it BotPsy is too slow to be useful (PDR-025). */
  dotprod?: boolean;
  manufacturer?: string;
  model?: string;
  /** Build.SOC_MODEL. */
  soc?: string;
  /** Decode speed from the short calibration, once the model is on the phone. */
  measuredTokPerSec?: number;
}

/**
 * NFR-05: Android 13 or later, arm64, at least 8 GB. Android reports an 8 GB phone as 7.2 to 7.9 billion bytes
 * (kernel and modem carve-outs are not counted) and a 6 GB phone under 6, so 7.0 billion separates them (Q103).
 * Under `slowTokPerSec` replies are slow enough to warn about; the runtime already reads that speed as memory
 * pressure (pressureFromSpeed, the S26 decodes 40 to 50 tok/s when free).
 */
export const FLOOR = {
  minApiLevel: 33,
  androidVersion: 13,
  abi: "arm64-v8a",
  minRamBytes: 7_000_000_000,
  /** The marketed size the copy names. */
  marketedRamBytes: 8_000_000_000,
  slowTokPerSec: 10,
} as const;

/** Hard reasons first: no model can run (abi), or the app's floor (android_version). The rest are about speed. */
export type FloorReason = "abi" | "android_version" | "memory" | "low_ram_device" | "no_dotprod";
export type DegradedReason = "cpu_only" | "slow";

export type FloorVerdict =
  | { kind: "supported" }
  | { kind: "degraded"; reasons: DegradedReason[] }
  /** canOptIn: PDR-025 lets the user download anyway with a warning when the only reasons are about speed. */
  | { kind: "below_floor"; reasons: FloorReason[]; canOptIn: boolean };

const HARD: ReadonlySet<FloorReason> = new Set(["abi", "android_version"]);

/** QVAC's own device defaults force Pixels onto the CPU (device-adaptive-runtime.md); Tensor SoCs report GS101 and up. */
function forcedOntoCpu(f: FloorFacts): boolean {
  const pixel = /google/i.test(f.manufacturer ?? "") && /^pixel/i.test(f.model ?? "");
  return pixel || /tensor|^gs\d{3}$/i.test(f.soc ?? "");
}

export function floorCheck(f: FloorFacts): FloorVerdict {
  if (f.platform !== "android") return { kind: "supported" };
  const reasons: FloorReason[] = [];
  if (f.abis?.length && !f.abis.includes(FLOOR.abi)) reasons.push("abi");
  if (f.apiLevel !== undefined && f.apiLevel < FLOOR.minApiLevel) reasons.push("android_version");
  if (f.totalRamBytes !== undefined && f.totalRamBytes > 0 && f.totalRamBytes < FLOOR.minRamBytes) reasons.push("memory");
  if (f.isLowRamDevice === true) reasons.push("low_ram_device");
  if (f.dotprod === false) reasons.push("no_dotprod");
  if (reasons.length) return { kind: "below_floor", reasons, canOptIn: !reasons.some((r) => HARD.has(r)) };

  const degraded: DegradedReason[] = [];
  if (forcedOntoCpu(f)) degraded.push("cpu_only");
  if (f.measuredTokPerSec !== undefined && Number.isFinite(f.measuredTokPerSec) && f.measuredTokPerSec < FLOOR.slowTokPerSec) degraded.push("slow");
  return degraded.length ? { kind: "degraded", reasons: degraded } : { kind: "supported" };
}

export type FloorAction = "download_anyway";

/** What HM-ONB-05 renders: copy keys with their values (bytes for sizes), and the only action, when allowed. */
export interface FloorView {
  title: string;
  reasons: Array<{ key: string; vars: Record<string, number> }>;
  stillWorks: string;
  warning?: string;
  actions: FloorAction[];
}

export function floorView(v: Extract<FloorVerdict, { kind: "below_floor" }>, f: Pick<FloorFacts, "totalRamBytes" | "apiLevel">): FloorView {
  const reasons = v.reasons.map((r): FloorView["reasons"][number] => {
    const key = `HM-ONB-05.reason.${r}`;
    if (r === "memory") return { key, vars: { have: f.totalRamBytes ?? 0, need: FLOOR.marketedRamBytes } };
    if (r === "android_version") return { key, vars: { need: FLOOR.androidVersion } };
    return { key, vars: {} };
  });
  return v.canOptIn
    ? { title: "HM-ONB-05.title", reasons, stillWorks: "HM-ONB-05.stillWorks", warning: "HM-ONB-05.optInWarning", actions: ["download_anyway"] }
    : { title: "HM-ONB-05.title", reasons, stillWorks: "HM-ONB-05.stillWorksNone", actions: [] };
}
