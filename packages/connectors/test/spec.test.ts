import { describe, expect, it } from "vitest";
import { ed25519 } from "@noble/curves/ed25519.js";
import { builtInCatalog, effectiveRisk, isPublicHost, maxRisk, riskFloor, signSpec, specHash, specTrust, validateSpec, verifySpecSignature } from "../src/index.ts";
import { createOp, deleteOp, listOp, testSpec } from "./fixtures.ts";

describe("validateSpec", () => {
  it("accepts a well-formed spec", () => {
    expect(validateSpec(testSpec())).toEqual([]);
  });

  it("rejects things that are not a spec at all", () => {
    expect(validateSpec(null)).not.toEqual([]);
    expect(validateSpec({ id: "x" })).not.toEqual([]);
    expect(validateSpec("spec")).not.toEqual([]);
  });

  it("checks the id, version and name", () => {
    expect(validateSpec(testSpec({ id: "Acme Tasks" }))).toContainEqual(expect.stringMatching(/^id/));
    expect(validateSpec(testSpec({ version: 0 }))).toContainEqual(expect.stringMatching(/^version/));
    expect(validateSpec(testSpec({ name: "" }))).toContainEqual(expect.stringMatching(/^name/));
  });

  it("only allows exact public host names (FR-CONN-02)", () => {
    for (const host of ["https://api.acme.example", "api.acme.example:8443", "*.acme.example", "localhost", "127.0.0.1", "api.acme.example/v1", "printer.local", "API.ACME.EXAMPLE", "intranet"]) {
      expect(validateSpec(testSpec({ hosts: [host] })), host).toContainEqual(expect.stringMatching(/^hosts/));
    }
    expect(validateSpec(testSpec({ hosts: [] }))).toContainEqual(expect.stringMatching(/^hosts/));
  });

  it("needs an operation's host to be one of the spec's hosts, and names it when there are several", () => {
    expect(validateSpec(testSpec({ operations: [listOp({ host: "evil.example" })] }))).toContainEqual(expect.stringMatching(/host/));
    expect(validateSpec(testSpec({ hosts: ["a.acme.example", "b.acme.example"], operations: [listOp()] }))).toContainEqual(expect.stringMatching(/host/));
    expect(validateSpec(testSpec({ hosts: ["a.acme.example", "b.acme.example"], operations: [listOp({ host: "b.acme.example" })] }))).toEqual([]);
  });

  it("rejects duplicate or badly named operations", () => {
    expect(validateSpec(testSpec({ operations: [listOp(), listOp()] }))).toContainEqual(expect.stringMatching(/duplicate/));
    expect(validateSpec(testSpec({ operations: [listOp({ name: "List Items" })] }))).not.toEqual([]);
    expect(validateSpec(testSpec({ operations: [] }))).toContainEqual(expect.stringMatching(/^operations/));
  });

  it("never allows a generic call-any-path operation (FR-CONN-09)", () => {
    const anyPath = listOp({ path: "/{path}", inputSchema: { type: "object", properties: { path: { type: "string" } }, required: ["path"], additionalProperties: false } });
    expect(validateSpec(testSpec({ operations: [anyPath] }))).toContainEqual(expect.stringMatching(/path/));
    expect(validateSpec(testSpec({ operations: [listOp({ path: "https://other.example/x" })] }))).toContainEqual(expect.stringMatching(/path/));
    expect(validateSpec(testSpec({ operations: [listOp({ path: "/v1/../admin" })] }))).toContainEqual(expect.stringMatching(/path/));
    expect(validateSpec(testSpec({ operations: [listOp({ path: "/v1/items?all=1" })] }))).toContainEqual(expect.stringMatching(/path/));
  });

  it("needs every path parameter to be a required, scalar argument", () => {
    const missing = listOp({ path: "/v1/lists/{other}/items" });
    expect(validateSpec(testSpec({ operations: [missing] }))).toContainEqual(expect.stringMatching(/other/));
    const optional = listOp({ inputSchema: { type: "object", properties: { listId: { type: "string" } }, required: [], additionalProperties: false } });
    expect(validateSpec(testSpec({ operations: [optional] }))).toContainEqual(expect.stringMatching(/listId/));
  });

  it("needs a closed object input schema", () => {
    const open = listOp({ inputSchema: { type: "object", properties: { listId: { type: "string" } }, required: ["listId"] } });
    expect(validateSpec(testSpec({ operations: [open] }))).toContainEqual(expect.stringMatching(/additionalProperties/));
  });

  it("rejects an effect that contradicts the method or the destructive flag (FR-CONN-04)", () => {
    expect(validateSpec(testSpec({ operations: [listOp({ method: "POST" })] }))).toContainEqual(expect.stringMatching(/effect/));
    expect(validateSpec(testSpec({ operations: [createOp({ method: "GET", effect: "write" })] }))).toContainEqual(expect.stringMatching(/effect/));
    expect(validateSpec(testSpec({ operations: [deleteOp({ destructive: false })] }))).toContainEqual(expect.stringMatching(/destructive/));
    expect(validateSpec(testSpec({ operations: [listOp({ destructive: true })] }))).toContainEqual(expect.stringMatching(/destructive/));
    expect(validateSpec(testSpec({ operations: [listOp({ sideEffects: ["creates"] })] }))).toContainEqual(expect.stringMatching(/side effects/));
    expect(validateSpec(testSpec({ operations: [createOp({ sideEffects: [] })] }))).toContainEqual(expect.stringMatching(/side effects/));
    expect(validateSpec(testSpec({ operations: [createOp({ sideEffects: ["deletes"] })] }))).toContainEqual(expect.stringMatching(/destructive/));
  });

  it("allows a read over POST only when the caller vouches for the spec (bundled or signed)", () => {
    const search = listOp({ method: "POST", path: "/v1/search" });
    expect(validateSpec(testSpec({ operations: [search] }))).toContainEqual(expect.stringMatching(/effect/));
    expect(validateSpec(testSpec({ origin: "shipped", operations: [search] }), { trust: "bundled" })).toEqual([]);
    expect(validateSpec(testSpec({ origin: "shipped", operations: [search] }), { trust: "signed" })).toEqual([]);
  });

  it("never trusts a spec that only says it is shipped (security review)", () => {
    const search = listOp({ method: "POST", path: "/v1/search" });
    const selfDeclared = testSpec({ origin: "shipped", operations: [search] });
    const errors = validateSpec(selfDeclared);
    expect(errors).toContainEqual(expect.stringMatching(/origin shipped/));
    expect(errors).toContainEqual(expect.stringMatching(/effect read needs GET/));
    expect(validateSpec(selfDeclared, { trust: "untrusted" })).toEqual(errors);
    // A made-up signature field changes nothing: only the caller's check against Dojo's key counts.
    expect(validateSpec({ ...selfDeclared, signature: "ab".repeat(32) })).toContainEqual(expect.stringMatching(/origin shipped/));
    expect(specTrust({ ...selfDeclared, signature: "ab".repeat(32) }, ed25519.getPublicKey(new Uint8Array(32).fill(7)))).toBe("untrusted");
  });

  it("decides trust from the bundled catalog or Dojo's signature, never from the spec's fields", () => {
    const bundled = builtInCatalog[0]!;
    expect(specTrust(bundled)).toBe("bundled");
    expect(specTrust({ ...bundled, hosts: ["evil.example.com"] })).toBe("untrusted");
    const seed = new Uint8Array(32).fill(7);
    const signed = signSpec(testSpec({ origin: "shipped" }), seed);
    expect(specTrust(signed)).toBe("untrusted");
    expect(specTrust(signed, ed25519.getPublicKey(seed))).toBe("signed");
    expect(specTrust(signed, ed25519.getPublicKey(new Uint8Array(32).fill(9)))).toBe("untrusted");
  });

  it("rejects hosts that a URL parser could read as an IP or rewrite (security review)", () => {
    for (const host of ["0x7f.0.0.1", "127.1", "0177.0.0.1", "2130706433.example", "api.0x10.example", "example.123", "api.example.c0m", "localhost.localhost", "xn--a.local", "api..example.com", "-api.example.com", "api_v1.example.com", "api.example.com."]) {
      expect(isPublicHost(host), host).toBe(false);
      expect(validateSpec(testSpec({ hosts: [host] })), host).toContainEqual(expect.stringMatching(/^hosts/));
    }
    for (const host of ["api.acme.example", "www.googleapis.com", "graph.microsoft.com", "api-2.acme.io"]) expect(isPublicHost(host), host).toBe(true);
  });

  it("rejects a risk below the floor its effect, side effects or domain set (FR-CONN-04)", () => {
    const cases = [
      listOp({ risk: "read" }),
      createOp({ risk: "network" }),
      createOp({ sideEffects: ["sends"], domain: "messaging", risk: "remote_write" }),
      createOp({ sideEffects: ["moves_money"], risk: "send" }),
      createOp({ domain: "payments", risk: "remote_write" }),
      listOp({ domain: "credentials", risk: "network" }),
    ];
    for (const op of cases) expect(validateSpec(testSpec({ operations: [op] })), op.name + op.risk).toContainEqual(expect.stringMatching(/below/));
  });

  it("accepts a risk above the floor", () => {
    expect(validateSpec(testSpec({ operations: [listOp({ risk: "remote_write" })] }))).toEqual([]);
  });

  it("checks sign-in types and API key placement", () => {
    expect(validateSpec(testSpec({ auth: [] }))).toContainEqual(expect.stringMatching(/^auth/));
    expect(validateSpec(testSpec({ auth: [{ type: "oauth2_pkce", provider: "nobody" }] }))).toContainEqual(expect.stringMatching(/provider/));
    expect(validateSpec(testSpec({ auth: [{ type: "api_key", in: "header", name: "Cookie" }] }))).toContainEqual(expect.stringMatching(/Cookie/));
    // A provider that needs a client secret can't do PKCE from the phone; it goes through a relay (PDR-022).
    expect(validateSpec(testSpec({ auth: [{ type: "oauth2_pkce", provider: "slack" }] }))).toContainEqual(expect.stringMatching(/relay/));
    expect(validateSpec(testSpec({ auth: [{ type: "relay", provider: "slack" }] }))).toEqual([]);
  });

  it("allows only the fixed transforms, and never a header that carries credentials", () => {
    expect(validateSpec(testSpec({ transforms: [{ kind: "static_header", name: "Authorization", value: "x" }] }))).toContainEqual(expect.stringMatching(/Authorization/));
    expect(validateSpec(testSpec({ transforms: [{ kind: "static_header", name: "X-Api-Version", value: "2" }] }))).toEqual([]);
    expect(validateSpec(testSpec({ transforms: [{ kind: "run_code", source: "x" } as never] }))).toContainEqual(expect.stringMatching(/transform/));
    expect(validateSpec(testSpec({ transforms: [{ kind: "pick_fields", operation: "nope", fields: ["a"] }] }))).toContainEqual(expect.stringMatching(/nope/));
  });

  it("only maps body fields from declared arguments", () => {
    expect(validateSpec(testSpec({ operations: [createOp({ body: { "item.text": "text" } })] }))).toEqual([]);
    expect(validateSpec(testSpec({ operations: [createOp({ body: { "item.text": "missing" } })] }))).toContainEqual(expect.stringMatching(/missing/));
    expect(validateSpec(testSpec({ operations: [listOp({ body: { text: "q" } })] }))).toContainEqual(expect.stringMatching(/body/));
  });
});

describe("prototype pollution", () => {
  it("a body path naming the prototype chain is rejected", () => {
    for (const path of ["__proto__.polluted", "a.constructor.prototype", "constructor"]) {
      const spec = testSpec({ operations: [listOp(), createOp({ body: { [path]: "text" } }), deleteOp()] });
      expect(validateSpec(spec).some((e) => /prototype chain|invalid/.test(e)), path).toBe(true);
    }
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });
});

describe("risk floors", () => {
  it("a read leaves the phone, so it is at least network", () => {
    expect(riskFloor(listOp()).risk).toBe("network");
  });
  it("a write or delete is at least remote_write", () => {
    expect(riskFloor(createOp()).risk).toBe("remote_write");
    expect(riskFloor(deleteOp()).risk).toBe("remote_write");
  });
  it("sending, money and credentials raise the floor", () => {
    expect(riskFloor(createOp({ sideEffects: ["sends"] })).risk).toBe("send");
    expect(riskFloor(createOp({ domain: "payments" })).risk).toBe("spend");
    expect(riskFloor(createOp({ sideEffects: ["uses_credential"] })).risk).toBe("credential");
    expect(riskFloor(listOp({ domain: "credentials" })).risk).toBe("credential");
  });
  it("an override can raise a risk, never lower it (FR-CONN-04)", () => {
    expect(effectiveRisk(listOp(), "remote_write")).toBe("remote_write");
    expect(effectiveRisk(createOp(), "read")).toBe("remote_write");
    expect(effectiveRisk(createOp({ risk: "send" }))).toBe("send");
    expect(maxRisk("network", "read", "send")).toBe("send");
  });
});

describe("spec identity and signature (FR-CONN-01, FR-CONN-08)", () => {
  it("the hash ignores key order and the signature", () => {
    const spec = testSpec();
    const reordered = Object.fromEntries(Object.entries(spec).reverse()) as unknown as typeof spec;
    expect(Object.keys(reordered)[0]).not.toBe(Object.keys(spec)[0]);
    expect(specHash(reordered)).toBe(specHash(spec));
    expect(specHash({ ...spec, signature: "ab" })).toBe(specHash(spec));
    expect(specHash({ ...spec, version: 2 })).not.toBe(specHash(spec));
  });

  it("verifies Dojo's signature over the spec hash", () => {
    const seed = new Uint8Array(32).fill(7);
    const publicKey = ed25519.getPublicKey(seed);
    const signed = signSpec(testSpec({ origin: "shipped" }), seed);
    expect(verifySpecSignature(signed, publicKey)).toBe(true);
    expect(verifySpecSignature({ ...signed, name: "Other" }, publicKey)).toBe(false);
    expect(verifySpecSignature(testSpec(), publicKey)).toBe(false);
    expect(verifySpecSignature({ ...signed, signature: "zz" }, publicKey)).toBe(false);
    expect(verifySpecSignature(signed, ed25519.getPublicKey(new Uint8Array(32).fill(8)))).toBe(false);
  });
});
