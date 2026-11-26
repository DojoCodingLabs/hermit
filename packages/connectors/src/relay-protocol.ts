/**
 * The sign-in relay protocol, `hermit-relay-1` (FR-CONN-07, PDR-022, US-CONN-09, US-CONN-10). Shared by the phone
 * (`relay.ts`) and the reference relay (`apps/relay`), so both sides read and write the same bytes. Pure: no
 * network, no platform crypto, and no import from `@hermit/core`, so the relay runs it on Node as is.
 *
 * The flow, for a provider that needs a client secret (Slack, Notion, GitHub):
 * 1. The phone asks the relay which providers it serves (`GET /v1/providers`): their client IDs and its callback.
 * 2. The phone sends the relay its random state, its PKCE challenge (S256) and a public key it made for this one
 *    sign-in (`POST /v1/start`). The relay answers with a provider `state` that carries them, an expiry, and an HMAC
 *    under its seal key (`issueProviderState`). It stores nothing.
 * 3. The phone opens the provider's own authorization page (from the phone's provider table, never from the relay)
 *    with the relay's client ID, the relay's callback as `redirect_uri`, and that issued state.
 * 4. The provider sends the browser to the relay's callback. The relay accepts only a state it issued and that has
 *    not expired (`verifyProviderState`), seals the code together with that state's challenge, key and expiry
 *    (`sealCode`), and sends the browser on to `hermit://oauth/relay` with the sealed code and the phone's state.
 * 5. The phone checks its state, then posts the sealed code and its PKCE verifier (`POST /v1/token`). The relay opens
 *    the code, checks the verifier against the challenge, swaps the code for tokens with the client secret, and
 *    returns them encrypted to the phone's key for this sign-in (`sealTokens`). It keeps nothing afterwards.
 *
 * A code intercepted on the way back to the app is useless: it is sealed, bound to a challenge only this phone can
 * answer, and its tokens are encrypted to a key only this phone holds. A state the relay did not issue, an issued
 * state with another challenge or key spliced in, or an expired one gets no sealed code at all.
 *
 * What this does not cover: the provider's own code, between the provider and the relay's callback. Where the
 * provider supports PKCE, the relay sends it the same challenge, so the provider itself refuses that code without
 * this sign-in's verifier. Where it does not (Slack, Notion and GitHub in Hermit's table today), the code is a bearer
 * value until it is redeemed: whoever obtains the provider's raw code and a state the relay issued to them can pair
 * the two. Those providers rely on that code staying confidential (TLS to the relay, the relay's callback the only
 * registered redirect, a short expiry). The relay never logs or returns the raw code.
 *
 * Encryption: X25519 from `@noble/curves`, HKDF-SHA256, and an encrypt-then-MAC stream built on HMAC-SHA256 from
 * `@noble/hashes` (both already in the app). Each message gets fresh keys (an ephemeral X25519 key, or a random nonce
 * under the relay's key), so no keystream is ever reused. Q115 asks whether to move to XChaCha20-Poly1305 once
 * `@noble/ciphers` can be added.
 */
import { x25519 } from "@noble/curves/ed25519.js";
import { hkdf } from "@noble/hashes/hkdf.js";
import { hmac } from "@noble/hashes/hmac.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { concatBytes, utf8ToBytes } from "@noble/hashes/utils.js";
import { base64url } from "./secret.ts";

export { base64url };

export const RELAY_PROTOCOL = "hermit-relay-1";
/** Where the relay sends the browser back to: the app's own route (Q117). */
export const RELAY_REDIRECT_URI = "hermit://oauth/relay";
export const RELAY_PATHS = { providers: "/v1/providers", start: "/v1/start", callback: "/v1/callback", token: "/v1/token" } as const;
/** How long a sign-in may take from opening the browser to the token exchange. */
export const RELAY_SIGN_IN_TTL_MS = 10 * 60_000;
/** A provider id as both sides write it. */
export const RELAY_PROVIDER_ID = /^[a-z][a-z0-9_]{0,31}$/;

/** Errors the relay answers with. Codes only: never a provider's text, a code or a token. */
export type RelayError =
  | "invalid_request"
  | "unknown_provider"
  | "expired"
  | "pkce_mismatch"
  | "redirect_mismatch"
  | "exchange_refused"
  | "upstream_unavailable"
  | "rate_limited"
  | "not_found"
  | "method_not_allowed";

export const RELAY_ERRORS: readonly RelayError[] = [
  "invalid_request", "unknown_provider", "expired", "pkce_mismatch", "redirect_mismatch", "exchange_refused", "upstream_unavailable", "rate_limited", "not_found", "method_not_allowed",
];

// ---------------------------------------------------------------------------------------------------------------
// Bytes

const B64URL = /^[A-Za-z0-9_-]*$/;
const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

/** Unpadded base64url to bytes. Undefined for any other character or an impossible length. */
export function fromBase64url(s: string): Uint8Array | undefined {
  if (typeof s !== "string" || !B64URL.test(s) || s.length % 4 === 1) return undefined;
  const out = new Uint8Array(Math.floor((s.length * 3) / 4));
  let bits = 0;
  let acc = 0;
  let j = 0;
  for (const c of s) {
    acc = (acc << 6) | ALPHABET.indexOf(c);
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[j++] = (acc >> bits) & 0xff;
    }
  }
  // Leftover bits must be zero, so every byte string has exactly one encoding.
  if (acc & ((1 << bits) - 1)) return undefined;
  return out;
}

/** Strict UTF-8 to text without TextDecoder (packages target plain ES2022). Undefined for invalid UTF-8. */
export function utf8FromBytes(bytes: Uint8Array): string | undefined {
  let escaped = "";
  for (const b of bytes) escaped += `%${b.toString(16).padStart(2, "0")}`;
  try {
    return decodeURIComponent(escaped);
  } catch {
    return undefined;
  }
}

/** Constant-time comparison for equal-length byte strings. */
export function equalBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= (a[i] as number) ^ (b[i] as number);
  return diff === 0;
}

/** Constant-time comparison for strings (state, challenge): their length is not a secret. */
export function equalText(a: string, b: string): boolean {
  return equalBytes(utf8ToBytes(a), utf8ToBytes(b));
}

const u32 = (n: number) => Uint8Array.of((n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff);
const MAX_MESSAGE = 65_536;
const TAG = 32;

/** XOR with an HMAC-SHA256 keystream (counter mode). The key is unique per message. */
function stream(encKey: Uint8Array, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(data.length);
  for (let block = 0; block * 32 < data.length; block++) {
    const ks = hmac(sha256, encKey, u32(block));
    for (let i = 0; i < 32 && block * 32 + i < data.length; i++) out[block * 32 + i] = (data[block * 32 + i] as number) ^ (ks[i] as number);
  }
  return out;
}

const macInput = (aad: Uint8Array, ct: Uint8Array) => concatBytes(u32(aad.length), aad, ct);

function etmSeal(keys: Uint8Array, plaintext: Uint8Array, aad: Uint8Array): Uint8Array {
  if (plaintext.length > MAX_MESSAGE) throw new Error("relay message too large");
  const ct = stream(keys.subarray(0, 32), plaintext);
  return concatBytes(ct, hmac(sha256, keys.subarray(32, 64), macInput(aad, ct)));
}

function etmOpen(keys: Uint8Array, sealed: Uint8Array, aad: Uint8Array): Uint8Array | undefined {
  if (sealed.length < TAG || sealed.length > MAX_MESSAGE + TAG) return undefined;
  const ct = sealed.subarray(0, sealed.length - TAG);
  const tag = sealed.subarray(sealed.length - TAG);
  if (!equalBytes(tag, hmac(sha256, keys.subarray(32, 64), macInput(aad, ct)))) return undefined;
  return stream(keys.subarray(0, 32), ct);
}

export interface RelayKeyPair {
  secretKey: Uint8Array;
  publicKey: Uint8Array;
}

/** The phone's key for one sign-in, from 32 bytes of the platform's secure random source. */
export function relayKeyPair(random32: Uint8Array): RelayKeyPair {
  if (random32.length !== 32) throw new Error("a relay key needs 32 random bytes");
  const secretKey = Uint8Array.from(random32);
  return { secretKey, publicKey: x25519.getPublicKey(secretKey) };
}

const TOKENS_INFO = utf8ToBytes(`${RELAY_PROTOCOL}/tokens`);

/** The relay encrypts to the phone's public key: an ephemeral X25519 key, then HKDF, then encrypt-then-MAC. */
export function sealForPhone(phonePublicKey: Uint8Array, plaintext: Uint8Array, aad: Uint8Array, ephemeral32: Uint8Array): Uint8Array {
  const eph = relayKeyPair(ephemeral32);
  const shared = x25519.getSharedSecret(eph.secretKey, phonePublicKey);
  const keys = hkdf(sha256, shared, concatBytes(eph.publicKey, phonePublicKey), TOKENS_INFO, 64);
  return concatBytes(eph.publicKey, etmSeal(keys, plaintext, aad));
}

/** The phone opens what the relay sealed for it. Undefined for anything else, including a single changed bit. */
export function openFromRelay(secretKey: Uint8Array, sealed: Uint8Array, aad: Uint8Array): Uint8Array | undefined {
  if (sealed.length < 32 + TAG) return undefined;
  try {
    const epk = sealed.subarray(0, 32);
    const shared = x25519.getSharedSecret(secretKey, epk);
    const keys = hkdf(sha256, shared, concatBytes(epk, x25519.getPublicKey(secretKey)), TOKENS_INFO, 64);
    return etmOpen(keys, sealed.subarray(32), aad);
  } catch {
    return undefined;
  }
}

/** The relay's own seal (codes in flight), under the key from its environment. `nonce24` is fresh random bytes. */
export function sealWithKey(key: Uint8Array, purpose: string, plaintext: Uint8Array, aad: Uint8Array, nonce24: Uint8Array): Uint8Array {
  if (key.length < 32) throw new Error("the relay's seal key needs at least 32 bytes");
  if (nonce24.length !== 24) throw new Error("a seal needs a 24-byte nonce");
  const keys = hkdf(sha256, key, nonce24, utf8ToBytes(`${RELAY_PROTOCOL}/${purpose}`), 64);
  return concatBytes(nonce24, etmSeal(keys, plaintext, aad));
}

export function openSealed(key: Uint8Array, purpose: string, sealed: Uint8Array, aad: Uint8Array): Uint8Array | undefined {
  if (key.length < 32 || sealed.length < 24 + TAG) return undefined;
  const nonce = sealed.subarray(0, 24);
  const keys = hkdf(sha256, key, nonce, utf8ToBytes(`${RELAY_PROTOCOL}/${purpose}`), 64);
  return etmOpen(keys, sealed.subarray(24), aad);
}

/** PKCE S256 (RFC 7636): the verifier is 43 to 128 unreserved characters, and its SHA-256 is the challenge. */
export function verifierMatches(verifier: string, challenge: string): boolean {
  if (typeof verifier !== "string" || !/^[A-Za-z0-9\-._~]{43,128}$/.test(verifier)) return false;
  return equalText(base64url(sha256(utf8ToBytes(verifier))), challenge);
}

// ---------------------------------------------------------------------------------------------------------------
// JSON

const FORBIDDEN = new Set(["__proto__", "constructor", "prototype"]);
type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);

/** JSON from the other side, as a plain object; a key that names the prototype chain refuses the whole message. */
export function parseRelayJson(text: string): Obj | undefined {
  let bad = false;
  let value: unknown;
  try {
    value = JSON.parse(text, (k, v: unknown) => {
      if (FORBIDDEN.has(k)) bad = true;
      return v;
    });
  } catch {
    return undefined;
  }
  return !bad && isObj(value) ? value : undefined;
}

const exactKeys = (o: Obj, keys: readonly string[]) => Object.keys(o).length === keys.length && keys.every((k) => Object.hasOwn(o, k));
const strField = (o: Obj, k: string) => (Object.hasOwn(o, k) && typeof o[k] === "string" ? (o[k] as string) : undefined);

// ---------------------------------------------------------------------------------------------------------------
// Messages

/** What the phone puts in the provider's `state`: its own state, the PKCE challenge and its public key. All public. */
export interface ProviderState {
  provider: string;
  /** The phone's random state, 24 bytes. */
  state: string;
  /** base64url(SHA-256(verifier)). */
  challenge: string;
  /** The phone's X25519 public key for this sign-in. */
  key: string;
}

const B64_24 = /^[A-Za-z0-9_-]{32}$/;
const B64_32 = /^[A-Za-z0-9_-]{43}$/;
const EXP = /^[0-9a-z]{1,10}$/;

/** A provider state the relay issued (`POST /v1/start`): the phone's values, an expiry and the relay's MAC over both. */
export interface IssuedState extends ProviderState {
  /** Epoch ms, whole seconds. */
  expiresAt: number;
  mac: string;
}

const STATE_MAC_INFO = utf8ToBytes(`${RELAY_PROTOCOL}/start`);
const stateMac = (sealKey: Uint8Array, signed: string) => base64url(hmac(sha256, hkdf(sha256, sealKey, undefined, STATE_MAC_INFO, 32), utf8ToBytes(signed)));
const signedPart = (s: ProviderState, expSeconds: string) => `h2.${s.provider}.${s.state}.${s.challenge}.${s.key}.${expSeconds}`;

const wellFormed = (s: ProviderState) =>
  RELAY_PROVIDER_ID.test(s.provider) && B64_24.test(s.state) && B64_32.test(s.challenge) && B64_32.test(s.key) && Boolean(fromBase64url(s.state) && fromBase64url(s.challenge) && fromBase64url(s.key));

/**
 * The relay issues the provider `state` for one sign-in: the phone's state, challenge and key, an expiry, and an HMAC
 * under the relay's seal key over all of them. The callback accepts only a state this relay issued and that has not
 * expired, and binds the sealed code to exactly that challenge and key.
 */
export function issueProviderState(sealKey: Uint8Array, s: ProviderState, expiresAt: number): string {
  const signed = signedPart(s, Math.floor(expiresAt / 1000).toString(36));
  return `${signed}.${stateMac(sealKey, signed)}`;
}

/** The shape only (no MAC check): the phone reads back what the relay issued; the relay always calls `verifyProviderState`. */
export function parseProviderState(raw: string): IssuedState | undefined {
  if (typeof raw !== "string" || raw.length > 320) return undefined;
  const parts = raw.split(".");
  if (parts.length !== 7 || parts[0] !== "h2") return undefined;
  const [, provider, state, challenge, key, exp, mac] = parts as [string, string, string, string, string, string, string];
  const s = { provider, state, challenge, key };
  if (!wellFormed(s) || !EXP.test(exp) || !B64_32.test(mac)) return undefined;
  return { ...s, expiresAt: parseInt(exp, 36) * 1000, mac };
}

/** The relay's check at the callback: issued by this relay (MAC in constant time), well formed, not expired. */
export function verifyProviderState(sealKey: Uint8Array, raw: string, now: number): { ok: true; state: IssuedState } | { ok: false; error: "invalid_request" | "expired" } {
  const s = parseProviderState(raw);
  if (!s) return { ok: false, error: "invalid_request" };
  const signed = raw.slice(0, raw.lastIndexOf("."));
  if (!equalText(stateMac(sealKey, signed), s.mac)) return { ok: false, error: "invalid_request" };
  if (now > s.expiresAt) return { ok: false, error: "expired" };
  return { ok: true, state: s };
}

const START_KEYS = ["protocol", "provider", "state", "challenge", "key"] as const;

/** `POST /v1/start`: the phone's state, PKCE challenge and public key for one sign-in. All public values. */
export function startRequestBody(s: ProviderState): string {
  return JSON.stringify({ protocol: RELAY_PROTOCOL, provider: s.provider, state: s.state, challenge: s.challenge, key: s.key });
}

export function parseStartRequest(text: string): ProviderState | undefined {
  const o = parseRelayJson(text);
  if (!o || !exactKeys(o, START_KEYS) || o.protocol !== RELAY_PROTOCOL) return undefined;
  const [provider, state, challenge, key] = (["provider", "state", "challenge", "key"] as const).map((k) => strField(o, k) ?? "");
  const s = { provider: provider!, state: state!, challenge: challenge!, key: key! };
  return wellFormed(s) ? s : undefined;
}

/** What the relay seals into the code it hands the browser: enough to finish this one sign-in, and only that. */
export interface CodeClaims extends ProviderState {
  /** The provider's authorization code. */
  code: string;
  /** Epoch ms. */
  expiresAt: number;
}

const CODE_AAD = utf8ToBytes(`${RELAY_PROTOCOL}/code`);

export function sealCode(sealKey: Uint8Array, claims: CodeClaims, nonce24: Uint8Array): string {
  const body = { p: claims.provider, s: claims.state, c: claims.challenge, k: claims.key, x: claims.expiresAt, code: claims.code };
  return base64url(sealWithKey(sealKey, "code", utf8ToBytes(JSON.stringify(body)), CODE_AAD, nonce24));
}

export function openCode(sealKey: Uint8Array, sealed: string, now: number): { ok: true; claims: CodeClaims } | { ok: false; error: "invalid_request" | "expired" } {
  const bytes = typeof sealed === "string" && sealed.length <= 8192 ? fromBase64url(sealed) : undefined;
  const plain = bytes && openSealed(sealKey, "code", bytes, CODE_AAD);
  const o = plain && parseRelayJson(utf8FromBytes(plain) ?? "");
  if (!o) return { ok: false, error: "invalid_request" };
  const [p, s, c, k, code] = [strField(o, "p"), strField(o, "s"), strField(o, "c"), strField(o, "k"), strField(o, "code")];
  const x = o.x;
  if (!p || !s || !c || !k || !code || typeof x !== "number") return { ok: false, error: "invalid_request" };
  if (now > x) return { ok: false, error: "expired" };
  return { ok: true, claims: { provider: p, state: s, challenge: c, key: k, code, expiresAt: x } };
}

/** `POST /v1/token`: the sealed code, the verifier and the redirect the provider saw (the relay's callback). */
export interface TokenRequest {
  protocol: typeof RELAY_PROTOCOL;
  provider: string;
  code: string;
  code_verifier: string;
  redirect_uri: string;
}

const TOKEN_REQUEST_KEYS = ["protocol", "provider", "code", "code_verifier", "redirect_uri"] as const;

export function tokenRequestBody(r: Omit<TokenRequest, "protocol">): string {
  return JSON.stringify({ protocol: RELAY_PROTOCOL, provider: r.provider, code: r.code, code_verifier: r.code_verifier, redirect_uri: r.redirect_uri });
}

/** Reads a token request strictly: every field present and well formed, nothing else. */
export function parseTokenRequest(text: string): TokenRequest | undefined {
  const o = parseRelayJson(text);
  if (!o || !exactKeys(o, TOKEN_REQUEST_KEYS)) return undefined;
  const [protocol, provider, code, verifier, redirect] = TOKEN_REQUEST_KEYS.map((k) => strField(o, k));
  if (protocol !== RELAY_PROTOCOL || !provider || !RELAY_PROVIDER_ID.test(provider)) return undefined;
  if (!code || code.length > 8192 || !B64URL.test(code)) return undefined;
  if (!verifier || !/^[A-Za-z0-9\-._~]{43,128}$/.test(verifier)) return undefined;
  if (!redirect || redirect.length > 2048) return undefined;
  return { protocol, provider, code, code_verifier: verifier, redirect_uri: redirect };
}

/** The OAuth fields the phone gets back. Anything else a provider sends (team names, user ids) stays behind. */
export interface RelayTokens {
  access_token: string;
  token_type?: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
  id_token?: string;
}

/** A provider's token answer, reduced to the OAuth fields. Undefined for an error (Slack answers `ok: false`). */
export function normalizeProviderTokens(json: unknown): RelayTokens | undefined {
  if (!isObj(json) || json.ok === false) return undefined;
  const access = strField(json, "access_token");
  if (!access) return undefined;
  const out: RelayTokens = { access_token: access };
  for (const k of ["token_type", "refresh_token", "scope", "id_token"] as const) {
    const v = strField(json, k);
    if (v) out[k] = v;
  }
  if (typeof json.expires_in === "number" && Number.isFinite(json.expires_in) && json.expires_in > 0) out.expires_in = json.expires_in;
  return out;
}

/** What the phone finds inside the sealed answer. */
export interface TokenEnvelope {
  protocol: typeof RELAY_PROTOCOL;
  provider: string;
  clientId: string;
  state: string;
  tokens: RelayTokens;
}

const tokensAad = (key: string) => utf8ToBytes(`${RELAY_PROTOCOL}/tokens/${key}`);

/** The relay seals the tokens to the key the phone made for this sign-in. Undefined when that key is unusable. */
export function sealTokens(input: { provider: string; clientId: string; state: string; key: string; tokens: RelayTokens }, ephemeral32: Uint8Array): string | undefined {
  const pub = B64_32.test(input.key) ? fromBase64url(input.key) : undefined;
  if (!pub || pub.length !== 32) return undefined;
  const envelope: TokenEnvelope = { protocol: RELAY_PROTOCOL, provider: input.provider, clientId: input.clientId, state: input.state, tokens: input.tokens };
  try {
    return base64url(sealForPhone(pub, utf8ToBytes(JSON.stringify(envelope)), tokensAad(input.key), ephemeral32));
  } catch {
    return undefined;
  }
}

/** The phone opens the sealed answer with its secret key. Undefined when it doesn't open or isn't an envelope. */
export function openTokens(secretKey: Uint8Array, sealed: string): TokenEnvelope | undefined {
  const bytes = typeof sealed === "string" && sealed.length <= 100_000 ? fromBase64url(sealed) : undefined;
  if (!bytes) return undefined;
  let key: string;
  try {
    key = base64url(x25519.getPublicKey(secretKey));
  } catch {
    return undefined;
  }
  const plain = openFromRelay(secretKey, bytes, tokensAad(key));
  const o = plain && parseRelayJson(utf8FromBytes(plain) ?? "");
  if (!o || o.protocol !== RELAY_PROTOCOL || !isObj(o.tokens)) return undefined;
  const [provider, clientId, state] = [strField(o, "provider"), strField(o, "clientId"), strField(o, "state")];
  const tokens = normalizeProviderTokens(o.tokens);
  if (!provider || !clientId || !state || !tokens) return undefined;
  return { protocol: RELAY_PROTOCOL, provider, clientId, state, tokens };
}

/** `GET /v1/providers`: what a relay serves. Client IDs are public; secrets never leave the relay's environment. */
export interface RelayProvidersDoc {
  protocol: typeof RELAY_PROTOCOL;
  callback: string;
  providers: Array<{ id: string; clientId: string }>;
}
