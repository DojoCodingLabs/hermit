import { describe, expect, it } from "vitest";
import { validateArgs } from "@hermit/core";
import { parseTools, safeToolSchema } from "../src/index.ts";

const parse = (inputSchema: unknown) => parseTools({ tools: [{ name: "t", description: "d", inputSchema }] }, new Set());

describe("server schemas can't hang the phone (ReDoS) or grow without bound (SL-54)", () => {
  it("a catastrophic pattern is dropped, never compiled, and validation stays bounded", () => {
    const evil = { type: "object", properties: { q: { type: "string", pattern: "(a+)+$", format: "regex" }, r: { type: "object", patternProperties: { "(x+)+y": { type: "string" } } } } };
    const { tools } = parse(evil);
    expect(JSON.stringify(tools[0]!.inputSchema)).not.toMatch(/pattern|format/);
    const started = Date.now();
    expect(validateArgs({ q: `${"a".repeat(5000)}!` }, tools[0]!.inputSchema)).toEqual([]);
    expect(Date.now() - started).toBeLessThan(100);
  });

  it("drops patterns at every depth, inside arrays and combinators too", () => {
    const s = safeToolSchema({ type: "object", properties: { a: { type: "array", items: { type: "string", pattern: "(a|a)*" } }, b: { anyOf: [{ type: "string", pattern: "x*" }] } } });
    expect(JSON.stringify(s)).not.toContain("pattern");
  });

  it("keeps an argument that happens to be named pattern or format", () => {
    const s = safeToolSchema({ type: "object", properties: { format: { type: "string", pattern: "x+" }, pattern: { type: "string" } } });
    expect(s).toEqual({ type: "object", properties: { format: { type: "string" }, pattern: { type: "string" } } });
  });

  it("refuses schemas nested too deep or with too many properties; caps long strings and enums", () => {
    let deep: Record<string, unknown> = { type: "string" };
    for (let i = 0; i < 12; i++) deep = { type: "object", properties: { x: deep } };
    expect(parse(deep).skipped).toEqual([{ name: "t", reason: "schema" }]);
    const wide = { type: "object", properties: Object.fromEntries(Array.from({ length: 80 }, (_, i) => [`p${i}`, { type: "string" }])) };
    expect(parse(wide).skipped).toEqual([{ name: "t", reason: "schema" }]);
    const s = safeToolSchema({ type: "object", properties: { a: { type: "string", description: "d".repeat(900), enum: Array.from({ length: 200 }, (_, i) => `v${i}`) } } }) as { properties: { a: { description: string; enum: unknown[] } } };
    expect(s.properties.a.description.length).toBeLessThanOrEqual(200);
    expect(s.properties.a.enum.length).toBeLessThanOrEqual(50);
  });
});
