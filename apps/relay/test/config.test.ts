import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.ts";
import { ENV, SLACK_SECRET } from "./helpers.ts";

describe("relay configuration: secrets from the environment only", () => {
  it("reads the public address, the seal key and each provider's client from the environment", () => {
    const loaded = loadConfig(ENV);
    if (!loaded.ok) throw new Error(loaded.errors.join());
    expect(loaded.config.callback).toBe("https://relay.example.org/v1/callback");
    expect([...loaded.config.providers.keys()]).toEqual(["slack", "notion"]);
    expect(loaded.config.port).toBe(8787);
    expect(loaded.config.host).toBe("127.0.0.1");
    expect(loaded.config.trustProxy).toBe(false);
    expect(loaded.config.ratePerMinute).toBe(30);
  });

  it("a public address under a path keeps the path", () => {
    const loaded = loadConfig({ ...ENV, HERMIT_RELAY_PUBLIC_URL: "https://example.org/hermit-relay/" });
    expect(loaded.ok && loaded.config.callback).toBe("https://example.org/hermit-relay/v1/callback");
  });

  it("names what is missing or wrong, never a value", () => {
    const loaded = loadConfig({ ...ENV, HERMIT_RELAY_SEAL_KEY: "short", HERMIT_RELAY_SLACK_CLIENT_ID: undefined });
    expect(loaded.ok).toBe(false);
    if (loaded.ok) return;
    expect(loaded.errors).toEqual([
      "HERMIT_RELAY_SEAL_KEY must be at least 32 random bytes, base64url",
      "HERMIT_RELAY_SLACK_CLIENT_ID is missing or not printable",
    ]);
    expect(JSON.stringify(loaded)).not.toContain(SLACK_SECRET);
  });

  it("refuses an http or private public address", () => {
    for (const url of ["http://relay.example.org", "https://localhost", "https://192.168.1.4", "https://relay.example.org/?x=1"]) {
      const loaded = loadConfig({ ...ENV, HERMIT_RELAY_PUBLIC_URL: url });
      expect(loaded.ok, url).toBe(false);
    }
  });

  it("serves only providers that need a secret, from Hermit's own provider table", () => {
    const google = loadConfig({ ...ENV, HERMIT_RELAY_PROVIDERS: "google", HERMIT_RELAY_GOOGLE_CLIENT_ID: "x", HERMIT_RELAY_GOOGLE_CLIENT_SECRET: "y" });
    expect(google.ok ? [] : google.errors).toEqual(["google takes a public client from the phone: it needs no relay"]);
    const unknown = loadConfig({ ...ENV, HERMIT_RELAY_PROVIDERS: "acme" });
    expect(unknown.ok ? [] : unknown.errors).toEqual(["acme is not a provider Hermit knows"]);
    const none = loadConfig({ ...ENV, HERMIT_RELAY_PROVIDERS: "" });
    expect(none.ok ? [] : none.errors).toEqual(["HERMIT_RELAY_PROVIDERS must list at least one provider"]);
  });

  it("reads the port, the bind address, the proxy switch and the rate", () => {
    const loaded = loadConfig({ ...ENV, HERMIT_RELAY_PORT: "9000", HERMIT_RELAY_HOST: "0.0.0.0", HERMIT_RELAY_TRUST_PROXY: "1", HERMIT_RELAY_RATE_PER_MINUTE: "5" });
    expect(loaded.ok && [loaded.config.port, loaded.config.host, loaded.config.trustProxy, loaded.config.ratePerMinute]).toEqual([9000, "0.0.0.0", true, 5]);
    const bad = loadConfig({ ...ENV, HERMIT_RELAY_PORT: "99999", HERMIT_RELAY_RATE_PER_MINUTE: "0" });
    expect(bad.ok ? [] : bad.errors).toEqual(["HERMIT_RELAY_PORT must be 1 to 65535", "HERMIT_RELAY_RATE_PER_MINUTE must be 1 to 10000"]);
  });
});
