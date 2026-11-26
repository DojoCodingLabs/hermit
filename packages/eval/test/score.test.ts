import { describe, expect, test } from "vitest";
import { loadCases, runEval, scoreCase, type EvalCase } from "../src/index.ts";
import { FakeModel } from "../src/fake-model.ts";

const remindCase: EvalCase = { id: "es-remind", lang: "es", input: "Recuérdame llamar a mamá a las 9", expect: { choice: "remind", args: { text: "llamar a mamá" } } };

describe("loadCases", () => {
  test("loadCases parses jsonl and reports bad line numbers", () => {
    const good = JSON.stringify(remindCase);
    expect(loadCases(`${good}\n\n${good}\n`)).toHaveLength(2);
    expect(() => loadCases(`${good}\n{not json}\n`)).toThrow(/line 2/);
  });
});

describe("scoreCase", () => {
  test("scoreCase passes on matching choice and args", () => {
    expect(scoreCase(remindCase, { choice: "remind", args: { text: "llamar a mamá", at: "2026-11-09T21:00:00" } }).pass).toBe(true);
  });

  test("scoreCase fails on wrong choice", () => {
    const r = scoreCase(remindCase, { choice: "remember" });
    expect(r.pass).toBe(false);
    expect(r.reason).toMatch(/choice/);
  });

  test("scoreCase allows extra args but not wrong ones", () => {
    expect(scoreCase(remindCase, { choice: "remind", args: { text: "llamar a papá" } }).pass).toBe(false);
  });
});

describe("runEval", () => {
  test("runEval with FakeModel reports passed/total", async () => {
    const model = new FakeModel({ "Recuérdame llamar a mamá a las 9": { choice: "remind", args: { text: "llamar a mamá" } } });
    const other: EvalCase = { ...remindCase, id: "unknown", input: "something unscripted" };
    const report = await runEval([remindCase, other], model);
    expect(report).toMatchObject({ passed: 1, total: 2 });
  });
});

import { FIRST_WIN_CASES } from "../src/first-win-cases.ts";
test("contains checks are case-insensitive substrings", () => {
  const c = { id: "x", lang: "es" as const, input: "", expect: { choice: "remind", contains: { at: "T21:00" } } };
  expect(scoreCase(c, { choice: "remind", args: { at: "2026-11-11T21:00" } }).pass).toBe(true);
  expect(scoreCase(c, { choice: "remind", args: { at: "2026-11-11T09:00" } }).pass).toBe(false);
});
test("the first-win set is 40 cases, half in each language, unique ids", () => {
  expect(FIRST_WIN_CASES).toHaveLength(40);
  expect(FIRST_WIN_CASES.filter((c) => c.lang === "es")).toHaveLength(20);
  expect(new Set(FIRST_WIN_CASES.map((c) => c.id)).size).toBe(40);
});
