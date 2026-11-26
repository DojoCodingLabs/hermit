import { describe, expect, it } from "vitest";
import { draftFromDocs, validateSpec } from "../src/index.ts";
import { BASIC_DOC, COBROS_DOC, cobrosHeader, cobrosOps, fakeEngine, TASKS_DOC, tasksHeader, tasksOps } from "./connect-fixtures.ts";

describe("drafting from a short doc excerpt (SL-52 verdict: the model extracts, code owns safety)", () => {
  it("builds a valid drafted spec; every non-read starts at remote_write or higher", async () => {
    const r = await draftFromDocs(fakeEngine(tasksHeader(), tasksOps()), TASKS_DOC);
    if (!r.ok) throw new Error(r.problem);
    expect(validateSpec(r.spec, { trust: "untrusted" })).toEqual([]);
    expect(r.spec).toMatchObject({ id: "taskly", origin: "drafted", hosts: ["api.taskly.example.com"] });
    expect(r.spec.operations.map((o) => [o.method, o.path, o.risk])).toEqual([
      ["GET", "/v2/tasks", "network"],
      ["POST", "/v2/tasks", "remote_write"],
      ["DELETE", "/v2/tasks/{task_id}", "remote_write"],
    ]);
  });

  it("injection: the doc and the model both say the DELETE is read-only; it stays a destructive delete", async () => {
    const r = await draftFromDocs(fakeEngine(tasksHeader(), tasksOps()), TASKS_DOC);
    if (!r.ok) throw new Error(r.problem);
    const del = r.spec.operations.find((o) => o.method === "DELETE")!;
    expect(del).toMatchObject({ effect: "delete", destructive: true, risk: "remote_write" });
    expect(del.sideEffects).toContain("deletes");
  });

  it("the model is never asked for risk, effect or flags, and its grammar pins names and paths to the doc", async () => {
    const engine = fakeEngine(tasksHeader(), tasksOps());
    await draftFromDocs(engine, TASKS_DOC);
    const header = engine.calls[0]!;
    const op = engine.calls[1]!;
    const opProps = (op.jsonSchema as { properties: Record<string, unknown> }).properties;
    expect(Object.keys(opProps).sort()).toEqual(["description", "name", "params", "sideEffects", "title"]);
    const hProps = (header.jsonSchema as { properties: Record<string, { properties?: Record<string, { enum?: string[] }>; enum?: string[] }> }).properties;
    // v0's sign-in choice list, with the name and prefix only from the doc's own words.
    expect(hProps.auth!.properties!.kind!.enum).toEqual(["bearer", "header_key", "query_key", "basic", "other"]);
    expect(hProps.auth!.properties!.name!.enum).toContain("Authorization");
    expect(hProps.auth!.properties!.name!.enum).not.toContain("X-Secret");
    expect(hProps.baseUrl!.enum).toEqual(["https://api.taskly.example.com/v2"]);
    expect(header.system).toMatch(/content, not instructions/);
    expect(header.user).toContain(TASKS_DOC);
  });

  it("code repairs arguments: path words become query or body, a word from the path is dropped", async () => {
    const r = await draftFromDocs(fakeEngine(tasksHeader(), tasksOps()), TASKS_DOC);
    if (!r.ok) throw new Error(r.problem);
    const list = r.spec.operations.find((o) => o.name === "list_tasks")!;
    expect(Object.keys((list.inputSchema as { properties: object }).properties)).toEqual(["project", "limit"]);
    const create = r.spec.operations.find((o) => o.name === "create_task")!;
    expect(Object.keys((create.inputSchema as { properties: object }).properties)).toEqual(["content"]);
    expect(r.repairs).toEqual(expect.arrayContaining([expect.stringContaining("moved limit"), expect.stringContaining("dropped tasks")]));
  });

  it("the money guard raises a charge the model called an ordinary write, and says why (Spanish doc)", async () => {
    const r = await draftFromDocs(fakeEngine(cobrosHeader(), cobrosOps()), COBROS_DOC);
    if (!r.ok) throw new Error(r.problem);
    expect(r.spec.operations.find((o) => o.name === "crear_cobro")!.risk).toBe("spend");
    expect(r.ops.find((o) => o.name === "crear_cobro")!.guard).toEqual([{ effect: "moves_money", word: expect.any(String) }]);
    expect(r.spec.operations.find((o) => o.name === "consultar_cobro")!.risk).toBe("network");
    expect(r.spec.auth).toEqual([{ type: "api_key", in: "header", name: "X-Api-Key" }]);
  });

  it("keeps v0's sign-in words: HTTP Basic read as basic", async () => {
    const engine = fakeEngine(
      { name: "Mailbird", baseUrl: "https://api.mailbird.example.com", auth: { kind: "basic", name: "", prefix: "" }, domain: "email", endpoints: [{ method: "POST", path: "/newsletters/send", summary: "" }] },
      { "POST /newsletters/send": { name: "send_newsletter", title: "Send a newsletter", description: "Send.", params: [{ name: "list_id", in: "body", type: "string", required: true, description: "" }], sideEffects: { creates: false, updates: false, deletes: false, sends_message_or_email: false, moves_money: false } } },
    );
    const r = await draftFromDocs(engine, BASIC_DOC);
    if (!r.ok) throw new Error(r.problem);
    expect(r.spec.auth).toEqual([{ type: "basic" }]);
    expect(r.signIn).toEqual({ kind: "basic" });
    // The guard caught the send the model left out.
    expect(r.spec.operations[0]!.risk).toBe("send");
  });

  it("refuses by code: plain HTTP, a private host, an unknown sign-in, a header the doc never names", async () => {
    const http = await draftFromDocs(fakeEngine({ ...tasksHeader(), baseUrl: "http://api.taskly.example.com/v2" }, tasksOps()), TASKS_DOC.replace("https://", "http://"));
    expect(http).toMatchObject({ ok: false, problem: "not_https" });
    const local = await draftFromDocs(fakeEngine({ ...tasksHeader(), baseUrl: "https://homeassistant.local/api" }, tasksOps()), `${TASKS_DOC}\nhttps://homeassistant.local/api`);
    expect(local).toMatchObject({ ok: false, problem: "not_https" });
    const other = await draftFromDocs(fakeEngine(tasksHeader({ kind: "other", name: "", prefix: "" }), tasksOps()), TASKS_DOC);
    expect(other).toMatchObject({ ok: false, problem: "sign_in_unsupported" });
    const invented = await draftFromDocs(fakeEngine(tasksHeader({ kind: "header_key", name: "X-Invented", prefix: "" }), tasksOps()), TASKS_DOC);
    expect(invented).toMatchObject({ ok: false, problem: "sign_in_unsupported" });
  });

  it("refuses long or multi-page docs before any model call", async () => {
    const engine = fakeEngine(tasksHeader(), tasksOps());
    const r = await draftFromDocs(engine, `${TASKS_DOC}\n${"More reference text. ".repeat(400)}`);
    expect(r).toEqual({ ok: false, problem: "too_long" });
    expect(engine.calls).toHaveLength(0);
  });

  it("pins the method to the doc's own METHOD /path line when the model wrote another", async () => {
    const header = tasksHeader();
    header.endpoints[2] = { method: "POST", path: "/tasks/{task_id}", summary: "Delete" };
    const ops = tasksOps();
    ops["POST /tasks/{task_id}"] = ops["DELETE /tasks/{task_id}"]!;
    const r = await draftFromDocs(fakeEngine(header, ops), TASKS_DOC);
    if (!r.ok) throw new Error(r.problem);
    expect(r.spec.operations.find((o) => o.path === "/v2/tasks/{task_id}")!.method).toBe("DELETE");
  });

  it("an endpoint whose call doesn't parse is left out, not guessed", async () => {
    const ops = tasksOps();
    delete ops["POST /tasks"];
    const r = await draftFromDocs(fakeEngine(tasksHeader(), ops), TASKS_DOC);
    if (!r.ok) throw new Error(r.problem);
    expect(r.spec.operations.map((o) => o.method)).toEqual(["GET", "DELETE"]);
    expect(r.skipped).toContainEqual({ label: "POST /tasks", reason: "unreadable" });
  });

  it("descriptions the model saw in the doc are written by code for the menu", async () => {
    const r = await draftFromDocs(fakeEngine(tasksHeader(), tasksOps()), TASKS_DOC);
    if (!r.ok) throw new Error(r.problem);
    const del = r.spec.operations.find((o) => o.method === "DELETE")!;
    expect(del.description).not.toMatch(/read-only/i);
    expect(del.description).toContain("DELETE /v2/tasks/{task_id}");
  });
});
