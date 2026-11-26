import { describe, expect, test } from "vitest";
import { argsHash, type Risk, type SessionState, type SkillId, type ToolCall } from "@hermit/core";
import { decide, WEB_CODE, WEB_PAY, WEB_READ, WEB_SIGNIN, WEB_STEP, WEB_SUBMIT, WEB_TASK, webTaskRules } from "../src/policy.ts";

const call = (skill: SkillId, args: Record<string, unknown> = {}): ToolCall => ({ id: "c1", skill, args, argsHash: argsHash(args), repairs: [] });
const session = (over: Partial<SessionState> = {}): SessionState => ({ id: "web:t1", taint: [], unattended: false, ...over });
const web = { kind: "web" as const, ref: "https://shop.example.com", at: 1 };
const run = (skill: SkillId, risk: Risk, args: Record<string, unknown> = {}, s = session()) => decide(call(skill, args), risk, s, webTaskRules());

const ORIGIN = "https://shop.example.com";

describe("webTaskRules (SL-53, FR-WEB-06 to FR-WEB-09)", () => {
  test("starting a task asks: the plan on HM-WEB-02 shows the site and every value", () => {
    expect(run(WEB_TASK, "network", { url: `${ORIGIN}/orders` }).effect).toBe("ask");
  });

  test("a step that commits nothing runs on the task's own origin, and nowhere else", () => {
    expect(run(WEB_STEP, "network", { origin: ORIGIN, taskOrigin: ORIGIN, op: "click" }).effect).toBe("allow");
    expect(run(WEB_STEP, "network", { origin: "https://evil.example", taskOrigin: ORIGIN, op: "click" }).effect).toBe("deny");
    expect(run(WEB_STEP, "network", { op: "click" }).effect).toBe("deny");
  });

  test("a submit asks every time, also in a session that already approved one (FR-WEB-07)", () => {
    expect(run(WEB_SUBMIT, "remote_write", { origin: ORIGIN }).effect).toBe("ask");
    expect(run(WEB_SUBMIT, "remote_write", { origin: ORIGIN }, session({ approvedDomains: ["shop.example.com"] })).effect).toBe("ask");
  });

  test("a sign-in click is a credential: fingerprint and a Keystore signature, never in a tainted task", () => {
    const d = run(WEB_SIGNIN, "credential", { origin: ORIGIN });
    expect(d).toMatchObject({ effect: "ask", requireBiometric: true, signedApproval: true });
    expect(run(WEB_SIGNIN, "credential", { origin: ORIGIN }, session({ taint: [web] })).effect).toBe("deny");
  });

  test("Hermit never clicks pay on a site in V1 (Q121): the user pays themselves", () => {
    expect(run(WEB_PAY, "spend", { origin: ORIGIN }).effect).toBe("deny");
  });

  test("reading the page through the quarantined reader is a read", () => {
    expect(run(WEB_READ, "read", { origin: ORIGIN }).effect).toBe("allow");
  });

  test("nothing in a web task runs unattended: the night shift never drives the browser", () => {
    const night = session({ unattended: true });
    for (const [skill, risk, args] of [
      [WEB_TASK, "network", { url: `${ORIGIN}/` }],
      [WEB_STEP, "network", { origin: ORIGIN, taskOrigin: ORIGIN }],
      [WEB_READ, "read", { origin: ORIGIN }],
      [WEB_SUBMIT, "remote_write", { origin: ORIGIN }],
    ] as const) {
      expect(run(skill, risk, args, night).effect, skill).toBe("deny");
    }
  });

  test("after page text reached a model, a plain step asks too (the hard limit on tainted fetches)", () => {
    expect(run(WEB_STEP, "network", { origin: ORIGIN, taskOrigin: ORIGIN }, session({ taint: [web] })).effect).toBe("ask");
  });

  test("SL-56b: typing a one-time code is a credential on the task's own origin: fingerprint and a signature, never tainted or unattended", () => {
    const args = { origin: ORIGIN, taskOrigin: ORIGIN, via: "sms" };
    expect(run(WEB_CODE, "credential", args)).toMatchObject({ effect: "ask", requireBiometric: true, signedApproval: true });
    expect(run(WEB_CODE, "credential", args, session({ taint: [web] })).effect).toBe("deny");
    expect(run(WEB_CODE, "credential", args, session({ unattended: true })).effect).toBe("deny");
    expect(run(WEB_CODE, "credential", { ...args, origin: "https://evil.example" }).effect).toBe("deny");
    // Only as a credential: no lower risk lets a code through.
    expect(run(WEB_CODE, "network", args).effect).toBe("deny");
  });
});
