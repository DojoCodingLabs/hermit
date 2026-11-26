import { describe, expect, test } from "vitest";
import { stopOf } from "../src/engine.ts";
import { generationBudget } from "../src/runtime.ts";

// Q155: a reply that used up its token budget is cut, and nothing may hide that. The engine says why each completion
// ended; a stop the user asked for is not one of these (the call rejects).
describe("why a completion ended", () => {
  test("QVAC's own stop reason wins: length is cut, eos and a stop sequence finished, an unasked cancel is cut short", () => {
    expect(stopOf({ stopReason: "length", generatedTokens: 120 }, 120)).toBe("length");
    expect(stopOf({ stopReason: "eos", generatedTokens: 40 }, 120)).toBe("end");
    expect(stopOf({ stopReason: "stopSequence", generatedTokens: 40 }, 120)).toBe("end");
    expect(stopOf({ stopReason: "cancelled", generatedTokens: 40 }, 120)).toBe("cancelled");
    // A reason wins over the count: eos right at the budget finished, length below it did not.
    expect(stopOf({ stopReason: "eos", generatedTokens: 120 }, 120)).toBe("end");
    expect(stopOf({ stopReason: "length", generatedTokens: 30 }, 120)).toBe("length");
  });

  test("without a reason, the generated count against the budget decides; unknown is never reported as cut", () => {
    expect(stopOf({ generatedTokens: 120 }, 120)).toBe("length");
    expect(stopOf({ generatedTokens: 121 }, 120)).toBe("length");
    expect(stopOf({ generatedTokens: 119 }, 120)).toBe("end");
    expect(stopOf({}, 120)).toBe("end");
    expect(stopOf(undefined, 120)).toBe("end");
    // An unknown reason is read by the count, never trusted blindly.
    expect(stopOf({ stopReason: "maxToolTurns", generatedTokens: 120 }, 120)).toBe("length");
  });
});

// What each request may generate on the phone: thinking has its own budget on top of the words the user reads, as
// on the Mac lab (max_tokens = maxTokens + the thinking budget). Before Q155 the phone's predict counted both, so a
// reply prompt with thinking on could spend its 120 tokens thinking and show nothing.
describe("the token budget a request gets", () => {
  const text = (maxTokens: number, think?: number) => ({ maxTokens, thinking: think === undefined ? { enabled: false } : { enabled: true, budgetTokens: think } });
  const cool = { thinkingBudget: 256, maxReplyTokens: 120, longReplyTokens: 800 };
  const hot = { thinkingBudget: 0, maxReplyTokens: 60, longReplyTokens: 60 };

  test("a free-text reply is held to the device's reply cap, and thinking comes on top of it", () => {
    expect(generationBudget(text(120), cool)).toEqual({ predict: 120, thinkTokens: 0, replyCap: 120 });
    expect(generationBudget(text(120, 256), cool)).toEqual({ predict: 376, thinkTokens: 256, replyCap: 120 });
    // The out-of-scope answer asks for 400; the device's cap holds it to 120.
    expect(generationBudget(text(400, 256), cool)).toEqual({ predict: 376, thinkTokens: 256, replyCap: 120 });
    // Hot: no thinking, and the short cap.
    expect(generationBudget(text(120, 256), hot)).toEqual({ predict: 60, thinkTokens: 0, replyCap: 60 });
  });

  test("calls with tools or a schema keep the caller's own budget, thinking included, as before", () => {
    expect(generationBudget({ ...text(512, 256), tools: [{}] }, cool)).toEqual({ predict: 512, thinkTokens: 256, replyCap: 512 });
    expect(generationBudget({ ...text(300), jsonSchema: {} }, cool)).toEqual({ predict: 300, thinkTokens: 0, replyCap: 300 });
  });

  test("without a device plan the request's own numbers stand; unbounded thinking gets the lab's 2,048 on top", () => {
    expect(generationBudget(text(120, 256), undefined)).toEqual({ predict: 376, thinkTokens: 256, replyCap: 120 });
    expect(generationBudget({ maxTokens: 120, thinking: { enabled: true } }, undefined)).toEqual({ predict: 2168, thinkTokens: Infinity, replyCap: 120 });
    // A prefill reads the prompt and writes nothing.
    expect(generationBudget({ ...text(0), prefill: true }, cool)).toEqual({ predict: 0, thinkTokens: 0, replyCap: 0 });
  });
});
