import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { APPROVAL_KEY_LEVELS, OUTCOMES, outcomeCopyKey } from "@hermit/core";
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

  test("every place an approval key can be kept has its line on the approval key screen", () => {
    for (const level of APPROVAL_KEY_LEVELS) {
      expect(en[`HM-APPR-01.key.level.${level}`], level).toBeTruthy();
      expect(es[`HM-APPR-01.key.level.${level}`], level).toBeTruthy();
    }
  });

  test("no em or en dashes in copy (house style)", () => {
    for (const [k, v] of [...Object.entries(en), ...Object.entries(es)]) expect(v, k).not.toMatch(/[–—]/);
  });
});

// AGENTS.md rule 9: the app's Spanish uses tú. Only voseo forms that can't be read another way are listed, so
// "elegí" or "escribí" (also the first person past tense) stay out. \b doesn't count accented letters as letters,
// so the edges are (?<!\p{L}) and (?!\p{L}).
const VOSEO_FORMS = [
  "podés", "tenés", "querés", "sabés", "hacés", "decís", "necesitás", "preferís", "tocá", "mirá", "probá", "activá", "revisá",
  "volvé", "poné", "usá", "agregá", "cambiá", "guardá", "confirmá", "dejá", "buscá", "esperá", "fijate", "acordate", "decime",
  "avisame", "mandale", "contame",
];
const VOSEO = new RegExp(`(?<!\\p{L})(?:${VOSEO_FORMS.join("|")})(?!\\p{L})`, "iu");

describe("tú, not vos (AGENTS.md rule 9)", () => {
  test("the matcher flags voseo", () => {
    for (const s of [
      "Tocá el botón", "Si querés, te aviso", "¿Podés esperar?", "Ya tenés todo.", "Si sabés la hora, dime.", "¿Qué hacés?",
      "Decís que sí.", "Si necesitás algo, escribe.", "Si preferís, después.", "Mirá esto.", "Probá de nuevo.", "Activá las notificaciones.",
      "Revisá el correo.", "Volvé a la lista.", "Poné tu huella.", "Usá la otra cuenta.", "Agregá un recordatorio.", "Cambiá la hora.",
      "Guardá el cambio.", "Confirmá el pago.", "Dejá un mensaje.", "Buscá el archivo.", "Esperá un momento.", "Fijate en la fecha.",
      "Acordate del lunes.", "Decime cuándo.", "Avisame mañana.", "Mandale un saludo a Ana.", "Contame más.",
    ]) expect(s, s).toMatch(VOSEO);
  });

  test("the matcher ignores case, accented capitals included", () => {
    expect("TOCÁ EL BOTÓN").toMatch(VOSEO);
    expect("Querés").toMatch(VOSEO);
  });

  test("the matcher leaves tú and other words alone", () => {
    for (const s of ["Toca el botón", "Si quieres, te aviso", "No abrí nada", "Elegí la primera.", "Le escribí a Luis."]) expect(s, s).not.toMatch(VOSEO);
  });

  test("the matcher counts accented letters as letters at both edges", () => {
    for (const s of ["Antes tocábamos el timbre.", "Siempre dejábamos la llave.", "ñtocá", "étocá"]) expect(s, s).not.toMatch(VOSEO);
  });

  test("no value in es-419 uses voseo", () => {
    for (const [k, v] of Object.entries(es)) expect(v, k).not.toMatch(VOSEO);
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
