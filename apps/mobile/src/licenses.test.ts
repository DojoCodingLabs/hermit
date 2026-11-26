/// <reference types="node" />
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { LICENSES, covers } from "./licenses.ts";

const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { dependencies: Record<string, string> };
const shipped = Object.keys(pkg.dependencies).filter((name) => !name.startsWith("@hermit/"));

test("every dependency the app ships is credited on HM-SET-08 (US-SET-10)", () => {
  const missing = shipped.filter((name) => !LICENSES.some((entry) => covers(entry, name)));
  assert.deepEqual(missing, [], `add these to LICENSES in licenses.ts: ${missing.join(", ")}`);
});

test("Hermit's own terms come first, as PDR-005 sets them", () => {
  assert.deepEqual(
    LICENSES.slice(0, 2).map((e) => [e.name, e.license]),
    [["Hermit", "Apache-2.0"], ["Hermit character art", "CC-BY-4.0"]],
  );
});

test("every entry names a license and a source to read it at", () => {
  for (const e of LICENSES) {
    assert.ok(e.license.length > 0, e.name);
    assert.match(e.url, /^https:\/\//, e.name);
  }
});

test("a prefix covers a family, an exact name only itself", () => {
  assert.equal(covers({ name: "Expo", license: "MIT", url: "https://x", packages: ["expo", "expo-*"] }, "expo-router"), true);
  assert.equal(covers({ name: "React", license: "MIT", url: "https://x", packages: ["react"] }, "react-native"), false);
});

test("every bundled typeface is credited as OFL-1.1, with its license text next to the files, and embedded at build time", () => {
  const dir = new URL("../assets/fonts/", import.meta.url);
  const files = readdirSync(dir);
  const faces = files.filter((f) => f.endsWith(".ttf"));
  assert.ok(faces.length >= 6, "the brand faces are bundled");
  const families = new Set(faces.map((f) => f.split("-")[0]!));
  assert.deepEqual([...families].sort(), ["InstrumentSans", "JetBrainsMono", "Newsreader"]);
  for (const family of families) {
    const entry = LICENSES.find((e) => e.font === family);
    assert.equal(entry?.license, "OFL-1.1", family);
    const text = readFileSync(new URL(`OFL-${family}.txt`, dir), "utf8");
    assert.match(text, /^Copyright /, family);
    assert.match(text, /SIL Open Font License, Version 1\.1/, family);
  }
  // expo-font's config plugin embeds exactly these files: none missing, none left over.
  const app = JSON.parse(readFileSync(new URL("../app.json", import.meta.url), "utf8")) as { expo: { plugins: unknown[] } };
  const plugin = app.expo.plugins.find((p) => Array.isArray(p) && p[0] === "expo-font") as [string, { android: { fonts: Array<{ fontDefinitions: Array<{ path: string }> }> } }] | undefined;
  assert.ok(plugin, "expo-font is in app.json's plugins");
  const embedded = plugin[1].android.fonts.flatMap((f) => f.fontDefinitions.map((d) => d.path.replace("./assets/fonts/", ""))).sort();
  assert.deepEqual(embedded, [...faces].sort());
});

test("the vendored Lucide icons are credited, with their license text next to them (Q145)", () => {
  const lucide = LICENSES.find((e) => e.name === "Lucide icons");
  assert.equal(lucide?.license, "ISC");
  const text = readFileSync(new URL("./icons/LICENSE-lucide.txt", import.meta.url), "utf8");
  assert.match(text, /^ISC License/);
  assert.match(readFileSync(new URL("./icons/lucide.ts", import.meta.url), "utf8"), /ISC license/);
});
