import { describeNowForModel, type ModelPort, type StopSignal } from "@hermit/core";
import { createModelPort, MAX_MODEL_THREADS, withThreads, type CompletionEngine, type ModelProfile, type RuntimePlan, type ThreadPlan } from "@hermit/model";
import { firstWinSkills } from "@hermit/skills";
import type { EvalCase } from "./cases.ts";
import { FIRST_WIN_CASES } from "./first-win-cases.ts";
import { runEval } from "./score.ts";

/**
 * The Device lab: one offline benchmark that every phone runs the same way, so their reports compare. It reads
 * nothing personal and sends nothing; the app shows the result and the person decides whether to share it.
 *
 * 1. Speed: the same fixed prompt at the thread count the plan gives this phone, then at 2 and 4 threads (never more
 *    than the cores the app may use). Each count is its own load (llama.cpp reads threads at load only): a warm-up
 *    call, then two measured ones.
 * 2. Accuracy: 12 of the public first-win cases on the lab's fixed clock, at the plan's thread count.
 *
 * Before every step and between speed calls a thermal guard reads Android's thermal status: at severe or above the
 * lab pauses until the phone is back to light or below, and counts the pause.
 */

/** The lab's fixed clock, the Mac lab's too: Wednesday 2026-11-11, 21:00 in Costa Rica. Every phone answers at it. */
export const LAB_CLOCK: { readonly now: number; readonly timeZone: string } = { now: Date.parse("2026-11-11T21:00:00-06:00"), timeZone: "America/Costa_Rica" };

/**
 * 12 of the 40 first-win cases, 6 in each language, every kind of first action at least once: about 8 minutes on a
 * mid-range phone (30 to 40 s a case), so with the speed probe the whole lab takes about 10.
 */
export const LAB_CASE_IDS = [
  "es-remind-1", "es-remember-2", "es-recall-1", "es-forget-1", "es-cal-read-1", "es-read-1",
  "en-remind-1", "en-remember-2", "en-cal-add-1", "en-reply-1", "en-ask-1", "en-none-1",
] as const;

export const LAB_CASES: readonly EvalCase[] = LAB_CASE_IDS.map((id) => {
  const c = FIRST_WIN_CASES.find((x) => x.id === id);
  if (!c) throw new Error(`Device lab case ${id} is not a first-win case`);
  return c;
});

/** The speed probe's text: fixed, public and plain, about 300 tokens to read before the first token. */
export const PROBE_TEXT = [
  "Hermit crabs carry their homes with them. A hermit crab has no hard shell of its own, so it borrows one, usually the empty shell of a sea snail that fits its soft, curled body.",
  "As the crab grows, the shell gets tight, and the crab has to find a bigger one. On some beaches, crabs gather around a large empty shell and line up from the biggest to the smallest.",
  "When the largest crab moves into the new shell, the next one takes the shell it left behind, and so on down the line, until every crab has a home that fits.",
  "Hermit crabs live in groups, and they eat almost anything the tide leaves on the sand: plants, fruit and bits of fish. They need water to keep their gills wet, so even land hermit crabs stay near the sea.",
  "The shell is more than a home. It keeps the crab out of the sun, away from birds and safe from the waves, and it keeps the crab from drying out at low tide.",
  "A crab without a shell is in danger, which is why it never leaves its old shell until the new one is ready.",
].join(" ");
const PROBE_TASK = "Ignore the text above. Count from one to forty in English words, separated by commas, and write nothing else.";
/** Tokens each measured speed call may write; the warm-up writes 8. */
export const PROBE_MAX_TOKENS = 64;
/** A speed call that runs past this is cut (8 threads on 6 cores wrote 0.2 tokens a second on one phone). */
export const SPEED_CALL_CAP_MS = 60_000;

/** Android's THERMAL_STATUS_SEVERE: pause here. */
export const PAUSE_AT_STATUS = 3;
/** THERMAL_STATUS_LIGHT: go on from here. */
export const RESUME_AT_STATUS = 1;
export const THERMAL_POLL_MS = 15_000;
/** A pause longer than this ends the lab. */
export const MAX_PAUSE_MS = 15 * 60_000;
/** Cases in a row that throw before the lab counts the model as broken. */
const BROKEN_AFTER = 3;

export interface LabEngine extends CompletionEngine {
  close(): Promise<void>;
}

/** The phone, as the lab sees it. */
export interface LabPorts {
  /** Loads the model with this plan: a new engine each time, which the lab closes. */
  load(plan: RuntimePlan): Promise<LabEngine>;
  /** Android's thermal status now (0 none to 6 shutdown); undefined when it can't be read. */
  thermal(): number | undefined;
  /** Waits `ms`, ending early when `signal` fires. */
  sleep(ms: number, signal: StopSignal): Promise<void>;
  now(): number;
}

export type LabProgress =
  | { phase: "speed"; step: number; steps: number; threads: number }
  | { phase: "eval"; step: number; steps: number; index: number; count: number }
  | { phase: "paused"; step: number; steps: number; status: number };

export interface SpeedRun {
  threads: number;
  /** Writing speed, tokens per second; 0 when nothing came out in time. */
  tokensPerSecond: number;
  /** Reading speed, tokens per second, when the runtime reports it. */
  prefillTokensPerSecond?: number;
  /** From the call to the first token, on the app's clock; absent when no token came. */
  firstTokenMs?: number;
  loadMs: number;
}

export interface LabCase {
  id: string;
  pass: boolean;
  ms: number;
  /** The first action picked, or "other" when the case threw. */
  choice: string;
}

export interface LabRun {
  /** The plan the accuracy pass ran with. */
  plan: RuntimePlan;
  speed: { planned: SpeedRun & { firstTokenMs: number }; sweep: SpeedRun[] };
  cases: LabCase[];
  thermal: { start?: number; max?: number; pauses: number; pausedMs: number };
  startedAt: number;
  endedAt: number;
}

export class LabStopped extends Error {
  constructor() {
    super("The Device lab was stopped.");
    this.name = "LabStopped";
  }
}

export type LabFailure = "too_hot" | "load" | "model";

export class LabFailed extends Error {
  readonly reason: LabFailure;
  constructor(reason: LabFailure) {
    super(`The Device lab stopped: ${reason}.`);
    this.name = "LabFailed";
    this.reason = reason;
  }
}

/** A stop signal and the function that fires it, once. */
export function stopper(): { signal: StopSignal; abort(): void } {
  const listeners = new Set<() => void>();
  let aborted = false;
  return {
    signal: {
      get aborted() {
        return aborted;
      },
      addEventListener: (_type, listener) => void listeners.add(listener),
      removeEventListener: (_type, listener) => void listeners.delete(listener),
    },
    abort() {
      if (aborted) return;
      aborted = true;
      for (const l of [...listeners]) l();
      listeners.clear();
    },
  };
}

/** The speed probe's thread counts: the plan's first, then 2 and 4, none above the cores the app may use. */
export function sweepThreads(planned: number, allowedCores: number | undefined): number[] {
  const cap = allowedCores ?? MAX_MODEL_THREADS;
  return [planned, ...[2, 4].filter((n) => n !== planned && n <= cap)];
}

/** Steps the progress counts: one per speed count, one per case. */
export function labSteps(planned: number, allowedCores: number | undefined): number {
  return sweepThreads(planned, allowedCores).length + LAB_CASES.length;
}

const bits = (hex: string) => [...BigInt(`0x${hex}`).toString(2)].filter((b) => b === "1").length;

/** `n` threads on the plan's cores: its mask while it has room for them, else none. */
function threadsAt(plan: RuntimePlan, n: number): ThreadPlan {
  return { threads: n, threadsBatch: n, ...(plan.cpuMask && bits(plan.cpuMask) >= n ? { cpuMask: plan.cpuMask } : {}) };
}

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

export interface DeviceLabOptions {
  /** The shipped profile as this phone runs it (its plan's thinking budget and fast route). */
  profile: ModelProfile;
  /** The plan for the cores the app may use now, on screen. */
  plan: RuntimePlan;
  /** How many cores the app may use now; undefined when unknown. */
  allowedCores?: number;
  ports: LabPorts;
  signal: StopSignal;
  onProgress?(p: LabProgress): void;
  /** The model port over an engine: the app's own by default; tests pass a scripted one. */
  port?(engine: CompletionEngine): ModelPort;
}

export async function runDeviceLab(o: DeviceLabOptions): Promise<LabRun> {
  const { ports, signal, profile, plan } = o;
  const counts = sweepThreads(plan.threads, o.allowedCores);
  const steps = counts.length + LAB_CASES.length;
  const startedAt = ports.now();
  const thermal: LabRun["thermal"] = { pauses: 0, pausedMs: 0 };
  const read = () => {
    const s = ports.thermal();
    if (s !== undefined && Number.isFinite(s)) {
      thermal.start ??= s;
      thermal.max = Math.max(thermal.max ?? s, s);
      return s;
    }
    return undefined;
  };
  read();
  let step = 0;
  let current: LabProgress | undefined;
  const announce = (p: LabProgress) => {
    current = p;
    o.onProgress?.(p);
  };
  const checkStop = () => {
    if (signal.aborted) throw new LabStopped();
  };

  /** Waits out a hot phone, counting the pause; a pause past MAX_PAUSE_MS ends the lab. */
  const guard = async () => {
    checkStop();
    let s = read();
    if (s === undefined || s < PAUSE_AT_STATUS) return;
    thermal.pauses++;
    const from = ports.now();
    const resume = current;
    o.onProgress?.({ phase: "paused", step, steps, status: s });
    while (s !== undefined && s > RESUME_AT_STATUS) {
      if (ports.now() - from >= MAX_PAUSE_MS) throw new LabFailed("too_hot");
      await ports.sleep(THERMAL_POLL_MS, signal);
      checkStop();
      s = read();
    }
    thermal.pausedMs += ports.now() - from;
    if (resume) o.onProgress?.(resume);
  };

  const load = async (p: RuntimePlan): Promise<{ engine: LabEngine; loadMs: number }> => {
    const t0 = ports.now();
    try {
      const engine = await ports.load(p);
      return { engine, loadMs: ports.now() - t0 };
    } catch {
      checkStop();
      throw new LabFailed("load");
    }
  };

  let probeIndex = 0;
  /** One speed call, cut at SPEED_CALL_CAP_MS. Its own first message starts with its number, so no cache serves it. */
  const probe = async (engine: LabEngine, maxTokens: number) => {
    const call = stopper();
    const timer = stopper();
    const onStop = () => call.abort();
    signal.addEventListener("abort", onStop, { once: true });
    void ports.sleep(SPEED_CALL_CAP_MS, timer.signal).then(() => {
      if (!timer.signal.aborted) call.abort();
    });
    const t0 = ports.now();
    let first: number | undefined;
    let pieces = 0;
    probeIndex++;
    try {
      const r = await engine.complete({
        messages: [
          { role: "system", content: `Benchmark call ${probeIndex}. Follow the last instruction exactly.` },
          { role: "user", content: `${PROBE_TEXT}\n\n${PROBE_TASK}` },
        ],
        thinking: { enabled: false },
        sampling: profile.sampling,
        maxTokens,
        signal: call.signal,
        onToken: () => {
          first ??= ports.now();
          pieces++;
        },
      });
      const end = ports.now();
      const counted = first !== undefined && pieces > 1 && end > first ? ((pieces - 1) * 1000) / (end - first) : 0;
      return { tokensPerSecond: r.stats?.tokensPerSecond ?? counted, prefill: r.stats?.promptTokensPerSecond, firstMs: first === undefined ? undefined : first - t0, cut: false };
    } catch (err) {
      checkStop();
      if (!call.signal.aborted) throw err;
      // Cut at the cap: what came out before it, by the app's own count.
      const end = ports.now();
      const counted = first !== undefined && pieces > 1 && end > first ? ((pieces - 1) * 1000) / (end - first) : 0;
      return { tokensPerSecond: counted, prefill: undefined, firstMs: first === undefined ? undefined : first - t0, cut: true };
    } finally {
      timer.abort();
      signal.removeEventListener("abort", onStop);
    }
  };

  const speedAt = async (threads: number): Promise<SpeedRun> => {
    await guard();
    const { engine, loadMs } = await load(withThreads(plan, threadsAt(plan, threads)));
    try {
      await guard();
      const warm = await probe(engine, 8).catch((err: unknown) => {
        checkStop();
        throw err instanceof LabFailed ? err : new LabFailed("model");
      });
      // Nothing in a minute: these threads starve the model, and two more calls would only cost two more minutes.
      if (warm.cut && warm.firstMs === undefined) return { threads, tokensPerSecond: 0, loadMs };
      const measured: Array<Awaited<ReturnType<typeof probe>>> = [];
      for (let i = 0; i < 2; i++) {
        await guard();
        measured.push(await probe(engine, PROBE_MAX_TOKENS).catch((err: unknown) => {
          checkStop();
          throw err instanceof LabFailed ? err : new LabFailed("model");
        }));
      }
      const firsts = measured.flatMap((r) => (r.firstMs === undefined ? [] : [r.firstMs]));
      const prefills = measured.flatMap((r) => (r.prefill === undefined ? [] : [r.prefill]));
      return {
        threads,
        tokensPerSecond: mean(measured.map((r) => r.tokensPerSecond)),
        ...(prefills.length ? { prefillTokensPerSecond: mean(prefills) } : {}),
        ...(firsts.length ? { firstTokenMs: mean(firsts) } : {}),
        loadMs,
      };
    } finally {
      await engine.close().catch(() => {});
    }
  };

  const runs: SpeedRun[] = [];
  for (const threads of counts) {
    step++;
    announce({ phase: "speed", step, steps, threads });
    const run = await speedAt(threads);
    // The plan's own count must write: without it there is nothing to compare, so the lab ends here.
    if (!runs.length && (run.firstTokenMs === undefined || !(run.tokensPerSecond > 0))) throw new LabFailed("model");
    runs.push(run);
  }
  const planned = runs[0]!;

  // The accuracy pass at the plan's threads, on the lab's clock.
  const cases: LabCase[] = [];
  checkStop();
  const { engine } = await load(plan);
  try {
    const stoppable: CompletionEngine = { complete: (req) => engine.complete(req.signal ? req : { ...req, signal }) };
    const port = o.port?.(stoppable) ?? createModelPort(stoppable, profile, firstWinSkills, () => ({ language: "en", now: describeNowForModel(LAB_CLOCK.now, LAB_CLOCK.timeZone), profile: [], clock: { now: LAB_CLOCK.now, timeZone: LAB_CLOCK.timeZone } }));
    let failedInRow = 0;
    for (const [i, c] of LAB_CASES.entries()) {
      step++;
      announce({ phase: "eval", step, steps, index: i + 1, count: LAB_CASES.length });
      await guard();
      const t0 = ports.now();
      try {
        const r = await runEval([c], port, { now: LAB_CLOCK.now, timeZone: LAB_CLOCK.timeZone });
        const res = r.results[0]!;
        cases.push({ id: c.id, pass: res.pass, ms: res.ms, choice: res.got.choice });
        failedInRow = 0;
      } catch {
        checkStop();
        cases.push({ id: c.id, pass: false, ms: ports.now() - t0, choice: "other" });
        if (++failedInRow >= BROKEN_AFTER) throw new LabFailed("model");
      }
    }
  } finally {
    await engine.close().catch(() => {});
  }

  return { plan, speed: { planned: { ...planned, firstTokenMs: planned.firstTokenMs ?? 0 }, sweep: runs.slice(1).sort((a, b) => a.threads - b.threads) }, cases, thermal, startedAt, endedAt: ports.now() };
}
