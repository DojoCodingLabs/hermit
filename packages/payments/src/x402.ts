// x402 (HTTP 402 payments) as pure logic: parse the merchant's requirements, pick an offer Hermit
// supports, check the caps, build the EIP-3009 authorization, encode the retry header, read the receipt.
// Spec: x402 v2 (https://github.com/coinbase/x402/tree/main/specs), with the v1 wire shape still accepted.
import { compareMoney, money, addMoney, type Money } from "@hermit/core";
import { bytesToHex } from "@noble/hashes/utils.js";
import { decodeBase64Json, encodeBase64Json } from "./base64.ts";
import { X402Error } from "./errors.ts";
import {
  isAddress,
  sameAddress,
  transferWithAuthorizationDigest,
  type TransferAuthorization,
  type TransferWithAuthorizationTypedData,
} from "./eip712.ts";

/** One offer from the merchant, normalized: CAIP-2 network, amount in base units. */
export interface PaymentRequirement {
  scheme: string;
  network: string;
  amount: bigint;
  asset: string;
  payTo: string;
  maxTimeoutSeconds: number;
  extra: Record<string, unknown>;
  /** The offer exactly as received, echoed back in the v2 payload's `accepted`. */
  raw: Record<string, unknown>;
}

export interface PaymentRequired {
  x402Version: 1 | 2;
  error?: string;
  resource: { url: string; description?: string; mimeType?: string };
  accepts: PaymentRequirement[];
}

/**
 * A token Hermit will pay with. Hermit pays in USD₮ only (PDR-027): every entry is USD₮ or USD₮0,
 * the list ships with the app, and nothing outside it is ever signed.
 */
export interface X402Asset {
  network: string;
  chainId: number;
  /** Token contract, the EIP-712 `verifyingContract`. */
  address: string;
  /** Money asset code (CT-01). USD₮0 is USD₮ for caps and display. */
  code: "USDT";
  eip712: { name: string; version: string };
  testnet: boolean;
}

/**
 * Testnet tokens only. Domains were checked against `DOMAIN_SEPARATOR()` on chain (test/eip712.test.ts).
 * Stable testnet USD₮0 settles through a self-hosted facilitator (docs/research/x402-spike.md).
 * Mainnet USD₮0 entries (Plasma, Stable) are added only once their domains are read from chain.
 */
export const TESTNET_ASSETS: readonly X402Asset[] = [
  {
    network: "eip155:2201",
    chainId: 2201,
    address: "0x78Cf24370174180738C5B8E352B6D14c83a6c9A9",
    code: "USDT",
    eip712: { name: "USD₮0", version: "1" },
    testnet: true,
  },
];

/** x402 v1 used names; v2 uses CAIP-2. Only the names Hermit might meet on testnets. */
const V1_NETWORKS: Readonly<Record<string, string>> = {
  "base-sepolia": "eip155:84532",
  base: "eip155:8453",
  "avalanche-fuji": "eip155:43113",
  polygon: "eip155:137",
  "polygon-amoy": "eip155:80002",
};
const V1_NAME_OF = Object.fromEntries(Object.entries(V1_NETWORKS).map(([k, v]) => [v, k]));

export interface HttpLikeResponse {
  status: number;
  headers: Record<string, string>;
  body: string;
}

export function header(headers: Record<string, string>, name: string): string | undefined {
  const want = name.toLowerCase();
  for (const [k, v] of Object.entries(headers)) if (k.toLowerCase() === want) return v;
  return undefined;
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown, what: string): string => {
  if (typeof v !== "string") throw new X402Error("malformed", `${what} is missing.`);
  return v;
};

function baseUnits(v: unknown): bigint {
  if (typeof v !== "string" || !/^\d+$/.test(v)) throw new X402Error("malformed", "Amount must be a whole number of base units.");
  return BigInt(v);
}

function requirement(raw: unknown, version: 1 | 2): PaymentRequirement {
  if (!isObj(raw)) throw new X402Error("malformed", "An offer is not an object.");
  const networkRaw = str(raw.network, "network");
  const network = version === 1 ? (V1_NETWORKS[networkRaw] ?? networkRaw) : networkRaw;
  const timeout = raw.maxTimeoutSeconds;
  if (typeof timeout !== "number" || !Number.isInteger(timeout) || timeout <= 0) throw new X402Error("malformed", "maxTimeoutSeconds must be a positive integer.");
  return {
    scheme: str(raw.scheme, "scheme"),
    network,
    amount: baseUnits(version === 1 ? raw.maxAmountRequired : raw.amount),
    asset: str(raw.asset, "asset"),
    payTo: str(raw.payTo, "payTo"),
    maxTimeoutSeconds: timeout,
    extra: isObj(raw.extra) ? raw.extra : {},
    raw,
  };
}

/** Reads a 402: the v2 `PAYMENT-REQUIRED` header first, then a JSON body (v1, or v2 servers that also send it). */
export function parsePaymentRequired(res: HttpLikeResponse): PaymentRequired {
  if (res.status !== 402) throw new X402Error("not_402", `Status ${res.status} is not a payment request.`);
  let doc: unknown;
  const h = header(res.headers, "payment-required");
  if (h) doc = decodeBase64Json(h);
  else {
    try {
      doc = JSON.parse(res.body);
    } catch {
      throw new X402Error("malformed", "A 402 without payment requirements.");
    }
  }
  if (!isObj(doc) || !("x402Version" in doc)) throw new X402Error("malformed", "A 402 without payment requirements.");
  const version = doc.x402Version;
  if (version !== 1 && version !== 2) throw new X402Error("version", `x402 version ${String(version)} is not supported.`);
  if (!Array.isArray(doc.accepts) || doc.accepts.length === 0) throw new X402Error("malformed", "No offers in the 402.");
  const accepts = doc.accepts.map((a) => requirement(a, version));
  let resource: PaymentRequired["resource"];
  if (version === 2) {
    if (!isObj(doc.resource)) throw new X402Error("malformed", "resource is missing.");
    resource = { url: str(doc.resource.url, "resource.url") };
    if (typeof doc.resource.description === "string") resource.description = doc.resource.description;
    if (typeof doc.resource.mimeType === "string") resource.mimeType = doc.resource.mimeType;
  } else {
    const first = doc.accepts[0] as Record<string, unknown>;
    resource = { url: str(first.resource, "resource") };
    if (typeof first.description === "string") resource.description = first.description;
    if (typeof first.mimeType === "string") resource.mimeType = first.mimeType;
  }
  const out: PaymentRequired = { x402Version: version, resource, accepts };
  if (typeof doc.error === "string") out.error = doc.error;
  return out;
}

/**
 * The longest an authorization Hermit signs may stay settleable. A merchant asking for more is
 * refused: a long-lived signed transfer is a blank cheque if the header leaks or the merchant
 * settles late. Also bounds how long a failed purchase holds the daily cap.
 */
export const MAX_TIMEOUT_SECONDS = 300;

export interface Selection {
  requirement: PaymentRequirement;
  asset: X402Asset;
  price: Money;
}

/**
 * Picks the first offer Hermit can pay: scheme `exact`, EIP-3009, a USD₮ token on the allowlist
 * whose EIP-712 domain matches what the merchant claims. Throws the most specific reason otherwise:
 * `unsupported_network` for chains Hermit cannot sign for at all (not EVM), `unsupported_asset` for
 * any EVM token that is not a listed USD₮ (USDC included, PDR-027).
 */
export function selectRequirement(pr: PaymentRequired, assets: readonly X402Asset[]): Selection {
  const order = ["unsupported_network", "unsupported_asset", "unsupported_scheme", "domain_mismatch", "timeout_too_long"] as const;
  let worst = -1;
  for (const r of pr.accepts) {
    // The `code` type already says USD₮; the runtime check keeps a hand-built list honest too.
    const asset = assets.find((a) => a.code === "USDT" && a.network === r.network && sameAddress(a.address, r.asset));
    const method = r.extra.assetTransferMethod ?? "eip3009";
    let failure: (typeof order)[number] | undefined;
    if (!r.network.startsWith("eip155:")) failure = "unsupported_network";
    else if (!asset) failure = "unsupported_asset";
    else if (r.scheme !== "exact" || method !== "eip3009") failure = "unsupported_scheme";
    else if (
      (r.extra.name !== undefined && r.extra.name !== asset.eip712.name) ||
      (r.extra.version !== undefined && r.extra.version !== asset.eip712.version)
    )
      failure = "domain_mismatch";
    else if (r.maxTimeoutSeconds > MAX_TIMEOUT_SECONDS) failure = "timeout_too_long";
    if (!failure && asset) return { requirement: r, asset, price: money(r.amount, asset.code, asset.network) };
    if (failure) worst = Math.max(worst, order.indexOf(failure));
  }
  const code = order[Math.max(worst, 0)]!;
  throw new X402Error(code, "No offer in this 402 is one Hermit can pay.");
}

export interface SpendingCap {
  perPayment: Money;
  perDay: Money;
}

export type CapCheck = { ok: true } | { ok: false; reason: "no_cap" | "over_per_payment" | "over_per_day" };

/** FR-PAY-05: deny by default, then per payment, then rolling per day. Raising a cap never retries. */
export function checkCaps(amount: Money, cap: SpendingCap | undefined, spentToday: Money): CapCheck {
  const covers = (m: Money) => m.asset === amount.asset && m.network === amount.network;
  if (!cap || !covers(cap.perPayment) || !covers(cap.perDay) || !covers(spentToday)) return { ok: false, reason: "no_cap" };
  if (compareMoney(amount, cap.perPayment) > 0) return { ok: false, reason: "over_per_payment" };
  if (compareMoney(addMoney(spentToday, amount), cap.perDay) > 0) return { ok: false, reason: "over_per_day" };
  return { ok: true };
}

/** Seconds of clock skew tolerated before "now", as the x402 reference client does. */
export const VALID_AFTER_SKEW_SECONDS = 600;

export interface PaymentDraft {
  authorization: TransferAuthorization;
  typedData: TransferWithAuthorizationTypedData;
  /** What the key signs; logged next to the approval so the audit row names the exact authorization. */
  digest: string;
  /** The retry header for a given signature. */
  header(signature: string): { name: string; value: string };
}

export function buildPayment(pr: PaymentRequired, sel: Selection, input: { from: string; nowSeconds: number; nonce: Uint8Array }): PaymentDraft {
  if (!isAddress(input.from)) throw new X402Error("bad_input", "The payer is not an EVM address.");
  if (input.nonce.length !== 32) throw new X402Error("bad_input", "The EIP-3009 nonce is 32 bytes.");
  if (!isAddress(sel.requirement.payTo)) throw new X402Error("malformed", "payTo is not an EVM address.");
  if (sel.requirement.maxTimeoutSeconds > MAX_TIMEOUT_SECONDS) throw new X402Error("timeout_too_long", "The authorization would outlive the maximum.");
  const now = Math.floor(input.nowSeconds);
  const authorization: TransferAuthorization = {
    from: input.from,
    to: sel.requirement.payTo,
    value: sel.requirement.amount.toString(),
    validAfter: String(Math.max(0, now - VALID_AFTER_SKEW_SECONDS)),
    validBefore: String(now + sel.requirement.maxTimeoutSeconds),
    nonce: "0x" + bytesToHex(input.nonce),
  };
  const typedData: TransferWithAuthorizationTypedData = {
    domain: { name: sel.asset.eip712.name, version: sel.asset.eip712.version, chainId: sel.asset.chainId, verifyingContract: sel.asset.address },
    primaryType: "TransferWithAuthorization",
    message: authorization,
  };
  return {
    authorization,
    typedData,
    digest: transferWithAuthorizationDigest(typedData),
    header(signature) {
      if (!/^0x[0-9a-fA-F]{130}$/.test(signature)) throw new X402Error("bad_input", "A signature is 65 bytes of hex.");
      const payload = { signature, authorization };
      if (pr.x402Version === 1) {
        const network = V1_NAME_OF[sel.requirement.network] ?? sel.requirement.network;
        return { name: "X-PAYMENT", value: encodeBase64Json({ x402Version: 1, scheme: "exact", network, payload }) };
      }
      return { name: "PAYMENT-SIGNATURE", value: encodeBase64Json({ x402Version: 2, resource: pr.resource, accepted: sel.requirement.raw, payload }) };
    },
  };
}

export interface Settlement {
  success: boolean;
  transaction?: string;
  network?: string;
  payer?: string;
  errorReason?: string;
}

/** Reads `PAYMENT-RESPONSE` (v2) or `X-PAYMENT-RESPONSE` (v1). Undefined when the merchant sent none. */
export function parseSettlement(headers: Record<string, string>): Settlement | undefined {
  const h = header(headers, "payment-response") ?? header(headers, "x-payment-response");
  if (!h) return undefined;
  const doc = decodeBase64Json(h);
  if (!isObj(doc) || typeof doc.success !== "boolean") throw new X402Error("malformed", "The payment receipt is not a settlement response.");
  const out: Settlement = { success: doc.success };
  for (const k of ["transaction", "network", "payer", "errorReason"] as const) if (typeof doc[k] === "string") out[k] = doc[k];
  return out;
}
