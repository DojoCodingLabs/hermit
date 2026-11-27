// Dev-only: finds the headless Chromium the preview scripts drive (shoot.mjs, clips.mjs, words.mjs). It only looks,
// never downloads: HERMIT_PREVIEW_CHROMIUM first, then Playwright's own cache for this system. mascot/proof.mjs films
// with a full Chrome and keeps its own lookup.
import { existsSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";

export const BROWSER_VAR = "HERMIT_PREVIEW_CHROMIUM";

/** The executable inside a chromium_headless_shell-<revision> folder, by system (as playwright-core names them). */
const SHELL = {
  "darwin-arm64": ["chrome-headless-shell-mac-arm64", "chrome-headless-shell"],
  "darwin-x64": ["chrome-headless-shell-mac-x64", "chrome-headless-shell"],
  "linux-x64": ["chrome-headless-shell-linux64", "chrome-headless-shell"],
  "linux-arm64": ["chrome-linux", "headless_shell"],
  "win32-x64": ["chrome-headless-shell-win64", "chrome-headless-shell.exe"],
};
// playwright-core installs the x64 build on every Windows, ARM included.
const shellFor = (platform, arch) => SHELL[platform === "win32" ? "win32-x64" : `${platform}-${arch}`];

/** Where PLAYWRIGHT_BROWSERS_PATH=0 installs: .local-browsers inside the harness's own playwright-core. */
const playwrightLocalBrowsers = () =>
  join(dirname(createRequire(import.meta.url).resolve("playwright-core/package.json")), ".local-browsers");

/** Playwright's browser cache, by the same rules playwright-core uses (PLAYWRIGHT_BROWSERS_PATH, then per system). */
export function playwrightCache({
  env = process.env,
  platform = process.platform,
  home = homedir(),
  cwd = process.cwd(),
  localBrowsers = playwrightLocalBrowsers,
} = {}) {
  const set = env.PLAYWRIGHT_BROWSERS_PATH;
  let cache;
  if (set === "0") cache = localBrowsers();
  else if (set) cache = set;
  else if (platform === "darwin") cache = join(home, "Library", "Caches", "ms-playwright");
  else if (platform === "win32") cache = join(env.LOCALAPPDATA || join(home, "AppData", "Local"), "ms-playwright");
  else cache = join(env.XDG_CACHE_HOME || join(home, ".cache"), "ms-playwright");
  // A relative path counts from where pnpm was started (INIT_CWD), as playwright-core reads it.
  return isAbsolute(cache) ? cache : resolve(env.INIT_CWD || cwd, cache);
}

/** The path to launch, or an Error that says how to point the harness at a browser. */
export function findChromium({
  env = process.env,
  platform = process.platform,
  arch = process.arch,
  home = homedir(),
  cwd = process.cwd(),
  localBrowsers = playwrightLocalBrowsers,
  exists = existsSync,
  list = (dir) => (existsSync(dir) ? readdirSync(dir) : []),
} = {}) {
  const set = env[BROWSER_VAR];
  if (set) return exists(set) ? set : new Error(`${BROWSER_VAR} is set to ${set}, but there is no file there.`);
  const cache = playwrightCache({ env, platform, home, cwd, localBrowsers });
  const shell = shellFor(platform, arch);
  // Newest revision first: chromium_headless_shell-1255 before -999, so compare the numbers, not the text.
  const revisions = list(cache)
    .filter((d) => /^chromium_headless_shell-\d+$/.test(d))
    .sort((a, b) => Number(b.split("-")[1]) - Number(a.split("-")[1]));
  for (const dir of shell ? revisions : []) {
    const path = join(cache, dir, ...shell);
    if (exists(path)) return path;
  }
  return new Error(
    `No headless Chromium found in ${cache}. Set ${BROWSER_VAR} to the path of a Chromium or chrome-headless-shell executable. ` +
      "The preview scripts never download a browser (CONTRIBUTING.md, Screenshots for a UI change).",
  );
}

/** For the scripts: the path, or stop with the message. */
export function chromiumPath() {
  const found = findChromium();
  if (found instanceof Error) {
    console.error(found.message);
    process.exit(1);
  }
  return found;
}
