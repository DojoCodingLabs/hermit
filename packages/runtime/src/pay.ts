import {
  amountInWords, argsHash, capsProblem, checksummed, DEFAULT_SPENDING_CAPS, formatMoney, matchPayees, money, parseWalletRecord, payeeProblem,
  subMoney, transferRef, typedAddresses, usdt, WALLET_NETWORK,
  type CapsProblem, type Money, type Payee, type SpendingCaps, type SqlPort, type WalletKeyPort, type WebFetchPort,
} from "@hermit/core";
import type { AuditLog } from "@hermit/cage";
import type { HoldResult, SkillRuntime } from "@hermit/agent";
import {
  checkCaps, DAY_MS, planTransfer, spentInWindow, TESTNET_ASSETS, X402Error,
  type CapCheck, type LedgerPort, type SpendingCap, type SpendRecord, type TransferPlan, type TransferReceipt, type TransferWithAuthorizationTypedData,
} from "@hermit/payments";
import { normalizePay, payDef, payMoney } from "@hermit/skills";
import { merchantPay, type MerchantPayDeps } from "./pay-merchant.ts";
import type { WalletChainPort, WalletRecordPort } from "./wallet.ts";

/**
 * SL-40 (US-PAY-05, US-PAY-06, FR-PAY-03, FR-PAY-05, PDR-011): paying a person by asking, within caps.
 *
 * The model picks `pay` and fills it; the normalizer fixes the amount and the recipient from the user's words. Then
 * code, here, before the sheet: the asset is USD₮, the amount is the one the user said, the recipient is an address
 * the user typed this turn or a saved payee they named, the wallet is there, the per-payment cap holds, the balance
 * covers the amount and the fee, and the payment is reserved in the spend ledger under the daily cap in one
 * transaction (reserve before approve). The cage asks with the fingerprint and the Keystore signs the exact payload
 * (SL-37); the loop verifies the signature, the nonce, the expiry and the args hash. Only then, here again, the wallet
 * key is unwrapped (its own fingerprint), the worklet signs the authorization the ledger reserved, and the wallet
 * submits it. Nothing is reported as sent unless the chain says it was.
 *
 * Secrets never leave the worklet; the model sees the args it wrote and short notes, never a balance or a key; the
 * signed log keeps hashes (args, payload) and the ledger keeps the transaction hash.
 */

/** What the payment flow needs from the wallet worklet, behind the app's adapter. Every method may throw. */
export interface PayWorkletPort {
  /** USD₮0 base units and native wei (Stable's gas is USD₮0), for a public address; no key. */
  balance(address: string): Promise<{ usdt0: bigint; native: bigint }>;
  /** The fee estimate in wei, for a public address; no key. */
  quoteFee(req: { from: string; to: string; value: bigint }): Promise<bigint>;
  /** Unseals the wallet for signing; returns its address. */
  open(req: { id: string; key: Uint8Array; sealed: string }): Promise<{ address: string }>;
  /** Signs the authorization in the worklet; the adapter recovers the signature and refuses another signer's. */
  sign(address: string, typedData: TransferWithAuthorizationTypedData): Promise<string>;
  /** Submits the signed authorization from the open wallet; the transaction hash. */
  submit(req: { typedData: TransferWithAuthorizationTypedData; signature: string }): Promise<string>;
  receipt(hash: string): Promise<TransferReceipt>;
  close(): Promise<void>;
}

export type PayLanguageSay = (key: string, userText: string, vars?: Record<string, string>) => string;

export interface PayDeps {
  sql: SqlPort;
  audit: AuditLog;
  now(): number;
  newId(): string;
  randomBytes(n: number): Uint8Array;
  wallet: { key: WalletKeyPort; record: WalletRecordPort; worklet: PayWorkletPort };
  /** A strong-biometric check for changing caps and payees on HM-PAY-05 (PDR-011). */
  confirm(prompt: string): Promise<boolean>;
  /** Copy for the chat's answers (`HM-CHAT-01.pay.*`) and the sheet's lines (`HM-APPR-02.*`), in the user's language. */
  say: PayLanguageSay;
  /** Waits between receipt checks. */
  sleep(ms: number): Promise<void>;
  /** Receipt checks after submitting, and the wait between them. */
  receiptTries?: number;
  receiptDelayMs?: number;
  /**
   * SL-41: paying a site that asks for x402. The web port the page is fetched and retried through, and Stable
   * testnet's read-only RPC for `authorizationState` and the block time. Without it there is no `pay_merchant`.
   */
  merchant?: { fetch: WebFetchPort; chain: WalletChainPort };
}

const SESSION = "user";
const USDT0 = TESTNET_ASSETS.find((a) => a.network === WALLET_NETWORK.network)!;
/** Stable's gas token has 18 decimals and USD₮0 has 6: a wei fee in USD₮ base units, rounded up. */
const WEI_PER_BASE_UNIT = 10n ** 12n;
/** An authorization this close to its validBefore isn't signed: it might expire on the way to the chain. */
const SIGN_MARGIN_SECONDS = 30;

const show = (m: Money) => formatMoney(m, "en", 6);
const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

// --- The spend ledger ---------------------------------------------------------------------------------------------

/** SL-41: what an x402 purchase links its ledger row to (migration 16). */
export interface MerchantLink {
  requirementHash: string;
  origin: string;
}

export type SqlLedger = LedgerPort & {
  setTxHash(nonce: string, hash: string): Promise<void>;
  spentToday(nowMs: number): Promise<Money>;
  /**
   * SL-41: `reserve` for a merchant, in the same transaction: refused with `pending` while an authorization for the
   * same requirement is still pending (it may yet settle), else reserved and linked to its requirement.
   */
  reserveMerchant(record: SpendRecord, cap: SpendingCaps, nowMs: number, link: MerchantLink): Promise<CapCheck | { ok: false; reason: "pending" }>;
  /** SL-41: the pending rows, oldest first, for the chain check that settles or voids them. */
  pending(limit: number): Promise<SpendRecord[]>;
};

/**
 * The spend ledger on SQLite (migration 15; SL-41's purchase links, migration 16). `reserve` re-checks the caps and
 * inserts the pending row in one transaction, under an in-process lock as well, so two payments waiting on approval
 * can't both fit under one cap.
 */
export function createSqlLedger(sql: SqlPort): SqlLedger {
  let chain: Promise<unknown> = Promise.resolve();
  const locked = <T>(fn: () => Promise<T>): Promise<T> => {
    const next = chain.then(fn, fn);
    chain = next.catch(() => undefined);
    return next;
  };
  const rows = async (asset: string, network: string, sinceMs: number): Promise<SpendRecord[]> => {
    const got = await sql.query<{ nonce: string; amount: string; payer: string; token: string; valid_before: number; at_ms: number; status: SpendRecord["status"] }>(
      "SELECT nonce, amount, payer, token, valid_before, at_ms, status FROM spend_ledger WHERE asset = ? AND network = ? AND at_ms > ? AND status <> 'void'",
      [asset, network, sinceMs],
    );
    return got.map((r) => ({ amount: money(BigInt(r.amount), asset, network), payer: r.payer, token: r.token, nonce: r.nonce, validBefore: r.valid_before, atMs: r.at_ms, status: r.status }));
  };
  const reserveIn = (record: SpendRecord, cap: SpendingCap | undefined, nowMs: number, link?: MerchantLink): Promise<CapCheck | { ok: false; reason: "pending" }> =>
    locked(() =>
      sql.transaction(async (tx) => {
        const seen = await tx.query("SELECT nonce FROM spend_ledger WHERE nonce = ?", [record.nonce]);
        if (seen.length) throw new X402Error("bad_input", "Nonce already reserved.");
        if (link) {
          const open = await tx.query(
            "SELECT m.nonce FROM merchant_purchases m JOIN spend_ledger l ON l.nonce = m.nonce WHERE m.requirement_hash = ? AND l.status = 'pending'",
            [link.requirementHash],
          );
          if (open.length) return { ok: false as const, reason: "pending" as const };
        }
        const { asset, network } = record.amount;
        const got = await tx.query<{ amount: string; at_ms: number; status: SpendRecord["status"] }>(
          "SELECT amount, at_ms, status FROM spend_ledger WHERE asset = ? AND network = ? AND at_ms > ? AND status <> 'void'",
          [asset, network, nowMs - DAY_MS],
        );
        const spent = spentInWindow(got.map((r) => ({ ...record, amount: money(BigInt(r.amount), asset, network), atMs: r.at_ms, status: r.status })), nowMs, asset, network);
        const check = checkCaps(record.amount, cap, spent);
        if (!check.ok) return check;
        await tx.exec(
          "INSERT INTO spend_ledger (nonce, amount, asset, network, payer, token, recipient, valid_before, at_ms, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')",
          [record.nonce, record.amount.amount.toString(), asset, network, record.payer, record.token, record.recipient ?? "", record.validBefore, record.atMs],
        );
        if (link) {
          await tx.exec("INSERT INTO merchant_purchases (nonce, requirement_hash, origin, created_at) VALUES (?, ?, ?, ?)", [record.nonce, link.requirementHash, link.origin, record.atMs]);
        }
        return check;
      }),
    );
  return {
    // Without a link there is no requirement to be pending, so only the caps can refuse.
    reserve: (record, cap, nowMs) => reserveIn(record, cap, nowMs) as Promise<CapCheck>,
    reserveMerchant: (record, cap, nowMs, link) => reserveIn(record, cap, nowMs, link),
    async pending(limit) {
      const got = await sql.query<{ nonce: string; amount: string; asset: string; network: string; payer: string; token: string; recipient: string; valid_before: number; at_ms: number }>(
        "SELECT nonce, amount, asset, network, payer, token, recipient, valid_before, at_ms FROM spend_ledger WHERE status = 'pending' ORDER BY at_ms LIMIT ?",
        [limit],
      );
      return got.map((r) => ({
        amount: money(BigInt(r.amount), r.asset, r.network), payer: r.payer, token: r.token, nonce: r.nonce, validBefore: r.valid_before, atMs: r.at_ms,
        status: "pending" as const, ...(r.recipient ? { recipient: r.recipient } : {}),
      }));
    },
    async update(nonce, status) {
      const got = await sql.query("SELECT nonce FROM spend_ledger WHERE nonce = ?", [nonce]);
      if (!got.length) throw new X402Error("bad_input", "Unknown nonce.");
      await sql.exec("UPDATE spend_ledger SET status = ? WHERE nonce = ? AND status = 'pending'", [status, nonce]);
    },
    async setTxHash(nonce, hash) {
      await sql.exec("UPDATE spend_ledger SET tx_hash = ? WHERE nonce = ? AND status = 'pending'", [hash, nonce]);
    },
    async spentToday(nowMs) {
      return spentInWindow(await rows(WALLET_NETWORK.asset, WALLET_NETWORK.network, nowMs - DAY_MS), nowMs, WALLET_NETWORK.asset, WALLET_NETWORK.network);
    },
  };
}

// --- Caps and payees (HM-PAY-05) ---------------------------------------------------------------------------------

/** ENT-Contact on the wallet's network, by name. HM-PAY-05 lists them; HM-PAY-03 (SL-39) names known addresses with them. */
export async function readPayees(sql: SqlPort): Promise<Payee[]> {
  const got = await sql.query<{ id: string; name: string; address: string; network: string; created_at: number }>(
    "SELECT id, name, address, network, created_at FROM contacts WHERE network = ? ORDER BY name COLLATE NOCASE", [WALLET_NETWORK.network],
  );
  return got.map((r) => ({ id: r.id, name: r.name, address: r.address, network: r.network, createdAt: r.created_at }));
}

export type CapsSave = { kind: "saved" } | { kind: "invalid"; problem: CapsProblem } | { kind: "cancelled" };
export type PayeeSave = { kind: "saved"; payee: Payee } | { kind: "invalid"; problem: "name" | "address" | "checksum" | "own_address" } | { kind: "exists" } | { kind: "cancelled" };

export interface Payments {
  /** HM-PAY-05: the caps in force (the defaults until the user sets them) and what the last 24 hours used. */
  caps(): Promise<{ caps: SpendingCaps; custom: boolean; spentToday: Money }>;
  /** Behind a fingerprint, logged. Raising a cap never retries a refused payment. */
  setCaps(caps: SpendingCaps, prompt: string): Promise<CapsSave>;
  payees(): Promise<Payee[]>;
  savePayee(name: string, address: string, prompt: string): Promise<PayeeSave>;
  removePayee(id: string, prompt: string): Promise<"removed" | "gone" | "cancelled">;
  /** The chat's `pay` skill for one turn (its normalizer knows the payees saved now). */
  runtime(): Promise<SkillRuntime>;
  /**
   * SL-41: the chat's `pay_merchant` skill for one turn, on the same ledger and caps; `page` is that turn's quarantined
   * reader for the page paid for. Undefined without the merchant ports.
   */
  merchantRuntime(page: MerchantPayDeps["page"]): SkillRuntime | undefined;
}

interface Held {
  plan: TransferPlan;
  argsHash: string;
  walletId: string;
  sealed: string;
  userText: string;
  label: string;
}

export function createPayments(deps: PayDeps): Payments {
  const ledger = createSqlLedger(deps.sql);
  const holds = new Map<string, Held>();
  const tries = deps.receiptTries ?? 10;
  const delay = deps.receiptDelayMs ?? 1500;
  const log = (reason: string, hash: string) =>
    deps.audit.append({ ts: deps.now(), sessionId: SESSION, event: "spending", skill: "spending", outcome: "ok", reason, argsHash: hash });

  async function readCaps(): Promise<{ caps: SpendingCaps; custom: boolean }> {
    const [row] = await deps.sql.query<{ per_payment: string; per_day: string }>(
      "SELECT per_payment, per_day FROM spending_caps WHERE asset = ? AND network = ?", [WALLET_NETWORK.asset, WALLET_NETWORK.network],
    );
    if (!row || !/^\d+$/.test(row.per_payment) || !/^\d+$/.test(row.per_day)) return { caps: DEFAULT_SPENDING_CAPS, custom: false };
    const caps = { perPayment: usdt(BigInt(row.per_payment)), perDay: usdt(BigInt(row.per_day)) };
    // A row that fails the checks (edited by hand, a bug) is never looser than the defaults: it isn't used.
    return capsProblem(caps) ? { caps: DEFAULT_SPENDING_CAPS, custom: false } : { caps, custom: true };
  }

  const listPayees = () => readPayees(deps.sql);

  async function walletRecord() {
    const text = await deps.wallet.record.read().catch(() => undefined);
    const rec = text === undefined ? undefined : parseWalletRecord(text);
    if (text === undefined) return { kind: "none" as const };
    if (!rec || !(await deps.wallet.key.exists().catch(() => false))) return { kind: "lost" as const };
    return { kind: "ok" as const, rec };
  }

  const release = async (requestId: string) => {
    const h = holds.get(requestId);
    holds.delete(requestId);
    if (h) await ledger.update(h.plan.record.nonce, "void").catch(() => {});
  };

  async function hold(args: Record<string, unknown>, ctx: { userText: string; requestId: string; argsHash: string }): Promise<HoldResult> {
    const said = ctx.userText;
    const refuse = (code: string, vars?: Record<string, string>, ask = false): HoldResult => ({ ok: false, code, reply: deps.say(`HM-CHAT-01.pay.${code}`, said, vars), ask });

    // The asset and the amount: USD₮, exactly what the user said this turn.
    const m = payMoney(args);
    const words = amountInWords(said);
    if (words.kind === "ambiguous" || words.kind === "invalid") return refuse("ambiguous_amount", undefined, true);
    if (!m || words.kind === "none") return refuse("how_much", undefined, true);
    if (m.asset !== WALLET_NETWORK.asset || m.network !== WALLET_NETWORK.network) return refuse("not_usdt");
    if (m.amount !== words.money.amount) return refuse("ambiguous_amount", undefined, true);

    // The recipient: an address the user typed this turn, or a saved payee whose name the user said this turn.
    const to = typeof args.to === "string" ? args.to.trim() : "";
    const person = typeof args.person === "string" ? args.person.trim() : "";
    const payees = await listPayees();
    if (!/^0x[0-9a-fA-F]{40}$/.test(to)) {
      const named = person ? matchPayees(person, said, payees) : [];
      if (named.length > 1) return refuse("which", { name: person, list: named.map((p) => `${p.name} (${short(checksummed(p.address))})`).join(", ") }, true);
      return refuse(person ? "no_payee" : "who", person ? { name: person } : undefined, true);
    }
    const typed = typedAddresses(said).some((a) => a.toLowerCase() === to.toLowerCase());
    const payee = typed ? undefined : (person ? matchPayees(person, said, payees) : []).find((p) => p.address.toLowerCase() === to.toLowerCase());
    if (!typed && !payee) return refuse("not_said");
    const recipient = checksummed(to);

    const w = await walletRecord();
    if (w.kind === "none") return refuse("no_wallet");
    if (w.kind === "lost") return refuse("wallet_lost");
    const from = checksummed(w.rec.address);
    if (from === recipient) return refuse("self");

    const { caps } = await readCaps();
    if (m.amount > caps.perPayment.amount) return refuse("over_per_payment", { cap: show(caps.perPayment) });

    // The fee and the balance, read from the chain before anything is asked.
    let fee: bigint;
    let balance: { usdt0: bigint; native: bigint };
    try {
      [fee, balance] = await Promise.all([deps.wallet.worklet.quoteFee({ from, to: recipient, value: m.amount }), deps.wallet.worklet.balance(from)]);
    } catch {
      return refuse("offline");
    }
    const feeUsdt = usdt((fee + WEI_PER_BASE_UNIT - 1n) / WEI_PER_BASE_UNIT);
    if (balance.usdt0 < m.amount + feeUsdt.amount || balance.native < fee) {
      return refuse("insufficient", { balance: show(usdt(balance.usdt0)), amount: show(m), fee: show(feeUsdt) });
    }

    let plan: TransferPlan;
    try {
      plan = planTransfer({ from, to: recipient, amount: m, asset: USDT0, nowMs: deps.now(), nonce: deps.randomBytes(32) });
    } catch {
      return refuse("failed");
    }
    const reserved = await ledger.reserve(plan.record, caps, deps.now());
    if (!reserved.ok) {
      if (reserved.reason === "over_per_payment") return refuse("over_per_payment", { cap: show(caps.perPayment) });
      // Read again: another payment may have been reserved while this one waited for the lock.
      const spent = await ledger.spentToday(deps.now());
      const left = caps.perDay.amount > spent.amount ? subMoney(caps.perDay, spent) : usdt(0n);
      return refuse("over_per_day", { cap: show(caps.perDay), left: show(left) });
    }
    // Address poisoning: a look-alike address shares the first and last characters, so one with no saved name is
    // named whole in the receipt, the reply and the unlock prompt; only a saved payee's name stands in for it.
    const label = payee ? payee.name : recipient;
    holds.set(ctx.requestId, { plan, argsHash: ctx.argsHash, walletId: w.rec.id, sealed: w.rec.sealed, userText: said, label });
    const after = await ledger.spentToday(deps.now());
    const capLeft = caps.perDay.amount > after.amount ? subMoney(caps.perDay, after) : usdt(0n);
    return {
      ok: true,
      lines: [
        payee
          ? { label: "Saved payee", value: payee.name, flag: "pay_payee" }
          : { label: "Address", value: deps.say("HM-APPR-02.typedValue", said), flag: "pay_typed" },
        { label: "Network fee (estimate)", value: show(feeUsdt), flag: "pay_fee" },
        { label: "Left today after this", value: show(capLeft), flag: "pay_cap_left" },
      ],
      release: () => release(ctx.requestId),
    };
  }

  const execute: SkillRuntime["execute"] = async (_args, ctx) => {
    const signed = ctx.signedApproval;
    const requestId = signed?.payload.requestId ?? "";
    const h = holds.get(requestId);
    holds.delete(requestId);
    const said = ctx.userText ?? h?.userText ?? "";
    const answer = (ok: boolean, key: string, modelText: string, vars?: Record<string, string>) => ({ ok, modelText, reply: deps.say(`HM-CHAT-01.pay.${key}`, said, vars) });
    const voidIt = async () => {
      if (h) await ledger.update(h.plan.record.nonce, "void").catch(() => {});
    };
    if (!signed || !h) {
      await voidIt();
      return answer(false, "failed", "Not paid: there was no approved, reserved payment for this call. Nothing was sent.");
    }
    // The Keystore-signed payload (verified by the loop) must be exactly what was reserved.
    const p = signed.payload;
    const msg = h.plan.typedData.message;
    const now = deps.now();
    const same = p.risk === "spend" && p.argsHash === h.argsHash && p.amount?.value === msg.value && p.amount.asset === WALLET_NETWORK.asset
      && p.amount.network === WALLET_NETWORK.network && p.recipient === msg.to && now < p.expiresAt;
    if (!same) {
      await voidIt();
      return answer(false, "failed", "Not paid: the approval doesn't match the reserved payment. Nothing was sent.");
    }
    if (now / 1000 >= h.plan.record.validBefore - SIGN_MARGIN_SECONDS) {
      await voidIt();
      return answer(false, "expired", "Not paid: the approval came too late. Nothing was sent.");
    }
    const vars = { amount: show(h.plan.record.amount), to: h.label };

    // The wallet key, behind its own fingerprint, for one open; zeroed whatever happens.
    const unwrapped = await deps.wallet.key.unwrap(deps.say("HM-APPR-02.unlock", said, vars)).catch(() => ({ kind: "lost" as const }));
    if (unwrapped.kind !== "key") {
      await voidIt();
      return unwrapped.kind === "cancelled"
        ? answer(false, "cancelled", "Not paid: the user cancelled unlocking the wallet. Nothing was sent.")
        : answer(false, "wallet_lost", "Not paid: the wallet key is gone. Nothing was sent.");
    }
    let signature: string;
    try {
      let opened: { address: string };
      try {
        opened = await deps.wallet.worklet.open({ id: h.walletId, key: unwrapped.key, sealed: h.sealed });
      } finally {
        unwrapped.key.fill(0);
      }
      if (checksummed(opened.address) !== msg.from) throw new Error("Another wallet.");
      signature = await deps.wallet.worklet.sign(msg.from, h.plan.typedData);
    } catch {
      await voidIt();
      await deps.wallet.worklet.close().catch(() => {});
      return answer(false, "failed", "Not paid: the wallet couldn't sign. Nothing was sent.");
    }

    // A signature exists from here: it may settle until validBefore, so the reservation stays pending unless the chain
    // confirms it. Nothing below is reported as sent without a successful receipt.
    try {
      let hash: string;
      try {
        hash = await deps.wallet.worklet.submit({ typedData: h.plan.typedData, signature });
      } catch {
        return answer(false, "unconfirmed", "Not confirmed: the payment was signed but the network didn't take it. Do not say it was sent.", vars);
      }
      await ledger.setTxHash(h.plan.record.nonce, hash).catch(() => {});
      let status: TransferReceipt = "pending";
      for (let i = 0; i < tries && status === "pending"; i++) {
        if (i > 0) await deps.sleep(delay);
        status = await deps.wallet.worklet.receipt(hash).catch((): TransferReceipt => "pending");
      }
      // Q128: one entry per submitted transfer, argsHash = transferRef(txHash), so HM-PAY-03 links the history row to it.
      // The log never holds the raw hash; the reason says how it ended when Hermit last looked.
      await deps.audit.append({
        ts: deps.now(), sessionId: ctx.session.id, event: "spending", skill: "pay", argsHash: transferRef(hash),
        outcome: status === "success" ? "ok" : "error", reason: status === "success" ? "payment.sent" : status === "reverted" ? "payment.reverted" : "payment.unconfirmed",
      }).catch(() => {});
      if (status === "success") {
        await ledger.update(h.plan.record.nonce, "settled").catch(() => {});
        // A6: the receipt card's facts, from the reserved plan and the chain, apart from the reply.
        return { ...answer(true, "sent", `Paid ${vars.amount} to ${h.label}.`, { ...vars, hash: short(hash) }), receipt: { kind: "paid" as const, amount: vars.amount, to: h.label, hash: short(hash) } };
      }
      if (status === "reverted") return answer(false, "reverted", "Not paid: the network rejected the payment. Do not say it was sent.", vars);
      return answer(false, "unconfirmed", "Not confirmed yet: submitted, no receipt. Do not say it was sent.", vars);
    } finally {
      await deps.wallet.worklet.close().catch(() => {});
    }
  };

  const merchantRuntime = (page: MerchantPayDeps["page"]) => {
    const m = deps.merchant;
    return m
      ? merchantPay({
          ledger, audit: deps.audit, now: deps.now, randomBytes: deps.randomBytes, sleep: deps.sleep, say: deps.say,
          worklet: deps.wallet.worklet, unwrap: (prompt) => deps.wallet.key.unwrap(prompt), wallet: walletRecord,
          caps: async () => (await readCaps()).caps, fetch: m.fetch, chain: m.chain, page, tries, delayMs: delay,
        })
      : undefined;
  };

  return {
    merchantRuntime,
    async caps() {
      const c = await readCaps();
      return { ...c, spentToday: await ledger.spentToday(deps.now()) };
    },
    async setCaps(caps, prompt) {
      const problem = capsProblem(caps);
      if (problem) return { kind: "invalid", problem };
      if (!(await deps.confirm(prompt).catch(() => false))) return { kind: "cancelled" };
      await deps.sql.exec(
        "INSERT INTO spending_caps (asset, network, per_payment, per_day, updated_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(asset, network) DO UPDATE SET per_payment = excluded.per_payment, per_day = excluded.per_day, updated_at = excluded.updated_at",
        [WALLET_NETWORK.asset, WALLET_NETWORK.network, caps.perPayment.amount.toString(), caps.perDay.amount.toString(), deps.now()],
      );
      await log("caps.changed", argsHash({ perPayment: caps.perPayment.amount.toString(), perDay: caps.perDay.amount.toString() }));
      return { kind: "saved" };
    },
    payees: listPayees,
    async savePayee(name, address, prompt) {
      const problem = payeeProblem(name, address);
      if (problem) return { kind: "invalid", problem };
      const a = address.trim();
      const body = a.slice(2);
      if (body !== body.toLowerCase() && body !== body.toUpperCase() && checksummed(a) !== a) return { kind: "invalid", problem: "checksum" };
      const w = await walletRecord();
      if (w.kind === "ok" && w.rec.address.toLowerCase() === a.toLowerCase()) return { kind: "invalid", problem: "own_address" };
      if ((await listPayees()).some((p) => p.address.toLowerCase() === a.toLowerCase())) return { kind: "exists" };
      if (!(await deps.confirm(prompt).catch(() => false))) return { kind: "cancelled" };
      const payee: Payee = { id: deps.newId(), name: name.trim(), address: checksummed(a), network: WALLET_NETWORK.network, createdAt: deps.now() };
      await deps.sql.exec("INSERT INTO contacts (id, name, address, network, created_at) VALUES (?, ?, ?, ?, ?)", [payee.id, payee.name, payee.address, payee.network, payee.createdAt]);
      await log("payee.saved", argsHash({ payee: payee.id }));
      return { kind: "saved", payee };
    },
    async removePayee(id, prompt) {
      const got = await deps.sql.query("SELECT id FROM contacts WHERE id = ?", [id]);
      if (!got.length) return "gone";
      if (!(await deps.confirm(prompt).catch(() => false))) return "cancelled";
      await deps.sql.exec("DELETE FROM contacts WHERE id = ?", [id]);
      await log("payee.removed", argsHash({ payee: id }));
      return "removed";
    },
    async runtime() {
      const payees = await listPayees();
      return {
        def: { ...payDef, normalize: normalizePay(payees) },
        hold: (args, ctx) => hold(args, ctx),
        execute,
      };
    },
  };
}
