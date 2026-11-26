import { describe, expect, test } from "vitest";
import { money } from "@hermit/core";
import { decodeBase64Json, localKeySigner, memoryLedger, payWithX402, recoverTypedDataSigner, resolvePending, TESTNET_ASSETS, VOID_MARGIN_SECONDS } from "../src/index.ts";
import type { HttpRequest, HttpResponse, PaymentQuote, X402Ports } from "../src/index.ts";
import { b64json, DEMO_PAYMENT_REQUIRED_V2, MERCHANT, USDT0_PAYMENT_REQUIRED_V2 } from "./fixtures.ts";

const NET = "eip155:2201";
const caps = { perPayment: money(50_000n, "USDT", NET), perDay: money(100_000n, "USDT", NET) };
const tight = { perPayment: money(50_000n, "USDT", NET), perDay: money(15_000n, "USDT", NET) };
const URL_ = "https://merchant.example/protected";
const get = { url: URL_, method: "GET", headers: {} };

function harness(responses: HttpResponse[], approve = true, nonceByte = 9) {
  const sent: HttpRequest[] = [];
  const quotes: PaymentQuote[] = [];
  const signer = localKeySigner(new Uint8Array(32).fill(3));
  const ports: X402Ports = {
    http: async (req) => {
      sent.push(req);
      const next = responses.shift();
      if (!next) throw new Error("no more responses");
      return next;
    },
    signer,
    approve: async (q) => {
      quotes.push(q);
      return approve;
    },
    nowMs: () => 1_800_000_000_000,
    randomBytes: (n) => new Uint8Array(n).fill(nonceByte),
  };
  return { ports, sent, quotes, signer };
}

const paywall: HttpResponse = { status: 402, headers: { "payment-required": b64json(USDT0_PAYMENT_REQUIRED_V2) }, body: "{}" };
const paid: HttpResponse = {
  status: 200,
  headers: { "payment-response": b64json({ success: true, transaction: "0x" + "cd".repeat(32), network: NET, payer: "0x1" }) },
  body: "secret content",
};

describe("payWithX402 (US-PAY-07)", () => {
  test("a resource that is free is returned without asking", async () => {
    const h = harness([{ status: 200, headers: {}, body: "free" }]);
    const ledger = memoryLedger();
    const out = await payWithX402(get, h.ports, { assets: TESTNET_ASSETS, cap: caps, ledger });
    expect(out.kind).toBe("free");
    expect(h.quotes).toHaveLength(0);
    expect(ledger.records()).toHaveLength(0);
  });

  test("402, approve with origin, amount, network and expiry, sign, retry with the header, read the receipt", async () => {
    const h = harness([paywall, paid]);
    const ledger = memoryLedger();
    const out = await payWithX402({ url: URL_, method: "GET", headers: { accept: "text/plain" } }, h.ports, { assets: TESTNET_ASSETS, cap: caps, ledger });
    expect(out.kind).toBe("paid");
    if (out.kind !== "paid") return;
    expect(out.settlement?.transaction).toBe("0x" + "cd".repeat(32));
    expect(out.response.body).toBe("secret content");
    expect(h.quotes).toEqual([
      {
        origin: "https://merchant.example",
        url: URL_,
        amount: money(10_000n, "USDT", NET),
        payTo: MERCHANT,
        description: "Access to protected content",
        testnet: true,
        validBefore: 1_800_000_300,
        digest: out.digest,
      },
    ]);
    expect(out.record).toMatchObject({ status: "settled", amount: money(10_000n, "USDT", NET), validBefore: 1_800_000_300, payer: h.signer.address });
    expect(ledger.records()).toMatchObject([{ status: "settled", nonce: out.record.nonce }]);
    expect(h.sent).toHaveLength(2);
    const retry = h.sent[1]!;
    expect(retry.headers.accept).toBe("text/plain");
    const payload = decodeBase64Json(retry.headers["PAYMENT-SIGNATURE"]!) as { payload: { signature: string; authorization: Record<string, string> } };
    expect(payload.payload.authorization.from).toBe(h.signer.address);
    const typedData = {
      domain: { name: "USD₮0", version: "1", chainId: 2201, verifyingContract: "0x78Cf24370174180738C5B8E352B6D14c83a6c9A9" },
      primaryType: "TransferWithAuthorization" as const,
      message: payload.payload.authorization as never,
    };
    expect(recoverTypedDataSigner(typedData, payload.payload.signature)).toBe(h.signer.address);
  });

  test("declined approval never signs, never retries, and releases the reservation", async () => {
    const h = harness([paywall], false);
    const ledger = memoryLedger();
    const out = await payWithX402(get, h.ports, { assets: TESTNET_ASSETS, cap: caps, ledger });
    expect(out.kind).toBe("declined");
    expect(h.sent).toHaveLength(1);
    expect(ledger.records()).toMatchObject([{ status: "void" }]);
  });

  test("over the cap is denied before asking and reserves nothing", async () => {
    const h = harness([paywall]);
    const ledger = memoryLedger();
    const small = { perPayment: money(9_999n, "USDT", NET), perDay: money(100_000n, "USDT", NET) };
    const out = await payWithX402(get, h.ports, { assets: TESTNET_ASSETS, cap: small, ledger });
    expect(out).toEqual({ kind: "denied", reason: "over_per_payment" });
    expect(h.quotes).toHaveLength(0);
    expect(h.sent).toHaveLength(1);
    expect(ledger.records()).toHaveLength(0);
  });

  test("an unsupported offer is refused with a reason", async () => {
    const h = harness([paywall]);
    const out = await payWithX402(get, h.ports, { assets: [], cap: caps, ledger: memoryLedger() });
    expect(out).toMatchObject({ kind: "refused", reason: "unsupported_asset" });
    expect(h.quotes).toHaveLength(0);
  });

  test("a merchant asking for USDC (the real x402.org 402) is refused before asking, reserving or signing", async () => {
    const usdcPaywall: HttpResponse = { status: 402, headers: { "payment-required": b64json(DEMO_PAYMENT_REQUIRED_V2) }, body: "{}" };
    const h = harness([usdcPaywall]);
    const ledger = memoryLedger();
    let signed = false;
    h.ports.signer = { address: h.signer.address, signTypedData: async () => ((signed = true), "0x") };
    const out = await payWithX402(get, h.ports, { assets: TESTNET_ASSETS, cap: caps, ledger });
    expect(out).toMatchObject({ kind: "refused", reason: "unsupported_asset" });
    expect(h.quotes).toHaveLength(0);
    expect(h.sent).toHaveLength(1);
    expect(ledger.records()).toHaveLength(0);
    expect(signed).toBe(false);
  });

  test("a second 402 after signing is unconfirmed, carries the merchant's reason, and never pays again", async () => {
    const rejected = { ...USDT0_PAYMENT_REQUIRED_V2, error: "insufficient_funds" };
    const h = harness([paywall, { status: 402, headers: { "payment-required": b64json(rejected) }, body: "{}" }]);
    const out = await payWithX402(get, h.ports, { assets: TESTNET_ASSETS, cap: caps, ledger: memoryLedger() });
    expect(out).toMatchObject({ kind: "authorized_unconfirmed", reason: "insufficient_funds" });
    expect(h.sent).toHaveLength(2);
  });

  test("a 500 after signing is a pending spend that counts against the daily cap until it is proven dead", async () => {
    const ledger = memoryLedger();
    const h = harness([paywall, { status: 500, headers: {}, body: "oops" }]);
    const out = await payWithX402(get, h.ports, { assets: TESTNET_ASSETS, cap: tight, ledger });
    expect(out.kind).toBe("authorized_unconfirmed");
    if (out.kind !== "authorized_unconfirmed") return;
    expect(out.record).toMatchObject({ status: "pending", amount: money(10_000n, "USDT", NET), validBefore: 1_800_000_300, nonce: "0x" + "09".repeat(32) });
    expect(ledger.records()).toMatchObject([{ status: "pending", nonce: out.record.nonce }]);

    // Room for one more 0.01 USD₮ today without it, but the pending one takes that room.
    const again = harness([paywall], true, 10);
    expect(await payWithX402(get, again.ports, { assets: TESTNET_ASSETS, cap: tight, ledger })).toEqual({ kind: "denied", reason: "over_per_day" });

    // After validBefore plus the margin, by chain time, the nonce was never used: the cap is free.
    const freed = resolvePending(out.record, false, out.record.validBefore + VOID_MARGIN_SECONDS);
    expect(freed.status).toBe("void");
    await ledger.update(out.record.nonce, freed.status as "void");
    const third = harness([paywall, paid], true, 11);
    expect((await payWithX402(get, third.ports, { assets: TESTNET_ASSETS, cap: tight, ledger })).kind).toBe("paid");
  });

  test("a settlement header that does not parse still leaves the signed spend pending", async () => {
    const ledger = memoryLedger();
    const h = harness([paywall, { status: 200, headers: { "payment-response": "%%% not base64" }, body: "content" }]);
    const out = await payWithX402(get, h.ports, { assets: TESTNET_ASSETS, cap: caps, ledger });
    expect(out).toMatchObject({ kind: "authorized_unconfirmed", reason: "malformed_settlement", record: { status: "pending" } });
    expect(ledger.records()).toMatchObject([{ status: "pending" }]);
  });

  test("a receipt that says the settlement failed is unconfirmed, not paid", async () => {
    const ledger = memoryLedger();
    const failedReceipt = { status: 200, headers: { "payment-response": b64json({ success: false, errorReason: "settlement_pending", transaction: "0xab" }) }, body: "" };
    const out = await payWithX402(get, harness([paywall, failedReceipt]).ports, { assets: TESTNET_ASSETS, cap: caps, ledger });
    expect(out).toMatchObject({ kind: "authorized_unconfirmed", reason: "settlement_pending" });
    expect(ledger.records()).toMatchObject([{ status: "pending" }]);
  });

  test("a dropped connection after sending the header is unconfirmed and pending", async () => {
    const ledger = memoryLedger();
    const out = await payWithX402(get, harness([paywall]).ports, { assets: TESTNET_ASSETS, cap: caps, ledger });
    expect(out).toMatchObject({ kind: "authorized_unconfirmed", reason: "network_error" });
    expect(ledger.records()).toMatchObject([{ status: "pending" }]);
  });

  test("two payments racing through approval cannot both pass the same cap", async () => {
    const ledger = memoryLedger();
    let open!: () => void;
    const gate = new Promise<void>((r) => (open = r));
    const a = harness([paywall, paid], true, 1);
    const b = harness([paywall, paid], true, 2);
    for (const h of [a, b]) h.ports.approve = async () => (await gate, true);
    const both = Promise.all([payWithX402(get, a.ports, { assets: TESTNET_ASSETS, cap: tight, ledger }), payWithX402(get, b.ports, { assets: TESTNET_ASSETS, cap: tight, ledger })]);
    await new Promise((r) => setTimeout(r, 0));
    open();
    const kinds = (await both).map((o) => o.kind).sort();
    expect(kinds).toEqual(["denied", "paid"]);
    expect(ledger.records().filter((r) => r.status !== "void")).toHaveLength(1);
  });

  test("an approval that comes back after the authorization would have expired signs nothing and releases", async () => {
    const h = harness([paywall]);
    const ledger = memoryLedger();
    let t = 1_800_000_000_000;
    h.ports.nowMs = () => t;
    h.ports.approve = async () => {
      t += 301_000;
      return true;
    };
    const out = await payWithX402(get, h.ports, { assets: TESTNET_ASSETS, cap: caps, ledger });
    expect(out).toMatchObject({ kind: "refused", reason: "approval_expired" });
    expect(h.sent).toHaveLength(1);
    expect(ledger.records()).toMatchObject([{ status: "void" }]);
  });

  test("a signer that throws releases the reservation", async () => {
    const h = harness([paywall]);
    const ledger = memoryLedger();
    h.ports.signer = { address: h.signer.address, signTypedData: async () => Promise.reject(new Error("worklet gone")) };
    await expect(payWithX402(get, h.ports, { assets: TESTNET_ASSETS, cap: caps, ledger })).rejects.toThrow("worklet gone");
    expect(ledger.records()).toMatchObject([{ status: "void" }]);
  });
});
