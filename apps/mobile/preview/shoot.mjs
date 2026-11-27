// Dev-only: serves dist/ and captures every shot in shots.mjs with headless Chromium at a 412x915 phone viewport,
// into out/screens, then writes out/index.html (both gitignored). Usage: node shoot.mjs [filter]
import { createServer } from "node:http";
import { readFileSync, writeFileSync, mkdirSync, existsSync, statSync } from "node:fs";
import { dirname, extname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { chromiumPath } from "./browser.mjs";
import { shots } from "./shots.mjs";
import { audit, words } from "./audit.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const dist = join(here, "dist");
const outDir = join(here, "out/screens");
mkdirSync(outDir, { recursive: true });

const types = { ".html": "text/html", ".js": "text/javascript", ".png": "image/png", ".json": "application/json", ".ttf": "font/ttf" };
const server = createServer((req, res) => {
  // Only files inside dist are served: a request for ../ anything gets index.html (security review).
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

const filter = process.argv[2];
const browser = await chromium.launch({ executablePath: chromiumPath() });
const results = [];
for (const shot of shots) {
  for (const theme of shot.themes) {
    for (const lang of shot.langs) {
      const file = `${shot.file}-${theme}-${lang}.png`;
      if (filter && !file.includes(filter)) continue;
      const ctx = await browser.newContext({ viewport: { width: 412, height: 915 }, deviceScaleFactor: 2, locale: lang, colorScheme: theme });
      const page = await ctx.newPage();
      const consoleErrors = [];
      // React DOM's nesting warnings (a Pressable inside a Pressable becomes <button> in <button>) are web-only.
      page.on("console", (m) => m.type() === "error" && !/cannot be a descendant of|cannot contain a nested/.test(m.text()) && consoleErrors.push(m.text()));
      page.on("pageerror", (e) => consoleErrors.push(String(e.stack ?? e)));
      const q = new URLSearchParams({ screen: shot.route, theme, lang, variant: shot.variant ?? "", params: JSON.stringify(typeof shot.params === "function" ? shot.params(lang) : shot.params ?? {}), fontScale: String(shot.fontScale ?? 1) });
      await page.goto(`${base}?${q}`);
      await page.waitForTimeout(shot.wait ?? 900);
      // The brand faces have loaded before anything is captured (font-display: block, then this wait).
      await page.evaluate(() => document.fonts.ready);
      if (shot.act) await shot.act(page).catch((e) => consoleErrors.push(`act: ${e.message}`));
      await page.screenshot({ path: join(outDir, file) });
      // Contrast measured on this very picture, touch targets, and the words on screen (docs/design/polish).
      const checks = await audit(page).catch((e) => ({ error: String(e) }));
      const text = await words(page).catch(() => []);
      // A screen that scrolls also gets a full-length picture: the window is made as tall as its content.
      const hidden = await page.evaluate(() => Math.max(0, ...[...document.querySelectorAll("#root *")].map((el) => {
        const o = getComputedStyle(el).overflowY;
        return o === "auto" || o === "scroll" ? el.scrollHeight - el.clientHeight : 0;
      })));
      let full = "";
      if (hidden > 40) {
        full = file.replace(/\.png$/, "-full.png");
        await page.setViewportSize({ width: 412, height: Math.min(915 + hidden, 6000) });
        await page.waitForTimeout(400);
        await page.screenshot({ path: join(outDir, full) });
      }
      const errors = [...(await page.evaluate(() => window.__errors ?? [])), ...consoleErrors];
      results.push({ file, full, id: shot.id, name: shot.name, route: shot.route, variant: shot.variant ?? "", theme, lang, fontScale: shot.fontScale ?? 1, note: shot.note ?? "", mockup: shot.mockup ? `${shot.mockup}-${theme}-${lang}.png` : "", errors, audit: checks, words: text });
      const slips = checks.slips ?? [];
      const fails = checks.error ? `audit error ${checks.error.slice(0, 80)}` : `${checks.text.length} contrast, ${checks.icons.length} icons, ${checks.targets.length} targets, ${slips.length} slips${slips.length ? ` (${slips.map((x) => `${x.kind}: ${x.text}`).join("; ").slice(0, 200)})` : ""}`;
      console.log(`${errors.length || checks.error || checks.text.length || checks.icons.length || checks.targets.length || slips.length ? "!" : " "} ${file}  ${fails}${errors.length ? `  ${errors[0].split("\n")[0].slice(0, 160)}` : ""}`);
      await ctx.close();
    }
  }
}
await browser.close();
server.close();

// Merge with earlier runs (a filtered run only replaces its own shots).
const manifestPath = join(outDir, "manifest.json");
const old = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, "utf8")) : [];
const byFile = new Map(old.map((r) => [r.file, r]));
for (const r of results) byFile.set(r.file, r);
const order = new Map();
shots.forEach((s, i) => order.set(s.file, i));
const all = [...byFile.values()].filter((r) => order.has(r.file.replace(/-(light|dark)-(en|es-419)\.png$/, ""))).sort(
  (a, b) => order.get(a.file.replace(/-(light|dark)-(en|es-419)\.png$/, "")) - order.get(b.file.replace(/-(light|dark)-(en|es-419)\.png$/, "")) || a.file.localeCompare(b.file),
);
writeFileSync(manifestPath, `${JSON.stringify(all, null, 2)}\n`);
const { writeIndex } = await import("./gallery.mjs");
writeIndex(join(here, "out/index.html"), all);
console.log(`${results.length} shots, ${results.filter((r) => r.errors.length).length} with errors`);
