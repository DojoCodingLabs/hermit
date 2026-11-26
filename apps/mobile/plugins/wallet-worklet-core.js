// SL-38 (Q111): the pure parts of the wallet worklet's Expo config plugin, so they are tested on Node without a
// prebuild (plugins/wallet-worklet.test.mjs).
//
// Why "after": QVAC's Expo plugin (`@qvac/sdk/expo-plugin`, withMobileBundle) empties react-native-bare-kit's Android
// addon folder and links only its own worker's addons, in a dangerous mod. Tether's worklet bundler does the same when
// its link option is on. Whatever empties the folder last wins, so the wallet's addons are linked strictly after every
// other dangerous mod, and only ever added (a union): nothing already in the folder is removed or overwritten.
//
// Expo runs a `withMod` mod's action and then the mods registered before it, so a plain withDangerousMod listed after
// QVAC's would run first. This one is a base mod that calls the rest of the chain first and links afterwards, which
// puts it after every withMod-style dangerous mod whatever its place in app.json.
"use strict";

const fs = require("node:fs");
const path = require("node:path");

/** Registers `run(config)` to run after every other `<platform>.dangerous` mod. */
function afterOtherDangerousMods(config, { withBaseMod, platform, run }) {
  return withBaseMod(config, {
    platform,
    mod: "dangerous",
    isProvider: false,
    async action({ modRequest: { nextMod, ...modRequest }, ...rest }) {
      const results = await nextMod({ ...rest, modRequest });
      await run(results);
      return results;
    },
  });
}

/** Every file under `dir`, as paths relative to it ("arm64-v8a/libbare-tls.4.1.0.so"). Missing dir: none. */
function listFiles(dir) {
  const out = [];
  const walk = (d, rel) => {
    let entries;
    try {
      entries = fs.readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) walk(path.join(d, e.name), r);
      else out.push(r);
    }
  };
  walk(dir, "");
  return out.sort();
}

/** "arm64-v8a/libbare-tls.4.1.0.so" to { abi, name: "bare-tls", version: "4.1.0" }; anything else undefined. */
function parseAddonFile(rel) {
  const m = /^([^/]+)\/lib(.+)\.(\d+\.\d+\.\d+)\.so$/.exec(rel);
  return m ? { abi: m[1], name: m[2], version: m[3] } : undefined;
}

/**
 * The union rule, checked: every file that was in the folder before the wallet's link step is still there after it,
 * and the report says what the wallet added and which libraries now ship in two versions side by side (Q110: they
 * coexist because the file names carry the version; the phone check decides whether to pin one).
 */
function unionReport(before, after) {
  const now = new Set(after);
  const lost = before.filter((f) => !now.has(f));
  if (lost.length) throw new Error(`The wallet's addon link removed files it must only add to: ${lost.join(", ")}`);
  const had = new Set(before);
  const added = after.filter((f) => !had.has(f));
  const versions = new Map();
  for (const f of after) {
    const a = parseAddonFile(f);
    if (!a) continue;
    const key = `${a.abi}/${a.name}`;
    versions.set(key, [...new Set([...(versions.get(key) ?? []), a.version])].sort());
  }
  const twoVersions = [...versions].filter(([, v]) => v.length > 1).map(([k, v]) => `${k} ${v.join(" and ")}`).sort();
  return { added, kept: before.length, twoVersions };
}

/** The command the plugin runs: build.mjs under the Node running the prebuild. */
function buildCommand(projectRoot) {
  return { command: process.execPath, args: [path.join(projectRoot, "worklets", "wallet", "build.mjs")] };
}

/** Where react-native-bare-kit builds Android's linked addons from, resolved from the app. */
function bareKitAddonsDir(projectRoot) {
  const pkg = require.resolve("react-native-bare-kit/package.json", { paths: [projectRoot] });
  return path.join(fs.realpathSync(path.dirname(pkg)), "android", "src", "main", "addons");
}

module.exports = { afterOtherDangerousMods, bareKitAddonsDir, buildCommand, listFiles, parseAddonFile, unionReport };
