import { describe, expect, test } from "vitest";
import { nodeSql } from "@hermit/sql-node";
import {
  migrate, serializeWalletRecord, transferRef, usdt, WALLET_NETWORK,
  type ApprovalOutcome, type ApprovalRequest, type ModelPort, type SessionState, type SkillId, type VaultUnwrap, type WalletRecord,
} from "@hermit/core";
import { createAuditLog, createSignedApprovals, defaultRules, ed25519Signer, memoryNonceStore, withPay } from "@hermit/cage";
import { softwareApprovalKey } from "@hermit/cage/testing";
import { claimsSuccess, runTurn, type LoopDeps } from "@hermit/agent";
import { localKeySigner, type TransferReceipt, type TransferWithAuthorizationTypedData } from "@hermit/payments";
import { profileById, type CompletionEngine } from "@hermit/model";
import { createHermit } from "../src/hermit.ts";
import { createPayments, type PayWorkletPort } from "../src/pay.ts";

// SL-40 (US-PAY-05, US-PAY-06, FR-PAY-03, FR-PAY-05, PDR-011): paying a person by asking, within caps, through the real
// loop, cage, signed approvals, SQLite ledger and signed log. Only the worklet, the wallet key and the model are fakes.

const NOW = Date.UTC(2026, 10, 17, 12, 0);
const wallet = localKeySigner(new Uint8Array(32).fill(3));
const ANA = "0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed";
const TYPED = "0xfB6916095ca1df60bB79Ce92cE3Ea74c37c5d359";
const key = softwareApprovalKey(21);
const WALLET_KEY_BYTES = new Uint8Array(32).fill(0x5a);
const SEALED = "ab".repeat(44);

const record: WalletRecord = {
  v: 1, id: "w-1", address: wallet.address, path: WALLET_NETWORK.path, chainId: WALLET_NETWORK.chainId, sealed: SEALED, words: 12,
  source: "created", createdAt: 1, backedUpAt: 2,
};

interface Opts {
  balance?: bigint;
  fee?: bigint;
  unwrap?: VaultUnwrap["kind"];
  submit?: "ok" | "throws";
  receipt?: TransferReceipt;
  confirm?: boolean;
  noWallet?: boolean;
}

async function setup(opts: Opts = {}) {
  const sql = nodeSql();
  await migrate(sql);
  const audit = createAuditLog(sql, ed25519Signer(new Uint8Array(32).fill(4)));
  let now = NOW;
  let id = 0;
  const calls: string[] = [];
  const keysSeen: Uint8Array[] = [];
  const signedData: TransferWithAuthorizationTypedData[] = [];
  const worklet: PayWorkletPort = {
    async balance(address) {
      calls.push(`balance ${address}`);
      return { usdt0: opts.balance ?? 100_000_000n, native: (opts.balance ?? 100_000_000n) * 10n ** 12n };
    },
    async quoteFee() {
      calls.push("quote");
      return opts.fee ?? 1_000_000_000_000_000n; // 0.001 USD₮0
    },
    async open(req) {
      calls.push("open");
      keysSeen.push(req.key);
      expect(req).toMatchObject({ id: "w-1", sealed: SEALED });
      return { address: wallet.address };
    },
    async sign(_address, td) {
      calls.push("sign");
      signedData.push(td);
      return wallet.signTypedData(td);
    },
    async submit() {
      calls.push("submit");
      if (opts.submit === "throws") throw new Error("offline");
      return "0x" + "cd".repeat(32);
    },
    async receipt() {
      calls.push("receipt");
      return opts.receipt ?? "success";
    },
    async close() {
      calls.push("close");
    },
  };
  const prompts: string[] = [];
  const payments = createPayments({
    sql, audit, now: () => now, newId: () => `p${++id}`, randomBytes: (n) => new Uint8Array(n).fill(++id),
    wallet: {
      key: {
        exists: async () => true,
        store: async () => "stored",
        async unwrap(prompt) {
          prompts.push(prompt);
          const k = opts.unwrap ?? "key";
          return k === "key" ? { kind: "key", key: Uint8Array.from(WALLET_KEY_BYTES) } : { kind: k };
        },
        destroy: async () => {},
      },
      record: { read: async () => (opts.noWallet ? undefined : serializeWalletRecord(record)), write: async () => {}, remove: async () => {} },
      worklet,
    },
    confirm: async (prompt) => {
      prompts.push(prompt);
      return opts.confirm ?? true;
    },
    say: (k, _said, vars) => (vars ? `${k} ${JSON.stringify(vars)}` : k),
    sleep: async () => {},
    receiptTries: 3,
  });
  return { sql, audit, payments, calls, keysSeen, signedData, prompts, setNow: (t: number) => (now = t), now: () => now };
}

/** One chat turn through the real loop and cage: the model picks pay and fills `args`; the user signs (or not). */
async function turn(
  s: Awaited<ReturnType<typeof setup>>,
  userText: string,
  args: Record<string, unknown>,
  opts: { approve?: (r: ApprovalRequest) => ApprovalOutcome; session?: Partial<SessionState>; reply?: string } = {},
) {
  let step = 0;
  const model: ModelPort = {
    async pick() {
      return step++ === 0 ? { choice: "pay" as SkillId } : { choice: "respond", text: opts.reply ?? "Done, paid." };
    },
    async fill() {
      return { rawText: JSON.stringify(args), args };
    },
    async respond() {
      return opts.reply ?? "Done, paid.";
    },
  };
  const requests: ApprovalRequest[] = [];
  const sign = (r: ApprovalRequest): ApprovalOutcome => ({ kind: "approved", biometric: true, argsHash: r.call.argsHash, signature: key.sign(r.signed!.message) });
  let n = 0;
  const deps: LoopDeps = {
    model,
    skills: [await s.payments.runtime()],
    rules: withPay(defaultRules()),
    approvals: { request: async (r) => (requests.push(r), (opts.approve ?? sign)(r)) },
    audit: s.audit,
    render: { conversation: () => undefined },
    now: s.now,
    timeZone: "UTC",
    newId: () => `req${++n}${Math.random().toString(16).slice(2, 6)}`,
    signedApprovals: createSignedApprovals({
      key: { state: async () => ({ state: "ready", publicKey: key.spki, level: "strongbox" }) },
      enrolledKey: async () => key.spki,
      nonces: memoryNonceStore(),
      randomNonce: () => Math.random().toString(16).slice(2).padEnd(64, "0").slice(0, 64),
      now: s.now,
    }),
  };
  const session: SessionState = { id: "s1", taint: [], unattended: false, ...opts.session };
  const messages: never[] = [];
  const result = await runTurn({ session, messages }, userText, deps);
  return { result, requests, messages: result.messages };
}

const ledger = (s: Awaited<ReturnType<typeof setup>>) =>
  s.sql.query<{ amount: string; recipient: string; status: string; tx_hash: string | null }>("SELECT amount, recipient, status, tx_hash FROM spend_ledger ORDER BY at_ms");

async function withAna(s: Awaited<ReturnType<typeof setup>>) {
  expect(await s.payments.savePayee("Ana López", ANA.toLowerCase(), "confirm")).toMatchObject({ kind: "saved" });
}

describe("send Ana 20 dollars: one sentence, the sheet, the fingerprint", () => {
  test("a saved payee named by the user is paid exactly what they said; the chain confirms it, so it is sent", async () => {
    const s = await setup();
    await withAna(s);
    const t = await turn(s, "send Ana 20 dollars", { person: "Ana", amount: "200" });
    expect(t.result).toMatchObject({ kind: "final" });
    expect(t.result.kind === "final" && t.result.text).toMatch(/^HM-CHAT-01\.pay\.sent /);
    // A6: the chat's receipt card is built from code's own facts, carried apart from the reply text.
    expect(t.result.kind === "final" && t.result.receipt).toMatchObject({ kind: "paid", amount: "20 USD₮", to: "Ana López" });
    expect(t.result.kind === "final" && t.result.receipt && t.result.receipt.hash).toMatch(/^0x[0-9a-f]+…[0-9a-f]+$/);
    // The sheet: amount, the full checksummed address, the network, the payee, the fee, what the cap leaves.
    const sheet = t.requests[0]!;
    expect(sheet.summary.lines).toEqual([
      { label: "Amount", value: "20 USD₮", flag: "pay_amount" },
      { label: "To", value: ANA, flag: "pay_to" },
      { label: "Network", value: "Stable testnet", flag: "pay_network" },
      { label: "Saved payee", value: "Ana López", flag: "pay_payee" },
      { label: "Network fee (estimate)", value: "0.001 USD₮", flag: "pay_fee" },
      { label: "Left today after this", value: "30 USD₮", flag: "pay_cap_left" },
    ]);
    // The Keystore signs the exact amount, USD₮, the network and the recipient.
    expect(sheet.signed!.payload).toMatchObject({ risk: "spend", skill: "pay", recipient: ANA, amount: { value: "20000000", asset: "USDT", network: WALLET_NETWORK.network } });
    // The worklet signed exactly that, then the wallet submitted it.
    expect(s.signedData[0]!.message).toMatchObject({ from: wallet.address, to: ANA, value: "20000000" });
    expect(s.calls).toEqual(["quote", `balance ${wallet.address}`, "open", "sign", "submit", "receipt", "close"]);
    expect(await ledger(s)).toEqual([{ amount: "20000000", recipient: ANA, status: "settled", tx_hash: "0x" + "cd".repeat(32) }]);
    // The wallet key was zeroed after the one open.
    expect([...s.keysSeen[0]!].every((b) => b === 0)).toBe(true);
    // The log keeps hashes; the model's history keeps no key, seal or signature.
    const seen = JSON.stringify(t.messages);
    for (const secret of [SEALED, "5a".repeat(32), "hermit.approval.v1"]) expect(seen).not.toContain(secret);
    const entries = await s.audit.entries();
    expect(entries.find((e) => e.event === "approval")).toMatchObject({ outcome: "ok", payloadHash: expect.stringMatching(/^[0-9a-f]{64}$/) });
    // Q128 (SL-39): the sent transfer's entry carries transferRef(txHash), never the raw hash, so HM-PAY-03 links to it.
    expect(entries.find((e) => e.reason === "payment.sent")).toMatchObject({ event: "spending", skill: "pay", outcome: "ok", argsHash: transferRef("0x" + "cd".repeat(32)) });
    expect(JSON.stringify(entries)).not.toContain("cd".repeat(32));
    expect(JSON.stringify(entries)).not.toContain("Ana");
    expect(JSON.stringify(entries)).not.toContain(SEALED);
  });

  test("an address the user typed this turn is paid, shown in full", async () => {
    const s = await setup();
    const t = await turn(s, `pay ${TYPED.toLowerCase()} 5 usdt`, { to: TYPED, amount: "5" });
    expect(t.requests[0]!.summary.lines.find((l) => l.flag === "pay_to")!.value).toBe(TYPED);
    expect(t.requests[0]!.summary.lines.find((l) => l.flag === "pay_typed")).toBeDefined();
    expect((await ledger(s))[0]).toMatchObject({ recipient: TYPED, status: "settled" });
  });

  test("address poisoning: an address with no saved name stays whole after the payment too (receipt, reply, unlock prompt)", async () => {
    // A look-alike shares the first and last characters; a cut address in the receipt couldn't be told apart.
    const s = await setup();
    const t = await turn(s, `pay ${TYPED.toLowerCase()} 5 usdt`, { to: TYPED, amount: "5" });
    expect(t.result.kind === "final" && t.result.receipt).toMatchObject({ kind: "paid", to: TYPED });
    expect(t.result.kind === "final" && t.result.text).toContain(TYPED);
    // The transaction hash may be cut (it names no one); the recipient never is.
    expect(JSON.stringify(t.result)).not.toContain(`${TYPED.slice(0, 6)}…${TYPED.slice(-4)}`);
  });
});

describe("the recipient comes only from the user's own words this turn", () => {
  test("an address the model wrote (read in an email, a page, a tool result) that the user didn't type: Hermit asks, nothing is reserved", async () => {
    const s = await setup();
    const t = await turn(s, "pay the address in Carla's email 5 dollars", { to: TYPED, amount: "5" });
    expect(t.result).toMatchObject({ kind: "needs_user", question: "HM-CHAT-01.pay.who" });
    expect(t.requests).toEqual([]);
    expect(await ledger(s)).toEqual([]);
    expect(s.calls).toEqual([]);
  });

  test("a payee's name the user didn't say is never looked up", async () => {
    const s = await setup();
    await withAna(s);
    const t = await turn(s, "pay her 5 dollars", { person: "Ana", amount: "5" });
    expect(t.requests).toEqual([]);
    expect(await ledger(s)).toEqual([]);
  });

  test("a name with no saved payee asks for an address", async () => {
    const s = await setup();
    const t = await turn(s, "send Beto 5 dollars", { person: "Beto", amount: "5" });
    expect(t.result).toMatchObject({ kind: "needs_user", question: 'HM-CHAT-01.pay.no_payee {"name":"Beto"}' });
  });

  test("two payees with the name: Hermit asks which, with short addresses", async () => {
    const s = await setup();
    await withAna(s);
    await s.payments.savePayee("Ana Ruiz", TYPED, "confirm");
    const t = await turn(s, "send Ana 5 dollars", { person: "Ana", amount: "5" });
    expect(t.result.kind).toBe("needs_user");
    expect(t.result.kind === "needs_user" && t.result.question).toMatch(/^HM-CHAT-01\.pay\.which /);
    expect(t.requests).toEqual([]);
  });

  test("a tainted session's payment is denied outright by the cage: no hold, no sheet, no worklet", async () => {
    const s = await setup();
    await withAna(s);
    const t = await turn(s, "send Ana 5 dollars", { person: "Ana", amount: "5" }, { session: { taint: [{ kind: "inbound_message", ref: "mail_read", at: 1 }] } });
    expect(t.requests).toEqual([]);
    expect(s.calls).toEqual([]);
    expect(t.result.kind === "final" && claimsSuccess(t.result.text)).toBe(false);
  });

  test("a night run (unattended) never pays", async () => {
    const s = await setup();
    await withAna(s);
    const t = await turn(s, "send Ana 5 dollars", { person: "Ana", amount: "5" }, { session: { unattended: true } });
    expect(t.requests).toEqual([]);
    expect(s.calls).toEqual([]);
    expect(await ledger(s)).toEqual([]);
  });
});

describe("amounts and assets", () => {
  test("no amount in the words: Hermit asks how much", async () => {
    const s = await setup();
    await withAna(s);
    expect((await turn(s, "send Ana some money", { person: "Ana", amount: "20" })).result).toMatchObject({ kind: "needs_user", question: "HM-CHAT-01.pay.how_much" });
  });

  test("an amount that reads two ways is asked, never guessed", async () => {
    const s = await setup();
    await withAna(s);
    expect((await turn(s, "send Ana 1,000 dollars", { person: "Ana", amount: "1000" })).result).toMatchObject({ kind: "needs_user", question: "HM-CHAT-01.pay.ambiguous_amount" });
  });

  test("another asset is refused before the sheet", async () => {
    const s = await setup();
    await withAna(s);
    const t = await turn(s, "send Ana 20 USDC", { person: "Ana", amount: "20", asset: "USDC" });
    expect(t.result).toMatchObject({ kind: "final", text: "HM-CHAT-01.pay.not_usdt" });
    expect(t.requests).toEqual([]);
  });
});

describe("caps, enforced in code before the sheet and reserved in the ledger", () => {
  test("over the per-payment cap: refused with the cap, nothing read or reserved", async () => {
    const s = await setup();
    await withAna(s);
    const t = await turn(s, "send Ana 30 dollars", { person: "Ana", amount: "30" });
    expect(t.result).toMatchObject({ kind: "final", text: 'HM-CHAT-01.pay.over_per_payment {"cap":"25 USD₮"}' });
    expect(s.calls).toEqual([]);
    expect(await ledger(s)).toEqual([]);
  });

  test("two quick payments waiting on approval can't both pass the daily cap", async () => {
    const s = await setup();
    await withAna(s);
    expect((await s.payments.setCaps({ perPayment: usdt(40_000_000n), perDay: usdt(50_000_000n) }, "confirm")).kind).toBe("saved");
    const rt = await s.payments.runtime();
    const args = { to: ANA, person: "Ana", amount: "30" };
    const session: SessionState = { id: "s1", taint: [], unattended: false };
    const [a, b] = await Promise.all([
      rt.hold!(args, { session, userText: "send Ana 30 dollars", requestId: "r1", argsHash: "h1" }),
      rt.hold!(args, { session, userText: "send Ana 30 dollars", requestId: "r2", argsHash: "h2" }),
    ]);
    expect([a.ok, b.ok].sort()).toEqual([false, true]);
    const refused = (a.ok ? b : a) as Extract<typeof a, { ok: false }>;
    expect(refused).toMatchObject({ code: "over_per_day" });
    expect(refused.reply).toBe('HM-CHAT-01.pay.over_per_day {"cap":"50 USD₮","left":"20 USD₮"}');
    expect(await ledger(s)).toEqual([{ amount: "30000000", recipient: ANA, status: "pending", tx_hash: null }]);
  });

  test("a declined payment frees its reservation, and is never reported as sent", async () => {
    const s = await setup();
    await withAna(s);
    const t = await turn(s, "send Ana 20 dollars", { person: "Ana", amount: "20" }, { approve: () => ({ kind: "denied", reason: "no" }), reply: "Listo, le pagué a Ana." });
    expect(await ledger(s)).toEqual([{ amount: "20000000", recipient: ANA, status: "void", tx_hash: null }]);
    expect(t.result.kind === "final" && claimsSuccess(t.result.text)).toBe(false);
    expect(s.calls).not.toContain("sign");
  });

  test("the rolling day: yesterday's payment no longer counts", async () => {
    const s = await setup();
    await withAna(s);
    await turn(s, "send Ana 25 dollars", { person: "Ana", amount: "25" });
    await turn(s, "send Ana 25 dollars", { person: "Ana", amount: "25" });
    const third = await turn(s, "send Ana 1 dollar", { person: "Ana", amount: "1" });
    expect(third.result).toMatchObject({ kind: "final", text: expect.stringMatching(/^HM-CHAT-01\.pay\.over_per_day/) });
    s.setNow(NOW + 24 * 60 * 60 * 1000 + 1);
    const later = await turn(s, "send Ana 1 dollar", { person: "Ana", amount: "1" });
    expect(later.result.kind === "final" && later.result.text).toMatch(/^HM-CHAT-01\.pay\.sent/);
  });
});

describe("balance and wallet, before the sheet", () => {
  test("insufficient balance (the amount plus the fee) is refused before the sheet", async () => {
    const s = await setup({ balance: 20_000_000n });
    await withAna(s);
    const t = await turn(s, "send Ana 20 dollars", { person: "Ana", amount: "20" });
    expect(t.result).toMatchObject({ kind: "final", text: 'HM-CHAT-01.pay.insufficient {"balance":"20 USD₮","amount":"20 USD₮","fee":"0.001 USD₮"}' });
    expect(t.requests).toEqual([]);
    expect(await ledger(s)).toEqual([]);
  });

  test("no wallet: refused", async () => {
    const s = await setup({ noWallet: true });
    await withAna(s);
    expect((await turn(s, "send Ana 5 dollars", { person: "Ana", amount: "5" })).result).toMatchObject({ kind: "final", text: "HM-CHAT-01.pay.no_wallet" });
  });
});

describe("after the approval: honest outcomes", () => {
  test("cancelling the wallet's fingerprint frees the reservation; nothing is signed", async () => {
    const s = await setup({ unwrap: "cancelled" });
    await withAna(s);
    const t = await turn(s, "send Ana 5 dollars", { person: "Ana", amount: "5" });
    expect(t.result).toMatchObject({ kind: "final", text: "HM-CHAT-01.pay.cancelled" });
    expect(s.calls).not.toContain("sign");
    expect((await ledger(s))[0]!.status).toBe("void");
    expect(s.prompts.at(-1)).toBe('HM-APPR-02.unlock {"amount":"5 USD₮","to":"Ana López"}');
  });

  test("signed but the network didn't take it: the reservation stays pending and the answer never says sent", async () => {
    const s = await setup({ submit: "throws" });
    await withAna(s);
    const t = await turn(s, "send Ana 5 dollars", { person: "Ana", amount: "5" });
    expect(t.result.kind === "final" && t.result.text).toMatch(/^HM-CHAT-01\.pay\.unconfirmed/);
    expect((await ledger(s))[0]!.status).toBe("pending");
    expect(s.calls.at(-1)).toBe("close");
  });

  test("no receipt yet: pending, unconfirmed", async () => {
    const s = await setup({ receipt: "pending" });
    await withAna(s);
    const t = await turn(s, "send Ana 5 dollars", { person: "Ana", amount: "5" });
    expect(t.result.kind === "final" && t.result.text).toMatch(/^HM-CHAT-01\.pay\.unconfirmed/);
    expect(s.calls.filter((c) => c === "receipt")).toHaveLength(3);
    expect((await ledger(s))[0]).toMatchObject({ status: "pending", tx_hash: "0x" + "cd".repeat(32) });
  });

  test("reverted on chain: not sent, still counted until it expires", async () => {
    const s = await setup({ receipt: "reverted" });
    await withAna(s);
    const t = await turn(s, "send Ana 5 dollars", { person: "Ana", amount: "5" });
    expect(t.result.kind === "final" && t.result.text).toMatch(/^HM-CHAT-01\.pay\.reverted/);
    expect((await ledger(s))[0]!.status).toBe("pending");
  });

  test("an approval signed by another key never reaches the worklet", async () => {
    const s = await setup();
    await withAna(s);
    const other = softwareApprovalKey(22);
    await turn(s, "send Ana 5 dollars", { person: "Ana", amount: "5" }, { approve: (r) => ({ kind: "approved", biometric: true, argsHash: r.call.argsHash, signature: other.sign(r.signed!.message) }) });
    expect(s.calls).not.toContain("open");
    expect((await ledger(s))[0]!.status).toBe("void");
  });

  test("an execute with no reserved, approved payment does nothing", async () => {
    const s = await setup();
    const rt = await s.payments.runtime();
    const r = await rt.execute({ to: ANA, amount: "5" }, { session: { id: "s", taint: [], unattended: false } });
    expect(r.ok).toBe(false);
    expect(s.calls).toEqual([]);
  });
});

describe("through the composition root", () => {
  async function hermitWith(opts: { pay: boolean }) {
    const requests: string[] = [];
    const engine: CompletionEngine = { complete: async (req) => (requests.push(JSON.stringify(req)), { text: '{"choice":"respond","text":"ok"}', toolCalls: [] }) };
    const enrolled = softwareApprovalKey(30);
    const worklet: PayWorkletPort = {
      balance: async () => ({ usdt0: 0n, native: 0n }), quoteFee: async () => 0n, open: async () => ({ address: wallet.address }),
      sign: async () => "0x", submit: async () => "0x", receipt: async () => "pending" as const, close: async () => {},
    };
    const hermit = createHermit({
      sql: nodeSql(), signer: ed25519Signer(new Uint8Array(32).fill(4)),
      notifier: { schedule: async () => "n", cancel: async () => {} },
      calendar: { list: async () => [], add: async () => {}, calendars: async () => [] },
      replySender: { send: async () => "sent" as const }, engine,
      approvals: { request: async () => ({ kind: "denied" as const }) },
      now: () => NOW, timeZone: () => "UTC", language: () => "en" as const, newId: () => Math.random().toString(16).slice(2),
      approvalKey: { port: { state: async () => ({ state: "ready", publicKey: enrolled.spki, level: "strongbox" }), enroll: async () => { throw new Error("no"); }, destroy: async () => {} }, randomBytes: (n) => new Uint8Array(n).fill(1) },
      wallet: {
        key: { exists: async () => true, store: async () => "stored", unwrap: async () => ({ kind: "cancelled" }), destroy: async () => {} },
        record: { read: async () => serializeWalletRecord(record), write: async () => {}, remove: async () => {} },
        worklet: { create: async () => { throw new Error("no"); }, restore: async () => { throw new Error("no"); }, reveal: async () => { throw new Error("no"); }, balance: async () => ({ usdt0: 0n }), close: async () => {} },
        random: (n) => new Uint8Array(n), onScreen: () => true,
      },
      ...(opts.pay ? { pay: { worklet, confirm: async () => true, copy: (_l: string, k: string) => k } } : {}),
    }, profileById("botpsy-q4-two-stage-nothink")!);
    await hermit.init();
    return { hermit, requests };
  }

  test("with the wallet, the approval key and the pay port, the chat's menu offers pay and HM-PAY-05 has its service", async () => {
    const h = await hermitWith({ pay: true });
    expect(h.hermit.payments).toBeDefined();
    await h.hermit.send(await h.hermit.startSession(), "send Ana 5 dollars");
    expect(h.requests.some((r) => r.includes("Send money in USD₮"))).toBe(true);
  });

  test("without the pay port there is no pay skill and no HM-PAY-05 service", async () => {
    const h = await hermitWith({ pay: false });
    expect(h.hermit.payments).toBeUndefined();
    await h.hermit.send(await h.hermit.startSession(), "send Ana 5 dollars");
    expect(h.requests.some((r) => r.includes("Send money in USD₮"))).toBe(false);
  });
});

describe("HM-PAY-05: caps and payees, behind a fingerprint and logged", () => {
  test("the defaults until set; a change needs the fingerprint and leaves a hash and a code in the log", async () => {
    const s = await setup();
    expect(await s.payments.caps()).toMatchObject({ caps: { perPayment: usdt(25_000_000n), perDay: usdt(50_000_000n) }, custom: false, spentToday: usdt(0n) });
    expect(await s.payments.setCaps({ perPayment: usdt(5_000_000n), perDay: usdt(10_000_000n) }, "Confirm the new caps")).toEqual({ kind: "saved" });
    expect(await s.payments.caps()).toMatchObject({ caps: { perPayment: usdt(5_000_000n), perDay: usdt(10_000_000n) }, custom: true });
    const e = (await s.audit.entries()).at(-1)!;
    expect(e).toMatchObject({ event: "spending", reason: "caps.changed", argsHash: expect.stringMatching(/^[0-9a-f]{64}$/) });
  });

  test("a cancelled fingerprint changes nothing; invalid caps are never asked", async () => {
    const s = await setup({ confirm: false });
    expect(await s.payments.setCaps({ perPayment: usdt(5_000_000n), perDay: usdt(10_000_000n) }, "confirm")).toEqual({ kind: "cancelled" });
    expect((await s.payments.caps()).custom).toBe(false);
    expect(await s.payments.setCaps({ perPayment: usdt(20n), perDay: usdt(10n) }, "confirm")).toEqual({ kind: "invalid", problem: "per_payment_above_per_day" });
    expect(s.prompts).toEqual(["confirm"]);
  });

  test("raising a cap doesn't retry a refused payment", async () => {
    const s = await setup();
    await withAna(s);
    await turn(s, "send Ana 30 dollars", { person: "Ana", amount: "30" });
    await s.payments.setCaps({ perPayment: usdt(40_000_000n), perDay: usdt(50_000_000n) }, "confirm");
    expect(await ledger(s)).toEqual([]);
    expect(s.calls).toEqual([]);
  });

  test("payees: saved checksummed, a typo'd checksum, your own address or a repeat refused; removed behind a fingerprint", async () => {
    const s = await setup();
    const saved = await s.payments.savePayee("Ana López", ANA.toLowerCase(), "confirm");
    expect(saved).toMatchObject({ kind: "saved", payee: { name: "Ana López", address: ANA } });
    expect(await s.payments.savePayee("Ana 2", ANA, "confirm")).toEqual({ kind: "exists" });
    expect(await s.payments.savePayee("Typo", "0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAeD", "confirm")).toEqual({ kind: "invalid", problem: "checksum" });
    expect(await s.payments.savePayee("Me", wallet.address, "confirm")).toEqual({ kind: "invalid", problem: "own_address" });
    const id = saved.kind === "saved" ? saved.payee.id : "";
    expect(await s.payments.removePayee(id, "confirm")).toBe("removed");
    expect(await s.payments.payees()).toEqual([]);
    const log = JSON.stringify(await s.audit.entries());
    expect(log).not.toContain("Ana");
    expect(log.toLowerCase()).not.toContain(ANA.toLowerCase());
    expect((await s.audit.entries()).map((e) => e.reason)).toEqual(["payee.saved", "payee.removed"]);
  });
});
