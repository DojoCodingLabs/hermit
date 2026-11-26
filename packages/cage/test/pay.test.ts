import { describe, expect, test } from "vitest";
import { argsHash, skillId, type SessionState, type ToolCall } from "@hermit/core";
import { decide, defaultRules, PAY, PAY_MERCHANT, payRules, webTaskRules, withPay } from "../src/policy.ts";

// SL-40 (US-PAY-05, FR-CAGE-02, PDR-011): `pay` is the one spend skill the chat may ask for. Every other spend stays
// floor-denied, and the hard limits still deny a payment in a tainted or unattended session.

const call = (skill: string, args: Record<string, unknown> = { to: "0x1111111111111111111111111111111111111111", amount: "5" }): ToolCall => ({
  id: "c1", skill: skillId(skill), args, argsHash: argsHash(args), repairs: [],
});
const session = (over: Partial<SessionState> = {}): SessionState => ({ id: "s1", taint: [], unattended: false, ...over });
const rules = () => withPay(defaultRules());

describe("pay in the cage", () => {
  test("pay always asks, with the fingerprint and a Keystore-signed approval", () => {
    const d = decide(call(PAY), "spend", session(), rules());
    expect(d).toMatchObject({ effect: "ask", requireBiometric: true, signedApproval: true });
  });

  test("under the default rules the floor still denies it", () => {
    expect(decide(call(PAY), "spend", session(), defaultRules())).toMatchObject({ effect: "deny", ruleId: "hard-floor" });
  });

  test("payRules alone can't lift the floor: only withPay narrows it", () => {
    expect(decide(call(PAY), "spend", session(), [...defaultRules(), ...payRules()])).toMatchObject({ effect: "deny", ruleId: "hard-floor" });
  });

  test("any other spend skill stays floor-denied even with payRules", () => {
    expect(decide(call("tip_jar"), "spend", session(), rules())).toMatchObject({ effect: "deny", ruleId: "hard-floor" });
  });

  test("a tainted session's payment is denied outright, never asked", () => {
    const tainted = session({ taint: [{ kind: "inbound_message", ref: "mail_read", at: 1 }] });
    expect(decide(call(PAY), "spend", tainted, rules())).toMatchObject({ effect: "deny", ruleId: "hard-tainted-money", taintInfluenced: true });
  });

  test("an unattended (night) session never pays", () => {
    expect(decide(call(PAY), "spend", session({ unattended: true }), rules())).toMatchObject({ effect: "deny", ruleId: "hard-unattended-money" });
  });

  test("a rule that allows pay can't skip the ask", () => {
    const loose = [...rules(), { id: "allow-pay", skill: PAY, effect: "allow" as const }];
    expect(decide(call(PAY), "spend", session(), loose)).toMatchObject({ effect: "ask", signedApproval: true });
  });

  test("pay under another risk class is not opened by payRules", () => {
    expect(decide(call(PAY), "send", session(), payRules()).effect).toBe("deny");
  });
});

// SL-41 (US-PAY-07, FR-PAY-04): paying a site that asked for x402 is the same spend path: it asks with the fingerprint
// and a Keystore-signed approval in the chat's own turns, and nowhere else.
describe("pay_merchant in the cage", () => {
  const buy = () => call(PAY_MERCHANT, { url: "https://merchant.example/report" });

  test("in the chat (withPay) it always asks, with the fingerprint and a Keystore-signed approval", () => {
    expect(decide(buy(), "spend", session(), rules())).toMatchObject({ effect: "ask", requireBiometric: true, signedApproval: true });
  });

  test("a 402 met in a tainted session is never paid: denied, not asked", () => {
    const tainted = session({ taint: [{ kind: "web", ref: "read_web", at: 1 }] });
    expect(decide(buy(), "spend", tainted, rules())).toMatchObject({ effect: "deny", ruleId: "hard-tainted-money" });
  });

  test("a 402 met in a night run is never paid (unattended, and the night keeps the spend floor)", () => {
    expect(decide(buy(), "spend", session({ unattended: true }), rules())).toMatchObject({ effect: "deny" });
    expect(decide(buy(), "spend", session({ unattended: true }), defaultRules())).toMatchObject({ effect: "deny" });
    expect(decide(buy(), "spend", session(), defaultRules())).toMatchObject({ effect: "deny", ruleId: "hard-floor" });
  });

  test("a 402 met in a web task is never paid: the task's rules keep the floor", () => {
    expect(decide(buy(), "spend", session(), [...defaultRules(), ...webTaskRules()])).toMatchObject({ effect: "deny", ruleId: "hard-floor" });
  });

  test("a rule that allows it can't skip the ask", () => {
    const loose = [...rules(), { id: "allow-buy", skill: PAY_MERCHANT, effect: "allow" as const }];
    expect(decide(buy(), "spend", session(), loose)).toMatchObject({ effect: "ask", signedApproval: true });
  });
});
