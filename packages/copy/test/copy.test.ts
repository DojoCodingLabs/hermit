import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { OUTCOMES, outcomeCopyKey } from "@hermit/core";
import { createTranslator, CopyError, KEY_PATTERN, placeholders, resolveLocale, type Dictionary } from "../src/index.ts";

const load = (name: string): Dictionary => JSON.parse(readFileSync(new URL(`../locales/${name}.json`, import.meta.url), "utf8"));
const en = load("en");
const es = load("es-419");

describe("locale files (CT-10)", () => {
  test("both locales define exactly the same keys", () => {
    expect(Object.keys(es).sort()).toEqual(Object.keys(en).sort());
  });

  test("keys follow screenId.element or common.*", () => {
    for (const k of Object.keys(en)) expect(k, k).toMatch(KEY_PATTERN);
  });

  test("placeholders agree across locales", () => {
    for (const k of Object.keys(en)) expect(placeholders(es[k]!), k).toEqual(placeholders(en[k]!));
  });

  test("every user-facing outcome (CT-04) has copy", () => {
    for (const o of OUTCOMES) {
      expect(en[outcomeCopyKey(o)], o).toBeTruthy();
      expect(es[outcomeCopyKey(o)], o).toBeTruthy();
    }
  });

  test("no em or en dashes in copy (house style)", () => {
    for (const [k, v] of [...Object.entries(en), ...Object.entries(es)]) expect(v, k).not.toMatch(/[–—]/);
  });
});

describe("translator", () => {
  test("fills placeholders", () => {
    expect(createTranslator(es)("HM-ACT-03.title", { index: 7 })).toBe("Cadena rota en la entrada 7");
  });

  test("a missing key or variable throws instead of shipping a blank", () => {
    const t = createTranslator(en);
    expect(() => t("HM-NOPE-01.title")).toThrow(CopyError);
    expect(() => t("HM-ACT-03.title")).toThrow(/needs \{index\}/);
  });
});

describe("resolveLocale (ADR-013)", () => {
  test("any Spanish gets es-419, everything else English", () => {
    expect(resolveLocale("es-CR")).toBe("es-419");
    expect(resolveLocale("es")).toBe("es-419");
    expect(resolveLocale("ES-es")).toBe("es-419");
    expect(resolveLocale("pt-BR")).toBe("en");
    expect(resolveLocale(undefined)).toBe("en");
    expect(resolveLocale("pt-BR", "es-419")).toBe("es-419");
  });
});
