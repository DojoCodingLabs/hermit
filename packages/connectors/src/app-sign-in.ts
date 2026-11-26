import type { CredentialSource } from "@hermit/core";
import { appRedirectUri } from "./app-redirects.ts";
import { authorizationUrl, createPkce, parseTokenResponse, tokenExchangeRequest, type TokenResult } from "./oauth.ts";
import type { OAuthProvider } from "./oauth-providers.ts";
import { base64url } from "./secret.ts";
import type { SignInOption } from "./sign-in.ts";
import type { ConnectorTransport } from "./transport.ts";

/*
 * Signing in to a public OAuth client from the phone (FR-CONN-03, PDR-021): PKCE S256 and a fresh state in the system
 * browser, the redirect back into the app, then the code exchanged for tokens from the phone, with no client secret and
 * no server. Provider-agnostic: email (SL-48, `startMailOAuth` in @hermit/mail) is its first user. A catalog connector
 * that signs in with OAuth calls the same three steps with its own scopes: `beginAppSignIn` (keep `pending` in memory
 * only: it holds the verifier), `readAppRedirect` on the URL the app's redirect route received, `finishAppSignIn`, then
 * saves `token.secret` in the credential store with the client ID on the meta (refreshes need it).
 */

export { ANDROID_PACKAGE, APP_REDIRECT_URIS, appRedirectUri } from "./app-redirects.ts";

/** How long a sign-in may stay in the browser before its state and verifier are thrown away (as for MCP servers). */
export const APP_SIGN_IN_TTL_MS = 10 * 60_000;

/**
 * A sign-in waiting for the browser to come back. It holds the PKCE verifier, so the app keeps it in memory only, never
 * in storage or a log, and drops it once used or expired.
 */
export interface PendingAppSignIn {
  /** The key in `oauthProviders`. */
  provider: string;
  clientId: string;
  source: CredentialSource;
  redirectUri: string;
  scopes: string[];
  state: string;
  verifier: string;
  /** When it began, epoch ms; a callback after APP_SIGN_IN_TTL_MS is refused. Absent: no expiry check. */
  createdAt?: number;
}

/**
 * The URL for the system browser: PKCE S256 with a fresh state. `random` is at least 48 bytes from the platform's secure
 * random source: 32 for the verifier, 16 for the state. Throws for an option that can't sign in or another provider's.
 */
export function beginAppSignIn(
  provider: OAuthProvider,
  option: SignInOption,
  input: { scopes: readonly string[]; random: Uint8Array; now?: number; redirectUri?: string },
): { url: string; pending: PendingAppSignIn } {
  if (option.method !== "oauth_pkce" || !option.available || !option.clientId || !option.source) throw new Error(`${provider.name} can't sign in yet: ${option.unavailable ?? "no client ID"}`);
  if (option.provider !== provider.id) throw new Error(`a ${option.provider ?? "missing"} sign-in option can't start a ${provider.name} sign-in`);
  const redirectUri = input.redirectUri ?? appRedirectUri(provider.id);
  if (!redirectUri) throw new Error(`${provider.name} has no redirect into the app`);
  if (input.random.length < 48) throw new Error("a sign-in needs at least 48 random bytes");
  const pkce = createPkce(input.random.slice(0, 32));
  const state = base64url(input.random.slice(32, 48));
  const scopes = [...input.scopes];
  const url = authorizationUrl(provider, { clientId: option.clientId, redirectUri, scopes, state, challenge: pkce.challenge });
  return {
    url,
    pending: { provider: provider.id, clientId: option.clientId, source: option.source, redirectUri, scopes, state, verifier: pkce.verifier, ...(input.now !== undefined ? { createdAt: input.now } : {}) },
  };
}

export interface AppRedirect {
  code?: string;
  state?: string;
  error?: string;
}

const decode = (s: string): string | undefined => {
  try {
    return decodeURIComponent(s.replace(/\+/g, " "));
  } catch {
    return undefined;
  }
};

/**
 * The callback's parameters, only when `url` is exactly `redirectUri` followed by a query. Anything else (another path,
 * another scheme, a fragment-only answer, a parameter given twice, bad percent-encoding) is not this sign-in's redirect.
 */
export function readAppRedirect(redirectUri: string, url: string): AppRedirect | undefined {
  if (typeof url !== "string" || !url.startsWith(`${redirectUri}?`)) return undefined;
  const query = url.slice(redirectUri.length + 1).split("#")[0]!;
  const out: AppRedirect = {};
  const seen = new Set<string>();
  for (const pair of query.split("&")) {
    if (!pair) continue;
    const eq = pair.indexOf("=");
    const name = decode(eq < 0 ? pair : pair.slice(0, eq));
    const value = decode(eq < 0 ? "" : pair.slice(eq + 1));
    if (name === undefined || value === undefined) return undefined;
    if (name !== "code" && name !== "state" && name !== "error") continue;
    if (seen.has(name)) return undefined;
    seen.add(name);
    out[name] = value;
  }
  return out;
}

const GRAPH_RESOURCE = "https://graph.microsoft.com/";
/** A scope as a provider writes it back, compared without case and without the Graph resource prefix. */
const scopeName = (s: string) => {
  const v = s.trim().toLowerCase();
  return v.startsWith(GRAPH_RESOURCE) ? v.slice(GRAPH_RESOURCE.length) : v;
};

/**
 * Every scope asked for that the provider says it did not grant. Google's consent screen lets the user untick a scope;
 * without it every call would fail in a loop, so the sign-in stops with a reason instead. `offline_access` is not a
 * resource scope and is never listed back. No scope field in the answer means no check.
 */
export function missingScopes(asked: readonly string[], granted: readonly string[] | undefined): string[] {
  if (!granted) return [];
  const have = new Set(granted.map(scopeName));
  return asked.filter((s) => s !== "offline_access" && !have.has(scopeName(s)));
}

export type AppSignInProblem = "state_mismatch" | "expired" | "cancelled" | "exchange_failed" | "missing_scopes";

/**
 * The redirect came back. In this order, before any request: the state must be this sign-in's, the sign-in must not have
 * expired, and the provider must have sent a code (an `error` is the user cancelling). Only then is the code exchanged,
 * from the phone, with the verifier in a Secret body; the answer must grant every scope asked for.
 */
export async function finishAppSignIn(
  deps: { transport: ConnectorTransport; now(): number },
  provider: OAuthProvider,
  pending: PendingAppSignIn,
  callback: AppRedirect,
): Promise<{ ok: true; token: TokenResult } | { ok: false; problem: AppSignInProblem }> {
  if (callback.state === undefined || callback.state !== pending.state || pending.provider !== provider.id) return { ok: false, problem: "state_mismatch" };
  if (pending.createdAt !== undefined && deps.now() - pending.createdAt > APP_SIGN_IN_TTL_MS) return { ok: false, problem: "expired" };
  if (callback.error || !callback.code) return { ok: false, problem: "cancelled" };
  let token: TokenResult | undefined;
  try {
    const res = await deps.transport.send(tokenExchangeRequest(provider, { clientId: pending.clientId, redirectUri: pending.redirectUri, code: callback.code, verifier: pending.verifier }));
    token = res.status < 400 ? parseTokenResponse(res.body, deps.now(), provider.scopeSeparator) : undefined;
  } catch {
    token = undefined;
  }
  if (!token) return { ok: false, problem: "exchange_failed" };
  if (missingScopes(pending.scopes, token.scopes).length) return { ok: false, problem: "missing_scopes" };
  return { ok: true, token };
}
