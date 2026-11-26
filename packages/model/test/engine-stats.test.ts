import { describe, expect, test } from "vitest";
import { engineStats } from "../src/engine.ts";

describe("engineStats", () => {
  test("keeps the runtime's speeds and counts, renaming its time to the first token", () => {
    expect(engineStats({ tokensPerSecond: 41.2, promptTokensPerSecond: 182.5, timeToFirstToken: 310, promptTokens: 352, generatedTokens: 64, cacheTokens: 0, backendDevice: "cpu" })).toEqual({
      tokensPerSecond: 41.2,
      promptTokensPerSecond: 182.5,
      timeToFirstTokenMs: 310,
      promptTokens: 352,
      generatedTokens: 64,
    });
  });

  test("drops what isn't a finite, non-negative number, and gives nothing when nothing is left", () => {
    expect(engineStats({ tokensPerSecond: Number.NaN, promptTokensPerSecond: -1, generatedTokens: "64" })).toBeUndefined();
    expect(engineStats({ tokensPerSecond: Infinity, generatedTokens: 12 })).toEqual({ generatedTokens: 12 });
    expect(engineStats(undefined)).toBeUndefined();
    expect(engineStats("fast")).toBeUndefined();
  });
});
