import { describe, expect, test } from "vitest";
import { money, skillId, type ApprovalKeyState, type ApprovalOutcome, type ApprovalRequest, type SkillDef } from "@hermit/core";
import { createSignedApprovals, memoryNonceStore, signedApprovalHash, type PolicyRule } from "@hermit/cage";
import { softwareApprovalKey } from "@hermit/cage/testing";
import { runTurn } from "../src/loop.ts";
import type { SkillRuntime } from "../src/types.ts";
import { harness } from "./helpers.ts";

// SL-37 (US-CAGE-03, FR-CAGE-06): the loop asks for a Keystore signature on spend and credential, verifies it against
// the enrolled key and the exact args hash before anything runs, and logs the payload hash and the signature.

const key = softwareApprovalKey(7);
const otherKey = softwareApprovalKey(9);
const RECIPIENT = "0x1111111111111111111111111111111111111111";

const payDef: SkillDef = {
  id: skillId("pay"),
  menuLine: "Pay someone in USD₮.",
  version: 1,
  args: { type: "object", properties: { to: { type: "string" }, amount: { type: "string" }, asset: { type: "string" } }, required: ["to", "amount"] },
  risk: "spend",
  producesUntrusted: false,
  describeAction: (a) => ({ title: "Pay", lines: [{ label: "Amount", value: String(a.amount) }, { label: "To", value: String(a.to) }] }),
  approvalTerms: (a) => ({ amount: money(BigInt(String(a.amount)), String(a.asset ?? "USDT"), "stable-testnet"), recipient: String(a.to) }),
};
const payArgs = { to: RECIPIENT, amount: "5000000" };
/** Each setup draws different nonces, as random ones would be. */
let nonceBase = 0;

function setup(opts: {
  approve?: (r: ApprovalRequest) => ApprovalOutcome | Promise<ApprovalOutcome>;
  state?: () => ApprovalKeyState;
  enrolled?: string | null;
  def?: SkillDef;
  rules?: PolicyRule[];
  wired?: boolean;
  args?: Record<string, unknown>;
} = {}) {
  const signAll = (r: ApprovalRequest): ApprovalOutcome => ({ kind: "approved", biometric: true, argsHash: r.call.argsHash, ...(r.signed ? { signature: key.sign(r.signed.message) } : {}) });
  const h = harness([{ pick: "pay", args: opts.args ?? payArgs }, { pick: "respond", text: "Paid." }], { approve: opts.approve ?? signAll });
  const ran: Array<{ args: Record<string, unknown>; payloadHash?: string }> = [];
  const pay: SkillRuntime = {
    def: opts.def ?? payDef,
    execute: async (args, ctx) => {
      ran.push({ args, ...(ctx.signedApproval ? { payloadHash: ctx.signedApproval.payloadHash } : {}) });
      return { ok: true, modelText: "pay ok" };
    },
  };
  let nonce = 0;
  const nonces = memoryNonceStore();
  const signedApprovals = createSignedApprovals({
    key: { state: async () => (opts.state ? opts.state() : { state: "ready", publicKey: key.spki, level: "strongbox" }) },
    enrolledKey: async () => (opts.enrolled === null ? undefined : (opts.enrolled ?? key.spki)),
    nonces,
    randomNonce: () => (++nonce + nonceBase).toString(16).padStart(64, "0"),
    now: () => h.deps.now(),
  });
  nonceBase += 1_000;
  h.deps.skills = [...h.deps.skills, pay];
  h.deps.rules = opts.rules ?? [{ id: "spend-asks", skill: "*", risk: "spend", effect: "ask", requireBiometric: true }];
  if (opts.wired !== false) h.deps.signedApprovals = signedApprovals;
  return { ...h, ran, nonces };
}

describe("Keystore-signed approvals in the loop", () => {
  test("a valid signature over the exact payload runs the payment and the log keeps its hash and signature", async () => {
    const h = setup();
    const r = await runTurn(h.state, "Pay 5 USD₮ to 0x1111", h.deps);
    expect(r.kind).toBe("final");
    const req = h.approvals.requests[0]!;
    expect(req.requireBiometric).toBe(true);
    expect(req.signed?.payload).toMatchObject({ risk: "spend", skill: "pay", argsHash: req.call.argsHash, requestId: req.id, recipient: RECIPIENT, amount: { value: "5000000", asset: "USDT" } });
    const payloadHash = signedApprovalHash(req.signed!.message);
    expect(h.ran).toEqual([{ args: payArgs, payloadHash }]);
    const approval = h.audit.find((e) => e.event === "approval")!;
    expect(approval).toMatchObject({ outcome: "ok", payloadHash, approvalSig: key.sign(req.signed!.message) });
    // Nothing of the payload or the signature reaches the model: only the args it wrote and plain notes.
    const seen = JSON.stringify(h.state.messages);
    expect(seen).not.toContain(req.signed!.payload.nonce);
    expect(seen).not.toContain(payloadHash);
    expect(seen).not.toContain("hermit.approval.v1");
  });

  test("the JS proof path (no signature) is refused for money", async () => {
    const h = setup({ approve: (r) => ({ kind: "approved", biometric: true, argsHash: r.call.argsHash, proof: "a".repeat(64) }) });
    const r = await runTurn(h.state, "Pay", h.deps);
    expect(h.ran).toEqual([]);
    expect(r.events).toContainEqual({ kind: "denied", skill: "pay" });
    expect(h.audit.find((e) => e.event === "approval")).toMatchObject({ outcome: "denied", reason: "signed.no_signature" });
  });

  test("a signature by another key is refused", async () => {
    const h = setup({ approve: (r) => ({ kind: "approved", biometric: true, argsHash: r.call.argsHash, signature: otherKey.sign(r.signed!.message) }) });
    await runTurn(h.state, "Pay", h.deps);
    expect(h.ran).toEqual([]);
    expect(h.audit.find((e) => e.event === "approval")).toMatchObject({ outcome: "denied", reason: "signed.bad_signature" });
  });

  test("a signature over a tampered payload (another amount) is refused", async () => {
    const h = setup({
      approve: (r) => ({ kind: "approved", biometric: true, argsHash: r.call.argsHash, signature: key.sign(r.signed!.message.replace('"value":"5000000"', '"value":"9000000"')) }),
    });
    await runTurn(h.state, "Pay", h.deps);
    expect(h.ran).toEqual([]);
  });

  test("a replayed signature is refused: a later request has a fresh nonce, and the same payload twice is a replay", async () => {
    let earlier: string | undefined;
    const first = setup({
      approve: (r) => {
        earlier = key.sign(r.signed!.message);
        return { kind: "approved", biometric: true, argsHash: r.call.argsHash, signature: earlier };
      },
    });
    await runTurn(first.state, "Pay", first.deps);
    expect(first.ran).toHaveLength(1);
    // A later request of the same verifier: another nonce, so the old signature doesn't verify.
    const later = setup({ approve: (r) => ({ kind: "approved", biometric: true, argsHash: r.call.argsHash, signature: earlier! }) });
    later.deps.signedApprovals = first.deps.signedApprovals!;
    await runTurn(later.state, "Pay", later.deps);
    expect(later.ran).toEqual([]);
    expect(later.audit.find((e) => e.event === "approval")).toMatchObject({ outcome: "denied", reason: "signed.bad_signature" });
    // The very same payload again (same request, same nonce): the nonce store says it was used.
    const fixed = (s: ReturnType<typeof setup>) =>
      createSignedApprovals({ key: { state: async () => ({ state: "ready", publicKey: key.spki, level: "tee" }) }, enrolledKey: async () => key.spki, nonces: s.nonces, randomNonce: () => "ab".repeat(32), now: () => 1_000 });
    const a = setup();
    a.deps.signedApprovals = fixed(a);
    await runTurn(a.state, "Pay", a.deps);
    expect(a.ran).toHaveLength(1);
    const b = setup({ approve: () => ({ kind: "approved", biometric: true, argsHash: a.approvals.requests[0]!.call.argsHash, signature: key.sign(a.approvals.requests[0]!.signed!.message) }) });
    b.deps.signedApprovals = fixed(a);
    await runTurn(b.state, "Pay", b.deps);
    expect(b.ran).toEqual([]);
    expect(b.audit.find((e) => e.event === "approval")).toMatchObject({ outcome: "denied", reason: "signed.replayed" });
  });

  test("an approval that comes back after its expiry is refused", async () => {
    let now = 1_000;
    const h = setup({
      approve: (r) => {
        const signature = key.sign(r.signed!.message);
        now = r.expiresAt + 1;
        return { kind: "approved", biometric: true, argsHash: r.call.argsHash, signature };
      },
    });
    h.deps.now = () => now;
    await runTurn(h.state, "Pay", h.deps);
    expect(h.ran).toEqual([]);
  });

  test("a non-USD₮ amount is blocked before any sheet opens (PDR-027)", async () => {
    const h = setup({ args: { ...payArgs, asset: "USDC" } });
    const r = await runTurn(h.state, "Pay in USDC", h.deps);
    expect(h.approvals.requests).toEqual([]);
    expect(h.ran).toEqual([]);
    expect(r.events).toContainEqual(expect.objectContaining({ kind: "blocked", skill: "pay", code: "not_usdt" }));
  });

  test("a lost key blocks money before the sheet, with the code the chat turns into the set-up-again link", async () => {
    const h = setup({ state: () => ({ state: "lost" }) });
    const r = await runTurn(h.state, "Pay", h.deps);
    expect(h.approvals.requests).toEqual([]);
    expect(h.ran).toEqual([]);
    expect(r.events).toContainEqual(expect.objectContaining({ kind: "blocked", skill: "pay", code: "approval_key_lost" }));
    expect(h.audit.find((e) => e.event === "approval")).toMatchObject({ outcome: "denied", reason: "signed.key_lost" });
  });

  test("no key set up, and no signer wired at all: blocked", async () => {
    const none = setup({ state: () => ({ state: "none" }), enrolled: null });
    const r = await runTurn(none.state, "Pay", none.deps);
    expect(r.events).toContainEqual(expect.objectContaining({ kind: "blocked", code: "approval_key_none" }));
    const unwired = setup({ wired: false });
    const r2 = await runTurn(unwired.state, "Pay", unwired.deps);
    expect(unwired.approvals.requests).toEqual([]);
    expect(r2.events).toContainEqual(expect.objectContaining({ kind: "blocked", code: "approval_key_none" }));
  });

  test("a spend skill that can't say its amount and recipient is never approved", async () => {
    const noTerms: SkillDef = { ...payDef };
    delete noTerms.approvalTerms;
    const h = setup({ def: noTerms });
    await runTurn(h.state, "Pay", h.deps);
    expect(h.approvals.requests).toEqual([]);
    expect(h.ran).toEqual([]);
  });

  test("a tainted session never gets to the sheet; neither does an unattended one", async () => {
    const tainted = setup();
    tainted.state.session.taint.push({ kind: "inbound_message", ref: "whatsapp:ana", at: 1 });
    await runTurn(tainted.state, "Pay", tainted.deps);
    expect(tainted.approvals.requests).toEqual([]);
    const night = setup();
    night.state.session.unattended = true;
    await runTurn(night.state, "Pay", night.deps);
    expect(night.approvals.requests).toEqual([]);
    expect(night.ran).toEqual([]);
  });

  test("a send still uses the JS proof path, untouched", async () => {
    const h = setup();
    expect(h.deps.signedApprovals).toBeDefined();
    const send = harness([{ pick: "reply_message", args: { conversationId: "c1", text: "hi" } }, { pick: "respond" }]);
    await runTurn(send.state, "Tell Ana hi", { ...send.deps, signedApprovals: h.deps.signedApprovals! });
    expect(send.approvals.requests[0]!.signed).toBeUndefined();
    expect(send.executed.map((e) => e.skill)).toEqual(["reply_message"]);
  });
});
