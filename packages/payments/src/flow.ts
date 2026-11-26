// The whole x402 purchase behind ports. No network here: `http` is an app adapter (the WebView or
// fetch adapter on the phone, plain fetch in the desktop spike) and `approve` is the cage's
// approval sheet with the fingerprint (PDR-011: money always asks, never for the session).
import type { Money } from "@hermit/core";
import { X402Error } from "./errors.ts";
import type { LedgerPort, SpendRecord } from "./ledger.ts";
import type { TypedDataSigner } from "./signer.ts";
import {
  buildPayment,
  parsePaymentRequired,
  parseSettlement,
  selectRequirement,
  type HttpLikeResponse,
  type Settlement,
  type SpendingCap,
  type X402Asset,
} from "./x402.ts";

export interface HttpRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
}
export type HttpResponse = HttpLikeResponse;

/**
 * What the approval sheet shows and binds to: the origin the user's fetch went to (never the
 * merchant's own claim), the amount, the expiry of the authorization, and the digest that will be
 * signed if the person says yes.
 */
export interface PaymentQuote {
  origin: string;
  url: string;
  amount: Money;
  payTo: string;
  description?: string;
  testnet: boolean;
  /** Unix seconds. The signed authorization cannot settle after this. */
  validBefore: number;
  digest: string;
}

export interface X402Ports {
  http(req: HttpRequest): Promise<HttpResponse>;
  signer: TypedDataSigner;
  approve(quote: PaymentQuote): Promise<boolean>;
  nowMs(): number;
  randomBytes(n: number): Uint8Array;
}

export interface X402Policy {
  assets: readonly X402Asset[];
  cap: SpendingCap | undefined;
  /** Where every authorization is reserved before approval. Pending ones count against the cap. */
  ledger: LedgerPort;
}

export type X402Outcome =
  | { kind: "free"; response: HttpResponse }
  | { kind: "paid"; response: HttpResponse; quote: PaymentQuote; settlement: Settlement | undefined; digest: string; record: SpendRecord }
  | { kind: "refused"; reason: string; detail: string }
  | { kind: "denied"; reason: "no_cap" | "over_per_payment" | "over_per_day" }
  | { kind: "declined" }
  /**
   * Signed, but the merchant did not confirm (non-2xx, failed or malformed receipt, dropped
   * connection). The authorization may still settle, so `record` stays pending in the ledger until
   * `resolvePending` turns it void (or settled) from the chain.
   */
  | { kind: "authorized_unconfirmed"; reason: string; response: HttpResponse; quote: PaymentQuote; digest: string; record: SpendRecord };

function merchantReason(res: HttpResponse): string {
  try {
    const again = parsePaymentRequired(res);
    if (again.error) return again.error;
  } catch {
    /* fall through to the body */
  }
  try {
    const body = JSON.parse(res.body) as { error?: unknown; invalidReason?: unknown };
    if (typeof body.invalidReason === "string") return body.invalidReason;
    if (typeof body.error === "string") return body.error;
  } catch {
    /* not JSON */
  }
  return `status_${res.status}`;
}

export async function payWithX402(req: HttpRequest, ports: X402Ports, policy: X402Policy): Promise<X402Outcome> {
  const first = await ports.http(req);
  if (first.status !== 402) return { kind: "free", response: first };

  let pr, sel;
  try {
    pr = parsePaymentRequired(first);
    sel = selectRequirement(pr, policy.assets);
  } catch (e) {
    if (e instanceof X402Error) return { kind: "refused", reason: e.code, detail: e.message };
    throw e;
  }

  // Build the exact authorization before asking, so the sheet shows its expiry and digest and the
  // signature covers precisely what was approved. Nothing is signed until the person says yes.
  const startMs = ports.nowMs();
  const draft = buildPayment(pr, sel, { from: ports.signer.address, nowSeconds: startMs / 1000, nonce: ports.randomBytes(32) });
  const validBefore = Number(draft.authorization.validBefore);
  const record: SpendRecord = {
    amount: sel.price,
    payer: ports.signer.address,
    token: sel.asset.address,
    nonce: draft.authorization.nonce,
    validBefore,
    atMs: startMs,
    status: "pending",
  };

  // Reserve before asking: the ledger re-checks the cap and inserts the pending record atomically,
  // so two purchases waiting on approval at once cannot both fit under the same cap.
  const caps = await policy.ledger.reserve(record, policy.cap, startMs);
  if (!caps.ok) return { kind: "denied", reason: caps.reason };
  const release = () => policy.ledger.update(record.nonce, "void");
  const quote: PaymentQuote = {
    origin: new URL(req.url).origin,
    url: req.url,
    amount: sel.price,
    payTo: sel.requirement.payTo,
    testnet: sel.asset.testnet,
    validBefore,
    digest: draft.digest,
  };
  if (pr.resource.description) quote.description = pr.resource.description;
  // Until a signature exists, any way out releases the reservation.
  let signature: string;
  try {
    if (!(await ports.approve(quote))) {
      await release();
      return { kind: "declined" };
    }
    if (ports.nowMs() / 1000 >= validBefore) {
      await release();
      return { kind: "refused", reason: "approval_expired", detail: "The approval came back after the authorization would have expired." };
    }
    signature = await ports.signer.signTypedData(draft.typedData);
  } catch (e) {
    await release();
    throw e;
  }

  // From here a signed authorization exists and may settle. The record stays pending in the ledger
  // whatever happens next; only a confirmed 2xx moves it to settled.
  const noResponse: HttpResponse = { status: 0, headers: {}, body: "" };
  const unconfirmed = (reason: string, response: HttpResponse): X402Outcome => ({ kind: "authorized_unconfirmed", reason, response, quote, digest: draft.digest, record });
  let res: HttpResponse;
  try {
    const h = draft.header(signature);
    res = await ports.http({ ...req, headers: { ...req.headers, [h.name]: h.value } });
  } catch {
    // The header may have reached the merchant before the connection dropped.
    return unconfirmed("network_error", noResponse);
  }
  try {
    if (res.status < 200 || res.status >= 300) return unconfirmed(merchantReason(res), res);
    const settlement = parseSettlement(res.headers);
    if (settlement && !settlement.success) return unconfirmed(settlement.errorReason ?? "settlement_failed", res);
    try {
      await policy.ledger.update(record.nonce, "settled");
    } catch {
      // Leaving it pending over-counts, which is the safe direction.
    }
    return { kind: "paid", response: res, quote, settlement, digest: draft.digest, record: { ...record, status: "settled" } };
  } catch (e) {
    return unconfirmed(e instanceof X402Error ? "malformed_settlement" : "unexpected_error", res);
  }
}
