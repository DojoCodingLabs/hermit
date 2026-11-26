import { describe, expect, test } from "vitest";
import {
  allowedCpuSet,
  applyCandidate,
  budgetFor,
  calibrate,
  cpuListText,
  profileForPlan,
  candidatesFor,
  cpuMask,
  initialPlan,
  MAX_MODEL_THREADS,
  pickBest,
  threadPlan,
  threadsFor,
  threadsReload,
  tierFor,
  withThreads,
  type HardwareFacts,
} from "../src/runtime.ts";

const GB = 1024 ** 3;
// Galaxy S26 (SM8850): 2 prime cores at 4.6 GHz and 6 performance cores at 3.6 GHz, no little cores.
const s26: HardwareFacts = {
  platform: "android", model: "SM-S948B", soc: "SM8850", totalRamBytes: 12 * GB, logicalCores: 8,
  clusters: [{ cpus: [6, 7], maxFreqKHz: 4_600_000 }, { cpus: [0, 1, 2, 3, 4, 5], maxFreqKHz: 3_600_000 }],
  cpuFeatures: { dotprod: true, i8mm: true, sme2: true },
};
// A mid-range big.LITTLE phone: 1 + 3 fast cores, 4 Cortex-A55 at 2.0 GHz, 6 GB, no i8mm.
const midrange: HardwareFacts = {
  platform: "android", model: "mid", totalRamBytes: 6 * GB, logicalCores: 8,
  clusters: [{ cpus: [7], maxFreqKHz: 2_800_000 }, { cpus: [4, 5, 6], maxFreqKHz: 2_400_000 }, { cpus: [0, 1, 2, 3], maxFreqKHz: 2_000_000 }],
  cpuFeatures: { dotprod: true, i8mm: false },
};
const old: HardwareFacts = { platform: "android", model: "old", totalRamBytes: 2 * GB, logicalCores: 4, clusters: [], cpuFeatures: { dotprod: false, i8mm: false } };

describe("device-adaptive runtime", () => {
  test("tiers", () => {
    expect(tierFor(s26)).toBe("high");
    expect(tierFor(midrange)).toBe("low");
    expect(tierFor({ ...midrange, totalRamBytes: 3.5 * GB })).toBe("floor");
    expect(tierFor(old)).toBe("unsupported");
    expect(tierFor({ platform: "ios", model: "iPhone16,1", totalRamBytes: 8 * GB, logicalCores: 6, clusters: [], cpuFeatures: { dotprod: true, i8mm: true }, performanceCores: 2 })).toBe("high");
  });

  test("with its allowed cores unknown the S26 runs the stopgap's 5 threads (8 spin-waited); a big.LITTLE phone skips its A55s", () => {
    expect(initialPlan(s26)).toMatchObject({ tier: "high", device: "cpu", threads: 5, threadsBatch: 5, thinkingBudget: 256 });
    expect(initialPlan(s26).cpuMask).toBeUndefined();
    const p = initialPlan(midrange);
    expect(p).toMatchObject({ threads: 4, cpuMask: cpuMask([4, 5, 6, 7]), thinkingBudget: 192 });
    expect(cpuMask([4, 5, 6, 7])).toBe("f0");
  });

  test("calibration candidates are few and distinct; the fastest sane one wins", () => {
    const plan = initialPlan(midrange);
    const cands = candidatesFor(midrange, plan);
    expect(cands.length).toBeGreaterThan(1);
    expect(cands.length).toBeLessThanOrEqual(4);
    expect(new Set(cands.map((c) => JSON.stringify(c))).size).toBe(cands.length);
    const results = [
      { candidate: cands[0]!, prefillTokPerSec: 300, decodeTokPerSec: 25, sanityPassed: true, thermalAtStart: "nominal" as const },
      { candidate: cands[1]!, prefillTokPerSec: 400, decodeTokPerSec: 30, sanityPassed: true, thermalAtStart: "nominal" as const },
      { candidate: cands[2]!, prefillTokPerSec: 900, decodeTokPerSec: 60, sanityPassed: false, thermalAtStart: "nominal" as const }, // broke grammar
    ];
    expect(pickBest(results)).toEqual(cands[1]);
    expect(applyCandidate(plan, cands[1]!).threads).toBe(cands[1]!.threads);
    expect(pickBest([])).toBeUndefined();
  });

  test("heat and battery shrink thinking first, never below 64 until critical", () => {
    const plan = initialPlan(s26);
    const base = { thermal: "nominal" as const, lowPowerMode: false, memoryPressure: "none" as const };
    expect(budgetFor(plan, base)).toEqual({ thinkingBudget: 256, maxReplyTokens: 120, longReplyTokens: 800 });
    expect(budgetFor(plan, { ...base, thermal: "fair" }).thinkingBudget).toBe(192);
    expect(budgetFor(plan, { ...base, lowPowerMode: true })).toEqual({ thinkingBudget: 128, maxReplyTokens: 80, longReplyTokens: 80 });
    expect(budgetFor(plan, { ...base, thermalHeadroom: 0.9 }).thinkingBudget).toBe(128);
    expect(budgetFor(plan, { ...base, thermal: "critical" })).toEqual({ thinkingBudget: 0, maxReplyTokens: 60, longReplyTokens: 60 });
  });

  test("memory pressure seen as slow generation: moderate halves thinking, critical (paging) drops it", () => {
    const plan = initialPlan(s26);
    const base = { thermal: "nominal" as const, lowPowerMode: false, memoryPressure: "none" as const };
    expect(budgetFor(plan, { ...base, memoryPressure: "moderate" })).toEqual({ thinkingBudget: 128, maxReplyTokens: 80, longReplyTokens: 80 });
    expect(budgetFor(plan, { ...base, memoryPressure: "critical" })).toEqual({ thinkingBudget: 0, maxReplyTokens: 60, longReplyTokens: 60 });
  });

  test("slow tiers take the fast route and a smaller thinking budget; fast phones keep full thinking", async () => {
    const { PROFILES } = await import("../src/profile.ts");
    const base = PROFILES[0]!;
    expect(profileForPlan(base, initialPlan(s26))).toMatchObject({ fastRoute: false, thinking: { mode: "on", budgetTokens: 256 } });
    expect(profileForPlan(base, initialPlan(midrange))).toMatchObject({ fastRoute: true, thinking: { mode: "on", budgetTokens: 192 } });
  });

  test("calibration keeps the fastest sane candidate, survives a crashing one, and skips when hot", async () => {
    const plan = initialPlan(midrange);
    const nominal = { thermal: "nominal" as const, lowPowerMode: false, memoryPressure: "none" as const };
    const out = await calibrate(midrange, plan, nominal, async (c) => {
      // The unmasked control (it would also run on the A55s) fails to load.
      if (!c.cpuMask) throw new Error("load failed");
      return { prefillTokPerSec: 100 * c.threads, decodeTokPerSec: 5 * c.threads, sanityPassed: true };
    });
    expect(out.results.some((r) => !r.sanityPassed)).toBe(true);
    expect(out.plan.threads).toBe(4);
    expect((await calibrate(midrange, plan, { ...nominal, thermal: "serious" }, async () => { throw new Error("never"); })).skipped).toBe("hot");
  });
});

// Android's cpusets on the Galaxy S26 Ultra (2026-11-24): an app on screen got "foreground" (0-5) although 8 cores were
// online; "top-app" is 0-7; "background" and "system-background" are 0-1,4-5.
const cores = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => from + i);
const FOREGROUND = cores(0, 5);
const TOP_APP = cores(0, 7);
const BACKGROUND = [0, 1, 4, 5];
// A phone with four equal cores.
const quad: HardwareFacts = {
  platform: "android", model: "quad", totalRamBytes: 4 * GB, logicalCores: 4,
  clusters: [{ cpus: [0, 1, 2, 3], maxFreqKHz: 2_000_000 }], cpuFeatures: { dotprod: true, i8mm: false },
};
/** The cores a hex mask names. */
const maskCores = (hex: string) => [...BigInt(`0x${hex}`).toString(2)].reverse().flatMap((bit, i) => (bit === "1" ? [i] : []));

describe("threads follow the cores Android allows", () => {
  test("the S26 on screen (foreground, 0-5) runs 5 threads, one core left for the interface", () => {
    expect(threadPlan(s26, FOREGROUND)).toEqual({ threads: 5, threadsBatch: 5 });
    expect(initialPlan({ ...s26, allowedCpus: FOREGROUND })).toMatchObject({ tier: "high", threads: 5, threadsBatch: 5, thinkingBudget: 256 });
    expect(initialPlan({ ...s26, allowedCpus: FOREGROUND }).cpuMask).toBeUndefined();
  });

  test("with all 8 allowed (top-app) the cap from the measurements holds", () => {
    expect(MAX_MODEL_THREADS).toBe(5);
    expect(threadPlan(s26, TOP_APP)).toEqual({ threads: MAX_MODEL_THREADS, threadsBatch: MAX_MODEL_THREADS });
  });

  test("in the background (0-1,4-5) the S26 runs 3, and a 4-core phone runs 3", () => {
    expect(threadPlan(s26, BACKGROUND)).toEqual({ threads: 3, threadsBatch: 3 });
    expect(threadPlan(quad, [0, 1, 2, 3])).toEqual({ threads: 3, threadsBatch: 3 });
    expect(initialPlan({ ...quad, allowedCpus: [0, 1, 2, 3] })).toMatchObject({ threads: 3, threadsBatch: 3 });
  });

  test("allowed cores that are unknown fall back to the stopgap: the rules' count, at most 5", () => {
    for (const unknown of [undefined, [], [-1], [Number.NaN, 2.5]]) expect(threadPlan(s26, unknown)).toEqual({ threads: 5, threadsBatch: 5 });
    expect(threadPlan(quad, undefined)).toEqual({ threads: 4, threadsBatch: 4 });
    expect(threadPlan({ ...quad, clusters: [] }, undefined)).toEqual({ threads: 4, threadsBatch: 4 });
    expect(threadPlan(midrange, undefined)).toEqual({ threads: 4, threadsBatch: 4, cpuMask: "f0" });
  });

  test("one allowed core still runs one thread", () => {
    expect(threadPlan(s26, [3])).toEqual({ threads: 1, threadsBatch: 1 });
  });

  test("on a big.LITTLE phone the mask holds the allowed fast cores, never a core outside the set", () => {
    // All 8 allowed: the 4 fast cores, masked off the A55s.
    expect(threadPlan(midrange, TOP_APP)).toEqual({ threads: 4, threadsBatch: 4, cpuMask: "f0" });
    // Two of the fast cores allowed: those two.
    expect(threadPlan(midrange, FOREGROUND)).toEqual({ threads: 2, threadsBatch: 2, cpuMask: "30" });
    // Only A55s allowed (a background set): the fastest allowed ones count, and the cpuset already holds them.
    expect(threadPlan(midrange, [0, 1, 2, 3])).toEqual({ threads: 3, threadsBatch: 3 });
    for (const set of [TOP_APP, FOREGROUND, BACKGROUND, [4, 5, 6, 7], [6, 7], [7], [0, 7]]) {
      for (const f of [s26, midrange, quad]) {
        const p = threadPlan(f, set);
        expect(p.threads).toBeGreaterThanOrEqual(1);
        expect(p.threads).toBeLessThanOrEqual(Math.max(1, Math.min(set.length - 1, MAX_MODEL_THREADS)));
        expect(p.threadsBatch).toBe(p.threads);
        if (p.cpuMask) {
          expect(maskCores(p.cpuMask).every((c) => set.includes(c))).toBe(true);
          expect(maskCores(p.cpuMask).length).toBeGreaterThanOrEqual(p.threads);
        }
      }
    }
  });

  test("a loaded engine reloads when the set no longer fits its threads, and when it fits more again", () => {
    const fg = threadPlan(s26, FOREGROUND);
    const bg = threadPlan(s26, BACKGROUND);
    expect(threadsReload(fg, s26, BACKGROUND)).toEqual({ threads: 3, threadsBatch: 3 });
    expect(threadsReload(bg, s26, FOREGROUND)).toEqual({ threads: 5, threadsBatch: 5 });
    // On screen, foreground and top-app both run 5: nothing to reload.
    expect(threadsReload(fg, s26, TOP_APP)).toBeUndefined();
    expect(threadsReload(fg, s26, FOREGROUND)).toBeUndefined();
    // Cores that can't be read now keep the engine as it is.
    expect(threadsReload(bg, s26, undefined)).toBeUndefined();
    expect(threadsReload(bg, s26, [])).toBeUndefined();
    // A mask that names cores outside the new set goes, and one the new set needs comes.
    expect(threadsReload(threadPlan(midrange, FOREGROUND), midrange, TOP_APP)).toEqual({ threads: 4, threadsBatch: 4, cpuMask: "f0" });
    expect(threadsReload(threadPlan(midrange, TOP_APP), midrange, [0, 1, 2, 3])).toEqual({ threads: 3, threadsBatch: 3 });
    // iOS has no cpusets.
    expect(threadsReload(fg, { ...s26, platform: "ios" }, BACKGROUND)).toBeUndefined();
  });

  test("a reload changes the plan's threads and mask, nothing else", () => {
    const plan = initialPlan({ ...midrange, allowedCpus: TOP_APP });
    const bg = withThreads(plan, threadPlan(midrange, [0, 1, 2, 3]));
    expect(bg).toEqual({ ...plan, threads: 3, threadsBatch: 3, cpuMask: undefined });
    expect("cpuMask" in bg).toBe(false);
    expect(withThreads(bg, threadPlan(midrange, TOP_APP))).toEqual(plan);
  });

  test("calibration candidates stay within the allowed cores", () => {
    for (const allowedCpus of [FOREGROUND, TOP_APP, BACKGROUND]) {
      const f = { ...s26, allowedCpus };
      for (const c of candidatesFor(f, initialPlan(f))) {
        expect(c.threads).toBeLessThanOrEqual(allowedCpus.length);
        if (c.cpuMask) expect(maskCores(c.cpuMask).every((x) => allowedCpus.includes(x))).toBe(true);
      }
    }
    // Cores unknown: never the 8 threads that ran at 0.2 tok/s.
    for (const c of candidatesFor(s26, initialPlan(s26))) expect(c.threads).toBeLessThanOrEqual(MAX_MODEL_THREADS);
  });

  test("heat never raises threads above the plan", () => {
    const hot = { thermal: "serious" as const, lowPowerMode: false, memoryPressure: "none" as const };
    expect(threadsFor(initialPlan({ ...s26, allowedCpus: FOREGROUND }), hot, true)).toBe(3);
    expect(threadsFor(initialPlan({ ...s26, allowedCpus: BACKGROUND }), hot, true)).toBe(2);
    expect(threadsFor(initialPlan({ ...s26, allowedCpus: [2] }), hot, true)).toBe(1);
    expect(threadsFor(initialPlan({ ...s26, allowedCpus: FOREGROUND }), hot, false)).toBe(5);
  });

  test("the allowed set is read as distinct valid cores and written the way the kernel writes it", () => {
    expect(allowedCpuSet([5, 4, 1, 0, 1])).toEqual([0, 1, 4, 5]);
    expect(allowedCpuSet([])).toBeUndefined();
    expect(allowedCpuSet(undefined)).toBeUndefined();
    expect(allowedCpuSet([-1, 1.5, Number.NaN, 4096])).toBeUndefined();
    expect(cpuListText([0, 1, 4, 5])).toBe("0-1,4-5");
    expect(cpuListText(FOREGROUND)).toBe("0-5");
    expect(cpuListText([3])).toBe("3");
    expect(cpuListText([0, 2, 3, 4, 7])).toBe("0,2-4,7");
    expect(cpuListText(undefined)).toBe("unknown");
  });
});
