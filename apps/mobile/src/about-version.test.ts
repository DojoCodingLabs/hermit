/// <reference types="node" />
// Issue #31: the bug form asks for the version on About, so About shows it, read through the adapters.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const screen = readFileSync(new URL("./app/about.tsx", import.meta.url), "utf8");

test("About shows the app's version from the adapters, in a line people can select and copy", () => {
  assert.match(screen, /import \{[^}]*\bappVersion\b[^}]*\} from "\.\.\/adapters\/device-lab";/);
  const at = screen.indexOf('t("HM-SET-08.version", { version: appVersion() })');
  assert.ok(at > 0, "the version line fills HM-SET-08.version with appVersion()");
  const tag = screen.slice(screen.lastIndexOf("<T", at), at);
  assert.match(tag, /\bselectable\b/, "the version line is selectable");
});

test("About reads no phone facts itself", () => {
  assert.doesNotMatch(screen, /expo-constants/);
});
