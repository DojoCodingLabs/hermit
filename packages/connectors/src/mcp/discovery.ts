import { getChecked, postChecked, type McpTransport } from "./http.ts";
import { bool, parseJsonObject, str, strArr } from "./json.ts";
import { parseHttpsUrl, withoutTrailingSlash, type HttpsUrl } from "./url.ts";

const METADATA_BYTES = 65_536;

export interface BearerChallenge {
  resourceMetadata?: string;
  scope?: string;
  error?: string;
}

/** The Bearer challenge of a 401 or 403 (RFC 6750 section 3, RFC 9728 section 5.1). */
export function parseBearerChallenge(header: string | undefined): BearerChallenge | undefined {
  if (!header || !/^\s*bearer\b/i.test(header)) return undefined;
  const out: BearerChallenge = {};
  for (const m of header.matchAll(/([a-z_]+)\s*=\s*"([^"]*)"/gi)) {
    const key = (m[1] as string).toLowerCase();
    const value = m[2] as string;
    if (key === "resource_metadata") out.resourceMetadata = value;
    else if (key === "scope") out.scope = value;
    else if (key === "error") out.error = value;
  }
  return out;
}

/** Where the protected resource metadata may be: the server's hint, then the path-aware and the root URL. */
export function protectedResourceMetadataCandidates(server: HttpsUrl, hint?: string): string[] {
  const out: string[] = [];
  const add = (u: string | undefined) => {
    const p = u ? parseHttpsUrl(u) : undefined;
    if (p && !out.includes(p.href)) out.push(p.href);
  };
  add(hint);
  const path = server.path === "/" ? "" : server.path.replace(/\/$/, "");
  if (path) add(`${server.origin}/.well-known/oauth-protected-resource${path}`);
  add(`${server.origin}/.well-known/oauth-protected-resource`);
  return out;
}

export interface ProtectedResource {
  resource: string;
  authorizationServers: string[];
  scopesSupported: string[];
}

/**
 * RFC 9728 metadata, accepted only when its `resource` is on the server's own origin and is the server URL
 * or a parent path of it (segment by segment). Metadata naming any other resource would get Hermit a token
 * minted for a different server. Authorization servers that fail the URL check are dropped.
 */
export function parseProtectedResourceMetadata(body: string, server: HttpsUrl): ProtectedResource | undefined {
  const o = parseJsonObject(body);
  const resource = o && str(o, "resource");
  const r = resource ? parseHttpsUrl(resource) : undefined;
  if (!o || !r || r.origin !== server.origin || r.query) return undefined;
  const rPath = r.path.replace(/\/$/, "");
  const sPath = server.path.replace(/\/$/, "");
  if (rPath && sPath !== rPath && !sPath.startsWith(`${rPath}/`)) return undefined;
  const authorizationServers = (strArr(o, "authorization_servers") ?? []).filter((a) => !!parseHttpsUrl(a));
  if (!authorizationServers.length) return undefined;
  // The identifier exactly as the server wrote it: it goes back as RFC 8707 `resource` and is compared as a string.
  return { resource: resource as string, authorizationServers, scopesSupported: strArr(o, "scopes_supported") ?? [] };
}

/** RFC 8414 then OpenID discovery URLs, in the order the MCP authorization spec gives. */
export function authServerMetadataCandidates(issuer: HttpsUrl): string[] {
  const path = issuer.path === "/" ? "" : issuer.path.replace(/\/$/, "");
  if (!path) return [`${issuer.origin}/.well-known/oauth-authorization-server`, `${issuer.origin}/.well-known/openid-configuration`];
  return [
    `${issuer.origin}/.well-known/oauth-authorization-server${path}`,
    `${issuer.origin}/.well-known/openid-configuration${path}`,
    `${issuer.origin}${path}/.well-known/openid-configuration`,
  ];
}

export interface AuthServer {
  issuer: string;
  authorizationEndpoint: string;
  tokenEndpoint: string;
  /** RFC 7591; dropped when it fails the URL check. */
  registrationEndpoint?: string;
  revocationEndpoint?: string;
  scopesSupported: string[];
  tokenAuthMethods: string[];
  /** The server accepts an HTTPS URL as client_id (MCP client ID metadata documents). */
  clientIdMetadataDocuments: boolean;
  /** RFC 9207: the redirect carries `iss`, and the client must check it. */
  issParameter: boolean;
}

export type AuthServerResult = { ok: true; as: AuthServer } | { ok: false; problem: "issuer_mismatch" | "no_pkce" | "invalid_metadata" };

/** RFC 8414 metadata for `expectedIssuer`, refused unless the issuer matches and PKCE S256 is offered. */
export function parseAuthServerMetadata(body: string, expectedIssuer: string): AuthServerResult {
  const o = parseJsonObject(body);
  if (!o) return { ok: false, problem: "invalid_metadata" };
  const want = parseHttpsUrl(expectedIssuer);
  const got = parseHttpsUrl(str(o, "issuer") ?? "");
  if (!want || !got || withoutTrailingSlash(want) !== withoutTrailingSlash(got)) return { ok: false, problem: "issuer_mismatch" };
  // The MCP spec: no code_challenge_methods_supported means no PKCE, and the client must refuse.
  if (!(strArr(o, "code_challenge_methods_supported") ?? []).includes("S256")) return { ok: false, problem: "no_pkce" };
  const responseTypes = strArr(o, "response_types_supported");
  if (responseTypes && !responseTypes.includes("code")) return { ok: false, problem: "invalid_metadata" };
  const authorizationEndpoint = parseHttpsUrl(str(o, "authorization_endpoint") ?? "");
  const tokenEndpoint = parseHttpsUrl(str(o, "token_endpoint") ?? "");
  if (!authorizationEndpoint || !tokenEndpoint) return { ok: false, problem: "invalid_metadata" };
  const optional = (k: string) => parseHttpsUrl(str(o, k) ?? "")?.href;
  const as: AuthServer = {
    issuer: expectedIssuer,
    authorizationEndpoint: authorizationEndpoint.href,
    tokenEndpoint: tokenEndpoint.href,
    scopesSupported: strArr(o, "scopes_supported") ?? [],
    tokenAuthMethods: strArr(o, "token_endpoint_auth_methods_supported") ?? [],
    clientIdMetadataDocuments: bool(o, "client_id_metadata_document_supported") === true,
    issParameter: bool(o, "authorization_response_iss_parameter_supported") === true,
  };
  const reg = optional("registration_endpoint");
  if (reg) as.registrationEndpoint = reg;
  const rev = optional("revocation_endpoint");
  if (rev) as.revocationEndpoint = rev;
  return { ok: true, as };
}

export type McpAuthDiscovery =
  | { ok: true; auth: "none" }
  | { ok: true; auth: "oauth"; server: string; resource: string; challengeScope?: string; scopesSupported: string[]; as: AuthServer; legacy?: true }
  | { ok: false; problem: "blocked_url" | "unreachable" | "no_resource_metadata" | "no_auth_server" | "not_mcp" | "issuer_mismatch" | "no_pkce" | "invalid_metadata" };

const PROBE = JSON.stringify({
  jsonrpc: "2.0",
  id: 0,
  method: "initialize",
  params: { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "Hermit", version: "0" } },
});

async function authServer(transport: McpTransport, issuer: string): Promise<AuthServerResult | undefined> {
  const iss = parseHttpsUrl(issuer);
  if (!iss) return undefined;
  let last: AuthServerResult | undefined;
  for (const url of authServerMetadataCandidates(iss)) {
    const r = await getChecked(transport, url, { maxBytes: METADATA_BYTES });
    if (!r.ok || r.res.status !== 200) continue;
    last = parseAuthServerMetadata(r.res.body, issuer);
    if (last.ok) return last;
  }
  return last;
}

/**
 * MCP authorization discovery (spec 2025-11-25): an unauthenticated initialize, the 401's challenge, the
 * protected resource metadata, then the first authorization server whose metadata passes. Every URL, the
 * discovered ones included, goes through `parseHttpsUrl` before it is requested. Sends no credential.
 */
export async function discoverMcpAuth(transport: McpTransport, serverUrl: string): Promise<McpAuthDiscovery> {
  const server = parseHttpsUrl(serverUrl);
  if (!server) return { ok: false, problem: "blocked_url" };
  const probe = await postChecked(transport, {
    method: "POST",
    url: server.href,
    headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
    body: PROBE,
    maxResponseBytes: METADATA_BYTES,
  });
  if (!probe.ok) return { ok: false, problem: probe.problem === "unreachable" ? "unreachable" : "blocked_url" };
  if (probe.res.status >= 200 && probe.res.status < 300) return { ok: true, auth: "none" };
  if (probe.res.status !== 401) return { ok: false, problem: "not_mcp" };
  const challenge = parseBearerChallenge(probe.res.headers["www-authenticate"]);

  let pr: ProtectedResource | undefined;
  for (const url of protectedResourceMetadataCandidates(server, challenge?.resourceMetadata)) {
    const r = await getChecked(transport, url, { maxBytes: METADATA_BYTES });
    if (r.ok && r.res.status === 200) pr = parseProtectedResourceMetadata(r.res.body, server);
    if (pr) break;
  }
  if (!pr) {
    // The 2025-03-26 layout (Atlassian, 2026-11-14): no RFC 9728 document, the authorization server on the
    // MCP server's own origin. Same origin, so it can't hand out a token meant for another server.
    const legacy = await authServer(transport, server.origin);
    if (!legacy?.ok) return { ok: false, problem: "no_resource_metadata" };
    return {
      ok: true,
      auth: "oauth",
      server: server.href,
      resource: server.href,
      ...(challenge?.scope ? { challengeScope: challenge.scope } : {}),
      scopesSupported: [],
      as: legacy.as,
      legacy: true,
    };
  }

  let failure: AuthServerResult | undefined;
  for (const issuer of pr.authorizationServers) {
    const r = await authServer(transport, issuer);
    if (r?.ok) {
      return {
        ok: true,
        auth: "oauth",
        server: server.href,
        resource: pr.resource,
        ...(challenge?.scope ? { challengeScope: challenge.scope } : {}),
        scopesSupported: pr.scopesSupported,
        as: r.as,
      };
    }
    failure = r ?? failure;
  }
  return failure && !failure.ok ? { ok: false, problem: failure.problem } : { ok: false, problem: "no_auth_server" };
}
