import { keccak_256 } from "@noble/hashes/sha3.js";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils.js";
import { money, MoneyError, parseMoney, type Money } from "./money.ts";
import { foldName, nameInWords, personQuery } from "./people.ts";
import { WALLET_NETWORK } from "./wallet.ts";

/**
 * SL-40 (US-PAY-05, US-PAY-06, FR-PAY-03, FR-PAY-05): what code reads from the user's own words before a payment, and
 * the shapes of the caps and payees. Pure. The model picks `pay` and fills its arguments; these functions decide what
 * the arguments may be: the amount is the one the user said, the recipient is an address the user typed this turn or a
 * saved payee whose name the user said. Nothing here reads a message, a page or a tool result.
 */

/** USD₮ base units on the wallet's network (Stable testnet, PDR-027). */
export const usdt = (amount: bigint): Money => money(amount, WALLET_NETWORK.asset, WALLET_NETWORK.network);

/** ENT-Contact: a payee the user saved on HM-PAY-05. Only the screen writes these; no skill does. */
export interface Payee {
  id: string;
  name: string;
  /** EVM address, checksummed when saved. */
  address: string;
  network: string;
  createdAt: number;
}

/** ENT-SpendingCap (PDR-011): per payment and rolling per day, USD₮ only. */
export interface SpendingCaps {
  perPayment: Money;
  perDay: Money;
}

/**
 * Q130: the packet names the caps but not their numbers. Until the user sets them on HM-PAY-05, a payment may be at
 * most 25 USD₮ and the last 24 hours at most 50 USD₮ (testnet, conservative).
 */
export const DEFAULT_SPENDING_CAPS: SpendingCaps = { perPayment: usdt(25_000_000n), perDay: usdt(50_000_000n) };

/** No cap above 10,000 USD₮ a day: a typo of extra zeros is refused, not saved. */
export const MAX_CAP = usdt(10_000_000_000n);

export type CapsProblem = "not_usdt" | "zero" | "per_payment_above_per_day" | "too_high";

export function capsProblem(c: SpendingCaps): CapsProblem | undefined {
  const ok = (m: Money) => m.asset === WALLET_NETWORK.asset && m.network === WALLET_NETWORK.network;
  if (!ok(c.perPayment) || !ok(c.perDay)) return "not_usdt";
  if (c.perPayment.amount <= 0n || c.perDay.amount <= 0n) return "zero";
  if (c.perPayment.amount > c.perDay.amount) return "per_payment_above_per_day";
  if (c.perDay.amount > MAX_CAP.amount) return "too_high";
  return undefined;
}

const ADDRESS = /(?<![0-9A-Za-z])0x[0-9a-fA-F]{40}(?![0-9A-Za-z])/g;
const HIDDEN = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}\p{Co}\p{Cn}]/u;

export function payeeProblem(name: string, address: string): "name" | "address" | undefined {
  if (!name.trim() || name.length > 80 || HIDDEN.test(name)) return "name";
  if (!/^0x[0-9a-fA-F]{40}$/.test(address.trim())) return "address";
  return undefined;
}

/** EIP-55 mixed-case form of an EVM address (what the sheet and the signed payload show). */
export function checksummed(address: string): string {
  if (!/^0x[0-9a-fA-F]{40}$/.test(address)) throw new RangeError("Not an EVM address.");
  const lower = address.slice(2).toLowerCase();
  const hash = bytesToHex(keccak_256(utf8ToBytes(lower)));
  let out = "0x";
  for (let i = 0; i < 40; i++) out += parseInt(hash[i]!, 16) >= 8 ? lower[i]!.toUpperCase() : lower[i]!;
  return out;
}

/**
 * True for an address with a usable checksum: all lowercase or all uppercase (no checksum to check) or exactly its
 * EIP-55 form. A mixed-case address with a wrong checksum is a typo, never paid.
 */
export function checksumOk(address: string): boolean {
  if (!/^0x[0-9a-fA-F]{40}$/.test(address)) return false;
  const body = address.slice(2);
  return body === body.toLowerCase() || body === body.toUpperCase() || checksummed(address) === address;
}

/** Every whole 0x address in the user's own text this turn, as typed, first occurrence only (case-insensitive). */
export function typedAddresses(userText: string): string[] {
  const out: string[] = [];
  for (const m of userText.matchAll(ADDRESS)) if (!out.some((a) => a.toLowerCase() === m[0].toLowerCase())) out.push(m[0]);
  return out;
}

/** Saved payees on the wallet's network whose name holds the name the user said, as whole words, only if they said it. */
export function matchPayees(name: string, userText: string, payees: readonly Payee[]): Payee[] {
  if (!nameInWords(name, userText)) return [];
  const q = personQuery(name);
  return payees.filter((p) => p.network === WALLET_NETWORK.network && ` ${foldName(p.name)} `.includes(` ${q} `));
}

// --- Amounts ----------------------------------------------------------------------------------------------------

const DOLLAR_WORDS = String.raw`usd₮0|usd₮|usdt0|usdt|usd|tether|d[oó]lar(?:es)?|dollars?|bucks|pavos`;
const OTHER_ASSETS = String.raw`usdc|eth|ether|ethereum|btc|bitcoin|bitcoins|sats?|xpl|solana|eur|euros?|mxn|pesos?|colones|soles|bol[ií]vares|reales|gbp|libras?`;
const word = (alts: string) => new RegExp(`(?<![\\p{L}\\p{N}])(?:${alts})(?![\\p{L}\\p{N}])`, "iu");
const OTHER = word(OTHER_ASSETS);
const OTHER_SYMBOL = /[€£¥₿]/u;

/** The first asset or currency named in the words that isn't USD₮ (or dollars), so a payment in it is refused. */
export function otherAssetInWords(userText: string): string | undefined {
  const text = userText.replace(ADDRESS, " ");
  const m = OTHER.exec(text) ?? OTHER_SYMBOL.exec(text);
  return m ? m[0].toUpperCase() : undefined;
}

export type WordsAmount = { kind: "amount"; money: Money } | { kind: "none" } | { kind: "ambiguous" } | { kind: "invalid" };

/** A number as people write it: digits, with at most one decimal separator. "1,000" and "1.000,50" read two ways. */
function decimalText(raw: string): string | "ambiguous" {
  const seps = raw.match(/[.,]/g) ?? [];
  if (seps.length === 0) return raw;
  if (seps.length > 1) return "ambiguous";
  const [whole, frac = ""] = raw.split(/[.,]/);
  // "1,000" is a thousand in English and one in Spanish; "1.000" the other way round. Neither is guessed.
  if (frac.length === 3 && whole !== "0") return "ambiguous";
  return `${whole}.${frac}`;
}

/** The money a decimal text stands for, exactly; undefined when it has more decimals than USD₮ or isn't one. */
function exact(text: string): Money | undefined {
  try {
    return parseMoney(text, WALLET_NETWORK.asset, WALLET_NETWORK.network);
  } catch (e) {
    if (e instanceof MoneyError) return undefined;
    throw e;
  }
}

const NUMBER = /(?<![\p{L}\p{N}.,])(\$\s?)?(\d+(?:[.,]\d+)*)(?![\p{N}])/gu;
const MARK_AFTER = new RegExp(String.raw`^\s?(?:${DOLLAR_WORDS})(?![\p{L}\p{N}])`, "iu");

/**
 * The amount the user said this turn, in USD₮ base units. One amount, or one marked with "$" or a dollar word when the
 * sentence has other numbers ("20 dollars for the 3 tickets"). Two different amounts, an amount that reads two ways,
 * or more decimals than USD₮ has are never guessed: Hermit asks.
 */
export function amountInWords(userText: string): WordsAmount {
  const text = userText.replace(ADDRESS, " ");
  const found: Array<{ raw: string; marked: boolean }> = [];
  for (const m of text.matchAll(NUMBER)) {
    const after = text.slice((m.index ?? 0) + m[0].length);
    found.push({ raw: m[2]!, marked: Boolean(m[1]) || MARK_AFTER.test(after) });
  }
  const marked = found.filter((f) => f.marked);
  const pool = marked.length ? marked : found;
  if (!pool.length) return { kind: "none" };
  const values: Money[] = [];
  for (const f of pool) {
    const d = decimalText(f.raw);
    if (d === "ambiguous") return { kind: "ambiguous" };
    const m = exact(d);
    if (!m) return { kind: "invalid" };
    if (!values.some((v) => v.amount === m.amount)) values.push(m);
  }
  if (values.length > 1) return { kind: "ambiguous" };
  return values[0]!.amount > 0n ? { kind: "amount", money: values[0]! } : { kind: "none" };
}

/** The `pay` skill's `amount` argument ("20", "20.5", "$20", "20 USD₮"), exactly, or undefined. Never a float. */
export function parsePayAmount(arg: string): Money | undefined {
  const m = /^\s*\$?\s?(\d+(?:[.,]\d+)?)\s*(?:usd₮0|usd₮|usdt0|usdt|usd)?\s*$/iu.exec(arg);
  if (!m) return undefined;
  const d = decimalText(m[1]!);
  if (d === "ambiguous") return undefined;
  const v = exact(d);
  return v && v.amount > 0n ? v : undefined;
}

/** The canonical text of an amount (no trailing zeros): what the normalizer writes into `amount`. */
export function payAmountText(m: Money): string {
  const whole = m.amount / 1_000_000n;
  const frac = (m.amount % 1_000_000n).toString().padStart(6, "0").replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : `${whole}`;
}
