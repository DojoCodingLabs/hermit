import { sha256 } from "@noble/hashes/sha2.js";
import { utf8ToBytes } from "@noble/hashes/utils.js";
import type { CredentialMeta, CredentialSecret, CredentialStorePort } from "@hermit/core";
import type { OAuthProvider } from "./oauth-providers.ts";
import { base64url, Secret } from "./secret.ts";
import type { ConnectorSpec } from "./spec.ts";
import type { ConnectorRequest, ConnectorTransport } from "./transport.ts";

const TOKEN_RESPONSE_BYTES = 16_384;

export interface Pkce {
  verifier: string;
  challenge: string;
  method: "S256";
}

/** PKCE from 32 or more random bytes the app draws from the platform's secure random source (RFC 7636). */
export function createPkce(random: Uint8Array): Pkce {
  if (random.length < 32) throw new Error("PKCE needs at least 32 random bytes");
  const verifier = base64url(random);
  return { verifier, challenge: base64url(sha256(utf8ToBytes(verifier))), method: "S256" };
}

const enc = encodeURIComponent;
const form = (fields: Record<string, string>) => Object.entries(fields).map(([k, v]) => `${enc(k)}=${enc(v)}`).join("&");

/** The URL the system browser opens (FR-CONN-03). Only for providers that accept a public client. */
export function authorizationUrl(
  provider: OAuthProvider,
  input: { clientId: string; redirectUri: string; scopes: string[]; state: string; challenge: string },
): string {
  if (!provider.publicClient || !provider.pkce) throw new Error(`${provider.name} needs a client secret: sign in through a relay`);
  const query = form({
    response_type: "code",
    client_id: input.clientId,
    redirect_uri: input.redirectUri,
    scope: input.scopes.join(provider.scopeSeparator),
    state: input.state,
    code_challenge: input.challenge,
    code_challenge_method: "S256",
    ...provider.authorizationParams,
  });
  return `${provider.authorizationUrl}?${query}`;
}

const tokenPost = (url: string, fields: Record<string, string>): ConnectorRequest => ({
  method: "POST",
  url,
  headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
  body: new Secret(form(fields)),
  maxResponseBytes: TOKEN_RESPONSE_BYTES,
});

/** Swaps the authorization code for tokens, from the phone (public clients only). */
export function tokenExchangeRequest(provider: OAuthProvider, input: { clientId: string; redirectUri: string; code: string; verifier: string }): ConnectorRequest {
  return tokenPost(provider.tokenUrl, {
    grant_type: "authorization_code",
    client_id: input.clientId,
    redirect_uri: input.redirectUri,
    code: input.code,
    code_verifier: input.verifier,
  });
}

export function refreshRequest(provider: OAuthProvider, input: { clientId: string; refreshToken: string }): ConnectorRequest {
  return tokenPost(provider.tokenUrl, { grant_type: "refresh_token", client_id: input.clientId, refresh_token: input.refreshToken });
}

/** RFC 7009 revocation, where the provider has an endpoint; otherwise undefined (US-CONN-02). */
export function revokeRequest(provider: OAuthProvider, token: string): ConnectorRequest | undefined {
  return provider.revocationUrl ? tokenPost(provider.revocationUrl, { token }) : undefined;
}

export interface TokenResult {
  secret: Extract<CredentialSecret, { kind: "oauth2" }>;
  expiresAt?: number;
  scopes?: string[];
}

/** Reads a token endpoint's JSON. Undefined for an error or anything that isn't a token. */
export function parseTokenResponse(body: string, now: number, scopeSeparator: " " | ","): TokenResult | undefined {
  let json: unknown;
  try {
    json = JSON.parse(body);
  } catch {
    return undefined;
  }
  if (typeof json !== "object" || json === null) return undefined;
  const j = json as Record<string, unknown>;
  if (typeof j.access_token !== "string" || !j.access_token) return undefined;
  const result: TokenResult = {
    secret: { kind: "oauth2", accessToken: j.access_token, ...(typeof j.refresh_token === "string" ? { refreshToken: j.refresh_token } : {}) },
  };
  if (typeof j.expires_in === "number" && j.expires_in > 0) result.expiresAt = now + j.expires_in * 1000;
  if (typeof j.scope === "string") result.scopes = j.scope.split(scopeSeparator).map((s) => s.trim()).filter(Boolean);
  return result;
}

const REFRESH_EARLY_MS = 60_000;

/** An OAuth access token that stops working within a minute, so it is refreshed before the call. */
export function needsRefresh(meta: CredentialMeta, secret: CredentialSecret, now: number): boolean {
  return secret.kind === "oauth2" && meta.expiresAt !== undefined && meta.expiresAt <= now + REFRESH_EARLY_MS;
}

/**
 * Refreshes from the phone for public clients and saves the new tokens. Undefined when it can't (no refresh
 * token, a relay-issued token that needs the relay, SL-57, or the provider refused): sign in again.
 */
export async function refreshOAuthCredential(
  deps: { credentials: CredentialStorePort; transport: ConnectorTransport; now(): number },
  provider: OAuthProvider | undefined,
  meta: CredentialMeta,
  secret: CredentialSecret,
): Promise<{ meta: CredentialMeta; secret: CredentialSecret } | undefined> {
  if (secret.kind !== "oauth2" || !secret.refreshToken || !meta.clientId || !provider?.publicClient) return undefined;
  if (meta.source !== "dojo_client" && meta.source !== "own_client") return undefined;
  try {
    const res = await deps.transport.send(refreshRequest(provider, { clientId: meta.clientId, refreshToken: secret.refreshToken }));
    if (res.status >= 400) return undefined;
    const parsed = parseTokenResponse(res.body, deps.now(), provider.scopeSeparator);
    if (!parsed) return undefined;
    const nextSecret: CredentialSecret = { ...parsed.secret, refreshToken: parsed.secret.refreshToken ?? secret.refreshToken };
    const nextMeta: CredentialMeta = { ...meta, ...(parsed.expiresAt ? { expiresAt: parsed.expiresAt } : {}), ...(parsed.scopes ? { scopes: parsed.scopes } : {}) };
    if (!parsed.expiresAt) delete nextMeta.expiresAt;
    await deps.credentials.save(nextMeta, nextSecret);
    return { meta: nextMeta, secret: nextSecret };
  } catch {
    return undefined;
  }
}

export type FreshOAuth =
  | { ok: true; meta: CredentialMeta; secret: Extract<CredentialSecret, { kind: "oauth2" }> }
  | { ok: false; problem: "not_connected" | "sign_in_again" };

/**
 * A usable OAuth token for one stored credential, refreshed when it is about to expire. For callers that
 * build their own requests to a fixed host (mail, SL-48); they still inject it only as a Secret at send time.
 */
export async function freshOAuthCredential(
  deps: { credentials: CredentialStorePort; transport: ConnectorTransport; now(): number },
  provider: OAuthProvider | undefined,
  credentialId: string,
): Promise<FreshOAuth> {
  const meta = await deps.credentials.get(credentialId);
  const secret = await deps.credentials.reveal(credentialId);
  if (!meta || !secret || secret.kind !== "oauth2") return { ok: false, problem: "not_connected" };
  if (!needsRefresh(meta, secret, deps.now())) return { ok: true, meta, secret };
  const refreshed = await refreshOAuthCredential(deps, provider, meta, secret);
  if (!refreshed || refreshed.secret.kind !== "oauth2") return { ok: false, problem: "sign_in_again" };
  return { ok: true, meta: refreshed.meta, secret: refreshed.secret };
}

/** The scopes to request: only those of the operations the user enabled, in spec order. */
export function scopesFor(spec: ConnectorSpec, enabled: readonly string[]): string[] {
  const out: string[] = [];
  for (const op of spec.operations) if (enabled.includes(op.name)) for (const s of op.scopes) if (!out.includes(s)) out.push(s);
  return out;
}
