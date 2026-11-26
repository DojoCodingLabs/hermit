import {
  argsHash, checksummed, formatMoney, isReadableType, parseWebUrl, subMoney, usdt, WALLET_NETWORK,
  type Money, type SpendingCaps, type WebFetchPort, type X402HeaderName,
} from "@hermit/core";
import type { AuditLog } from "@hermit/cage";
import { answerFromPage, extractReadable, fetchHtml, WEB_LIMITS, type HoldResult, type SkillResult, type SkillRuntime, type WebLanguage, type WebSkillDeps } from "@hermit/agent";
import {
  authorizationStateCall, buildPayment, readAuthorizationState, readBlock, readMerchantOffer, readPaidResponse, resolvePending, X402Error,
  type MerchantOffer, type PaidResponse, type PaymentDraft, type SpendRecord,
} from "@hermit/payments";
import { PAY_NETWORK_LABEL, payMerchantDef } from "@hermit/skills";
import type { PayLanguageSay, PayWorkletPort, SqlLedger } from "./pay.ts";
import type { WalletChainPort } from "./wallet.ts";

/**
 * SL-41 (US-PAY-07, FR-PAY-04, PDR-011): paying a site that answers HTTP 402 with x402 terms, in USD₮, within the
 * same caps, ledger, sheet and signatures as SL-40's `pay`.
 *
 * Before the sheet, code: the address is one the user gave (the normalizer); the page is fetched through the same hop
 * checks as read_web; the 402 is parsed and only exact EIP-3009 USD₮0 on Stable testnet is kept (anything else is
 * refused, never converted); the payee isn't the user's own wallet; the per-payment cap and the balance hold; a second
 * authorization for the same requirement is refused while one is pending; the authorization is built and reserved
 * under the daily cap with its requirement, in one transaction. The Keystore signs the merchant's origin, the amount
 * and the payee. Only then the wallet signs, in the worklet, and the page is asked again with the payment header.
 * "Paid" is said only when the chain's `authorizationState` shows the nonce used; otherwise the payment stays pending
 * (it may still settle until validBefore) and is voided by block time after VOID_MARGIN_SECONDS.
 *
 * The merchant's text never reaches the model or the sheet: the sheet shows the user's own address, the host, the
 * price, the payee and the network; the paid page goes only to the quarantined reader, as read_web's does.
 */

export interface MerchantPayDeps {
  ledger: SqlLedger;
  audit: AuditLog;
  now(): number;
  randomBytes(n: number): Uint8Array;
  sleep(ms: number): Promise<void>;
  say: PayLanguageSay;
  worklet: PayWorkletPort;
  unwrap(prompt: string): Promise<{ kind: "key"; key: Uint8Array } | { kind: string }>;
  wallet(): Promise<{ kind: "none" } | { kind: "lost" } | { kind: "ok"; rec: { id: string; address: string; sealed: string } }>;
  caps(): Promise<SpendingCaps>;
  fetch: WebFetchPort;
  chain: WalletChainPort;
  /** The quarantined reader and the web copy, for the page once it is paid for. */
  page: Pick<WebSkillDeps, "read" | "t" | "onPage" | "language">;
  /** Chain checks after the merchant says it settled, and the wait between them. */
  tries: number;
  delayMs: number;
}

/** An authorization this close to its validBefore isn't signed: it might expire on the way to the merchant. */
const SIGN_MARGIN_SECONDS = 30;
/** Pending rows checked against the chain before each purchase. */
const RECONCILE_LIMIT = 10;

const show = (m: Money) => formatMoney(m, "en", 6);

const OFFER_REFUSAL: Partial<Record<X402Error["code"], string>> = {
  unsupported_network: "merchant_unsupported",
  unsupported_asset: "merchant_unsupported",
  unsupported_scheme: "merchant_unsupported",
  domain_mismatch: "merchant_unsupported",
  timeout_too_long: "merchant_unsupported",
  host_mismatch: "merchant_other_site",
};

interface Held {
  offer: MerchantOffer;
  draft: PaymentDraft;
  record: SpendRecord;
  argsHash: string;
  walletId: string;
  sealed: string;
  userText: string;
}

export function merchantPay(deps: MerchantPayDeps): SkillRuntime {
  const holds = new Map<string, Held>();

  /** The chain's word on one authorization, at the latest block; undefined when the chain can't be read. */
  async function onChain(record: Pick<SpendRecord, "payer" | "token" | "nonce">): Promise<{ used: boolean; time: number } | undefined> {
    try {
      const block = readBlock(await deps.chain.call("eth_getBlockByNumber", ["latest", false]));
      const result = await deps.chain.call("eth_call", [authorizationStateCall(record), block.number]);
      if (typeof result !== "string") return undefined;
      return { used: readAuthorizationState(result), time: block.timestamp };
    } catch {
      return undefined;
    }
  }

  /**
   * Settles the pending authorizations the chain shows used, and voids the ones it shows unused past validBefore plus
   * VOID_MARGIN_SECONDS, by the block's time, never the phone's. Anything the chain can't answer stays pending.
   */
  async function reconcile(): Promise<void> {
    const pending = await deps.ledger.pending(RECONCILE_LIMIT).catch((): SpendRecord[] => []);
    for (const r of pending) {
      const state = await onChain(r);
      if (!state) return;
      const next = resolvePending(r, state.used, state.time);
      if (next.status !== "pending") await deps.ledger.update(r.nonce, next.status).catch(() => {});
    }
  }

  const release = async (requestId: string) => {
    const h = holds.get(requestId);
    holds.delete(requestId);
    if (h) await deps.ledger.update(h.record.nonce, "void").catch(() => {});
  };

  async function hold(args: Record<string, unknown>, ctx: { userText: string; requestId: string; argsHash: string }): Promise<HoldResult> {
    const said = ctx.userText;
    const refuse = (code: string, vars?: Record<string, string>, ask = false): HoldResult => ({ ok: false, code, reply: deps.say(`HM-CHAT-01.pay.${code}`, said, vars), ask });

    // The address: only one the user gave (normalizePayMerchant left it empty otherwise).
    const asked = typeof args.url === "string" ? parseWebUrl(args.url) : undefined;
    if (asked?.scheme !== "https") return refuse("merchant_no_link", undefined, true);

    const w = await deps.wallet();
    if (w.kind === "none") return refuse("no_wallet");
    if (w.kind === "lost") return refuse("wallet_lost");
    const from = checksummed(w.rec.address);

    // The page, through every hop check read_web makes. Only a 402 from the site the user named is read as an offer.
    const got = await fetchHtml(deps.fetch, asked.url).catch(() => ({ kind: "failed" as const }));
    if (got.kind === "offline" || got.kind === "timeout") return refuse("merchant_offline", { site: asked.host });
    if (got.kind === "html") return refuse("merchant_free", { site: asked.host });
    if (got.kind !== "payment_required") return refuse("merchant_unreachable", { site: asked.host });
    let offer: MerchantOffer;
    try {
      if (parseWebUrl(got.url)?.host !== asked.host) throw new X402Error("host_mismatch", "The 402 came from another host.");
      offer = readMerchantOffer({ status: got.status, headers: got.headers, body: got.body }, got.url);
    } catch (e) {
      const code = e instanceof X402Error ? OFFER_REFUSAL[e.code] : undefined;
      return refuse(code ?? "merchant_unreadable", { site: asked.host });
    }
    const payTo = checksummed(offer.payTo);
    if (payTo === from) return refuse("self");

    const caps = await deps.caps();
    if (offer.price.amount > caps.perPayment.amount) return refuse("merchant_over_per_payment", { site: offer.host, cap: show(caps.perPayment), amount: show(offer.price) });

    // Nothing pays the merchant's gas from the wallet (its facilitator submits), so only the price must be covered.
    let balance: { usdt0: bigint };
    try {
      balance = await deps.worklet.balance(from);
    } catch {
      return refuse("offline");
    }
    if (balance.usdt0 < offer.price.amount) return refuse("merchant_insufficient", { balance: show(usdt(balance.usdt0)), amount: show(offer.price) });

    // Dead authorizations stop counting before this one is weighed against the daily cap.
    await reconcile();

    let draft: PaymentDraft;
    try {
      draft = buildPayment(offer.required, offer.selection, { from, nowSeconds: deps.now() / 1000, nonce: deps.randomBytes(32) });
    } catch {
      return refuse("failed");
    }
    const record: SpendRecord = {
      amount: offer.price, payer: from, token: offer.selection.asset.address, nonce: draft.authorization.nonce,
      validBefore: Number(draft.authorization.validBefore), atMs: deps.now(), status: "pending", recipient: payTo,
    };
    const reserved = await deps.ledger.reserveMerchant(record, caps, deps.now(), { requirementHash: offer.requirementHash, origin: offer.origin });
    if (!reserved.ok) {
      if (reserved.reason === "pending") return refuse("merchant_pending", { site: offer.host });
      if (reserved.reason === "over_per_payment") return refuse("merchant_over_per_payment", { site: offer.host, cap: show(caps.perPayment), amount: show(offer.price) });
      const spent = await deps.ledger.spentToday(deps.now());
      const left = caps.perDay.amount > spent.amount ? subMoney(caps.perDay, spent) : usdt(0n);
      return refuse("over_per_day", { cap: show(caps.perDay), left: show(left) });
    }
    holds.set(ctx.requestId, { offer, draft, record, argsHash: ctx.argsHash, walletId: w.rec.id, sealed: w.rec.sealed, userText: said });
    const after = await deps.ledger.spentToday(deps.now());
    const capLeft = caps.perDay.amount > after.amount ? subMoney(caps.perDay, after) : usdt(0n);
    const minutes = String(Math.max(1, Math.ceil(offer.selection.requirement.maxTimeoutSeconds / 60)));
    return {
      ok: true,
      lines: [
        { label: "Amount", value: show(offer.price), flag: "pay_amount" },
        { label: "To", value: payTo, flag: "pay_to" },
        { label: "Network", value: PAY_NETWORK_LABEL, flag: "pay_network" },
        { label: "Can be collected for", value: deps.say("HM-APPR-02.validFor", said, { minutes }), flag: "pay_valid" },
        { label: "Left today after this", value: show(capLeft), flag: "pay_cap_left" },
      ],
      terms: { amount: offer.price, recipient: payTo, origin: offer.origin },
      release: () => release(ctx.requestId),
    };
  }

  const execute: SkillRuntime["execute"] = async (_args, ctx): Promise<SkillResult> => {
    const signed = ctx.signedApproval;
    const requestId = signed?.payload.requestId ?? "";
    const h = holds.get(requestId);
    holds.delete(requestId);
    const said = ctx.userText ?? h?.userText ?? "";
    const answer = (ok: boolean, key: string, modelText: string, vars?: Record<string, string>): SkillResult => ({ ok, modelText, reply: deps.say(`HM-CHAT-01.pay.${key}`, said, vars) });
    const voidIt = async () => {
      if (h) await deps.ledger.update(h.record.nonce, "void").catch(() => {});
    };
    if (!signed || !h) {
      await voidIt();
      return answer(false, "failed", "Not paid: there was no approved, reserved purchase for this call. Nothing was signed.");
    }
    // The Keystore-signed payload (verified by the loop) must be exactly what was reserved: amount, payee, origin.
    const p = signed.payload;
    const msg = h.draft.authorization;
    const now = deps.now();
    const same = p.risk === "spend" && p.argsHash === h.argsHash && p.amount?.value === msg.value && p.amount.asset === WALLET_NETWORK.asset
      && p.amount.network === WALLET_NETWORK.network && p.recipient === checksummed(msg.to) && p.origin === h.offer.origin && now < p.expiresAt;
    if (!same) {
      await voidIt();
      return answer(false, "failed", "Not paid: the approval doesn't match the reserved purchase. Nothing was signed.");
    }
    if (now / 1000 >= h.record.validBefore - SIGN_MARGIN_SECONDS) {
      await voidIt();
      return answer(false, "expired", "Not paid: the approval came too late. Nothing was signed.");
    }
    const vars = { amount: show(h.record.amount), site: h.offer.host };

    // The wallet key, behind its own fingerprint, for one open and one signature; zeroed whatever happens.
    const unwrapped = await deps.unwrap(deps.say("HM-APPR-02.unlockMerchant", said, vars)).catch(() => ({ kind: "lost" }));
    if (unwrapped.kind !== "key" || !("key" in unwrapped)) {
      await voidIt();
      return unwrapped.kind === "cancelled"
        ? answer(false, "cancelled", "Not paid: the user cancelled unlocking the wallet. Nothing was signed.")
        : answer(false, "wallet_lost", "Not paid: the wallet key is gone. Nothing was signed.");
    }
    let signature: string;
    try {
      let opened: { address: string };
      try {
        opened = await deps.worklet.open({ id: h.walletId, key: unwrapped.key, sealed: h.sealed });
      } finally {
        unwrapped.key.fill(0);
      }
      if (checksummed(opened.address) !== checksummed(msg.from)) throw new Error("Another wallet.");
      signature = await deps.worklet.sign(msg.from, h.draft.typedData);
    } catch {
      await voidIt();
      return answer(false, "failed", "Not paid: the wallet couldn't sign. Nothing was signed.");
    } finally {
      await deps.worklet.close().catch(() => {});
    }

    // A signature exists from here: the merchant can settle it until validBefore, whatever it answers, so the
    // reservation stays pending unless the chain shows the nonce used.
    let header: { name: string; value: string };
    try {
      header = h.draft.header(signature);
    } catch {
      return answer(false, "merchant_unconfirmed", "Not confirmed: the signature couldn't be sent. Do not say it was paid.", vars);
    }
    const name = header.name === "PAYMENT-SIGNATURE" || header.name === "X-PAYMENT" ? (header.name as X402HeaderName) : undefined;
    // One request, to the exact address the offer was for; a redirect is never followed with the payment header.
    const hop = name
      ? await deps.fetch.get(h.offer.url, { maxBytes: WEB_LIMITS.maxBytes, timeoutMs: WEB_LIMITS.timeoutMs, payment: { name, value: header.value } })
        .catch(() => ({ kind: "error" as const, reason: "failed" as const }))
      : ({ kind: "error" as const, reason: "failed" as const });
    const samePage = hop.kind === "page" && (!hop.url || parseWebUrl(hop.url)?.url === h.offer.url);
    const merchant: PaidResponse = hop.kind === "page"
      ? samePage ? readPaidResponse({ status: hop.status, headers: hop.x402 ?? {}, body: hop.body }) : { kind: "unconfirmed", reason: "moved" }
      : { kind: "unconfirmed", reason: hop.kind === "redirect" ? "redirect" : hop.reason };

    // The chain, not the merchant, says whether it was paid.
    let used = false;
    const tries = merchant.kind === "settled" ? deps.tries : 1;
    for (let i = 0; i < tries && !used; i++) {
      if (i > 0) await deps.sleep(deps.delayMs);
      used = (await onChain(h.record))?.used ?? false;
    }
    // The merchant's transaction hash is its own claim, never checked on chain, so it is not kept: the ledger and the
    // signed log key the purchase by its requirement, and Transactions shows the transfer from the chain's own logs.
    if (used) await deps.ledger.update(h.record.nonce, "settled").catch(() => {});
    // Q128: one entry per signed purchase, keyed by the requirement. The log never holds a hash, the address or the
    // merchant's text.
    await deps.audit.append({
      // Multi-bot: like every entry of the turn, it names the bot the turn ran as.
      ts: deps.now(), sessionId: ctx.session.id, ...(ctx.session.botId ? { bot: ctx.session.botId } : {}), event: "spending", skill: "pay_merchant",
      argsHash: argsHash({ requirement: h.offer.requirementHash }),
      outcome: used ? "ok" : "error", reason: used ? "payment.sent" : "payment.unconfirmed",
    }).catch(() => {});

    // The page, when the merchant served it to the paid request: only through the quarantined reader.
    let page: SkillResult | undefined;
    if (hop.kind === "page" && samePage && hop.status >= 200 && hop.status < 300 && isReadableType(hop.contentType)) {
      const { title, text } = extractReadable(hop.body, hop.contentType);
      const domain = parseWebUrl(h.offer.url)?.domain ?? h.offer.host;
      if (text) {
        const lang: WebLanguage = deps.page.language(said);
        page = await answerFromPage(deps.page, { kind: "page", url: h.offer.url, domain, title, text, truncated: hop.truncated }, said, lang);
      }
    }
    const paid = used
      ? answer(true, "merchant_paid", `Paid ${vars.amount} to ${h.offer.host}; the chain confirmed it.`, vars)
      : answer(false, "merchant_unconfirmed", `Not confirmed: signed ${vars.amount} for ${h.offer.host}, but the chain doesn't show it paid yet (${merchant.kind === "settled" ? "the site says it settled" : merchant.reason}). Do not say it was paid.`, vars);
    // A6: the receipt card's facts (the price and the host, from the parsed offer), never the page's answer.
    const receipt = used ? { receipt: { kind: "paid" as const, amount: vars.amount, to: h.offer.host } } : {};
    if (!page) return { ...paid, ...receipt };
    return {
      ...receipt,
      ok: paid.ok,
      untrusted: true,
      modelText: `${paid.modelText}\n${page.modelText}`,
      reply: `${paid.reply}\n\n${page.reply}`,
    };
  };

  return {
    def: payMerchantDef,
    hold: (args, ctx) => hold(args, ctx),
    execute,
  };
}
