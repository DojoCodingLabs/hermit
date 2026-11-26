import { describe, expect, test } from "vitest";
import type { ModelPort } from "@hermit/core";
import { PROFILES, type CompletionEngine, type EngineRequest, type EngineResult, type RuntimePlan } from "@hermit/model";
import { FakeModel } from "../src/fake-model.ts";
import { FIRST_WIN_CASES } from "../src/first-win-cases.ts";
import {
  LAB_CASES, LAB_CASE_IDS, LabFailed, LabStopped, MAX_PAUSE_MS, PROBE_MAX_TOKENS, SPEED_CALL_CAP_MS, THERMAL_POLL_MS, labSteps, runDeviceLab, stopper, sweepThreads,
  type LabPorts, type LabProgress,
} from "../src/device-lab.ts";

const plan: RuntimePlan = { tier: "mid", device: "cpu", threads: 5, threadsBatch: 5, ctxSize: 8192, ubatch: 512, cacheCheckpoints: 4, thinkingBudget: 256, maxReplyTokens: 120, longReplyTokens: 800, fastRoute: false };
const profile = PROFILES[0]!;

/** A phone in a test: a clock that moves only when the lab waits or the model works, and a scripted model. */
function phone(o: {
  thermal?: number[];
  hot?: number;
  hang?: (threads: number) => boolean;
  onCall?: (n: number, req: EngineRequest) => void;
} = {}) {
  let clock = 1_000_000;
  const queue = [...(o.thermal ?? [])];
  const loads: RuntimePlan[] = [];
  const requests: EngineRequest[] = [];
  let closed = 0;
  let calls = 0;
  const ports: LabPorts = {
    now: () => clock,
    // A timer that fires on the next turn of the event loop, so a call the model answers at once ends first.
    sleep: (ms, signal) => new Promise((resolve) => setTimeout(() => {
      if (!signal.aborted) clock += ms;
      resolve();
    }, 0)),
    thermal: () => queue.shift() ?? o.hot ?? 0,
    load: async (p) => {
      loads.push(p);
      clock += 2000;
      const engine: CompletionEngine & { close(): Promise<void> } = {
        async complete(req): Promise<EngineResult> {
          calls++;
          requests.push(req);
          o.onCall?.(calls, req);
          if (req.signal?.aborted) throw new Error("Stopped by the user.");
          if (o.hang?.(p.threads)) {
            return new Promise((_, reject) => req.signal?.addEventListener("abort", () => reject(new Error("Stopped by the user.")), { once: true }));
          }
          clock += 100;
          for (let i = 0; i < 4; i++) req.onToken?.(" uno,");
          clock += 900;
          return { text: "uno, dos", toolCalls: [], stats: { tokensPerSecond: p.threads * 10, promptTokensPerSecond: p.threads * 40 } };
        },
        async close() {
          closed++;
        },
      };
      return engine;
    },
  };
  return { ports, loads, requests, closed: () => closed, calls: () => calls, now: () => clock };
}

const scripted = (): ModelPort => new FakeModel({ "remind me to buy milk at 5pm": { choice: "remind", args: { text: "buy milk", at: "2026-11-12T17:00" } } });

describe("the lab's cases and thread counts", () => {
  test("12 public first-win cases, 6 in each language, every kind of first action", () => {
    expect(LAB_CASES.map((c) => c.id)).toEqual([...LAB_CASE_IDS]);
    expect(LAB_CASES).toHaveLength(12);
    expect(LAB_CASES.filter((c) => c.lang === "es")).toHaveLength(6);
    for (const c of LAB_CASES) expect(FIRST_WIN_CASES).toContain(c);
    expect(new Set(LAB_CASES.map((c) => c.expect.choice))).toEqual(new Set(["remind", "remember", "recall", "forget", "calendar_read", "calendar_add", "read_messages", "ask_user", "respond"]));
  });

  test("the plan's count first, then 2 and 4, never more than the cores the app may use", () => {
    expect(sweepThreads(5, 6)).toEqual([5, 2, 4]);
    expect(sweepThreads(3, 4)).toEqual([3, 2, 4]);
    expect(sweepThreads(4, 4)).toEqual([4, 2]);
    expect(sweepThreads(2, 3)).toEqual([2]);
    expect(sweepThreads(1, 1)).toEqual([1]);
    // Unknown cores: the plan's own cap.
    expect(sweepThreads(5, undefined)).toEqual([5, 2, 4]);
    expect(labSteps(5, 6)).toBe(15);
  });

  test("a stop signal fires its listeners once and stays aborted", () => {
    const s = stopper();
    let fired = 0;
    s.signal.addEventListener("abort", () => fired++, { once: true });
    s.abort();
    s.abort();
    expect(s.signal.aborted).toBe(true);
    expect(fired).toBe(1);
  });
});

describe("runDeviceLab", () => {
  test("speed at the plan's threads, then at 2 and 4, then the cases on the plan's threads; every engine closes", async () => {
    const p = phone();
    const progress: LabProgress[] = [];
    const run = await runDeviceLab({ profile, plan, allowedCores: 6, ports: p.ports, signal: stopper().signal, onProgress: (e) => progress.push(e), port: scripted });
    expect(p.loads.map((l) => l.threads)).toEqual([5, 2, 4, 5]);
    expect(p.closed()).toBe(4);
    expect(run.plan).toEqual(plan);
    // The runtime's own speeds; the first token from the screen's clock (100 ms after the call started).
    expect(run.speed.planned).toEqual({ threads: 5, tokensPerSecond: 50, prefillTokensPerSecond: 200, firstTokenMs: 100, loadMs: 2000 });
    expect(run.speed.sweep).toEqual([
      { threads: 2, tokensPerSecond: 20, prefillTokensPerSecond: 80, firstTokenMs: 100, loadMs: 2000 },
      { threads: 4, tokensPerSecond: 40, prefillTokensPerSecond: 160, firstTokenMs: 100, loadMs: 2000 },
    ]);
    expect(run.cases.map((c) => c.id)).toEqual([...LAB_CASE_IDS]);
    expect(run.cases.find((c) => c.id === "en-remind-1")).toMatchObject({ pass: true, choice: "remind" });
    expect(run.cases.find((c) => c.id === "es-remind-1")).toMatchObject({ pass: false, choice: "respond" });
    expect(run.thermal).toEqual({ start: 0, max: 0, pauses: 0, pausedMs: 0 });
    expect(run.endedAt).toBeGreaterThan(run.startedAt);
    // Steps count up to the total, speed first.
    expect(progress[0]).toEqual({ phase: "speed", step: 1, steps: 15, threads: 5 });
    expect(progress.at(-1)).toEqual({ phase: "eval", step: 15, steps: 15, index: 12, count: 12 });
  });

  test("the probe is the same fixed prompt every time, with thinking off, a distinct start so no cache serves it, and a token cap", async () => {
    const p = phone();
    await runDeviceLab({ profile, plan, allowedCores: 6, ports: p.ports, signal: stopper().signal, port: scripted });
    // Three counts, each a warm-up call and two measured ones.
    const probes = p.requests.slice(0, 9);
    expect(probes.every((r) => r.thinking.enabled === false)).toBe(true);
    expect(probes.map((r) => r.maxTokens)).toEqual([8, PROBE_MAX_TOKENS, PROBE_MAX_TOKENS, 8, PROBE_MAX_TOKENS, PROBE_MAX_TOKENS, 8, PROBE_MAX_TOKENS, PROBE_MAX_TOKENS]);
    expect(new Set(probes.map((r) => r.messages[0]!.content)).size).toBe(9);
    expect(new Set(probes.map((r) => r.messages[1]!.content)).size).toBe(1);
  });

  test("a hot phone pauses until it cools, and the run counts the pause", async () => {
    // Read at the start (0), then hot (3), still warm (2), then cool enough (1).
    const p = phone({ thermal: [0, 3, 2, 1] });
    const progress: LabProgress[] = [];
    const run = await runDeviceLab({ profile, plan, allowedCores: 6, ports: p.ports, signal: stopper().signal, onProgress: (e) => progress.push(e), port: scripted });
    expect(run.thermal).toEqual({ start: 0, max: 3, pauses: 1, pausedMs: 2 * THERMAL_POLL_MS });
    expect(progress.some((e) => e.phase === "paused")).toBe(true);
  });

  test("a phone that stays hot stops the lab", async () => {
    const p = phone({ hot: 4 });
    await expect(runDeviceLab({ profile, plan, allowedCores: 6, ports: p.ports, signal: stopper().signal, port: scripted })).rejects.toMatchObject({ name: "LabFailed", reason: "too_hot" });
    expect(p.now() - 1_000_000).toBeGreaterThanOrEqual(MAX_PAUSE_MS);
    expect(p.closed()).toBe(p.loads.length);
  });

  test("Stop ends the run at once: the call in flight is cancelled and the engine closes", async () => {
    const stop = stopper();
    const p = phone({ onCall: (n) => n === 2 && stop.abort() });
    await expect(runDeviceLab({ profile, plan, allowedCores: 6, ports: p.ports, signal: stop.signal, port: scripted })).rejects.toBeInstanceOf(LabStopped);
    expect(p.calls()).toBe(2);
    expect(p.closed()).toBe(p.loads.length);
  });

  test("a speed call that never ends is cut at the cap: at another count it records 0, at the plan's count the lab fails", async () => {
    const slow = phone({ hang: (threads) => threads === 4 });
    const run = await runDeviceLab({ profile, plan, allowedCores: 6, ports: slow.ports, signal: stopper().signal, port: scripted });
    expect(run.speed.sweep.find((s) => s.threads === 4)).toEqual({ threads: 4, tokensPerSecond: 0, loadMs: 2000 });
    expect(slow.now() - 1_000_000).toBeGreaterThanOrEqual(SPEED_CALL_CAP_MS);

    const stuck = phone({ hang: (threads) => threads === 5 });
    await expect(runDeviceLab({ profile, plan, allowedCores: 6, ports: stuck.ports, signal: stopper().signal, port: scripted })).rejects.toMatchObject({ name: "LabFailed", reason: "model" });
    expect(stuck.closed()).toBe(stuck.loads.length);
  });

  test("a model that won't load fails the lab as a load failure", async () => {
    const p = phone();
    const ports: LabPorts = { ...p.ports, load: async () => { throw new Error("out of memory"); } };
    await expect(runDeviceLab({ profile, plan, allowedCores: 6, ports, signal: stopper().signal, port: scripted })).rejects.toMatchObject({ name: "LabFailed", reason: "load" });
  });

  test("one case that throws counts as wrong and the run goes on; three in a row mean the model broke", async () => {
    const once = (): ModelPort => {
      const base = scripted();
      return { ...base, pick: async (input) => {
        if (input.messages.at(-1)?.content === LAB_CASES[2]!.input) throw new Error("bad output");
        return base.pick(input);
      } };
    };
    const run = await runDeviceLab({ profile, plan, allowedCores: 6, ports: phone().ports, signal: stopper().signal, port: once });
    expect(run.cases[2]).toMatchObject({ id: LAB_CASES[2]!.id, pass: false, choice: "other" });
    expect(run.cases).toHaveLength(12);

    const broken = (): ModelPort => ({ ...scripted(), pick: async () => { throw new Error("worker gone"); } });
    const p = phone();
    await expect(runDeviceLab({ profile, plan, allowedCores: 6, ports: p.ports, signal: stopper().signal, port: broken })).rejects.toMatchObject({ name: "LabFailed", reason: "model" });
    expect(p.closed()).toBe(p.loads.length);
  });

  test("errors are the lab's own types", () => {
    expect(new LabFailed("too_hot")).toBeInstanceOf(Error);
    expect(new LabStopped().name).toBe("LabStopped");
  });
});
