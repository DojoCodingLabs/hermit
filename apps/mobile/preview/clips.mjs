// Dev-only: records the motion of the polish round (docs/design/polish) as short videos, with Playwright's video
// recording in headless Chromium, then converts them to H.264 mp4 with ffmpeg when it is installed. Each clip loads one
// screen of the real app (the same bundle shoot.mjs captures) and does what a person would do. The crab's own motion
// (idle, blink, the hello wave) is the mascot's and is proven in mascot/proof.mjs; empty-chat records it on this
// round's stage, as the app shows it. Usage: node clips.mjs [filter]
import { createServer } from "node:http";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync } from "node:fs";
import { dirname, extname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const here = dirname(fileURLToPath(import.meta.url));
const dist = join(here, "dist");
const repo = resolve(here, "../../..");
const outDir = join(repo, "docs/design/polish/clips");
mkdirSync(outDir, { recursive: true });

const types = { ".html": "text/html", ".js": "text/javascript", ".png": "image/png", ".json": "application/json", ".ttf": "font/ttf" };
const server = createServer((req, res) => {
  // Only files inside dist are served (the same rule as shoot.mjs).
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

function chromiumPath() {
  const cache = join(process.env.HOME, "Library/Caches/ms-playwright");
  const shell = readdirSync(cache).filter((d) => d.startsWith("chromium_headless_shell-")).sort().pop();
  return join(cache, shell, "chrome-headless-shell-mac-arm64", "chrome-headless-shell");
}

const url = (screen, { theme = "light", lang = "es-419", variant = "", params = {} } = {}) =>
  `${base}?${new URLSearchParams({ screen, theme, lang, variant, params: JSON.stringify(params) })}`;

/** Presses and holds the element with this accessible label, so the press state is on screen for a moment. */
async function hold(page, label, ms = 260) {
  const box = await page.getByLabel(label).first().boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(ms);
  await page.mouse.up();
}

const clips = [
  {
    name: "empty-chat",
    what: "The empty chat: the animated crab (breathing, blinking, its hello) on the stage's soft radial fade",
    run: async (page) => {
      await page.goto(url("index", { variant: "empty" }));
      await page.waitForTimeout(5200);
    },
  },
  {
    name: "sheet-opening",
    what: "The payment sheet rising on its spring over the fading backdrop",
    run: async (page) => {
      await page.goto(url("index", { variant: "pay" }));
      await page.waitForTimeout(1600);
    },
  },
  {
    name: "button-press",
    what: "The wallet's first blocks rising in, then the primary button sinking on press",
    run: async (page) => {
      await page.goto(url("wallet"));
      await page.waitForTimeout(1300);
      await hold(page, /^(Recibir|Receive)$/, 320);
      await page.waitForTimeout(500);
      await hold(page, /^(Límites y destinatarios|Spending caps and payees)$/, 320);
      await page.waitForTimeout(700);
    },
  },
  {
    name: "new-message",
    what: "A sent message rising in, the status crossfading through the steps, and the answer arriving",
    run: async (page) => {
      await page.goto(url("index", { variant: "reply", params: { say: "¿Hasta qué hora abre la farmacia de Irarrázaval?" } }));
      await page.waitForTimeout(3200);
    },
  },
  {
    name: "steps-folding",
    what: "A finished turn's steps unfolding and folding again",
    run: async (page) => {
      await page.goto(url("index", { variant: "reply", params: { say: "¿Hasta qué hora abre la farmacia de Irarrázaval?" } }));
      await page.waitForTimeout(2600);
      const fold = page.getByRole("button", { name: /^(Trabajó|Worked for)/ }).first();
      await fold.click();
      await page.waitForTimeout(900);
      await fold.click();
      await page.waitForTimeout(700);
    },
  },
  {
    name: "segmented",
    what: "The segmented control's thumb sliding between choices",
    run: async (page) => {
      await page.goto(url("appearance"));
      await page.waitForTimeout(900);
      await page.mouse.wheel(0, 500);
      await page.waitForTimeout(500);
      for (const name of [/^(Oscuro|Dark)$/, /^(Claro|Light)$/, /^(Sistema|System)$/]) {
        const r = page.getByRole("radio", { name }).first();
        if (await r.count()) {
          await r.click();
          await page.waitForTimeout(600);
        }
      }
    },
  },
];

const filter = process.argv[2];
const browser = await chromium.launch({ executablePath: chromiumPath() });
const ffmpeg = ["/opt/homebrew/bin/ffmpeg", "/usr/local/bin/ffmpeg", "/usr/bin/ffmpeg"].find((p) => existsSync(p));
for (const clip of clips) {
  if (filter && !clip.name.includes(filter)) continue;
  const tmp = join(outDir, `.${clip.name}`);
  rmSync(tmp, { recursive: true, force: true });
  // Playwright records the viewport at its CSS size (it scales a recording down, never up), so the clip is 412 by 915.
  const ctx = await browser.newContext({ viewport: { width: 412, height: 915 }, deviceScaleFactor: 2, locale: "es-419", recordVideo: { dir: tmp, size: { width: 412, height: 915 } } });
  const page = await ctx.newPage();
  await clip.run(page).catch((e) => console.log(`! ${clip.name}: ${e.message.split("\n")[0]}`));
  await ctx.close();
  const webm = readdirSync(tmp).find((f) => f.endsWith(".webm"));
  const out = join(outDir, `${clip.name}.webm`);
  renameSync(join(tmp, webm), out);
  rmSync(tmp, { recursive: true, force: true });
  if (ffmpeg) {
    execFileSync(ffmpeg, ["-y", "-loglevel", "error", "-i", out, "-c:v", "libx264", "-pix_fmt", "yuv420p", "-movflags", "+faststart", "-crf", "24", join(outDir, `${clip.name}.mp4`)]);
    rmSync(out);
  }
  console.log(`  ${clip.name}${ffmpeg ? ".mp4" : ".webm"}  ${clip.what}`);
}
await browser.close();
server.close();
