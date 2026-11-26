// Builds the wallet worklet for the phone (SL-17, SL-38, docs/research/wdk-worklet-spike.md).
// Normally nobody runs this by hand: the Expo config plugin `plugins/with-wallet-worklet.js` (Q111) runs it at every
// `expo prebuild`, after QVAC's plugin has emptied react-native-bare-kit's addon folder and linked its own worker's
// addons, and checks that it only added files. Run it by hand only as the fallback, when something emptied that folder
// after a prebuild (a reinstall of node_modules, or QVAC's `scripts/qvac-bundle.mjs` run on its own):
//   node apps/mobile/worklets/wallet/build.mjs
// 1. Copies this folder to a scratch dir in the OS temp dir and runs `npm ci --ignore-scripts` there, so about
//    320 MB of node_modules stay out of the repository and out of Metro's crawl.
// 2. Packs index.mjs with bare-pack (linked addons, Android hosts) into dist/wallet.bundle.cjs, which the app's
//    wallet adapter requires. The file is generated and gitignored.
// 3. Links exactly the addons the bundle names into react-native-bare-kit's Android addon folder, next to QVAC's.
// bare-pack and the linker run under the Bare runtime from the scratch install: Node segfaults in
// bare-module-lexer's Node addon on the build Mac (Node 22.17 and 24.4, macOS 26).
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const app = path.resolve(here, "..", "..");
const scratch = path.join(os.tmpdir(), "hermit-wallet-worklet");
const run = (cmd, args, cwd) => execFileSync(cmd, args, { cwd, stdio: "inherit" });

fs.mkdirSync(scratch, { recursive: true });
for (const f of ["package.json", "package-lock.json", "index.mjs", "handler.mjs", "link.mjs", "mac-check.mjs"]) {
  fs.copyFileSync(path.join(here, f), path.join(scratch, f));
}
run("npm", ["ci", "--ignore-scripts", "--no-audit", "--no-fund"], scratch);

const runtimePkg = `bare-runtime-${process.platform}-${process.arch}`;
const bare = path.join(scratch, "node_modules", runtimePkg, "bin", "bare");
fs.chmodSync(bare, 0o755); // --ignore-scripts leaves the prebuilt runtime without its execute bit

const out = path.join(here, "dist", "wallet.bundle.cjs");
fs.mkdirSync(path.dirname(out), { recursive: true });
run(
  bare,
  [
    "node_modules/bare-pack/bin.js",
    "--linked",
    "--host", "android-arm64",
    "--host", "android-x64",
    // ethers requires `ws`, whose optional native helpers are absent and never used here.
    "--defer", "bufferutil",
    "--defer", "utf-8-validate",
    "--out", out,
    "index.mjs",
  ],
  scratch,
);

const bareKit = fs.realpathSync(path.join(app, "node_modules", "react-native-bare-kit"));
run(bare, ["link.mjs", out, path.join(bareKit, "android", "src", "main", "addons")], scratch);
console.log("Wallet worklet bundle:", out, `(${fs.statSync(out).size} bytes)`);
