import { describe, expect, test } from "vitest";
import { money } from "@hermit/core";
import {
  buildPayment,
  checkCaps,
  decodeBase64Json,
  encodeBase64Json,
  parsePaymentRequired,
  parseSettlement,
  selectRequirement,
  MAX_TIMEOUT_SECONDS,
  TESTNET_ASSETS,
  X402Error,
} from "../src/index.ts";
import {
  b64json,
  DEMO_PAYMENT_REQUIRED_V1,
  DEMO_PAYMENT_REQUIRED_V2,
  MERCHANT,
  USDT0_NET,
  USDT0_PAYMENT_REQUIRED_V1,
  USDT0_PAYMENT_REQUIRED_V2,
  USDT0_TOKEN,
} from "./fixtures.ts";

const v2Response = (doc: unknown = USDT0_PAYMENT_REQUIRED_V2, body = '{"error":"Payment required"}') => ({
  status: 402,
  headers: { "payment-required": b64json(doc) },
  body,
});

describe("base64 JSON (the x402 header encoding)", () => {
  test("round trips, including non-ASCII text", () => {
    const value = { a: "USD₮0", n: 1, nested: { ok: true } };
    expect(decodeBase64Json(encodeBase64Json(value))).toEqual(value);
    expect(encodeBase64Json(value)).toBe(b64json(value));
  });

  test("rejects text that is not base64 JSON", () => {
    expect(() => decodeBase64Json("%%%")).toThrow(X402Error);
  });
});

describe("parsePaymentRequired (FR-PAY-04)", () => {
  test("reads the v2 PAYMENT-REQUIRED header the public testnet demo sends", () => {
    const pr = parsePaymentRequired(v2Response(DEMO_PAYMENT_REQUIRED_V2));
    expect(pr.x402Version).toBe(2);
    expect(pr.resource.url).toBe("https://x402.vercel.app/protected");
    expect(pr.accepts).toHaveLength(2);
    expect(pr.accepts[0]).toMatchObject({ scheme: "exact", network: "eip155:84532", amount: 10000n, maxTimeoutSeconds: 300 });
  });

  test("reads a USD₮0 offer, keeping the token's non-ASCII name intact", () => {
    const pr = parsePaymentRequired(v2Response());
    expect(pr.accepts[0]).toMatchObject({ network: USDT0_NET, asset: USDT0_TOKEN, amount: 10000n, extra: { name: "USD₮0", version: "1" } });
  });

  test("header names are case-insensitive", () => {
    const pr = parsePaymentRequired({ status: 402, headers: { "Payment-Required": b64json(USDT0_PAYMENT_REQUIRED_V2) }, body: "" });
    expect(pr.accepts).toHaveLength(1);
  });

  test("reads a v1 JSON body and maps legacy network names to CAIP-2", () => {
    const pr = parsePaymentRequired({ status: 402, headers: {}, body: JSON.stringify(DEMO_PAYMENT_REQUIRED_V1) });
    expect(pr.x402Version).toBe(1);
    expect(pr.resource.url).toBe("https://x402.vercel.app/protected");
    expect(pr.accepts[0]).toMatchObject({ network: "eip155:84532", amount: 10000n });
  });

  test("a response that is not 402 is not a payment request", () => {
    expect(() => parsePaymentRequired({ status: 200, headers: {}, body: "" })).toThrow(/not_402/);
  });

  test("a 402 without requirements is refused", () => {
    expect(() => parsePaymentRequired({ status: 402, headers: {}, body: "pay me" })).toThrow(/malformed/);
  });

  test("unknown protocol versions are refused", () => {
    const bad = { ...USDT0_PAYMENT_REQUIRED_V2, x402Version: 3 };
    expect(() => parsePaymentRequired({ status: 402, headers: { "payment-required": b64json(bad) }, body: "" })).toThrow(/version/);
  });

  test.each([
    ["a decimal amount", "10.5"],
    ["a negative amount", "-1"],
    ["an empty amount", ""],
    ["a hex amount", "0x10"],
  ])("refuses %s", (_label, amount) => {
    const bad = { ...USDT0_PAYMENT_REQUIRED_V2, accepts: [{ ...USDT0_PAYMENT_REQUIRED_V2.accepts[0], amount }] };
    expect(() => parsePaymentRequired({ status: 402, headers: { "payment-required": b64json(bad) }, body: "" })).toThrow(/malformed/);
  });
});

describe("selectRequirement (USD₮ only, PDR-027; the list ships with the app)", () => {
  test("picks the USD₮0 offer on Stable testnet and prices it in USD₮", () => {
    const sel = selectRequirement(parsePaymentRequired(v2Response()), TESTNET_ASSETS);
    expect(sel.asset.code).toBe("USDT");
    expect(sel.asset.chainId).toBe(2201);
    expect(sel.price).toEqual(money(10000n, "USDT", USDT0_NET));
  });

  test("every payable asset is USD₮", () => {
    expect(TESTNET_ASSETS.length).toBeGreaterThan(0);
    for (const a of TESTNET_ASSETS) expect(a.code).toBe("USDT");
  });

  test("the real x402.org 402 (Base Sepolia USDC and Solana devnet) is refused as an unsupported asset", () => {
    const pr = parsePaymentRequired(v2Response(DEMO_PAYMENT_REQUIRED_V2));
    expect(() => selectRequirement(pr, TESTNET_ASSETS)).toThrow(/unsupported_asset/);
    const v1 = parsePaymentRequired({ status: 402, headers: {}, body: JSON.stringify(DEMO_PAYMENT_REQUIRED_V1) });
    expect(() => selectRequirement(v1, TESTNET_ASSETS)).toThrow(/unsupported_asset/);
  });

  test("USDC is refused even when it is the only offer", () => {
    const pr = parsePaymentRequired(v2Response(DEMO_PAYMENT_REQUIRED_V2));
    const usdcOnly = { ...pr, accepts: pr.accepts.slice(0, 1) };
    expect(() => selectRequirement(usdcOnly, TESTNET_ASSETS)).toThrow(/unsupported_asset/);
  });

  test("a USD₮0 offer next to a USDC one is the one picked, whatever the order", () => {
    const demo = parsePaymentRequired(v2Response(DEMO_PAYMENT_REQUIRED_V2));
    const usdt = parsePaymentRequired(v2Response());
    const mixed = { ...usdt, accepts: [demo.accepts[0]!, usdt.accepts[0]!] };
    expect(selectRequirement(mixed, TESTNET_ASSETS).asset.code).toBe("USDT");
  });

  test("refuses with a reason when no offer is on an EVM network", () => {
    const pr = parsePaymentRequired(v2Response(DEMO_PAYMENT_REQUIRED_V2));
    const solanaOnly = { ...pr, accepts: pr.accepts.slice(1) };
    expect(() => selectRequirement(solanaOnly, TESTNET_ASSETS)).toThrow(/unsupported_network/);
  });

  test("refuses an unknown token on the USD₮0 network", () => {
    const pr = parsePaymentRequired(v2Response());
    const other = { ...pr, accepts: [{ ...pr.accepts[0]!, asset: "0x0000000000000000000000000000000000000001" }] };
    expect(() => selectRequirement(other, TESTNET_ASSETS)).toThrow(/unsupported_asset/);
  });

  test("refuses the USD₮0 address claimed on another EVM chain", () => {
    const pr = parsePaymentRequired(v2Response());
    const elsewhere = { ...pr, accepts: [{ ...pr.accepts[0]!, network: "eip155:84532" }] };
    expect(() => selectRequirement(elsewhere, TESTNET_ASSETS)).toThrow(/unsupported_asset/);
  });

  test("refuses schemes other than exact and transfer methods other than EIP-3009", () => {
    const pr = parsePaymentRequired(v2Response());
    const upto = { ...pr, accepts: [{ ...pr.accepts[0]!, scheme: "upto" }] };
    expect(() => selectRequirement(upto, TESTNET_ASSETS)).toThrow(/unsupported_scheme/);
    const permit2 = { ...pr, accepts: [{ ...pr.accepts[0]!, extra: { name: "USD₮0", version: "1", assetTransferMethod: "permit2" } }] };
    expect(() => selectRequirement(permit2, TESTNET_ASSETS)).toThrow(/unsupported_scheme/);
  });

  test("refuses a merchant whose EIP-712 domain disagrees with the pinned token", () => {
    const pr = parsePaymentRequired(v2Response());
    for (const extra of [{ name: "USDT0", version: "1" }, { name: "USDC", version: "2" }, { name: "USD₮0", version: "2" }]) {
      const spoof = { ...pr, accepts: [{ ...pr.accepts[0]!, extra }] };
      expect(() => selectRequirement(spoof, TESTNET_ASSETS)).toThrow(/domain_mismatch/);
    }
  });

  test("refuses an offer whose authorization would live longer than the fixed maximum", () => {
    expect(MAX_TIMEOUT_SECONDS).toBe(300);
    const pr = parsePaymentRequired(v2Response());
    const longLived = { ...pr, accepts: [{ ...pr.accepts[0]!, maxTimeoutSeconds: 86_400 }] };
    expect(() => selectRequirement(longLived, TESTNET_ASSETS)).toThrow(/timeout_too_long/);
    const justAtMax = { ...pr, accepts: [{ ...pr.accepts[0]!, maxTimeoutSeconds: MAX_TIMEOUT_SECONDS }] };
    expect(selectRequirement(justAtMax, TESTNET_ASSETS).requirement.maxTimeoutSeconds).toBe(MAX_TIMEOUT_SECONDS);
  });

  test("an empty allowlist supports nothing", () => {
    expect(() => selectRequirement(parsePaymentRequired(v2Response()), [])).toThrow(X402Error);
  });
});

describe("checkCaps (FR-PAY-05, PDR-011)", () => {
  const net = USDT0_NET;
  const cap = { perPayment: money(50_000n, "USDT", net), perDay: money(100_000n, "USDT", net) };

  test("allows a payment within both caps", () => {
    expect(checkCaps(money(10_000n, "USDT", net), cap, money(0n, "USDT", net))).toEqual({ ok: true });
  });

  test("allows exactly the per-payment cap", () => {
    expect(checkCaps(money(50_000n, "USDT", net), cap, money(0n, "USDT", net))).toEqual({ ok: true });
  });

  test("denies over the per-payment cap", () => {
    expect(checkCaps(money(50_001n, "USDT", net), cap, money(0n, "USDT", net))).toEqual({ ok: false, reason: "over_per_payment" });
  });

  test("denies when today's total would pass the per-day cap", () => {
    expect(checkCaps(money(10_000n, "USDT", net), cap, money(95_000n, "USDT", net))).toEqual({ ok: false, reason: "over_per_day" });
  });

  test("denies by default when there is no cap for the asset", () => {
    expect(checkCaps(money(1n, "USDT", net), undefined, money(0n, "USDT", net))).toEqual({ ok: false, reason: "no_cap" });
  });

  test("a cap in another asset or network does not cover the payment", () => {
    expect(checkCaps(money(1n, "USDC", net), cap, money(0n, "USDC", net))).toEqual({ ok: false, reason: "no_cap" });
    expect(checkCaps(money(1n, "USDT", "eip155:9745"), cap, money(0n, "USDT", "eip155:9745"))).toEqual({ ok: false, reason: "no_cap" });
  });
});

describe("buildPayment", () => {
  const pr = parsePaymentRequired(v2Response());
  const sel = selectRequirement(pr, TESTNET_ASSETS);
  const from = "0x857b06519E91e3A54538791bDbb0E22373e36b66";
  const nonce = new Uint8Array(32).fill(0xab);
  const draft = buildPayment(pr, sel, { from, nowSeconds: 1_800_000_000, nonce });

  test("authorizes exactly the asked amount to the merchant inside the timeout window", () => {
    expect(draft.authorization).toEqual({
      from,
      to: MERCHANT,
      value: "10000",
      validAfter: String(1_800_000_000 - 600),
      validBefore: String(1_800_000_000 + 300),
      nonce: "0x" + "ab".repeat(32),
    });
  });

  test("the typed data is EIP-3009 TransferWithAuthorization on the pinned USD₮0 token", () => {
    expect(draft.typedData.primaryType).toBe("TransferWithAuthorization");
    expect(draft.typedData.domain).toEqual({ name: "USD₮0", version: "1", chainId: 2201, verifyingContract: USDT0_TOKEN });
    expect(draft.typedData.message).toEqual(draft.authorization);
    expect(draft.digest).toMatch(/^0x[0-9a-f]{64}$/);
  });

  test("v2: the header is PAYMENT-SIGNATURE with the accepted offer echoed", () => {
    const header = draft.header("0x" + "11".repeat(65));
    expect(header.name).toBe("PAYMENT-SIGNATURE");
    const decoded = decodeBase64Json(header.value) as Record<string, unknown>;
    expect(decoded).toMatchObject({
      x402Version: 2,
      resource: { url: "https://merchant.example/protected" },
      accepted: { scheme: "exact", network: USDT0_NET, amount: "10000", asset: USDT0_TOKEN, payTo: MERCHANT },
      payload: { signature: "0x" + "11".repeat(65), authorization: draft.authorization },
    });
  });

  test("v1: the header is X-PAYMENT", () => {
    const pr1 = parsePaymentRequired({ status: 402, headers: {}, body: JSON.stringify(USDT0_PAYMENT_REQUIRED_V1) });
    const d1 = buildPayment(pr1, selectRequirement(pr1, TESTNET_ASSETS), { from, nowSeconds: 1_800_000_000, nonce });
    const header = d1.header("0x" + "22".repeat(65));
    expect(header.name).toBe("X-PAYMENT");
    expect(decodeBase64Json(header.value)).toMatchObject({ x402Version: 1, scheme: "exact", network: USDT0_NET });
  });

  test("refuses a nonce that is not 32 bytes and a malformed payer address", () => {
    expect(() => buildPayment(pr, sel, { from, nowSeconds: 1, nonce: new Uint8Array(31) })).toThrow(X402Error);
    expect(() => buildPayment(pr, sel, { from: "0x123", nowSeconds: 1, nonce })).toThrow(X402Error);
  });

  test("refuses a signature that is not 65 bytes of hex", () => {
    expect(() => draft.header("0x1234")).toThrow(X402Error);
  });
});

describe("parseSettlement", () => {
  test("reads a PAYMENT-RESPONSE header", () => {
    const s = parseSettlement({ "payment-response": b64json({ success: true, transaction: "0xabc", network: USDT0_NET, payer: "0x1" }) });
    expect(s).toEqual({ success: true, transaction: "0xabc", network: USDT0_NET, payer: "0x1" });
  });

  test("reads the v1 X-PAYMENT-RESPONSE header", () => {
    const s = parseSettlement({ "x-payment-response": b64json({ success: true, transaction: "0xdef", network: USDT0_NET }) });
    expect(s).toMatchObject({ success: true, transaction: "0xdef" });
  });

  test("no header means no settlement receipt", () => {
    expect(parseSettlement({})).toBeUndefined();
  });
});
