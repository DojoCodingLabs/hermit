import { describe, expect, it } from "vitest";
import { importOpenApi, specHash, validateSpec } from "../src/index.ts";
import { openApiDoc } from "./connect-fixtures.ts";

const text = (over: Record<string, unknown> = {}) => JSON.stringify(openApiDoc(over));

describe("OpenAPI 3 import (FR-CONN-06, US-CONN-06): deterministic, no model", () => {
  it("converts paths to a valid drafted-trust spec: GET reads, others at least remote_write", () => {
    const r = importOpenApi(text());
    if (!r.ok) throw new Error(r.problem);
    expect(validateSpec(r.spec, { trust: "untrusted" })).toEqual([]);
    expect(r.spec).toMatchObject({ id: "petstore_plus", name: "Petstore Plus", hosts: ["api.petstore.example.com"], origin: "openapi" });
    expect(r.spec.auth).toEqual([{ type: "api_key", in: "header", name: "X-Pet-Key" }]);
    const by = Object.fromEntries(r.spec.operations.map((o) => [o.name, o]));
    expect(by.list_pets).toMatchObject({ method: "GET", path: "/v1/pets", risk: "network", effect: "read" });
    expect(by.list_pets!.inputSchema).toMatchObject({ properties: { limit: { type: "integer" } } });
    expect(by.create_pet).toMatchObject({ method: "POST", risk: "remote_write", sideEffects: ["creates"] });
    expect(by.create_pet!.inputSchema).toMatchObject({ required: ["name"], properties: { name: { type: "string" }, tag: { type: "string" } } });
    expect(by.get_pet).toMatchObject({ path: "/v1/pets/{pet_id}", inputSchema: { required: ["pet_id"] } });
  });

  it("is deterministic: the same document gives the same spec hash", () => {
    const a = importOpenApi(text());
    const b = importOpenApi(text());
    if (!a.ok || !b.ok) throw new Error("import failed");
    expect(specHash(a.spec)).toBe(specHash(b.spec));
  });

  it("injection: a DELETE described as read-only stays destructive at remote_write", () => {
    const r = importOpenApi(text());
    if (!r.ok) throw new Error(r.problem);
    const del = r.spec.operations.find((o) => o.name === "remove_pet")!;
    expect(del).toMatchObject({ method: "DELETE", effect: "delete", destructive: true, risk: "remote_write" });
  });

  it("the money guard reads each operation's own text: charging a fee is spend, with the words that raised it", () => {
    const r = importOpenApi(text());
    if (!r.ok) throw new Error(r.problem);
    expect(r.spec.operations.find((o) => o.name === "adopt_pet")!.risk).toBe("spend");
    expect(r.ops.find((o) => o.name === "adopt_pet")!.guard).toEqual([{ effect: "moves_money", word: "Charges" }]);
  });

  it("never fetches an external $ref: that operation is left out with the reason", () => {
    const r = importOpenApi(text());
    if (!r.ok) throw new Error(r.problem);
    expect(r.spec.operations.some((o) => o.name === "remote_thing")).toBe(false);
    expect(r.skipped).toContainEqual({ label: "GET /remote", reason: "external_ref" });
  });

  it("an x-hermit-risk override only raises", () => {
    const doc = openApiDoc();
    (doc.paths["/pets"].get as Record<string, unknown>)["x-hermit-risk"] = "send";
    (doc.paths["/pets"].post as Record<string, unknown>)["x-hermit-risk"] = "read";
    const r = importOpenApi(JSON.stringify(doc));
    if (!r.ok) throw new Error(r.problem);
    expect(r.spec.operations.find((o) => o.name === "list_pets")!.risk).toBe("send");
    expect(r.spec.operations.find((o) => o.name === "create_pet")!.risk).toBe("remote_write");
  });

  it("maps bearer and basic schemes, and refuses OAuth-only documents", () => {
    const bearer = importOpenApi(text({ components: { ...openApiDoc().components, securitySchemes: { b: { type: "http", scheme: "bearer" } } }, security: [{ b: [] }] }));
    expect(bearer.ok && bearer.spec.auth).toEqual([{ type: "api_key", in: "header", name: "Authorization", prefix: "Bearer " }]);
    const basic = importOpenApi(text({ components: { ...openApiDoc().components, securitySchemes: { b: { type: "http", scheme: "basic" } } }, security: [{ b: [] }] }));
    expect(basic.ok && basic.spec.auth).toEqual([{ type: "basic" }]);
    const oauth = importOpenApi(text({ components: { ...openApiDoc().components, securitySchemes: { o: { type: "oauth2", flows: {} } } }, security: [{ o: [] }] }));
    expect(oauth).toEqual({ ok: false, problem: "sign_in_unsupported" });
  });

  it("refuses plain HTTP, private hosts, Swagger 2 and what isn't JSON", () => {
    expect(importOpenApi(text({ servers: [{ url: "http://api.petstore.example.com" }] }))).toEqual({ ok: false, problem: "not_https" });
    expect(importOpenApi(text({ servers: [{ url: "https://homeassistant.local:8123" }] }))).toEqual({ ok: false, problem: "not_https" });
    expect(importOpenApi(text({ servers: [{ url: "https://10.0.0.5/api" }] }))).toEqual({ ok: false, problem: "not_https" });
    expect(importOpenApi(JSON.stringify({ swagger: "2.0", paths: {} }))).toEqual({ ok: false, problem: "not_openapi" });
    expect(importOpenApi("openapi: 3.0.0\npaths: {}")).toEqual({ ok: false, problem: "not_openapi" });
  });

  it("a relative server URL resolves against the host the document came from", () => {
    const r = importOpenApi(text({ servers: [{ url: "/api/v3" }] }), { sourceHost: "docs.petstore.example.com" });
    expect(r.ok && r.spec.hosts).toEqual(["docs.petstore.example.com"]);
    expect(r.ok && r.spec.operations[0]!.path.startsWith("/api/v3/")).toBe(true);
    expect(importOpenApi(text({ servers: [{ url: "/api/v3" }] }))).toEqual({ ok: false, problem: "no_server" });
  });

  it("refuses a document with nothing usable, and ignores prototype keys", () => {
    expect(importOpenApi(text({ paths: {} }))).toEqual({ ok: false, problem: "no_operations" });
    const r = importOpenApi(text().replace('"paths":{', '"paths":{"__proto__":{"get":{"operationId":"polluted"}},'));
    expect(r.ok && r.spec.operations.some((o) => o.name === "polluted")).toBe(false);
    expect(({} as Record<string, unknown>).get).toBeUndefined();
  });
});
