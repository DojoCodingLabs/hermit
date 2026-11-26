// The harness results on the home page are published numbers: these tests pin them, so a change is deliberate.
import { describe, expect, test } from "vitest";
import { EVAL_SETS, FIRST_ACTION_SECONDS, MODEL, MODEL_CALLS, gain, share } from "../lib/harness";

describe("the harness results", () => {
  test("the same model in every run", () => {
    expect(MODEL).toBe("BotPsy-0.8B");
  });

  test("tasks done right, generic setup against Hermit's harness", () => {
    const rows = EVAL_SETS.map((s) => [s.id, s.generic, s.harness, s.total]);
    expect(rows).toEqual([
      ["Phone", 21, 39, 40],
      ["Mac", 22, 40, 40],
      ["Dev", 55, 85, 90],
      ["Blind", 73, 93, 100],
    ]);
    expect(EVAL_SETS.map(gain)).toEqual([45, 45, 33, 20]);
    for (const s of EVAL_SETS) expect(share(s.harness, s.total)).toBeLessThanOrEqual(100);
  });

  test("model calls and the time to the first action", () => {
    expect(MODEL_CALLS).toEqual({ fewerPercent: 38, conversations: 120 });
    expect(FIRST_ACTION_SECONDS).toBe(13.5);
  });
});
