import { describe, expect, it } from "vitest";
import { catalogSpec, defaultSignInSettings, signInOptions, validateClientId, validateRelayUrl, type SignInSettings } from "../src/index.ts";

const config = { dojoClientIds: { google: "dojo.apps.googleusercontent.com" }, dojoRelayUrl: "https://relay.dojocoding.io" };
const settings = (over: Partial<SignInSettings> = {}): SignInSettings => ({ ...defaultSignInSettings, ...over });

describe("sign-in options (HM-CONN-05)", () => {
  it("Google uses Dojo's client by default (PDR-021)", () => {
    expect(signInOptions(catalogSpec("google_calendar")!, settings(), config)).toEqual([
      { method: "oauth_pkce", provider: "google", available: true, source: "dojo_client", clientId: "dojo.apps.googleusercontent.com" },
    ]);
  });

  it("the user's own client ID replaces Dojo's for that provider (US-CONN-08)", () => {
    const opts = signInOptions(catalogSpec("google_drive")!, settings({ ownClientIds: { google: "mine.apps.googleusercontent.com" } }), config);
    expect(opts).toEqual([{ method: "oauth_pkce", provider: "google", available: true, source: "own_client", clientId: "mine.apps.googleusercontent.com" }]);
  });

  it("without any client ID the option says why it is unavailable", () => {
    const opts = signInOptions(catalogSpec("spotify")!, settings(), config);
    expect(opts).toEqual([{ method: "oauth_pkce", provider: "spotify", available: false, unavailable: "needs_client_id" }]);
  });

  it("Dojo's relay is off by default; the user's own relay works when set (PDR-022)", () => {
    const slack = catalogSpec("slack")!;
    expect(signInOptions(slack, settings(), config)).toEqual([
      { method: "relay", provider: "slack", available: false, unavailable: "no_own_relay", source: "own_relay" },
      { method: "relay", provider: "slack", available: false, unavailable: "dojo_relay_off", source: "dojo_relay", relayUrl: "https://relay.dojocoding.io" },
    ]);
    const own = signInOptions(slack, settings({ ownRelayUrl: "https://relay.example.org" }), config);
    expect(own[0]).toEqual({ method: "relay", provider: "slack", available: true, source: "own_relay", relayUrl: "https://relay.example.org" });
    const optIn = signInOptions(slack, settings({ dojoRelayOptIn: true }), config);
    expect(optIn[1]).toMatchObject({ available: true, source: "dojo_relay", relayUrl: "https://relay.dojocoding.io" });
  });

  it("the Dojo relay opt-in is useless when no Dojo relay is configured", () => {
    const opts = signInOptions(catalogSpec("slack")!, settings({ dojoRelayOptIn: true }), { dojoClientIds: {} });
    expect(opts[1]).toMatchObject({ available: false, unavailable: "no_dojo_relay" });
  });

  it("a key typed by the user is always available where the spec accepts one", () => {
    const opts = signInOptions(catalogSpec("github")!, settings(), config);
    expect(opts).toContainEqual({ method: "api_key", available: true, source: "user_entered" });
  });

  it("validates client IDs and relay URLs before saving them", () => {
    expect(validateClientId("google", "123-abc.apps.googleusercontent.com")).toBe(true);
    expect(validateClientId("google", "not a client")).toBe(false);
    expect(validateClientId("google", "123-abc")).toBe(false);
    expect(validateClientId("spotify", "0123456789abcdef0123456789abcdef")).toBe(true);
    expect(validateClientId("spotify", "")).toBe(false);
    expect(validateRelayUrl("https://relay.example.org")).toBe(true);
    expect(validateRelayUrl("https://relay.example.org/hermit")).toBe(true);
    expect(validateRelayUrl("http://relay.example.org")).toBe(false);
    expect(validateRelayUrl("https://user:pw@relay.example.org")).toBe(false);
    expect(validateRelayUrl("relay.example.org")).toBe(false);
    // SL-57: the same check the relay client runs before any request: no private, LAN or loopback host, port 443 only.
    expect(validateRelayUrl("https://192.168.1.2")).toBe(false);
    expect(validateRelayUrl("https://relay.local")).toBe(false);
    expect(validateRelayUrl("https://localhost")).toBe(false);
    expect(validateRelayUrl("https://relay.example.org:8443")).toBe(false);
  });
});
