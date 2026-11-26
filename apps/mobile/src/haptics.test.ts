/// <reference types="node" />
// The polish round's touch feedback must need no permission (docs/design/polish/decisions.md): the local module plays
// the window's own feedback (View.performHapticFeedback), never the Vibrator service, which needs VIBRATE.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const module = (path: string) => readFileSync(new URL(`../modules/hermit-haptics/${path}`, import.meta.url), "utf8");

test("hermit-haptics asks for no permission and never uses the Vibrator service", () => {
  assert.doesNotMatch(module("android/src/main/AndroidManifest.xml"), /<uses-permission/);
  const kotlin = module("android/src/main/java/io/dojocoding/hermit/haptics/HermitHapticsModule.kt");
  assert.match(kotlin, /performHapticFeedback/);
  assert.doesNotMatch(kotlin, /Vibrator|VibrationEffect|VIBRATE/);
});

test("the app calls feedback through haptic(), which tolerates a build without the module", () => {
  const js = readFileSync(new URL("./haptics.ts", import.meta.url), "utf8");
  assert.match(js, /HermitHaptics\?\.perform/);
  assert.match(js, /catch/);
});
