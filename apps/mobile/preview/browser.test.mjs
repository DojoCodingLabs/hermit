import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { BROWSER_VAR, findChromium, playwrightCache } from "./browser.mjs";

// A made-up disk: the folders in each directory, and the files that exist. Nothing here touches the real machine.
const disk = (dirs, files) => ({
  list: (dir) => dirs[dir] ?? [],
  exists: (path) => files.includes(path),
});

const home = join("/", "home", "ana");
const macCache = join(home, "Library", "Caches", "ms-playwright");
const linuxCache = join(home, ".cache", "ms-playwright");
// An absolute path on whatever system runs the test, standing in for C:\Users\ana\AppData\Local.
const winLocal = join("/", "Users", "ana", "AppData", "Local");
const winCache = join(winLocal, "ms-playwright");

const macArm = (rev) => join(macCache, `chromium_headless_shell-${rev}`, "chrome-headless-shell-mac-arm64", "chrome-headless-shell");

test("an Apple silicon Mac finds the shell where it always did, with no setting", () => {
  const found = findChromium({ env: {}, platform: "darwin", arch: "arm64", home, ...disk({ [macCache]: ["chromium_headless_shell-1208"] }, [macArm(1208)]) });
  assert.equal(found, macArm(1208));
});

test("the newest revision wins by number, not as text: 1000 before 999", () => {
  const found = findChromium({
    env: {},
    platform: "darwin",
    arch: "arm64",
    home,
    ...disk({ [macCache]: ["chromium_headless_shell-999", "chromium_headless_shell-1000"] }, [macArm(999), macArm(1000)]),
  });
  assert.equal(found, macArm(1000));
});

test("a revision folder without the executable falls back to the one before it", () => {
  const found = findChromium({
    env: {},
    platform: "darwin",
    arch: "arm64",
    home,
    ...disk({ [macCache]: ["chromium_headless_shell-1208", "chromium_headless_shell-1200"] }, [macArm(1200)]),
  });
  assert.equal(found, macArm(1200));
});

test("folders that aren't the headless shell are ignored", () => {
  const found = findChromium({
    env: {},
    platform: "darwin",
    arch: "arm64",
    home,
    ...disk({ [macCache]: ["ffmpeg-1011", "chromium-1208", "chromium_headless_shell-1208"] }, [macArm(1208)]),
  });
  assert.equal(found, macArm(1208));
});

test("an Intel Mac looks in the mac-x64 folder", () => {
  const path = join(macCache, "chromium_headless_shell-1208", "chrome-headless-shell-mac-x64", "chrome-headless-shell");
  const found = findChromium({ env: {}, platform: "darwin", arch: "x64", home, ...disk({ [macCache]: ["chromium_headless_shell-1208"] }, [path]) });
  assert.equal(found, path);
});

test("Linux x64 looks in ~/.cache/ms-playwright, in the linux64 folder", () => {
  const path = join(linuxCache, "chromium_headless_shell-1208", "chrome-headless-shell-linux64", "chrome-headless-shell");
  const found = findChromium({ env: {}, platform: "linux", arch: "x64", home, ...disk({ [linuxCache]: ["chromium_headless_shell-1208"] }, [path]) });
  assert.equal(found, path);
});

test("Linux arm64 uses Playwright's own build, chrome-linux/headless_shell", () => {
  const path = join(linuxCache, "chromium_headless_shell-1208", "chrome-linux", "headless_shell");
  const found = findChromium({ env: {}, platform: "linux", arch: "arm64", home, ...disk({ [linuxCache]: ["chromium_headless_shell-1208"] }, [path]) });
  assert.equal(found, path);
});

test("Linux honors XDG_CACHE_HOME", () => {
  const cache = join("/", "data", "cache");
  assert.equal(playwrightCache({ env: { XDG_CACHE_HOME: cache }, platform: "linux", home }), join(cache, "ms-playwright"));
});

test("Windows looks under LOCALAPPDATA, in the win64 folder", () => {
  const local = winLocal;
  const path = join(winCache, "chromium_headless_shell-1208", "chrome-headless-shell-win64", "chrome-headless-shell.exe");
  const found = findChromium({
    env: { LOCALAPPDATA: local },
    platform: "win32",
    arch: "x64",
    home,
    ...disk({ [winCache]: ["chromium_headless_shell-1208"] }, [path]),
  });
  assert.equal(found, path);
});

test("Windows on ARM uses the same win64 shell, as Playwright installs it there too", () => {
  const path = join(winCache, "chromium_headless_shell-1208", "chrome-headless-shell-win64", "chrome-headless-shell.exe");
  const found = findChromium({
    env: { LOCALAPPDATA: winLocal },
    platform: "win32",
    arch: "arm64",
    home,
    ...disk({ [winCache]: ["chromium_headless_shell-1208"] }, [path]),
  });
  assert.equal(found, path);
});

test("PLAYWRIGHT_BROWSERS_PATH replaces the cache folder on every system", () => {
  const custom = join("/", "opt", "browsers");
  for (const platform of ["darwin", "linux", "win32"]) {
    assert.equal(playwrightCache({ env: { PLAYWRIGHT_BROWSERS_PATH: custom }, platform, home }), custom);
  }
  const path = join(custom, "chromium_headless_shell-1208", "chrome-headless-shell-linux64", "chrome-headless-shell");
  const found = findChromium({
    env: { PLAYWRIGHT_BROWSERS_PATH: custom },
    platform: "linux",
    arch: "x64",
    home,
    ...disk({ [custom]: ["chromium_headless_shell-1208"] }, [path]),
  });
  assert.equal(found, path);
});

test("PLAYWRIGHT_BROWSERS_PATH=0 means the browsers inside playwright-core's own folder, as Playwright installs them", () => {
  const local = join("/", "work", "hermit", "apps", "mobile", "preview", "node_modules", "playwright-core", ".local-browsers");
  assert.equal(playwrightCache({ env: { PLAYWRIGHT_BROWSERS_PATH: "0" }, platform: "linux", home, localBrowsers: () => local }), local);
});

test("a relative PLAYWRIGHT_BROWSERS_PATH resolves against INIT_CWD, then the working folder", () => {
  const project = join("/", "work", "hermit");
  const preview = join(project, "apps", "mobile", "preview");
  assert.equal(
    playwrightCache({ env: { PLAYWRIGHT_BROWSERS_PATH: "browsers", INIT_CWD: project }, platform: "linux", home, cwd: preview }),
    join(project, "browsers"),
  );
  assert.equal(playwrightCache({ env: { PLAYWRIGHT_BROWSERS_PATH: "browsers" }, platform: "linux", home, cwd: preview }), join(preview, "browsers"));
});

test(`${BROWSER_VAR} wins over the cache when the file exists`, () => {
  const own = join("/", "usr", "bin", "chromium");
  const found = findChromium({
    env: { [BROWSER_VAR]: own },
    platform: "darwin",
    arch: "arm64",
    home,
    ...disk({ [macCache]: ["chromium_headless_shell-1208"] }, [own, macArm(1208)]),
  });
  assert.equal(found, own);
});

test(`${BROWSER_VAR} pointing at nothing stops with a message, without falling back to the cache`, () => {
  const found = findChromium({
    env: { [BROWSER_VAR]: "/no/such/chromium" },
    platform: "darwin",
    arch: "arm64",
    home,
    ...disk({ [macCache]: ["chromium_headless_shell-1208"] }, [macArm(1208)]),
  });
  assert.ok(found instanceof Error);
  assert.match(found.message, new RegExp(`${BROWSER_VAR} is set to /no/such/chromium`));
});

test(`an empty cache stops with a message that names ${BROWSER_VAR} and says nothing is downloaded`, () => {
  const found = findChromium({ env: {}, platform: "linux", arch: "x64", home, ...disk({}, []) });
  assert.ok(found instanceof Error);
  assert.ok(found.message.includes(linuxCache), found.message);
  assert.ok(found.message.includes(BROWSER_VAR), found.message);
  assert.match(found.message, /never download a browser/);
});

test("a system with no known shell folder stops with the same message", () => {
  const found = findChromium({ env: {}, platform: "freebsd", arch: "x64", home, ...disk({ [linuxCache]: ["chromium_headless_shell-1208"] }, []) });
  assert.ok(found instanceof Error);
  assert.ok(found.message.includes(BROWSER_VAR), found.message);
});
