/// <reference types="node" />
// The APK declares only the permissions the PRD lists (2.15, FR-PLAT-02). Expo's prebuild template adds two optional
// ones to every app's AndroidManifest.xml, VIBRATE and SYSTEM_ALERT_WINDOW, and app.json's `permissions` only adds:
// app.json has to block them. Haptics need no VIBRATE (hermit-haptics plays the window's own feedback), and nothing in
// Hermit draws over other apps.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const android = JSON.parse(readFileSync(new URL("../app.json", import.meta.url), "utf8")).expo.android as {
  permissions: string[];
  blockedPermissions: string[];
};

test("app.json blocks the template's VIBRATE and SYSTEM_ALERT_WINDOW and never asks for them", () => {
  for (const p of ["android.permission.VIBRATE", "android.permission.SYSTEM_ALERT_WINDOW"]) {
    assert.ok(android.blockedPermissions.includes(p), `${p} is blocked`);
    assert.ok(!android.permissions.includes(p), `${p} is not requested`);
  }
});
