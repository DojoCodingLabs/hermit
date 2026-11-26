import { describe, expect, it } from "vitest";
import { riskAtLeast, riskFloor, validateSpec } from "@hermit/connectors";
import type { CompletionEngine, EngineRequest } from "@hermit/model";
import { assemble, docPaths, docTokens, docUrls, draftConnector, goldDraft, joinPath, mapAuth, sideEffectsFromFlags, type HeaderDraft, type OpDraft } from "../src/connector-draft/draft.ts";
import { DEV_FIXTURES } from "../src/connector-draft/fixtures.ts";
import { HOLDOUT_FIXTURES } from "../src/connector-draft/holdout.ts";
import { goldRisk, scoreDraft, summarize } from "../src/connector-draft/score.ts";

const ALL = [...DEV_FIXTURES, ...HOLDOUT_FIXTURES];
const byId = (id: string) => ALL.find((f) => f.id === id)!;

describe("connector draft fixtures", () => {
  it("has 8 dev and 2 held-out fixtures, some in Spanish, with unique ids", () => {
    expect(DEV_FIXTURES).toHaveLength(8);
    expect(HOLDOUT_FIXTURES).toHaveLength(2);
    expect(new Set(ALL.map((f) => f.id)).size).toBe(ALL.length);
    expect(ALL.filter((f) => f.lang === "es").length).toBeGreaterThanOrEqual(3);
  });

  it.each(ALL.map((f) => [f.id, f] as const))("%s: the gold draft assembles into a spec the validator accepts, or is refused when it must be", (_id, f) => {
    const { header, ops } = goldDraft(f);
    const a = assemble(header, ops, "owned");
    if (f.gold.refuse) {
      expect(a.refused).toBeTruthy();
    } else {
      expect(a.refused).toBeUndefined();
      expect(validateSpec(a.spec)).toEqual([]);
      expect(a.spec.hosts).toEqual(f.gold.hosts);
      expect(a.spec.operations.map((o) => `${o.method} ${o.path}`)).toEqual(f.gold.operations.map((o) => `${o.method} ${o.path}`));
    }
  });

  it("puts the floors where the docs say the money and the messages are", () => {
    expect(goldRisk(byId("cobros_es"), 0)).toBe("spend");
    expect(goldRisk(byId("cobros_es"), 1)).toBe("network");
    expect(goldRisk(byId("mensajes_es"), 0)).toBe("send");
    expect(goldRisk(byId("agenda_es"), 2)).toBe("send");
    expect(goldRisk(byId("todoist_en"), 3)).toBe("remote_write");
    expect(goldRisk(byId("boletin_es"), 2)).toBe("send");
  });
});

describe("assembling a draft", () => {
  it("joins the base path once, whatever form the model wrote the path in", () => {
    expect(joinPath("https://api.todoist.com/rest/v2", "/tasks")).toBe("/rest/v2/tasks");
    expect(joinPath("https://api.todoist.com/rest/v2/", "/rest/v2/tasks")).toBe("/rest/v2/tasks");
    expect(joinPath("https://api.todoist.com/rest/v2", "https://api.todoist.com/rest/v2/tasks/{id}")).toBe("/rest/v2/tasks/{id}");
    expect(joinPath("https://api.github.com", "/repos/{owner}/{repo}/issues")).toBe("/repos/{owner}/{repo}/issues");
    expect(joinPath("https://api.x.com/v1", "notes?limit=5")).toBe("/v1/notes");
  });

  it("maps the model's sign-in words to a CT-12 auth entry", () => {
    expect(mapAuth({ kind: "bearer", name: "", prefix: "" })).toEqual({ type: "api_key", in: "header", name: "Authorization", prefix: "Bearer " });
    expect(mapAuth({ kind: "header_key", name: "X-Api-Key", prefix: "" })).toEqual({ type: "api_key", in: "header", name: "X-Api-Key" });
    expect(mapAuth({ kind: "header_key", name: "Authorization", prefix: "apikey" })).toEqual({ type: "api_key", in: "header", name: "Authorization", prefix: "apikey " });
    expect(mapAuth({ kind: "query_key", name: "appid", prefix: "" })).toEqual({ type: "api_key", in: "query", name: "appid" });
    expect(mapAuth({ kind: "basic", name: "", prefix: "" })).toEqual({ type: "basic" });
    expect(mapAuth({ kind: "other", name: "", prefix: "" })).toBeUndefined();
  });

  const header: HeaderDraft = {
    name: "Jotter Notes",
    baseUrl: "https://api.jotter.app/v1",
    auth: { kind: "header_key", name: "X-Jotter-Token", prefix: "" },
    domain: "notes",
    endpoints: [{ method: "PUT", path: "/notes/{note_id}", summary: "Replace a note" }],
  };
  const op: OpDraft = { name: "replace_note", title: "Replace a note", description: "Overwrite a note.", params: [{ name: "title", in: "body", type: "string", required: true }], sideEffects: [] };

  it("owned mode: code derives effect, flags and risk, adds a missing placeholder argument and a default side effect", () => {
    const a = assemble(header, [op], "owned");
    expect(a.refused).toBeUndefined();
    expect(validateSpec(a.spec)).toEqual([]);
    const o = a.spec.operations[0]!;
    expect(o).toMatchObject({ effect: "write", destructive: false, idempotent: true, risk: "remote_write", sideEffects: ["updates"] });
    expect(o.inputSchema).toMatchObject({ required: expect.arrayContaining(["note_id", "title"]) });
    expect(a.repairs).toEqual(expect.arrayContaining([expect.stringContaining("note_id"), expect.stringContaining("side effect")]));
  });

  it("raw mode: the model's own effect and risk go to the validator, which refuses a write marked read", () => {
    const a = assemble(header, [{ ...op, effect: "read", destructive: false, idempotent: true, risk: "read" }], "raw");
    const errors = validateSpec(a.spec);
    expect(errors.some((e) => e.includes("effect read needs GET"))).toBe(true);
  });

  it("refuses plain HTTP and local hosts before validation", () => {
    expect(assemble({ ...header, baseUrl: "http://api.jotter.app/v1" }, [op], "owned").refused).toMatch(/https/i);
    expect(assemble({ ...header, baseUrl: "https://homeassistant.local:8123/api" }, [op], "owned").refused).toMatch(/public/i);
  });

  it("refuses a sign-in it can't express and a draft with no endpoints", () => {
    expect(assemble({ ...header, auth: { kind: "other", name: "", prefix: "" } }, [op], "owned").refused).toMatch(/sign-in/i);
    expect(assemble({ ...header, endpoints: [] }, [], "owned").refused).toMatch(/endpoint/i);
  });

  it("keeps operation names unique", () => {
    const two = assemble({ ...header, endpoints: [header.endpoints[0]!, { method: "DELETE", path: "/notes/{note_id}", summary: "" }] }, [op, { ...op, params: [], sideEffects: ["deletes"] }], "owned");
    expect(two.spec.operations.map((o) => o.name)).toEqual(["replace_note", "replace_note_2"]);
    expect(validateSpec(two.spec)).toEqual([]);
  });
});

describe("scoring a draft", () => {
  it("a gold draft scores perfectly", () => {
    for (const f of ALL) {
      const { header, ops } = goldDraft(f);
      const s = scoreDraft(f, header, ops, assemble(header, ops, "owned"), "owned");
      expect(s.outcomeCorrect).toBe(true);
      expect(s.ops.every((o) => o.method && o.path && o.paramsExact && o.sideEffectsExact && o.riskCorrect)).toBe(true);
      expect(s.extraOps).toBe(0);
      expect(s.missedOps).toBe(0);
      expect(s.fullyCorrect).toBe(!f.gold.refuse);
    }
  });

  it("an omitted 'sends' is a valid spec with a risk below the gold floor: under-risk the validator can't catch", () => {
    const f = byId("mensajes_es");
    const { header, ops } = goldDraft(f);
    const bad = ops.map((o, i) => (i === 0 ? { ...o, sideEffects: ["creates"] } : o));
    const a = assemble(header, bad, "owned");
    expect(validateSpec(a.spec)).toEqual([]);
    const s = scoreDraft(f, header, bad, a, "owned");
    expect(s.valid).toBe(true);
    expect(s.ops[0]).toMatchObject({ riskCorrect: false, underRisk: true, sideEffectsExact: false });
    expect(s.fullyCorrect).toBe(false);
  });

  it("aligns by method and path, counts a wrong method, a missing and an extra endpoint, and scores params", () => {
    const f = byId("todoist_en");
    const { header, ops } = goldDraft(f);
    const h2: HeaderDraft = {
      ...header,
      endpoints: [
        header.endpoints[0]!,
        { ...header.endpoints[1]!, method: "PUT" },
        header.endpoints[3]!,
        { method: "GET", path: "/rest/v2/projects", summary: "" },
      ],
    };
    const o2 = [ops[0]!, { ...ops[1]!, params: ops[1]!.params.slice(0, 2) }, ops[3]!, ops[0]!];
    const s = scoreDraft(f, h2, o2, assemble(h2, o2, "owned"), "owned");
    expect(s.ops).toHaveLength(4);
    const create = s.ops.find((o) => o.gold === "POST /rest/v2/tasks")!;
    expect(create).toMatchObject({ matched: true, method: false, path: true, paramsExact: false });
    expect(create.paramNames).toEqual({ tp: 2, fp: 0, fn: 1 });
    expect(s.ops.find((o) => o.gold === "POST /rest/v2/tasks/{task_id}/close")).toMatchObject({ matched: false });
    expect(s.missedOps).toBe(1);
    expect(s.extraOps).toBe(1);
  });

  it("a refusal fixture scores correct only when the draft is refused", () => {
    const f = byId("homeassistant_local_en");
    const { header, ops } = goldDraft(f);
    expect(scoreDraft(f, header, ops, assemble(header, ops, "owned"), "owned").outcomeCorrect).toBe(true);
    const sneaky = { ...header, baseUrl: "https://homeassistant.example.com/api" };
    expect(scoreDraft(f, sneaky, ops, assemble(sneaky, ops, "owned"), "owned").outcomeCorrect).toBe(false);
  });

  it("summarizes rates over fixtures and operations", () => {
    const scores = ALL.map((f) => {
      const { header, ops } = goldDraft(f);
      return scoreDraft(f, header, ops, assemble(header, ops, "owned"), "owned");
    });
    const sum = summarize(scores);
    expect(sum.fixtures).toBe(10);
    expect(sum.validRate).toEqual([9, 9]);
    expect(sum.outcome).toEqual([10, 10]);
    expect(sum.underRisk).toBe(0);
    expect(sum.field.method[0]).toBe(sum.field.method[1]);
  });
});

describe("drafting through an engine", () => {
  it("asks for the header, then one grammar-constrained call per endpoint, and returns what the model wrote", async () => {
    const f = byId("weather_en");
    const { header, ops } = goldDraft(f);
    const seen: EngineRequest[] = [];
    const replies = [JSON.stringify(header), ...ops.map((o) => JSON.stringify(o))];
    const engine: CompletionEngine = {
      async complete(req) {
        seen.push(req);
        return { text: replies[seen.length - 1]!, toolCalls: [] };
      },
    };
    const d = await draftConnector(engine, f.doc, { mode: "owned", thinking: { enabled: false } });
    expect(seen).toHaveLength(1 + ops.length);
    expect(seen.every((r) => r.jsonSchema)).toBe(true);
    expect(seen[1]!.messages.at(-1)!.content).toContain("GET /data/2.5/weather");
    expect(d.assembled.refused).toBeUndefined();
    expect(validateSpec(d.assembled.spec)).toEqual([]);
    expect(riskFloor(d.assembled.spec.operations[0]!).risk).toBe("network");
  });

  it("records unparseable output as a failed draft instead of throwing", async () => {
    const engine: CompletionEngine = { complete: async () => ({ text: "not json", toolCalls: [] }) };
    const d = await draftConnector(engine, "doc", { mode: "owned", thinking: { enabled: false } });
    expect(d.assembled.refused).toMatch(/parse/i);
  });
});

describe("harness v1: grammar pinned to the doc, code repairs and the risk guard", () => {
  const todoist = byId("todoist_en");
  it("pins what the model can write to what the doc contains", () => {
    expect(docUrls(todoist.doc)).toEqual(["https://api.todoist.com/rest/v2"]);
    expect(docPaths(todoist.doc)).toEqual(["/tasks", "/tasks/{task_id}/close", "/tasks/{task_id}"]);
    expect(docPaths(byId("github_issues_en").doc)).toContain("/repos/{owner}/{repo}/issues/{issue_number}");
    const tokens = docTokens(byId("cobros_es").doc);
    expect(tokens).toEqual(expect.arrayContaining(["cliente_id", "X-Api-Key", "monto", "cobro_id"]));
    expect(tokens).not.toContain("client_id");
  });

  it("reads the v1 sign-in shape", () => {
    expect(mapAuth({ in: "header", name: "Authorization", prefix: "Bearer" })).toEqual({ type: "api_key", in: "header", name: "Authorization", prefix: "Bearer " });
    expect(mapAuth({ in: "header", name: "X-Jotter-Token", prefix: "" })).toEqual({ type: "api_key", in: "header", name: "X-Jotter-Token" });
    expect(mapAuth({ in: "query", name: "appid", prefix: "" })).toEqual({ type: "api_key", in: "query", name: "appid" });
    expect(mapAuth({ in: "basic", name: "", prefix: "" })).toEqual({ type: "basic" });
    expect(mapAuth({ in: "other", name: "", prefix: "" })).toBeUndefined();
  });

  it("turns the yes/no side-effect answers into the CT-12 list", () => {
    expect(sideEffectsFromFlags({ creates: true, updates: false, deletes: false, sends_message_or_email: true, moves_money: false })).toEqual(["creates", "sends"]);
  });

  it("moves an argument the model put in the path but the path doesn't have to the query or body", () => {
    const f = byId("mensajes_es");
    const { header, ops } = goldDraft(f);
    const wrong = ops.map((o) => ({ ...o, params: o.params.map((x) => ({ ...x, in: "path" as const })) }));
    const a = assemble(header, wrong, "owned", { harness: "v1", doc: f.doc });
    expect(validateSpec(a.spec)).toEqual([]);
    expect(a.spec.operations[0]!.body).toEqual({ destino: "destino", texto: "texto", remitente: "remitente" });
    expect(a.repairs.filter((r) => r.includes("moved")).length).toBeGreaterThanOrEqual(4);
    const s = scoreDraft(f, header, wrong, a, "owned");
    expect(s.ops[0]).toMatchObject({ paramsExact: false, paramsFinalExact: true });
    expect(summarize([s]).field.paramsFinalExact[0]).toBe(3);
  });

  it("raises (never lowers) the risk when the endpoint's doc section talks about money or sending", () => {
    for (const [id, i, want] of [["cobros_es", 0, "spend"], ["mensajes_es", 0, "send"], ["agenda_es", 2, "send"]] as const) {
      const f = byId(id);
      const { header, ops } = goldDraft(f);
      const stripped = ops.map((o) => ({ ...o, sideEffects: o.sideEffects.filter((s) => s !== "sends" && s !== "moves_money") }));
      const guarded = assemble({ ...header, domain: "other" }, stripped, "owned", { harness: "v1", doc: f.doc });
      expect(riskAtLeast(guarded.spec.operations[i]!.risk, want)).toBe(true);
      expect(guarded.repairs.some((r) => r.includes("guard"))).toBe(true);
    }
    const t = goldDraft(todoist);
    expect(assemble(t.header, t.ops, "owned", { harness: "v1", doc: todoist.doc }).repairs.filter((r) => r.includes("guard"))).toEqual([]);
  });

  it("a gold draft through v1 keeps the right outcome and never lands below a floor; the guard may only over-ask", () => {
    for (const f of ALL) {
      const { header, ops } = goldDraft(f);
      const a = assemble(header, ops, "owned", { harness: "v1", doc: f.doc });
      const s = scoreDraft(f, header, ops, a, "owned");
      expect(s.outcomeCorrect).toBe(true);
      expect(s.ops.some((o) => o.underRisk)).toBe(false);
      if (!f.gold.refuse && !a.repairs.some((r) => r.includes("guard"))) expect(s.fullyCorrect).toBe(true);
    }
    for (const id of ["weather_en", "todoist_en", "github_issues_en", "jotter_injection_en"]) {
      const { header, ops } = goldDraft(byId(id));
      expect(assemble(header, ops, "owned", { harness: "v1", doc: byId(id).doc }).repairs).toEqual([]);
    }
  });

  it("v1 drafting sends grammar pinned to the doc", async () => {
    const f = byId("weather_en");
    const seen: EngineRequest[] = [];
    const engine: CompletionEngine = {
      async complete(req) {
        seen.push(req);
        return { text: "not json", toolCalls: [] };
      },
    };
    await draftConnector(engine, f.doc, { mode: "owned", thinking: { enabled: false }, harness: "v1" });
    const s = JSON.stringify(seen[0]!.jsonSchema);
    expect(s).toContain("/data/2.5/forecast");
    expect(s).toContain("https://api.openweathermap.org");
  });
});
