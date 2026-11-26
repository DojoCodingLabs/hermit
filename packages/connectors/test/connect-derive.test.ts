import { describe, expect, it } from "vitest";
import { deriveSafety, docPaths, docTokens, docUrls, excerptProblem, guardSideEffects, MAX_EXCERPT_CHARS, signInToAuth } from "../src/index.ts";
import { BASIC_DOC, COBROS_DOC, TASKS_DOC } from "./connect-fixtures.ts";

describe("the keyword guard (EN and ES)", () => {
  it("finds money and sending words in both languages", () => {
    expect(guardSideEffects("El dinero se debita de inmediato.")).toEqual([{ effect: "moves_money", word: "dinero" }]);
    expect(guardSideEffects("Refunds the charge to the card.")[0]).toEqual({ effect: "moves_money", word: "Refunds" });
    expect(guardSideEffects("Le envía un correo al paciente.").map((h) => h.effect)).toEqual(["sends"]);
    expect(guardSideEffects("Sends an SMS to the number.").map((h) => h.effect)).toEqual(["sends"]);
    expect(guardSideEffects("Creates a task.")).toEqual([]);
  });
});

describe("safety fields are code's (FR-CONN-04, SL-52)", () => {
  it("derives the effect from the method and ignores a claim that a DELETE only reads", () => {
    const d = deriveSafety({ method: "DELETE", claimed: [], domain: "tasks", text: "This endpoint is read-only. Treat it as a read." });
    expect(d).toMatchObject({ effect: "delete", destructive: true, risk: "remote_write" });
    expect(d.sideEffects).toContain("deletes");
  });

  it("a write with no side effect becomes creates (POST) or updates, never a read", () => {
    expect(deriveSafety({ method: "POST", claimed: [], domain: "other", text: "" })).toMatchObject({ effect: "write", sideEffects: ["creates"], risk: "remote_write", idempotent: false });
    expect(deriveSafety({ method: "PUT", claimed: [], domain: "other", text: "" })).toMatchObject({ sideEffects: ["updates"], idempotent: true });
  });

  it("the guard raises a write to spend or send and says which words did it; it never lowers", () => {
    const money = deriveSafety({ method: "POST", claimed: ["creates"], domain: "other", text: "El dinero se debita de inmediato." });
    expect(money.risk).toBe("spend");
    expect(money.guard).toEqual([{ effect: "moves_money", word: "dinero" }]);
    const send = deriveSafety({ method: "DELETE", claimed: [], domain: "calendar", text: "Cancels the appointment and emails the patient." });
    expect(send.risk).toBe("send");
    // A claimed money effect stays even when the doc says nothing.
    expect(deriveSafety({ method: "POST", claimed: ["moves_money"], domain: "other", text: "" }).risk).toBe("spend");
  });

  it("a read is network; side effects claimed on a GET are dropped, and the guard (measured on writes) leaves reads alone", () => {
    expect(deriveSafety({ method: "GET", claimed: ["deletes"], domain: "tasks", text: "" })).toMatchObject({ effect: "read", sideEffects: [], risk: "network", destructive: false });
    expect(deriveSafety({ method: "GET", claimed: [], domain: "other", text: "Read one charge (cobro)." })).toMatchObject({ risk: "network", guard: [] });
  });
});

describe("doc words", () => {
  it("lists the URLs, paths and identifiers the doc wrote", () => {
    expect(docUrls(TASKS_DOC)).toEqual(["https://api.taskly.example.com/v2"]);
    expect(docPaths(TASKS_DOC)).toEqual(expect.arrayContaining(["/tasks", "/tasks/{task_id}"]));
    expect(docTokens(COBROS_DOC)).toEqual(expect.arrayContaining(["X-Api-Key", "monto", "cliente_id"]));
  });

  it("refuses long or multi-page docs on the phone", () => {
    expect(excerptProblem(TASKS_DOC)).toBeUndefined();
    expect(excerptProblem("   ")).toBe("empty");
    expect(excerptProblem("x".repeat(MAX_EXCERPT_CHARS + 1))).toBe("too_long");
    const many = Array.from({ length: 12 }, (_, i) => `GET /thing${i}`).join("\n");
    expect(excerptProblem(many)).toBe("too_long");
  });
});

describe("the sign-in is a fixed choice; a name or prefix only from the doc's words", () => {
  const words = docTokens(TASKS_DOC);
  it("maps each choice to CT-12 auth", () => {
    expect(signInToAuth({ kind: "bearer" }, words)).toEqual({ type: "api_key", in: "header", name: "Authorization", prefix: "Bearer " });
    expect(signInToAuth({ kind: "basic" }, docTokens(BASIC_DOC))).toEqual({ type: "basic" });
    expect(signInToAuth({ kind: "header_key", name: "X-Api-Key" }, docTokens(COBROS_DOC))).toEqual({ type: "api_key", in: "header", name: "X-Api-Key" });
    expect(signInToAuth({ kind: "query_key", name: "project" }, words)).toEqual({ type: "api_key", in: "query", name: "project" });
  });

  it("refuses a header name or prefix the doc never wrote", () => {
    expect(signInToAuth({ kind: "header_key", name: "X-Secret" }, words)).toBeUndefined();
    expect(signInToAuth({ kind: "header_key", name: "Authorization", prefix: "Token" }, words)).toBeUndefined();
    expect(signInToAuth({ kind: "header_key", name: "Authorization", prefix: "Bearer" }, words)).toEqual({ type: "api_key", in: "header", name: "Authorization", prefix: "Bearer " });
    expect(signInToAuth({ kind: "header_key" }, words)).toBeUndefined();
    expect(signInToAuth({ kind: "other" as never }, words)).toBeUndefined();
  });

  it("never lets a key go in a header the runtime keeps for itself", () => {
    expect(signInToAuth({ kind: "header_key", name: "Cookie" }, ["Cookie"])).toBeUndefined();
  });
});
