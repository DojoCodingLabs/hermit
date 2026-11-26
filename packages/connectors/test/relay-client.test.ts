import { describe, expect, it } from "vitest";
import { utf8ToBytes } from "@noble/hashes/utils.js";
import {
  base64url,
  beginRelaySignIn,
  completeRelaySignIn,
  discoverRelay,
  freshOAuthCredential,
  MemoryCredentialStore,
  oauthProviders,
  parseRelayBase,
  readRelayCallback,
  RELAY_REDIRECT_URI,
  type ConnectorRequest,
  type ConnectorResponse,
  type ConnectorTransport,
  type RelayTokens,
} from "../src/index.ts";
import { issueProviderState, openCode, parseStartRequest, parseTokenRequest, sealCode, sealTokens, verifierMatches, verifyProviderState } from "../src/relay-protocol.ts";

const NOW = 1_800_000_000_000;
const BASE = "https://relay.example.org";
const CALLBACK = `${BASE}/v1/callback`;
const SEAL_KEY = new Uint8Array(32).fill(7);
let counter = 1;
const random = (n: number) => new Uint8Array(n).fill(counter++ % 250);

const query = (url: string) =>
  new Map((url.split("?")[1] ?? "").split("&").map((pair) => pair.split("=").map(decodeURIComponent) as [string, string]));

const jwt = (claims: Record<string, unknown>) => `${base64url(utf8ToBytes('{"alg":"none"}'))}.${base64url(utf8ToBytes(JSON.stringify(claims)))}.sig`;

/**
 * A relay built from the same protocol functions the reference relay uses, with hooks to misbehave. It records
 * every request so a test can show what left the phone.
 */
function fakeRelay(opts: { clientId?: string; tokens?: RelayTokens; lieClientId?: string; lieProvider?: string; lieState?: string; status?: number; providers?: unknown; issue?: (asked: { provider: string; state: string; challenge: string; key: string }) => string } = {}) {
  const sent: ConnectorRequest[] = [];
  const transport: ConnectorTransport = {
    async send(req): Promise<ConnectorResponse> {
      sent.push(req);
      if (req.method === "GET" && req.url === `${BASE}/v1/providers`) {
        return { status: 200, body: JSON.stringify({ protocol: "hermit-relay-1", callback: CALLBACK, providers: opts.providers ?? [{ id: "slack", clientId: opts.clientId ?? "123.456" }, { id: "notion", clientId: "n-1" }] }) };
      }
      if (req.method === "POST" && req.url === `${BASE}/v1/start`) {
        const asked = parseStartRequest(typeof req.body === "string" ? req.body : "");
        if (!asked) return { status: 400, body: JSON.stringify({ protocol: "hermit-relay-1", error: "invalid_request" }) };
        const state = opts.issue ? opts.issue(asked) : issueProviderState(SEAL_KEY, asked, NOW + 600_000);
        return { status: 200, body: JSON.stringify({ protocol: "hermit-relay-1", state }) };
      }
      if (req.method === "POST" && req.url === `${BASE}/v1/token`) {
        if (opts.status) return { status: opts.status, body: JSON.stringify({ protocol: "hermit-relay-1", error: "pkce_mismatch" }) };
        const body = parseTokenRequest(typeof req.body === "string" ? req.body : (req.body?.reveal() ?? ""));
        if (!body) return { status: 400, body: JSON.stringify({ protocol: "hermit-relay-1", error: "invalid_request" }) };
        const opened = openCode(SEAL_KEY, body.code, NOW);
        if (!opened.ok) return { status: 400, body: JSON.stringify({ protocol: "hermit-relay-1", error: opened.error }) };
        if (!verifierMatches(body.code_verifier, opened.claims.challenge)) return { status: 400, body: JSON.stringify({ protocol: "hermit-relay-1", error: "pkce_mismatch" }) };
        const sealed = sealTokens({
          provider: opts.lieProvider ?? opened.claims.provider,
          clientId: opts.lieClientId ?? opts.clientId ?? "123.456",
          state: opts.lieState ?? opened.claims.state,
          key: opened.claims.key,
          tokens: opts.tokens ?? { access_token: "xoxb-the-token", token_type: "bot", scope: "chat:write,channels:read" },
        }, random(32));
        return { status: 200, body: JSON.stringify({ protocol: "hermit-relay-1", sealed }) };
      }
      return { status: 404, body: "" };
    },
  };
  /** What the relay's callback does with the provider's redirect: seal the code and send the phone its own state. */
  const callback = (authorizationUrl: string, code = "provider-code-1") => {
    const q = query(authorizationUrl);
    const checked = verifyProviderState(SEAL_KEY, q.get("state") ?? "", NOW);
    if (!checked.ok) throw new Error(checked.error);
    const st = checked.state;
    const sealed = sealCode(SEAL_KEY, { provider: st.provider, state: st.state, challenge: st.challenge, key: st.key, code, expiresAt: st.expiresAt }, random(24));
    return `${RELAY_REDIRECT_URI}?code=${sealed}&state=${st.state}`;
  };
  return { transport, sent, callback };
}

async function begin(relay: ReturnType<typeof fakeRelay>, provider = "slack") {
  const found = await discoverRelay(relay.transport, BASE);
  if (!found.ok) throw new Error(found.problem);
  const started = await beginRelaySignIn({ info: found.info, provider: oauthProviders[provider]!, connectorId: provider, scopes: ["chat:write", "channels:read"], source: "own_relay", transport: relay.transport, random, now: () => NOW });
  if ("problem" in started) throw new Error(started.problem);
  return started;
}

const deps = (relay: ReturnType<typeof fakeRelay>, credentials = new MemoryCredentialStore()) => ({ transport: relay.transport, credentials, now: () => NOW + 1000, newId: () => "cred-1" });

describe("the relay address (US-CONN-09)", () => {
  it("accepts a public https address, without a trailing slash", () => {
    expect(parseRelayBase("https://relay.example.org")?.href).toBe("https://relay.example.org/");
    expect(parseRelayBase("https://example.org/hermit/relay/")?.path).toBe("/hermit/relay");
  });

  it("refuses private, LAN and loopback hosts, plain http, other ports and user info", () => {
    for (const bad of [
      "http://relay.example.org",
      "https://localhost",
      "https://127.0.0.1",
      "https://10.0.0.8",
      "https://192.168.1.20",
      "https://[::1]",
      "https://0x7f000001",
      "https://router.local",
      "https://nas.lan",
      "https://relay.home.arpa",
      "https://relay.internal",
      "https://relay.example.org:8443",
      "https://user:pw@relay.example.org",
      "https://relay.example.org/?x=1",
      "https://relay.example.org/#x",
      "relay.example.org",
      "",
    ]) expect(parseRelayBase(bad), bad).toBeUndefined();
  });

  it("discovery reads the providers the relay offers and the callback on its own origin", async () => {
    const relay = fakeRelay();
    const found = await discoverRelay(relay.transport, BASE);
    expect(found).toEqual({ ok: true, info: { base: BASE, host: "relay.example.org", callback: CALLBACK, providers: [{ id: "slack", clientId: "123.456" }, { id: "notion", clientId: "n-1" }] } });
    expect(relay.sent.map((r) => `${r.method} ${r.url}`)).toEqual([`GET ${BASE}/v1/providers`]);
  });

  it("a private address is refused before any request", async () => {
    const relay = fakeRelay();
    expect(await discoverRelay(relay.transport, "https://192.168.0.2")).toEqual({ ok: false, problem: "bad_address" });
    expect(relay.sent).toEqual([]);
  });

  it("a relay whose callback points elsewhere is not a relay", async () => {
    const transport: ConnectorTransport = { send: async () => ({ status: 200, body: JSON.stringify({ protocol: "hermit-relay-1", callback: "https://evil.example.com/v1/callback", providers: [] }) }) };
    expect(await discoverRelay(transport, BASE)).toEqual({ ok: false, problem: "not_a_relay" });
    const html: ConnectorTransport = { send: async () => ({ status: 200, body: "<html>" }) };
    expect(await discoverRelay(html, BASE)).toEqual({ ok: false, problem: "not_a_relay" });
    const down: ConnectorTransport = { send: async () => { throw new Error("offline"); } };
    expect(await discoverRelay(down, BASE)).toEqual({ ok: false, problem: "unreachable" });
    const moved: ConnectorTransport = { send: async () => ({ status: 302, body: "" }) };
    expect(await discoverRelay(moved, BASE)).toEqual({ ok: false, problem: "unreachable" });
  });
});

describe("signing in through a relay (FR-CONN-07)", () => {
  it("the provider sees the relay's client and callback, the phone's state, challenge and key; never a secret", async () => {
    const relay = fakeRelay();
    const { authorizationUrl } = await begin(relay);
    expect(authorizationUrl.split("?")[0]).toBe(oauthProviders.slack!.authorizationUrl);
    const q = query(authorizationUrl);
    expect(q.get("client_id")).toBe("123.456");
    expect(q.get("redirect_uri")).toBe(CALLBACK);
    expect(q.get("scope")).toBe("chat:write,channels:read");
    expect(q.has("code_challenge")).toBe(false);
    expect(verifyProviderState(SEAL_KEY, q.get("state")!, NOW)).toMatchObject({ ok: true, state: { provider: "slack" } });
    expect(authorizationUrl).not.toMatch(/secret/i);
  });

  it("a provider the relay doesn't offer, or one that needs no relay, can't start", async () => {
    const relay = fakeRelay();
    const found = await discoverRelay(relay.transport, BASE);
    if (!found.ok) throw new Error();
    expect(await beginRelaySignIn({ info: found.info, provider: oauthProviders.github!, connectorId: "github", scopes: [], source: "own_relay", transport: relay.transport, random, now: () => NOW })).toEqual({ problem: "provider_not_offered" });
    expect(await beginRelaySignIn({ info: found.info, provider: oauthProviders.google!, connectorId: "x", scopes: [], source: "own_relay", transport: relay.transport, random, now: () => NOW })).toEqual({ problem: "no_relay_needed" });
  });

  it("the relay issues the provider state; one that doesn't carry this sign-in's values, or lives too long, is refused", async () => {
    const other = base64url(new Uint8Array(32).fill(3));
    for (const issue of [
      (a: { provider: string; state: string; challenge: string; key: string }) => issueProviderState(SEAL_KEY, { ...a, challenge: other }, NOW + 600_000),
      (a: { provider: string; state: string; challenge: string; key: string }) => issueProviderState(SEAL_KEY, { ...a, key: other }, NOW + 600_000),
      (a: { provider: string; state: string; challenge: string; key: string }) => issueProviderState(SEAL_KEY, a, NOW + 24 * 3_600_000),
      (a: { provider: string; state: string; challenge: string; key: string }) => issueProviderState(SEAL_KEY, a, NOW - 1000),
      () => "nonsense",
    ]) {
      const relay = fakeRelay({ issue });
      const found = await discoverRelay(relay.transport, BASE);
      if (!found.ok) throw new Error();
      expect(await beginRelaySignIn({ info: found.info, provider: oauthProviders.slack!, connectorId: "slack", scopes: [], source: "own_relay", transport: relay.transport, random, now: () => NOW })).toEqual({ problem: "not_a_relay" });
    }
  });

  it("the whole sign-in stores the tokens only in the credential store, and returns none", async () => {
    const relay = fakeRelay();
    const { authorizationUrl, pending } = await begin(relay);
    const credentials = new MemoryCredentialStore();
    const done = await completeRelaySignIn(deps(relay, credentials), pending, relay.callback(authorizationUrl));
    expect(done).toEqual({ ok: true, meta: { id: "cred-1", connectorId: "slack", kind: "oauth2", source: "own_relay", scopes: ["chat:write", "channels:read"], clientId: "123.456", createdAt: NOW + 1000 } });
    expect(JSON.stringify(done)).not.toContain("xoxb");
    expect(await credentials.reveal("cred-1")).toEqual({ kind: "oauth2", accessToken: "xoxb-the-token" });
    // The relay got the sealed code and the verifier, never the phone's private key.
    const post = relay.sent.at(-1)!;
    expect(post.body).toBeTypeOf("object");
    expect(String(post.body)).toBe("[secret]");
    expect(JSON.stringify(pending)).not.toMatch(/verifier|secretKey/);
  });

  it("a sign-in can't be completed twice", async () => {
    const relay = fakeRelay();
    const { authorizationUrl, pending } = await begin(relay);
    const back = relay.callback(authorizationUrl);
    expect((await completeRelaySignIn(deps(relay), pending, back)).ok).toBe(true);
    expect(await completeRelaySignIn(deps(relay), pending, back)).toEqual({ ok: false, problem: "already_used" });
  });

  it("a tampered state is refused before anything is sent", async () => {
    const relay = fakeRelay();
    const { authorizationUrl, pending } = await begin(relay);
    const back = relay.callback(authorizationUrl).replace(/state=([^&]+)/, (_, s: string) => `state=${s.slice(0, -1)}${s.endsWith("A") ? "B" : "A"}`);
    const before = relay.sent.length;
    expect(await completeRelaySignIn(deps(relay), pending, back)).toEqual({ ok: false, problem: "state_mismatch" });
    expect(relay.sent.length).toBe(before);
  });

  it("a callback for another redirect, with a duplicate or missing parameter, is refused", async () => {
    const relay = fakeRelay();
    const { authorizationUrl, pending } = await begin(relay);
    const back = relay.callback(authorizationUrl);
    expect(readRelayCallback(pending, back.replace("hermit://oauth/relay", "hermit://oauth/mcp"), NOW)).toEqual({ ok: false, problem: "bad_callback" });
    expect(readRelayCallback(pending, `${back}&state=x`, NOW)).toEqual({ ok: false, problem: "bad_callback" });
    expect(readRelayCallback(pending, back.replace(/code=[^&]+&/, ""), NOW)).toEqual({ ok: false, problem: "bad_callback" });
  });

  it("the user saying no comes back as denied; a late return as expired", async () => {
    const relay = fakeRelay();
    const { pending } = await begin(relay);
    expect(readRelayCallback(pending, `${RELAY_REDIRECT_URI}?error=access_denied&state=${pending.state}`, NOW)).toEqual({ ok: false, problem: "denied" });
    expect(readRelayCallback(pending, `${RELAY_REDIRECT_URI}?error=server_error&state=${pending.state}`, NOW)).toEqual({ ok: false, problem: "provider_error" });
    expect(readRelayCallback(pending, `${RELAY_REDIRECT_URI}?code=abc&state=${pending.state}`, NOW + 600_001)).toEqual({ ok: false, problem: "expired" });
  });

  it("a PKCE mismatch at the relay ends the sign-in with nothing stored", async () => {
    const relay = fakeRelay({ status: 400 });
    const { authorizationUrl, pending } = await begin(relay);
    const credentials = new MemoryCredentialStore();
    expect(await completeRelaySignIn(deps(relay, credentials), pending, relay.callback(authorizationUrl))).toEqual({ ok: false, problem: "pkce_mismatch" });
    expect(await credentials.list()).toEqual([]);
  });

  it("a code intercepted on the way back is useless without this sign-in's verifier", async () => {
    const relay = fakeRelay();
    const a = await begin(relay);
    const b = await begin(relay);
    // B's verifier with A's sealed code: the relay refuses, because the code is bound to A's challenge.
    const stolen = relay.callback(a.authorizationUrl).replace(/state=.*/, `state=${b.pending.state}`);
    expect(await completeRelaySignIn(deps(relay), b.pending, stolen)).toEqual({ ok: false, problem: "pkce_mismatch" });
  });

  it("tokens issued to another client are refused", async () => {
    const relay = fakeRelay({ lieClientId: "999.999" });
    const { authorizationUrl, pending } = await begin(relay);
    const credentials = new MemoryCredentialStore();
    expect(await completeRelaySignIn(deps(relay, credentials), pending, relay.callback(authorizationUrl))).toEqual({ ok: false, problem: "wrong_client" });
    expect(await credentials.list()).toEqual([]);
  });

  it("tokens for another provider or another sign-in are refused", async () => {
    for (const [lie, problem] of [[{ lieProvider: "notion" }, "wrong_client"], [{ lieState: base64url(new Uint8Array(24).fill(1)) }, "tampered"]] as const) {
      const relay = fakeRelay(lie);
      const { authorizationUrl, pending } = await begin(relay);
      expect(await completeRelaySignIn(deps(relay), pending, relay.callback(authorizationUrl))).toEqual({ ok: false, problem });
    }
  });

  it("an ID token or JWT access token for another audience is refused", async () => {
    for (const tokens of [
      { access_token: "a", id_token: jwt({ aud: "someone-else", iss: "x" }) },
      { access_token: "a", id_token: jwt({ aud: ["123.456"], azp: "someone-else" }) },
      { access_token: jwt({ client_id: "someone-else" }) },
      { access_token: jwt({ azp: "someone-else" }) },
      { access_token: "a", id_token: "not-a-jwt" },
    ]) {
      const relay = fakeRelay({ tokens });
      const { authorizationUrl, pending } = await begin(relay);
      expect(await completeRelaySignIn(deps(relay), pending, relay.callback(authorizationUrl)), JSON.stringify(tokens)).toEqual({ ok: false, problem: "wrong_audience" });
    }
  });

  it("an ID token for this client is accepted", async () => {
    const relay = fakeRelay({ tokens: { access_token: jwt({ client_id: "123.456" }), id_token: jwt({ aud: "123.456" }), token_type: "Bearer", expires_in: 3600, refresh_token: "r1" } });
    const { authorizationUrl, pending } = await begin(relay);
    const credentials = new MemoryCredentialStore();
    const done = await completeRelaySignIn(deps(relay, credentials), pending, relay.callback(authorizationUrl));
    expect(done).toMatchObject({ ok: true, meta: { expiresAt: NOW + 1000 + 3_600_000 } });
    expect(await credentials.reveal("cred-1")).toMatchObject({ refreshToken: "r1" });
  });

  it("a token that isn't a bearer token is refused", async () => {
    const relay = fakeRelay({ tokens: { access_token: "a", token_type: "DPoP" } });
    const { authorizationUrl, pending } = await begin(relay);
    expect(await completeRelaySignIn(deps(relay), pending, relay.callback(authorizationUrl))).toEqual({ ok: false, problem: "not_bearer" });
  });

  it("a relay answer that doesn't open with this sign-in's key is tampered", async () => {
    const relay = fakeRelay();
    const { authorizationUrl, pending } = await begin(relay);
    const back = relay.callback(authorizationUrl);
    const broken: ConnectorTransport = {
      async send(req) {
        const res = await relay.transport.send(req);
        const j = JSON.parse(res.body) as { sealed: string };
        return { status: 200, body: JSON.stringify({ protocol: "hermit-relay-1", sealed: `${j.sealed.slice(0, -2)}AA` }) };
      },
    };
    expect(await completeRelaySignIn({ ...deps(relay), transport: broken }, pending, back)).toEqual({ ok: false, problem: "tampered" });
  });

  it("a relay-issued token is never refreshed from the phone: it expires and the user signs in again (Q116)", async () => {
    const relay = fakeRelay({ tokens: { access_token: "a", refresh_token: "r", expires_in: 60 } });
    const { authorizationUrl, pending } = await begin(relay);
    const credentials = new MemoryCredentialStore();
    await completeRelaySignIn(deps(relay, credentials), pending, relay.callback(authorizationUrl));
    const sent = relay.sent.length;
    const fresh = await freshOAuthCredential({ credentials, transport: relay.transport, now: () => NOW + 3_600_000 }, oauthProviders.slack, "cred-1");
    expect(fresh).toEqual({ ok: false, problem: "sign_in_again" });
    expect(relay.sent.length).toBe(sent);
  });
});
