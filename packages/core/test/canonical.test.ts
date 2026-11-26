import { describe, expect, test } from "vitest";
import { argsHash, canonicalJson } from "../src/canonical.ts";

describe("canonicalJson", () => {
  test("canonicalJson sorts nested keys", () => {
    expect(canonicalJson({ b: 1, a: { d: 2, c: 3 } })).toBe('{"a":{"c":3,"d":2},"b":1}');
  });

  test("canonicalJson keeps array order", () => {
    expect(canonicalJson({ list: [3, 1, { z: 1, y: 2 }] })).toBe('{"list":[3,1,{"y":2,"z":1}]}');
  });

  test("canonicalJson rejects undefined and functions", () => {
    expect(() => canonicalJson({ a: undefined })).toThrow();
    expect(() => canonicalJson({ a: () => 1 })).toThrow();
  });
});

describe("argsHash", () => {
  test("argsHash is stable across key order", () => {
    const a = argsHash({ to: "Ana", text: "Running late", meta: { x: 1, y: 2 } });
    const b = argsHash({ meta: { y: 2, x: 1 }, text: "Running late", to: "Ana" });
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  test("argsHash differs when a value changes", () => {
    expect(argsHash({ text: "Running late" })).not.toBe(argsHash({ text: "Running later" }));
  });
});
