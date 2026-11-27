import { describe, expect, test } from "vitest";
import en from "../locales/en.json";
import es from "../locales/es-419.json";
import appEn from "../../../packages/copy/locales/en.json";
import appEs from "../../../packages/copy/locales/es-419.json";
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

  test("the lab's kicker is the name the app gives the Device lab, in both languages", () => {
    expect(en["HM-SITE-01.labKicker"]).toBe(appEn["HM-SET-10.title"]);
    expect(es["HM-SITE-01.labKicker"]).toBe(appEs["HM-SET-10.title"]);
  });

  test("in Spanish the lab's report is an informe, as in the app, and the lab is never a laboratorio de dispositivos", () => {
    for (const k of ["HM-SITE-01.labBody", "HM-SITE-01.labStep2Title", "HM-SITE-01.labStep2Body", "HM-SITE-01.getBody"] as const) {
      expect(es[k], k).not.toMatch(/reporte|laboratorio de dispositivos/i);
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
