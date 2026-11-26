// SL-41 (US-PAY-07, FR-PAY-04): a merchant's HTTP 402 as untrusted content. Code parses it, keeps one offer Hermit
// can pay, ties it to the address the user asked for, and fingerprints it. The merchant's free text (`error`,
// `description`) never leaves this file: the sheet and the model get the price, the payee, the network and the
// user's own address.
import { parseWebUrl, type Money } from "@hermit/core";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils.js";
import { isAddress } from "./eip712.ts";
import { X402Error } from "./errors.ts";
import {
  parsePaymentRequired,
  parseSettlement,
  selectRequirement,
  TESTNET_ASSETS,
  type HttpLikeResponse,
  type PaymentRequired,
  type PaymentRequirement,
  type Selection,
  type X402Asset,
} from "./x402.ts";

export interface MerchantOffer {
  required: PaymentRequired;
  selection: Selection;
  /** USD₮ base units on the offer's network (Stable testnet only, PDR-027). */
  price: Money;
  /** The address the authorization pays, as the offer wrote it (a valid EVM address). */
  payTo: string;
  /** The address the user asked for, normalized; what the sheet shows as the page. */
  url: string;
  /** `https://host[:port]` of that address; the signed approval's origin. */
  origin: string;
  /** Its host, lowercase; what the sheet shows as the merchant. */
  host: string;
  /** One requirement for one address (see `requirementHash`). */
  requirementHash: string;
}

/** `https://host[:port]` of a normalized web address. */
function originOf(url: string): string {
  const i = url.indexOf("/", "https://".length);
  return i < 0 ? url : url.slice(0, i);
}

/**
 * The fingerprint of what is being bought: the address the user asked for and the offer's scheme, network, token,
 * payee and amount. A pending authorization with the same fingerprint means the same thing was already signed, so a
 * retry (the model's, the user's or a reconnect's) is refused instead of signing a second one.
 */
export function requirementHash(url: string, r: Pick<PaymentRequirement, "scheme" | "network" | "asset" | "payTo" | "amount">): string {
  const text = ["x402", url, r.scheme, r.network, r.asset.toLowerCase(), r.payTo.toLowerCase(), r.amount.toString()].join("|");
  return bytesToHex(sha256(utf8ToBytes(text)));
}

/**
 * Reads a 402 for the address the user asked for (`requestedUrl`, https). Throws an X402Error with a reason code:
 * - `not_402`, `malformed`, `version`: not a payment request Hermit can read (a zero amount or a payTo that isn't an
 *   EVM address is malformed);
 * - `unsupported_network`, `unsupported_asset`, `unsupported_scheme`, `domain_mismatch`, `timeout_too_long`: no offer
 *   is exact EIP-3009 USD₮0 on Stable testnet within MAX_TIMEOUT_SECONDS; another asset is refused, never converted;
 * - `host_mismatch`: the 402 names a resource on another origin than the one the user asked for;
 * - `bad_input`: the requested address isn't https.
 */
export function readMerchantOffer(res: HttpLikeResponse, requestedUrl: string, assets: readonly X402Asset[] = TESTNET_ASSETS): MerchantOffer {
  const asked = parseWebUrl(requestedUrl);
  if (asked?.scheme !== "https") throw new X402Error("bad_input", "Only an https address can be paid for.");
  const required = parsePaymentRequired(res);
  const selection = selectRequirement(required, assets);
  const r = selection.requirement;
  if (r.amount <= 0n) throw new X402Error("malformed", "The amount is zero.");
  if (!isAddress(r.payTo)) throw new X402Error("malformed", "payTo is not an EVM address.");
  const origin = originOf(asked.url);
  const resource = parseWebUrl(required.resource.url);
  if (!resource || resource.scheme !== "https" || originOf(resource.url) !== origin) {
    throw new X402Error("host_mismatch", "The payment request is for another site than the one asked for.");
  }
  return {
    required,
    selection,
    price: selection.price,
    payTo: r.payTo,
    url: asked.url,
    origin,
    host: asked.host,
    requirementHash: requirementHash(asked.url, r),
  };
}

export type PaidResponse =
  /** The merchant says its facilitator settled, and names the transaction. Still checked on chain before "paid". */
  | { kind: "settled"; transaction: string }
  /** Anything else after signing: the authorization may still settle until validBefore, so it stays pending. */
  | { kind: "unconfirmed"; reason: string };

const CODE = /^[a-z0-9_]{1,64}$/;
const code = (text: string | undefined, fallback: string) => (text && CODE.test(text) ? text : fallback);

/**
 * What the merchant answered to the retry with the payment header. Only a 2xx with a successful settlement that names
 * a transaction is `settled`; every other answer is `unconfirmed` with a short reason code (the facilitator's codes,
 * such as `invalid_exact_evm_insufficient_balance`, pass through; free text never does).
 */
export function readPaidResponse(res: HttpLikeResponse): PaidResponse {
  if (res.status === 402) {
    try {
      return { kind: "unconfirmed", reason: code(parsePaymentRequired(res).error, "status_402") };
    } catch {
      return { kind: "unconfirmed", reason: "status_402" };
    }
  }
  if (res.status < 200 || res.status >= 300) {
    let reason: string | undefined;
    try {
      const body = JSON.parse(res.body) as { invalidReason?: unknown; errorReason?: unknown };
      reason = typeof body.invalidReason === "string" ? body.invalidReason : typeof body.errorReason === "string" ? body.errorReason : undefined;
    } catch {
      /* not JSON */
    }
    return { kind: "unconfirmed", reason: code(reason, `status_${res.status}`) };
  }
  let s;
  try {
    s = parseSettlement(res.headers);
  } catch {
    return { kind: "unconfirmed", reason: "malformed_settlement" };
  }
  if (!s) return { kind: "unconfirmed", reason: "no_settlement" };
  if (!s.success) return { kind: "unconfirmed", reason: code(s.errorReason, "settlement_failed") };
  if (!s.transaction || !/^0x[0-9a-fA-F]{64}$/.test(s.transaction)) return { kind: "unconfirmed", reason: "malformed_settlement" };
  return { kind: "settled", transaction: s.transaction };
}
