import { describe, expect, test } from "vitest";
import { DEFS } from "../../skills/test/fixtures.ts";
import { BOT_CASES, BOTS, ROUTING_CASES, routingResults } from "../src/bot-cases.ts";

describe("the bot eval cases (PDR-003)", () => {
  const family = (f: string) => BOT_CASES.filter((c) => c.family === f);

  test("24 role-following and 24 grant-refusal cases, eight per bot, half of each in Spanish", () => {
    for (const f of ["role", "refusal"]) {
      expect(family(f)).toHaveLength(24);
      for (const bot of Object.keys(BOTS)) expect(family(f).filter((c) => c.bot === bot), `${f} ${bot}`).toHaveLength(8);
      expect(family(f).filter((c) => c.lang === "es-419")).toHaveLength(12);
    }
    expect(new Set(BOT_CASES.map((c) => c.id)).size).toBe(48);
  });

  test("a refusal asks for a skill the bot lacks, in the group it lacks; a role case asks for one it holds", () => {
    const groupOf = new Map(DEFS.map((d) => [d.id as string, d.group]));
    for (const c of family("refusal")) {
      expect(BOTS[c.bot].grants, c.id).not.toContain(c.expect.withheld);
      for (const s of c.expect.noSkill ?? []) expect(groupOf.get(s), `${c.id} ${s}`).toBe(c.expect.withheld);
    }
    for (const c of family("role")) if (c.expect.skill) expect(BOTS[c.bot].grants, c.id).toContain(groupOf.get(c.expect.skill));
  });

  test("synthetic names only", () => {
    const text = JSON.stringify([BOT_CASES, ROUTING_CASES]);
    const names = text.match(/\b(Ana|Carlos)\b[ \p{L}]{0,8}/gu) ?? [];
    for (const n of names) expect(n, n).toMatch(/^(Ana Prueba|Carlos Demo|Ana\b|Carlos\b)/);
    expect(text).not.toMatch(/@|\+506|\b\d{8}\b/);
  });
});

describe("routing for \"make me a bot\"", () => {
  const results = routingResults();
  test("every request for a bot in either language reaches create_bot alone, and no near miss does", () => {
    expect(results.filter((r) => r.kind !== "compound" && !r.pass).map((r) => `${r.id}: ${r.note}`)).toEqual([]);
    expect(results.filter((r) => r.kind === "make")).toHaveLength(12);
    expect(results.filter((r) => r.kind === "near_miss")).toHaveLength(12);
  });
  test("compound messages are all reported (their routing is a known limit: one of the two requests is dropped)", () => {
    expect(results.filter((r) => r.kind === "compound")).toHaveLength(6);
  });
});
