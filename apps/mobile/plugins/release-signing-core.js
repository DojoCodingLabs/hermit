// The pure part of the release signing plugin (with-release-signing.js), tested on Node without a prebuild
// (release-signing.test.mjs). It edits the app/build.gradle that `expo prebuild` generates so a release build signs
// with a key named at build time:
//
//   environment                     or Gradle property
//   HERMIT_RELEASE_STORE_FILE       hermitReleaseStoreFile       the keystore's path
//   HERMIT_RELEASE_STORE_PASSWORD   hermitReleaseStorePassword
//   HERMIT_RELEASE_KEY_ALIAS        hermitReleaseKeyAlias
//   HERMIT_RELEASE_KEY_PASSWORD     hermitReleaseKeyPassword
//
// The values never go into a file in the repository: CI decodes the keystore from a secret into the runner's temp
// folder, and a local build passes them in the environment or in ~/.gradle/gradle.properties. Without a store, a
// release build is signed with the template's debug key and Gradle says so: good for trying a release build on your
// own phone, never for publishing (the release workflow checks the APK's certificate).
"use strict";

const MARK = "// Hermit release signing (plugins/with-release-signing.js)";

const READ = `${MARK}: from the environment or Gradle properties, never from a committed file.
def hermitSigning = { String env, String prop -> System.getenv(env) ?: findProperty(prop) }
def hermitReleaseStore = hermitSigning("HERMIT_RELEASE_STORE_FILE", "hermitReleaseStoreFile")
if (!hermitReleaseStore) {
    logger.warn("Hermit: no release key named (HERMIT_RELEASE_STORE_FILE), so a release build is signed with the debug key.")
}

`;

const CONFIG = `        if (hermitReleaseStore) {
            release {
                storeFile file(hermitReleaseStore)
                storePassword hermitSigning("HERMIT_RELEASE_STORE_PASSWORD", "hermitReleaseStorePassword")
                keyAlias hermitSigning("HERMIT_RELEASE_KEY_ALIAS", "hermitReleaseKeyAlias")
                keyPassword hermitSigning("HERMIT_RELEASE_KEY_PASSWORD", "hermitReleaseKeyPassword")
            }
        }
`;

/** The build.gradle with release signing read at build time; unchanged when already done. Throws on a template it doesn't know. */
function withReleaseSigningGradle(contents) {
  if (contents.includes(MARK)) return contents;
  const android = contents.indexOf("\nandroid {");
  if (android < 0) throw new Error("Hermit release signing: no android block in app/build.gradle");
  const configs = contents.indexOf("    signingConfigs {\n", android);
  if (configs < 0) throw new Error("Hermit release signing: no signingConfigs block in app/build.gradle");
  const types = contents.indexOf("    buildTypes {", configs);
  const release = types < 0 ? -1 : contents.indexOf("        release {", types);
  const line = "            signingConfig signingConfigs.debug\n";
  const sign = release < 0 ? -1 : contents.indexOf(line, release);
  const end = release < 0 ? -1 : contents.indexOf("\n        }\n", release);
  if (sign < 0 || sign > end) throw new Error("Hermit release signing: the release build type doesn't sign with the debug key as the template does");
  const afterConfigs = configs + "    signingConfigs {\n".length;
  return (
    contents.slice(0, android + 1) +
    READ +
    contents.slice(android + 1, afterConfigs) +
    CONFIG +
    contents.slice(afterConfigs, sign) +
    "            signingConfig hermitReleaseStore ? signingConfigs.release : signingConfigs.debug\n" +
    contents.slice(sign + line.length)
  );
}

module.exports = { MARK, withReleaseSigningGradle };
