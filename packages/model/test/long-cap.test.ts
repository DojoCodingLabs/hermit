import { describe, expect, test } from "vitest";
import { PROFILES } from "../src/profile.ts";
import { budgetFor, generationBudget, initialPlan, longReplyCap, profileForPlan, type HardwareFacts } from "../src/runtime.ts";

const GB = 1024 ** 3;
const s26: HardwareFacts = {
  platform: "android", model: "SM-S948B", soc: "SM8850", totalRamBytes: 12 * GB, logicalCores: 8,
  clusters: [{ cpus: [6, 7], maxFreqKHz: 4_600_000 }, { cpus: [0, 1, 2, 3, 4, 5], maxFreqKHz: 3_600_000 }],
  cpuFeatures: { dotprod: true, i8mm: true, sme2: true },
};
const floorPhone: HardwareFacts = { ...s26, model: "floor", totalRamBytes: 3.5 * GB, clusters: [{ cpus: [4, 5], maxFreqKHz: 2_000_000 }, { cpus: [0, 1, 2, 3], maxFreqKHz: 1_800_000 }], cpuFeatures: { dotprod: true, i8mm: false } };
const cool = { thermal: "nominal" as const, lowPowerMode: false, memoryPressure: "none" as const };

// Q155: a long answer the user asked for gets about 800 tokens, only while the phone is cool and has memory headroom;
// otherwise the normal cap holds and Seguir covers the rest.
describe("the long cap", () => {
  test("only while cool, with no battery saver and no memory pressure", () => {
    const plan = initialPlan(s26);
    expect(budgetFor(plan, cool)).toEqual({ thinkingBudget: 256, maxReplyTokens: 120, longReplyTokens: 800 });
    // Warming up, saving battery, short of memory, hot or paging: the normal cap for that moment.
    expect(budgetFor(plan, { ...cool, thermal: "fair" }).longReplyTokens).toBe(120);
    expect(budgetFor(plan, { ...cool, thermalHeadroom: 0.75 }).longReplyTokens).toBe(120);
    expect(budgetFor(plan, { ...cool, lowPowerMode: true }).longReplyTokens).toBe(80);
    expect(budgetFor(plan, { ...cool, memoryPressure: "moderate" }).longReplyTokens).toBe(80);
    expect(budgetFor(plan, { ...cool, thermal: "serious" }).longReplyTokens).toBe(80);
    expect(budgetFor(plan, { ...cool, thermal: "critical" }).longReplyTokens).toBe(60);
    expect(budgetFor(plan, { ...cool, memoryPressure: "critical" }).longReplyTokens).toBe(60);
  });

  test("slower tiers get less of it; the floor stays close to the normal cap", () => {
    expect(initialPlan(s26).longReplyTokens).toBe(800);
    expect(initialPlan(floorPhone).tier).toBe("floor");
    expect(initialPlan(floorPhone).longReplyTokens).toBe(300);
  });

  test("a long-form request gets the long cap on the phone; any other reply keeps the normal one", () => {
    const budget = budgetFor(initialPlan(s26), cool);
    expect(generationBudget({ maxTokens: 800, thinking: { enabled: false }, longForm: true }, budget)).toEqual({ predict: 800, thinkTokens: 0, replyCap: 800 });
    expect(generationBudget({ maxTokens: 800, thinking: { enabled: false } }, budget)).toEqual({ predict: 120, thinkTokens: 0, replyCap: 120 });
    // Hot: the long-form request falls back to the hot cap.
    const hot = budgetFor(initialPlan(s26), { ...cool, thermal: "serious" });
    expect(generationBudget({ maxTokens: 800, thinking: { enabled: false }, longForm: true }, hot)).toEqual({ predict: 80, thinkTokens: 0, replyCap: 80 });
  });

  test("the profile on a phone knows the context its plan loads", () => {
    const base = PROFILES[0]!;
    expect(profileForPlan(base, initialPlan(s26)).contextTokens).toBe(8192);
    expect(profileForPlan(base, initialPlan(floorPhone)).contextTokens).toBe(4096);
    expect(profileForPlan(base, initialPlan(s26)).longReplyTokens).toBe(800);
  });

  test("S26, 2026-11-21: \"La alarma ha sido configurada para tomar agua en\": the reply's tokens went to thinking; now thinking has its own", () => {
    // QVAC's predict counts reasoning tokens too. Master gave the reply prompt predict 120 with thinking up to 256, so
    // a reply that thought 111 tokens had nine words left for its words and stopped mid-sentence.
    const words = "La alarma ha sido configurada para tomar agua en 30 minutos .".split(" ");
    const written = (predict: number, thought: number) => words.slice(0, Math.max(0, predict - thought)).join(" ");
    const masterPredict = Math.min(120, budgetFor(initialPlan(s26), cool).maxReplyTokens);
    expect(written(masterPredict, 111)).toBe("La alarma ha sido configurada para tomar agua en");
    const { predict, replyCap } = generationBudget({ maxTokens: 120, thinking: { enabled: true, budgetTokens: 256 } }, budgetFor(initialPlan(s26), cool));
    expect(replyCap).toBe(120);
    expect(written(predict, 111)).toBe(words.join(" "));
  });

  test("about 800 tokens, never more than the context leaves after the prompt with a margin, never under the normal cap", () => {
    const p = PROFILES[0]!;
    expect(p.longReplyTokens).toBe(800);
    // A short chat leaves plenty of room.
    expect(longReplyCap(p, 6_000)).toBe(800);
    // A long history: what is left after the prompt (read as 3 characters a token, which over-counts) and a 512 margin.
    expect(longReplyCap(p, 21_000)).toBe(8192 - 7000 - 512);
    // Nearly full: the normal cap, and Seguir goes on from there.
    expect(longReplyCap(p, 24_000)).toBe(120);
    // A profile with no long cap answers at its normal cap.
    expect(longReplyCap({ ...p, longReplyTokens: undefined }, 1_000)).toBe(120);
  });
});
