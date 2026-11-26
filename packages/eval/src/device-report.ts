import { cpuListText, type Thinking, type Tier } from "@hermit/model";
import type { LabRun, SpeedRun } from "./device-lab.ts";

/**
 * The Device lab's report (docs/devices/schema.json): device and benchmark facts only. It is built field by field
 * from what the lab read and measured, so nothing else the app knows can reach it, and every text field is checked
 * the way the device table's checker (scripts/devices/validate.mjs) checks it: what doesn't pass becomes "unknown"
 * or is left out. Never the device name a person sets, an account, an identifier, a place or anything typed.
 */
export const REPORT_SCHEMA = "hermit-device-report/1" as const;

export type ThermalName = "none" | "light" | "moderate" | "severe" | "critical" | "emergency" | "shutdown" | "unknown";
export type ChipSource = "soc" | "cpuinfo" | "build" | "unknown";
export type Abi = "arm64-v8a" | "armeabi-v7a" | "x86_64" | "x86" | "unknown";

export interface ReportSpeed {
  threads: number;
  tokensPerSecond: number;
  prefillTokensPerSecond?: number;
  firstTokenMs?: number;
  loadMs: number;
}

export interface DeviceReport {
  schema: typeof REPORT_SCHEMA;
  app: string;
  model: string;
  device: {
    manufacturer: string;
    model: string;
    chip: string;
    chipVendor?: string;
    chipSource: ChipSource;
    ramGB: number;
    lowRam?: boolean;
    android: string;
    api: number;
    abi: Abi;
    cores: number;
    coreMaxMHz?: number[];
    cpuFeatures: { dotprod: boolean; i8mm: boolean; sve2: boolean; sme2: boolean };
  };
  runtime: {
    tier: Tier;
    threads: number;
    threadsBatch: number;
    cpuMask?: string;
    ctxSize: number;
    ubatch: number;
    thinkingBudget: number;
    fastRoute: boolean;
    allowedCpus: string;
    cpuset?: string;
    thermalStart: ThermalName;
    thermalMax: ThermalName;
    batterySaver: boolean;
  };
  speed: ReportSpeed & { firstTokenMs: number; sweep: ReportSpeed[] };
  eval: {
    score: number;
    n: number;
    firstActionMedianMs: number;
    p90Ms: number;
    perCase?: Array<{ id: string; pass: boolean; ms: number; choice: string }>;
  };
  run: { durationMs: number; thermalPauses: number; pausedMs: number; date: string };
}

/** What the phone says about itself, as the app read it. Only these fields are ever looked at. */
export interface PhoneFacts {
  /** Build.MANUFACTURER. */
  manufacturer?: string;
  /** Build.MODEL, the maker's model code (not the device name a person sets). */
  model?: string;
  /** Build.SOC_MANUFACTURER and Build.SOC_MODEL, Android 12 and later. */
  socManufacturer?: string;
  socModel?: string;
  /** The Hardware line of /proc/cpuinfo. */
  cpuinfoHardware?: string;
  /** Build.HARDWARE. */
  buildHardware?: string;
  totalRamBytes: number;
  lowRam?: boolean;
  /** Build.VERSION.RELEASE. */
  androidRelease?: string;
  apiLevel: number;
  /** Build.SUPPORTED_ABIS, the primary first. */
  abis?: readonly string[];
  logicalCores: number;
  clusters?: ReadonlyArray<{ cpus: readonly number[]; maxFreqKHz: number }>;
  cpuFeatures?: { dotprod?: boolean; i8mm?: boolean; sve2?: boolean; sme2?: boolean };
  /** The cores the app may use on screen, and its cpuset ("/top-app"). */
  allowedCpus?: readonly number[];
  cpuset?: string;
  batterySaver?: boolean;
}

/** The profile the lab ran, as this phone runs it. */
export interface ReportProfile {
  id: string;
  thinking: Thinking;
  fastRoute?: boolean;
  contextTokens: number;
}

const GB = 1024 ** 3;
const THERMAL: readonly ThermalName[] = ["none", "light", "moderate", "severe", "critical", "emergency", "shutdown"];
const ABIS: readonly Abi[] = ["arm64-v8a", "armeabi-v7a", "x86_64", "x86"];
/** The first actions a report can name: the first-win menu, then respond and ask_user; anything else is "other". */
const CHOICES = new Set([
  "remember", "recall", "forget", "remind", "reminders_list", "reminder_cancel", "calendar_read", "calendar_add",
  "read_messages", "reply_message", "mail_list", "mail_search", "mail_read", "mail_send", "mail_reply", "mail_forward",
  "mail_draft", "mail_modify", "respond", "ask_user",
]);
/** Android versions by API level, for a release name that isn't a number (a preview's code name). */
const ANDROID_BY_API: Record<number, string> = {
  21: "5.0", 22: "5.1", 23: "6", 24: "7.0", 25: "7.1", 26: "8.0", 27: "8.1", 28: "9", 29: "10", 30: "11", 31: "12", 32: "12",
  33: "13", 34: "14", 35: "15", 36: "16", 37: "17",
};

// The same rules as the device table's checker (scripts/devices/validate.mjs): a name keeps to these characters, and
// nothing that looks like an email, a web address, a phone number or an identifier is kept.
const NAME_CHARS = /^[A-Za-z0-9 _.,()+/-]+$/;
const PRIVATE = [/@/, /[a-z][a-z0-9+.-]*:\/\/|\bwww\.|\b[a-z0-9-]+\.(com|net|org|io|dev|app|me|co|ai|xyz|info|biz|us|uk|de|es|mx|cr|br|ar|cl|ly|gg|tv|link|site|online|example)\b/i, /[0-9]{10,}/, /\b[0-9a-f]{16,}\b/i];

/** A name Android reported, if it is one: plain characters, nothing personal, "unknown" counted as none. */
function name(v: string | undefined): string | undefined {
  if (typeof v !== "string") return undefined;
  const s = v.replace(/[\u2122\u00ae\u00a9]/g, "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, " ").trim();
  if (!s || !NAME_CHARS.test(s) || PRIVATE.some((re) => re.test(s))) return undefined;
  const cut = s.replace(/^[^A-Za-z0-9]+/, "").slice(0, 48).trim();
  return cut && !/^unknown$/i.test(cut) ? cut : undefined;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const int = (v: number, lo: number, hi: number) => clamp(Math.round(Number.isFinite(v) ? v : 0), lo, hi);
const tenth = (v: number, lo: number, hi: number) => clamp(Math.round((Number.isFinite(v) ? v : 0) * 10) / 10, lo, hi);
const MS = 3_600_000;
const RATE = 5000;

/** The lab's median: the middle time (the upper one of an even count). */
export function median(xs: readonly number[]): number {
  return [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] ?? 0;
}

/** The lab's 90th percentile: the time at 90 percent of the sorted list. */
export function p90(xs: readonly number[]): number {
  return [...xs].sort((a, b) => a - b)[Math.floor(xs.length * 0.9)] ?? 0;
}

const thermalName = (s: number | undefined): ThermalName => (s !== undefined && Number.isInteger(s) && s >= 0 && s < THERMAL.length ? THERMAL[s]! : "unknown");

function speedOf(r: SpeedRun): ReportSpeed {
  return {
    threads: int(r.threads, 1, 16),
    tokensPerSecond: tenth(r.tokensPerSecond, 0, RATE),
    ...(r.prefillTokensPerSecond !== undefined ? { prefillTokensPerSecond: tenth(r.prefillTokensPerSecond, 0, RATE) } : {}),
    ...(r.firstTokenMs !== undefined ? { firstTokenMs: int(r.firstTokenMs, 0, MS) } : {}),
    loadMs: int(r.loadMs, 0, MS),
  };
}

function chipOf(f: PhoneFacts): Pick<DeviceReport["device"], "chip" | "chipVendor" | "chipSource"> {
  const soc = name(f.socModel);
  if (soc) {
    const vendor = name(f.socManufacturer);
    return { chip: soc, ...(vendor ? { chipVendor: vendor } : {}), chipSource: "soc" };
  }
  const cpuinfo = name(f.cpuinfoHardware);
  if (cpuinfo) return { chip: cpuinfo, chipSource: "cpuinfo" };
  const hardware = name(f.buildHardware);
  if (hardware) return { chip: hardware, chipSource: "build" };
  return { chip: "unknown", chipSource: "unknown" };
}

/** Each core's top clock in MHz by core number, 0 where unread; left out when nothing was read. */
function coreClocks(f: PhoneFacts, cores: number): number[] | undefined {
  if (!f.clusters?.length) return undefined;
  const mhz = new Array<number>(cores).fill(0);
  for (const c of f.clusters) for (const cpu of c.cpus) if (Number.isInteger(cpu) && cpu >= 0 && cpu < cores) mhz[cpu] = int(c.maxFreqKHz / 1000, 0, 6000);
  return mhz.some((x) => x > 0) ? mhz : undefined;
}

export function buildDeviceReport(input: { app: string; profile: ReportProfile; facts: PhoneFacts; lab: LabRun }): DeviceReport {
  const { facts: f, lab, profile } = input;
  const api = int(f.apiLevel, 21, 60);
  const release = typeof f.androidRelease === "string" && /^[0-9]{1,2}(\.[0-9]{1,2}){0,2}$/.test(f.androidRelease.trim()) ? f.androidRelease.trim() : (ANDROID_BY_API[api] ?? "0");
  const cores = int(f.logicalCores, 1, 64);
  const clocks = coreClocks(f, cores);
  const abi = ABIS.find((a) => a === f.abis?.[0]) ?? "unknown";
  const allowed = cpuListText(f.allowedCpus);
  const cpuset = typeof f.cpuset === "string" ? f.cpuset.trim().replace(/^\/+/, "").toLowerCase() : "";
  const plan = lab.plan;
  const times = lab.cases.map((c) => c.ms);
  const durationMs = int(lab.endedAt - lab.startedAt, 1, 14_400_000);
  return {
    schema: REPORT_SCHEMA,
    app: /^[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,4}(-[0-9A-Za-z.]{1,24})?$/.test(input.app) ? input.app : "0.0.0",
    model: profile.id,
    device: {
      manufacturer: name(f.manufacturer) ?? "unknown",
      model: name(f.model) ?? "unknown",
      ...chipOf(f),
      ramGB: tenth(f.totalRamBytes / GB, 0.5, 64),
      ...(typeof f.lowRam === "boolean" ? { lowRam: f.lowRam } : {}),
      android: release,
      api,
      abi,
      cores,
      ...(clocks ? { coreMaxMHz: clocks } : {}),
      cpuFeatures: { dotprod: f.cpuFeatures?.dotprod === true, i8mm: f.cpuFeatures?.i8mm === true, sve2: f.cpuFeatures?.sve2 === true, sme2: f.cpuFeatures?.sme2 === true },
    },
    runtime: {
      tier: plan.tier,
      threads: int(plan.threads, 1, 16),
      threadsBatch: int(plan.threadsBatch, 1, 16),
      ...(plan.cpuMask && /^[0-9a-f]{1,8}$/.test(plan.cpuMask) ? { cpuMask: plan.cpuMask } : {}),
      ctxSize: int(Math.min(profile.contextTokens, plan.ctxSize), 256, 131_072),
      ubatch: int(plan.ubatch, 1, 4096),
      thinkingBudget: profile.thinking.mode === "on" ? int(profile.thinking.budgetTokens, 0, 4096) : 0,
      fastRoute: profile.fastRoute === true,
      allowedCpus: /^[0-9]{1,2}(-[0-9]{1,2})?(,[0-9]{1,2}(-[0-9]{1,2})?){0,31}$/.test(allowed) ? allowed : "unknown",
      ...(/^[a-z][a-z0-9-]{0,23}$/.test(cpuset) ? { cpuset } : {}),
      thermalStart: thermalName(lab.thermal.start),
      thermalMax: thermalName(lab.thermal.max),
      batterySaver: f.batterySaver === true,
    },
    speed: {
      ...speedOf(lab.speed.planned),
      firstTokenMs: int(lab.speed.planned.firstTokenMs, 0, MS),
      sweep: lab.speed.sweep.map(speedOf),
    },
    eval: {
      score: lab.cases.filter((c) => c.pass).length,
      n: lab.cases.length,
      firstActionMedianMs: int(median(times), 0, MS),
      p90Ms: int(p90(times), 0, MS),
      perCase: lab.cases.map((c) => ({ id: c.id, pass: c.pass, ms: int(c.ms, 0, MS), choice: CHOICES.has(c.choice) ? c.choice : "other" })),
    },
    run: {
      durationMs,
      thermalPauses: int(lab.thermal.pauses, 0, 100),
      pausedMs: int(Math.min(lab.thermal.pausedMs, durationMs), 0, 14_400_000),
      date: new Date(lab.startedAt).toISOString().slice(0, 10),
    },
  };
}
