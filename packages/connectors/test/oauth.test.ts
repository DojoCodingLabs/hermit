import { describe, expect, it } from "vitest";
import type { CredentialMeta } from "@hermit/core";
import {
  authorizationUrl,
  createPkce,
  freshOAuthCredential,
  MemoryCredentialStore,
  type ConnectorRequest,
  oauthProviders,
  parseTokenResponse,
  refreshRequest,
  revokeRequest,
  scopesFor,
  tokenExchangeRequest,
} from "../src/index.ts";
import { createOp, listOp, testSpec } from "./fixtures.ts";

const form = (s: string) => Object.fromEntries(s.split("&").map((kv) => kv.split("=").map((x) => decodeURIComponent(x.replace(/\+/g, " ")))));

// RFC 7636, appendix B.
const RFC_BYTES = new Uint8Array([116, 24, 223, 180, 151, 153, 224, 37, 79, 250, 96, 125, 216, 173, 187, 186, 22, 212, 37, 77, 105, 214, 191, 240, 91, 88, 5, 88, 83, 132, 141, 121]);

describe("PKCE (FR-CONN-03)", () => {
  it("matches the RFC 7636 test vector", () => {
    expect(createPkce(RFC_BYTES)).toEqual({
      verifier: "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk",
      challenge: "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
      method: "S256",
    });
  });
  it("refuses weak randomness", () => {
    expect(() => createPkce(new Uint8Array(16))).toThrow();
  });
});

describe("OAuth requests are built here and sent by the app", () => {
  const google = oauthProviders.google!;

  it("builds the system-browser authorization URL with PKCE and the provider's extra parameters", () => {
    const url = authorizationUrl(google, { clientId: "c.apps.googleusercontent.com", redirectUri: "https://hermit.dojocoding.io/oauth", scopes: ["a b", "c"], state: "st", challenge: "ch" });
    expect(url.startsWith("https://accounts.google.com/o/oauth2/v2/auth?")).toBe(true);
    expect(form(url.split("?")[1]!)).toEqual({
      response_type: "code",
      client_id: "c.apps.googleusercontent.com",
      redirect_uri: "https://hermit.dojocoding.io/oauth",
      scope: "a b c",
      state: "st",
      code_challenge: "ch",
      code_challenge_method: "S256",
      access_type: "offline",
      prompt: "consent",
    });
  });

  it("refuses PKCE for a provider that needs a client secret (PDR-022: relay instead)", () => {
    expect(() => authorizationUrl(oauthProviders.slack!, { clientId: "x", redirectUri: "https://h/o", scopes: [], state: "s", challenge: "c" })).toThrow(/relay/);
  });

  it("builds the code exchange and refresh with secrets wrapped", () => {
    const ex = tokenExchangeRequest(google, { clientId: "c", redirectUri: "https://h/o", code: "code-1", verifier: "ver-1" });
    expect(ex).toMatchObject({ method: "POST", url: "https://oauth2.googleapis.com/token", headers: { "Content-Type": "application/x-www-form-urlencoded" } });
    expect(JSON.stringify(ex)).not.toContain("code-1");
    expect(form(typeof ex.body === "string" ? ex.body : ex.body!.reveal())).toEqual({
      grant_type: "authorization_code", client_id: "c", redirect_uri: "https://h/o", code: "code-1", code_verifier: "ver-1",
    });
    const rf = refreshRequest(google, { clientId: "c", refreshToken: "r-1" });
    expect(JSON.stringify(rf)).not.toContain("r-1");
  });

  it("builds a revocation only where the provider supports one", () => {
    expect(revokeRequest(google, "t-1")?.url).toBe("https://oauth2.googleapis.com/revoke");
    expect(revokeRequest(oauthProviders.microsoft!, "t-1")).toBeUndefined();
  });

  it("parses a token response into a secret and an expiry", () => {
    expect(parseTokenResponse(JSON.stringify({ access_token: "a", refresh_token: "r", expires_in: 60, scope: "x y" }), 1000, " ")).toEqual({
      secret: { kind: "oauth2", accessToken: "a", refreshToken: "r" },
      expiresAt: 61_000,
      scopes: ["x", "y"],
    });
    expect(parseTokenResponse("{\"error\":\"invalid_grant\"}", 0, " ")).toBeUndefined();
    expect(parseTokenResponse("<html>", 0, " ")).toBeUndefined();
  });

  it("requests only the scopes of the operations the user enabled", () => {
    const spec = testSpec({ operations: [listOp({ scopes: ["r", "shared"] }), createOp({ scopes: ["w", "shared"] })] });
    expect(scopesFor(spec, ["list_items"])).toEqual(["r", "shared"]);
    expect(scopesFor(spec, ["list_items", "create_item"])).toEqual(["r", "shared", "w"]);
  });

  it("every provider entry cites the provider's own docs and uses HTTPS (FR-CONN-10)", () => {
    for (const p of Object.values(oauthProviders)) {
      for (const url of [p.authorizationUrl, p.tokenUrl, p.revocationUrl, p.docs].filter(Boolean)) expect(url, p.id).toMatch(/^https:\/\//);
      expect(p.docs).not.toMatch(/nango/i);
    }
  });
});

describe("fresh OAuth credentials for callers outside the spec runtime (mail, SL-48)", () => {
  const NOW = 1_800_000_000_000;
  const google = oauthProviders.google!;
  const meta = (over: Partial<CredentialMeta> = {}): CredentialMeta => ({
    id: "m1", connectorId: "gmail", kind: "oauth2", source: "dojo_client", clientId: "c.apps.googleusercontent.com", scopes: ["s"], createdAt: 1, ...over,
  });

  it("returns the stored token while it is fresh, with no request", async () => {
    const credentials = new MemoryCredentialStore();
    await credentials.save(meta({ expiresAt: NOW + 3_600_000 }), { kind: "oauth2", accessToken: "a1", refreshToken: "r1" });
    const sent: ConnectorRequest[] = [];
    const out = await freshOAuthCredential({ credentials, transport: { send: async (r) => (sent.push(r), { status: 500, body: "" }) }, now: () => NOW }, google, "m1");
    expect(out).toMatchObject({ ok: true, secret: { accessToken: "a1" } });
    expect(sent).toEqual([]);
  });

  it("refreshes an expiring token and saves the new one; a refused refresh means sign in again", async () => {
    const credentials = new MemoryCredentialStore();
    await credentials.save(meta({ expiresAt: NOW + 1000 }), { kind: "oauth2", accessToken: "a1", refreshToken: "r1" });
    const ok = await freshOAuthCredential({ credentials, transport: { send: async () => ({ status: 200, body: JSON.stringify({ access_token: "a2", expires_in: 60 }) }) }, now: () => NOW }, google, "m1");
    expect(ok).toMatchObject({ ok: true, secret: { accessToken: "a2", refreshToken: "r1" } });
    expect((await credentials.get("m1"))?.expiresAt).toBe(NOW + 60_000);

    await credentials.save(meta({ expiresAt: NOW - 1 }), { kind: "oauth2", accessToken: "a1", refreshToken: "r1" });
    const refused = await freshOAuthCredential({ credentials, transport: { send: async () => ({ status: 400, body: "{}" }) }, now: () => NOW }, google, "m1");
    expect(refused).toEqual({ ok: false, problem: "sign_in_again" });
  });

  it("an unknown id or a non-OAuth secret is not connected", async () => {
    const credentials = new MemoryCredentialStore();
    await credentials.save(meta({ kind: "basic" }), { kind: "basic", username: "u", password: "p" });
    const deps = { credentials, transport: { send: async () => ({ status: 200, body: "" }) }, now: () => NOW };
    expect(await freshOAuthCredential(deps, google, "nope")).toEqual({ ok: false, problem: "not_connected" });
    expect(await freshOAuthCredential(deps, google, "m1")).toEqual({ ok: false, problem: "not_connected" });
  });
});
