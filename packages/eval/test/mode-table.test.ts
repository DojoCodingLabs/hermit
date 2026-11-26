import { describe, expect, test } from "vitest";
import { DEFS } from "../../skills/test/fixtures.ts";
import { expectedFor, modeTable, rulingRows } from "../src/mode-table.ts";

describe("the permission modes over the tier table (spec 6.4.1)", () => {
  test("every mode decides the tier table as the spec's table says, attended and alone", () => {
    const rows = modeTable();
    expect(rows).toHaveLength((DEFS.length + 1 + 3) * 3 * 2 * 2); // 36 variants: 32 skills, three of them in two variants, plus the MCP tool in two
    expect(rows.filter((r) => r.got !== r.expected)).toEqual([]);
  });

  test("search alone never runs before wave 2 unless the mode is Don't ask", () => {
    for (const r of modeTable().filter((x) => x.skill === "search_web" && x.alone)) expect(r.got, `${r.mode} ${r.variant}`).toBe(r.mode === "dont_ask" ? "allow" : "suggestion");
  });

  test("money and logins: the fingerprint in a chat, never alone, and no mode runs them", () => {
    for (const r of modeTable().filter((x) => x.tier === "high" && x.skill.startsWith("pay"))) {
      expect(r.got, `${r.skill} ${r.mode} alone ${r.alone} tainted ${r.tainted}`).toBe(r.alone ? "money_note" : r.tainted ? "deny" : "ask+fingerprint");
    }
  });

  test("a skill the bot doesn't hold is denied in every mode: a connector not listed, and Hermit's own skills", () => {
    const outside = modeTable().filter((r) => (r.skill === "mcp_x_search" && r.variant === "out_of_sources") || r.skill === "create_bot" || r.skill === "connect_service");
    expect(outside.length).toBeGreaterThan(0);
    for (const r of outside) expect(r.got, `${r.skill} ${r.mode}`).toBe("deny");
  });

  test("Auto opens a link only from the user's words or this turn's reads; on listed sites a composed link runs alone", () => {
    const web = (alone: boolean, mode: string, variant: string) => modeTable().find((r) => r.skill === "read_web" && r.alone === alone && r.mode === mode && r.variant === variant && !r.tainted)!.got;
    expect(web(false, "auto", "in_sources")).toBe("ask");
    expect(web(true, "auto", "in_sources")).toBe("allow");
    expect(web(true, "auto", "out_of_sources")).toBe("suggestion");
    expect(web(true, "ask", "in_sources")).toBe("allow");
  });

  test("the oracle is written from the spec, not read off decide(): it states the table for one row", () => {
    const base = { risk: "send" as const, tier: "medium" as const, group: "messages_reply" as const, skill: "reply_message", inSources: false, tainted: false };
    expect(expectedFor({ ...base, mode: "ask", alone: false })).toBe("ask+fingerprint");
    expect(expectedFor({ ...base, mode: "auto", alone: true })).toBe("suggestion");
    expect(expectedFor({ ...base, mode: "dont_ask", alone: true })).toBe("allow");
  });

  test("the rulings the main table can't show: verbatim links, the alone split, logins", () => {
    const rows = rulingRows();
    expect(rows.filter((r) => r.ruling === "links")).toHaveLength(10);
    expect(rows.filter((r) => r.ruling === "split")).toHaveLength(15);
    expect(rows.filter((r) => r.ruling === "logins")).toHaveLength(12);
    expect(rows.filter((r) => r.got !== r.expected)).toEqual([]);
  });
});
