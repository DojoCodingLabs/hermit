/// <reference types="node" />
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { copyKeys } from "./copy-keys.ts";

const ROOT = new URL("../../../", import.meta.url).pathname;
const MOBILE_SRC = new URL(".", import.meta.url).pathname;
const PACKAGES = join(ROOT, "packages");
const LOCALE_DIR = join(PACKAGES, "copy", "locales");

function loadLocale(name: "en" | "es-419"): Record<string, string> {
  return JSON.parse(readFileSync(join(LOCALE_DIR, `${name}.json`), "utf8")) as Record<string, string>;
}

function walkSourceFiles(dir: string): string[] {
  return readdirSync(dir, { recursive: true })
    .map(String)
    .filter((f) => (f.endsWith(".ts") || f.endsWith(".tsx")) && !f.endsWith(".test.ts") && !f.endsWith(".test.tsx"))
    .map((f) => join(dir, f));
}

test("extracts literal copy keys and skips template expressions and non-keys", () => {
  const src = [
    'const a = t("HM-BOT-02.clearing");',
    "const b = t('common.cancel');",
    "const c = `HM-APPR-01.approve`;",
    "const d = `HM-SET-10.failed.${reason}`;",
    'const e = "https://example.com";',
    'const f = "HM-SET-10.failed.";',
    'const g = "not.a.key";',
  ].join("\n");
  assert.deepEqual(copyKeys(src), ["HM-BOT-02.clearing", "common.cancel", "HM-APPR-01.approve"]);
});

test("every literal copy key in apps/mobile/src and packages/*/src exists in both locales", () => {
  const en = loadLocale("en");
  const es = loadLocale("es-419");

  const dirs = [
    MOBILE_SRC,
    ...readdirSync(PACKAGES).map((pkg) => join(PACKAGES, pkg, "src")),
  ];

  const files = dirs.flatMap((dir) => {
    try {
      return walkSourceFiles(dir);
    } catch {
      return [];
    }
  });

  const missing: string[] = [];
  for (const file of files) {
    const src = readFileSync(file, "utf8");
    const rel = relative(ROOT, file);
    for (const key of copyKeys(src)) {
      if (en[key] === undefined) missing.push(`${rel} (en): ${key}`);
      if (es[key] === undefined) missing.push(`${rel} (es-419): ${key}`);
    }
  }
  assert.deepEqual(missing, []);
});
