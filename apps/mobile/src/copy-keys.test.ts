/// <reference types="node" />
// CT-10: every literal copy key named in apps/mobile/src and packages/*/src exists in both locales.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { extractCopyKeys } from "./copy-keys.ts";

const SRC = fileURLToPath(new URL(".", import.meta.url));
const ROOT = fileURLToPath(new URL("../../..", import.meta.url));

const loadLocale = (name: string): Record<string, string> =>
  JSON.parse(readFileSync(join(ROOT, "packages", "copy", "locales", `${name}.json`), "utf8")) as Record<string, string>;

function collectSourceFiles(dir: string, labelPrefix: string): Array<{ label: string; fullPath: string }> {
  return readdirSync(dir, { recursive: true })
    .map(String)
    .filter((f) => /\.(ts|tsx)$/.test(f) && !/\.test\.(ts|tsx)$/.test(f))
    .map((f) => ({ label: join(labelPrefix, f), fullPath: join(dir, f) }));
}

test("extractCopyKeys finds literal keys and skips templates and non-keys", () => {
  const src = [
    `const a = t("HM-SET-01.title");`,
    `const b = t('common.ok');`,
    "const c = `HM-APPR-01.approve`;",
    "const dyn = `HM-SET-10.failed.${reason}`;",
    `const other = "not a copy key";`,
    `const partial = "HM-SET-10";`,
  ].join("\n");
  assert.deepEqual(extractCopyKeys(src), ["HM-SET-01.title", "common.ok", "HM-APPR-01.approve"]);
});

test("CT-10: every literal copy key in code exists in both en and es-419 locales", () => {
  const locales: Array<[string, Record<string, string>]> = [
    ["en", loadLocale("en")],
    ["es-419", loadLocale("es-419")],
  ];
  const packagesDir = join(ROOT, "packages");
  const pkgFiles = readdirSync(packagesDir).flatMap((pkg) => {
    const srcDir = join(packagesDir, pkg, "src");
    try {
      return collectSourceFiles(srcDir, join("packages", pkg, "src"));
    } catch {
      return [];
    }
  });
  const allFiles = [...collectSourceFiles(SRC, join("apps", "mobile", "src")), ...pkgFiles];
  const missing: string[] = [];
  for (const { label, fullPath } of allFiles) {
    const text = readFileSync(fullPath, "utf8");
    for (const key of extractCopyKeys(text)) {
      for (const [localeName, dict] of locales) {
        if (!Object.hasOwn(dict, key)) missing.push(`${label}: missing ${key} in ${localeName}`);
      }
    }
  }
  assert.deepEqual(missing, []);
});
