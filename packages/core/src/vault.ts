import { bytesToHex, hexToBytes, utf8ToBytes } from "@noble/hashes/utils.js";
import { normalizeOrigin, type LoginIndexEntry } from "./autofill-origin.ts";
import { sha256Hex } from "./canonical.ts";
import type { SqlPort } from "./ports.ts";

/**
 * SL-33 (US-VAULT-01, US-VAULT-02, US-VAULT-04, FR-VAULT-01, FR-VAULT-02): the vault's pure parts.
 *
 * Envelope encryption: every item's username, secret and notes are sealed (AES-256-GCM) with the vault key, a random
 * 32-byte data key that is separate from the database key. The vault key is stored only wrapped by an Android Keystore
 * key that needs a strong biometric for every use (`VaultKeyPort`), so the database alone never opens an item.
 * Each sealed blob is bound to its item id (the GCM additional data), so a blob moved to another row fails to open.
 *
 * Names and origins stay readable in the (SQLCipher) database: they are what lists the items and, in a later slice,
 * what the model may see (FR-VAULT-02). Secrets are never returned by anything here except `openItem`.
 */

/** US-VAULT-02: a revealed secret hides again after this long (the product rule). */
export const VAULT_REVEAL_MS = 30_000;

/** Q82: a copied secret is cleared from the clipboard after this long (conservative, the same as the reveal). */
export const VAULT_CLIPBOARD_CLEAR_MS = 30_000;

/** The SecureStore entry and the Keystore service that hold the wrapped vault key (and nothing else). */
export const VAULT_KEY = { key: "hermit.vault.key.v1", service: "hermit.vault" } as const;

export const VAULT_KEY_BYTES = 32;

/** AES-256-GCM: the app adapter is expo-crypto's native AES, the tests use WebCrypto. Sealed = iv(12) ‖ ciphertext ‖ tag(16). */
export interface VaultCipherPort {
  seal(key: Uint8Array, plaintext: Uint8Array, aad: Uint8Array): Promise<Uint8Array>;
  /** Throws when the key, the additional data or the blob is wrong. */
  open(key: Uint8Array, sealed: Uint8Array, aad: Uint8Array): Promise<Uint8Array>;
}

export type VaultUnwrap = { kind: "key"; key: Uint8Array } | { kind: "cancelled" } | { kind: "lost" };

/**
 * The Keystore-wrapped vault key. `unwrap` shows the strong-biometric prompt every time it is called (the Keystore key
 * is authentication-bound per use), so every reveal, copy and save is a fresh fingerprint. The key is never exported.
 */
export interface VaultKeyPort {
  /** A wrapped key is stored, without prompting. */
  exists(): Promise<boolean>;
  /** Wraps and stores `key` (replacing any old one); the prompt is shown by the wrap itself. */
  store(key: Uint8Array, prompt: string): Promise<"stored" | "cancelled" | "unavailable">;
  /** "lost": the Keystore key was invalidated (new fingerprints enrolled) or the entry is gone. */
  unwrap(prompt: string): Promise<VaultUnwrap>;
  /** Deletes the wrapped key and destroys the Keystore key that wrapped it. Succeeds when already gone. */
  destroy(): Promise<void>;
}

/** The secret parts of an item. Only `openItem` produces one; nothing logs, audits or prompts with it. */
export interface VaultSecrets {
  username: string;
  secret: string;
  notes: string;
}

/** What may be listed without a fingerprint: no username, no secret, no notes. */
export interface VaultEntry {
  id: string;
  name: string;
  /** Exact origins, "https://host" or "https://host:port". */
  origins: string[];
  createdAt: number;
  updatedAt: number;
}

export interface VaultItemInput extends VaultSecrets {
  name: string;
  /** As typed: one address per entry; each is reduced to its exact origin. */
  origins: string[];
}

export type VaultProblem = "name_missing" | "name_too_long" | "secret_missing" | "origins_missing" | "origin_invalid" | "origin_not_https" | "too_long";

// --- Exact origins (US-VAULT-02: scheme, host and port) -----------------------------------------------------------

export type OriginResult = { ok: true; origin: string } | { ok: false; problem: "origin_invalid" | "origin_not_https" };

const ORIGIN_RE = /^([a-z][a-z0-9+.-]*):\/\/([^/?#\s]+)([/?#][^\s]*)?$/i;
const LABEL = "[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?";
const HOST_RE = new RegExp(`^(?=.{1,253}$)${LABEL}(?:\\.${LABEL})*$`);
const IPV4_RE = /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/;
const APP_ORIGIN_RE = /^android:\/\/([^@/?#\s]+)@([^/?#\s]+)\/?$/i;

/**
 * The exact origin of an address the user typed, in the canonical form of `normalizeOrigin` (autofill-origin.ts, SL-20),
 * so the autofill service (SL-35, SL-36) compares stored origins as they are: https only (Q84) or an exact app identity (SL-36, Q113), lowercase host, the default port dropped, any path,
 * query or fragment dropped. No URL API (React Native's is incomplete). Credentials in the address, non-ASCII hosts
 * (a lookalike can hide there) and anything that isn't a host name or an IPv4 address are refused.
 */
export function parseOrigin(raw: string): OriginResult {
  const text = raw.trim();
  // SL-36: an app's login is stored by the app's exact identity, `android://<cert>@<package>` (the SHA-256 of its
  // signing certificate in base64url, as HM-FORM-01 and the autofill debug screen show it). A package name alone is
  // never an identity, and nothing is guessed: anything but that exact form is refused.
  if (/^android:\/\//i.test(text)) {
    const app = APP_ORIGIN_RE.exec(text);
    const origin = app ? normalizeOrigin(`android://${app[1]}@${app[2]}`) : undefined;
    return origin ? { ok: true, origin } : { ok: false, problem: "origin_invalid" };
  }
  const m = ORIGIN_RE.exec(text);
  if (!m) return { ok: false, problem: "origin_invalid" };
  if (m[1]!.toLowerCase() !== "https") return { ok: false, problem: m[1]!.toLowerCase() === "http" ? "origin_not_https" : "origin_invalid" };
  const authority = m[2]!;
  if (authority.includes("@")) return { ok: false, problem: "origin_invalid" };
  const hp = /^([^:]+)(?::(\d{1,5}))?$/.exec(authority);
  if (!hp) return { ok: false, problem: "origin_invalid" };
  const host = hp[1]!.toLowerCase().replace(/\.$/, "");
  if (!HOST_RE.test(host) && !IPV4_RE.test(host)) return { ok: false, problem: "origin_invalid" };
  if (/^[\d.]+$/.test(host) && !IPV4_RE.test(host)) return { ok: false, problem: "origin_invalid" };
  // A leading zero is refused, as autofill's normalizeOrigin refuses it (SL-20), so both agree on every stored origin.
  if (hp[2]?.startsWith("0")) return { ok: false, problem: "origin_invalid" };
  const port = hp[2] === undefined ? 443 : Number(hp[2]);
  if (!Number.isInteger(port) || port < 1 || port > 65535) return { ok: false, problem: "origin_invalid" };
  return { ok: true, origin: port === 443 ? `https://${host}` : `https://${host}:${port}` };
}

// --- Validation ---------------------------------------------------------------------------------------------------

export const VAULT_LIMITS = { name: 120, field: 4_000, origins: 20 } as const;

export type VaultValidation = { ok: true; name: string; origins: string[]; secrets: VaultSecrets } | { ok: false; problems: VaultProblem[] };

/** Trims the name, reduces each origin to its exact origin (duplicates dropped), keeps the secret exactly as typed. */
export function validateItem(input: VaultItemInput): VaultValidation {
  const problems = new Set<VaultProblem>();
  const name = input.name.trim();
  if (!name) problems.add("name_missing");
  if (name.length > VAULT_LIMITS.name) problems.add("name_too_long");
  if (!input.secret) problems.add("secret_missing");
  if ([input.username, input.secret, input.notes].some((f) => f.length > VAULT_LIMITS.field)) problems.add("too_long");
  const origins: string[] = [];
  const typed = input.origins.map((o) => o.trim()).filter(Boolean);
  if (!typed.length) problems.add("origins_missing");
  if (typed.length > VAULT_LIMITS.origins) problems.add("too_long");
  for (const o of typed) {
    const r = parseOrigin(o);
    if (!r.ok) problems.add(r.problem);
    else if (!origins.includes(r.origin)) origins.push(r.origin);
  }
  if (problems.size) return { ok: false, problems: [...problems] };
  return { ok: true, name, origins, secrets: { username: input.username.trim(), secret: input.secret, notes: input.notes } };
}

// --- Sealing ------------------------------------------------------------------------------------------------------

/** The additional data binding a sealed blob to its row: a blob copied onto another item fails to open. */
export const itemAad = (id: string) => utf8ToBytes(`hermit.vault.item.v1\u0000${id}`);
const CHECK_AAD = utf8ToBytes("hermit.vault.check.v1");
const CHECK_TEXT = "hermit vault key check v1";

/** UTF-8 decoding without TextDecoder (not on every React Native engine). Throws on malformed input. */
export function utf8Decode(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; ) {
    const b = bytes[i]!;
    let cp: number;
    let extra: number;
    if (b < 0x80) [cp, extra] = [b, 0];
    else if (b >= 0xc2 && b < 0xe0) [cp, extra] = [b & 0x1f, 1];
    else if (b >= 0xe0 && b < 0xf0) [cp, extra] = [b & 0x0f, 2];
    else if (b >= 0xf0 && b < 0xf5) [cp, extra] = [b & 0x07, 3];
    else throw new Error("Malformed UTF-8.");
    for (let k = 1; k <= extra; k++) {
      const c = bytes[i + k];
      if (c === undefined || (c & 0xc0) !== 0x80) throw new Error("Malformed UTF-8.");
      cp = (cp << 6) | (c & 0x3f);
    }
    if ((extra === 2 && (cp < 0x800 || (cp >= 0xd800 && cp <= 0xdfff))) || (extra === 3 && (cp < 0x10000 || cp > 0x10ffff))) throw new Error("Malformed UTF-8.");
    out += String.fromCodePoint(cp);
    i += extra + 1;
  }
  return out;
}

export async function sealSecrets(cipher: VaultCipherPort, key: Uint8Array, id: string, secrets: VaultSecrets): Promise<string> {
  const plain = utf8ToBytes(JSON.stringify({ v: 1, u: secrets.username, s: secrets.secret, n: secrets.notes }));
  try {
    return bytesToHex(await cipher.seal(key, plain, itemAad(id)));
  } finally {
    plain.fill(0);
  }
}

export async function openSecrets(cipher: VaultCipherPort, key: Uint8Array, id: string, sealed: string): Promise<VaultSecrets> {
  const plain = await cipher.open(key, hexToBytes(sealed), itemAad(id));
  try {
    const o = JSON.parse(utf8Decode(plain)) as { v: number; u: string; s: string; n: string };
    if (o.v !== 1 || typeof o.u !== "string" || typeof o.s !== "string" || typeof o.n !== "string") throw new Error("Unknown vault item format.");
    return { username: o.u, secret: o.s, notes: o.n };
  } finally {
    plain.fill(0);
  }
}

/** A sealed known text, stored with the vault, that proves an unwrapped key is this vault's key. */
export async function keyCheck(cipher: VaultCipherPort, key: Uint8Array): Promise<string> {
  return bytesToHex(await cipher.seal(key, utf8ToBytes(CHECK_TEXT), CHECK_AAD));
}

export async function keyMatches(cipher: VaultCipherPort, key: Uint8Array, check: string): Promise<boolean> {
  try {
    return utf8Decode(await cipher.open(key, hexToBytes(check), CHECK_AAD)) === CHECK_TEXT;
  } catch {
    return false;
  }
}

/** What the signed log records for an item: a hash of its id, never the id, the name or anything secret. */
export const vaultItemHash = (id: string) => sha256Hex(`hermit.vault.item\u0000${id}`);

/**
 * SL-36: the index Android's autofill service reads to offer a login before anything is approved. Each item by its
 * id hash, its name and its exact origins (FR-VAULT-02 treats names and origins as non-secret); an item with no
 * usable origin is left out. Built from list entries, which carry no username, password or note.
 */
export function loginIndex(entries: readonly VaultEntry[]): LoginIndexEntry[] {
  const out: LoginIndexEntry[] = [];
  for (const e of entries) {
    const origins = [...new Set(e.origins.map((o) => normalizeOrigin(o)).filter((o): o is string => o !== undefined))];
    if (origins.length) out.push({ ref: vaultItemHash(e.id), name: e.name, origins });
  }
  return out;
}

// --- Storage ------------------------------------------------------------------------------------------------------

interface ItemRow { id: string; name: string; origins: string; sealed: string; created_at: number; updated_at: number }

const entryOf = (r: ItemRow): VaultEntry => ({ id: r.id, name: r.name, origins: JSON.parse(r.origins) as string[], createdAt: r.created_at, updatedAt: r.updated_at });

/** ENT-VaultItem (`vault_items`) and the vault's key check (`vault_meta`), migration 12. */
export function createVaultStore(sql: SqlPort) {
  return {
    async keyCheck(): Promise<string | undefined> {
      const [row] = await sql.query<{ key_check: string }>("SELECT key_check FROM vault_meta WHERE id = 1");
      return row?.key_check;
    },
    async setKeyCheck(check: string, at: number): Promise<void> {
      await sql.exec(
        "INSERT INTO vault_meta (id, version, key_check, created_at) VALUES (1, 1, ?, ?) ON CONFLICT(id) DO UPDATE SET key_check = excluded.key_check, created_at = excluded.created_at",
        [check, at],
      );
    },
    async list(): Promise<VaultEntry[]> {
      return (await sql.query<ItemRow>("SELECT id, name, origins, created_at, updated_at, '' AS sealed FROM vault_items ORDER BY name COLLATE NOCASE, id")).map(entryOf);
    },
    async entry(id: string): Promise<VaultEntry | undefined> {
      const [row] = await sql.query<ItemRow>("SELECT id, name, origins, created_at, updated_at, '' AS sealed FROM vault_items WHERE id = ?", [id]);
      return row ? entryOf(row) : undefined;
    },
    async sealed(id: string): Promise<string | undefined> {
      const [row] = await sql.query<{ sealed: string }>("SELECT sealed FROM vault_items WHERE id = ?", [id]);
      return row?.sealed;
    },
    /** Inserts or replaces the item stored under exactly `id`, the id its blob was sealed for. */
    async put(item: { id: string; name: string; origins: string[]; sealed: string }, at: number): Promise<void> {
      await sql.exec(
        `INSERT INTO vault_items (id, name, origins, sealed, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET name = excluded.name, origins = excluded.origins, sealed = excluded.sealed, updated_at = excluded.updated_at`,
        [item.id, item.name, JSON.stringify(item.origins), item.sealed, at, at],
      );
    },
    /** SL-34: several items in one transaction, so an import lands whole or not at all. */
    async putAll(items: readonly { id: string; name: string; origins: string[]; sealed: string }[], at: number): Promise<void> {
      await sql.transaction(async (tx) => {
        for (const item of items) {
          await tx.exec(
            `INSERT INTO vault_items (id, name, origins, sealed, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)
             ON CONFLICT(id) DO UPDATE SET name = excluded.name, origins = excluded.origins, sealed = excluded.sealed, updated_at = excluded.updated_at`,
            [item.id, item.name, JSON.stringify(item.origins), item.sealed, at, at],
          );
        }
      });
    },
    async remove(id: string): Promise<boolean> {
      const before = await sql.query<{ n: number }>("SELECT COUNT(*) AS n FROM vault_items WHERE id = ?", [id]);
      await sql.exec("DELETE FROM vault_items WHERE id = ?", [id]);
      return (before[0]?.n ?? 0) > 0;
    },
    /**
     * Every item and the key check, in one transaction (a vault whose key was lost, before a fresh one). The profile's
     * sensitive fields go too (SL-35): they were sealed with the same key, so nothing can open them any more.
     */
    async wipe(): Promise<void> {
      await sql.transaction(async (tx) => {
        await tx.exec("DELETE FROM vault_items");
        await tx.exec("DELETE FROM vault_meta");
        await tx.exec("DELETE FROM profile_fields WHERE sensitive = 1");
      });
    },
  };
}

export type VaultStore = ReturnType<typeof createVaultStore>;

// --- Password generator (US-VAULT-04) -----------------------------------------------------------------------------

export interface GeneratorOptions {
  length: number;
  lower: boolean;
  upper: boolean;
  digits: boolean;
  symbols: boolean;
}

export const GENERATOR_LIMITS = { min: 8, max: 64 } as const;
export const GENERATOR_DEFAULTS: GeneratorOptions = { length: 20, lower: true, upper: true, digits: true, symbols: true };

export const CHARSETS = {
  lower: "abcdefghijklmnopqrstuvwxyz",
  upper: "ABCDEFGHIJKLMNOPQRSTUVWXYZ",
  digits: "0123456789",
  symbols: "!#$%&*+-=?@^_~.,:;()[]{}",
} as const;

/** The platform's secure random source: expo-crypto's getRandomBytes on the phone, crypto.getRandomValues in tests. */
export type SecureRandom = (n: number) => Uint8Array;

/**
 * A uniform index in [0, n) from secure random bytes, by rejection sampling: bytes at or above the largest multiple of n
 * that fits in a byte are thrown away, so `byte % n` has no modulo bias.
 */
export function uniformIndex(n: number, random: SecureRandom): number {
  if (!Number.isInteger(n) || n < 1 || n > 256) throw new RangeError("n must be an integer from 1 to 256.");
  const limit = 256 - (256 % n);
  for (;;) {
    const batch = random(16);
    for (const b of batch) if (b < limit) return b % n;
  }
}

/** Clamps the length and falls back to lowercase when every class is off, so the generator always produces something. */
export function normalizeGenerator(o: GeneratorOptions): GeneratorOptions {
  const length = Math.min(GENERATOR_LIMITS.max, Math.max(GENERATOR_LIMITS.min, Math.round(Number.isFinite(o.length) ? o.length : GENERATOR_DEFAULTS.length)));
  const any = o.lower || o.upper || o.digits || o.symbols;
  return { length, lower: any ? o.lower : true, upper: o.upper, digits: o.digits, symbols: o.symbols };
}

/**
 * A password of `length` characters drawn uniformly from the chosen classes, with at least one of each chosen class.
 * A draw missing a class is thrown away and drawn again (rejection again), which keeps every valid password equally likely.
 */
export function generatePassword(options: GeneratorOptions, random: SecureRandom): string {
  const o = normalizeGenerator(options);
  const sets = (["lower", "upper", "digits", "symbols"] as const).filter((k) => o[k]).map((k) => CHARSETS[k]);
  const alphabet = sets.join("");
  for (;;) {
    let out = "";
    for (let i = 0; i < o.length; i++) out += alphabet[uniformIndex(alphabet.length, random)];
    if (sets.every((s) => [...out].some((c) => s.includes(c)))) return out;
  }
}
