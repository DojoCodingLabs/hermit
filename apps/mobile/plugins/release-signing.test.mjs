// The release signing plugin's transform of the generated app/build.gradle: the release key comes from the environment
// or Gradle properties at build time, never from a file in the repository.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { MARK, withReleaseSigningGradle } = require("./release-signing-core.js");

// The parts of Expo's template that the transform touches, as `expo prebuild` writes them.
const TEMPLATE = `apply plugin: "com.android.application"

def jscFlavor = 'io.github.react-native-community:jsc-android:2026004.+'

android {
    ndkVersion rootProject.ext.ndkVersion
    namespace 'io.dojocoding.hermit'
    signingConfigs {
        debug {
            storeFile file('debug.keystore')
            storePassword 'android'
            keyAlias 'androiddebugkey'
            keyPassword 'android'
        }
    }
    buildTypes {
        debug {
            signingConfig signingConfigs.debug
        }
        release {
            // Caution! In production, you need to generate your own keystore file.
            // see https://reactnative.dev/docs/signed-apk-android.
            signingConfig signingConfigs.debug
            def enableShrinkResources = findProperty('android.enableShrinkResourcesInReleaseBuilds') ?: 'false'
            shrinkResources enableShrinkResources.toBoolean()
        }
    }
}
`;

test("the release build type signs with the key the environment or Gradle properties name", () => {
  const out = withReleaseSigningGradle(TEMPLATE);
  // Each value: the environment first, then a Gradle property.
  assert.match(out, /def hermitSigning = \{ String env, String prop -> System\.getenv\(env\) \?: findProperty\(prop\) \}/);
  for (const [env, prop] of [["HERMIT_RELEASE_STORE_FILE", "hermitReleaseStoreFile"], ["HERMIT_RELEASE_STORE_PASSWORD", "hermitReleaseStorePassword"], ["HERMIT_RELEASE_KEY_ALIAS", "hermitReleaseKeyAlias"], ["HERMIT_RELEASE_KEY_PASSWORD", "hermitReleaseKeyPassword"]]) {
    assert.ok(out.includes(`hermitSigning("${env}", "${prop}")`), env);
  }
  // The release config exists only when a store is named; the release build type picks it then.
  assert.match(out, /signingConfigs \{\n {8}if \(hermitReleaseStore\) \{\n {12}release \{/);
  const release = out.slice(out.indexOf("        release {\n            // Caution!"));
  assert.match(release, /signingConfig hermitReleaseStore \? signingConfigs\.release : signingConfigs\.debug/);
  // The debug build type and the debug key are untouched.
  assert.match(out, /debug \{\n {12}signingConfig signingConfigs\.debug\n {8}\}/);
  assert.match(out, /storeFile file\('debug\.keystore'\)/);
  // No secret is ever written into the file: the only literal password is the template's debug key's.
  assert.deepEqual(out.match(/(store|key)Password ['"][^'"]*['"]/g), ["storePassword 'android'", "keyPassword 'android'"]);
});

test("running it twice changes nothing more", () => {
  const once = withReleaseSigningGradle(TEMPLATE);
  assert.equal(withReleaseSigningGradle(once), once);
  assert.equal(once.split(MARK).length - 1, 1);
});

test("a template it doesn't recognize stops the prebuild instead of building a release with the debug key unnoticed", () => {
  assert.throws(() => withReleaseSigningGradle('apply plugin: "com.android.application"\nandroid {\n}\n'), /signingConfigs/);
  assert.throws(() => withReleaseSigningGradle(TEMPLATE.replace("            signingConfig signingConfigs.debug\n            def enableShrinkResources", "            def enableShrinkResources")), /release build type/);
});

test("through Expo's own mod, at every prebuild: app.json lists the plugin and it edits app/build.gradle", async () => {
  const app = JSON.parse(readFileSync(new URL("../app.json", import.meta.url), "utf8"));
  assert.ok(app.expo.plugins.includes("./plugins/with-release-signing"));
  const withReleaseSigning = require("./with-release-signing.js");
  const config = withReleaseSigning({ name: "Hermit", slug: "hermit" });
  const out = await config.mods.android.appBuildGradle({
    ...config,
    modResults: { language: "groovy", contents: TEMPLATE, path: "/app/android/app/build.gradle" },
    modRequest: { platform: "android", modName: "appBuildGradle", projectRoot: "/app", platformProjectRoot: "/app/android", introspect: false },
  });
  assert.equal(out.modResults.contents, withReleaseSigningGradle(TEMPLATE));
});
