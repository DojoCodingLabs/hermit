import { describe, expect, test } from "vitest";
import { type ApprovalOutcome, type ApprovalRequest } from "@hermit/core";
import { createSignedApprovals, defaultRules, memoryNonceStore, withPay } from "@hermit/cage";
import { softwareApprovalKey } from "@hermit/cage/testing";
import { payDef } from "@hermit/skills";
import { claimsSuccess, runTurn } from "../src/loop.ts";
import type { HoldResult, SkillRuntime } from "../src/types.ts";
import { harness } from "./helpers.ts";

// SL-40 (FR-PAY-05): a money skill's code checks and reserves the payment after the cage says ask and before the sheet.
// A refusal ends the turn in code's words; a reservation is released on every way out that doesn't run the payment.

const key = softwareApprovalKey(11);
const A = "0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed";
let nonceBase = 0;

function setup(opts: { hold?: () => HoldResult | Promise<HoldResult>; approve?: (r: ApprovalRequest) => ApprovalOutcome; reply?: string; tainted?: boolean } = {}) {
  const sign = (r: ApprovalRequest): ApprovalOutcome => ({ kind: "approved", biometric: true, argsHash: r.call.argsHash, ...(r.signed ? { signature: key.sign(r.signed.message) } : {}) });
  const h = harness([{ pick: "pay", args: { to: A, amount: "5" } }, { pick: "respond", text: opts.reply ?? "Done, I sent it." }], { approve: opts.approve ?? sign });
  const log: string[] = [];
  const pay: SkillRuntime = {
    def: payDef,
    async hold() {
      log.push("hold");
      const r = opts.hold ? await opts.hold() : { ok: true as const, lines: [{ label: "Fee", value: "0.001 USD₮", flag: "pay_fee" as const }], release: async () => void log.push("release") };
      return r.ok ? { ...r, release: async () => { log.push("release"); } } : r;
    },
    async execute() {
      log.push("execute");
      return { ok: true, modelText: "paid", reply: "Sent 5 USD₮." };
    },
  };
  let nonce = 0;
  h.deps.signedApprovals = createSignedApprovals({
    key: { state: async () => ({ state: "ready", publicKey: key.spki, level: "strongbox" }) },
    enrolledKey: async () => key.spki,
    nonces: memoryNonceStore(),
    randomNonce: () => (++nonce + nonceBase).toString(16).padStart(64, "0"),
    now: () => h.deps.now(),
  });
  nonceBase += 1000;
  h.deps.skills = [...h.deps.skills, pay];
  h.deps.rules = withPay(defaultRules());
  if (opts.tainted) h.state.session.taint.push({ kind: "inbound_message", ref: "mail_read", at: 1 });
  return { ...h, log };
}

describe("hold before the sheet (reserve before approve)", () => {
  test("held, then approved: the sheet carries the hold's lines and the payment runs, owning its reservation", async () => {
    const h = setup();
    const r = await runTurn(h.state, `pay ${A} 5 dollars`, h.deps);
    expect(r).toMatchObject({ kind: "final", text: "Sent 5 USD₮." });
    expect(h.log).toEqual(["hold", "execute"]);
    expect(h.approvals.requests[0]!.summary.lines.map((l) => l.flag)).toEqual(["pay_amount", "pay_to", "pay_network", "pay_fee"]);
  });

  test("SL-41: terms from the hold are what the Keystore signs, not the args' own", async () => {
    const M = "0x209693Bc6afc0C5328bA36FaF03C514EF312287C";
    const terms = { amount: { amount: 10000n, asset: "USDT", network: "eip155:2201" }, recipient: M, origin: "https://merchant.example" };
    const h = setup({ hold: () => ({ ok: true, terms, release: async () => {} }) });
    await runTurn(h.state, `pay ${A} 5 dollars`, h.deps);
    expect(h.approvals.requests[0]!.signed!.payload).toMatchObject({ recipient: M, origin: "https://merchant.example", amount: { value: "10000", asset: "USDT", network: "eip155:2201" } });
    expect(h.log).toEqual(["hold", "execute"]);
  });

  test("a refusal ends the turn in code's words; no sheet, no signature, nothing runs", async () => {
    const h = setup({ hold: () => ({ ok: false, code: "over_per_payment", reply: "That's over your 25 USD₮ per payment cap." }) });
    const r = await runTurn(h.state, `pay ${A} 5 dollars`, h.deps);
    expect(r).toMatchObject({ kind: "final", text: "That's over your 25 USD₮ per payment cap." });
    expect(h.approvals.requests).toEqual([]);
    expect(h.log).toEqual(["hold"]);
    expect(h.audit.find((e) => e.event === "approval")).toMatchObject({ outcome: "denied", reason: "hold.over_per_payment" });
  });

  test("a question (how much, who) ends the turn as needs_user", async () => {
    const h = setup({ hold: () => ({ ok: false, code: "no_amount", reply: "How much should I send?", ask: true }) });
    expect(await runTurn(h.state, "pay Ana", h.deps)).toMatchObject({ kind: "needs_user", question: "How much should I send?" });
  });

  test("declined: the reservation is released and the model's claim of success is replaced (honesty guard)", async () => {
    const h = setup({ approve: () => ({ kind: "denied", reason: "no" }), reply: "Listo, le pagué a Ana." });
    const r = await runTurn(h.state, `pay ${A} 5 dollars`, h.deps);
    expect(h.log).toEqual(["hold", "release"]);
    expect(r.kind).toBe("final");
    expect(r.kind === "final" && r.text).not.toMatch(/pagu/);
  });

  test("a bad signature releases it too", async () => {
    const other = softwareApprovalKey(12);
    const h = setup({ approve: (q) => ({ kind: "approved", biometric: true, argsHash: q.call.argsHash, signature: other.sign(q.signed!.message) }) });
    await runTurn(h.state, `pay ${A} 5 dollars`, h.deps);
    expect(h.log).toEqual(["hold", "release"]);
  });

  test("a hold that throws is a refusal, never a sheet", async () => {
    const h = setup({ hold: () => { throw new Error("db"); } });
    await runTurn(h.state, `pay ${A} 5 dollars`, h.deps);
    expect(h.approvals.requests).toEqual([]);
    expect(h.log).toEqual(["hold"]);
  });

  test("a tainted session is denied by the cage before any hold", async () => {
    const h = setup({ tainted: true });
    await runTurn(h.state, `pay ${A} 5 dollars`, h.deps);
    expect(h.log).toEqual([]);
    expect(h.approvals.requests).toEqual([]);
  });

  test("an unattended session is denied by the cage before any hold", async () => {
    const h = setup();
    h.state.session.unattended = true;
    await runTurn(h.state, `pay ${A} 5 dollars`, h.deps);
    expect(h.log).toEqual([]);
  });
});

describe("the honesty guard knows payments", () => {
  test.each(["Paid Ana 5 dollars.", "I've paid Ana.", "Le pagué a Ana.", "El pago fue pagado", "I have transferred 5 USD₮", "Ya le transferí."])("%s", (t) => {
    expect(claimsSuccess(t)).toBe(true);
  });
  test("a sentence that says it didn't pay is not a claim", () => {
    expect(claimsSuccess("I couldn't pay Ana.")).toBe(false);
  });
});
