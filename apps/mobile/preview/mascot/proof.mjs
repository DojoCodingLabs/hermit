// Dev-only: the proof behind docs/design/mascot/index.html. Builds the mascot page and, in Chrome with GPU
// rasterization (the way docs/brand/mascot/png was rendered):
//   1. renders every rig pose from the component, light and dark, at 512 by 444, and diffs it against its PNG
//      and against the rig's own SVG (scripts/brand/mascot.py) drawn by the same browser;
//   2. renders each app pose at rest after a real transition (the moving crab's drawing), and diffs it too;
//   3. records the clips (Playwright video, then mp4 with ffmpeg when it is installed).
// Writes docs/design/mascot/out (gitignored) and out/results.js for the page. Usage:
//   node apps/mobile/preview/mascot/proof.mjs [--no-clips]
import { createServer } from "node:http";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, extname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { decodePng, encodePng } from "./png.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const preview = resolve(here, "..");
const repo = resolve(preview, "../../..");
const dist = join(preview, "dist/mascot");
const out = join(repo, "docs/design/mascot/out");
const PNG_DIR = join(repo, "docs/brand/mascot/png");
const RIG_DIR = join(repo, "docs/brand/mascot/rig");
const clipsWanted = !process.argv.includes("--no-clips");

await import("./build.mjs");
for (const d of ["renders", "markup", "rig", "rest", "diff", "clips"]) mkdirSync(join(out, d), { recursive: true });

// ---------------------------------------------------------------- what to render

const EXTRA = ["hello", "peek", "blink", "mark"];
const rigPoses = [...new Set(readdirSync(PNG_DIR).filter((f) => f.endsWith(".png")).map((f) => f.replace(/(-dark)?\.png$/, "")))].sort(
  (a, b) => (EXTRA.indexOf(a) - EXTRA.indexOf(b)) || a.localeCompare(b),
);
// The app's poses and the rig pose each shows, read from src/mascot.ts so the two never disagree.
const mascotTs = readFileSync(join(preview, "../src/mascot.ts"), "utf8");
const appPoses = Object.fromEntries([...mascotTs.matchAll(/^ {2}(\w+): "([\w-]+)",$/gm)].map((m) => [m[1], m[2]]));
const THEMES = ["light", "dark"];
const GROUND = { light: [0xf5, 0xed, 0xe1], dark: [0x06, 0x12, 0x1d] };
const suffix = (theme) => (theme === "dark" ? "-dark" : "");

// ---------------------------------------------------------------- the browser

/** Chrome for Testing from Playwright's cache: its GPU rasterizer is the one that drew docs/brand/mascot/png. */
function chromePath() {
  const cache = join(process.env.HOME, "Library/Caches/ms-playwright");
  const dir = readdirSync(cache).filter((d) => /^chromium-\d+$/.test(d)).sort((a, b) => Number(a.split("-")[1]) - Number(b.split("-")[1])).pop();
  if (!dir) throw new Error("no Chromium in ~/Library/Caches/ms-playwright");
  return join(cache, dir, "chrome-mac-arm64", "Google Chrome for Testing.app", "Contents", "MacOS", "Google Chrome for Testing");
}
const FLAGS = ["--headless=new", "--enable-gpu-rasterization", "--ignore-gpu-blocklist", "--use-angle=metal"];

const types = { ".html": "text/html", ".js": "text/javascript", ".png": "image/png" };
const server = createServer((req, res) => {
  const path = resolve(dist, "." + decodeURIComponent(new URL(req.url, "http://x").pathname));
  if (path !== dist && !path.startsWith(dist + sep)) {
    res.writeHead(403);
    return res.end();
  }
  const file = existsSync(path) && statSync(path).isFile() ? path : join(dist, "index.html");
  res.writeHead(200, { "content-type": types[extname(file)] ?? "application/octet-stream" });
  res.end(readFileSync(file));
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${server.address().port}/`;
const browser = await chromium.launch({ executablePath: chromePath(), args: FLAGS });
const errors = [];

/** An SVG document drawn as an image 512 wide: how docs/brand/mascot/png was made from the rig. */
async function asImage(page, svg, file) {
  const b64 = Buffer.from(svg).toString("base64");
  await page.setContent(`<html><body style="margin:0;background:transparent"><img id="i" style="display:block;width:512px" src="data:image/svg+xml;base64,${b64}"></body></html>`);
  await page.waitForFunction(() => document.getElementById("i").complete);
  await page.screenshot({ path: file, omitBackground: true, clip: { x: 0, y: 0, width: 512, height: 444 } });
}

/** The page at `query`, as a screen shows it; with `markup`, also the component's own SVG drawn as an image. */
async function shoot(ctx, query, file, markup) {
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(`${query}: ${e.message}`));
  await page.goto(`${base}?${query}`);
  await page.waitForFunction(() => window.__ready === true, null, { timeout: 15000 });
  const found = await page.evaluate(() => window.__errors ?? []);
  errors.push(...found.map((e) => `${query}: ${e}`));
  await page.screenshot({ path: file, omitBackground: true, clip: { x: 0, y: 0, width: 512, height: 444 } });
  if (markup) {
    const svg = await page.evaluate(() => {
      const s = document.querySelector("svg").cloneNode(true);
      s.setAttribute("xmlns", "http://www.w3.org/2000/svg");
      for (const a of ["style", "aria-hidden", "preserveAspectRatio"]) s.removeAttribute(a);
      s.setAttribute("width", "693");
      s.setAttribute("height", "601");
      return s.outerHTML;
    });
    await asImage(page, svg, markup);
  }
  await page.close();
}

// ---------------------------------------------------------------- 1 and 2: stills and rest frames

const stills = await browser.newContext({ viewport: { width: 512, height: 444 }, deviceScaleFactor: 1 });
for (const pose of rigPoses) {
  for (const theme of THEMES) {
    const name = `${pose}${suffix(theme)}.png`;
    await shoot(stills, `mode=still&pose=${pose}&theme=${theme}`, join(out, "renders", name), join(out, "markup", name));
    // The rig's own SVG (scripts/brand/mascot.py), drawn by the same browser the same way the PNGs were.
    const page = await stills.newPage();
    await asImage(page, readFileSync(join(RIG_DIR, `${pose}${suffix(theme)}.svg`), "utf8"), join(out, "rig", name));
    await page.close();
  }
}
const rests = [];
for (const [pose, rig] of Object.entries(appPoses)) {
  const from = pose === "idle" ? "working" : "idle";
  for (const theme of THEMES) {
    await shoot(stills, `mode=rest&pose=${pose}&from=${from}&theme=${theme}`, join(out, "rest", `${pose}${suffix(theme)}.png`));
    rests.push({ pose, rig, from, theme });
  }
}
await stills.close();

// ---------------------------------------------------------------- the diff

const load = (path) => decodePng(readFileSync(path));

/** A picture laid on the ground it is made for (paper, or Deep sea's abyss), as rounded RGB. */
function onGround(img, theme) {
  const g = GROUND[theme];
  const n = img.width * img.height;
  const rgb = new Uint8Array(n * 3);
  for (let p = 0; p < n; p++) {
    const al = img.rgba[p * 4 + 3];
    for (let c = 0; c < 3; c++) rgb[p * 3 + c] = Math.round((img.rgba[p * 4 + c] * al + g[c] * (255 - al)) / 255);
  }
  return rgb;
}

/**
 * Two pictures on their ground, per pixel as the largest channel difference (0 to 255). The crab is one color on its
 * ground, so a pixel's difference is coverage: 4x multisampling, as Chrome's GPU rasterizer draws paths, moves in
 * steps of a quarter, about 64 for ink on paper. An edge is a pixel whose 3 by 3 neighbourhood is not one flat color
 * in both pictures. "Beyond antialiasing" counts any difference off an edge, and any edge difference over two samples.
 */
function compare(a, b, theme) {
  const { width, height } = a;
  if (width !== b.width || height !== b.height) throw new Error("size mismatch");
  const A = onGround(a, theme);
  const B = onGround(b, theme);
  const flat = (rgb, x, y) => {
    const o = (y * width + x) * 3;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const q = (Math.min(height - 1, Math.max(0, y + dy)) * width + Math.min(width - 1, Math.max(0, x + dx))) * 3;
        if (rgb[q] !== rgb[o] || rgb[q + 1] !== rgb[o + 1] || rgb[q + 2] !== rgb[o + 2]) return false;
      }
    }
    return true;
  };
  const heat = new Uint8Array(width * height * 4);
  let max = 0;
  let sum = 0;
  let one = 0;
  let two = 0;
  let beyond = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 3;
      const d = Math.max(Math.abs(A[o] - B[o]), Math.abs(A[o + 1] - B[o + 1]), Math.abs(A[o + 2] - B[o + 2]));
      max = Math.max(max, d);
      sum += d;
      if (d > 0) {
        if (flat(A, x, y) && flat(B, x, y)) beyond++;
        else if (d <= 72) one++;
        else if (d <= 144) two++;
        else beyond++;
      }
      // The heat map: the reference, faint, every difference in red.
      const faint = 255 - (255 - (B[o] + B[o + 1] + B[o + 2]) / 3) * 0.25;
      heat.set(d > 0 ? [255, Math.max(0, 190 - d * 2), Math.max(0, 190 - d * 2), 255] : [faint, faint, faint, 255], ((y * width + x) * 4));
    }
  }
  return { max, mean: sum / (width * height), differ: one + two + beyond, oneSample: one, twoSamples: two, beyondAA: beyond, heat: { width, height, rgba: heat } };
}

const strip = ({ heat, ...rest }) => ({ ...rest, mean: Number(rest.mean.toFixed(4)) });
const results = { generated: new Date().toISOString(), browser: { version: browser.version(), flags: FLAGS }, stills: [], rest: [], clips: [], quiet: {} };
for (const pose of rigPoses) {
  for (const theme of THEMES) {
    const name = `${pose}${suffix(theme)}.png`;
    const render = load(join(out, "renders", name));
    const markup = load(join(out, "markup", name));
    const png = load(join(PNG_DIR, name));
    const rig = load(join(out, "rig", name));
    const vsPng = compare(render, png, theme);
    writeFileSync(join(out, "diff", name), encodePng(vsPng.heat));
    results.stills.push({
      pose,
      theme,
      file: name,
      // as a screen shows it
      vsPng: strip(vsPng),
      // the component's own SVG, drawn the way the PNGs were
      markupVsPng: strip(compare(markup, png, theme)),
      markupVsRig: strip(compare(markup, rig, theme)),
      // the rig itself, today, against its PNG
      rigVsPng: strip(compare(rig, png, theme)),
    });
  }
}
for (const r of rests) {
  const name = `${r.pose}${suffix(r.theme)}.png`;
  const render = load(join(out, "rest", name));
  const png = load(join(PNG_DIR, `${r.rig}${suffix(r.theme)}.png`));
  const still = load(join(out, "renders", `${r.rig}${suffix(r.theme)}.png`));
  results.rest.push({ ...r, file: name, vsPng: strip(compare(render, png, r.theme)), vsStill: strip(compare(render, still, r.theme)) });
}

// ---------------------------------------------------------------- 3: clips

const CLIPS = [
  ["idle", "mode=clip&clip=idle"],
  ["hello", "mode=clip&clip=hello"],
  ["flow", "mode=clip&clip=flow"],
  ["asking-error", "mode=clip&clip=asking-error"],
  ["tuck", "mode=clip&clip=tuck"],
  ["reduced-motion", "mode=demo&reduce=1"],
];
const ffmpeg = ["/opt/homebrew/bin/ffmpeg", "/usr/local/bin/ffmpeg", "/usr/bin/ffmpeg"].find(existsSync);
if (clipsWanted) {
  const raw = join(out, "clips", "raw");
  rmSync(raw, { recursive: true, force: true });
  // Headless Chrome films its window, not the emulated viewport: the window is made the size of the frame.
  const filming = await chromium.launch({ executablePath: chromePath(), args: [...FLAGS, "--window-size=800,680"] });
  for (const [name, query] of CLIPS) {
    for (const theme of THEMES) {
      const ctx = await filming.newContext({ viewport: { width: 800, height: 680 }, deviceScaleFactor: 1, recordVideo: { dir: raw, size: { width: 800, height: 680 } } });
      const started = Date.now();
      const page = await ctx.newPage();
      page.on("pageerror", (e) => errors.push(`${query}: ${e.message}`));
      await page.goto(`${base}?${query}&theme=${theme}&zoom=2`);
      await page.waitForFunction(() => window.__ready === true, null, { timeout: 15000 });
      const lead = (Date.now() - started) / 1000;
      await page.waitForFunction(() => window.__done === true, null, { timeout: 30000, polling: 100 });
      await page.waitForTimeout(400);
      const poster = join(out, "clips", `${name}-${theme}.png`);
      await page.screenshot({ path: poster });
      const video = page.video();
      await ctx.close();
      const webm = await video.path();
      const base_ = join(out, "clips", `${name}-${theme}`);
      if (ffmpeg) {
        execFileSync(ffmpeg, ["-y", "-loglevel", "error", "-ss", Math.max(0, lead - 0.05).toFixed(2), "-i", webm, "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "18", "-movflags", "+faststart", "-an", `${base_}.mp4`]);
      } else {
        renameSync(webm, `${base_}.webm`);
      }
      results.clips.push({ name, theme, video: `clips/${name}-${theme}.${ffmpeg ? "mp4" : "webm"}`, poster: `clips/${name}-${theme}.png` });
      console.log(`clip ${name} ${theme}`);
    }
  }
  await filming.close();
  rmSync(raw, { recursive: true, force: true });
  // Quiet mode: the full component with the switch on draws nothing; the words beside it stay.
  const ctx = await browser.newContext({ viewport: { width: 800, height: 680 }, deviceScaleFactor: 1 });
  for (const theme of THEMES) {
    const page = await ctx.newPage();
    await page.goto(`${base}?mode=demo&quiet=1&theme=${theme}&zoom=2`);
    await page.waitForFunction(() => window.__done === true, null, { timeout: 15000 });
    await page.screenshot({ path: join(out, "clips", `quiet-${theme}.png`) });
    results.quiet[theme] = `clips/quiet-${theme}.png`;
    await page.close();
  }
  await ctx.close();
} else if (existsSync(join(out, "results.js"))) {
  // Keep the clips of the last full run.
  const last = JSON.parse(readFileSync(join(out, "results.js"), "utf8").replace(/^window\.MASCOT_PROOF = /, "").replace(/;\s*$/, ""));
  results.clips = last.clips ?? [];
  results.quiet = last.quiet ?? {};
}
await browser.close();
server.close();

results.errors = errors;
writeFileSync(join(out, "results.js"), `window.MASCOT_PROOF = ${JSON.stringify(results, null, 1)};\n`);
const worst = (rows, key) => rows.reduce((m, r) => Math.max(m, r[key].max), 0);
const total = (rows, key, field) => rows.reduce((s, r) => s + r[key][field], 0);
console.log(`stills: ${results.stills.length}; on screen vs PNG: worst ${worst(results.stills, "vsPng")}, beyond antialiasing ${total(results.stills, "vsPng", "beyondAA")}`);
console.log(`  component SVG drawn like the PNGs: vs rig worst ${worst(results.stills, "markupVsRig")} (${total(results.stills, "markupVsRig", "differ")} pixels differ), vs PNG worst ${worst(results.stills, "markupVsPng")}`);
console.log(`  the rig itself vs its PNG: worst ${worst(results.stills, "rigVsPng")}, beyond antialiasing ${total(results.stills, "rigVsPng", "beyondAA")}`);
console.log(`rest frames: ${results.rest.length}, worst vs PNG ${worst(results.rest, "vsPng")}, worst vs still ${worst(results.rest, "vsStill")}`);
console.log(`clips: ${results.clips.length}; page errors: ${errors.length}`);
for (const e of errors.slice(0, 5)) console.log(`  ${e.split("\n")[0]}`);
