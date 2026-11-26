import { describe, expect, test } from "vitest";
import { keccak_256 } from "@noble/hashes/sha3.js";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils.js";
import { money } from "@hermit/core";
import {
  createLineSplitter, createWalletClient, localKeySigner, MAX_TIMEOUT_SECONDS, planTransfer, quoteTransferFee, recoverTypedDataSigner,
  sendTransferWithAuthorization, TESTNET_ASSETS, transferReceipt, TRANSFER_WITH_AUTHORIZATION_SELECTOR, transferWithAuthorizationCalldata,
  VALID_AFTER_SKEW_SECONDS, WALLET_METHODS, WalletIpcError,
} from "../src/index.ts";
import { USDT0_NET, USDT0_TOKEN } from "./fixtures.ts";

// SL-40 (US-PAY-05): a payment to a person is an EIP-3009 TransferWithAuthorization for USD₮0 on Stable testnet, signed
// in the wallet worklet and submitted by the wallet itself (gas is USD₮0 on Stable). It is bounded by validBefore, so a
// signature that never confirms stops being spendable within MAX_TIMEOUT_SECONDS.

const signer = localKeySigner(new Uint8Array(32).fill(7));
const RECIPIENT = "0x209693Bc6afc0C5328bA36FaF03C514EF312287C";
const asset = TESTNET_ASSETS[0]!;
const nonce = new Uint8Array(32).fill(9);
const usdt = (n: bigint) => money(n, "USDT", USDT0_NET);

describe("planning a transfer", () => {
  test("the authorization pays exactly the amount to the recipient, for at most MAX_TIMEOUT_SECONDS", () => {
    const p = planTransfer({ from: signer.address, to: RECIPIENT, amount: usdt(20_000_000n), asset, nowMs: 1_000_000_000, nonce });
    expect(p.typedData.domain).toEqual({ name: "USD₮0", version: "1", chainId: 2201, verifyingContract: USDT0_TOKEN });
    expect(p.typedData.message).toEqual({
      from: signer.address, to: RECIPIENT, value: "20000000",
      validAfter: String(1_000_000 - VALID_AFTER_SKEW_SECONDS), validBefore: String(1_000_000 + MAX_TIMEOUT_SECONDS), nonce: "0x" + "09".repeat(32),
    });
    expect(p.record).toEqual({
      amount: usdt(20_000_000n), payer: signer.address, token: USDT0_TOKEN, nonce: "0x" + "09".repeat(32), validBefore: 1_000_000 + MAX_TIMEOUT_SECONDS,
      atMs: 1_000_000_000, status: "pending", recipient: RECIPIENT,
    });
  });

  test("another asset, another network, zero, paying yourself or a bad address are refused", () => {
    const base = { from: signer.address, to: RECIPIENT, amount: usdt(1n), asset, nowMs: 1, nonce };
    expect(() => planTransfer({ ...base, amount: money(1n, "USDC", USDT0_NET) })).toThrow(/USD₮/);
    expect(() => planTransfer({ ...base, amount: money(1n, "USDT", "eip155:1") })).toThrow(/network/);
    expect(() => planTransfer({ ...base, amount: usdt(0n) })).toThrow();
    expect(() => planTransfer({ ...base, to: signer.address.toLowerCase() })).toThrow(/yourself/);
    expect(() => planTransfer({ ...base, to: "0x1234" })).toThrow();
    expect(() => planTransfer({ ...base, nonce: new Uint8Array(31) })).toThrow();
    expect(() => planTransfer({ ...base, asset: { ...asset, code: "USDC" as "USDT" } })).toThrow(/USD₮/);
  });
});

describe("the transferWithAuthorization call", () => {
  test("the selector is the EIP-3009 function's", () => {
    const sig = "transferWithAuthorization(address,address,uint256,uint256,uint256,bytes32,uint8,bytes32,bytes32)";
    expect(TRANSFER_WITH_AUTHORIZATION_SELECTOR).toBe("0x" + bytesToHex(keccak_256(utf8ToBytes(sig)).slice(0, 4)));
    expect(TRANSFER_WITH_AUTHORIZATION_SELECTOR).toBe("0xe3ee160e");
  });

  test("the calldata is the selector and nine 32-byte words, v r s from the signature", async () => {
    const p = planTransfer({ from: signer.address, to: RECIPIENT, amount: usdt(5n), asset, nowMs: 1_000_000_000, nonce });
    const signature = await signer.signTypedData(p.typedData);
    expect(recoverTypedDataSigner(p.typedData, signature)).toBe(signer.address);
    const data = transferWithAuthorizationCalldata(p.typedData.message, signature);
    expect(data.slice(0, 10)).toBe("0xe3ee160e");
    expect(data.length).toBe(10 + 9 * 64);
    const words = data.slice(10).match(/.{64}/g)!;
    expect(words[0]).toBe(signer.address.slice(2).toLowerCase().padStart(64, "0"));
    expect(words[1]).toBe(RECIPIENT.slice(2).toLowerCase().padStart(64, "0"));
    expect(BigInt("0x" + words[2])).toBe(5n);
    expect(words[5]).toBe("09".repeat(32));
    expect(BigInt("0x" + words[6])).toBe(BigInt(parseInt(signature.slice(130), 16)));
    expect(words[7]).toBe(signature.slice(2, 66));
    expect(words[8]).toBe(signature.slice(66, 130));
  });

  test("a malformed signature is never encoded", () => {
    const p = planTransfer({ from: signer.address, to: RECIPIENT, amount: usdt(5n), asset, nowMs: 1, nonce });
    expect(() => transferWithAuthorizationCalldata(p.typedData.message, "0x1234")).toThrow();
    expect(() => transferWithAuthorizationCalldata(p.typedData.message, "0x" + "11".repeat(64) + "05")).toThrow();
  });
});

const enc = new TextEncoder();
function fakeWorklet(answer: (req: { method: string; params?: Record<string, unknown> }) => unknown) {
  const sent: Array<{ method: string; params?: Record<string, unknown> }> = [];
  const split = createLineSplitter();
  const client = createWalletClient({
    write(bytes) {
      for (const line of split(bytes)) {
        const req = JSON.parse(line);
        sent.push(req);
        queueMicrotask(() => {
          const r = answer(req);
          client.receive(enc.encode(JSON.stringify(r instanceof Error ? { id: req.id, ok: false, error: { code: r.message } } : { id: req.id, ok: true, result: r }) + "\n"));
        });
      }
    },
  });
  return { client, sent };
}

describe("the worklet's payment methods (SL-40)", () => {
  test("three more fixed methods: quote, send and receipt", () => {
    for (const m of ["quoteTransfer", "sendTransferWithAuthorization", "transferReceipt"]) expect(WALLET_METHODS).toContain(m);
    expect(WALLET_METHODS).toHaveLength(11);
  });

  test("the fee quote is wei for a public address, no key", async () => {
    const w = fakeWorklet(() => ({ fee: "21000000000000" }));
    expect(await quoteTransferFee(w.client, { from: signer.address, to: RECIPIENT, value: 5n })).toBe(21_000_000_000_000n);
    expect(w.sent[0]).toMatchObject({ method: "quoteTransfer", params: { from: signer.address, to: RECIPIENT, value: "5" } });
  });

  test("a fee that isn't a whole decimal is refused", async () => {
    const w = fakeWorklet(() => ({ fee: "1.5" }));
    await expect(quoteTransferFee(w.client, { from: signer.address, to: RECIPIENT, value: 5n })).rejects.toBeInstanceOf(WalletIpcError);
  });

  test("send hands over the domain, the message and the signature, and gets back only a transaction hash", async () => {
    const p = planTransfer({ from: signer.address, to: RECIPIENT, amount: usdt(5n), asset, nowMs: 1, nonce });
    const signature = await signer.signTypedData(p.typedData);
    const hash = "0x" + "ab".repeat(32);
    const w = fakeWorklet(() => ({ hash }));
    expect(await sendTransferWithAuthorization(w.client, { typedData: p.typedData, signature })).toBe(hash);
    expect(w.sent[0]).toEqual({ id: 1, method: "sendTransferWithAuthorization", params: { domain: p.typedData.domain, message: p.typedData.message, signature } });
  });

  test("a signature that isn't the payer's is never sent", async () => {
    const p = planTransfer({ from: signer.address, to: RECIPIENT, amount: usdt(5n), asset, nowMs: 1, nonce });
    const other = await localKeySigner(new Uint8Array(32).fill(8)).signTypedData({ ...p.typedData, message: { ...p.typedData.message } });
    const w = fakeWorklet(() => ({ hash: "0x" + "ab".repeat(32) }));
    await expect(sendTransferWithAuthorization(w.client, { typedData: p.typedData, signature: other })).rejects.toThrow(/payer/);
    expect(w.sent).toEqual([]);
  });

  test("a send answer that isn't a transaction hash is refused", async () => {
    const p = planTransfer({ from: signer.address, to: RECIPIENT, amount: usdt(5n), asset, nowMs: 1, nonce });
    const signature = await signer.signTypedData(p.typedData);
    const w = fakeWorklet(() => ({ hash: "nope" }));
    await expect(sendTransferWithAuthorization(w.client, { typedData: p.typedData, signature })).rejects.toBeInstanceOf(WalletIpcError);
  });

  test("the receipt is success, reverted or pending, and nothing else", async () => {
    const hash = "0x" + "ab".repeat(32);
    for (const status of ["success", "reverted", "pending"] as const) {
      const w = fakeWorklet(() => ({ status }));
      expect(await transferReceipt(w.client, hash)).toBe(status);
    }
    const bad = fakeWorklet(() => ({ status: "maybe" }));
    await expect(transferReceipt(bad.client, hash)).rejects.toBeInstanceOf(WalletIpcError);
    await expect(transferReceipt(bad.client, "0x12")).rejects.toBeInstanceOf(WalletIpcError);
  });
});
