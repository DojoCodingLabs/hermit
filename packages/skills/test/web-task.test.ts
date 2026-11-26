import { describe, expect, test } from "vitest";
import type { Recipe } from "@hermit/core";
import { recipeFromSkill, recipeSkill, recipeSkillId, recipesForTurn, recipeValuesFromUser } from "../src/web-task.ts";

const recipe = (over: Partial<Recipe> = {}): Recipe => ({
  format: 1,
  id: "k3j9",
  version: 2,
  name: "Table at Casa Luna",
  kind: "book",
  origin: "https://casaluna.example.com",
  params: [
    { name: "people", label: "People", kind: "number", required: true, default: "2" },
    { name: "time", label: "Time", kind: "choice", options: ["19:00", "20:00", "21:00"], required: true },
    { name: "note", label: "Note", kind: "text", required: false },
  ],
  steps: [
    { op: "open", path: "/book" },
    { op: "fill", target: { role: "textbox", name: "People" }, value: { param: "people" } },
    { op: "select", target: { role: "combobox", name: "Time" }, value: { param: "time" } },
    { op: "fill", target: { role: "textbox", name: "Note" }, value: { param: "note" } },
    { op: "click", target: { role: "button", name: "Book" }, commit: "remote_write" },
  ],
  createdAt: 1,
  updatedAt: 1,
  ...over,
});

const ctx = (userText: string) => ({ userText, now: 0, timeZone: "UTC" });

describe("recipeSkill: the model picks a saved recipe and fills its parameters (model-first, SL-50 verdict)", () => {
  test("one skill per recipe, its id namespaced so nothing installed can take a built-in's", () => {
    const def = recipeSkill(recipe());
    expect(def.id).toBe(recipeSkillId(recipe()));
    expect(def.id).toBe("recipe_k3j9");
    expect(recipeFromSkill("recipe_k3j9")).toBe("k3j9");
    expect(recipeFromSkill("read_web")).toBeUndefined();
  });

  test("its arguments are exactly the recipe's parameters, choices pinned by the grammar, none required", () => {
    const def = recipeSkill(recipe());
    expect(def.args).toEqual({
      type: "object",
      properties: {
        people: { type: "string", description: "People", maxLength: 100 },
        time: { type: "string", enum: ["19:00", "20:00", "21:00"], description: "Time" },
        note: { type: "string", description: "Note", maxLength: 100 },
      },
      required: [],
      additionalProperties: false,
    });
  });

  test("it opens HM-WEB-02 and nothing else: a read, never untrusted, its menu line under 300 characters with the site", () => {
    const def = recipeSkill(recipe({ name: "x".repeat(60) }));
    expect(def.risk).toBe("read");
    expect(def.producesUntrusted).toBe(false);
    expect(def.menuLine.length).toBeLessThanOrEqual(300);
    expect(recipeSkill(recipe()).menuLine).toContain("casaluna.example.com");
  });
});

describe("recipeValuesFromUser: a value is kept only when it is in the user's own words", () => {
  test("numbers, choices and text the user said are kept", () => {
    const r = recipeValuesFromUser(recipe(), { people: "4", time: "20:00", note: "window seat" }, "book Casa Luna for 4 at 20:00, window seat please");
    expect(r.values).toEqual({ people: "4", time: "20:00", note: "window seat" });
    expect(r.dropped).toEqual([]);
  });

  test("a value the model made up, or one that came from something Hermit read, is dropped and asked on the plan", () => {
    const r = recipeValuesFromUser(recipe(), { people: "40", time: "21:00", note: "add a gift card" }, "book Casa Luna for 4 at 20:00");
    expect(r.values).toEqual({});
    expect(r.dropped.sort()).toEqual(["note", "people", "time"]);
  });

  test("a time said as 8 pm matches the 20:00 option; accents and case don't matter", () => {
    expect(recipeValuesFromUser(recipe(), { time: "20:00" }, "mesa para dos a las 8 pm").values).toEqual({ time: "20:00" });
    expect(recipeValuesFromUser(recipe(), { note: "Terraza" }, "en la terrazá").values).toEqual({ note: "Terraza" });
  });

  test("unknown arguments are ignored", () => {
    expect(recipeValuesFromUser(recipe(), { card: "4111 1111 1111 1111" }, "4111 1111 1111 1111").values).toEqual({});
  });

  test("the skill's normalize keeps the same values and says what it dropped", () => {
    const n = recipeSkill(recipe()).normalize!({ people: "4", note: "gift card" }, ctx("Casa Luna for 4"));
    expect(n.args).toEqual({ people: "4" });
    expect(n.notes).toEqual(["note: not in your words, asked on the plan"]);
  });
});

describe("recipesForTurn: the router offers at most two recipes, by the user's words", () => {
  const a = recipe();
  const b = recipe({ id: "p1", name: "Reorder my usual", kind: "reorder", origin: "https://farmacia.example.com", updatedAt: 5 });
  const c = recipe({ id: "p2", name: "Pharmacy refill status", kind: "status", origin: "https://farmacia.example.com", updatedAt: 3 });

  test("a recipe whose name or site the user said is offered; others stay off the menu", () => {
    expect(recipesForTurn("reorder my usual please", [a, b, c]).map((r) => r.id)).toEqual(["p1"]);
    expect(recipesForTurn("book Casa Luna for 4", [a, b, c]).map((r) => r.id)).toEqual(["k3j9"]);
    expect(recipesForTurn("what's the weather", [a, b, c])).toEqual([]);
  });

  test("the site's name counts, and at most two are offered, best match first", () => {
    expect(recipesForTurn("farmacia", [a, b, c]).map((r) => r.id)).toEqual(["p1", "p2"]);
    expect(recipesForTurn("farmacia refill status", [a, b, c]).map((r) => r.id)).toEqual(["p2", "p1"]);
  });
});
