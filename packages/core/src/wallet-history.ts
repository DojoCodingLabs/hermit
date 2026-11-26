import { keccak_256 } from "@noble/hashes/sha3.js";
import { utf8ToBytes } from "@noble/hashes/utils.js";
import { sha256Hex } from "./canonical.ts";
import { money, type Money } from "./money.ts";
import { WALLET_NETWORK } from "./wallet.ts";

/**
 * SL-39 (US-PAY-03, FR-PAY-02, CT-01): the wallet's history, read from the chain through Stable testnet's RPC (Q127).
 *
 * The packet names the RPC and no indexer, so the history is USD₮0's own ERC-20 `Transfer` events that touch the
 * wallet's public address (`eth_getLogs`, two filters: to it and from it), read newest first in windows the RPC
 * accepts, a few windows per page, and never further back than `HISTORY.lookbackBlocks`. Reading needs only the
 * address: no seed, no key, no fingerprint.
 *
 * The RPC is someone else's server. Every log is checked again here (the contract, the event, the address, the
 * range, a 32-byte amount) and anything else is dropped, so another token, its name or anything a sender put on the
 * chain is never shown as money and never reaches a prompt. Amounts are exact base units (bigint), USD₮ only.
 */

/** keccak256("Transfer(address,address,uint256)"). */
export const TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

export const HISTORY = {
  /** Blocks per `eth_getLogs` call. Stable testnet's RPC refuses a span over 10,000 blocks (measured 2026-11-17). */
  windowBlocks: 10_000n,
  /** Windows per page: 12 calls (two filters each), about 12 hours of Stable testnet at about 0.7 s a block. */
  pageWindows: 6,
  /** How far back the history goes: 84 windows, about a week of Stable testnet. Older transfers aren't shown (Q127). */
  lookbackBlocks: 840_000n,
  /** A page stops early once it holds this many transfers. */
  pageTarget: 25,
  /** A larger RPC answer is refused unread. */
  maxResponseChars: 2_000_000,
} as const;

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const HASH = /^0x[0-9a-fA-F]{64}$/;
const WORD = /^0x[0-9a-fA-F]{64}$/;
const QUANTITY = /^0x[0-9a-fA-F]{1,64}$/;

/** EIP-55 mixed-case checksum. */
export function checksumAddress(address: string): string {
  if (!ADDRESS.test(address)) throw new TypeError("Not an address.");
  const lower = address.slice(2).toLowerCase();
  const hash = keccak_256(utf8ToBytes(lower));
  let out = "0x";
  for (let i = 0; i < 40; i++) {
    const nibble = (hash[i >> 1]! >> (i % 2 === 0 ? 4 : 0)) & 0x0f;
    out += nibble >= 8 ? lower[i]!.toUpperCase() : lower[i]!;
  }
  return out;
}

/** An address as an indexed event topic: 12 zero bytes, then the 20 address bytes, lowercase. */
export function addressTopic(address: string): string {
  if (!ADDRESS.test(address)) throw new TypeError("Not an address.");
  return "0x" + "0".repeat(24) + address.slice(2).toLowerCase();
}

/** A hex quantity from the RPC as a bigint; anything else throws. */
export function parseQuantity(v: unknown): bigint {
  if (typeof v !== "string" || !QUANTITY.test(v)) throw new TypeError("Not a quantity.");
  return BigInt(v);
}

export const toQuantity = (n: bigint) => {
  if (n < 0n) throw new RangeError("Negative block.");
  return "0x" + n.toString(16);
};

export interface LogFilter {
  address: string;
  fromBlock: string;
  toBlock: string;
  topics: (string | null)[];
}

/** The two `eth_getLogs` filters for one window: USD₮0 `Transfer`s to the address, and from it. */
export function transferLogFilters(address: string, from: bigint, to: bigint): [LogFilter, LogFilter] {
  if (from < 0n || to < from || to - from + 1n > HISTORY.windowBlocks) throw new RangeError("A window is 1 to windowBlocks blocks.");
  const me = addressTopic(address);
  const base = { address: WALLET_NETWORK.token, fromBlock: toQuantity(from), toBlock: toQuantity(to) };
  return [
    { ...base, topics: [TRANSFER_TOPIC, null, me] },
    { ...base, topics: [TRANSFER_TOPIC, me] },
  ];
}

export interface BlockRange {
  from: bigint;
  to: bigint;
}

/** Up to `n` windows from `toBlock` down to `floor` (both included), newest first. */
export function historyWindows(toBlock: bigint, floor: bigint, n: number): BlockRange[] {
  const out: BlockRange[] = [];
  for (let to = toBlock; to >= floor && out.length < n; ) {
    const from = to - HISTORY.windowBlocks + 1n > floor ? to - HISTORY.windowBlocks + 1n : floor;
    out.push({ from, to });
    to = from - 1n;
  }
  return out;
}

/** One USD₮ transfer touching the wallet. Every field was checked; nothing in it is text from the chain. */
export interface ChainTransfer {
  txHash: string;
  logIndex: number;
  block: bigint;
  /** Milliseconds, from the block's timestamp when the RPC includes it. */
  at?: number;
  /** "self": from the wallet to itself. */
  direction: "in" | "out" | "self";
  /** The other address (the wallet's own for "self"), checksummed. */
  counterparty: string;
  amount: Money;
}

function topicAddress(topic: unknown): string | undefined {
  if (typeof topic !== "string" || !WORD.test(topic) || !/^0x0{24}/.test(topic)) return undefined;
  return "0x" + topic.slice(26).toLowerCase();
}

function parseOne(raw: unknown, me: string, range: BlockRange): ChainTransfer | undefined {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const l = raw as Record<string, unknown>;
  if (l.removed === true) return undefined;
  if (typeof l.address !== "string" || l.address.toLowerCase() !== WALLET_NETWORK.token.toLowerCase()) return undefined;
  const topics = l.topics;
  if (!Array.isArray(topics) || topics.length !== 3 || typeof topics[0] !== "string" || topics[0].toLowerCase() !== TRANSFER_TOPIC) return undefined;
  const from = topicAddress(topics[1]);
  const to = topicAddress(topics[2]);
  if (!from || !to) return undefined;
  if (from !== me && to !== me) return undefined;
  if (typeof l.data !== "string" || !WORD.test(l.data)) return undefined;
  const amount = BigInt(l.data);
  // A zero transfer moves nothing; it is the usual shape of address poisoning (EC-PAY-16).
  if (amount === 0n) return undefined;
  if (typeof l.transactionHash !== "string" || !HASH.test(l.transactionHash)) return undefined;
  let block: bigint;
  let logIndex: bigint;
  try {
    block = parseQuantity(l.blockNumber);
    logIndex = parseQuantity(l.logIndex);
  } catch {
    return undefined;
  }
  if (block < range.from || block > range.to || logIndex > 1_000_000n) return undefined;
  let at: number | undefined;
  try {
    const ts = l.blockTimestamp === undefined ? undefined : parseQuantity(l.blockTimestamp);
    if (ts !== undefined && ts < 100_000_000_000n) at = Number(ts) * 1000;
  } catch {
    at = undefined;
  }
  const direction = from === me && to === me ? "self" : to === me ? "in" : "out";
  const t: ChainTransfer = {
    txHash: l.transactionHash.toLowerCase(),
    logIndex: Number(logIndex),
    block,
    direction,
    counterparty: checksumAddress(direction === "in" ? from : to),
    amount: money(amount, WALLET_NETWORK.asset, WALLET_NETWORK.network),
  };
  if (at !== undefined) t.at = at;
  return t;
}

/**
 * The RPC's logs for `address` in `range`, checked one by one: only USD₮0 `Transfer`s that touch the address, with a
 * nonzero amount, in the range. Duplicates (a transfer to itself matches both filters) count once. Newest first.
 */
export function parseTransferLogs(raw: unknown, address: string, range: BlockRange): { transfers: ChainTransfer[]; ignored: number } {
  if (!Array.isArray(raw)) throw new TypeError("The RPC's logs are not a list.");
  const me = address.toLowerCase();
  const seen = new Set<string>();
  const transfers: ChainTransfer[] = [];
  let ignored = 0;
  for (const item of raw) {
    const t = parseOne(item, me, range);
    if (!t) {
      ignored++;
      continue;
    }
    const key = `${t.txHash}:${t.logIndex}`;
    if (seen.has(key)) continue;
    seen.add(key);
    transfers.push(t);
  }
  transfers.sort((a, b) => (a.block === b.block ? b.logIndex - a.logIndex : a.block > b.block ? -1 : 1));
  return { transfers, ignored };
}

// --- JSON-RPC ------------------------------------------------------------------------------------------------------

/**
 * The only methods the wallet's reads send: no signing, no sending, nothing that changes the chain. SL-41 adds the
 * latest block's header (its time is the chain's clock) and `eth_call`, a read, for EIP-3009 `authorizationState`.
 */
export const READ_METHODS = ["eth_blockNumber", "eth_getLogs", "eth_getBlockByNumber", "eth_call"] as const;
export type ReadMethod = (typeof READ_METHODS)[number];

export class RpcError extends Error {
  constructor(readonly code: string) {
    super(`The RPC could not answer (${code}).`);
    this.name = "RpcError";
  }
}

/** EIP-3009 `authorizationState(address,bytes32)`'s selector, the one `eth_call` the wallet sends. */
export const AUTHORIZATION_STATE_SELECTOR = "0xe94a0102";
const AUTHORIZATION_STATE_DATA = new RegExp(`^${AUTHORIZATION_STATE_SELECTOR}[0-9a-f]{128}$`);

/**
 * SL-41: `eth_call` is a read, but any contract could be asked anything with it, so only one is sent: the wallet
 * token's `authorizationState`, at a block number or "latest", with nothing but `to` and `data`.
 */
function allowedCall(params: readonly unknown[]): boolean {
  if (params.length !== 2) return false;
  const [call, block] = params;
  if (!call || typeof call !== "object" || Array.isArray(call)) return false;
  const c = call as Record<string, unknown>;
  if (Object.keys(c).sort().join(",") !== "data,to") return false;
  if (typeof c.to !== "string" || c.to.toLowerCase() !== WALLET_NETWORK.token.toLowerCase()) return false;
  if (typeof c.data !== "string" || !AUTHORIZATION_STATE_DATA.test(c.data)) return false;
  return block === "latest" || (typeof block === "string" && /^0x[0-9a-f]{1,16}$/i.test(block));
}

export function rpcBody(id: number, method: ReadMethod, params: readonly unknown[]): string {
  if (!(READ_METHODS as readonly string[]).includes(method)) throw new TypeError("Only read methods are sent.");
  if (method === "eth_call" && !allowedCall(params)) throw new TypeError("Only the wallet token's authorizationState is called.");
  if (method === "eth_getBlockByNumber" && !(params.length === 2 && params[0] === "latest" && params[1] === false)) throw new TypeError("Only the latest block's header is read.");
  return JSON.stringify({ jsonrpc: "2.0", id, method, params });
}

/** The result of the answer to request `id`. An error keeps only its numeric code: the server's text is never shown. */
export function rpcResult(text: string, id: number): unknown {
  if (text.length > HISTORY.maxResponseChars) throw new RpcError("too_large");
  let o: unknown;
  try {
    o = JSON.parse(text);
  } catch {
    throw new RpcError("not_json");
  }
  if (o === null || typeof o !== "object" || Array.isArray(o)) throw new RpcError("bad_answer");
  const r = o as Record<string, unknown>;
  if (r.id !== id) throw new RpcError("wrong_id");
  if (r.error !== undefined) {
    const code = r.error && typeof r.error === "object" ? (r.error as Record<string, unknown>).code : undefined;
    throw new RpcError(Number.isSafeInteger(code) ? `rpc_${code as number}` : "rpc_error");
  }
  if (!("result" in r)) throw new RpcError("bad_answer");
  return r.result;
}

// --- The signed log ------------------------------------------------------------------------------------------------

/**
 * Q128: how a transfer Hermit made links to its signed-log entry. The entry that records it (SL-40's `pay`, SL-41's
 * x402) carries this as its `argsHash`: a domain-separated hash of the transaction hash, never the hash itself.
 */
export const transferRef = (txHash: string) => sha256Hex(`hermit.transfer\u0000${txHash.toLowerCase()}`);
