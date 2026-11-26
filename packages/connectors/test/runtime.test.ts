import { describe, expect, it } from "vitest";
import { argsHash, type CredentialMeta, type CredentialSecret, type SessionState } from "@hermit/core";
import { decide, defaultRules } from "@hermit/cage";
import { ed25519 } from "@noble/curves/ed25519.js";
import {
  catalogSpec,
  ConnectorRuntime,
  MemoryCredentialStore,
  resolvePath,
  signSpec,
  specHash,
  type ConnectorRequest,
  type ConnectorResponse,
  type ConnectorSpec,
  type InstalledConnector,
} from "../src/index.ts";
import { createOp, deleteOp, listOp, testSpec } from "./fixtures.ts";

const NOW = 1_800_000_000_000;
const KEY = "sk_live_supersecret_42";

class FakeTransport {
  sent: ConnectorRequest[] = [];
  constructor(private reply: (req: ConnectorRequest) => ConnectorResponse = () => ({ status: 200, body: "{\"ok\":true}" })) {}
  async send(req: ConnectorRequest): Promise<ConnectorResponse> {
    this.sent.push(req);
    return this.reply(req);
  }
}

const meta = (over: Partial<CredentialMeta> = {}): CredentialMeta => ({
  id: "cred-1", connectorId: "acme_tasks", kind: "api_key", source: "user_entered", scopes: [], createdAt: NOW - 1000, ...over,
});

async function setup(opts: { spec?: ConnectorSpec; enabled?: string[]; overrides?: InstalledConnector["riskOverrides"]; transport?: FakeTransport; secret?: CredentialSecret; meta?: Partial<CredentialMeta>; noCredential?: boolean } = {}) {
  const spec = opts.spec ?? testSpec();
  const credentials = new MemoryCredentialStore();
  if (!opts.noCredential) await credentials.save(meta(opts.meta), opts.secret ?? { kind: "api_key", key: KEY });
  const transport = opts.transport ?? new FakeTransport();
  const runtime = new ConnectorRuntime({ credentials, transport, now: () => NOW });
  const installed: InstalledConnector = {
    spec,
    approvedHash: specHash(spec),
    enabled: opts.enabled ?? spec.operations.map((o) => o.name),
    credentialId: "cred-1",
    ...(opts.overrides ? { riskOverrides: opts.overrides } : {}),
  };
  const { skills, problem } = runtime.skillsFor(installed);
  const byName = (name: string) => {
    const s = skills.find((k) => k.operation === name);
    if (!s) throw new Error(`no skill for ${name}`);
    return s;
  };
  return { spec, credentials, transport, runtime, installed, skills, problem, byName };
}

const session = (over: Partial<SessionState> = {}): SessionState => ({ id: "s1", taint: [], unattended: false, ...over });
const call = (skill: string, args: Record<string, unknown>) => ({ id: "c1", skill: skill as never, args, argsHash: argsHash(args), repairs: [] });

describe("connector operations become skills behind the cage", () => {
  it("one skill per enabled operation; disabled ones never reach the model (FR-CONN-09)", async () => {
    const { skills } = await setup({ enabled: ["list_items", "create_item"] });
    expect(skills.map((s) => s.def.id)).toEqual(["conn_acme_tasks_list_items", "conn_acme_tasks_create_item"]);
  });

  it("every skill carries the operation's effective risk, its exact input schema, and taints the session (FR-CAGE-04)", async () => {
    const { skills, spec } = await setup();
    expect(skills.map((s) => s.def.risk)).toEqual(["network", "remote_write", "remote_write"]);
    for (const s of skills) {
      expect(s.def.producesUntrusted).toBe(true);
      expect(s.def.args).toEqual(spec.operations.find((o) => o.name === s.operation)?.inputSchema);
      expect(s.def.menuLine.length).toBeLessThanOrEqual(300);
    }
  });

  it("the user can raise a risk but never lower it (FR-CONN-04)", async () => {
    const { skills } = await setup({ overrides: { list_items: "remote_write", create_item: "read" } });
    expect(skills.find((s) => s.operation === "list_items")?.def.risk).toBe("remote_write");
    expect(skills.find((s) => s.operation === "create_item")?.def.risk).toBe("remote_write");
  });

  it("a spec whose hash changed since approval is disabled (FR-CONN-08)", async () => {
    const { runtime, installed } = await setup();
    const changed = runtime.skillsFor({ ...installed, spec: { ...installed.spec, hosts: ["api.other.example"] } });
    expect(changed).toEqual({ skills: [], problem: "spec_changed" });
    const invalid = { ...installed.spec, operations: [listOp({ risk: "read" })] };
    expect(runtime.skillsFor({ ...installed, spec: invalid, approvedHash: specHash(invalid) })).toEqual({ skills: [], problem: "invalid_spec" });
  });

  it("decide() asks before a read and a write, and denies them when no one is there (FR-CAGE-02)", async () => {
    const { byName } = await setup();
    const rules = defaultRules();
    const list = byName("list_items").def;
    const create = byName("create_item").def;
    expect(decide(call(list.id, { listId: "a" }), list.risk, session(), rules).effect).toBe("ask");
    expect(decide(call(create.id, { listId: "a", text: "x" }), create.risk, session(), rules).effect).toBe("ask");
    const tainted = decide(call(create.id, { listId: "a", text: "x" }), create.risk, session({ taint: [{ kind: "web", ref: "x", at: 1 }] }), rules);
    expect(tainted.effect).toBe("ask");
    expect(decide(call(create.id, { listId: "a", text: "x" }), create.risk, session({ unattended: true }), rules).effect).toBe("deny");
  });

  it("a rule that allows remote writes still asks: connector writes always need approval", async () => {
    const { byName } = await setup();
    const create = byName("create_item").def;
    const rules = [...defaultRules(), { id: "yolo", skill: "*" as const, effect: "allow" as const }];
    expect(decide(call(create.id, { listId: "a", text: "x" }), create.risk, session(), rules.filter((r) => r.id !== "remote-write-asks")).effect).toBe("ask");
  });

  it("a sending operation asks with a fingerprint; a paying one is denied for now", async () => {
    const spec = testSpec({
      operations: [
        createOp({ name: "post_message", sideEffects: ["sends"], domain: "messaging", risk: "send" }),
        createOp({ name: "pay", domain: "payments", risk: "spend" }),
      ],
    });
    const { byName } = await setup({ spec });
    const post = byName("post_message").def;
    const pay = byName("pay").def;
    expect(decide(call(post.id, { listId: "a", text: "x" }), post.risk, session(), defaultRules())).toMatchObject({ effect: "ask", requireBiometric: true });
    expect(decide(call(pay.id, { listId: "a", text: "x" }), pay.risk, session(), defaultRules()).effect).toBe("deny");
  });

  it("the approval sheet shows the service, host and exact request from the arguments", async () => {
    const { byName, spec } = await setup();
    const summary = byName("create_item").def.describeAction({ listId: "groceries", text: "milk" }, { conversation: () => undefined });
    expect(summary.title).toContain("Acme Tasks");
    expect(summary.lines).toContainEqual({ label: "Host", labelKey: "host", value: "api.acme.example" });
    expect(summary.lines).toContainEqual({ label: "Request", labelKey: "request", value: "POST /v1/lists/groceries/items" });
    expect(summary.lines).toContainEqual({ label: "text", value: "milk" });
    expect(summary.binding).toBe(`acme_tasks:${specHash(spec)}:create_item`);
  });
});

describe("execution", () => {
  it("refuses a write that the cage did not approve for these exact arguments", async () => {
    const { byName, transport } = await setup();
    const create = byName("create_item");
    const args = { listId: "a", text: "x" };
    expect((await create.execute(args, { session: session() })).ok).toBe(false);
    expect((await create.execute(args, { session: session(), approvedArgsHash: argsHash({ listId: "a", text: "y" }) })).ok).toBe(false);
    expect(transport.sent).toHaveLength(0);
  });

  it("refuses when the approved binding no longer matches the spec", async () => {
    const { byName, transport } = await setup();
    const args = { listId: "a", text: "x" };
    const r = await byName("create_item").execute(args, { session: session(), approvedArgsHash: argsHash(args), approvedBinding: "acme_tasks:old:create_item" });
    expect(r.ok).toBe(false);
    expect(transport.sent).toHaveLength(0);
  });

  it("sends an approved write to the spec's host only, with the key injected at send time (FR-CONN-02, FR-CONN-03)", async () => {
    const { byName, transport } = await setup();
    const args = { listId: "my list?x=1", text: "milk" };
    const r = await byName("create_item").execute(args, { session: session(), approvedArgsHash: argsHash(args) });
    expect(r).toMatchObject({ ok: true, untrusted: true });
    expect(transport.sent).toHaveLength(1);
    const req = transport.sent[0]!;
    expect(req.method).toBe("POST");
    expect(req.url).toBe("https://api.acme.example/v1/lists/my%20list%3Fx%3D1/items");
    expect(req.body).toBe(JSON.stringify({ text: "milk" }));
    expect(req.auth?.name).toBe("Authorization");
    expect(req.auth?.value.reveal()).toBe(`Bearer ${KEY}`);
    // What an adapter or a log might serialize carries no secret.
    expect(JSON.stringify(req)).not.toContain(KEY);
    expect(JSON.stringify(r)).not.toContain(KEY);
  });

  it("refuses path values that could reach another endpoint, and never calls the service (security review)", async () => {
    const { byName, transport } = await setup();
    for (const listId of ["..", ".", "../admin", "a/b", "a\\b", "%2e%2e", "%2E%2E%2Fadmin", "a%2fb", "x\u0000y", "line\nbreak", "", "%zz"]) {
      const r = await byName("list_items").execute({ listId }, { session: session() });
      expect(r.ok, JSON.stringify(listId)).toBe(false);
      const del = await byName("delete_item").execute({ itemId: listId }, { session: session(), approvedArgsHash: argsHash({ itemId: listId }) });
      expect(del.ok, JSON.stringify(listId)).toBe(false);
    }
    expect(transport.sent).toHaveLength(0);
  });

  it("puts a read's other arguments in the query string", async () => {
    const { byName, transport } = await setup();
    await byName("list_items").execute({ listId: "a", q: "milk & eggs" }, { session: session() });
    expect(transport.sent[0]?.url).toBe("https://api.acme.example/v1/lists/a/items?q=milk%20%26%20eggs");
    expect(transport.sent[0]?.body).toBeUndefined();
  });

  it("maps arguments into a nested body when the operation declares one", async () => {
    const spec = testSpec({ operations: [createOp({ body: { "item.content": "text", "meta.list": "listId" } })] });
    const { byName, transport } = await setup({ spec });
    const args = { listId: "a", text: "milk" };
    await byName("create_item").execute(args, { session: session(), approvedArgsHash: argsHash(args) });
    expect(JSON.parse(transport.sent[0]!.body as string)).toEqual({ item: { content: "milk" }, meta: { list: "a" } });
  });

  it("validates arguments against the operation's schema before anything is sent", async () => {
    const { byName, transport } = await setup();
    expect((await byName("list_items").execute({ listId: "a", path: "/admin" }, { session: session() })).ok).toBe(false);
    expect((await byName("list_items").execute({}, { session: session() })).ok).toBe(false);
    expect(transport.sent).toHaveLength(0);
  });

  it("treats the response as untrusted, caps it, and scrubs any echoed secret", async () => {
    const transport = new FakeTransport(() => ({ status: 200, body: `{"echo":"${KEY}","pad":"${"x".repeat(20_000)}"}` }));
    const { byName } = await setup({ transport });
    const r = await byName("list_items").execute({ listId: "a" }, { session: session() });
    expect(r.ok).toBe(true);
    expect(r.untrusted).toBe(true);
    expect(r.modelText).not.toContain(KEY);
    expect(r.modelText.length).toBeLessThanOrEqual(4000);
    expect(transport.sent[0]?.maxResponseBytes).toBeGreaterThan(0);
  });

  it("projects the fields a pick_fields transform names", async () => {
    const spec = testSpec({ transforms: [{ kind: "pick_fields", operation: "list_items", list: "items", fields: ["title", "due.date"] }] });
    const body = JSON.stringify({ items: [{ title: "milk", due: { date: "2026-11-15" }, internal: "zzz" }, { title: "eggs" }], next: "abc" });
    const { byName } = await setup({ spec, transport: new FakeTransport(() => ({ status: 200, body })) });
    const r = await byName("list_items").execute({ listId: "a" }, { session: session() });
    expect(JSON.parse(r.modelText)).toEqual([{ title: "milk", "due.date": "2026-11-15" }, { title: "eggs" }]);
  });

  it("adds the spec's static headers", async () => {
    const spec = testSpec({ transforms: [{ kind: "static_header", name: "Acme-Version", value: "2026-01-01" }] });
    const { byName, transport } = await setup({ spec });
    await byName("list_items").execute({ listId: "a" }, { session: session() });
    expect(transport.sent[0]?.headers["Acme-Version"]).toBe("2026-01-01");
  });

  it("says when the service is not connected, without calling it", async () => {
    const { byName, transport } = await setup({ noCredential: true });
    const r = await byName("list_items").execute({ listId: "a" }, { session: session() });
    expect(r.ok).toBe(false);
    expect(r.modelText).toMatch(/not connected/i);
    expect(transport.sent).toHaveLength(0);
  });

  it("asks the user to sign in again on 401, and records the use", async () => {
    const { byName, credentials } = await setup({ transport: new FakeTransport(() => ({ status: 401, body: "nope" })) });
    const r = await byName("list_items").execute({ listId: "a" }, { session: session() });
    expect(r.ok).toBe(false);
    expect(r.modelText).toMatch(/sign in/i);
    expect((await credentials.get("cred-1"))?.lastUsedAt).toBe(NOW);
  });

  it("reports a transport failure plainly", async () => {
    const transport = new FakeTransport(() => {
      throw new Error(`socket closed for ${KEY}`);
    });
    const { byName } = await setup({ transport });
    const r = await byName("list_items").execute({ listId: "a" }, { session: session() });
    expect(r.ok).toBe(false);
    expect(r.modelText).not.toContain(KEY);
  });

  it("refreshes an expired OAuth token through the provider before the call", async () => {
    const spec = testSpec({ auth: [{ type: "oauth2_pkce", provider: "google" }], hosts: ["www.googleapis.com"] });
    const transport = new FakeTransport((req) =>
      req.url === "https://oauth2.googleapis.com/token"
        ? { status: 200, body: JSON.stringify({ access_token: "new-access", expires_in: 3600 }) }
        : { status: 200, body: "[]" },
    );
    const { byName, credentials } = await setup({
      spec,
      transport,
      meta: { kind: "oauth2", source: "own_client", clientId: "me.apps.googleusercontent.com", expiresAt: NOW - 1 },
      secret: { kind: "oauth2", accessToken: "old-access", refreshToken: "refresh-1" },
    });
    const r = await byName("list_items").execute({ listId: "a" }, { session: session() });
    expect(r.ok).toBe(true);
    expect(transport.sent.map((s) => s.url)).toEqual(["https://oauth2.googleapis.com/token", "https://www.googleapis.com/v1/lists/a/items"]);
    expect(transport.sent[1]?.auth?.value.reveal()).toBe("Bearer new-access");
    expect(await credentials.reveal("cred-1")).toEqual({ kind: "oauth2", accessToken: "new-access", refreshToken: "refresh-1" });
    expect((await credentials.get("cred-1"))?.expiresAt).toBe(NOW + 3600_000);
    expect(JSON.stringify(transport.sent)).not.toContain("refresh-1");
  });
});

describe("resolvePath", () => {
  it("percent-encodes every value and keeps the template's literal segments", () => {
    expect(resolvePath("/v1/lists/{listId}/items", { listId: "a b&c" })).toBe("/v1/lists/a%20b%26c/items");
    expect(resolvePath("/v1/{a}/{b}", { a: 1, b: "x.y" })).toBe("/v1/1/x.y");
    expect(resolvePath("/v1/files/{name}.json", { name: "report" })).toBe("/v1/files/report.json");
  });
  it("refuses dot segments, separators, control characters and missing values", () => {
    for (const v of ["..", ".", "a/b", "a\\b", "%2e%2e", "%2F", "\t", "", "%"]) expect(resolvePath("/v1/{x}", { x: v }), JSON.stringify(v)).toBeUndefined();
    expect(resolvePath("/v1/{x}", {})).toBeUndefined();
  });
});

describe("spec provenance in the runtime (security review)", () => {
  it("a spec that only claims to be shipped gets no skills", async () => {
    const spec = testSpec({ origin: "shipped", operations: [listOp({ method: "POST", path: "/v1/search" })] });
    const { problem, skills } = await setup({ spec });
    expect(problem).toBe("invalid_spec");
    expect(skills).toEqual([]);
  });

  it("a bundled catalog spec runs; a spec signed with Dojo's key runs only when the runtime has that key", async () => {
    const bundled = catalogSpec("notion")!;
    expect((await setup({ spec: bundled })).problem).toBeUndefined();

    const seed = new Uint8Array(32).fill(3);
    const signed = signSpec(testSpec({ origin: "shipped", operations: [listOp({ method: "POST", path: "/v1/search" })] }), seed);
    const credentials = new MemoryCredentialStore();
    const installed = { spec: signed, approvedHash: specHash(signed), enabled: ["list_items"], credentialId: "cred-1" };
    const withKey = new ConnectorRuntime({ credentials, transport: new FakeTransport(), now: () => NOW, dojoPublicKey: ed25519.getPublicKey(seed) });
    expect(withKey.skillsFor(installed).skills.map((s) => s.operation)).toEqual(["list_items"]);
    const withoutKey = new ConnectorRuntime({ credentials, transport: new FakeTransport(), now: () => NOW });
    expect(withoutKey.skillsFor(installed).problem).toBe("invalid_spec");
  });
});

describe("connections and disconnect (US-CONN-02)", () => {
  it("lists every connected account with its service, scopes and last use, and no secret", async () => {
    const { runtime, spec } = await setup({ meta: { scopes: ["items.read"], lastUsedAt: NOW - 5, account: "ana@acme.example" } });
    const list = await runtime.connections([spec]);
    expect(list).toEqual([{ credentialId: "cred-1", connectorId: "acme_tasks", service: "Acme Tasks", account: "ana@acme.example", scopes: ["items.read"], lastUsedAt: NOW - 5, source: "user_entered" }]);
    expect(JSON.stringify(list)).not.toContain(KEY);
  });

  it("disconnect deletes the tokens and revokes them where the provider supports it", async () => {
    const spec = testSpec({ auth: [{ type: "oauth2_pkce", provider: "google" }] });
    const { runtime, credentials, transport } = await setup({
      spec,
      meta: { kind: "oauth2", source: "dojo_client", clientId: "dojo.apps.googleusercontent.com" },
      secret: { kind: "oauth2", accessToken: "a-1", refreshToken: "r-1" },
    });
    expect(await runtime.disconnect("cred-1", [spec])).toEqual({ deleted: true, revoked: "yes" });
    expect(await credentials.get("cred-1")).toBeUndefined();
    expect(transport.sent[0]?.url).toBe("https://oauth2.googleapis.com/revoke");
  });

  it("deletes locally even when the provider has no revocation or it fails", async () => {
    const { runtime, credentials } = await setup();
    expect(await runtime.disconnect("cred-1", [testSpec()])).toEqual({ deleted: true, revoked: "unsupported" });
    expect(await credentials.get("cred-1")).toBeUndefined();

    const spec = testSpec({ auth: [{ type: "oauth2_pkce", provider: "google" }] });
    const failing = new FakeTransport(() => ({ status: 500, body: "" }));
    const s2 = await setup({ spec, transport: failing, meta: { kind: "oauth2" }, secret: { kind: "oauth2", accessToken: "a" } });
    expect(await s2.runtime.disconnect("cred-1", [spec])).toEqual({ deleted: true, revoked: "failed" });
    expect(await s2.credentials.get("cred-1")).toBeUndefined();
    expect(await s2.runtime.disconnect("cred-1", [spec])).toEqual({ deleted: false, revoked: "unsupported" });
  });
});

describe("connector details (HM-CONN-02)", () => {
  it("lists every host and each operation with its effective risk", async () => {
    const { runtime } = await setup();
    const d = runtime.details(testSpec({ operations: [listOp(), deleteOp()] }));
    expect(d.hosts).toEqual(["api.acme.example"]);
    expect(d.operations).toEqual([
      { name: "list_items", title: "List items", risk: "network", effect: "read", destructive: false, scopes: ["items.read"] },
      { name: "delete_item", title: "Delete an item", risk: "remote_write", effect: "delete", destructive: true, scopes: ["items.write"] },
    ]);
    expect(d.signIn).toEqual(["api_key"]);
  });
});
