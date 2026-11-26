// SL-40 (US-PAY-05): paying a person. The payment is one EIP-3009 TransferWithAuthorization for USD₮0 on Stable testnet,
// the same struct x402 signs, so the worklet signs nothing new. The wallet submits it itself (on Stable the gas is
// USD₮0). Its `validBefore` bounds it: a signature that never confirms stops being spendable after MAX_TIMEOUT_SECONDS,
// so a pending reservation in the ledger has an end. No network here: the worklet talks to the RPC.
import { bytesToHex } from "@noble/hashes/utils.js";
import type { Money } from "@hermit/core";
import { X402Error } from "./errors.ts";
import {
  checksumAddress, isAddress, sameAddress, transferWithAuthorizationDigest,
  type TransferAuthorization, type TransferWithAuthorizationTypedData,
} from "./eip712.ts";
import type { SpendRecord } from "./ledger.ts";
import { recoverTypedDataSigner } from "./signer.ts";
import { WalletIpcError, type WalletClient } from "./wallet-ipc.ts";
import { MAX_TIMEOUT_SECONDS, VALID_AFTER_SKEW_SECONDS, type X402Asset } from "./x402.ts";

export interface TransferPlan {
  typedData: TransferWithAuthorizationTypedData;
  /** What the wallet signs (EIP-712 digest). */
  digest: string;
  /** The pending ledger row this authorization is reserved as, before anyone is asked. */
  record: SpendRecord;
}

/**
 * The authorization for `amount` from `from` to `to`, valid from `VALID_AFTER_SKEW_SECONDS` ago until
 * `MAX_TIMEOUT_SECONDS` from now. Refuses anything but USD₮ on the asset's own network, zero, and paying yourself.
 */
export function planTransfer(input: { from: string; to: string; amount: Money; asset: X402Asset; nowMs: number; nonce: Uint8Array }): TransferPlan {
  const { from, to, amount, asset } = input;
  if (asset.code !== "USDT" || amount.asset !== "USDT") throw new X402Error("unsupported_asset", "Hermit only pays in USD₮.");
  if (amount.network !== asset.network) throw new X402Error("unsupported_network", "The amount is on another network.");
  if (amount.amount <= 0n) throw new X402Error("bad_input", "A payment is more than zero.");
  if (!isAddress(from) || !isAddress(to)) throw new X402Error("bad_input", "Not an EVM address.");
  if (sameAddress(from, to)) throw new X402Error("bad_input", "That would pay yourself.");
  if (input.nonce.length !== 32) throw new X402Error("bad_input", "The EIP-3009 nonce is 32 bytes.");
  const now = Math.floor(input.nowMs / 1000);
  const message: TransferAuthorization = {
    from: checksumAddress(from),
    to: checksumAddress(to),
    value: amount.amount.toString(),
    validAfter: String(Math.max(0, now - VALID_AFTER_SKEW_SECONDS)),
    validBefore: String(now + MAX_TIMEOUT_SECONDS),
    nonce: "0x" + bytesToHex(input.nonce),
  };
  const typedData: TransferWithAuthorizationTypedData = {
    domain: { name: asset.eip712.name, version: asset.eip712.version, chainId: asset.chainId, verifyingContract: asset.address },
    primaryType: "TransferWithAuthorization",
    message,
  };
  return {
    typedData,
    digest: transferWithAuthorizationDigest(typedData),
    record: {
      amount, payer: message.from, token: asset.address, nonce: message.nonce, validBefore: now + MAX_TIMEOUT_SECONDS, atMs: input.nowMs,
      status: "pending", recipient: message.to,
    },
  };
}

/** `transferWithAuthorization(address,address,uint256,uint256,uint256,bytes32,uint8,bytes32,bytes32)` (EIP-3009). */
export const TRANSFER_WITH_AUTHORIZATION_SELECTOR = "0xe3ee160e";

const word = (hex: string) => hex.toLowerCase().padStart(64, "0");
const SIGNATURE = /^0x[0-9a-fA-F]{130}$/;

/** The ABI-encoded call the wallet submits to the token contract for a signed authorization. */
export function transferWithAuthorizationCalldata(m: TransferAuthorization, signature: string): string {
  if (!SIGNATURE.test(signature)) throw new X402Error("bad_input", "A signature is 65 bytes of hex.");
  const v = parseInt(signature.slice(130), 16);
  if (v !== 27 && v !== 28) throw new X402Error("bad_input", "Unexpected recovery id.");
  if (!isAddress(m.from) || !isAddress(m.to) || !/^0x[0-9a-fA-F]{64}$/.test(m.nonce)) throw new X402Error("bad_input", "Malformed authorization.");
  const uint = (s: string) => {
    if (!/^\d+$/.test(s)) throw new X402Error("bad_input", "Not an unsigned integer.");
    return word(BigInt(s).toString(16));
  };
  return TRANSFER_WITH_AUTHORIZATION_SELECTOR + [
    word(m.from.slice(2)), word(m.to.slice(2)), uint(m.value), uint(m.validAfter), uint(m.validBefore), word(m.nonce.slice(2)),
    word(v.toString(16)), word(signature.slice(2, 66)), word(signature.slice(66, 130)),
  ].join("");
}

const DECIMAL = /^(0|[1-9][0-9]*)$/;
const TX_HASH = /^0x[0-9a-fA-F]{64}$/;

function record(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new WalletIpcError("bad_response", "Expected an object.");
  return value as Record<string, unknown>;
}

/** HM-APPR-02's network fee: the worklet's estimate, in wei of Stable's gas token (USD₮0), for a public address. */
export async function quoteTransferFee(client: WalletClient, req: { from: string; to: string; value: bigint }): Promise<bigint> {
  if (!isAddress(req.from) || !isAddress(req.to) || req.value <= 0n) throw new WalletIpcError("bad_input", "Not a transfer.");
  const r = record(await client.call("quoteTransfer", { from: checksumAddress(req.from), to: checksumAddress(req.to), value: req.value.toString() }));
  if (typeof r.fee !== "string" || !DECIMAL.test(r.fee)) throw new WalletIpcError("bad_response", "A fee is a whole decimal.");
  return BigInt(r.fee);
}

/**
 * Submits a signed authorization from the open wallet. The signature is recovered here first: one that isn't the
 * payer's is never sent. Returns the transaction hash; the worklet checks the struct and the chain again.
 */
export async function sendTransferWithAuthorization(client: WalletClient, req: { typedData: TransferWithAuthorizationTypedData; signature: string }): Promise<string> {
  const { typedData, signature } = req;
  if (!SIGNATURE.test(signature) || recoverTypedDataSigner(typedData, signature) !== checksumAddress(typedData.message.from)) {
    throw new WalletIpcError("wrong_payer", "The signature is not the payer's.");
  }
  const r = record(await client.call("sendTransferWithAuthorization", { domain: typedData.domain, message: typedData.message, signature }));
  if (typeof r.hash !== "string" || !TX_HASH.test(r.hash)) throw new WalletIpcError("bad_response", "Not a transaction hash.");
  return r.hash.toLowerCase();
}

export type TransferReceipt = "success" | "reverted" | "pending";

/** Whether the submitted transaction is mined, and how it ended. */
export async function transferReceipt(client: WalletClient, hash: string): Promise<TransferReceipt> {
  if (!TX_HASH.test(hash)) throw new WalletIpcError("bad_input", "Not a transaction hash.");
  const r = record(await client.call("transferReceipt", { hash }));
  if (r.status !== "success" && r.status !== "reverted" && r.status !== "pending") throw new WalletIpcError("bad_response", "Unknown receipt status.");
  return r.status;
}
