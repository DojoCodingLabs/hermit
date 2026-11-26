// Expo config plugin: a release build signs with the key named at build time (release-signing-core.js has the
// variables and why). app.json: "./plugins/with-release-signing". Android only.
"use strict";

const { withAppBuildGradle } = require("expo/config-plugins");
const { withReleaseSigningGradle } = require("./release-signing-core.js");

function withReleaseSigning(config) {
  return withAppBuildGradle(config, (c) => {
    if (c.modResults.language !== "groovy") throw new Error("Hermit release signing: app/build.gradle is not Groovy");
    c.modResults.contents = withReleaseSigningGradle(c.modResults.contents);
    return c;
  });
}

module.exports = withReleaseSigning;
