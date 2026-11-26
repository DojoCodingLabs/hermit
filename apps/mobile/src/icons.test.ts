/// <reference types="node" />
// Q145: Lucide is vendored, only the icons the app uses (src/icons/lucide.ts). Every shape there is drawn somewhere.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { lucide } from "./icons/lucide.ts";

const SRC = new URL(".", import.meta.url).pathname;
const sources = readdirSync(SRC, { recursive: true })
  .map(String)
  .filter((f) => /\.tsx?$/.test(f) && !f.startsWith("icons/") && !f.endsWith(".test.ts"))
  .map((f) => readFileSync(join(SRC, f), "utf8"))
  .join("\n");

test("Q145: every vendored Lucide icon is used by the app, so only those ship", () => {
  const unused = Object.keys(lucide).filter((name) => !sources.includes(`"${name}"`));
  assert.deepEqual(unused, []);
});
