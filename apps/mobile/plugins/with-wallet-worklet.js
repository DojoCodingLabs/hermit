// SL-38 (Q111): Expo config plugin that packs the wallet worklet and links its native addons into
// react-native-bare-kit at every `expo prebuild`, strictly after QVAC's plugin has relinked its own (see
// wallet-worklet-core.js for the ordering and the union rule). Android only: Hermit ships no iOS build (V2).
//
// app.json: "./plugins/with-wallet-worklet" (anywhere in the plugin list; it runs after the other dangerous mods).
// Option `{ "skip": true }`, or HERMIT_SKIP_WALLET_WORKLET=1, leaves the wallet out of this prebuild (the app still
// builds; the wallet screens say the wallet isn't in this build). `node worklets/wallet/build.mjs` is the manual
// fallback that does the same steps, for when something emptied the addon folder after a prebuild.
"use strict";

const { execFileSync } = require("node:child_process");
const { withBaseMod } = require("expo/config-plugins");
const { afterOtherDangerousMods, bareKitAddonsDir, buildCommand, listFiles, unionReport } = require("./wallet-worklet-core.js");

function withWalletWorklet(config, options = {}) {
  return afterOtherDangerousMods(config, {
    withBaseMod,
    platform: "android",
    async run(results) {
      if (options.skip === true || process.env.HERMIT_SKIP_WALLET_WORKLET === "1") {
        console.log("Hermit wallet: skipped for this prebuild; the wallet won't be in this build.");
        return;
      }
      const projectRoot = results.modRequest.projectRoot;
      const addons = bareKitAddonsDir(projectRoot);
      const before = listFiles(addons);
      const { command, args } = buildCommand(projectRoot);
      execFileSync(command, args, { cwd: projectRoot, stdio: "inherit" });
      const report = unionReport(before, listFiles(addons));
      console.log(`Hermit wallet: linked ${report.added.length} addon files next to the ${report.kept} already there.`);
      if (report.twoVersions.length) console.log(`Hermit wallet: two versions side by side (Q110): ${report.twoVersions.join("; ")}`);
    },
  });
}

module.exports = withWalletWorklet;
