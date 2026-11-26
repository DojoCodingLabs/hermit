/**
 * The device-adaptive runtime (docs/research/device-adaptive-runtime.md): Hermit tunes itself to the phone
 * it lands on. Rules give a first plan from device facts; a short first-run calibration measures the
 * candidates and keeps the fastest one that still passes a tool-call and schema sanity check; per request,
 * heat and battery shrink the thinking budget before anything is reloaded. Pure functions, tested on the Mac.
 * The profile (format, sampling, prompt) stays the eval unit; a plan only changes how and where it runs.
 */
export type Tier = "unsupported" | "floor" | "low" | "mid" | "high";
export type ThermalLevel = "nominal" | "fair" | "serious" | "critical";

export interface CpuCluster {
  /** CPU indices in this cluster, e.g. [4, 5, 6, 7]. */
  cpus: number[];
  maxFreqKHz: number;
}

export interface HardwareFacts {
  platform: "android" | "ios";
  model: string;
  /** Android Build.SOC_MODEL (API 31+), iOS model identifier. */
  soc?: string;
  totalRamBytes: number;
  isLowRamDevice?: boolean;
  /** Fastest first. Empty when unknown (iOS, or sysfs unreadable). */
  clusters: CpuCluster[];
  /** Every online core, whatever the process may use (Android's availableProcessors). */
  logicalCores: number;
  /**
   * Android: the cores this process could run on when the facts were read (Cpus_allowed_list: the cpuset with the
   * affinity mask). Android moves an app between cpusets as it comes and goes: on the S26 an app on screen got 0-5 and
   * the background 0-1,4-5 while all 8 cores were online. Undefined when unknown.
   */
  allowedCpus?: number[];
  cpuFeatures: { dotprod: boolean; i8mm: boolean; sve2?: boolean; sme2?: boolean };
  /** iOS: performance core count (Apple exposes no clusters). */
  performanceCores?: number;
}

export interface RuntimePlan {
  tier: Tier;
  device: "cpu" | "gpu";
  backend?: Array<"metal" | "opencl">;
  threads: number;
  threadsBatch: number;
  /** Android only: hex affinity mask of the cores in use. */
  cpuMask?: string;
  ctxSize: number;
  ubatch: number;
  cacheCheckpoints: number;
  /** Thinking budget for the first action at nominal conditions (Q30). */
  thinkingBudget: number;
  maxReplyTokens: number;
  /** Q155: the cap for a long answer the user asked for, while the phone is cool. */
  longReplyTokens: number;
  /**
   * Skip thinking when the router is sure of the skill. On the dev held-out set: 80/90 at a 2.2 s median
   * against 82/90 at 3.0 s on the Mac; worth it where every token is slow.
   */
  fastRoute: boolean;
}

export interface CalibrationCandidate {
  device: "cpu" | "gpu";
  backend?: "metal" | "opencl";
  threads: number;
  threadsBatch: number;
  cpuMask?: string;
  ubatch: number;
}

export interface CalibrationResult {
  candidate: CalibrationCandidate;
  prefillTokPerSec: number;
  decodeTokPerSec: number;
  /** A native tool call and a JSON-schema request both came back valid (Vulkan failed this on the S26). */
  sanityPassed: boolean;
  thermalAtStart: ThermalLevel;
}

export interface RuntimeConditions {
  thermal: ThermalLevel;
  /** Android getThermalHeadroom: 1.0 means throttling now. */
  thermalHeadroom?: number;
  lowPowerMode: boolean;
  memoryPressure: "none" | "moderate" | "critical";
}

export interface RequestBudget {
  thinkingBudget: number;
  maxReplyTokens: number;
  /** Q155: a long answer's cap right now: the plan's long cap only while cool with headroom, else the reply cap. */
  longReplyTokens: number;
}

const GB = 1024 ** 3;

/** First match wins (device-adaptive-runtime.md 2.6). */
export function tierFor(f: HardwareFacts): Tier {
  if (f.totalRamBytes < 3 * GB) return "unsupported";
  if (f.platform === "android" && !f.cpuFeatures.dotprod) return "unsupported";
  if (f.platform === "ios") {
    // By performance cores and RAM: A17 Pro and newer have 8 GB; A15 to A16 have 6 GB.
    if (f.totalRamBytes >= 7.5 * GB) return "high";
    if (f.totalRamBytes >= 5.5 * GB) return "mid";
    return "low";
  }
  if (f.totalRamBytes < 4 * GB || f.isLowRamDevice) return "floor";
  // Two or fewer fast cores (the rest Cortex-A55-class) can't keep a 0.8B model responsive.
  const fast = fastCores(f).length;
  if (f.totalRamBytes < 6 * GB || !f.cpuFeatures.i8mm) return f.clusters.length > 1 && fast <= 2 ? "floor" : "low";
  if (f.totalRamBytes < 7.5 * GB) return "mid";
  return f.cpuFeatures.i8mm ? "high" : "mid";
}

/** Hex mask of CPU indices, e.g. [4,5,6,7] -> "f0". */
export function cpuMask(cpus: readonly number[]): string {
  let m = 0n;
  for (const c of cpus) m |= 1n << BigInt(c);
  return m.toString(16);
}

/**
 * Cores worth running on: clusters within 75% of the fastest one's clock. On big.LITTLE phones the little
 * cores slow everyone down (llama.cpp waits for the slowest thread); on the S26 every core qualifies.
 */
export function fastCores(f: HardwareFacts): number[] {
  if (!f.clusters.length) return [];
  const top = f.clusters[0]!.maxFreqKHz;
  return f.clusters.filter((c) => c.maxFreqKHz >= top * 0.75).flatMap((c) => c.cpus).sort((a, b) => a - b);
}

/**
 * Q155: a long answer runs about 800 tokens on a phone that decodes 20 to 30 tok/s (half a minute, streamed, with Stop);
 * slower tiers get less of it, and Seguir goes on from there.
 */
const TIER_DEFAULTS: Record<Exclude<Tier, "unsupported">, Pick<RuntimePlan, "ctxSize" | "ubatch" | "cacheCheckpoints" | "thinkingBudget" | "maxReplyTokens" | "longReplyTokens" | "fastRoute">> = {
  floor: { ctxSize: 4096, ubatch: 256, cacheCheckpoints: 2, thinkingBudget: 128, maxReplyTokens: 100, longReplyTokens: 300, fastRoute: true },
  low: { ctxSize: 8192, ubatch: 256, cacheCheckpoints: 3, thinkingBudget: 192, maxReplyTokens: 120, longReplyTokens: 500, fastRoute: true },
  mid: { ctxSize: 8192, ubatch: 512, cacheCheckpoints: 4, thinkingBudget: 256, maxReplyTokens: 120, longReplyTokens: 800, fastRoute: false },
  high: { ctxSize: 8192, ubatch: 512, cacheCheckpoints: 4, thinkingBudget: 256, maxReplyTokens: 120, longReplyTokens: 800, fastRoute: false },
};

/**
 * The shipped profile, adjusted for this phone: the plan's thinking budget and fast route (format and sampling stay),
 * and the context the plan loads, so a long answer's cap is bounded by the window it really has (Q155).
 */
export function profileForPlan<P extends { thinking: { mode: "off" } | { mode: "on"; budgetTokens: number }; fastRoute?: boolean; contextTokens?: number }>(profile: P, plan: RuntimePlan): P {
  const thinking = profile.thinking.mode === "on" ? { mode: "on" as const, budgetTokens: Math.min(profile.thinking.budgetTokens, plan.thinkingBudget) } : profile.thinking;
  return { ...profile, thinking, fastRoute: plan.fastRoute, ...(profile.contextTokens !== undefined ? { contextTokens: Math.min(profile.contextTokens, plan.ctxSize) } : {}) };
}

/** Tokens kept free after the prompt, the history and a long answer, so a long answer never runs into the window. */
const LONG_MARGIN_TOKENS = 512;

/**
 * Q155: the cap for a long answer the user asked for: the profile's `longReplyTokens`, never more than the context
 * leaves after the prompt and history (`promptChars` / 3 over-counts tokens for Spanish and English) and its thinking,
 * with a margin; never under the normal reply cap, where Seguir goes on.
 */
export function longReplyCap(profile: { maxReplyTokens: number; longReplyTokens?: number; contextTokens: number; longThinking?: { mode: "off" } | { mode: "on"; budgetTokens: number } }, promptChars: number): number {
  const want = profile.longReplyTokens ?? profile.maxReplyTokens;
  const thinking = profile.longThinking?.mode === "on" ? profile.longThinking.budgetTokens : 0;
  const room = profile.contextTokens - Math.ceil(promptChars / 3) - thinking - LONG_MARGIN_TOKENS;
  return Math.max(profile.maxReplyTokens, Math.min(want, room));
}

/** The part of a plan that only a load sets (llama.cpp has no config reload). */
export type ThreadPlan = Pick<RuntimePlan, "threads" | "threadsBatch" | "cpuMask">;

/**
 * Measured on the S26 with the dev eval screen (2026-11-24, the app on screen in the "foreground" cpuset, cores 0-5):
 *
 * | Threads | tok/s | First token |
 * | --- | --- | --- |
 * | 8 | 0.2 (spin-waiting on 6 cores) | 9.3 s |
 * | 6 | 31 to 43 | |
 * | 5 | 37 to 42 | 0.3 s |
 * | 4 | 31 | |
 * | 2 | 21 | |
 *
 * Nothing above 5 was faster, so a plan never uses more, even with all 8 cores allowed (top-app). It is also the
 * stopgap's count when the allowed cores are unknown (a build before the native call).
 */
export const MAX_MODEL_THREADS = 5;

/** Valid core indices, sorted and distinct; undefined when none is left (the allowed cores are unknown). */
export function allowedCpuSet(cpus: readonly number[] | undefined): number[] | undefined {
  const set = [...new Set((cpus ?? []).filter((c) => Number.isInteger(c) && c >= 0 && c < 1024))].sort((a, b) => a - b);
  return set.length ? set : undefined;
}

/** A core list the way the kernel writes it ("0-1,4-5"), for the logs; "unknown" without one. */
export function cpuListText(cpus: readonly number[] | undefined): string {
  const set = allowedCpuSet(cpus);
  if (!set) return "unknown";
  const parts: string[] = [];
  for (let i = 0; i < set.length; i++) {
    const from = set[i]!;
    while (set[i + 1] === set[i]! + 1) i++;
    parts.push(from === set[i] ? `${from}` : `${from}-${set[i]}`);
  }
  return parts.join(",");
}

/**
 * Fast cores among the allowed ones. When none is allowed (a big.LITTLE phone whose background set holds only its
 * little cores) the fastest allowed cluster and those near it count instead; with no clusters known, every allowed core.
 */
function fastAllowed(f: HardwareFacts, allowed: readonly number[]): number[] {
  const inSet = new Set(allowed);
  const fast = fastCores(f).filter((c) => inSet.has(c));
  if (fast.length) return fast;
  const clusters = f.clusters.map((c) => ({ ...c, cpus: c.cpus.filter((x) => inSet.has(x)) })).filter((c) => c.cpus.length);
  return clusters.length ? fastCores({ ...f, clusters }) : [...allowed];
}

/**
 * Threads and core mask for the cores this process may use (`allowed`, Android's cpuset): the fast cores among them,
 * one allowed core left for the interface and the system, at most MAX_MODEL_THREADS. On the S26: 5 on screen
 * (foreground 0-5, and top-app 0-7 by the cap), 3 in the background (0-1,4-5); 3 on a 4-core phone. A mask only when
 * the fast cores are fewer than the allowed ones, and it names allowed cores only. Unknown cores: the rules' count up
 * to MAX_MODEL_THREADS (the stopgap of 2026-11-24).
 */
export function threadPlan(f: HardwareFacts, allowed: readonly number[] | undefined): ThreadPlan {
  const set = allowedCpuSet(allowed);
  if (!set) {
    const cores = fastCores(f);
    const threads = Math.min(cores.length || Math.max(2, Math.min(4, f.logicalCores)), MAX_MODEL_THREADS);
    return { threads, threadsBatch: threads, ...(cores.length && cores.length < f.logicalCores ? { cpuMask: cpuMask(cores) } : {}) };
  }
  const fast = fastAllowed(f, set);
  const threads = Math.max(1, Math.min(fast.length, set.length - 1, MAX_MODEL_THREADS));
  return { threads, threadsBatch: threads, ...(fast.length < set.length ? { cpuMask: cpuMask(fast) } : {}) };
}

/** The plan with other threads and mask; everything else stays. */
export function withThreads(plan: RuntimePlan, t: ThreadPlan): RuntimePlan {
  const rest: RuntimePlan = { ...plan };
  delete rest.cpuMask;
  return { ...rest, threads: t.threads, threadsBatch: t.threadsBatch, ...(t.cpuMask ? { cpuMask: t.cpuMask } : {}) };
}

/**
 * At a safe point only (between turns, nothing running on the engine): the threads to reload with when the cores
 * Android allows now call for others than the engine loaded with. Either way: the app went to the background and its
 * set shrank below the threads (5 threads on the S26's 4 background cores would spin-wait), or it came back. Undefined
 * keeps the engine as it is, also when the cores can't be read now. A reload costs about 2 s on the S26.
 */
export function threadsReload(loaded: ThreadPlan, f: HardwareFacts, allowed: readonly number[] | undefined): ThreadPlan | undefined {
  if (f.platform !== "android" || !allowedCpuSet(allowed)) return undefined;
  const wanted = threadPlan(f, allowed);
  const same = wanted.threads === loaded.threads && wanted.threadsBatch === loaded.threadsBatch && (wanted.cpuMask ?? "") === (loaded.cpuMask ?? "");
  return same ? undefined : wanted;
}

/** Rules only, before any measurement. CPU on Android (GPU backends lost on the S26 and Vulkan broke grammar). */
export function initialPlan(f: HardwareFacts): RuntimePlan {
  const tier = tierFor(f);
  const d = TIER_DEFAULTS[tier === "unsupported" ? "floor" : tier];
  if (f.platform === "ios") {
    const p = Math.max(2, f.performanceCores ?? 2);
    return { tier, device: "cpu", threads: p, threadsBatch: p, ...d };
  }
  return { tier, device: "cpu", ...threadPlan(f, f.allowedCpus), ...d };
}

/**
 * At most four loads (each candidate needs its own load: llama.cpp has no config reload). Never more threads than the
 * cores Android allows (8 threads on the S26's 6 foreground cores ran at 0.2 tok/s), or than MAX_MODEL_THREADS when
 * they are unknown, and masks over allowed cores only.
 */
export function candidatesFor(f: HardwareFacts, plan: RuntimePlan): CalibrationCandidate[] {
  const out: CalibrationCandidate[] = [];
  const add = (c: CalibrationCandidate) => {
    if (!out.some((x) => JSON.stringify(x) === JSON.stringify(c))) out.push(c);
  };
  if (f.platform === "ios") {
    add({ device: "cpu", threads: plan.threads, threadsBatch: plan.threads, ubatch: plan.ubatch });
    add({ device: "gpu", backend: "metal", threads: plan.threads, threadsBatch: plan.threads, ubatch: plan.ubatch });
    return out;
  }
  const allowed = allowedCpuSet(f.allowedCpus);
  const limit = allowed ? allowed.length : Math.min(f.logicalCores, MAX_MODEL_THREADS);
  const big = (f.clusters[0]?.cpus ?? []).filter((c) => !allowed || allowed.includes(c));
  if (big.length >= 2) {
    const n = Math.min(big.length, limit);
    add({ device: "cpu", threads: n, threadsBatch: n, ...(big.length === allowed?.length ? {} : { cpuMask: cpuMask(big) }), ubatch: plan.ubatch });
  }
  add({ device: "cpu", threads: plan.threads, threadsBatch: plan.threads, ...(plan.cpuMask ? { cpuMask: plan.cpuMask } : {}), ubatch: plan.ubatch });
  add({ device: "cpu", threads: limit, threadsBatch: limit, ubatch: plan.ubatch });
  if (plan.tier === "floor" || plan.tier === "low") add({ ...out[0]!, ubatch: plan.ubatch === 256 ? 512 : 256 });
  return out.slice(0, 4);
}

/**
 * Seconds for a typical cold step (1,200 prompt tokens, 80 generated); lowest wins among candidates that
 * passed the sanity check. A result measured hot is penalized so a hot phone doesn't pick a slow plan forever.
 */
export function stepSeconds(r: CalibrationResult): number {
  // A hot phone measures slow; scale its numbers up so a warm calibration doesn't lock in a small plan.
  const understated = r.thermalAtStart === "nominal" ? 1 : r.thermalAtStart === "fair" ? 1.1 : 1.33;
  return (1200 / r.prefillTokPerSec + 80 / r.decodeTokPerSec) / understated;
}

export function pickBest(results: readonly CalibrationResult[]): CalibrationCandidate | undefined {
  return [...results].filter((r) => r.sanityPassed && r.prefillTokPerSec > 0 && r.decodeTokPerSec > 0).sort((a, b) => stepSeconds(a) - stepSeconds(b))[0]?.candidate;
}

export function applyCandidate(plan: RuntimePlan, c: CalibrationCandidate): RuntimePlan {
  const rest: RuntimePlan = { ...plan };
  delete rest.cpuMask;
  delete rest.backend;
  return { ...rest, device: c.device, threads: c.threads, threadsBatch: c.threadsBatch, ubatch: c.ubatch, ...(c.cpuMask ? { cpuMask: c.cpuMask } : {}), ...(c.backend ? { backend: [c.backend] } : {}) };
}

/** Per request, no reload: heat and battery shrink thinking first, then the reply cap (2.4). */
export function budgetFor(plan: RuntimePlan, c: RuntimeConditions): RequestBudget {
  const headroom = c.thermalHeadroom ?? 0;
  // Critical heat, or the model paging from storage (memory pressure seen as speed under 3 tok/s): each token
  // costs seconds, so no reasoning pass and a short reply. The model still makes every decision.
  // Q155: a long answer gets the plan's long cap only in the last case, cool with headroom; otherwise the reply cap of
  // that moment, and Seguir goes on.
  const short = (maxReplyTokens: number) => ({ maxReplyTokens, longReplyTokens: maxReplyTokens });
  if (c.thermal === "critical" || headroom >= 1 || c.memoryPressure === "critical") return { thinkingBudget: 0, ...short(Math.min(plan.maxReplyTokens, 60)) };
  if (c.thermal === "serious" || headroom > 0.85 || c.lowPowerMode || c.memoryPressure === "moderate") {
    return { thinkingBudget: plan.thinkingBudget ? Math.max(64, Math.round(plan.thinkingBudget * 0.5)) : 0, ...short(Math.min(plan.maxReplyTokens, 80)) };
  }
  if (c.thermal === "fair" || headroom > 0.7) return { thinkingBudget: Math.round(plan.thinkingBudget * 0.75), ...short(plan.maxReplyTokens) };
  return { thinkingBudget: plan.thinkingBudget, maxReplyTokens: plan.maxReplyTokens, longReplyTokens: Math.max(plan.maxReplyTokens, plan.longReplyTokens) };
}

/** Unbounded thinking gets this much room on top of a reply, as on the Mac lab (llama-engine.ts). */
const OPEN_THINKING_TOKENS = 2048;

/**
 * What one request may generate (FR-MODEL-05, Q155), from what it asks and this phone's budget right now:
 * - `thinkTokens`: the reasoning channel's cap (QVAC `reasoning_budget`; Infinity means unbounded, -1 on the wire);
 * - `replyCap`: the words the user reads. A free-text reply (no schema, no tools) is held to the device's reply cap;
 * - `predict`: llama.cpp's whole budget. It counts thinking too, so a free-text reply gets its thinking on top of its
 *   cap, the way the Mac lab sends max_tokens = maxTokens + the budget. Before Q155 the phone's predict was the cap
 *   alone, and a reply prompt with thinking on could spend all 120 tokens thinking and show nothing.
 * Calls with a schema or tools keep the caller's own maxTokens, thinking included, as before; a prefill writes nothing.
 */
export function generationBudget(
  req: { maxTokens: number; thinking: { enabled: boolean; budgetTokens?: number }; jsonSchema?: unknown; tools?: readonly unknown[]; prefill?: boolean; longForm?: boolean },
  budget: RequestBudget | undefined,
): { predict: number; thinkTokens: number; replyCap: number } {
  const thinkTokens = req.thinking.enabled ? Math.min(req.thinking.budgetTokens ?? Infinity, budget?.thinkingBudget ?? Infinity) : 0;
  if (req.prefill || req.jsonSchema || req.tools) return { predict: req.maxTokens, thinkTokens, replyCap: req.maxTokens };
  // Q155: a long answer the user asked for runs to its long cap only while the phone is cool (budgetFor).
  const replyCap = budget ? Math.min(req.maxTokens, req.longForm ? budget.longReplyTokens : budget.maxReplyTokens) : req.maxTokens;
  const thinking = thinkTokens === Infinity ? OPEN_THINKING_TOKENS : thinkTokens;
  return { predict: replyCap + thinking, thinkTokens, replyCap };
}

/**
 * At a safe point only (idle): fewer threads while hot for a while, the calibrated plan when cool again. Never more
 * than the plan: with 3 threads (the S26 in the background) a hot phone keeps 2.
 */
export function threadsFor(plan: RuntimePlan, c: RuntimeConditions, sustainedHot: boolean): number {
  if (sustainedHot && (c.thermal === "serious" || c.thermal === "critical")) return Math.min(plan.threads, Math.max(2, plan.threads - 2));
  return plan.threads;
}

/**
 * First-run calibration (2.3): measure each candidate with `measure` (on the phone: load, prefill a fixed
 * prompt, decode a few tokens, check a tool call and a schema), keep the fastest that passed. Skipped when
 * the phone is hot or saving battery, so a bad moment never locks in a slow plan; the rules plan stands.
 */
export async function calibrate(
  facts: HardwareFacts,
  plan: RuntimePlan,
  conditions: RuntimeConditions,
  measure: (c: CalibrationCandidate) => Promise<Omit<CalibrationResult, "candidate" | "thermalAtStart">>,
): Promise<{ plan: RuntimePlan; results: CalibrationResult[]; skipped?: "hot" | "battery" }> {
  if (conditions.thermal === "serious" || conditions.thermal === "critical") return { plan, results: [], skipped: "hot" };
  if (conditions.lowPowerMode) return { plan, results: [], skipped: "battery" };
  const results: CalibrationResult[] = [];
  for (const candidate of candidatesFor(facts, plan)) {
    try {
      results.push({ candidate, thermalAtStart: conditions.thermal, ...(await measure(candidate)) });
    } catch {
      results.push({ candidate, thermalAtStart: conditions.thermal, prefillTokPerSec: 0, decodeTokPerSec: 0, sanityPassed: false });
    }
  }
  const best = pickBest(results);
  return { plan: best ? applyCandidate(plan, best) : plan, results };
}
