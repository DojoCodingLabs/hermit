import { expect, test } from "vitest";
import { isOutcome, OUTCOMES, outcomeCopyKey } from "../src/errors.ts";

test("every outcome has a copy key under common.outcome (CT-04)", () => {
  for (const o of OUTCOMES) expect(outcomeCopyKey(o)).toBe(`common.outcome.${o}`);
  expect(isOutcome("stale")).toBe(true);
  expect(isOutcome("segfault")).toBe(false);
});
