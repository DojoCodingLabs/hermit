import { describe, expect, test } from "vitest";
import en from "../locales/en.json";
import es from "../locales/es-419.json";
import { translator } from "../lib/i18n";

const KEY_PATTERN = /^(HM-SITE-\d{2}|common)\.[a-z][a-zA-Z0-9]*$/;
const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
const all = [...Object.entries(en), ...Object.entries(es)];

describe("site copy", () => {
  test("both languages define exactly the same keys", () => {
    expect(Object.keys(es).sort()).toEqual(Object.keys(en).sort());
  });

  test("keys follow screenId.element or common.*", () => {
    for (const k of Object.keys(en)) expect(k).toMatch(KEY_PATTERN);
  });

  test("placeholders agree across languages", () => {
    const esDict: Record<string, string> = es;
    for (const [k, v] of Object.entries(en)) expect(placeholders(esDict[k]!), k).toEqual(placeholders(v));
  });

  test("no em or en dashes (house style)", () => {
    for (const [k, v] of all) expect(v, k).not.toMatch(/[–—]/);
  });

  test("no banned brand words and no molting (BRANDBOOK, Voice)", () => {
    const banned = /\bmagic\b|\bsmart\b|powered by AI|safe with us|\bmolt|\bshed|\bmagia\b|inteligente/i;
    for (const [k, v] of all) expect(v, k).not.toMatch(banned);
  });

  test("no time estimates: only the store label, the badges' alt text, the roadmap label and the download page's pending notice say coming, with no date", () => {
    const time = /\b(soon|coming|next (week|month|year)|in \d+ (days?|weeks?|months?)|pronto|próximamente)\b/i;
    const labels = new Set(["common.storeSoon", "common.badgeAppleAlt", "common.badgeGoogleAlt", "HM-SITE-01.comingLabel"]);
    const enDict: Record<string, string> = en;
    const esDict: Record<string, string> = es;
    // The download page's notice shows only while no release is published (lib/release.ts), and nothing else in it says soon.
    const preview = { en: "Preview APKs are published on GitHub Releases; the first one is coming soon.", es: "Los APK de vista previa se publican en GitHub Releases; el primero llega muy pronto." };
    for (const k of ["HM-SITE-03.pendingBody"]) {
      expect(enDict[k], k).toContain(preview.en);
      expect(esDict[k], k).toContain(preview.es);
      expect(enDict[k]!.replace(preview.en, ""), k).not.toMatch(time);
      expect(esDict[k]!.replace(preview.es, ""), k).not.toMatch(time);
      labels.add(k);
    }
    for (const [k, v] of all) if (!labels.has(k)) expect(v, k).not.toMatch(time);
    expect([enDict["common.storeSoon"], esDict["common.storeSoon"]]).toEqual(["Coming soon", "Muy pronto"]);
    expect([enDict["HM-SITE-01.comingLabel"], esDict["HM-SITE-01.comingLabel"]]).toEqual(["Coming", "Próximamente"]);
    for (const k of ["common.badgeAppleAlt", "common.badgeGoogleAlt"]) {
      expect(enDict[k], k).toMatch(/, coming soon$/);
      expect(esDict[k], k).toMatch(/, muy pronto$/);
    }
  });

  test("USD₮ is the only money the copy names", () => {
    for (const [k, v] of all) expect(v, k).not.toMatch(/\bUSDC\b|\bUSDT\b|stablecoin|\bETH\b|bitcoin/i);
  });

  test("the translator fills placeholders and refuses a missing key", () => {
    expect(translator("es")("HM-SITE-02.updated", { date: "x" })).toBe("Última actualización: x");
    expect(() => translator("en")("HM-SITE-09.nope")).toThrow(/Missing copy key/);
    expect(() => translator("en")("HM-SITE-02.updated")).toThrow(/needs \{date\}/);
  });
});
