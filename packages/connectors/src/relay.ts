/**
 * The phone's side of a relay sign-in (FR-CONN-07, US-CONN-09, US-CONN-10, PDR-022). The protocol is in
 * `relay-protocol.ts`; this file checks everything the relay and the provider send back before a token is kept:
 * the relay's address (an exact public HTTPS host), its callback (on its own origin), the state (constant time),
 * the PKCE binding (the relay refuses a code without this sign-in's verifier), the envelope (it must open with the
 * key made for this sign-in and name this provider, this client and this state), and the token's audience.
 * Tokens go only to the credential store; nothing returned from here carries one.
 */
import { sha256 } from "@noble/hashes/sha2.js";
import { utf8ToBytes } from "@noble/hashes/utils.js";
import type { CredentialMeta, CredentialSource, CredentialStorePort } from "@hermit/core";
import { parseHttpsUrl, type HttpsUrl } from "./mcp/url.ts";
import type { OAuthProvider } from "./oauth-providers.ts";
import {
  base64url,
  equalText,
  fromBase64url,
  openTokens,
  parseRelayJson,
  parseProviderState,
  RELAY_PATHS,
  RELAY_PROTOCOL,
  RELAY_PROVIDER_ID,
  RELAY_REDIRECT_URI,
  RELAY_SIGN_IN_TTL_MS,
  relayKeyPair,
  startRequestBody,
  tokenRequestBody,
  utf8FromBytes,
  type RelayError,
  type RelayTokens,
} from "./relay-protocol.ts";
import { Secret } from "./secret.ts";
import type { ConnectorRequest, ConnectorResponse, ConnectorTransport } from "./transport.ts";

export { RELAY_REDIRECT_URI, RELAY_PROTOCOL };
export type { RelayTokens };

export type RelayProblem =
  /** Not an https address on an exact public host (private, LAN and loopback hosts included). */
  | "bad_address"
  | "unreachable"
  /** Something answered, but not a Hermit relay. */
  | "not_a_relay"
  | "provider_not_offered"
  /** The provider takes a public client from the phone: no relay needed (PDR-022). */
  | "no_relay_needed"
  | "bad_callback"
  | "state_mismatch"
  | "denied"
  | "provider_error"
  | "expired"
  | "already_used"
  | "pkce_mismatch"
  | "exchange_refused"
  | "rate_limited"
  /** The relay's answer didn't open with this sign-in's key, or named another sign-in. */
  | "tampered"
  /** Tokens for another provider or another client. */
  | "wrong_client"
  /** An ID token or JWT access token issued to someone else. */
  | "wrong_audience"
  | "not_bearer"
  | "failed";

const MAX_DOC = 16_384;
const MAX_TOKEN_RESPONSE = 32_768;

/** The relay's base address: HTTPS, an exact public host, port 443, no query, kept without a trailing slash. */
export function parseRelayBase(raw: string): HttpsUrl | undefined {
  const u = typeof raw === "string" ? parseHttpsUrl(raw.trim()) : undefined;
  if (!u || u.query) return undefined;
  const path = u.path.length > 1 && u.path.endsWith("/") ? u.path.slice(0, -1) : u.path;
  return { ...u, path, href: `${u.origin}${path}` };
}

const baseOf = (u: HttpsUrl) => (u.path === "/" ? u.origin : `${u.origin}${u.path}`);

export interface RelayInfo {
  /** Base address, no trailing slash. */
  base: string;
  /** For the privacy screen and the sign-in sheet. */
  host: string;
  /** The relay's callback: the `redirect_uri` registered with the provider. */
  callback: string;
  providers: Array<{ id: string; clientId: string }>;
}

/** Reads `GET /v1/providers`. The callback must be exactly this relay's own; client IDs are printable and short. */
export function parseRelayInfo(base: HttpsUrl, body: string): RelayInfo | undefined {
  const o = parseRelayJson(body);
  if (!o || o.protocol !== RELAY_PROTOCOL || !Array.isArray(o.providers)) return undefined;
  const root = baseOf(base);
  if (o.callback !== `${root}${RELAY_PATHS.callback}`) return undefined;
  const providers: RelayInfo["providers"] = [];
  for (const p of o.providers.slice(0, 50)) {
    if (typeof p !== "object" || p === null) return undefined;
    const { id, clientId } = p as { id?: unknown; clientId?: unknown };
    if (typeof id !== "string" || !RELAY_PROVIDER_ID.test(id) || typeof clientId !== "string" || !/^[\x21-\x7e]{1,200}$/.test(clientId)) return undefined;
    if (!providers.some((x) => x.id === id)) providers.push({ id, clientId });
  }
  return { base: root, host: base.host, callback: o.callback, providers };
}

/** Asks a relay what it serves. A private or malformed address is refused before any request. */
export async function discoverRelay(transport: ConnectorTransport, rawUrl: string): Promise<{ ok: true; info: RelayInfo } | { ok: false; problem: "bad_address" | "unreachable" | "not_a_relay" }> {
  const base = parseRelayBase(rawUrl);
  if (!base) return { ok: false, problem: "bad_address" };
  let res: ConnectorResponse;
  try {
    res = await transport.send({ method: "GET", url: `${baseOf(base)}${RELAY_PATHS.providers}`, headers: { Accept: "application/json" }, maxResponseBytes: MAX_DOC });
  } catch {
    return { ok: false, problem: "unreachable" };
  }
  if (res.status !== 200) return { ok: false, problem: res.status >= 300 && res.status < 400 ? "unreachable" : res.status >= 500 ? "unreachable" : "not_a_relay" };
  const info = parseRelayInfo(base, res.body);
  return info ? { ok: true, info } : { ok: false, problem: "not_a_relay" };
}

/**
 * One sign-in under way. The PKCE verifier and the secret key are private fields: printing or serializing this shows
 * neither. Kept in memory only, dropped after use or after ten minutes.
 */
export class PendingRelaySignIn {
  readonly provider: string;
  readonly connectorId: string;
  readonly relay: string;
  readonly relayHost: string;
  readonly callback: string;
  readonly clientId: string;
  readonly state: string;
  readonly scopes: string[];
  readonly scopeSeparator: " " | ",";
  readonly source: Extract<CredentialSource, "own_relay" | "dojo_relay">;
  readonly createdAt: number;
  #verifier: string;
  #secretKey: Uint8Array;
  #used = false;

  constructor(init: Omit<PendingRelaySignIn, "used" | "take"> & { verifier: string; secretKey: Uint8Array }) {
    this.provider = init.provider;
    this.connectorId = init.connectorId;
    this.relay = init.relay;
    this.relayHost = init.relayHost;
    this.callback = init.callback;
    this.clientId = init.clientId;
    this.state = init.state;
    this.scopes = [...init.scopes];
    this.scopeSeparator = init.scopeSeparator;
    this.source = init.source;
    this.createdAt = init.createdAt;
    this.#verifier = init.verifier;
    this.#secretKey = init.secretKey;
  }

  get used(): boolean {
    return this.#used;
  }

  /** The verifier and key, once. The key is wiped after the caller is done with it. */
  take(): { verifier: string; secretKey: Uint8Array; wipe(): void } | undefined {
    if (this.#used) return undefined;
    this.#used = true;
    const secretKey = this.#secretKey;
    return { verifier: this.#verifier, secretKey, wipe: () => secretKey.fill(0) };
  }
}

export interface BeginRelayInput {
  info: RelayInfo;
  /** From the phone's own provider table: the authorization page is never one the relay names. */
  provider: OAuthProvider;
  connectorId: string;
  scopes: string[];
  source: "own_relay" | "dojo_relay";
  /** For `POST /v1/start`, the same counted adapter as discovery. */
  transport: ConnectorTransport;
  random(bytes: number): Uint8Array;
  now(): number;
}

const enc = encodeURIComponent;

/**
 * Starts a relay sign-in: asks the relay to issue the provider state for this sign-in's state, challenge and key
 * (`POST /v1/start`), checks that what came back carries exactly those values and a near expiry, and returns the URL
 * the system browser opens and what to keep until it comes back.
 */
export async function beginRelaySignIn(
  input: BeginRelayInput,
): Promise<{ authorizationUrl: string; pending: PendingRelaySignIn } | { problem: "provider_not_offered" | "no_relay_needed" | "unreachable" | "not_a_relay" | "rate_limited" }> {
  const p = input.provider;
  if (p.publicClient) return { problem: "no_relay_needed" };
  const offered = input.info.providers.find((x) => x.id === p.id);
  if (!offered) return { problem: "provider_not_offered" };
  const state = base64url(input.random(24));
  const verifier = base64url(input.random(32));
  const challenge = base64url(sha256(utf8ToBytes(verifier)));
  const keys = relayKeyPair(input.random(32));
  const asked = { provider: p.id, state, challenge, key: base64url(keys.publicKey) };
  let res: ConnectorResponse;
  try {
    res = await input.transport.send({
      method: "POST",
      url: `${input.info.base}${RELAY_PATHS.start}`,
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: startRequestBody(asked),
      maxResponseBytes: MAX_DOC,
    });
  } catch {
    return { problem: "unreachable" };
  }
  if (res.status === 429) return { problem: "rate_limited" };
  if (res.status !== 200) return { problem: res.status >= 500 || (res.status >= 300 && res.status < 400) ? "unreachable" : "not_a_relay" };
  const o = parseRelayJson(res.body);
  const issuedParam = o && o.protocol === RELAY_PROTOCOL && typeof o.state === "string" ? o.state : undefined;
  const issued = issuedParam ? parseProviderState(issuedParam) : undefined;
  const now = input.now();
  // The relay must carry exactly this sign-in's values, with an expiry in the near future.
  if (
    !issuedParam ||
    !issued ||
    issued.provider !== asked.provider ||
    issued.state !== asked.state ||
    issued.challenge !== asked.challenge ||
    issued.key !== asked.key ||
    issued.expiresAt <= now ||
    issued.expiresAt > now + RELAY_SIGN_IN_TTL_MS + 60_000
  ) {
    return { problem: "not_a_relay" };
  }
  const fields: Record<string, string> = {
    response_type: "code",
    client_id: offered.clientId,
    redirect_uri: input.info.callback,
    scope: input.scopes.join(p.scopeSeparator),
    state: issuedParam,
    // Where the provider supports PKCE too, it binds the code to the same challenge.
    ...(p.pkce ? { code_challenge: challenge, code_challenge_method: "S256" } : {}),
    ...p.authorizationParams,
  };
  const query = Object.entries(fields).map(([k, v]) => `${enc(k)}=${enc(v)}`).join("&");
  const pending = new PendingRelaySignIn({
    provider: p.id,
    connectorId: input.connectorId,
    relay: input.info.base,
    relayHost: input.info.host,
    callback: input.info.callback,
    clientId: offered.clientId,
    state,
    scopes: input.scopes,
    scopeSeparator: p.scopeSeparator,
    source: input.source,
    createdAt: now,
    verifier,
    secretKey: keys.secretKey,
  });
  return { authorizationUrl: `${p.authorizationUrl}?${query}`, pending };
}

/**
 * Reads `hermit://oauth/relay?...` before anything is sent: the exact redirect, each parameter once, the state in
 * constant time, then the user's refusal, the expiry and the sealed code's shape.
 */
export function readRelayCallback(pending: PendingRelaySignIn, url: string, now: number): { ok: true; code: string } | { ok: false; problem: RelayProblem } {
  if (pending.used) return { ok: false, problem: "already_used" };
  const prefix = `${RELAY_REDIRECT_URI}?`;
  if (typeof url !== "string" || !url.startsWith(prefix) || url.length > 12_000 || url.includes("#")) return { ok: false, problem: "bad_callback" };
  const params = new Map<string, string>();
  for (const pair of url.slice(prefix.length).split("&")) {
    const i = pair.indexOf("=");
    if (i <= 0) return { ok: false, problem: "bad_callback" };
    let key: string;
    let value: string;
    try {
      key = decodeURIComponent(pair.slice(0, i));
      value = decodeURIComponent(pair.slice(i + 1));
    } catch {
      return { ok: false, problem: "bad_callback" };
    }
    if (params.has(key)) return { ok: false, problem: "bad_callback" };
    params.set(key, value);
  }
  const state = params.get("state");
  if (state === undefined) return { ok: false, problem: "bad_callback" };
  if (!equalText(state, pending.state)) return { ok: false, problem: "state_mismatch" };
  const error = params.get("error");
  if (error !== undefined) return { ok: false, problem: error === "access_denied" ? "denied" : "provider_error" };
  if (now - pending.createdAt > RELAY_SIGN_IN_TTL_MS) return { ok: false, problem: "expired" };
  const code = params.get("code");
  if (!code || code.length > 8192 || !/^[A-Za-z0-9_-]+$/.test(code)) return { ok: false, problem: "bad_callback" };
  return { ok: true, code };
}

/** `POST /v1/token`. The body holds the verifier, so it is a Secret the transport reveals at send time only. */
export function relayTokenRequest(pending: PendingRelaySignIn, code: string, verifier: string): ConnectorRequest {
  return {
    method: "POST",
    url: `${pending.relay}${RELAY_PATHS.token}`,
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: new Secret(tokenRequestBody({ provider: pending.provider, code, code_verifier: verifier, redirect_uri: pending.callback })),
    maxResponseBytes: MAX_TOKEN_RESPONSE,
  };
}

const RELAY_ERROR_PROBLEM: Partial<Record<RelayError, RelayProblem>> = {
  expired: "expired",
  pkce_mismatch: "pkce_mismatch",
  exchange_refused: "exchange_refused",
  rate_limited: "rate_limited",
  unknown_provider: "provider_not_offered",
  upstream_unavailable: "unreachable",
};

/** The claims of a JWT, read without checking its signature (the phone has no keys for it); undefined if not a JWT. */
function jwtClaims(token: string): Record<string, unknown> | undefined {
  const parts = token.split(".");
  if (parts.length !== 3) return undefined;
  const payload = fromBase64url(parts[1] as string);
  return payload ? parseRelayJson(utf8FromBytes(payload) ?? "") : undefined;
}

const audOf = (claims: Record<string, unknown>): string[] | undefined =>
  typeof claims.aud === "string" ? [claims.aud] : Array.isArray(claims.aud) ? claims.aud.filter((a): a is string => typeof a === "string") : undefined;

/**
 * The audience checks. An ID token must be a JWT naming this client in `aud` (and in `azp` when present). An access
 * token that is a JWT must not name another client in `client_id` or `azp`. Opaque access tokens carry no audience to
 * read; the envelope's client and provider stand for it.
 */
function audienceOk(tokens: RelayTokens, clientId: string): boolean {
  if (tokens.id_token !== undefined) {
    const id = jwtClaims(tokens.id_token);
    if (!id || !audOf(id)?.includes(clientId)) return false;
    if (id.azp !== undefined && id.azp !== clientId) return false;
  }
  const access = jwtClaims(tokens.access_token);
  if (access) {
    for (const claim of ["client_id", "azp"] as const) if (access[claim] !== undefined && access[claim] !== clientId) return false;
  }
  return true;
}

/** Bearer by the standard; Slack calls its bot and user tokens by those names (they are bearer tokens). */
const BEARER_TYPES = new Set(["bearer", "bot", "user"]);

/** Reads the relay's answer to the token request: an error code, or tokens sealed to this sign-in's key. */
export function readRelayTokens(pending: PendingRelaySignIn, secretKey: Uint8Array, res: ConnectorResponse): { ok: true; tokens: RelayTokens } | { ok: false; problem: RelayProblem } {
  const o = parseRelayJson(res.body);
  if (res.status !== 200) {
    const code = o && typeof o.error === "string" ? (o.error as RelayError) : undefined;
    return { ok: false, problem: (code && RELAY_ERROR_PROBLEM[code]) ?? (res.status === 429 ? "rate_limited" : "failed") };
  }
  if (!o || o.protocol !== RELAY_PROTOCOL || typeof o.sealed !== "string") return { ok: false, problem: "failed" };
  const envelope = openTokens(secretKey, o.sealed);
  if (!envelope) return { ok: false, problem: "tampered" };
  if (!equalText(envelope.state, pending.state)) return { ok: false, problem: "tampered" };
  if (envelope.provider !== pending.provider || envelope.clientId !== pending.clientId) return { ok: false, problem: "wrong_client" };
  if (envelope.tokens.token_type !== undefined && !BEARER_TYPES.has(envelope.tokens.token_type.toLowerCase())) return { ok: false, problem: "not_bearer" };
  if (!audienceOk(envelope.tokens, pending.clientId)) return { ok: false, problem: "wrong_audience" };
  return { ok: true, tokens: envelope.tokens };
}

export interface RelaySignInDeps {
  transport: ConnectorTransport;
  credentials: CredentialStorePort;
  now(): number;
  newId(): string;
}

/**
 * Finishes a relay sign-in from the redirect URL: checks it, swaps the sealed code through the relay, opens and
 * checks the tokens, and saves them only in the credential store. Returns the credential's meta, never a token.
 */
export async function completeRelaySignIn(deps: RelaySignInDeps, pending: PendingRelaySignIn, callbackUrl: string): Promise<{ ok: true; meta: CredentialMeta } | { ok: false; problem: RelayProblem }> {
  const back = readRelayCallback(pending, callbackUrl, deps.now());
  if (!back.ok) return back;
  const taken = pending.take();
  if (!taken) return { ok: false, problem: "already_used" };
  try {
    let res: ConnectorResponse;
    try {
      res = await deps.transport.send(relayTokenRequest(pending, back.code, taken.verifier));
    } catch {
      return { ok: false, problem: "unreachable" };
    }
    const read = readRelayTokens(pending, taken.secretKey, res);
    if (!read.ok) return read;
    const t = read.tokens;
    const now = deps.now();
    const granted = t.scope?.split(pending.scopeSeparator).map((s) => s.trim()).filter(Boolean);
    const meta: CredentialMeta = {
      id: deps.newId(),
      connectorId: pending.connectorId,
      kind: "oauth2",
      source: pending.source,
      scopes: granted?.length ? granted : [...pending.scopes],
      clientId: pending.clientId,
      createdAt: now,
      ...(t.expires_in ? { expiresAt: now + t.expires_in * 1000 } : {}),
    };
    try {
      await deps.credentials.save(meta, { kind: "oauth2", accessToken: t.access_token, ...(t.refresh_token ? { refreshToken: t.refresh_token } : {}) });
    } catch {
      return { ok: false, problem: "failed" };
    }
    return { ok: true, meta };
  } finally {
    taken.wipe();
  }
}
