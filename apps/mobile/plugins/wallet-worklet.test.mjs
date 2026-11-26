// SL-38 (Q111): the wallet plugin's config transform, with Expo's own mod machinery and no prebuild. QVAC's plugin is
// stood in for by a withDangerousMod that empties the addon folder and links its worker's files, as link-addons.js does.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { withBaseMod, withDangerousMod } = require("expo/config-plugins");
const { afterOtherDangerousMods, listFiles, parseAddonFile, unionReport } = require("./wallet-worklet-core.js");

const QVAC_FILES = ["arm64-v8a/libbare-tls.3.2.1.so", "arm64-v8a/libbare-fs.4.8.4.so", "arm64-v8a/libqvac-llm.0.25.0.so"];
const WALLET_FILES = ["arm64-v8a/libbare-tls.4.1.0.so", "arm64-v8a/libbare-fs.4.8.4.so", "arm64-v8a/libbare-thread.1.4.0.so", "x86_64/libbare-tls.4.1.0.so"];

function write(dir, files) {
  for (const f of files) {
    fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true });
    fs.writeFileSync(path.join(dir, f), f);
  }
}

/** QVAC's step: empty the folder, then write its own files (link-addons.js does `fsp.rm(out)` first). */
const qvac = (dir, order) => (config) =>
  withDangerousMod(config, ["android", async (c) => {
    order.push("qvac");
    fs.rmSync(dir, { recursive: true, force: true });
    write(dir, QVAC_FILES);
    return c;
  }]);

/** The wallet's step as the plugin runs it: only adds, then the union is checked. */
const wallet = (dir, order) => (config) =>
  afterOtherDangerousMods(config, {
    withBaseMod,
    platform: "android",
    async run() {
      order.push("wallet");
      const before = listFiles(dir);
      write(dir, WALLET_FILES);
      order.push(unionReport(before, listFiles(dir)));
    },
  });

/** Runs the android dangerous mods the way Expo's compiler does: one call into the chain's outermost mod. */
async function prebuild(config) {
  await config.mods.android.dangerous({ ...config, modResults: {}, modRequest: { platform: "android", modName: "dangerous", projectRoot: "/app", platformProjectRoot: "/app/android", introspect: false } });
}

for (const [label, plugins] of [
  ["listed after QVAC's", (dir, order) => [qvac(dir, order), wallet(dir, order)]],
  ["listed before QVAC's", (dir, order) => [wallet(dir, order), qvac(dir, order)]],
]) {
  test(`the wallet links after QVAC's plugin empties the folder, ${label}, and QVAC's files stay`, async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hermit-addons-"));
    try {
      const order = [];
      let config = { name: "Hermit", slug: "hermit" };
      for (const p of plugins(dir, order)) config = p(config);
      await prebuild(config);
      assert.deepEqual(order.slice(0, 2), ["qvac", "wallet"]);
      for (const f of [...QVAC_FILES, ...WALLET_FILES]) assert.ok(fs.existsSync(path.join(dir, f)), f);
      const report = order[2];
      assert.deepEqual(report.added, ["arm64-v8a/libbare-thread.1.4.0.so", "arm64-v8a/libbare-tls.4.1.0.so", "x86_64/libbare-tls.4.1.0.so"]);
      assert.equal(report.kept, 3);
      assert.deepEqual(report.twoVersions, ["arm64-v8a/bare-tls 3.2.1 and 4.1.0"]);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
}

test("a link step that removed anything already in the folder fails the prebuild", () => {
  assert.throws(() => unionReport(QVAC_FILES, QVAC_FILES.slice(1)), /must only add/);
  assert.deepEqual(unionReport([], ["arm64-v8a/libx.1.0.0.so"]).added, ["arm64-v8a/libx.1.0.0.so"]);
});

test("addon file names are read as abi, library and version", () => {
  assert.deepEqual(parseAddonFile("arm64-v8a/libbare-tls.4.1.0.so"), { abi: "arm64-v8a", name: "bare-tls", version: "4.1.0" });
  assert.equal(parseAddonFile("arm64-v8a/README"), undefined);
});

test("app.json lists the plugin, after QVAC's, and the plugin module loads with Expo's config plugins", () => {
  const app = JSON.parse(fs.readFileSync(new URL("../app.json", import.meta.url), "utf8"));
  const names = app.expo.plugins.map((p) => (Array.isArray(p) ? p[0] : p));
  assert.ok(names.indexOf("./plugins/with-wallet-worklet") > names.indexOf("@qvac/sdk/expo-plugin"));
  const plugin = require("./with-wallet-worklet.js");
  const config = plugin({ name: "Hermit", slug: "hermit" });
  assert.equal(typeof config.mods.android.dangerous, "function");
  assert.equal(config.mods.ios, undefined);
});
