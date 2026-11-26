/// <reference types="node" />
// SL-34 (US-VAULT-03): the import screen's pure parts, and the source checks that keep the file's content in memory.
import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { choicesFor, importCounts, pickedReadable } from "./vault-import-view.ts";
import { stripComments } from "./a11y-scan.ts";

const SRC = new URL(".", import.meta.url).pathname;
const read = (p: string) => readFileSync(join(SRC, p), "utf8");

const preview = {
  format: "chrome" as const,
  ready: [
    { row: 2, name: "GitHub", origins: ["https://github.com"], dropped: [], existing: [{ id: "v1", name: "GitHub work" }] },
    { row: 3, name: "Banco", origins: ["https://banco.example"], dropped: [], existing: [] },
    { row: 4, name: "Mail", origins: ["https://mail.example"], dropped: [], existing: [{ id: "v2", name: "A" }, { id: "v3", name: "B" }] },
  ],
  refused: [{ row: 5, name: "router", site: "http://192.168.1.1/", problems: ["origin_not_https" as const] }],
  extrasIgnored: 0,
};

test("replace is offered only when a row duplicates exactly one saved login", () => {
  assert.deepEqual(choicesFor(preview.ready[0]!), ["skip", "replace", "keep_both"]);
  assert.deepEqual(choicesFor(preview.ready[1]!), []);
  assert.deepEqual(choicesFor(preview.ready[2]!), ["skip", "keep_both"]);
});

test("the counts the import button and summary show follow the user's choices (skip by default)", () => {
  assert.deepEqual(importCounts(preview, {}), { toWrite: 1, duplicates: 2, skipped: 2, refused: 1 });
  assert.deepEqual(importCounts(preview, { 2: "replace", 4: "keep_both" }), { toWrite: 3, duplicates: 2, skipped: 0, refused: 1 });
});

test("a picked file the provider reports as over the cap is refused before it is read", () => {
  assert.equal(pickedReadable({ size: 3_000_000 }, 2_097_152), false);
  assert.equal(pickedReadable({ size: 1_000 }, 2_097_152), true);
  // Unknown size: read, and the native read stops at the cap.
  assert.equal(pickedReadable({ size: null }, 2_097_152), true);
});

test("the import never writes the file anywhere: no cache, temp file, file system module or log in its path", () => {
  const kotlin = stripComments(read("../modules/hermit-vault/android/src/main/java/io/dojocoding/hermit/vault/CsvDocument.kt"));
  for (const banned of ["cacheDir", "createTempFile", "FileOutputStream", "File(", "Log.", "println", "openFileOutput", "SharedPreferences"]) {
    assert.equal(kotlin.includes(banned), false, `CsvDocument.kt uses ${banned}`);
  }
  for (const file of ["app/vault-import.tsx", "vault-import-view.ts"]) {
    const src = stripComments(read(file));
    for (const banned of ["expo-file-system", "console.", "AsyncStorage", "SecureStore", "writeAsString", "Sharing"]) assert.equal(src.includes(banned), false, `${file} uses ${banned}`);
  }
  // The adapter hands the bytes to the vault service and keeps no copy.
  const adapter = stripComments(read("adapters/vault.ts"));
  assert.equal(/expo-file-system|console\./.test(adapter), false);
});

test("the file comes from the system document picker: no storage permission anywhere", () => {
  const manifest = read("../modules/hermit-vault/android/src/main/AndroidManifest.xml");
  assert.equal(/uses-permission/.test(manifest), false);
  const app = read("../app.json");
  assert.equal(/READ_EXTERNAL_STORAGE|READ_MEDIA|MANAGE_EXTERNAL_STORAGE|WRITE_EXTERNAL_STORAGE/.test(app.replace(/"blockedPermissions"\s*:\s*\[[^\]]*\]/, "")), false);
  assert.equal(read("../modules/hermit-vault/android/src/main/java/io/dojocoding/hermit/vault/CsvDocument.kt").includes("ACTION_OPEN_DOCUMENT"), true);
});

test("the import screen holds FLAG_SECURE through the shared counter", () => {
  assert.match(stripComments(read("app/vault-import.tsx")), /useSecureScreen\(\)/);
});
