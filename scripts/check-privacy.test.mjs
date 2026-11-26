import { test } from "node:test";
import assert from "node:assert/strict";
import { findGradleViolations, findLockfileViolations, findPrivacyViolations } from "./check-privacy.mjs";

test("check-privacy reads the native modules' Gradle files too: the SMS consent API passes, sign-in and analytics don't", () => {
  const ok = `dependencies {\n  implementation "com.google.android.gms:play-services-auth-api-phone:18.1.0"\n  implementation "androidx.webkit:webkit:1.12.1"\n}`;
  assert.deepEqual(findGradleViolations([{ path: "m/build.gradle", text: ok }]), []);
  const bad = [
    'implementation "com.google.android.gms:play-services-auth:21.2.0"',
    "implementation 'com.google.firebase:firebase-analytics:22.1.0'",
    'implementation "com.google.firebase:firebase-crashlytics-ktx:19.0.0"',
    'implementation "com.google.android.gms:play-services-measurement-api:22.1.0"',
    'implementation "io.sentry:sentry-android:7.0.0"',
    'implementation("com.google.android.gms:play-services-analytics:18.0.0")',
  ];
  for (const line of bad) assert.equal(findGradleViolations([{ path: "m/build.gradle", text: line }]).length, 1, line);
});

const manifest = (deps, field = "dependencies") => ({ path: "pkg/package.json", json: { [field]: deps } });

test("check-privacy flags denylisted dependency", () => {
  const v = findPrivacyViolations([manifest({ "@sentry/react-native": "^6.0.0", react: "19.3.0" })]);
  assert.deepEqual(v, [{ path: "pkg/package.json", dep: "@sentry/react-native" }]);
});

test("check-privacy ignores clean manifests", () => {
  assert.deepEqual(findPrivacyViolations([manifest({ react: "19.3.0", "@noble/curves": "2.4.0" })]), []);
});

test("check-privacy matches by prefix and across dependency fields", () => {
  const deps = {
    "posthog-react-native": "1", "@posthog/ai": "1", "@segment/analytics-next": "1", firebase: "1",
    "@react-native-firebase/analytics": "1", "@react-native-google-signin/google-signin": "1",
    "composio-core": "1", "@composio/core": "1", "@bugsnag/js": "1", "@datadog/browser-rum": "1",
    "@amplitude/analytics-browser": "1",
  };
  const v = findPrivacyViolations([manifest(deps, "devDependencies")]);
  assert.equal(v.length, Object.keys(deps).length);
});

test("check-privacy catches npm aliases", () => {
  const v = findPrivacyViolations([manifest({ "totally-harmless": "npm:@sentry/react-native@6.0.0" })]);
  assert.deepEqual(v, [{ path: "pkg/package.json", dep: "totally-harmless -> @sentry/react-native" }]);
});

test("check-privacy flags denylisted packages in the lockfile", () => {
  const lock = "lockfileVersion: '9.0'\n\npackages:\n\n  '@noble/curves@2.4.0':\n    resolution: {}\n\n  '@sentry/core@8.0.0':\n    resolution: {}\n\n  posthog-js@1.200.0:\n    resolution: {}\n";
  assert.deepEqual(findLockfileViolations(lock), ["@sentry/core", "posthog-js"]);
});

test("check-privacy denies more trackers", () => {
  const deps = { "expo-insights": "1", rollbar: "1", logrocket: "1", "instabug-reactnative": "1", "react-native-appsflyer": "1", "@rudderstack/rudder-sdk-react-native": "1", newrelic: "1" };
  assert.equal(findPrivacyViolations([manifest(deps)]).length, Object.keys(deps).length);
});
