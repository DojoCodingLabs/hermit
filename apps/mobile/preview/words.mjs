// Dev-only: the words on the polish round's hero states (docs/design/polish), read from the rendered screens of a
// preview bundle, for the copy diet's before and after. Usage: node words.mjs <dist dir> <out.json>
// (build the bundle of the commit to compare with its own build.mjs first).
import { createServer } from "node:http";
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { extname, join, resolve, sep } from "node:path";
import { chromium } from "playwright-core";
import { words } from "./audit.mjs";

const [distArg, outArg] = process.argv.slice(2);
if (!distArg || !outArg) throw new Error("usage: node words.mjs <dist dir> <out.json>");
const dist = resolve(distArg);
const types = { ".html": "text/html", ".js": "text/javascript", ".png": "image/png", ".ttf": "font/ttf" };
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
const cache = join(process.env.HOME, "Library/Caches/ms-playwright");
const shell = readdirSync(cache).filter((d) => d.startsWith("chromium_headless_shell-")).sort().pop();

/** The hero states, as in shots.mjs. */
export const HERO = [
  { key: "chat-empty", screen: "index", variant: "empty" },
  { key: "chat", screen: "index", variant: "" },
  { key: "chat-working", screen: "index", variant: "working", params: { say: "¿Hasta qué hora abre la farmacia de Irarrázaval?" }, wait: 4200 },
  { key: "pay-sheet", screen: "index", variant: "pay" },
  { key: "wallet", screen: "wallet", variant: "" },
  { key: "welcome", screen: "welcome", variant: "" },
];

const browser = await chromium.launch({ executablePath: join(cache, shell, "chrome-headless-shell-mac-arm64", "chrome-headless-shell") });
const out = {};
for (const h of HERO) {
  const ctx = await browser.newContext({ viewport: { width: 412, height: 915 }, deviceScaleFactor: 1, locale: "es-419" });
  const page = await ctx.newPage();
  await page.goto(`${base}?${new URLSearchParams({ screen: h.screen, theme: "light", lang: "es-419", variant: h.variant, params: JSON.stringify(h.params ?? {}) })}`);
  await page.waitForTimeout(h.wait ?? 1200);
  // With a sheet open, only the sheet's words count (the chat behind it is the same chat as on its own state).
  const all = await page.evaluate(() => !!document.querySelector('[aria-modal="true"]'));
  const runs = all ? await page.evaluate(() => {
    const modal = [...document.querySelectorAll('[aria-modal="true"]')].pop();
    const out = [];
    for (const el of modal.querySelectorAll("*")) {
      if (el.closest('[aria-hidden="true"]')) continue;
      for (const n of el.childNodes) if (n.nodeType === 3 && n.textContent.trim()) out.push(n.textContent.trim());
    }
    return out;
  }) : await words(page);
  out[h.key] = { runs, words: runs.join(" ").split(/\s+/).filter(Boolean).length };
  console.log(`${h.key}: ${out[h.key].words} words`);
  await ctx.close();
}
await browser.close();
server.close();
writeFileSync(outArg, `${JSON.stringify(out, null, 2)}\n`);
