import type { CredentialMeta, CredentialStorePort } from "@hermit/core";
import { createPkce, needsRefresh, parseTokenResponse } from "../oauth.ts";
import { base64url, Secret } from "../secret.ts";
import type { ConnectorRequest } from "../transport.ts";
import { discoverMcpAuth, type McpAuthDiscovery } from "./discovery.ts";
import { postChecked, type McpTransport } from "./http.ts";
import { parseJsonObject, str } from "./json.ts";
import { isAppRedirectUri, parseRegistration, registrationRequest } from "./register.ts";
import { parseHttpsUrl } from "./url.ts";

/** How long a sign-in may stay in the browser before its state and verifier are thrown away. */
export const SIGN_IN_TTL_MS = 10 * 60_000;
const TOKEN_BYTES = 16_384;

/**
 * A sign-in waiting for the browser to come back. It holds the PKCE verifier, so the app keeps it only in
 * memory or in the Keystore-backed store, never in plain storage, and drops it once used or expired.
 */
export interface McpPendingSignIn {
  serverUrl: string;
  resource: string;
  issuer: string;
  tokenEndpoint: string;
  revocationEndpoint?: string;
  clientId: string;
  redirectUri: string;
  state: string;
  verifier: string;
  scopes: string[];
  issParameter: boolean;
  createdAt: number;
}

type DiscoveryProblem = Extract<McpAuthDiscovery, { ok: false }>["problem"];
export type BeginResult =
  | { ok: true; authorizationUrl: string; pending: McpPendingSignIn }
  | { ok: false; problem: DiscoveryProblem | "no_auth_needed" | "no_registration" | "registration_failed" | "redirect_refused" | "needs_client_secret" | "bad_redirect" };

const enc = encodeURIComponent;
const form = (fields: Record<string, string>) => Object.entries(fields).map(([k, v]) => `${enc(k)}=${enc(v)}`).join("&");

/** The connector id an MCP server's credential is filed under: its host, made into an id. */
export function mcpConnectorId(serverUrl: string): string {
  const host = parseHttpsUrl(serverUrl)?.host ?? "unknown";
  return `mcp_${host.replace(/[^a-z0-9]/g, "_")}`.slice(0, 40);
}

/**
 * Starts an MCP sign-in from the phone: discovery, dynamic client registration (unless a client id is given),
 * PKCE S256 and a random state. Returns the URL for the system browser; nothing secret leaves the phone.
 */
export async function beginMcpSignIn(
  deps: { transport: McpTransport; now(): number; random(bytes: number): Uint8Array },
  input: { serverUrl: string; redirectUri: string; clientId?: string },
): Promise<BeginResult> {
  if (!isAppRedirectUri(input.redirectUri)) return { ok: false, problem: "bad_redirect" };
  const d = await discoverMcpAuth(deps.transport, input.serverUrl);
  if (!d.ok) return d;
  if (d.auth === "none") return { ok: false, problem: "no_auth_needed" };

  let clientId = input.clientId;
  if (!clientId) {
    if (!d.as.registrationEndpoint) return { ok: false, problem: "no_registration" };
    const r = await postChecked(deps.transport, registrationRequest(d.as.registrationEndpoint, input.redirectUri));
    if (!r.ok) return { ok: false, problem: "registration_failed" };
    const reg = parseRegistration(r.res.body, input.redirectUri);
    if (!reg.ok) return reg;
    if (r.res.status >= 400) return { ok: false, problem: "registration_failed" };
    clientId = reg.clientId;
  }

  const pkce = createPkce(deps.random(32));
  const state = base64url(deps.random(24));
  // The MCP spec's scope order: the challenge's scope, else what the resource lists, else none.
  const scopes = (d.challengeScope ?? d.scopesSupported.join(" ")).split(" ").filter(Boolean);
  const pending: McpPendingSignIn = {
    serverUrl: d.server,
    resource: d.resource,
    issuer: d.as.issuer,
    tokenEndpoint: d.as.tokenEndpoint,
    ...(d.as.revocationEndpoint ? { revocationEndpoint: d.as.revocationEndpoint } : {}),
    clientId,
    redirectUri: input.redirectUri,
    state,
    verifier: pkce.verifier,
    scopes,
    issParameter: d.as.issParameter,
    createdAt: deps.now(),
  };
  const query = form({
    response_type: "code",
    client_id: clientId,
    redirect_uri: input.redirectUri,
    ...(scopes.length ? { scope: scopes.join(" ") } : {}),
    state,
    code_challenge: pkce.challenge,
    code_challenge_method: "S256",
    // RFC 8707: the token is for this server only.
    resource: d.resource,
  });
  return { ok: true, authorizationUrl: `${d.as.authorizationEndpoint}?${query}`, pending };
}

export type CallbackResult =
  | { ok: true; code: string }
  | { ok: false; problem: "wrong_redirect" | "invalid_callback" | "state_mismatch" | "denied" | "issuer_mismatch" | "no_code" | "expired" };

function sameString(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * Reads the URL the browser handed back. It must be exactly the registered redirect plus a query; the state
 * must match (compared in constant time); an `iss` must be the issuer, and is required when the server
 * promised it (RFC 9207). Only then is the code returned.
 */
export function readCallback(pending: McpPendingSignIn, callbackUrl: string, now: number): CallbackResult {
  if (!callbackUrl.startsWith(`${pending.redirectUri}?`)) return { ok: false, problem: "wrong_redirect" };
  if (now - pending.createdAt > SIGN_IN_TTL_MS) return { ok: false, problem: "expired" };
  const query = callbackUrl.slice(pending.redirectUri.length + 1).split("#")[0] as string;
  const params = new Map<string, string>();
  for (const pair of query.split("&").filter(Boolean)) {
    const i = pair.indexOf("=");
    let k: string, v: string;
    try {
      k = decodeURIComponent((i === -1 ? pair : pair.slice(0, i)).replace(/\+/g, " "));
      v = decodeURIComponent((i === -1 ? "" : pair.slice(i + 1)).replace(/\+/g, " "));
    } catch {
      return { ok: false, problem: "invalid_callback" };
    }
    if (params.has(k)) return { ok: false, problem: "invalid_callback" };
    params.set(k, v);
  }
  if (!sameString(params.get("state") ?? "", pending.state)) return { ok: false, problem: "state_mismatch" };
  if (params.has("error")) return { ok: false, problem: "denied" };
  const iss = params.get("iss");
  if (iss !== undefined ? iss.replace(/\/$/, "") !== pending.issuer.replace(/\/$/, "") : pending.issParameter) return { ok: false, problem: "issuer_mismatch" };
  const code = params.get("code");
  if (!code) return { ok: false, problem: "no_code" };
  return { ok: true, code };
}

const tokenPost = (url: string, fields: Record<string, string>): ConnectorRequest => ({
  method: "POST",
  url,
  headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
  body: new Secret(form(fields)),
  maxResponseBytes: TOKEN_BYTES,
});

function bearerOnly(body: string): boolean {
  const type = str(parseJsonObject(body) ?? {}, "token_type");
  return type === undefined || type.toLowerCase() === "bearer";
}

export type CompleteResult = { ok: true; meta: CredentialMeta } | { ok: false; problem: Extract<CallbackResult, { ok: false }>["problem"] | "token_failed" };

/** Verifies the callback, swaps the code (with the verifier and the resource) and stores the tokens. */
export async function completeMcpSignIn(
  deps: { transport: McpTransport; credentials: CredentialStorePort; now(): number },
  pending: McpPendingSignIn,
  callbackUrl: string,
  credentialId: string,
): Promise<CompleteResult> {
  const cb = readCallback(pending, callbackUrl, deps.now());
  if (!cb.ok) return cb;
  const r = await postChecked(
    deps.transport,
    tokenPost(pending.tokenEndpoint, {
      grant_type: "authorization_code",
      code: cb.code,
      redirect_uri: pending.redirectUri,
      client_id: pending.clientId,
      code_verifier: pending.verifier,
      resource: pending.resource,
    }),
  );
  if (!r.ok || r.res.status >= 400 || !bearerOnly(r.res.body)) return { ok: false, problem: "token_failed" };
  const t = parseTokenResponse(r.res.body, deps.now(), " ");
  if (!t) return { ok: false, problem: "token_failed" };
  const meta: CredentialMeta = {
    id: credentialId,
    connectorId: mcpConnectorId(pending.serverUrl),
    kind: "oauth2",
    source: "dynamic_client",
    scopes: t.scopes ?? pending.scopes,
    clientId: pending.clientId,
    createdAt: deps.now(),
    ...(t.expiresAt ? { expiresAt: t.expiresAt } : {}),
  };
  await deps.credentials.save(meta, t.secret);
  return { ok: true, meta };
}

export type FreshToken = { ok: true; token: Secret } | { ok: false; problem: "not_connected" | "sign_in_again" };

/** The access token for an MCP server, refreshed (with the resource indicator) when it is about to expire. */
export async function freshMcpToken(
  deps: { transport: McpTransport; credentials: CredentialStorePort; now(): number },
  server: { tokenEndpoint: string; resource: string },
  credentialId: string,
): Promise<FreshToken> {
  const meta = await deps.credentials.get(credentialId);
  const secret = await deps.credentials.reveal(credentialId);
  if (!meta || secret?.kind !== "oauth2") return { ok: false, problem: "not_connected" };
  if (!needsRefresh(meta, secret, deps.now())) return { ok: true, token: new Secret(secret.accessToken) };
  if (!secret.refreshToken || !meta.clientId) return { ok: false, problem: "sign_in_again" };
  const r = await postChecked(
    deps.transport,
    tokenPost(server.tokenEndpoint, { grant_type: "refresh_token", refresh_token: secret.refreshToken, client_id: meta.clientId, resource: server.resource }),
  );
  if (!r.ok || r.res.status >= 400 || !bearerOnly(r.res.body)) return { ok: false, problem: "sign_in_again" };
  const t = parseTokenResponse(r.res.body, deps.now(), " ");
  if (!t) return { ok: false, problem: "sign_in_again" };
  const next = { ...t.secret, refreshToken: t.secret.refreshToken ?? secret.refreshToken };
  const nextMeta: CredentialMeta = { ...meta, ...(t.scopes ? { scopes: t.scopes } : {}) };
  if (t.expiresAt) nextMeta.expiresAt = t.expiresAt;
  else delete nextMeta.expiresAt;
  await deps.credentials.save(nextMeta, next);
  return { ok: true, token: new Secret(next.accessToken) };
}
