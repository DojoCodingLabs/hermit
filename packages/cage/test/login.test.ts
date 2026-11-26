/** SL-36 (US-FORM-02, FR-CAGE-02, FR-VAULT-04): a login is a `credential` the cage asks for every time, signed, never unattended. */
import { describe, expect, test } from "vitest";
import { argsHash, skillId, type SessionState, type ToolCall } from "@hermit/core";
import { decide, defaultRules, FILL_LOGIN, loginRules } from "../src/policy.ts";

const args = { item: "d".repeat(64), origin: "https://bank.example", requester: "android://x@com.android.chrome", fields: [{ key: "0", kind: "password" }] };
const call = (a: Record<string, unknown> = args): ToolCall => ({ id: "l1", skill: FILL_LOGIN, args: a, argsHash: argsHash(a), repairs: [] });
const session = (over: Partial<SessionState> = {}): SessionState => ({ id: "autofill", taint: [], unattended: false, ...over });

describe("login rules", () => {
  test("a login asks with the fingerprint and a Keystore signature over the exact payload, every time", () => {
    const d = decide(call(), "credential", session(), loginRules());
    expect(d).toMatchObject({ effect: "ask", ruleId: "login-asks", requireBiometric: true, signedApproval: true });
  });

  test("nobody on screen (a night pass, a headless task): denied, never filled", () => {
    expect(decide(call(), "credential", session({ unattended: true }), loginRules())).toMatchObject({ effect: "deny", ruleId: "hard-unattended-money" });
  });

  test("a tainted session never gets a login", () => {
    expect(decide(call(), "credential", session({ taint: [{ kind: "web", ref: "https://evil.example", at: 1 }] }), loginRules())).toMatchObject({ effect: "deny", ruleId: "hard-tainted-money" });
  });

  test("the rules apply to the login only, and never allow it outright", () => {
    expect(loginRules().every((r) => r.effect === "ask" && r.skill === FILL_LOGIN && r.risk === "credential")).toBe(true);
    expect(decide({ ...call(), skill: skillId("reply_message") }, "credential", session(), loginRules()).effect).toBe("deny");
  });

  test("with the default rules a credential stays closed: the model's menu can't reach a login", () => {
    expect(decide(call(), "credential", session(), defaultRules())).toMatchObject({ effect: "deny", ruleId: "hard-floor" });
  });
});
