import { p256 } from "@noble/curves/nist.js";
import { bytesToHex, hexToBytes, utf8ToBytes } from "@noble/hashes/utils.js";
import {
  APPROVAL_KEY_ENROLL_DOMAIN, canonicalJson, sha256Hex, SIGNED_APPROVAL_DOMAIN,
  type ApprovalKeyPort, type SignedApprovalPayload, type SignedApprovalRequest, type SignedApprovalTerms, type SignedRisk, type SqlPort,
} from "@hermit/core";

/**
 * SL-37 (US-CAGE-03, FR-CAGE-06, ADR-007): approvals for spend and credential are ECDSA P-256 signatures by a
 * non-exportable Android Keystore key that needs a strong biometric for every single use. This file is the pure
 * half: the canonical payload, its verification with the key's public part, and the one-time nonces.
 *
 * The message the key signs is the domain on its own line, then the payload in canonical JSON. The native module
 * signs those exact UTF-8 bytes (SHA256withECDSA) inside a BiometricPrompt CryptoObject, so one fingerprint unlocks
 * one signature over one payload. Nothing here (payload, signature) ever reaches the model; the audit keeps hashes.
 */

/** FR-CAGE-03's product rule: an approval lives at most 2 minutes. A signed one can't be made to live longer. */
export const SIGNED_APPROVAL_MAX_TTL_MS = 120_000;

/** How far ahead of the phone's clock an approval may say it was issued (clock drift between JS and native). */
export const SIGNED_APPROVAL_SKEW_MS = 30_000;

/** The only asset Hermit pays in (PDR-027). */
const USDT = "USDT";

export type SignedApprovalRefusal = "not_usdt" | "no_amount" | "no_recipient" | "no_origin" | "bad_expiry" | "bad_nonce" | "bad_text";

export type SignedApprovalFailure = "no_signature" | "malformed" | "mismatch" | "not_usdt" | "expired" | "not_yet_valid" | "bad_signature";

/** What the call being approved is, as the loop knows it. The signed payload must say exactly this. */
export interface SignedApprovalExpected {
  risk: SignedRisk;
  skill: string;
  requestId: string;
  argsHash: string;
  terms: SignedApprovalTerms;
}

const HEX64 = /^[0-9a-f]{64}$/;

export function signedApprovalMessage(payload: SignedApprovalPayload): string {
  return `${SIGNED_APPROVAL_DOMAIN}\n${canonicalJson(payload)}`;
}

/** What the audit keeps of a signed approval: the SHA-256 of the exact message, never the payload. */
export function signedApprovalHash(message: string): string {
  return sha256Hex(message);
}

/**
 * Control characters, format characters (bidi overrides and isolates, zero-width marks) and line separators: they
 * could make the fingerprint prompt show something other than what is signed. The native prompt strips them too.
 */
const HIDDEN = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}\p{Co}\p{Cn}]/u;

function termsProblem(risk: SignedRisk, terms: SignedApprovalTerms): SignedApprovalRefusal | undefined {
  if (terms.amount && terms.amount.asset !== USDT) return "not_usdt";
  for (const text of [terms.recipient, terms.origin, terms.requester, terms.amount?.network]) if (text !== undefined && (HIDDEN.test(text) || !text.trim())) return "bad_text";
  // A login's item is its id hash, never a name or an id; only a credential carries an item or a requester.
  if (terms.item !== undefined && !HEX64.test(terms.item)) return "bad_text";
  if (risk !== "credential" && (terms.item !== undefined || terms.requester !== undefined)) return "bad_text";
  if (risk === "spend") {
    if (!terms.amount || terms.amount.amount <= 0n) return "no_amount";
    if (!terms.recipient) return "no_recipient";
  }
  if (risk === "credential" && !terms.origin) return "no_origin";
  return undefined;
}

/**
 * The payload and message for one approval. Refuses, before anything is asked: a non-USD₮ amount, a payment
 * without an amount or a recipient, a password without its site, an expiry past the 2 minute rule, a bad nonce.
 */
export function buildSignedApproval(input: SignedApprovalExpected & { nonce: string; now: number; expiresAt: number }):
  { ok: true; request: SignedApprovalRequest } | { ok: false; reason: SignedApprovalRefusal } {
  const problem = termsProblem(input.risk, input.terms);
  if (problem) return { ok: false, reason: problem };
  if (input.expiresAt <= input.now || input.expiresAt - input.now > SIGNED_APPROVAL_MAX_TTL_MS) return { ok: false, reason: "bad_expiry" };
  if (!HEX64.test(input.nonce)) return { ok: false, reason: "bad_nonce" };
  const { amount, recipient, origin, item, requester } = input.terms;
  const payload: SignedApprovalPayload = {
    domain: SIGNED_APPROVAL_DOMAIN, v: 1, risk: input.risk, skill: input.skill, requestId: input.requestId, argsHash: input.argsHash,
    nonce: input.nonce, issuedAt: input.now, expiresAt: input.expiresAt,
    ...(amount ? { amount: { value: amount.amount.toString(), asset: USDT, network: amount.network } } : {}),
    ...(recipient !== undefined ? { recipient } : {}),
    ...(origin !== undefined ? { origin } : {}),
    ...(item !== undefined ? { item } : {}),
    ...(requester !== undefined ? { requester } : {}),
  };
  return { ok: true, request: { payload, message: signedApprovalMessage(payload) } };
}

const REQUIRED: Record<string, "string" | "number"> = {
  domain: "string", v: "number", risk: "string", skill: "string", requestId: "string", argsHash: "string", nonce: "string",
  issuedAt: "number", expiresAt: "number",
};
const OPTIONAL: Record<string, "string" | "object"> = { amount: "object", recipient: "string", origin: "string", item: "string", requester: "string" };

/** The payload of a message, only if it is exactly the canonical form of a well-formed payload. */
function parseMessage(message: string): SignedApprovalPayload | undefined {
  const prefix = `${SIGNED_APPROVAL_DOMAIN}\n`;
  if (!message.startsWith(prefix)) return undefined;
  let raw: unknown;
  try {
    raw = JSON.parse(message.slice(prefix.length));
  } catch {
    return undefined;
  }
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return undefined;
  const o = raw as Record<string, unknown>;
  for (const [k, t] of Object.entries(REQUIRED)) if (typeof o[k] !== t) return undefined;
  for (const k of Object.keys(o)) {
    if (k in REQUIRED) continue;
    const t = OPTIONAL[k];
    if (!t || typeof o[k] !== t || o[k] === null) return undefined;
  }
  if (o.domain !== SIGNED_APPROVAL_DOMAIN || o.v !== 1 || (o.risk !== "spend" && o.risk !== "credential")) return undefined;
  if (!Number.isSafeInteger(o.issuedAt) || !Number.isSafeInteger(o.expiresAt) || !HEX64.test(o.nonce as string)) return undefined;
  if (o.item !== undefined && !HEX64.test(o.item as string)) return undefined;
  if (o.amount !== undefined) {
    const a = o.amount as Record<string, unknown>;
    if (Object.keys(a).sort().join() !== "asset,network,value") return undefined;
    if (typeof a.value !== "string" || !/^[1-9]\d*$/.test(a.value) || typeof a.asset !== "string" || typeof a.network !== "string") return undefined;
  }
  const payload = o as unknown as SignedApprovalPayload;
  // One encoding only: the bytes signed are the canonical form, so two messages can never mean the same approval.
  return signedApprovalMessage(payload) === message ? payload : undefined;
}

function matches(p: SignedApprovalPayload, e: SignedApprovalExpected): boolean {
  if (p.risk !== e.risk || p.skill !== e.skill || p.requestId !== e.requestId || p.argsHash !== e.argsHash) return false;
  const want = e.terms.amount;
  if (want ? !p.amount || p.amount.value !== want.amount.toString() || p.amount.asset !== want.asset || p.amount.network !== want.network : p.amount) return false;
  return p.recipient === e.terms.recipient && p.origin === e.terms.origin && p.item === e.terms.item && p.requester === e.terms.requester;
}

const P256_SPKI_PREFIX = "3059301306072a8648ce3d020106082a8648ce3d030107034200";

/** The raw uncompressed point of an X.509 SubjectPublicKeyInfo for a P-256 key (what Android's `getEncoded()` gives). */
export function publicKeyFromSpki(spkiHex: string): Uint8Array | undefined {
  const hex = spkiHex.toLowerCase();
  if (!/^[0-9a-f]+$/.test(hex) || !hex.startsWith(P256_SPKI_PREFIX) || hex.length !== P256_SPKI_PREFIX.length + 130) return undefined;
  const raw = hexToBytes(hex.slice(P256_SPKI_PREFIX.length));
  try {
    p256.Point.fromBytes(raw).assertValidity();
  } catch {
    return undefined;
  }
  return raw;
}

export function spkiFromPublicKey(raw: Uint8Array): string {
  return P256_SPKI_PREFIX + bytesToHex(raw);
}

function signatureValid(message: string, signatureHex: string, publicKey: Uint8Array): boolean {
  if (!/^[0-9a-f]+$/i.test(signatureHex) || signatureHex.length % 2) return false;
  try {
    // Android Keystore signs SHA256withECDSA in DER and doesn't normalize S: accept both halves.
    return p256.verify(hexToBytes(signatureHex), utf8ToBytes(message), publicKey, { prehash: true, format: "der", lowS: false });
  } catch {
    return false;
  }
}

/**
 * Valid only if the message is a canonical payload for exactly this call (risk, skill, request, args hash, the
 * USD₮ amount, recipient or site, and for a login the item's id hash and the requester), it hasn't expired and wasn't issued ahead of the clock, and the signature is the
 * key's. One-time use is the nonce store's job (`createSignedApprovals`).
 */
export function verifySignedApproval(input: {
  message: string;
  signature: string | undefined;
  publicKey: Uint8Array;
  expected: SignedApprovalExpected;
  now: number;
}): { ok: true; payload: SignedApprovalPayload } | { ok: false; reason: SignedApprovalFailure } {
  if (!input.signature) return { ok: false, reason: "no_signature" };
  const payload = parseMessage(input.message);
  if (!payload) return { ok: false, reason: "malformed" };
  if (payload.amount && payload.amount.asset !== USDT) return { ok: false, reason: "not_usdt" };
  if (!matches(payload, input.expected)) return { ok: false, reason: "mismatch" };
  if (payload.expiresAt - payload.issuedAt > SIGNED_APPROVAL_MAX_TTL_MS || payload.expiresAt <= payload.issuedAt) return { ok: false, reason: "malformed" };
  if (input.now >= payload.expiresAt) return { ok: false, reason: "expired" };
  if (payload.issuedAt > input.now + SIGNED_APPROVAL_SKEW_MS) return { ok: false, reason: "not_yet_valid" };
  if (!signatureValid(input.message, input.signature, input.publicKey)) return { ok: false, reason: "bad_signature" };
  return { ok: true, payload };
}

/** One-time nonces. `consume` is true only the first time a well-formed nonce is seen. */
export interface NonceStore {
  consume(nonce: string, expiresAt: number, now: number): Promise<boolean>;
}

export function memoryNonceStore(): NonceStore {
  const used = new Map<string, number>();
  return {
    async consume(nonce, expiresAt, now) {
      if (!HEX64.test(nonce)) return false;
      for (const [n, exp] of used) if (exp < now) used.delete(n);
      if (used.has(nonce)) return false;
      used.set(nonce, expiresAt);
      return true;
    },
  };
}

/** The nonce store in SQLite (migration 13). Survives restarts, so a replay after a kill is still a replay. */
export function createNonceStore(sql: SqlPort): NonceStore {
  return {
    consume(nonce, expiresAt, now) {
      if (!HEX64.test(nonce)) return Promise.resolve(false);
      return sql.transaction(async (tx) => {
        // An expired approval is refused by its expiry, so its nonce no longer needs keeping.
        await tx.exec("DELETE FROM approval_nonces WHERE expires_at < ?", [now - SIGNED_APPROVAL_SKEW_MS]);
        const seen = await tx.query<{ nonce: string }>("SELECT nonce FROM approval_nonces WHERE nonce = ?", [nonce]);
        if (seen.length) return false;
        await tx.exec("INSERT INTO approval_nonces (nonce, expires_at, used_at) VALUES (?, ?, ?)", [nonce, expiresAt, now]);
        return true;
      });
    },
  };
}

/** The enrollment proof's message: a random challenge the new key signs behind a fresh strong biometric. */
export function enrollmentMessage(challenge: string, at: number): string {
  return `${APPROVAL_KEY_ENROLL_DOMAIN}\n${canonicalJson({ at, challenge, domain: APPROVAL_KEY_ENROLL_DOMAIN })}`;
}

export function verifyEnrollment(message: string, signatureHex: string, spkiHex: string): boolean {
  const key = publicKeyFromSpki(spkiHex);
  return key !== undefined && message.startsWith(`${APPROVAL_KEY_ENROLL_DOMAIN}\n`) && signatureValid(message, signatureHex, key);
}

export type SignedApprovalBlock = "key_none" | "key_lost" | "no_biometric";

/** What the loop holds: it prepares the payload before the sheet opens and verifies the signature after. */
export interface SignedApprovals {
  prepare(input: SignedApprovalExpected & { expiresAt: number }): Promise<{ ok: true; request: SignedApprovalRequest } | { ok: false; reason: SignedApprovalBlock | SignedApprovalRefusal }>;
  verify(request: SignedApprovalRequest, signature: string | undefined, expected: SignedApprovalExpected):
    Promise<{ ok: true; payloadHash: string } | { ok: false; reason: SignedApprovalBlock | SignedApprovalFailure | "replayed" }>;
}

/**
 * `key` is the native module (read without a prompt); `enrolledKey` is the public key pinned at enrollment (a
 * setting). The Keystore's key must be the pinned one: a key that changed under the app is treated as lost.
 */
export function createSignedApprovals(deps: {
  key: Pick<ApprovalKeyPort, "state">;
  enrolledKey(): Promise<string | undefined>;
  nonces: NonceStore;
  randomNonce(): string;
  now(): number;
}): SignedApprovals {
  const usableKey = async (): Promise<{ ok: true; publicKey: Uint8Array } | { ok: false; reason: SignedApprovalBlock }> => {
    const [state, pinned] = await Promise.all([deps.key.state().catch(() => ({ state: "lost" as const })), deps.enrolledKey()]);
    if (state.state === "no_biometric") return { ok: false, reason: "no_biometric" };
    if (!pinned) return { ok: false, reason: "key_none" };
    // Enrolled, but the Keystore has no usable key now (retired by a fingerprint change, or deleted): lost.
    if (state.state !== "ready") return { ok: false, reason: "key_lost" };
    const publicKey = publicKeyFromSpki(state.publicKey);
    if (!publicKey || state.publicKey.toLowerCase() !== pinned.toLowerCase()) return { ok: false, reason: "key_lost" };
    return { ok: true, publicKey };
  };
  return {
    async prepare(input) {
      const key = await usableKey();
      if (!key.ok) return key;
      return buildSignedApproval({ ...input, nonce: deps.randomNonce(), now: deps.now() });
    },
    async verify(request, signature, expected) {
      const key = await usableKey();
      if (!key.ok) return key;
      const checked = verifySignedApproval({ message: request.message, signature, publicKey: key.publicKey, expected, now: deps.now() });
      if (!checked.ok) return checked;
      // Only a valid signature spends its nonce, so garbage can't burn a pending approval's.
      if (!(await deps.nonces.consume(checked.payload.nonce, checked.payload.expiresAt, deps.now()))) return { ok: false, reason: "replayed" };
      return { ok: true, payloadHash: signedApprovalHash(request.message) };
    },
  };
}
