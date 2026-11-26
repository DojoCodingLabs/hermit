import { describe, expect, it } from "vitest";
import {
  base64url,
  beginRelaySignIn,
  completeRelaySignIn,
  discoverRelay,
  fromBase64url,
  issueProviderState,
  MemoryCredentialStore,
  oauthProviders,
  RELAY_REDIRECT_URI,
  type PendingRelaySignIn,
} from "@hermit/connectors";
import { config, NOTION_SECRET, PUBLIC_URL, random, relay, SLACK_SECRET, upstream } from "./helpers.ts";

type Relay = ReturnType<typeof relay>;

async function start(r: Relay, provider = "slack", scopes = ["chat:write"]) {
  const found = await discoverRelay(r.transport, PUBLIC_URL);
  if (!found.ok) throw new Error(found.problem);
  const begun = await beginRelaySignIn({ info: found.info, provider: oauthProviders[provider]!, connectorId: provider, scopes, source: "own_relay", transport: r.transport, random, now: r.now });
  if ("problem" in begun) throw new Error(begun.problem);
  return begun;
}

const stateOf = (authorizationUrl: string) => decodeURIComponent(/[?&]state=([^&]+)/.exec(authorizationUrl)![1]!);

/** The provider sends the browser to the relay's callback; the relay answers with a redirect to the app. */
async function providerReturns(r: Relay, authorizationUrl: string, extra = "code=provider-code-1") {
  return r.handle({ method: "GET", url: `/v1/callback?${extra}&state=${encodeURIComponent(stateOf(authorizationUrl))}`, headers: {}, body: "", clientKey: "browser" });
}

async function signIn(r: Relay, provider = "slack") {
  const { authorizationUrl, pending } = await start(r, provider);
  const back = await providerReturns(r, authorizationUrl);
  const credentials = new MemoryCredentialStore();
  const done = await completeRelaySignIn({ transport: r.transport, credentials, now: r.now, newId: () => "cred-1" }, pending, back.headers.location!);
  return { done, credentials, back, pending };
}

const secretsIn = (text: string, pending?: PendingRelaySignIn) =>
  ["provider-code-1", "xoxb-real-token", SLACK_SECRET, NOTION_SECRET, "secret_notion_token", ...(pending ? [pending.state] : [])].filter((s) => text.includes(s));

describe("the reference relay: discovery", () => {
  it("lists its providers with their public client IDs and its callback; never a secret", async () => {
    const r = relay();
    const res = await r.handle({ method: "GET", url: "/v1/providers", headers: {}, body: "", clientKey: "a" });
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ protocol: "hermit-relay-1", callback: `${PUBLIC_URL}/v1/callback`, providers: [{ id: "slack", clientId: "123.456" }, { id: "notion", clientId: "notion-client-1" }] });
    expect(secretsIn(res.body)).toEqual([]);
  });

  it("answers with no CORS headers at all, and refuses preflight", async () => {
    const r = relay();
    const get = await r.handle({ method: "GET", url: "/v1/providers", headers: { origin: "https://evil.example.com" }, body: "", clientKey: "a" });
    const pre = await r.handle({ method: "OPTIONS", url: "/v1/token", headers: { origin: "https://evil.example.com", "access-control-request-method": "POST" }, body: "", clientKey: "a" });
    for (const res of [get, pre]) expect(Object.keys(res.headers).filter((h) => h.startsWith("access-control-"))).toEqual([]);
    expect(pre.status).toBe(405);
    expect(get.headers["cache-control"]).toBe("no-store");
    expect(get.headers["referrer-policy"]).toBe("no-referrer");
  });

  it("unknown paths are 404 and wrong methods 405", async () => {
    const r = relay();
    expect((await r.handle({ method: "GET", url: "/admin", headers: {}, body: "", clientKey: "a" })).status).toBe(404);
    expect((await r.handle({ method: "POST", url: "/v1/providers", headers: {}, body: "", clientKey: "a" })).status).toBe(405);
    expect((await r.handle({ method: "GET", url: "/v1/token", headers: {}, body: "", clientKey: "a" })).status).toBe(405);
  });
});

describe("the reference relay: callback", () => {
  it("seals the code and sends the browser to the app with only the phone's state", async () => {
    const r = relay();
    const { authorizationUrl, pending } = await start(r);
    const res = await providerReturns(r, authorizationUrl);
    expect(res.status).toBe(302);
    const location = res.headers.location!;
    expect(location.startsWith(`${RELAY_REDIRECT_URI}?code=`)).toBe(true);
    expect(location.endsWith(`&state=${pending.state}`)).toBe(true);
    expect(location).not.toContain("provider-code-1");
  });

  it("forwards the user's refusal as a code, never the provider's text", async () => {
    const r = relay();
    const { authorizationUrl, pending } = await start(r);
    const denied = await providerReturns(r, authorizationUrl, "error=access_denied");
    expect(denied.headers.location).toBe(`${RELAY_REDIRECT_URI}?error=access_denied&state=${pending.state}`);
    const other = await providerReturns(r, authorizationUrl, "error=%3Cscript%3E&error_description=evil");
    expect(other.headers.location).toBe(`${RELAY_REDIRECT_URI}?error=provider_error&state=${pending.state}`);
  });

  it("a malformed state, an unknown provider or a duplicate parameter gets no redirect", async () => {
    const r = relay();
    const { authorizationUrl } = await start(r);
    const state = stateOf(authorizationUrl);
    for (const url of [
      "/v1/callback?code=abc&state=nonsense",
      `/v1/callback?code=abc&state=${encodeURIComponent(state.replace(".slack.", ".github."))}`,
      `/v1/callback?code=abc&code=def&state=${encodeURIComponent(state)}`,
      `/v1/callback?state=${encodeURIComponent(state)}`,
    ]) {
      const res = await r.handle({ method: "GET", url, headers: {}, body: "", clientKey: "b" });
      expect(res.status, url).toBe(400);
      expect(res.headers.location).toBeUndefined();
    }
  });

  const callbackWith = (r: Relay, state: string) => r.handle({ method: "GET", url: `/v1/callback?code=victim-code&state=${encodeURIComponent(state)}`, headers: {}, body: "", clientKey: "b" });
  const asked = { provider: "slack", state: base64url(new Uint8Array(24).fill(4)), challenge: base64url(new Uint8Array(32).fill(5)), key: base64url(new Uint8Array(32).fill(6)) };

  it("a state this relay never issued gets no sealed code: made up, or issued by another relay", async () => {
    const r = relay();
    const foreignKey = fromBase64url("b3RoZXIta2V5LWZvci10ZXN0cy1vbmx5LTMyLWJ5dGVzLWxvbmc")!;
    for (const state of [`h1.slack.${asked.state}.${asked.challenge}.${asked.key}`, issueProviderState(foreignKey, asked, r.now() + 600_000)]) {
      const res = await callbackWith(r, state);
      expect(res.status).toBe(400);
      expect(res.headers.location).toBeUndefined();
    }
  });

  it("an issued state with another challenge or key swapped in gets no sealed code (code injection)", async () => {
    const r = relay();
    const { authorizationUrl } = await start(r);
    const issued = stateOf(authorizationUrl);
    const parts = issued.split(".");
    for (const i of [3, 4]) {
      const swapped = parts.map((x, j) => (j === i ? asked.challenge : x)).join(".");
      const res = await callbackWith(r, swapped);
      expect(res.status, `part ${i}`).toBe(400);
      expect(res.headers.location).toBeUndefined();
    }
  });

  it("an issued state that expired gets no sealed code", async () => {
    const r = relay();
    const { authorizationUrl } = await start(r);
    r.advance(10 * 60_000 + 1000);
    const res = await callbackWith(r, stateOf(authorizationUrl));
    expect(res.status).toBe(400);
    expect(res.headers.location).toBeUndefined();
  });
});

describe("the reference relay: start", () => {
  const start1 = (r: Relay, body: unknown, headers: Record<string, string> = { "content-type": "application/json" }) =>
    r.handle({ method: "POST", url: "/v1/start", headers, body: JSON.stringify(body), clientKey: "phone" });
  const asked = { protocol: "hermit-relay-1", provider: "slack", state: base64url(new Uint8Array(24).fill(4)), challenge: base64url(new Uint8Array(32).fill(5)), key: base64url(new Uint8Array(32).fill(6)) };

  it("issues a state carrying exactly the phone's values, valid for ten minutes", async () => {
    const r = relay();
    const res = await start1(r, asked);
    expect(res.status).toBe(200);
    const { state } = JSON.parse(res.body) as { state: string };
    expect(state.startsWith(`h2.slack.${asked.state}.${asked.challenge}.${asked.key}.`)).toBe(true);
  });

  it("refuses a provider it doesn't serve, a loose body, another content type and a browser origin", async () => {
    const r = relay();
    expect(JSON.parse((await start1(r, { ...asked, provider: "github" })).body).error).toBe("unknown_provider");
    expect(JSON.parse((await start1(r, { ...asked, extra: 1 })).body).error).toBe("invalid_request");
    expect((await start1(r, asked, { "content-type": "text/plain" })).status).toBe(415);
    expect((await start1(r, asked, { "content-type": "application/json", origin: "https://evil.example.com" })).status).toBe(403);
  });
});

describe("the reference relay: token exchange (FR-CONN-07)", () => {
  it("a full Slack sign-in: the secret goes only to Slack, the tokens only to the phone's credential store", async () => {
    const r = relay();
    const { done, credentials, pending } = await signIn(r);
    expect(done).toEqual({ ok: true, meta: expect.objectContaining({ connectorId: "slack", source: "own_relay", clientId: "123.456", scopes: ["chat:write"] }) });
    expect(await credentials.reveal("cred-1")).toEqual({ kind: "oauth2", accessToken: "xoxb-real-token" });
    const [call] = r.upstream.calls;
    expect(call!.url).toBe(oauthProviders.slack!.tokenUrl);
    expect(call!.headers["content-type"]).toBe("application/x-www-form-urlencoded");
    expect(new URLSearchParams(call!.body).get("client_secret")).toBe(SLACK_SECRET);
    expect(new URLSearchParams(call!.body).get("code")).toBe("provider-code-1");
    expect(new URLSearchParams(call!.body).get("redirect_uri")).toBe(`${PUBLIC_URL}/v1/callback`);
    expect(new URLSearchParams(call!.body).get("code_verifier")).toBeNull();
    // Logs: route, status and timing only.
    expect(secretsIn(JSON.stringify(r.logs), pending)).toEqual([]);
    expect(JSON.stringify(r.logs)).not.toMatch(/phone|browser|code=|verifier/);
  });

  it("Notion gets its secret as HTTP Basic and a JSON body", async () => {
    const up = upstream(() => ({ status: 200, body: JSON.stringify({ access_token: "secret_notion_token", token_type: "bearer", bot_id: "b1", workspace_name: "Acme" }) }));
    const r = relay({ fetch: up.fetch });
    const { done, credentials } = await signIn(r, "notion");
    expect(done.ok).toBe(true);
    expect(await credentials.reveal("cred-1")).toEqual({ kind: "oauth2", accessToken: "secret_notion_token" });
    const [call] = up.calls;
    expect(call!.headers.authorization).toBe(`Basic ${Buffer.from(`notion-client-1:${NOTION_SECRET}`).toString("base64")}`);
    expect(JSON.parse(call!.body)).toEqual({ grant_type: "authorization_code", code: "provider-code-1", redirect_uri: `${PUBLIC_URL}/v1/callback` });
  });

  it("the answer the relay sends is encrypted: no token in it", async () => {
    const r = relay();
    const { authorizationUrl, pending } = await start(r);
    const back = await providerReturns(r, authorizationUrl);
    let answer = "";
    const spy = { send: async (req: Parameters<typeof r.transport.send>[0]) => { const res = await r.transport.send(req); answer = res.body; return res; } };
    await completeRelaySignIn({ transport: spy, credentials: new MemoryCredentialStore(), now: r.now, newId: () => "c" }, pending, back.headers.location!);
    expect(answer).toContain("sealed");
    expect(secretsIn(answer)).toEqual([]);
  });

  it("stores nothing: a second relay with the same configuration finishes a sign-in the first one began", async () => {
    const a = relay();
    const { authorizationUrl, pending } = await start(a);
    const back = await providerReturns(a, authorizationUrl);
    const b = relay();
    const done = await completeRelaySignIn({ transport: b.transport, credentials: new MemoryCredentialStore(), now: a.now, newId: () => "c" }, pending, back.headers.location!);
    expect(done.ok).toBe(true);
  });

  const exchange = (r: Relay, body: Record<string, unknown>, headers: Record<string, string> = { "content-type": "application/json" }) =>
    r.handle({ method: "POST", url: "/v1/token", headers, body: JSON.stringify(body), clientKey: "phone" });

  async function sealed(r: Relay) {
    const { authorizationUrl } = await start(r);
    const back = await providerReturns(r, authorizationUrl);
    return decodeURIComponent(/code=([^&]+)/.exec(back.headers.location!)![1]!);
  }

  const valid = (code: string) => ({ protocol: "hermit-relay-1", provider: "slack", code, code_verifier: "v".repeat(43), redirect_uri: `${PUBLIC_URL}/v1/callback` });

  it("a PKCE mismatch is refused and the provider is never called", async () => {
    const r = relay();
    const res = await exchange(r, valid(await sealed(r)));
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body)).toEqual({ protocol: "hermit-relay-1", error: "pkce_mismatch" });
    expect(r.upstream.calls).toEqual([]);
  });

  it("a tampered sealed code is refused", async () => {
    const r = relay();
    const code = await sealed(r);
    const res = await exchange(r, valid(`${code.slice(0, 20)}${code[20] === "A" ? "B" : "A"}${code.slice(21)}`));
    expect(JSON.parse(res.body).error).toBe("invalid_request");
    expect(r.upstream.calls).toEqual([]);
  });

  it("a sealed code from a relay with another key is refused", async () => {
    const other = relay({ config: config({ HERMIT_RELAY_SEAL_KEY: "b3RoZXIta2V5LWZvci10ZXN0cy1vbmx5LTMyLWJ5dGVzLWxvbmc" }) });
    const r = relay();
    const res = await exchange(r, valid(await sealed(other)));
    expect(JSON.parse(res.body).error).toBe("invalid_request");
  });

  it("a code older than ten minutes is expired", async () => {
    const r = relay();
    const code = await sealed(r);
    r.advance(10 * 60_000 + 1);
    expect(JSON.parse((await exchange(r, valid(code))).body).error).toBe("expired");
  });

  it("a code sealed for one provider can't be spent at another", async () => {
    const r = relay();
    const res = await exchange(r, { ...valid(await sealed(r)), provider: "notion" });
    expect(JSON.parse(res.body).error).toBe("invalid_request");
  });

  it("a redirect other than the relay's own callback is refused", async () => {
    const r = relay();
    const res = await exchange(r, { ...valid(await sealed(r)), redirect_uri: "https://evil.example.com/cb" });
    expect(JSON.parse(res.body).error).toBe("redirect_mismatch");
  });

  it("a provider the relay doesn't serve is refused", async () => {
    const r = relay();
    expect(JSON.parse((await exchange(r, { ...valid("abc"), provider: "github" })).body).error).toBe("unknown_provider");
  });

  it("anything but a strict JSON token request is refused: extra fields, another content type, a browser origin", async () => {
    const r = relay();
    const code = await sealed(r);
    expect(JSON.parse((await exchange(r, { ...valid(code), client_secret: "x" })).body).error).toBe("invalid_request");
    expect((await exchange(r, valid(code), { "content-type": "text/plain" })).status).toBe(415);
    expect((await exchange(r, valid(code), { "content-type": "application/json", origin: "https://evil.example.com" })).status).toBe(403);
  });

  it("the provider refusing the code, or answering with an error, is exchange_refused", async () => {
    for (const answer of [{ status: 400, body: '{"error":"invalid_grant"}' }, { status: 200, body: '{"ok":false,"error":"invalid_code"}' }, { status: 200, body: "<html>" }]) {
      const up = upstream(() => answer);
      const r = relay({ fetch: up.fetch });
      const { done } = await signIn(r);
      expect(done, answer.body).toEqual({ ok: false, problem: "exchange_refused" });
    }
  });

  it("the provider unreachable, failing or redirecting is upstream_unavailable", async () => {
    for (const answer of [() => Promise.reject(new Error("ECONNRESET")), () => ({ status: 503, body: "" }), () => ({ status: 302, body: "" })]) {
      const up = upstream(answer as never);
      const r = relay({ fetch: up.fetch });
      const { done } = await signIn(r);
      expect(done).toEqual({ ok: false, problem: "unreachable" });
    }
  });
});

describe("the reference relay: rate limit", () => {
  it("limits each client per minute, then lets it through again", async () => {
    const r = relay({ config: config({ HERMIT_RELAY_RATE_PER_MINUTE: "3" }) });
    const get = (clientKey: string) => r.handle({ method: "GET", url: "/v1/providers", headers: {}, body: "", clientKey });
    for (let i = 0; i < 3; i++) expect((await get("a")).status).toBe(200);
    const limited = await get("a");
    expect(limited.status).toBe(429);
    expect(limited.headers["retry-after"]).toBeDefined();
    expect((await get("b")).status).toBe(200);
    r.advance(60_000);
    expect((await get("a")).status).toBe(200);
    expect(JSON.stringify(r.logs)).not.toMatch(/"a"|"b"/);
  });

  it("the health check is not rate limited and says nothing", async () => {
    const r = relay({ config: config({ HERMIT_RELAY_RATE_PER_MINUTE: "1" }) });
    for (let i = 0; i < 3; i++) expect(await r.handle({ method: "GET", url: "/healthz", headers: {}, body: "", clientKey: "a" })).toMatchObject({ status: 200, body: "ok" });
  });
});
