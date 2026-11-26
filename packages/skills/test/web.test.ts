import { describe, expect, test } from "vitest";
import { skillById, webSkills } from "../src/catalog.ts";
import { normalizeReadWeb } from "../src/web.ts";

const ctx = { conversation: () => undefined };
const norm = (url: string, userText: string, earlier?: string[]) => normalizeReadWeb({ url }, { userText, now: 0, timeZone: "UTC", ...(earlier ? { earlier } : {}) });

describe("read_web (US-WEB-01, US-WEB-02)", () => {
  test("a network risk that taints the session, found by id, taking only the address", () => {
    const def = skillById("read_web")!;
    expect(def).toBe(webSkills[0]);
    expect(def.risk).toBe("network");
    expect(def.producesUntrusted).toBe(true);
    expect(def.args).toMatchObject({ type: "object", required: ["url"], additionalProperties: false });
    expect(Object.keys(def.args.properties as object)).toEqual(["url"]);
    expect(def.menuLine.length).toBeLessThanOrEqual(300);
  });

  test("the approval sheet shows the full address and the site", () => {
    const s = skillById("read_web")!.describeAction({ url: "https://www.example.com/help/refunds?lang=es" }, ctx);
    expect(s.lines).toEqual([
      { label: "Page", labelKey: "page", value: "https://www.example.com/help/refunds?lang=es" },
      { label: "Site", labelKey: "site", value: "example.com" },
    ]);
    expect(s.unresolved).toBeUndefined();
  });

  test("an address that isn't https is never put in front of the user", () => {
    for (const url of ["http://example.com/", "javascript:alert(1)", "https://localhost/", "not a url"]) {
      expect(skillById("read_web")!.describeAction({ url }, ctx).unresolved, url).toBeTruthy();
    }
  });

  test("the address comes from the user's own words when they wrote one", () => {
    expect(norm("https://example.com/refund", "¿qué dice https://example.com/refunds sobre reembolsos?")).toEqual({
      args: { url: "https://example.com/refunds" },
      notes: ["url: taken from the user's words"],
    });
    // Same link, already right: nothing to note.
    expect(norm("https://example.com/refunds", "read https://example.com/refunds")).toEqual({ args: { url: "https://example.com/refunds" }, notes: [] });
  });

  test("http and bare addresses become https", () => {
    expect(norm("http://example.com/a", "lee http://example.com/a").args).toEqual({ url: "https://example.com/a" });
    expect(norm("www.example.com/a", "lee www.example.com/a").args).toEqual({ url: "https://www.example.com/a" });
  });

  test("with several links in the message, the model's pick stands if it is one of them", () => {
    const text = "compara https://a.com/x con https://b.com/y";
    expect(norm("https://b.com/y", text).args).toEqual({ url: "https://b.com/y" });
  });

  test("a link from an earlier message of the user counts when this one has none", () => {
    expect(norm("https://example.com/x", "¿y qué dice de envíos?", ["lee https://example.com/faq"]).args).toEqual({ url: "https://example.com/faq" });
  });
});
