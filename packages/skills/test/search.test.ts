import { describe, expect, test } from "vitest";
import { skillById, webSkills } from "../src/catalog.ts";

const DDG = { label: "DuckDuckGo", base: "https://html.duckduckgo.com/html/", domain: "html.duckduckgo.com" };
const ctx = (search?: typeof DDG) => ({ conversation: () => undefined, ...(search ? { search } : {}) });

describe("search_web (US-WEB-03, FR-WEB-04)", () => {
  test("a network risk that taints the session, on the web menu, taking only the query", () => {
    const def = skillById("search_web")!;
    expect(webSkills.map((s) => s.id)).toEqual(["read_web", "search_web"]);
    expect(def.risk).toBe("network");
    expect(def.producesUntrusted).toBe(true);
    expect(def.args).toMatchObject({ type: "object", required: ["query"], additionalProperties: false });
    expect(Object.keys(def.args.properties as object)).toEqual(["query"]);
    expect(def.menuLine.length).toBeLessThanOrEqual(300);
  });

  test("the sheet shows the exact query and the provider it goes to, bound to that provider", () => {
    const s = skillById("search_web")!.describeAction({ query: "clima en Lima mañana" }, ctx(DDG));
    expect(s.lines).toEqual([
      { label: "Search", labelKey: "search", value: "clima en Lima mañana" },
      { label: "Provider", labelKey: "provider", value: "DuckDuckGo" },
    ]);
    expect(s.binding).toBe(DDG.base);
    expect(s.unresolved).toBeUndefined();
  });

  test("with search off, no sheet is shown: the call is refused with the reason", () => {
    expect(skillById("search_web")!.describeAction({ query: "x" }, ctx()).unresolved).toMatch(/off/);
  });

  test("normalize tidies the query the model wrote, nothing else", () => {
    const n = skillById("search_web")!.normalize!({ query: "  precio\n del  dólar " }, { userText: "", now: 0, timeZone: "UTC" });
    expect(n).toEqual({ args: { query: "precio del dólar" }, notes: ["query: tidied"] });
    expect(skillById("search_web")!.normalize!({ query: "ok" }, { userText: "", now: 0, timeZone: "UTC" }).notes).toEqual([]);
  });
});
