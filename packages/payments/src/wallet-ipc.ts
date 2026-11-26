// The app's side of the wallet worklet (SL-17, SL-38, docs/research/wdk-worklet-spike.md): newline-delimited JSON
// over react-native-bare-kit IPC. The worklet runs Tether WDK: it makes the seed from its CSPRNG, seals it under the
// wallet key the app unwrapped from the Keystore, and hands back only the sealed blob and the public address. Only
// `reveal`, for the backup screen, returns the words. The worklet answers eight fixed methods and nothing else; every
// answer is checked here (Stable testnet only), and every signature is recovered and must come from the wallet's own
// address before the app uses it. No network: IPC is a local byte stream.
import { bytesToHex } from "@noble/hashes/utils.js";
import { checkRecoveryPhrase, WALLET_KEY_BYTES, WALLET_NETWORK } from "@hermit/core";
import { checksumAddress, isAddress, sameAddress, type TransferWithAuthorizationTypedData } from "./eip712.ts";
import { recoverTypedDataSigner, type TypedDataSigner } from "./signer.ts";

export const WALLET_METHODS = [
  "create", "restore", "open", "reveal", "address", "balance", "signTransferWithAuthorization", "close",
  // SL-40: paying a person. The fee estimate (a public address, no key), submitting a signed authorization (the open
  // wallet, transferWithAuthorization on USD₮0 only) and the transaction's receipt.
  "quoteTransfer", "sendTransferWithAuthorization", "transferReceipt",
] as const;
export type WalletMethod = (typeof WALLET_METHODS)[number];

/** A line longer than this is a broken or hostile peer, not a response. */
export const MAX_WALLET_LINE_BYTES = 64 * 1024;

export class WalletIpcError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(`${code}: ${message}`);
    this.name = "WalletIpcError";
    this.code = code;
  }
}

/** Splits a byte stream into UTF-8 lines; a partial line, or a multi-byte character cut in two, waits for the next chunk. */
export function createLineSplitter(maxLineBytes = MAX_WALLET_LINE_BYTES): (chunk: Uint8Array) => string[] {
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let pending = new Uint8Array(0);
  return (chunk) => {
    const joined = new Uint8Array(pending.length + chunk.length);
    joined.set(pending);
    joined.set(chunk, pending.length);
    const lines: string[] = [];
    let start = 0;
    for (let i = 0; i < joined.length; i++) {
      if (joined[i] !== 0x0a) continue;
      if (i > start) lines.push(decoder.decode(joined.subarray(start, i)));
      start = i + 1;
    }
    pending = joined.slice(start);
    if (pending.length > maxLineBytes) {
      pending = new Uint8Array(0);
      throw new WalletIpcError("line_too_long", `A wallet line passed ${maxLineBytes} bytes.`);
    }
    return lines;
  };
}

export interface WalletTransport {
  write(bytes: Uint8Array): void;
}

export interface WalletClient {
  /** Feed every chunk the worklet writes. */
  receive(chunk: Uint8Array): void;
  call(method: WalletMethod, params?: Record<string, unknown>): Promise<unknown>;
  /** The worklet stopped or broke: reject every pending and future call with `code`. */
  fail(code: string): void;
}

interface Pending {
  resolve(value: unknown): void;
  reject(err: Error): void;
}

export function createWalletClient(transport: WalletTransport): WalletClient {
  const encoder = new TextEncoder();
  const split = createLineSplitter();
  const pending = new Map<number, Pending>();
  let nextId = 1;
  let failed: string | null = null;

  const settle = (line: string) => {
    let res: unknown;
    try {
      res = JSON.parse(line);
    } catch {
      return;
    }
    if (res === null || typeof res !== "object") return;
    const { id, ok, result, error } = res as { id?: unknown; ok?: unknown; result?: unknown; error?: { code?: unknown; message?: unknown } };
    if (typeof id !== "number" || typeof ok !== "boolean") return;
    const waiter = pending.get(id);
    if (!waiter) return;
    pending.delete(id);
    if (ok) waiter.resolve(result);
    else waiter.reject(new WalletIpcError(String(error?.code ?? "failed"), String(error?.message ?? "The wallet refused.")));
  };

  const client: WalletClient = {
    receive(chunk) {
      let lines: string[];
      try {
        lines = split(chunk);
      } catch (err) {
        client.fail(err instanceof WalletIpcError ? err.code : "bad_stream");
        return;
      }
      for (const line of lines) settle(line);
    },
    call(method, params) {
      if (failed) return Promise.reject(new WalletIpcError(failed, "The wallet worklet is not running."));
      if (!(WALLET_METHODS as readonly string[]).includes(method)) {
        return Promise.reject(new WalletIpcError("unknown_method", "Not a wallet method."));
      }
      const id = nextId++;
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        const body = params === undefined ? { id, method } : { id, method, params };
        try {
          transport.write(encoder.encode(JSON.stringify(body) + "\n"));
        } catch (err) {
          pending.delete(id);
          reject(new WalletIpcError("write_failed", String((err as Error)?.message ?? err)));
        }
      });
    },
    fail(code) {
      failed = code;
      for (const waiter of pending.values()) waiter.reject(new WalletIpcError(code, "The wallet worklet stopped."));
      pending.clear();
    },
  };
  return client;
}

export interface WalletInfo {
  address: string;
  path: string;
  chainId: number;
}

function record(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new WalletIpcError("bad_response", "Expected an object.");
  return value as Record<string, unknown>;
}

/** The address, path and chain the worklet reports, checked: an EVM address, Stable testnet's chain, the one path. */
function walletInfo(r: Record<string, unknown>): WalletInfo {
  if (typeof r.address !== "string" || !isAddress(r.address)) throw new WalletIpcError("bad_response", "The wallet address is not an EVM address.");
  if (r.path !== WALLET_NETWORK.path || r.chainId !== WALLET_NETWORK.chainId) throw new WalletIpcError("bad_response", "Not the wallet's path or chain.");
  return { address: checksumAddress(r.address), path: r.path, chainId: r.chainId };
}

/** The key as the worklet takes it. Refused before anything is sent when it isn't 32 bytes. */
function keyHex(key: Uint8Array): string {
  if (!(key instanceof Uint8Array) || key.length !== WALLET_KEY_BYTES) throw new WalletIpcError("bad_input", "The wallet key is 32 bytes.");
  return bytesToHex(key);
}

/** What create and restore return: the sealed seed (iv ‖ ciphertext ‖ tag, hex) and the wallet's public facts. */
export interface SealedWallet extends WalletInfo {
  sealed: string;
  words: 12 | 24;
}

const SEALED_KEYS = ["sealed", "address", "path", "chainId", "words"];

function sealedWallet(value: unknown, words: 12 | 24): SealedWallet {
  const r = record(value);
  if (Object.keys(r).some((k) => !SEALED_KEYS.includes(k))) throw new WalletIpcError("bad_response", "Unexpected fields from the wallet.");
  if (r.words !== words) throw new WalletIpcError("bad_response", "The wallet has another number of words.");
  const bytes = 12 + 16 + (words === 12 ? 16 : 32);
  if (typeof r.sealed !== "string" || !/^[0-9a-f]+$/.test(r.sealed) || r.sealed.length !== bytes * 2) throw new WalletIpcError("bad_response", "The sealed seed is malformed.");
  return { sealed: r.sealed, words, ...walletInfo(r) };
}

/** US-PAY-01: the worklet makes a new seed from its CSPRNG, seals it under `key` for wallet `id`, and keeps nothing. */
export async function createInWorklet(client: WalletClient, req: { id: string; key: Uint8Array; words: 12 | 24 }): Promise<SealedWallet> {
  const key = keyHex(req.key);
  return sealedWallet(await client.call("create", { id: req.id, key, words: req.words }), req.words);
}

/** US-PAY-02: the worklet checks the words (BIP-39, English), derives the address and seals the seed under `key`. */
export async function restoreInWorklet(client: WalletClient, req: { id: string; key: Uint8Array; words: readonly string[] }): Promise<SealedWallet> {
  const key = keyHex(req.key);
  const count = req.words.length;
  if (count !== 12 && count !== 24) throw new WalletIpcError("bad_input", "A recovery phrase is 12 or 24 words.");
  return sealedWallet(await client.call("restore", { id: req.id, key, phrase: req.words.join(" ") }), count);
}

/**
 * The backup screen only: the worklet unseals the seed and returns its words and the address they derive. The words
 * must be a valid English BIP-39 phrase, or nothing is shown (a wrong backup is worse than none).
 */
export async function revealWords(client: WalletClient, req: { id: string; key: Uint8Array; sealed: string }): Promise<{ words: string[]; address: string }> {
  const key = keyHex(req.key);
  const r = record(await client.call("reveal", { id: req.id, key, sealed: req.sealed }));
  const words = r.words;
  if (!Array.isArray(words) || !words.every((w) => typeof w === "string" && /^[a-z]+$/.test(w))) throw new WalletIpcError("bad_response", "The words are malformed.");
  const check = checkRecoveryPhrase(words.join(" "));
  if (!check.ok || check.words.length !== words.length) throw new WalletIpcError("bad_response", "The words are not a valid recovery phrase.");
  if (typeof r.address !== "string" || !isAddress(r.address)) throw new WalletIpcError("bad_response", "The wallet address is not an EVM address.");
  return { words: check.words, address: checksumAddress(r.address) };
}

/** Opens the wallet in the worklet for signing (SL-41): the worklet unseals the seed and keeps the account. */
export async function openWallet(client: WalletClient, req: { id: string; key: Uint8Array; sealed: string }): Promise<WalletInfo> {
  const key = keyHex(req.key);
  return walletInfo(record(await client.call("open", { id: req.id, key, sealed: req.sealed })));
}

const DECIMAL = /^(0|[1-9][0-9]*)$/;

/**
 * USD₮0 in base units (6 decimals) and the native balance in wei, for a public address: the worklet reads them over
 * Stable testnet's RPC with no key. On Stable they are the same money (gas is USD₮0).
 */
export async function readBalance(client: WalletClient, address: string): Promise<{ usdt0: bigint; native: bigint }> {
  if (typeof address !== "string" || !isAddress(address)) throw new WalletIpcError("bad_input", "Not an EVM address.");
  const r = record(await client.call("balance", { address: checksumAddress(address) }));
  if (typeof r.usdt0 !== "string" || !DECIMAL.test(r.usdt0) || typeof r.native !== "string" || !DECIMAL.test(r.native)) {
    throw new WalletIpcError("bad_response", "Balances must be whole decimal strings.");
  }
  return { usdt0: BigInt(r.usdt0), native: BigInt(r.native) };
}

/**
 * The `TypedDataSigner` that `payWithX402` uses on the phone. Sends only the domain and the message (the worklet
 * fixes the struct), then recovers the signature here: anything that is not from `address` is refused.
 */
export function workletSigner(client: WalletClient, address: string): TypedDataSigner {
  const self = checksumAddress(address);
  return {
    address: self,
    async signTypedData(td: TransferWithAuthorizationTypedData) {
      if (!sameAddress(td.message.from, self)) throw new WalletIpcError("wrong_payer", "The authorization is not from this wallet.");
      const r = record(await client.call("signTransferWithAuthorization", { domain: td.domain, message: td.message }));
      if (typeof r.signature !== "string" || !/^0x[0-9a-fA-F]{130}$/.test(r.signature)) {
        throw new WalletIpcError("bad_response", "A signature is 65 bytes of hex.");
      }
      const v = parseInt(r.signature.slice(130), 16);
      if (v !== 0 && v !== 1 && v !== 27 && v !== 28) throw new WalletIpcError("bad_response", "Unexpected recovery id.");
      const signature = r.signature.slice(0, 130).toLowerCase() + (v < 27 ? v + 27 : v).toString(16);
      if (recoverTypedDataSigner(td, signature) !== self) throw new WalletIpcError("signer_mismatch", "The signature is not from this wallet.");
      return signature;
    },
  };
}
