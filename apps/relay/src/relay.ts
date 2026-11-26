// The relay's routes (FR-CONN-07, PDR-022), as a function from a request to a response so it can be tested without
// a socket. Stateless: everything a sign-in needs travels sealed in the browser redirect and the phone's request.
// The only memory is the rate limiter's per-client counters, dropped every minute.
//
//   GET  /v1/providers  the providers this relay serves, their public client IDs, and its callback
//   POST /v1/start      issue the provider state for one sign-in: the phone's state, challenge and key, an expiry,
//                       and an HMAC under the seal key, so the callback only accepts states this relay issued
//   GET  /v1/callback   the provider's redirect: check the issued state, seal the code to its challenge and key,
//                       send the browser to hermit://oauth/relay
//   POST /v1/token      open the sealed code, check PKCE, swap it with the client secret, seal the tokens to the phone
//   GET  /healthz       "ok"
//
// No CORS headers at all (the phone is not a browser), no cookies, no caching. Logs carry the route, the status, the
// provider and the time taken: never a query string, a body, a header, an address, a code or a token.
import {
  issueProviderState,
  normalizeProviderTokens,
  openCode,
  parseRelayJson,
  parseStartRequest,
  parseTokenRequest,
  RELAY_PATHS,
  RELAY_PROTOCOL,
  RELAY_REDIRECT_URI,
  RELAY_SIGN_IN_TTL_MS,
  sealCode,
  sealTokens,
  verifierMatches,
  verifyProviderState,
  type RelayError,
} from "@hermit/connectors/relay-protocol";
import type { RelayConfig } from "./config.ts";
import { RateLimiter } from "./rate-limit.ts";

export interface RelayRequest {
  method: string;
  /** Path and query, as received. */
  url: string;
  /** Lowercased names. */
  headers: Record<string, string | undefined>;
  body: string;
  /** Who the rate limit counts: the socket address, or the proxy's last X-Forwarded-For entry. Never logged. */
  clientKey: string;
}

export interface RelayResponse {
  status: number;
  headers: Record<string, string>;
  body: string;
}

/** The one outbound call: the provider's token endpoint. Redirects are never followed. */
export type UpstreamFetch = (url: string, init: { method: "POST"; headers: Record<string, string>; body: string }) => Promise<{ status: number; text(): Promise<string> }>;

export interface RelayDeps {
  fetch: UpstreamFetch;
  now(): number;
  random(bytes: number): Uint8Array;
  log(line: Record<string, unknown>): void;
}

const SECURITY_HEADERS: Record<string, string> = {
  "cache-control": "no-store",
  pragma: "no-cache",
  "referrer-policy": "no-referrer",
  "x-content-type-options": "nosniff",
  "content-security-policy": "default-src 'none'; frame-ancestors 'none'",
  "cross-origin-resource-policy": "same-origin",
};

const json = (status: number, body: unknown, extra: Record<string, string> = {}): RelayResponse => ({
  status,
  headers: { ...SECURITY_HEADERS, "content-type": "application/json", ...extra },
  body: JSON.stringify(body),
});
const fail = (status: number, error: RelayError, extra: Record<string, string> = {}) => json(status, { protocol: RELAY_PROTOCOL, error }, extra);
const text = (status: number, body: string): RelayResponse => ({ status, headers: { ...SECURITY_HEADERS, "content-type": "text/plain; charset=utf-8" }, body });

const ROUTES: Record<string, string> = { [RELAY_PATHS.providers]: "GET", [RELAY_PATHS.start]: "POST", [RELAY_PATHS.callback]: "GET", [RELAY_PATHS.token]: "POST", "/healthz": "GET" };
const MAX_PROVIDER_CODE = 2048;
const MAX_UPSTREAM_BODY = 65_536;

/** Each parameter at most once; undefined when one repeats or doesn't decode. */
function readQuery(query: string): Map<string, string> | undefined {
  const out = new Map<string, string>();
  if (!query) return out;
  for (const pair of query.split("&")) {
    const i = pair.indexOf("=");
    const [k, v] = i < 0 ? [pair, ""] : [pair.slice(0, i), pair.slice(i + 1)];
    let key: string;
    let value: string;
    try {
      key = decodeURIComponent(k.replace(/\+/g, " "));
      value = decodeURIComponent(v.replace(/\+/g, " "));
    } catch {
      return undefined;
    }
    if (out.has(key)) return undefined;
    out.set(key, value);
  }
  return out;
}

const form = (fields: Record<string, string>) => Object.entries(fields).map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join("&");
const base64 = (s: string) => Buffer.from(s, "utf8").toString("base64");

export function createRelay(config: RelayConfig, deps: RelayDeps): (req: RelayRequest) => Promise<RelayResponse> {
  const limiter = new RateLimiter(config.ratePerMinute, deps.now);
  const providersDoc = {
    protocol: RELAY_PROTOCOL,
    callback: config.callback,
    providers: [...config.providers].map(([id, p]) => ({ id, clientId: p.clientId })),
  };

  function callback(query: string): RelayResponse {
    const q = readQuery(query);
    // Only a state this relay issued (its MAC), unexpired: a made-up or spliced state gets no sealed code.
    const checked = q ? verifyProviderState(config.sealKey, q.get("state") ?? "", deps.now()) : undefined;
    if (!q || !checked) return text(400, "This sign-in link is not valid. Start again from Hermit.");
    if (!checked.ok) return text(400, checked.error === "expired" ? "This sign-in took too long. Start again from Hermit." : "This sign-in link is not valid. Start again from Hermit.");
    const st = checked.state;
    if (!config.providers.has(st.provider)) return text(400, "This relay does not serve that service.");
    const back = (params: string) => ({ status: 302, headers: { ...SECURITY_HEADERS, location: `${RELAY_REDIRECT_URI}?${params}&state=${st.state}` }, body: "" });
    const error = q.get("error");
    // Only two codes go back: the user said no, or something else failed. The provider's own text stays here.
    if (error !== undefined) return back(`error=${error === "access_denied" ? "access_denied" : "provider_error"}`);
    const code = q.get("code");
    if (!code || code.length > MAX_PROVIDER_CODE || !/^[\x21-\x7e]+$/.test(code)) return text(400, "This sign-in link is not valid. Start again from Hermit.");
    // Bound to the issued state's challenge and key, and to its expiry.
    const sealed = sealCode(config.sealKey, { provider: st.provider, state: st.state, challenge: st.challenge, key: st.key, code, expiresAt: st.expiresAt }, deps.random(24));
    return back(`code=${sealed}`);
  }

  /** A browser page can't reach the POST routes: no CORS, a JSON body that needs a preflight, and any Origin is refused. */
  function phoneOnly(req: RelayRequest): RelayResponse | undefined {
    if (req.headers.origin !== undefined) return fail(403, "invalid_request");
    if ((req.headers["content-type"] ?? "").split(";")[0]!.trim().toLowerCase() !== "application/json") return fail(415, "invalid_request");
    return undefined;
  }

  function start(req: RelayRequest, note: Record<string, unknown>): RelayResponse {
    const refused = phoneOnly(req);
    if (refused) return refused;
    const asked = parseStartRequest(req.body);
    if (!asked) return fail(400, "invalid_request");
    if (!config.providers.has(asked.provider)) return fail(400, "unknown_provider");
    note.provider = asked.provider;
    return json(200, { protocol: RELAY_PROTOCOL, state: issueProviderState(config.sealKey, asked, deps.now() + RELAY_SIGN_IN_TTL_MS) });
  }

  async function token(req: RelayRequest, note: Record<string, unknown>): Promise<RelayResponse> {
    const refused = phoneOnly(req);
    if (refused) return refused;
    const body = parseTokenRequest(req.body);
    if (!body) return fail(400, "invalid_request");
    const entry = config.providers.get(body.provider);
    if (!entry) return fail(400, "unknown_provider");
    note.provider = body.provider;
    if (body.redirect_uri !== config.callback) return fail(400, "redirect_mismatch");
    const opened = openCode(config.sealKey, body.code, deps.now());
    if (!opened.ok) return fail(400, opened.error);
    const claims = opened.claims;
    if (claims.provider !== body.provider) return fail(400, "invalid_request");
    if (!verifierMatches(body.code_verifier, claims.challenge)) return fail(400, "pkce_mismatch");

    const p = entry.provider;
    const fields: Record<string, string> = {
      grant_type: "authorization_code",
      code: claims.code,
      redirect_uri: config.callback,
      // The provider saw the same challenge when it supports PKCE (beginRelaySignIn), so it checks the verifier too.
      ...(p.pkce ? { code_verifier: body.code_verifier } : {}),
      ...(p.clientSecretIn === "basic" ? {} : { client_id: entry.clientId, client_secret: entry.clientSecret }),
    };
    const headers: Record<string, string> = {
      accept: "application/json",
      "content-type": p.tokenRequestFormat === "json" ? "application/json" : "application/x-www-form-urlencoded",
      ...(p.clientSecretIn === "basic" ? { authorization: `Basic ${base64(`${encodeURIComponent(entry.clientId)}:${encodeURIComponent(entry.clientSecret)}`)}` } : {}),
    };
    let status: number;
    let answer: string;
    try {
      const res = await deps.fetch(p.tokenUrl, { method: "POST", headers, body: p.tokenRequestFormat === "json" ? JSON.stringify(fields) : form(fields) });
      status = res.status;
      answer = await res.text();
    } catch {
      return fail(502, "upstream_unavailable");
    }
    if (status >= 500 || (status >= 300 && status < 400)) return fail(502, "upstream_unavailable");
    const tokens = status === 200 && answer.length <= MAX_UPSTREAM_BODY ? normalizeProviderTokens(parseRelayJson(answer)) : undefined;
    if (!tokens) return fail(400, "exchange_refused");
    const sealed = sealTokens({ provider: body.provider, clientId: entry.clientId, state: claims.state, key: claims.key, tokens }, deps.random(32));
    if (!sealed) return fail(400, "invalid_request");
    return json(200, { protocol: RELAY_PROTOCOL, sealed });
  }

  return async (req) => {
    const started = deps.now();
    const q = req.url.indexOf("?");
    const path = q < 0 ? req.url : req.url.slice(0, q);
    const route = Object.hasOwn(ROUTES, path) ? path : "other";
    const note: Record<string, unknown> = {};
    let res: RelayResponse;
    if (route === "other") res = fail(404, "not_found");
    else if (req.method !== ROUTES[route]) res = fail(405, "method_not_allowed", { allow: ROUTES[route]! });
    else if (route === "/healthz") res = text(200, "ok");
    else if (!limiter.allow(req.clientKey)) res = fail(429, "rate_limited", { "retry-after": String(limiter.retryAfterSeconds()) });
    else if (route === RELAY_PATHS.providers) res = json(200, providersDoc);
    else if (route === RELAY_PATHS.start) res = start(req, note);
    else if (route === RELAY_PATHS.callback) res = callback(q < 0 ? "" : req.url.slice(q + 1));
    else res = await token(req, note);
    const error = res.headers["content-type"] === "application/json" && res.status >= 400 ? (JSON.parse(res.body) as { error?: string }).error : undefined;
    deps.log({ at: new Date(started).toISOString(), method: req.method.slice(0, 8), route, status: res.status, ms: deps.now() - started, ...note, ...(error ? { error } : {}) });
    return res;
  };
}
