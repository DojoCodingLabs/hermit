import { describe, expect, it } from "vitest";
import { sha256 } from "@noble/hashes/sha2.js";
import { utf8ToBytes } from "@noble/hashes/utils.js";
import {
  ANDROID_PACKAGE, APP_REDIRECT_URIS, APP_SCHEME, base64url, APP_SIGN_IN_TTL_MS, appRedirectUri, beginAppSignIn, finishAppSignIn, missingScopes, oauthProviders, readAppRedirect, Secret,
  type ConnectorRequest, type ConnectorResponse, type SignInOption,
} from "../src/index.ts";

/** A form or query string's fields (this package's tests have no DOM or Node URL types). */
const fields = (query: string) =>
  Object.fromEntries(query.split("&").filter(Boolean).map((kv) => kv.split("=").map((x) => decodeURIComponent(x.replace(/\+/g, " "))) as [string, string]));

const NOW = Date.UTC(2026, 10, 21, 15, 0);
const RANDOM = new Uint8Array(48).map((_, i) => (i * 53 + 3) % 256);
const google = oauthProviders.google!;
const microsoft = oauthProviders.microsoft!;
const own = (provider: string, clientId: string): SignInOption => ({ method: "oauth_pkce", provider, available: true, source: "own_client", clientId });
const GOOGLE_ID = "1-mine.apps.googleusercontent.com";
const MS_ID = "00000000-0000-0000-0000-000000000001";

function transport(reply: (req: ConnectorRequest) => ConnectorResponse) {
  const sent: ConnectorRequest[] = [];
  return { sent, send: async (req: ConnectorRequest) => (sent.push(req), reply(req)) };
}
const tokens = () => transport(() => ({ status: 200, body: JSON.stringify({ access_token: "at-0123456789", refresh_token: "rt-0123456789", expires_in: 3600, scope: "a b" }) }));

describe("where a provider's sign-in comes back to the phone (Q156, Q157)", () => {
  it("one redirect per provider, shared by every feature that signs in to it", () => {
    expect(ANDROID_PACKAGE).toBe("io.dojocoding.hermit");
    // Microsoft's is under the app's own scheme, like the MCP and relay sign-ins.
    expect(APP_REDIRECT_URIS.microsoft!.startsWith(`${APP_SCHEME}://oauth/`)).toBe(true);
    // Google's Android clients take only the package name as a custom scheme, one slash, no host.
    expect(appRedirectUri("google")).toBe("io.dojocoding.hermit:/oauth2redirect");
    // Microsoft, without MSAL or its broker: a custom redirect on "Mobile and desktop applications", in the app's scheme.
    expect(appRedirectUri("microsoft")).toBe("hermit://oauth/microsoft");
    expect(appRedirectUri("slack")).toBeUndefined();
    expect(appRedirectUri("__proto__")).toBeUndefined();
    expect(Object.keys(APP_REDIRECT_URIS).sort()).toEqual(["google", "microsoft"]);
  });

  it("reads code, state and error only from exactly that redirect URI, each at most once", () => {
    const g = APP_REDIRECT_URIS.google!;
    expect(readAppRedirect(g, `${g}?state=a%20b&code=4%2Fx&scope=email#frag`)).toEqual({ state: "a b", code: "4/x" });
    expect(readAppRedirect(g, `${g}?error=access_denied&state=s`)).toEqual({ error: "access_denied", state: "s" });
    for (const bad of [g, `${g}/x?code=c`, `io.dojocoding.hermit://oauth2redirect?code=c`, `hermit://oauth/microsoft?code=c`, `${g}?code=a&code=b`, `${g}?code=%E0%A4%A`, `${g}#code=c`]) {
      expect(readAppRedirect(g, bad), bad).toBeUndefined();
    }
  });
});

describe("a public client signs in from the phone: PKCE S256 and state before any token request", () => {
  it("begins with a fresh state and a challenge on the provider's own page, to the provider's redirect; nothing secret in the URL", () => {
    const { url, pending } = beginAppSignIn(google, own("google", GOOGLE_ID), { scopes: ["https://www.googleapis.com/auth/calendar.events"], random: RANDOM, now: NOW });
    const [page, query = ""] = url.split("?");
    const q = fields(query);
    expect(page).toBe(google.authorizationUrl);
    expect(q.redirect_uri).toBe(APP_REDIRECT_URIS.google);
    expect(q.client_id).toBe(GOOGLE_ID);
    expect(q.code_challenge_method).toBe("S256");
    expect(q.code_challenge).toBe(base64url(sha256(utf8ToBytes(pending.verifier))));
    expect(q.state).toBe(pending.state);
    expect(pending).toMatchObject({ provider: "google", clientId: GOOGLE_ID, source: "own_client", redirectUri: APP_REDIRECT_URIS.google, createdAt: NOW });
    expect(url).not.toContain(pending.verifier);
  });

  it("refuses an unavailable option, another provider's option, weak randomness or a provider with no redirect", () => {
    const input = { scopes: ["x"], random: RANDOM, now: NOW };
    expect(() => beginAppSignIn(google, { method: "oauth_pkce", provider: "google", available: false, unavailable: "needs_client_id" }, input)).toThrow();
    expect(() => beginAppSignIn(google, own("microsoft", MS_ID), input)).toThrow();
    expect(() => beginAppSignIn(google, own("google", GOOGLE_ID), { ...input, random: new Uint8Array(32) })).toThrow();
    expect(() => beginAppSignIn(oauthProviders.spotify!, own("spotify", "0123456789abcdef0123456789abcdef"), input)).toThrow(/redirect/);
  });

  it("a forged state, an expired sign-in or a cancel sends nothing; a good callback exchanges with the verifier and no secret", async () => {
    const { pending } = beginAppSignIn(microsoft, own("microsoft", MS_ID), { scopes: ["a", "b"], random: RANDOM, now: NOW });
    const t = tokens();
    const deps = { transport: t, now: () => NOW + 1000 };
    expect(await finishAppSignIn(deps, microsoft, pending, { code: "c", state: "forged" })).toEqual({ ok: false, problem: "state_mismatch" });
    expect(await finishAppSignIn(deps, microsoft, pending, { code: "c" })).toEqual({ ok: false, problem: "state_mismatch" });
    expect(await finishAppSignIn({ ...deps, now: () => NOW + APP_SIGN_IN_TTL_MS + 1 }, microsoft, pending, { code: "c", state: pending.state })).toEqual({ ok: false, problem: "expired" });
    expect(await finishAppSignIn(deps, microsoft, pending, { error: "access_denied", state: pending.state })).toEqual({ ok: false, problem: "cancelled" });
    expect(t.sent).toEqual([]);
    const r = await finishAppSignIn(deps, microsoft, pending, { code: "M.code-1", state: pending.state });
    expect(r).toMatchObject({ ok: true, token: { secret: { kind: "oauth2", accessToken: "at-0123456789", refreshToken: "rt-0123456789" }, scopes: ["a", "b"] } });
    expect(t.sent).toHaveLength(1);
    expect(t.sent[0]!.url).toBe(microsoft.tokenUrl);
    expect(t.sent[0]!.body).toBeInstanceOf(Secret);
    expect(fields((t.sent[0]!.body as Secret).reveal())).toEqual({ grant_type: "authorization_code", client_id: MS_ID, redirect_uri: APP_REDIRECT_URIS.microsoft, code: "M.code-1", code_verifier: pending.verifier });
  });

  it("a refused or unreadable exchange, or one that didn't grant what was asked, is said so", async () => {
    const { pending } = beginAppSignIn(google, own("google", GOOGLE_ID), { scopes: ["a", "b"], random: RANDOM, now: NOW });
    const deps = (reply: () => ConnectorResponse) => ({ transport: transport(reply), now: () => NOW });
    expect(await finishAppSignIn(deps(() => ({ status: 400, body: '{"error":"invalid_grant"}' })), google, pending, { code: "c", state: pending.state })).toEqual({ ok: false, problem: "exchange_failed" });
    expect(await finishAppSignIn({ transport: { send: async () => { throw new Error("offline"); } }, now: () => NOW }, google, pending, { code: "c", state: pending.state })).toEqual({ ok: false, problem: "exchange_failed" });
    expect(await finishAppSignIn(deps(() => ({ status: 200, body: JSON.stringify({ access_token: "at-1", scope: "a" }) })), google, pending, { code: "c", state: pending.state })).toEqual({ ok: false, problem: "missing_scopes" });
  });

  it("compares granted scopes without case or the Graph resource prefix; offline_access is never listed back", () => {
    expect(missingScopes(["offline_access", "https://graph.microsoft.com/Mail.Send"], ["mail.send"])).toEqual([]);
    expect(missingScopes(["https://www.googleapis.com/auth/gmail.modify"], ["https://www.googleapis.com/auth/gmail.readonly"])).toEqual(["https://www.googleapis.com/auth/gmail.modify"]);
    expect(missingScopes(["a"], undefined)).toEqual([]);
  });
});
