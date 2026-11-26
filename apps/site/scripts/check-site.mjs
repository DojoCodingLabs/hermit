#!/usr/bin/env node
// The site's local gate, run after `pnpm --filter @hermit/site build`: every exported page and stylesheet passes
// lib/site-check.mjs, no JavaScript is left in out/ but the two hashed theme scripts, every page sets its theme
// before the first paint, every public page names its joinhermit.com address, the
// partners line is there or gone as lib/site-config.mjs says, every brand file is byte-identical to its source
// in docs/brand (the logo lock), and the store badges are Apple's and Google's files, unmodified.
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { BADGES } from "../lib/badges.mjs";
import { BRAND_FILES, PARTNER_FILES } from "../lib/brand.mjs";
import { CSP_META } from "../lib/csp.mjs";
import { SHOW_PARTNERS, SITE_URL } from "../lib/site-config.mjs";
import { checkCss, checkHtml, checkMeta, checkNoPartners, checkSignature } from "../lib/site-check.mjs";
import { THEME_HEAD_SCRIPT, THEME_TOGGLE_SCRIPT } from "../lib/theme.mjs";

const site = fileURLToPath(new URL("..", import.meta.url));
const out = join(site, "out");
const brandSource = join(site, "..", "..", "docs", "brand");

if (!existsSync(out)) {
  console.error("site: out/ is missing; run `pnpm --filter @hermit/site build` first");
  process.exit(1);
}

function walk(dir, acc = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, acc);
    else acc.push(p);
  }
  return acc;
}

const problems = [];
const files = walk(out);
const pages = files.filter((f) => f.endsWith(".html"));
for (const file of files) {
  const name = relative(out, file);
  if (file.endsWith(".html")) {
    const html = readFileSync(file, "utf8");
    problems.push(...checkHtml(name, html));
    if (!html.includes(`content="${CSP_META.replace(/'/g, "&#x27;")}"`) && !html.includes(`content="${CSP_META}"`)) {
      problems.push(`${name}: the content security policy <meta> is missing`);
    }
    // Every page sets its theme before the first paint; a page with the switch also runs the switch's script.
    if (!html.includes(`<script>${THEME_HEAD_SCRIPT}</script>`)) problems.push(`${name}: doesn't set its theme before the first paint`);
    if (html.includes('class="theme-toggle"') && !html.includes(`<script>${THEME_TOGGLE_SCRIPT}</script>`)) {
      problems.push(`${name}: has the theme switch without its script`);
    }
    // Every language page and the chooser credit Hermit and name their address; the 404 page does neither.
    if (!/(^|\/)(404|_not-found)(\/|\.)/.test(name)) {
      problems.push(...checkMeta(name, html, SITE_URL));
      problems.push(...(SHOW_PARTNERS ? checkSignature(name, html) : checkNoPartners(name, html)));
      // The preview image a link card shows must be a file the site serves.
      const image = /<meta\b[^>]*property="og:image"[^>]*content="([^"]+)"/.exec(html)?.[1];
      if (image?.startsWith(`${SITE_URL}/`) && !existsSync(join(out, image.slice(SITE_URL.length)))) {
        problems.push(`${name}: og:image ${image} is not in out/`);
      }
    }
  } else if (file.endsWith(".css")) {
    problems.push(...checkCss(name, readFileSync(file, "utf8")));
  } else if (/\.(m?js|txt)$/.test(file) && !name.endsWith("robots.txt")) {
    problems.push(`${name}: script or payload file left in out/`);
  }
  // The site moved to joinhermit.com; the old address must not come back in a page, the sitemap or robots.txt.
  if (/\.(html|xml|txt)$/.test(file) && readFileSync(file, "utf8").includes("hermit.dojocoding.io")) {
    problems.push(`${name}: names the old address hermit.dojocoding.io`);
  }
}

for (const lang of ["es", "en"]) {
  for (const page of ["", "privacy/", "download/"]) {
    if (!existsSync(join(out, lang, page, "index.html"))) problems.push(`${lang}/${page}index.html: missing`);
  }
}

const sitemap = existsSync(join(out, "sitemap.xml")) ? readFileSync(join(out, "sitemap.xml"), "utf8") : "";
if (!sitemap) problems.push("sitemap.xml: missing");
for (const loc of sitemap.matchAll(/<loc>([^<]*)<\/loc>/g)) {
  if (!loc[1].startsWith(`${SITE_URL}/`)) problems.push(`sitemap.xml: ${loc[1]} is not on ${SITE_URL}`);
}
const robots = existsSync(join(out, "robots.txt")) ? readFileSync(join(out, "robots.txt"), "utf8") : "";
if (!robots.includes(`Sitemap: ${SITE_URL}/sitemap.xml`)) problems.push("robots.txt: missing, or doesn't name the sitemap");

for (const file of BRAND_FILES) {
  const copy = join(out, "brand", file);
  if (!existsSync(copy)) problems.push(`brand/${file}: missing from out/`);
  else if (!readFileSync(copy).equals(readFileSync(join(brandSource, file)))) problems.push(`brand/${file}: differs from docs/brand/${file}`);
}
if (!SHOW_PARTNERS) {
  for (const file of PARTNER_FILES) if (existsSync(join(out, "brand", file))) problems.push(`brand/${file}: served with the partners line off`);
}

// The store badges: served byte for byte as downloaded, and each language's home shows its own pair only.
for (const badge of [...BADGES.en, ...BADGES.es]) {
  const copy = join(out, "badges", badge.file);
  if (!existsSync(copy)) problems.push(`badges/${badge.file}: missing from out/`);
  else if (createHash("sha256").update(readFileSync(copy)).digest("hex") !== badge.sha256) problems.push(`badges/${badge.file}: differs from the downloaded badge`);
}
for (const [lang, other] of [["en", "es"], ["es", "en"]]) {
  const home = existsSync(join(out, lang, "index.html")) ? readFileSync(join(out, lang, "index.html"), "utf8") : "";
  for (const badge of BADGES[lang]) if (!home.includes(`/badges/${badge.file}`)) problems.push(`${lang}/index.html: doesn't show ${badge.file}`);
  for (const badge of BADGES[other]) if (home.includes(`/badges/${badge.file}`)) problems.push(`${lang}/index.html: shows the ${other} badge ${badge.file}`);
}

const release = readFileSync(join(site, "lib", "release.ts"), "utf8");
if (/published:\s*true/.test(release) && /:\s*null,/.test(release)) problems.push("lib/release.ts: published with an empty field");

for (const p of problems) console.error(`site: ${p}`);
if (problems.length) process.exit(1);
console.log(
  `site: ${pages.length} pages and their styles load nothing from elsewhere, run only the two hashed theme scripts and have alt text; ` +
    `every public page names its ${SITE_URL} address; the partners line is ${SHOW_PARTNERS ? "on" : "off"}`,
);
