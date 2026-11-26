import { describe, expect, it } from "vitest";
import { builtInCatalog, catalogSpec, effectiveRisk, oauthProviders, riskFloor, skillIdFor, specHash, specTrust, validateSpec } from "../src/index.ts";

describe("built-in catalog integrity", () => {
  it("has the services US-CONN-01 names", () => {
    const ids = builtInCatalog.map((s) => s.id);
    for (const id of ["google_calendar", "google_drive", "outlook_calendar", "spotify"]) expect(ids).toContain(id);
  });

  it("every spec is bundled, valid, shipped, and unique by id and hash", () => {
    for (const spec of builtInCatalog) {
      expect(specTrust(spec), spec.id).toBe("bundled");
      expect(validateSpec(spec, { trust: specTrust(spec) }), spec.id).toEqual([]);
      expect(spec.origin, spec.id).toBe("shipped");
    }
    expect(new Set(builtInCatalog.map((s) => s.id)).size).toBe(builtInCatalog.length);
    expect(new Set(builtInCatalog.map(specHash)).size).toBe(builtInCatalog.length);
  });

  it("skill ids are unique across the whole catalog and fit the menu", () => {
    const ids = builtInCatalog.flatMap((s) => s.operations.map((o) => skillIdFor(s, o)));
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^[a-z][a-z0-9_]{2,63}$/);
  });

  it("every OAuth or relay sign-in names a known provider, and PKCE only where the provider allows a public client", () => {
    for (const spec of builtInCatalog) {
      for (const a of spec.auth) {
        if (a.type === "oauth2_pkce" || a.type === "relay") {
          const p = oauthProviders[a.provider];
          expect(p, `${spec.id} ${a.provider}`).toBeDefined();
          if (a.type === "oauth2_pkce") expect(p?.publicClient, spec.id).toBe(true);
          if (a.type === "relay") expect(p?.publicClient, spec.id).toBe(false);
        }
      }
    }
  });

  it("OAuth connectors declare the scopes of every operation", () => {
    for (const spec of builtInCatalog) {
      if (!spec.auth.some((a) => a.type === "oauth2_pkce" || a.type === "relay")) continue;
      for (const op of spec.operations) expect(op.scopes.length, `${spec.id}.${op.name}`).toBeGreaterThan(0);
    }
  });

  it("no shipped operation sits below its floor, and every write asks", () => {
    for (const spec of builtInCatalog) {
      for (const op of spec.operations) {
        const risk = effectiveRisk(op);
        expect(risk, `${spec.id}.${op.name}`).toBe(op.risk);
        expect(riskFloor(op).risk === op.risk || op.risk !== "read", `${spec.id}.${op.name}`).toBe(true);
        if (op.effect !== "read") expect(["remote_write", "send", "credential", "spend"]).toContain(risk);
      }
    }
  });

  it("menu lines fit the 300 character budget", () => {
    for (const spec of builtInCatalog) for (const op of spec.operations) expect(`${spec.name}: ${op.description}`.length, op.name).toBeLessThanOrEqual(300);
  });

  it("posting to a channel is a send", () => {
    const post = catalogSpec("slack")?.operations.find((o) => o.name === "post_message");
    expect(post?.risk).toBe("send");
  });

  it("is data only: plain JSON, no functions", () => {
    expect(JSON.parse(JSON.stringify(builtInCatalog))).toEqual(builtInCatalog);
  });
});
