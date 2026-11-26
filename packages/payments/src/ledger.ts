// Spend accounting that fails closed. Once Hermit has signed an EIP-3009 authorization, the merchant
// (or anyone holding the header) can settle it until `validBefore`, whatever the HTTP reply said.
// So every signed authorization counts against the daily cap until the chain proves it unused.
import { addMoney, money, type Money } from "@hermit/core";
import { keccak_256 } from "@noble/hashes/sha3.js";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils.js";
import { X402Error } from "./errors.ts";
import { isAddress } from "./eip712.ts";
import { checkCaps, VALID_AFTER_SKEW_SECONDS, type CapCheck, type SpendingCap } from "./x402.ts";

export type SpendStatus = "settled" | "pending" | "void";

export interface SpendRecord {
  amount: Money;
  /** The signer's address (`authorization.from`). */
  payer: string;
  /** The token contract the authorization is for. */
  token: string;
  /** EIP-3009 nonce, 0x plus 32 bytes of hex. */
  nonce: string;
  /** Unix seconds. After this the authorization can no longer be settled. */
  validBefore: number;
  /** When it was signed, epoch ms. The rolling day is measured from here. */
  atMs: number;
  /** settled: on chain or confirmed by the merchant. pending: may still settle. void: proven unused after expiry. */
  status: SpendStatus;
  /** SL-40: who the authorization pays (`authorization.to`), checksummed. */
  recipient?: string;
}

export const DAY_MS = 24 * 60 * 60 * 1000;

/** What counts against the per-day cap: settled and pending in the last 24 hours, same asset and network. */
export function spentInWindow(records: readonly SpendRecord[], nowMs: number, asset: string, network: string): Money {
  let total = money(0n, asset, network);
  for (const r of records) {
    if (r.status === "void" || r.amount.asset !== asset || r.amount.network !== network) continue;
    if (r.atMs <= nowMs - DAY_MS) continue;
    total = addMoney(total, r.amount);
  }
  return total;
}

/**
 * Seconds past `validBefore` before an unused authorization is treated as dead. Clocks disagree (the
 * phone, the merchant, the chain), so the margin is at least the skew the authorization tolerates.
 */
export const VOID_MARGIN_SECONDS = VALID_AFTER_SKEW_SECONDS;

/**
 * Updates a pending record from `authorizationState(payer, nonce)`. Used means settled. Unused only
 * frees the cap once `validBefore` plus `VOID_MARGIN_SECONDS` has passed; before that the merchant
 * can still settle it. `chainTimeSeconds` must be the timestamp of the block the state was read at
 * (see `latestBlockCall` and `readBlock`), not the phone's clock.
 */
export function resolvePending(record: SpendRecord, usedOnChain: boolean, chainTimeSeconds: number): SpendRecord {
  if (record.status !== "pending") return record;
  if (usedOnChain) return { ...record, status: "settled" };
  if (chainTimeSeconds >= record.validBefore + VOID_MARGIN_SECONDS) return { ...record, status: "void" };
  return record;
}

/** JSON-RPC request for the latest block header; run `authorizationStateCall` at its `number`. */
export function latestBlockCall(): { method: "eth_getBlockByNumber"; params: ["latest", false] } {
  return { method: "eth_getBlockByNumber", params: ["latest", false] };
}

/** Block number (hex, the eth_call block tag) and timestamp (seconds) from a block header. */
export function readBlock(block: unknown): { number: string; timestamp: number } {
  const b = block as { number?: unknown; timestamp?: unknown } | null;
  const hex = (v: unknown): v is string => typeof v === "string" && /^0x[0-9a-fA-F]+$/.test(v);
  if (!b || !hex(b.number) || !hex(b.timestamp)) throw new X402Error("malformed", "Not a block header.");
  return { number: b.number, timestamp: Number(BigInt(b.timestamp)) };
}

/**
 * The spend ledger port. `reserve` must re-check the cap and insert the pending record atomically
 * per asset and network, so two payments racing through approval cannot both pass the same cap.
 * On the phone it is one SQL transaction on the spend table; `memoryLedger` is the reference.
 */
export interface LedgerPort {
  reserve(record: SpendRecord, cap: SpendingCap | undefined, nowMs: number): Promise<CapCheck>;
  /** Moves a reserved pending record to settled or void. Records that are not pending never change. */
  update(nonce: string, status: Exclude<SpendStatus, "pending">): Promise<void>;
}

/** In-memory ledger with a per asset and network lock. Tests and the desktop spike. */
export function memoryLedger(initial: readonly SpendRecord[] = []): LedgerPort & { records(): SpendRecord[] } {
  const rows = initial.map((r) => ({ ...r }));
  const locks = new Map<string, Promise<unknown>>();
  function locked<T>(key: string, fn: () => T | Promise<T>): Promise<T> {
    const next = (locks.get(key) ?? Promise.resolve()).then(fn, fn);
    locks.set(key, next.catch(() => undefined));
    return next;
  }
  return {
    records: () => rows.map((r) => ({ ...r })),
    reserve(record, cap, nowMs) {
      return locked(`${record.amount.asset}|${record.amount.network}`, () => {
        if (rows.some((r) => r.nonce === record.nonce)) throw new X402Error("bad_input", "Nonce already reserved.");
        const check = checkCaps(record.amount, cap, spentInWindow(rows, nowMs, record.amount.asset, record.amount.network));
        if (check.ok) rows.push({ ...record, status: "pending" });
        return check;
      });
    },
    async update(nonce, status) {
      const row = rows.find((r) => r.nonce === nonce);
      if (!row) throw new X402Error("bad_input", "Unknown nonce.");
      if (row.status === "pending") row.status = status;
    },
  };
}

const AUTHORIZATION_STATE = bytesToHex(keccak_256(utf8ToBytes("authorizationState(address,bytes32)")).slice(0, 4));

/** The `eth_call` an app adapter sends to check a nonce (EIP-3009 `authorizationState`). */
export function authorizationStateCall(record: Pick<SpendRecord, "payer" | "token" | "nonce">): { to: string; data: string } {
  if (!isAddress(record.payer) || !isAddress(record.token)) throw new X402Error("bad_input", "Not an EVM address.");
  if (!/^0x[0-9a-fA-F]{64}$/.test(record.nonce)) throw new X402Error("bad_input", "Nonce must be 32 bytes of hex.");
  return {
    to: record.token,
    data: "0x" + AUTHORIZATION_STATE + record.payer.slice(2).toLowerCase().padStart(64, "0") + record.nonce.slice(2).toLowerCase(),
  };
}

export function readAuthorizationState(result: string): boolean {
  if (!/^0x[0-9a-fA-F]{64}$/.test(result)) throw new X402Error("malformed", "authorizationState did not return one word.");
  const v = BigInt(result);
  if (v > 1n) throw new X402Error("malformed", "authorizationState did not return a bool.");
  return v === 1n;
}
