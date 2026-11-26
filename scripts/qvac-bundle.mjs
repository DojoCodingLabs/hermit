// Rebuilds QVAC's mobile worker bundle with the workspace root as project root.
// Why: pnpm keeps packages at the workspace root, two levels above apps/mobile. Bundled from apps/mobile,
// their keys start with "/../../node_modules/...", but Bare normalizes the request to "file:///node_modules/..."
// at runtime, so the worker can't find its own plugin (CANNOT_READ) and aborts. Bundling from the workspace
// root makes the keys "/node_modules/...", which match. Run after `expo prebuild` (Node >= 22.21).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const app = path.join(root, "apps", "mobile");
const sdk = fs.realpathSync(path.join(app, "node_modules", "@qvac", "sdk"));
const { bundleSdk } = await import(path.join(sdk, "dist/src/commands/index.js"));
const { MOBILE_HOSTS, MOBILE_UNSUPPORTED_MODULES } = await import(path.join(sdk, "dist/src/expo/plugins/withMobileBundle.js"));

await bundleSdk({
  projectRoot: root,
  sdkPath: sdk,
  configPath: path.join(app, "qvac.config.json"),
  hosts: MOBILE_HOSTS,
  defer: ["expo-file-system", "react-native-bare-kit", ...MOBILE_UNSUPPORTED_MODULES, "@qvac/sdk/worker.mobile.bundle"],
  quiet: true,
  checkEngines: false,
});
const generated = path.join(root, "qvac", "worker.bundle.js");
fs.copyFileSync(generated, path.join(sdk, "dist", "worker.mobile.bundle.js"));
fs.rmSync(path.join(root, "qvac"), { recursive: true, force: true });
console.log("QVAC worker bundle rebuilt from the workspace root:", path.join(sdk, "dist", "worker.mobile.bundle.js"));
