/** SL-35 (US-FORM-01, US-FORM-03, Q79): every form fill is a cage decision, and the cage never fills without asking. */
import { describe, expect, test } from "vitest";
import { argsHash, skillId, type SessionState, type ToolCall } from "@hermit/core";
import { decide, defaultRules, FILL_FORM, fillRules } from "../src/policy.ts";

const call = (args: Record<string, unknown>): ToolCall => ({ id: "f1", skill: FILL_FORM, args, argsHash: argsHash(args), repairs: [] });
const session = (over: Partial<SessionState> = {}): SessionState => ({ id: "autofill", taint: [], unattended: false, ...over });

describe("fill rules", () => {
  test("a fill of plain fields asks, with no fingerprint (US-FORM-03, Q90)", () => {
    const d = decide(call({ requester: "https://shop.example", fields: [{ key: "0", kind: "email" }], sensitive: false }), "send", session(), fillRules());
    expect(d).toMatchObject({ effect: "ask", ruleId: "fill-asks", requireBiometric: false });
  });

  test("a fill with a sensitive field asks with the fingerprint", () => {
    const d = decide(call({ requester: "https://shop.example", fields: [{ key: "0", kind: "id_number" }], sensitive: true }), "send", session(), fillRules());
    expect(d).toMatchObject({ effect: "ask", ruleId: "fill-sensitive-asks", requireBiometric: true });
  });

  test("nobody on screen (a night pass, a headless task): denied, never filled", () => {
    for (const sensitive of [false, true]) {
      const d = decide(call({ requester: "https://shop.example", fields: [], sensitive }), "send", session({ unattended: true }), fillRules());
      expect(d.effect).toBe("deny");
    }
  });

  test("the rules never allow a fill outright, and apply to the fill only", () => {
    expect(fillRules().every((r) => r.effect === "ask" && r.skill === FILL_FORM)).toBe(true);
    expect(decide({ ...call({}), skill: skillId("reply_message") }, "send", session(), fillRules()).effect).toBe("deny");
  });

  test("the fill is not a skill the default rules know: the model's menu can't reach it", () => {
    // With the default rules a call named fill_form is a send like any other: it asks with the fingerprint.
    const d = decide(call({ sensitive: false }), "send", session(), defaultRules());
    expect(d).toMatchObject({ effect: "ask", requireBiometric: true });
  });
});
