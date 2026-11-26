import { describe, expect, it } from "vitest";
import { argsHash, type SessionState } from "@hermit/core";
import {
  ConnectorInstalls,
  KNOWN_MCP_SERVERS,
  McpServers,
  MemoryCredentialStore,
  MemoryInstalledStore,
  MemoryMcpServerStore,
  specHash,
  type ConnectDeps,
  type ConnectReview,
  type ConnectStep,
} from "../src/index.ts";
import { fakeEngine, openApiDoc, TASKS_DOC, tasksHeader, tasksOps } from "./connect-fixtures.ts";
import { fakeNet, json, type Handler } from "./mcp-fixtures.ts";

const session: SessionState = { id: "s1", taint: [], unattended: false };
const TASKS_PAGE = `<html><body><h1>Docs</h1><pre>${TASKS_DOC}</pre></body></html>`;
const html = (body: string) => ({ status: 200, headers: { "content-type": "text/html" }, body });

function setup(routes: Record<string, Handler> = {}, over: Partial<ConnectDeps> = {}) {
  const net = fakeNet(routes);
  const credentials = new MemoryCredentialStore();
  const store = new MemoryInstalledStore();
  const logged: Array<{ reason: string; specHash: string }> = [];
  const engine = fakeEngine(tasksHeader(), tasksOps());
  let confirmed = true;
  let n = 0;
  const deps: ConnectDeps = {
    transport: net,
    credentials,
    store,
    now: () => 1_700_000_000_000,
    random: (len) => new Uint8Array(len).fill(++n),
    engine,
    pageText: (body) => body.replace(/<[^>]+>/g, " "),
    confirm: async () => confirmed,
    log: async (e) => void logged.push(e),
    ...over,
  };
  const flow = new ConnectorInstalls(deps);
  return { flow, net, credentials, store, logged, engine, setConfirmed: (v: boolean) => (confirmed = v) };
}

const review = (s: ConnectStep): ConnectReview => {
  if (s.kind !== "review") throw new Error(`expected a review, got ${JSON.stringify(s)}`);
  return s.review;
};

describe("discovery order (SL-52 verdict, FR-CONN-06)", () => {
  it("1. a bundled catalog connector comes first, by name", async () => {
    const { flow, net } = setup();
    const r = review(await flow.start({ text: "conéctate a GitHub", origin: "typed" }));
    expect(r).toMatchObject({ source: "catalog", name: "GitHub", hosts: ["api.github.com"], madeByHermit: false });
    expect(net.sent).toHaveLength(0);
    // Notion has both a catalog spec and an official MCP server: the catalog wins.
    expect(review(await flow.start({ text: "Notion", origin: "typed" })).source).toBe("catalog");
  });

  it("2. then an MCP server the service publishes, handed to HM-CONN-03 for the user to add", async () => {
    const { flow, net } = setup();
    const s = await flow.start({ text: "connect me to Linear", origin: "typed" });
    expect(s).toEqual({ kind: "mcp", name: "Linear", serverUrl: "https://mcp.linear.app/mcp" });
    expect(net.sent).toHaveLength(0);
  });

  it("3. then an OpenAPI document, with no model call", async () => {
    const { flow, engine } = setup({ "GET https://api.petstore.example.com/openapi.json": () => json(openApiDoc()) });
    const r = review(await flow.start({ text: "https://api.petstore.example.com/openapi.json", origin: "pasted" }));
    expect(r).toMatchObject({ source: "openapi", name: "Petstore Plus", madeByHermit: false });
    expect(engine.calls).toHaveLength(0);
  });

  it("3. a docs page whose host publishes /openapi.json imports that instead of drafting", async () => {
    const { flow, engine, net } = setup({
      "GET https://docs.petstore.example.com/reference": () => html("<p>Reference</p>"),
      "GET https://docs.petstore.example.com/openapi.json": () => json(openApiDoc({ servers: [{ url: "https://api.petstore.example.com/v1" }] })),
    });
    expect(review(await flow.start({ text: "https://docs.petstore.example.com/reference", origin: "typed" })).source).toBe("openapi");
    expect(engine.calls).toHaveLength(0);
    expect(net.sent.map((r) => r.url)).toEqual(["https://docs.petstore.example.com/reference", "https://docs.petstore.example.com/openapi.json"]);
  });

  it("4. last, the phone model drafts from a short docs page, labeled Made by Hermit", async () => {
    const { flow, engine } = setup({ "GET https://docs.taskly.example.com/api": () => html(TASKS_PAGE) });
    const r = review(await flow.start({ text: "https://docs.taskly.example.com/api", origin: "typed" }));
    expect(r).toMatchObject({ source: "drafted", madeByHermit: true, docHost: "docs.taskly.example.com", hosts: ["api.taskly.example.com"] });
    expect(engine.calls.length).toBeGreaterThan(1);
    expect(r.operations.find((o) => o.method === "DELETE")).toMatchObject({ risk: "remote_write", destructive: true });
  });

  it("4. or from an excerpt the user pastes", async () => {
    const { flow } = setup();
    expect(review(await flow.start({ text: TASKS_DOC, origin: "pasted" })).source).toBe("drafted");
  });

  it("a name with nothing known asks for a docs link (or the vault for services with no API)", async () => {
    const { flow, net } = setup();
    expect(await flow.start({ text: "my gym's booking system", origin: "typed" })).toEqual({ kind: "need_docs" });
    expect(net.sent).toHaveLength(0);
  });

  it("the known MCP list only holds HTTPS addresses that pass the client's checks", () => {
    for (const s of KNOWN_MCP_SERVERS) expect(s.url.startsWith("https://")).toBe(true);
  });
});

describe("docs from the web are untrusted and every request is checked", () => {
  it("refuses http, private and odd addresses before any request", async () => {
    const { flow, net } = setup();
    for (const text of ["http://docs.example.com/api", "https://192.168.1.10/api", "https://intranet.local/api", "https://user:pw@docs.example.com/", "https://docs.example.com:8443/api"]) {
      expect(await flow.start({ text, origin: "typed" })).toEqual({ kind: "refused", problem: "bad_url" });
    }
    expect(net.sent).toHaveLength(0);
  });

  it("a redirect to a private host is never followed", async () => {
    const { flow, net } = setup({ "GET https://docs.taskly.example.com/api": () => ({ status: 302, headers: { location: "https://router.local/admin" }, body: "" }) });
    expect(await flow.start({ text: "https://docs.taskly.example.com/api", origin: "typed" })).toEqual({ kind: "refused", problem: "unreachable" });
    expect(net.sent.map((r) => r.url)).toEqual(["https://docs.taskly.example.com/api"]);
  });

  it("a long page is refused on the phone with a clear reason and no model call", async () => {
    const { flow, engine } = setup({ "GET https://docs.taskly.example.com/api": () => html(`${TASKS_PAGE}${"<p>More reference text.</p>".repeat(400)}`) });
    expect(await flow.start({ text: "https://docs.taskly.example.com/api", origin: "typed" })).toEqual({ kind: "refused", problem: "too_long" });
    expect(engine.calls).toHaveLength(0);
  });

  it("only the user's own words start it: anything else is refused", async () => {
    const { flow } = setup();
    expect(await flow.start({ text: "GitHub", origin: "page" as never })).toEqual({ kind: "refused", problem: "not_user_entered" });
  });

  it("without the phone model, drafting is refused and nothing else changes", async () => {
    const { flow } = setup({ "GET https://docs.taskly.example.com/api": () => html(TASKS_PAGE) }, { engine: undefined });
    expect(await flow.start({ text: "https://docs.taskly.example.com/api", origin: "typed" })).toEqual({ kind: "refused", problem: "drafting_unavailable" });
  });
});

const API = "https://api.taskly.example.com/v2/tasks";

describe("review, key, test call and install (US-CONN-05)", () => {
  async function drafted(routes: Record<string, Handler> = {}) {
    const t = setup({ "GET https://docs.taskly.example.com/api": () => html(TASKS_PAGE), ...routes });
    const r = review(await t.flow.start({ text: "https://docs.taskly.example.com/api", origin: "typed" }));
    return { ...t, r };
  }

  it("nothing is saved or logged until the user installs", async () => {
    const { store, logged, credentials } = await drafted();
    expect(await store.load()).toEqual([]);
    expect(logged).toEqual([]);
    expect(await credentials.list()).toEqual([]);
  });

  it("the test call sends one read with the user's key in the sign-in the review shows", async () => {
    const { flow, r, net } = await drafted({ [`GET ${API}`]: (req) => json(req.auth?.value.reveal() === "Bearer k-123" ? [] : { error: "no" }, req.auth?.value.reveal() === "Bearer k-123" ? 200 : 401) });
    expect(r.testable).toEqual(["list_tasks"]);
    expect(await flow.testCall(r.draftId)).toEqual({ result: "no_key" });
    await flow.saveKey(r.draftId, { key: "k-123" });
    expect(await flow.testCall(r.draftId)).toEqual({ result: "ok" });
    const sent = net.sent.at(-1)!;
    expect(sent.url).toBe(API);
    expect(sent.url).not.toContain("k-123");
  });

  it("a wrong sign-in fails closed (401) and blocks the install until the user changes it", async () => {
    const { flow, r } = await drafted({ [`GET ${API}`]: () => json({ error: "unauthorized" }, 401) });
    await flow.saveKey(r.draftId, { key: "wrong" });
    expect(await flow.testCall(r.draftId)).toEqual({ result: "refused" });
    expect(await flow.install(r.draftId, { enabled: ["list_tasks"] })).toEqual({ ok: false, problem: "not_tested" });
  });

  it("install needs a passing test call, then a fingerprint; the spec hash goes to the signed log", async () => {
    const { flow, r, store, logged, setConfirmed } = await drafted({ [`GET ${API}`]: () => json([]) });
    expect(await flow.install(r.draftId, { enabled: ["list_tasks"] })).toEqual({ ok: false, problem: "no_key" });
    await flow.saveKey(r.draftId, { key: "k-123" });
    expect(await flow.install(r.draftId, { enabled: ["list_tasks"] })).toEqual({ ok: false, problem: "not_tested" });
    await flow.testCall(r.draftId);
    setConfirmed(false);
    expect(await flow.install(r.draftId, { enabled: ["list_tasks"] })).toEqual({ ok: false, problem: "not_confirmed" });
    expect(await store.load()).toEqual([]);
    setConfirmed(true);
    const done = await flow.install(r.draftId, { enabled: ["list_tasks", "delete_task"] });
    if (!done.ok) throw new Error(done.problem);
    const [rec] = await store.load();
    expect(rec!.approvedHash).toBe(specHash(rec!.spec));
    expect(logged).toEqual([{ reason: "connector.installed", specHash: rec!.approvedHash }]);
    expect(done.connector).toMatchObject({ id: "taskly", madeByHermit: true, enabled: ["list_tasks", "delete_task"] });
  });

  it("the user can only raise a risk, never lower one", async () => {
    const { flow, r } = await drafted({ [`GET ${API}`]: () => json([]) });
    await flow.saveKey(r.draftId, { key: "k" });
    await flow.testCall(r.draftId);
    const done = await flow.install(r.draftId, { enabled: ["list_tasks", "delete_task"], raised: { list_tasks: "send", delete_task: "read" } });
    if (!done.ok) throw new Error(done.problem);
    expect(done.connector.operations.find((o) => o.name === "list_tasks")!.risk).toBe("send");
    expect(done.connector.operations.find((o) => o.name === "delete_task")!.risk).toBe("remote_write");
  });

  it("changing the sign-in accepts only doc words and resets the test call", async () => {
    const { flow, r } = await drafted({ [`GET ${API}`]: () => json([]) });
    expect(r.signIn).toMatchObject({ reading: { kind: "bearer" }, changeable: true });
    expect(r.signIn.words).toContain("Authorization");
    await flow.saveKey(r.draftId, { key: "k" });
    await flow.testCall(r.draftId);
    expect(await flow.setSignIn(r.draftId, { kind: "header_key", name: "X-Secret" })).toEqual({ kind: "refused", problem: "sign_in_not_in_doc" });
    const changed = await flow.setSignIn(r.draftId, { kind: "query_key", name: "project" });
    expect(changed.kind === "review" && changed.review.tested).toBeUndefined();
    expect(await flow.install(r.draftId, { enabled: ["list_tasks"] })).toEqual({ ok: false, problem: "not_tested" });
  });

  it("a catalog connector that only signs in with OAuth can't be installed here yet", async () => {
    const { flow } = setup();
    const r = review(await flow.start({ text: "Spotify", origin: "typed" }));
    expect(r.signIn).toMatchObject({ available: false, changeable: false });
    expect(await flow.install(r.draftId, { enabled: [] })).toEqual({ ok: false, problem: "sign_in_unavailable" });
  });

  it("cancel deletes the key it saved", async () => {
    const { flow, r, credentials } = await drafted();
    await flow.saveKey(r.draftId, { key: "k" });
    expect(await credentials.list()).toHaveLength(1);
    await flow.cancel(r.draftId);
    expect(await credentials.list()).toEqual([]);
  });
});

describe("installed connectors (US-CONN-05)", () => {
  async function installed(routes: Record<string, Handler> = {}) {
    const t = setup({
      "GET https://docs.taskly.example.com/api": () => html(TASKS_PAGE),
      [`GET ${API}`]: () => json([{ id: "1", content: "milk" }]),
      [`POST ${API}`]: () => json({ id: "2" }),
      ...routes,
    });
    const r = review(await t.flow.start({ text: "https://docs.taskly.example.com/api", origin: "typed" }));
    await t.flow.saveKey(r.draftId, { key: "k-123" });
    await t.flow.testCall(r.draftId);
    const done = await t.flow.install(r.draftId, { enabled: ["list_tasks", "create_task"] });
    if (!done.ok) throw new Error(done.problem);
    return t;
  }

  it("enabled operations reach the menu, routed by the user's words and capped", async () => {
    const { flow } = await installed();
    const skills = await flow.skillsForTurn({ userText: "list my taskly tasks" });
    expect(skills.map((s) => s.def.id)).toEqual(["conn_taskly_list_tasks", "conn_taskly_create_task"]);
    expect(skills.every((s) => s.def.producesUntrusted)).toBe(true);
    expect(await flow.skillsForTurn({ userText: "hi", cap: 1 })).toHaveLength(1);
  });

  it("a write runs only with an approval of these exact arguments", async () => {
    const { flow, net } = await installed();
    const create = (await flow.skillsForTurn({ userText: "add a task" })).find((s) => s.operation === "create_task")!;
    expect(create.def.risk).toBe("remote_write");
    const args = { content: "milk" };
    expect((await create.execute(args, { session })).modelText).toMatch(/Not approved/);
    const ok = await create.execute(args, { session, approvedArgsHash: argsHash(args) });
    expect(ok.ok).toBe(true);
    expect(net.sent.at(-1)).toMatchObject({ method: "POST", url: API });
  });

  it('"Made by Hermit" stays until the first successful use', async () => {
    const { flow } = await installed();
    expect((await flow.list())[0]!.madeByHermit).toBe(true);
    const list = (await flow.skillsForTurn({ userText: "tasks" })).find((s) => s.operation === "list_tasks")!;
    await list.execute({}, { session });
    expect((await flow.list())[0]!.madeByHermit).toBe(false);
  });

  it("any change to an installed spec disables it until a new approval", async () => {
    const { flow, store } = await installed();
    const [rec] = await store.load();
    rec!.spec.operations[0]!.path = "/v2/everything";
    await store.save([rec!]);
    expect(await flow.skillsForTurn({ userText: "tasks" })).toEqual([]);
    expect((await flow.list())[0]!.changed).toBe(true);
  });

  it("an operation turned off leaves the menu", async () => {
    const { flow } = await installed();
    await flow.setOperation("taskly", "create_task", false);
    expect((await flow.skillsForTurn({ userText: "tasks" })).map((s) => s.operation)).toEqual(["list_tasks"]);
  });

  it("removing deletes the key and the record and logs it", async () => {
    const { flow, credentials, logged } = await installed();
    expect(await flow.remove("taskly")).toBe(true);
    expect(await flow.list()).toEqual([]);
    expect(await credentials.list()).toEqual([]);
    expect(logged.at(-1)!.reason).toBe("connector.removed");
  });

  it("installing again with a different spec replaces it only after a new fingerprint", async () => {
    const t = await installed();
    const r = review(await t.flow.start({ text: TASKS_DOC.replace("Deletes the task for good.", "Deletes the task."), origin: "pasted" }));
    expect(r.replaces).toBe(true);
    t.setConfirmed(false);
    await t.flow.saveKey(r.draftId, { key: "k" });
    await t.flow.testCall(r.draftId);
    expect(await t.flow.install(r.draftId, { enabled: [] })).toEqual({ ok: false, problem: "not_confirmed" });
    expect(await t.flow.list()).toHaveLength(1);
  });
});

describe("chat provenance is a one-time offer the runtime made, never a deep link (security review)", () => {
  it("origin chat needs a valid offer id for exactly the offered words, once", async () => {
    const { flow } = setup();
    expect(await flow.start({ text: "GitHub", origin: "chat" })).toEqual({ kind: "refused", problem: "not_user_entered" });
    expect(await flow.start({ text: "GitHub", origin: "chat", offerId: "made-up" })).toEqual({ kind: "refused", problem: "not_user_entered" });
    const id = flow.offer("GitHub");
    expect(await flow.start({ text: "Notion", origin: "chat", offerId: id })).toEqual({ kind: "refused", problem: "not_user_entered" });
    const id2 = flow.offer("GitHub");
    expect((await flow.start({ text: "GitHub", origin: "chat", offerId: id2 })).kind).toBe("review");
    expect(await flow.start({ text: "GitHub", origin: "chat", offerId: id2 })).toEqual({ kind: "refused", problem: "not_user_entered" });
  });

  it("the same words typed by the user still work without any id", async () => {
    const { flow } = setup();
    expect((await flow.start({ text: "GitHub", origin: "typed" })).kind).toBe("review");
  });
});

describe("connector skill ids never shadow another skill (security review)", () => {
  async function ready(reserved: string[]) {
    const t = setup({ "GET https://docs.taskly.example.com/api": () => html(TASKS_PAGE), [`GET ${API}`]: () => json([]) }, { reservedSkillIds: () => reserved });
    const r = review(await t.flow.start({ text: "https://docs.taskly.example.com/api", origin: "typed" }));
    await t.flow.saveKey(r.draftId, { key: "k" });
    await t.flow.testCall(r.draftId);
    return { ...t, r };
  }

  it("ids are namespaced conn_<spec>_<op>, so a connector op named reply_message stays its own skill", async () => {
    const { flow, r } = await ready(["reply_message", "list_tasks"]);
    const done = await flow.install(r.draftId, { enabled: ["list_tasks"] });
    expect(done.ok).toBe(true);
    expect((await flow.skillsForTurn({ userText: "tasks" })).map((s) => s.def.id)).toEqual(["conn_taskly_list_tasks"]);
  });

  it("an install whose skill id clashes with a registered skill is refused", async () => {
    const { flow, r, store } = await ready(["conn_taskly_list_tasks"]);
    expect(await flow.install(r.draftId, { enabled: ["list_tasks"] })).toEqual({ ok: false, problem: "skill_id_clash" });
    expect(await store.load()).toEqual([]);
  });

  it("an install whose skill id clashes with another installed connector's is refused", async () => {
    const { flow, r, store } = await ready([]);
    const fake = { spec: { id: "taskly_list", operations: [{ name: "tasks" }] }, approvedHash: "x", enabled: ["tasks"], credentialId: "c", source: "openapi", installedAt: 0, tested: "ok" };
    await store.save([fake as never]);
    // conn_taskly_list_tasks: spec "taskly_list" + op "tasks" collides with spec "taskly" + op "list_tasks".
    expect(await flow.install(r.draftId, { enabled: ["list_tasks"] })).toEqual({ ok: false, problem: "skill_id_clash" });
  });

  it("an installed op whose id later clashes is kept off the menu", async () => {
    let reserved: string[] = [];
    const t = setup({ "GET https://docs.taskly.example.com/api": () => html(TASKS_PAGE), [`GET ${API}`]: () => json([]) }, { reservedSkillIds: () => reserved });
    const r = review(await t.flow.start({ text: "https://docs.taskly.example.com/api", origin: "typed" }));
    await t.flow.saveKey(r.draftId, { key: "k" });
    await t.flow.testCall(r.draftId);
    await t.flow.install(r.draftId, { enabled: ["list_tasks", "create_task"] });
    reserved = ["conn_taskly_create_task"];
    expect((await t.flow.skillsForTurn({ userText: "tasks" })).map((s) => s.def.id)).toEqual(["conn_taskly_list_tasks"]);
  });
});

describe("an MCP suggestion (step 2) still needs the user's tap on HM-CONN-03", () => {
  it("McpServers accepts origin suggested only for a known server address", async () => {
    const servers = new McpServers({ transport: fakeNet({}), credentials: new MemoryCredentialStore(), store: new MemoryMcpServerStore(), now: () => 0, random: (n) => new Uint8Array(n), clientVersion: "1" });
    expect(await servers.begin({ url: "https://mcp.evil.example.com/mcp", origin: "suggested" })).toEqual({ kind: "refused", problem: "not_user_entered" });
    const known = await servers.begin({ url: KNOWN_MCP_SERVERS[0]!.url, origin: "suggested" });
    expect(known).not.toEqual({ kind: "refused", problem: "not_user_entered" });
  });
});
