// The site's local gate: pure checks over the exported HTML and CSS, used by scripts/check-site.mjs on
// out/ and by test/site-check.test.ts on fixtures. A problem is a string naming the file and what is wrong.
import { createHash } from "node:crypto";
import { SCRIPT_HASHES } from "./csp.mjs";

export const SIGNATURE_LINE =
  "Hermit, built by Dojo Coding (dojocoding.io). Powered by QVAC (qvac.tether.io) from Tether (tether.io).";
export const SIGNATURE_DISCLAIMER = "Hermit is an independent project, not affiliated with or endorsed by Tether.";

/** An inline script's hash, as the browser computes it for the content security policy. */
export const scriptHash = (text) => `sha256-${createHash("sha256").update(text, "utf8").digest("base64")}`;

const SCRIPT = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
const allowedInline = (attrs, body, allowed) => !/\ssrc\s*=/i.test(attrs) && allowed.includes(scriptHash(body));

/** Removes every script and script preload from a page, except the inline scripts the policy allows by hash. */
export function stripScripts(html, allowed = SCRIPT_HASHES) {
  return html
    .replace(SCRIPT, (all, attrs, body) => (allowedInline(attrs, body, allowed) ? all : ""))
    .replace(/<link\b[^>]*\bas="script"[^>]*\/?>/gi, "")
    .replace(/<link\b[^>]*\brel="modulepreload"[^>]*\/?>/gi, "");
}

const attr = (tag, name) => {
  const m = new RegExp(`\\s${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, "i").exec(tag);
  return m ? (m[2] ?? m[3] ?? m[4] ?? "") : undefined;
};

/** True for a URL that leaves the site: a scheme or a protocol-relative address. Data URLs are refused too. */
export const isExternal = (url) => /^\s*([a-z][a-z0-9+.-]*:|\/\/)/i.test(url);

const decode = (s) =>
  s
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&");

/** The visible text of a page: tags and comments removed, entities decoded, whitespace collapsed. */
export function textOf(html) {
  return decode(
    html
      .replace(/<!--[\s\S]*?-->/g, "")
      .replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, "")
      .replace(/<[^>]+>/g, ""),
  )
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * One exported page. Refuses: a script file or an inline script the policy doesn't allow by hash, an inline style
 * or style element (the CSP allows neither), frames and embeds, forms, a meta refresh, external URLs in anything the
 * page loads (images, sources, stylesheets, icons, preloads), images without alt text, a missing `lang`, em or en
 * dashes, and a missing signature.
 */
export function checkHtml(name, html, allowed = SCRIPT_HASHES) {
  const problems = [];
  const bad = (msg) => problems.push(`${name}: ${msg}`);

  const scripts = [...html.matchAll(SCRIPT)];
  if (scripts.length !== (html.match(/<script\b/gi) ?? []).length) bad("has a malformed <script> element");
  for (const [, attrs, body] of scripts) {
    if (/\ssrc\s*=/i.test(attrs)) bad("loads a script file");
    else if (!allowed.includes(scriptHash(body))) bad("has an inline script the content security policy doesn't allow");
  }
  if (/<style\b/i.test(html)) bad("has a <style> element");
  if (/<[a-z][^>]*\sstyle\s*=/i.test(html)) bad("has an inline style attribute");
  if (/<[a-z][^>]*\son[a-z]+\s*=/i.test(html)) bad("has an inline event handler");
  if (/<(iframe|object|embed|frame)\b/i.test(html)) bad("embeds another page or plugin");
  if (/<form\b/i.test(html)) bad("has a form");
  if (/<meta[^>]+http-equiv\s*=\s*["']?refresh/i.test(html)) bad("has a meta refresh");

  const html0 = /<html\b[^>]*>/i.exec(html)?.[0];
  if (!html0 || !attr(html0, "lang")) bad("<html> has no lang");

  for (const tag of html.match(/<(img|source|video|audio|track|input)\b[^>]*>/gi) ?? []) {
    for (const a of ["src", "srcset", "poster"]) {
      const v = attr(tag, a);
      if (v === undefined) continue;
      for (const url of v.split(",").map((s) => s.trim().split(/\s+/)[0])) {
        if (url && isExternal(url)) bad(`loads an external resource: ${url}`);
      }
    }
  }
  for (const tag of html.match(/<link\b[^>]*>/gi) ?? []) {
    const rel = (attr(tag, "rel") ?? "").toLowerCase();
    const url = attr(tag, "href") ?? "";
    // Links that the browser fetches; `alternate` and `canonical` only name another address.
    if (rel !== "alternate" && rel !== "canonical" && isExternal(url)) bad(`loads an external resource: ${url} (rel=${rel})`);
  }

  for (const tag of html.match(/<img\b[^>]*>/gi) ?? []) {
    const alt = attr(tag, "alt");
    if (alt === undefined || alt.trim() === "") bad(`image without alt text: ${attr(tag, "src") ?? tag}`);
  }

  const text = textOf(html);
  if (/[–—]/.test(text)) bad("uses an em or en dash");
  if (/<main\b/i.test(html) && !/<h1\b/i.test(html)) bad("has no <h1>");
  if (!html.includes('id="main"') && /href="#main"/.test(html)) bad("skip link target #main is missing");
  return problems;
}

/** Pages that credit Hermit carry the signature verbatim, with the not-affiliated line. */
export function checkSignature(name, html) {
  const text = textOf(html);
  const problems = [];
  if (!text.includes(SIGNATURE_LINE)) problems.push(`${name}: the signature is missing or not verbatim`);
  if (!text.includes(SIGNATURE_DISCLAIMER)) problems.push(`${name}: the not-affiliated line is missing`);
  return problems;
}

/** With the partners line off (SHOW_PARTNERS), no page may still show the QVAC or Tether logos or the signature. */
export function checkNoPartners(name, html) {
  const problems = [];
  if (/Powered by QVAC/i.test(textOf(html))) problems.push(`${name}: still says "Powered by QVAC" with the partners line off`);
  for (const tag of html.match(/<(img|source)\b[^>]*>/gi) ?? []) {
    const src = attr(tag, "src") ?? attr(tag, "srcset") ?? "";
    if (/\/brand\/partners\/(qvac|tether)/i.test(src)) problems.push(`${name}: still shows a partner logo: ${src}`);
  }
  return problems;
}

const metaContent = (html, property) => {
  const tag = (html.match(/<meta\b[^>]*>/gi) ?? []).find((t) => attr(t, "property") === property || attr(t, "name") === property);
  return tag === undefined ? undefined : attr(tag, "content");
};

/**
 * A public page names its address on the site's domain: an absolute canonical URL, hreflang alternates, and the
 * Open Graph URL and image that link previews use.
 */
export function checkMeta(name, html, siteUrl) {
  const problems = [];
  const on = (url) => typeof url === "string" && (url === siteUrl || url.startsWith(`${siteUrl}/`));
  const links = html.match(/<link\b[^>]*>/gi) ?? [];
  const canonical = links.find((t) => (attr(t, "rel") ?? "").toLowerCase() === "canonical");
  if (!canonical) problems.push(`${name}: no canonical URL`);
  else if (!on(attr(canonical, "href"))) problems.push(`${name}: the canonical URL is not on ${siteUrl}: ${attr(canonical, "href")}`);
  const alternates = links.filter((t) => (attr(t, "rel") ?? "").toLowerCase() === "alternate" && attr(t, "hreflang"));
  if (alternates.length < 2) problems.push(`${name}: fewer than two hreflang alternates`);
  for (const t of alternates) if (!on(attr(t, "href"))) problems.push(`${name}: an hreflang alternate is not on ${siteUrl}: ${attr(t, "href")}`);
  for (const property of ["og:url", "og:image"]) {
    const value = metaContent(html, property);
    if (!value) problems.push(`${name}: no ${property}`);
    else if (!on(value)) problems.push(`${name}: ${property} is not on ${siteUrl}: ${value}`);
  }
  for (const property of ["og:title", "og:description", "twitter:card"]) {
    if (!metaContent(html, property)) problems.push(`${name}: no ${property}`);
  }
  return problems;
}

/** One stylesheet: no external url(), no @import from elsewhere. */
export function checkCss(name, css) {
  const problems = [];
  const stripped = css.replace(/\/\*[\s\S]*?\*\//g, "");
  for (const m of stripped.matchAll(/url\(\s*(['"]?)([^'")]+)\1\s*\)/gi)) {
    if (isExternal(m[2])) problems.push(`${name}: loads an external resource: ${m[2]}`);
  }
  for (const m of stripped.matchAll(/@import\s+(?:url\()?\s*['"]?([^'");\s]+)/gi)) {
    if (isExternal(m[1])) problems.push(`${name}: imports an external stylesheet: ${m[1]}`);
  }
  return problems;
}
