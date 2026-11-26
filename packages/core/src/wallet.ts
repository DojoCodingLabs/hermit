import { sha256 } from "@noble/hashes/sha2.js";
import { BIP39_ENGLISH } from "./bip39-english.ts";
import { sha256Hex } from "./canonical.ts";
import { uniformIndex, type SecureRandom, type VaultKeyPort } from "./vault.ts";

/**
 * SL-38 (US-PAY-01, US-PAY-02, FR-PAY-01): the wallet's pure parts.
 *
 * The seed is made and used only inside the wallet worklet (Tether WDK in Bare). At rest it is the BIP-39 entropy sealed
 * with AES-256-GCM under the wallet key, a random 32-byte key stored only wrapped by an Android Keystore key that needs
 * a strong biometric for every use (`WalletKeyPort`, the vault's pattern under its own Keystore service). The app keeps
 * the sealed blob, the public address and two dates in one record (`WalletRecord`), never in the database, a log, the
 * model or the signed log, which names the wallet by `walletIdHash` only.
 */

/** The SecureStore entry and the Keystore service that hold the wrapped wallet key (and nothing else). */
export const WALLET_KEY = { key: "hermit.wallet.key.v1", service: "hermit.wallet" } as const;

/** The SecureStore entry that holds the wallet record (sealed seed, address, dates). One per device. */
export const WALLET_RECORD_KEY = "hermit.wallet.v1";

export const WALLET_KEY_BYTES = 32;

/**
 * The only network the wallet uses: Stable testnet, where USD₮0 is both the token and the gas (PDR-027, SL-17). Testnet
 * only; the worklet fixes the same values and refuses any other chain.
 */
export const WALLET_NETWORK = {
  network: "eip155:2201",
  chainId: 2201,
  /** The money code (`Money.asset`): USD₮, shown as USD₮0 where the chain carries it. */
  asset: "USDT",
  token: "0x78Cf24370174180738C5B8E352B6D14c83a6c9A9",
  path: "m/44'/60'/0'/0/0",
  rpcOrigin: "https://rpc.testnet.stable.xyz",
  testnet: true,
} as const;

/** The wallet key behaves exactly like the vault key: wrapped by a strong-biometric Keystore key, prompted per use. */
export type WalletKeyPort = VaultKeyPort;

/** Q125: Hermit creates 12 words (128 bits, the WDK default); restore takes 12 or 24. */
export const CREATE_WORD_COUNT = 12;
export const RECOVERY_WORD_COUNTS = [12, 24] as const;
export type RecoveryWordCount = (typeof RECOVERY_WORD_COUNTS)[number];

/** US-PAY-01: the user confirms three of the words. */
export const WORD_CHECK_COUNT = 3;

// --- BIP-39 (English list, Q124) ----------------------------------------------------------------------------------

const INDEX = new Map(BIP39_ENGLISH.map((w, i) => [w, i]));

/** Words as people type them: any case, any spacing, line breaks. NFKD as BIP-39 asks (the English list is ASCII). */
export function splitPhrase(text: string): string[] {
  return text.normalize("NFKD").toLowerCase().split(/\s+/).filter(Boolean);
}

/** BIP-39 words for 16 or 32 bytes of entropy (12 or 24 words). */
export function entropyToWords(entropy: Uint8Array): string[] {
  if (entropy.length !== 16 && entropy.length !== 32) throw new RangeError("Entropy is 16 or 32 bytes.");
  const checksumBits = entropy.length / 4;
  const hash = sha256(entropy);
  let bits = "";
  for (const b of entropy) bits += b.toString(2).padStart(8, "0");
  // 4 checksum bits for 12 words, 8 for 24: never more than the hash's first byte.
  bits += hash[0]!.toString(2).padStart(8, "0").slice(0, checksumBits);
  const words: string[] = [];
  for (let i = 0; i < bits.length; i += 11) words.push(BIP39_ENGLISH[parseInt(bits.slice(i, i + 11), 2)]!);
  return words;
}

/** The entropy behind 12 or 24 English words, or undefined when a word is unknown or the checksum is wrong. */
export function wordsToEntropy(words: readonly string[]): Uint8Array | undefined {
  if (words.length !== 12 && words.length !== 24) return undefined;
  let bits = "";
  for (const w of words) {
    const i = INDEX.get(w);
    if (i === undefined) return undefined;
    bits += i.toString(2).padStart(11, "0");
  }
  const checksumBits = words.length / 3;
  const entropyBits = bits.length - checksumBits;
  const entropy = new Uint8Array(entropyBits / 8);
  for (let i = 0; i < entropy.length; i++) entropy[i] = parseInt(bits.slice(i * 8, i * 8 + 8), 2);
  const expected = entropyToWords(entropy);
  return expected.every((w, i) => w === words[i]) ? entropy : undefined;
}

export type PhraseCheck =
  | { ok: true; words: string[] }
  | { ok: false; problem: "word_count"; count: number }
  /** 0-based positions of the words that aren't in the English list. */
  | { ok: false; problem: "unknown_words"; positions: number[] }
  | { ok: false; problem: "checksum" };

/** US-PAY-02: restore validates the phrase before any fingerprint: 12 or 24 words, each in the list, the checksum right. */
export function checkRecoveryPhrase(text: string): PhraseCheck {
  const words = splitPhrase(text);
  if (!(RECOVERY_WORD_COUNTS as readonly number[]).includes(words.length)) return { ok: false, problem: "word_count", count: words.length };
  const unknown = words.flatMap((w, i) => (INDEX.has(w) ? [] : [i]));
  if (unknown.length) return { ok: false, problem: "unknown_words", positions: unknown };
  const entropy = wordsToEntropy(words);
  if (!entropy) return { ok: false, problem: "checksum" };
  entropy.fill(0);
  return { ok: true, words };
}

/** Three distinct positions (0-based, in order) drawn from the platform's secure random source. */
export function wordCheckPositions(count: number, random: SecureRandom, n = WORD_CHECK_COUNT): number[] {
  if (!Number.isInteger(count) || count < n || count > 256) throw new RangeError("Bad word count.");
  const picked = new Set<number>();
  while (picked.size < n) picked.add(uniformIndex(count, random));
  return [...picked].sort((a, b) => a - b);
}

/** True when every answer is the word at its position (case and spaces ignored). */
export function wordCheckMatches(words: readonly string[], positions: readonly number[], answers: readonly string[]): boolean {
  if (!positions.length || answers.length !== positions.length) return false;
  return positions.every((p, i) => {
    const typed = splitPhrase(answers[i] ?? "");
    return typed.length === 1 && typed[0] === words[p];
  });
}

// --- The record ---------------------------------------------------------------------------------------------------

/**
 * One wallet per device. `sealed` is hex of iv(12) ‖ AES-256-GCM(entropy) ‖ tag(16), made in the worklet with the
 * wallet key and bound to `id`. Nothing in it opens without the Keystore key.
 */
export interface WalletRecord {
  v: 1;
  id: string;
  /** The EVM address at `path`, checksummed. Public. */
  address: string;
  path: typeof WALLET_NETWORK.path;
  chainId: typeof WALLET_NETWORK.chainId;
  sealed: string;
  words: RecoveryWordCount;
  source: "created" | "restored";
  createdAt: number;
  /** When the word check passed (created) or the words were typed (restored). Absent: the backup is still owed. */
  backedUpAt?: number;
}

const RECORD_KEYS = ["v", "id", "address", "path", "chainId", "sealed", "words", "source", "createdAt", "backedUpAt"];

export function serializeWalletRecord(r: WalletRecord): string {
  const out: Record<string, unknown> = { v: 1, id: r.id, address: r.address, path: r.path, chainId: r.chainId, sealed: r.sealed, words: r.words, source: r.source, createdAt: r.createdAt };
  if (r.backedUpAt !== undefined) out.backedUpAt = r.backedUpAt;
  return JSON.stringify(out);
}

/** Strict: an unknown field, another network or a blob of the wrong size reads as no record (fails closed). */
export function parseWalletRecord(text: string): WalletRecord | undefined {
  let o: unknown;
  try {
    o = JSON.parse(text);
  } catch {
    return undefined;
  }
  if (o === null || typeof o !== "object" || Array.isArray(o)) return undefined;
  const r = o as Record<string, unknown>;
  if (Object.keys(r).some((k) => !RECORD_KEYS.includes(k))) return undefined;
  if (r.v !== 1 || typeof r.id !== "string" || !r.id || r.id.length > 64) return undefined;
  if (typeof r.address !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(r.address)) return undefined;
  if (r.path !== WALLET_NETWORK.path || r.chainId !== WALLET_NETWORK.chainId) return undefined;
  if (r.words !== 12 && r.words !== 24) return undefined;
  if (typeof r.sealed !== "string" || !/^[0-9a-f]*$/.test(r.sealed) || r.sealed.length !== 2 * (12 + 16 + (r.words === 12 ? 16 : 32))) return undefined;
  if (r.source !== "created" && r.source !== "restored") return undefined;
  if (!Number.isSafeInteger(r.createdAt)) return undefined;
  if (r.backedUpAt !== undefined && !Number.isSafeInteger(r.backedUpAt)) return undefined;
  return r as unknown as WalletRecord;
}

/** What the signed log records for the wallet: a hash of its id, never the id, the address or anything secret. */
export const walletIdHash = (id: string) => sha256Hex(`hermit.wallet\u0000${id}`);
