import { describe, expect, it } from "vitest";
import {
  authServerMetadataCandidates,
  beginMcpSignIn,
  completeMcpSignIn,
  discoverMcpAuth,
  freshMcpToken,
  isAppRedirectUri,
  MemoryCredentialStore,
  parseAuthServerMetadata,
  parseBearerChallenge,
  parseHttpsUrl,
  parseProtectedResourceMetadata,
  parseRegistration,
  protectedResourceMetadataCandidates,
  readCallback,
  registrationRequest,
  type McpPendingSignIn,
} from "../src/index.ts";
import { asMeta, authRoutes, fakeNet, ISSUER, json, prm, REDIRECT, SERVER } from "./mcp-fixtures.ts";

const server = parseHttpsUrl(SERVER)!;
const form = (s: string) => Object.fromEntries(s.split("&").map((kv) => kv.split("=").map((x) => decodeURIComponent(x))));
const counterRandom = () => {
  let n = 0;
  return (len: number) => new Uint8Array(len).map(() => (n++ * 37 + 11) & 255);
};

describe("WWW-Authenticate (RFC 6750, RFC 9728 section 5.1)", () => {
  it("reads resource_metadata, scope and error from a Bearer challenge", () => {
    expect(parseBearerChallenge('Bearer realm="OAuth", resource_metadata="https://mcp.example.com/.well-known/oauth-protected-resource/mcp", scope="read write"')).toEqual({
      resourceMetadata: "https://mcp.example.com/.well-known/oauth-protected-resource/mcp",
      scope: "read write",
    });
    expect(parseBearerChallenge('Bearer error="insufficient_scope", scope="admin"')).toEqual({ error: "insufficient_scope", scope: "admin" });
    // Figma's form: no space after the comma.
    expect(parseBearerChallenge('Bearer resource_metadata="https://mcp.figma.com/.well-known/oauth-protected-resource",scope="mcp:connect"')?.scope).toBe("mcp:connect");
  });
  it("ignores other schemes and garbage", () => {
    expect(parseBearerChallenge('Basic realm="x"')).toBeUndefined();
    expect(parseBearerChallenge("")).toBeUndefined();
  });
});

describe("protected resource metadata (RFC 9728)", () => {
  it("tries the server's hint first, then the path-aware and root well-known URLs", () => {
    expect(protectedResourceMetadataCandidates(server, "https://mcp.example.com/.well-known/oauth-protected-resource/mcp")).toEqual([
      "https://mcp.example.com/.well-known/oauth-protected-resource/mcp",
      "https://mcp.example.com/.well-known/oauth-protected-resource",
    ]);
    expect(protectedResourceMetadataCandidates(parseHttpsUrl("https://mcp.example.com/")!)).toEqual(["https://mcp.example.com/.well-known/oauth-protected-resource"]);
  });
  it("drops a hint that fails the URL check", () => {
    expect(protectedResourceMetadataCandidates(server, "http://10.0.0.1/x")).toEqual([
      "https://mcp.example.com/.well-known/oauth-protected-resource/mcp",
      "https://mcp.example.com/.well-known/oauth-protected-resource",
    ]);
  });
  it("accepts a resource on the server's origin that is the server URL or a parent path of it", () => {
    expect(parseProtectedResourceMetadata(JSON.stringify(prm()), server)).toMatchObject({ resource: SERVER, authorizationServers: [ISSUER] });
    expect(parseProtectedResourceMetadata(JSON.stringify(prm({ resource: "https://mcp.example.com" })), server)?.resource).toBe("https://mcp.example.com");
  });
  it("refuses metadata that names another resource (it would mint a token for a different server)", () => {
    expect(parseProtectedResourceMetadata(JSON.stringify(prm({ resource: "https://mcp.other.com/mcp" })), server)).toBeUndefined();
    expect(parseProtectedResourceMetadata(JSON.stringify(prm({ resource: "https://mcp.example.com/mcpx" })), server)).toBeUndefined();
    expect(parseProtectedResourceMetadata(JSON.stringify(prm({ resource: "https://mcp.example.com/other" })), server)).toBeUndefined();
  });
  it("keeps only authorization servers that pass the URL check", () => {
    const p = parseProtectedResourceMetadata(JSON.stringify(prm({ authorization_servers: ["http://auth.example.com", "https://192.168.0.2", ISSUER] })), server);
    expect(p?.authorizationServers).toEqual([ISSUER]);
    expect(parseProtectedResourceMetadata(JSON.stringify(prm({ authorization_servers: ["http://x.example.com"] })), server)).toBeUndefined();
  });
});

describe("authorization server metadata (RFC 8414, OpenID discovery)", () => {
  it("builds the path-aware candidate list the MCP spec orders", () => {
    expect(authServerMetadataCandidates(parseHttpsUrl("https://auth.example.com/tenant1")!)).toEqual([
      "https://auth.example.com/.well-known/oauth-authorization-server/tenant1",
      "https://auth.example.com/.well-known/openid-configuration/tenant1",
      "https://auth.example.com/tenant1/.well-known/openid-configuration",
    ]);
    expect(authServerMetadataCandidates(parseHttpsUrl(ISSUER)!)).toEqual([
      "https://auth.example.com/.well-known/oauth-authorization-server",
      "https://auth.example.com/.well-known/openid-configuration",
    ]);
  });

  it("reads the endpoints and capabilities", () => {
    expect(parseAuthServerMetadata(JSON.stringify(asMeta({ client_id_metadata_document_supported: true, authorization_response_iss_parameter_supported: true })), ISSUER)).toEqual({
      ok: true,
      as: {
        issuer: ISSUER,
        authorizationEndpoint: `${ISSUER}/authorize`,
        tokenEndpoint: `${ISSUER}/token`,
        registrationEndpoint: `${ISSUER}/register`,
        scopesSupported: [],
        tokenAuthMethods: ["none"],
        clientIdMetadataDocuments: true,
        issParameter: true,
      },
    });
  });

  it.each([
    ["the issuer differs from where it was found (RFC 8414 section 3.3)", { issuer: "https://evil.example.com" }, "issuer_mismatch"],
    ["no S256 (the MCP spec says refuse)", { code_challenge_methods_supported: ["plain"] }, "no_pkce"],
    ["PKCE not advertised at all", { code_challenge_methods_supported: undefined }, "no_pkce"],
    ["no authorization code flow", { response_types_supported: ["token"] }, "invalid_metadata"],
    ["a token endpoint over http", { token_endpoint: "http://auth.example.com/token" }, "invalid_metadata"],
    ["an authorization endpoint on a private address", { authorization_endpoint: "https://10.1.2.3/authorize" }, "invalid_metadata"],
  ])("refuses metadata when %s", (_, over, problem) => {
    expect(parseAuthServerMetadata(JSON.stringify(asMeta(over)), ISSUER)).toEqual({ ok: false, problem });
  });

  it("drops a registration endpoint that fails the URL check instead of using it", () => {
    const r = parseAuthServerMetadata(JSON.stringify(asMeta({ registration_endpoint: "https://127.0.0.1/register" })), ISSUER);
    expect(r.ok && r.as.registrationEndpoint).toBeUndefined();
  });

  it("treats a trailing slash on a bare issuer as the same issuer", () => {
    expect(parseAuthServerMetadata(JSON.stringify(asMeta({ issuer: `${ISSUER}/` })), ISSUER).ok).toBe(true);
  });
});

describe("discoverMcpAuth", () => {
  it("finds the resource and the authorization server from the 401 challenge", async () => {
    const net = fakeNet(authRoutes());
    const d = await discoverMcpAuth(net, SERVER);
    expect(d).toMatchObject({ ok: true, auth: "oauth", resource: SERVER, challengeScope: "read", as: { issuer: ISSUER, registrationEndpoint: `${ISSUER}/register` } });
    // Probe, PRM, AS metadata: nothing else, and no credential on any of them.
    expect(net.sent.map((r) => `${r.method} ${r.url}`)).toEqual([
      `POST ${SERVER}`,
      "GET https://mcp.example.com/.well-known/oauth-protected-resource/mcp",
      "GET https://auth.example.com/.well-known/oauth-authorization-server",
    ]);
    expect(net.sent.every((r) => r.auth === undefined)).toBe(true);
  });

  it("says no sign-in is needed when the server answers initialize", async () => {
    const net = fakeNet({ [`POST ${SERVER}`]: () => json({ jsonrpc: "2.0", id: 0, result: {} }) });
    expect(await discoverMcpAuth(net, SERVER)).toEqual({ ok: true, auth: "none" });
  });

  it("falls back to the root well-known URL and then to OpenID discovery", async () => {
    const net = fakeNet(
      authRoutes({
        [`POST ${SERVER}`]: () => ({ status: 401, headers: { "www-authenticate": 'Bearer realm="x"' }, body: "" }),
        "GET https://mcp.example.com/.well-known/oauth-protected-resource/mcp": undefined,
        "GET https://mcp.example.com/.well-known/oauth-protected-resource": () => json(prm()),
        "GET https://auth.example.com/.well-known/oauth-authorization-server": undefined,
        "GET https://auth.example.com/.well-known/openid-configuration": () => json(asMeta()),
      }),
    );
    expect(await discoverMcpAuth(net, SERVER)).toMatchObject({ ok: true, auth: "oauth" });
  });

  it("falls back to authorization server metadata on the server's own origin (2025-03-26 layout, Atlassian)", async () => {
    const net = fakeNet({
      [`POST ${SERVER}`]: () => ({ status: 401, headers: { "www-authenticate": 'Bearer realm="OAuth", error="invalid_token"' }, body: "" }),
      "GET https://mcp.example.com/.well-known/oauth-authorization-server": () => json(asMeta({ issuer: "https://mcp.example.com", registration_endpoint: "https://mcp.example.com/register" })),
    });
    expect(await discoverMcpAuth(net, SERVER)).toMatchObject({ ok: true, auth: "oauth", resource: SERVER, legacy: true, as: { issuer: "https://mcp.example.com" } });
  });

  it("refuses a server URL that fails the check, and reports missing metadata", async () => {
    expect(await discoverMcpAuth(fakeNet({}), "http://mcp.example.com/mcp")).toEqual({ ok: false, problem: "blocked_url" });
    const net = fakeNet({ [`POST ${SERVER}`]: () => ({ status: 401, headers: {}, body: "" }) });
    expect(await discoverMcpAuth(net, SERVER)).toEqual({ ok: false, problem: "no_resource_metadata" });
  });
});

describe("dynamic client registration (RFC 7591)", () => {
  it("sends minimal public-client metadata: a name, the app's redirect, code and refresh grants, no secret", () => {
    const req = registrationRequest(`${ISSUER}/register`, REDIRECT);
    expect(req).toMatchObject({ method: "POST", url: `${ISSUER}/register`, headers: { "Content-Type": "application/json" } });
    expect(JSON.parse(String(req.body))).toEqual({
      client_name: "Hermit",
      redirect_uris: [REDIRECT],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    });
  });

  it("accepts only the app's own redirect URIs", () => {
    expect(isAppRedirectUri("hermit://oauth/mcp")).toBe(true);
    expect(isAppRedirectUri("https://hermit.dojocoding.io/oauth")).toBe(true);
    expect(isAppRedirectUri("https://evil.example.com/oauth")).toBe(false);
    expect(isAppRedirectUri("http://localhost:8080/cb")).toBe(false);
    expect(isAppRedirectUri("hermit://oauth/mcp?x=1")).toBe(false);
    expect(() => registrationRequest(`${ISSUER}/register`, "https://evil.example.com/cb")).toThrow();
  });

  it("reads the client id and refuses a registration that changed the redirect or needs a secret", () => {
    expect(parseRegistration(JSON.stringify({ client_id: "abc", redirect_uris: [REDIRECT] }), REDIRECT)).toEqual({ ok: true, clientId: "abc" });
    expect(parseRegistration(JSON.stringify({ client_id: "abc" }), REDIRECT)).toEqual({ ok: true, clientId: "abc" });
    expect(parseRegistration(JSON.stringify({ client_id: "abc", redirect_uris: ["https://x.example.com/cb"] }), REDIRECT)).toEqual({ ok: false, problem: "redirect_refused" });
    expect(parseRegistration(JSON.stringify({ client_id: "abc", client_secret: "s", token_endpoint_auth_method: "client_secret_basic" }), REDIRECT)).toEqual({ ok: false, problem: "needs_client_secret" });
    expect(parseRegistration(JSON.stringify({ error: "invalid_redirect_uri" }), REDIRECT)).toEqual({ ok: false, problem: "redirect_refused" });
    expect(parseRegistration("{}", REDIRECT)).toEqual({ ok: false, problem: "registration_failed" });
  });
});

async function begin(over: Parameters<typeof authRoutes>[0] = {}) {
  const net = fakeNet(authRoutes(over));
  const r = await beginMcpSignIn({ transport: net, now: () => 1_000, random: counterRandom() }, { serverUrl: SERVER, redirectUri: REDIRECT });
  return { net, r };
}

describe("beginMcpSignIn", () => {
  it("registers, then builds an authorization URL with PKCE S256, state, scope and the resource indicator", async () => {
    const { net, r } = await begin();
    if (!r.ok) throw new Error(r.problem);
    const [base, query] = r.authorizationUrl.split("?");
    expect(base).toBe(`${ISSUER}/authorize`);
    const q = form(query!);
    expect(q).toMatchObject({ response_type: "code", client_id: "dyn-client-1", redirect_uri: REDIRECT, code_challenge_method: "S256", scope: "read", resource: SERVER, state: r.pending.state });
    expect(q.code_challenge).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(r.pending.state).not.toBe(r.pending.verifier);
    expect(r.pending).toMatchObject({ clientId: "dyn-client-1", resource: SERVER, tokenEndpoint: `${ISSUER}/token`, createdAt: 1_000 });
    expect(net.sent.at(-1)?.url).toBe(`${ISSUER}/register`);
  });

  it("uses a client id the user already has instead of registering", async () => {
    const net = fakeNet(authRoutes());
    const r = await beginMcpSignIn({ transport: net, now: () => 1, random: counterRandom() }, { serverUrl: SERVER, redirectUri: REDIRECT, clientId: "own" });
    expect(r.ok && r.pending.clientId).toBe("own");
    expect(net.sent.some((s) => s.url.endsWith("/register"))).toBe(false);
  });

  it("explains when the server offers no way for a phone to register", async () => {
    const { r } = await begin({ "GET https://auth.example.com/.well-known/oauth-authorization-server": () => json(asMeta({ registration_endpoint: undefined })) });
    expect(r).toEqual({ ok: false, problem: "no_registration" });
  });

  it("refuses a server that wants a client secret", async () => {
    const { r } = await begin({ [`POST ${ISSUER}/register`]: () => json({ client_id: "x", client_secret: "s", token_endpoint_auth_method: "client_secret_post" }, 201) });
    expect(r).toEqual({ ok: false, problem: "needs_client_secret" });
  });
});

describe("readCallback: state, redirect and issuer are verified before any code is used", () => {
  const pending: McpPendingSignIn = {
    serverUrl: SERVER, resource: SERVER, issuer: ISSUER, tokenEndpoint: `${ISSUER}/token`, clientId: "c", redirectUri: REDIRECT,
    state: "state-abc-123", verifier: "v".repeat(43), scopes: ["read"], issParameter: false, createdAt: 0,
  };
  it("returns the code for the matching state", () => {
    expect(readCallback(pending, `${REDIRECT}?code=the%20code&state=state-abc-123`, 1)).toEqual({ ok: true, code: "the code" });
  });
  it.each([
    ["another state", `${REDIRECT}?code=c&state=state-abc-124`, "state_mismatch"],
    ["no state", `${REDIRECT}?code=c`, "state_mismatch"],
    ["a different redirect", `hermit://oauth/other?code=c&state=state-abc-123`, "wrong_redirect"],
    ["a prefix trick", `${REDIRECT}x?code=c&state=state-abc-123`, "wrong_redirect"],
    ["a denial", `${REDIRECT}?error=access_denied&state=state-abc-123`, "denied"],
    ["no code", `${REDIRECT}?state=state-abc-123`, "no_code"],
    ["a wrong issuer", `${REDIRECT}?code=c&state=state-abc-123&iss=https%3A%2F%2Fevil.example.com`, "issuer_mismatch"],
    ["a duplicated parameter", `${REDIRECT}?code=c&state=state-abc-123&code=d`, "invalid_callback"],
  ])("refuses %s", (_, url, problem) => {
    expect(readCallback(pending, url, 1)).toEqual({ ok: false, problem });
  });
  it("requires iss when the server promised it (RFC 9207), and expires after ten minutes", () => {
    expect(readCallback({ ...pending, issParameter: true }, `${REDIRECT}?code=c&state=state-abc-123`, 1)).toEqual({ ok: false, problem: "issuer_mismatch" });
    expect(readCallback({ ...pending, issParameter: true }, `${REDIRECT}?code=c&state=state-abc-123&iss=${encodeURIComponent(ISSUER)}`, 1).ok).toBe(true);
    expect(readCallback(pending, `${REDIRECT}?code=c&state=state-abc-123`, 10 * 60_000 + 1)).toEqual({ ok: false, problem: "expired" });
  });
});

describe("completeMcpSignIn and refresh", () => {
  it("exchanges the code with the verifier and resource, then stores the tokens only in the credential store", async () => {
    const { net, r } = await begin({
      [`POST ${ISSUER}/token`]: () => json({ access_token: "at-123456", refresh_token: "rt-123456", token_type: "Bearer", expires_in: 3600, scope: "read" }),
    });
    if (!r.ok) throw new Error(r.problem);
    const credentials = new MemoryCredentialStore();
    const done = await completeMcpSignIn({ transport: net, credentials, now: () => 2_000 }, r.pending, `${REDIRECT}?code=abc&state=${r.pending.state}`, "mcp1");
    expect(done).toMatchObject({ ok: true, meta: { id: "mcp1", connectorId: "mcp_mcp_example_com", kind: "oauth2", source: "dynamic_client", clientId: "dyn-client-1", scopes: ["read"], expiresAt: 2_000 + 3_600_000 } });
    const tokenReq = net.sent.at(-1)!;
    expect(String(tokenReq.body)).toBe("[secret]");
    const body = form((tokenReq.body as { reveal(): string }).reveal());
    expect(body).toEqual({ grant_type: "authorization_code", code: "abc", redirect_uri: REDIRECT, client_id: "dyn-client-1", code_verifier: r.pending.verifier, resource: SERVER });
    expect(await credentials.reveal("mcp1")).toEqual({ kind: "oauth2", accessToken: "at-123456", refreshToken: "rt-123456" });
    expect(JSON.stringify(done)).not.toContain("at-123456");
  });

  it("sends nothing when the callback fails verification", async () => {
    const { net, r } = await begin();
    if (!r.ok) throw new Error(r.problem);
    const before = net.sent.length;
    const done = await completeMcpSignIn({ transport: net, credentials: new MemoryCredentialStore(), now: () => 2_000 }, r.pending, `${REDIRECT}?code=abc&state=forged`, "mcp1");
    expect(done).toEqual({ ok: false, problem: "state_mismatch" });
    expect(net.sent.length).toBe(before);
  });

  it("refuses a non-bearer token and a token endpoint error", async () => {
    const { net, r } = await begin({ [`POST ${ISSUER}/token`]: () => json({ access_token: "at-123456", token_type: "mac" }) });
    if (!r.ok) throw new Error(r.problem);
    const deps = { transport: net, credentials: new MemoryCredentialStore(), now: () => 2_000 };
    expect(await completeMcpSignIn(deps, r.pending, `${REDIRECT}?code=a&state=${r.pending.state}`, "m")).toEqual({ ok: false, problem: "token_failed" });
  });

  it("refreshes an expiring token with the resource indicator and keeps the old refresh token when none comes back", async () => {
    const credentials = new MemoryCredentialStore();
    await credentials.save(
      { id: "m", connectorId: "mcp_mcp_example_com", kind: "oauth2", source: "dynamic_client", scopes: ["read"], clientId: "c", createdAt: 0, expiresAt: 1_000 },
      { kind: "oauth2", accessToken: "old-access", refreshToken: "keep-refresh" },
    );
    const net = fakeNet({ [`POST ${ISSUER}/token`]: () => json({ access_token: "new-access", expires_in: 60 }) });
    const r = await freshMcpToken({ transport: net, credentials, now: () => 500 }, { tokenEndpoint: `${ISSUER}/token`, resource: SERVER }, "m");
    expect(r.ok && r.token.reveal()).toBe("new-access");
    expect(form((net.sent[0]!.body as { reveal(): string }).reveal())).toEqual({ grant_type: "refresh_token", refresh_token: "keep-refresh", client_id: "c", resource: SERVER });
    expect(await credentials.reveal("m")).toEqual({ kind: "oauth2", accessToken: "new-access", refreshToken: "keep-refresh" });
  });

  it("asks for a new sign-in when refresh fails, and does not refresh a fresh token", async () => {
    const credentials = new MemoryCredentialStore();
    await credentials.save({ id: "m", connectorId: "x", kind: "oauth2", source: "dynamic_client", scopes: [], clientId: "c", createdAt: 0, expiresAt: 1_000 }, { kind: "oauth2", accessToken: "a-old-1", refreshToken: "r-old-1" });
    const failing = fakeNet({ [`POST ${ISSUER}/token`]: () => json({ error: "invalid_grant" }, 400) });
    expect(await freshMcpToken({ transport: failing, credentials, now: () => 999 }, { tokenEndpoint: `${ISSUER}/token`, resource: SERVER }, "m")).toEqual({ ok: false, problem: "sign_in_again" });
    const quiet = fakeNet({});
    const r = await freshMcpToken({ transport: quiet, credentials, now: () => -600_000 }, { tokenEndpoint: `${ISSUER}/token`, resource: SERVER }, "m");
    expect(r.ok && r.token.reveal()).toBe("a-old-1");
    expect(quiet.sent).toHaveLength(0);
  });
});
