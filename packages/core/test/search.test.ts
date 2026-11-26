import { describe, expect, test } from "vitest";
import { searchChoiceOf, searchProvider, searchRequestUrl, searchSetting, tidyQuery } from "../src/search.ts";

describe("the search provider setting (US-WEB-03, FR-WEB-04, Q58)", () => {
  test("nothing chosen yet means DuckDuckGo: no key and no account", () => {
    for (const v of [undefined, "", "duckduckgo"]) {
      expect(searchProvider(v), String(v)).toEqual({
        id: "duckduckgo", label: "DuckDuckGo", base: "https://html.duckduckgo.com/html/", domain: "html.duckduckgo.com",
      });
    }
  });

  test("off means no provider; an unknown value is off too (fail closed)", () => {
    expect(searchProvider("off")).toBeUndefined();
    expect(searchProvider("google")).toBeUndefined();
    expect(searchProvider("searxng:")).toBeUndefined();
  });

  test("the user's own SearXNG address: https on a public host only, without its query", () => {
    expect(searchProvider("searxng:https://search.example.org/searx?x=1#a")).toEqual({
      id: "searxng", label: "SearXNG (search.example.org)", base: "https://search.example.org/searx/", domain: "search.example.org",
    });
    for (const bad of ["searxng:http://search.example.org/", "searxng:https://192.168.1.4/", "searxng:https://localhost/", "searxng:https://searx.lan/", "searxng:https://u:p@search.example.org/"]) {
      expect(searchProvider(bad), bad).toBeUndefined();
    }
  });

  test("the setting a choice is saved as, refused when the address isn't usable", () => {
    expect(searchSetting({ id: "duckduckgo" })).toBe("duckduckgo");
    expect(searchSetting({ id: "off" })).toBe("off");
    expect(searchSetting({ id: "searxng", address: " search.example.org " })).toBe("searxng:https://search.example.org/");
    expect(searchSetting({ id: "searxng", address: "http://10.0.0.2:8080" })).toBeUndefined();
    expect(searchSetting({ id: "searxng", address: "" })).toBeUndefined();
  });
});

describe("searchChoiceOf: what HM-SET-02 shows as selected", () => {
  test("the saved setting read back as a choice; anything unreadable shows as off, like it behaves", () => {
    expect(searchChoiceOf(undefined)).toEqual({ id: "duckduckgo" });
    expect(searchChoiceOf("off")).toEqual({ id: "off" });
    expect(searchChoiceOf("searxng:https://search.example.org/")).toEqual({ id: "searxng", address: "https://search.example.org/" });
    expect(searchChoiceOf("searxng:http://bad.example/")).toEqual({ id: "off" });
    expect(searchChoiceOf("bing")).toEqual({ id: "off" });
  });
});

describe("the request: only the query leaves the phone (FR-WEB-04)", () => {
  test("one q parameter, nothing about the user, the language or the phone", () => {
    const ddg = searchProvider(undefined)!;
    expect(searchRequestUrl(ddg, "clima en Lima hoy")).toBe("https://html.duckduckgo.com/html/?q=clima%20en%20Lima%20hoy");
    const sx = searchProvider("searxng:https://search.example.org/")!;
    expect(searchRequestUrl(sx, "a&b=c #d")).toBe("https://search.example.org/search?q=a%26b%3Dc%20%23d");
  });

  test("tidyQuery collapses spaces and caps the length", () => {
    expect(tidyQuery("  precio\n del   dólar  ")).toBe("precio del dólar");
    expect(tidyQuery("x".repeat(500))).toHaveLength(200);
  });
});
