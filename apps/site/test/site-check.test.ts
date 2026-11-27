import { describe, expect, test } from "vitest";
import { SIGNATURE_DISCLAIMER, SIGNATURE_LINE, checkCss, checkHtml, checkMeta, checkNoPartners, checkSignature, stripScripts } from "../lib/site-check.mjs";
import { THEME_HEAD_SCRIPT, THEME_TOGGLE_SCRIPT } from "../lib/theme.mjs";

const page = (body: string, head = "") =>
  `<!DOCTYPE html><html lang="en"><head><link rel="stylesheet" href="/_next/static/chunks/a.css"/>${head}</head><body><main id="main"><h1>Hermit</h1>${body}</main></body></html>`;

describe("checkHtml", () => {
  test("a clean page passes", () => {
    expect(checkHtml("ok.html", page('<img src="/brand/a.svg" alt="Hermit"/><a href="https://tether.io/">Tether</a>'))).toEqual([]);
  });

  test("refuses script files and inline scripts the policy doesn't allow, and inline handlers", () => {
    expect(checkHtml("a", page('<script src="https://cdn.example.com/x.js"></script>'))).toContain("a: loads a script file");
    expect(checkHtml("a", page('<script src="/theme.js"></script>'))).toContain("a: loads a script file");
    expect(checkHtml("a", page("<script>track()</script>"))).toContain("a: has an inline script the content security policy doesn't allow");
    expect(checkHtml("a", page(`<script>${THEME_TOGGLE_SCRIPT} </script>`))).toHaveLength(1);
    expect(checkHtml("a", page('<a href="/" onclick="x()">x</a>'))).toContain("a: has an inline event handler");
  });

  test("allows the two theme scripts, by their exact hash", () => {
    expect(checkHtml("a", page(`<script>${THEME_TOGGLE_SCRIPT}</script>`, `<script>${THEME_HEAD_SCRIPT}</script>`))).toEqual([]);
  });

  test("refuses an external stylesheet, font or preload", () => {
    expect(checkHtml("a", page("", '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter"/>'))).toEqual([
      "a: loads an external resource: https://fonts.googleapis.com/css2?family=Inter (rel=stylesheet)",
    ]);
    expect(checkHtml("a", page("", '<link rel="preload" as="font" href="//fonts.gstatic.com/x.woff2"/>'))).toHaveLength(1);
  });

  test("allows hreflang alternates and plain links to other sites", () => {
    expect(checkHtml("a", page('<a href="https://github.com/">code</a>', '<link rel="alternate" hrefLang="es-419" href="https://hermit.example/es/"/>'))).toEqual([]);
  });

  test("refuses external images, including srcset and data URLs", () => {
    expect(checkHtml("a", page('<img src="https://example.com/p.gif" alt="x"/>'))).toHaveLength(1);
    expect(checkHtml("a", page('<picture><source srcSet="/a.svg 1x, https://x.example/b.svg 2x"/><img src="/a.svg" alt="x"/></picture>'))).toHaveLength(1);
    expect(checkHtml("a", page('<img src="data:image/gif;base64,R0lGOD" alt="x"/>'))).toHaveLength(1);
  });

  test("refuses images without alt text", () => {
    expect(checkHtml("a", page('<img src="/brand/a.svg"/>'))).toEqual(["a: image without alt text: /brand/a.svg"]);
    expect(checkHtml("a", page('<img src="/brand/a.svg" alt=""/>'))).toEqual(["a: image without alt text: /brand/a.svg"]);
  });

  test("refuses inline styles, frames, forms, a missing lang and dashes", () => {
    expect(checkHtml("a", page('<p style="color:red">x</p>'))).toContain("a: has an inline style attribute");
    expect(checkHtml("a", page("<style>p{}</style>"))).toContain("a: has a <style> element");
    expect(checkHtml("a", page('<iframe src="/x"></iframe>'))).toContain("a: embeds another page or plugin");
    expect(checkHtml("a", page('<form action="/x"></form>'))).toContain("a: has a form");
    expect(checkHtml("a", "<html><body><main id=\"main\"><h1>x</h1></main></body></html>")).toContain("a: <html> has no lang");
    expect(checkHtml("a", page("<p>Private — always</p>"))).toContain("a: uses an em or en dash");
  });
});

describe("checkCss", () => {
  test("refuses external fonts and imports, allows the site's own files", () => {
    expect(checkCss("a.css", "@font-face{src:url(Newsreader.woff2) format('woff2')}")).toEqual([]);
    expect(checkCss("a.css", "@font-face{src:url('https://fonts.gstatic.com/x.woff2')}")).toHaveLength(1);
    expect(checkCss("a.css", '@import url("https://fonts.googleapis.com/css2?family=Inter");')).toHaveLength(2);
    expect(checkCss("a.css", "/* url(https://x.example/a.png) */ body{}")).toEqual([]);
  });
});

describe("checkSignature (AGENTS.md rule 8)", () => {
  test("needs the line verbatim and the not-affiliated line", () => {
    const linked =
      'Hermit, built by Dojo Coding (<a href="https://dojocoding.io">dojocoding.io</a>). Powered by QVAC (<a href="https://qvac.tether.io/">qvac.tether.io</a>) from Tether (<a href="https://tether.io/">tether.io</a>).';
    expect(checkSignature("a", page(`<p>${linked}</p><p>${SIGNATURE_DISCLAIMER}</p>`))).toEqual([]);
    expect(checkSignature("a", page(`<p>${SIGNATURE_LINE.replace("from", "by")}</p>`))).toHaveLength(2);
  });
});

describe("checkNoPartners (the partners line switched off)", () => {
  test("passes a page with no partner logos and no signature", () => {
    expect(checkNoPartners("a", page("<p>Hermit is open source.</p>"))).toEqual([]);
  });

  test("refuses the signature and the QVAC or Tether logos", () => {
    expect(checkNoPartners("a", page(`<p>${SIGNATURE_LINE}</p>`))).toHaveLength(1);
    const logos = '<picture><source srcSet="/brand/partners/tether-logo.svg"/><img src="/brand/partners/tether-logo-ink.svg" alt="Tether"/></picture>';
    expect(checkNoPartners("a", page(logos))).toHaveLength(2);
  });
});

describe("checkMeta (joinhermit.com)", () => {
  const site = "https://joinhermit.com";
  const head = (url: string, image = `${site}/brand/applications/og-v2.png`) =>
    `<link rel="canonical" href="${url}"/><link rel="alternate" hrefLang="es-419" href="${site}/es/"/>` +
    `<link rel="alternate" hrefLang="en" href="${site}/en/"/><meta property="og:title" content="Hermit"/>` +
    `<meta property="og:description" content="x"/><meta property="og:url" content="${url}"/>` +
    `<meta property="og:image" content="${image}"/><meta name="twitter:card" content="summary_large_image"/>`;

  test("passes a page whose addresses are all on the site", () => {
    expect(checkMeta("a", page("", head(`${site}/en/`)), site)).toEqual([]);
  });

  test("refuses another domain, a relative canonical and a missing preview", () => {
    expect(checkMeta("a", page("", head("https://hermit.dojocoding.io/en/")), site)).toHaveLength(2);
    expect(checkMeta("a", page("", head("/en/")), site)).toHaveLength(2);
    expect(checkMeta("a", page("", head(`${site}/en/`, "")), site)).toEqual(["a: no og:image"]);
    expect(checkMeta("a", page(""), site)).toHaveLength(7);
  });
});

describe("stripScripts", () => {
  test("removes Next's scripts and script preloads, keeps stylesheets", () => {
    const html = page(
      "<script>self.__next_f.push([1])</script>",
      '<link rel="preload" as="script" href="/_next/a.js"/><script src="/_next/b.js" async=""></script>',
    );
    const out = stripScripts(html);
    expect(out).not.toMatch(/<script|as="script"/);
    expect(out).toContain('rel="stylesheet"');
    expect(checkHtml("a", out)).toEqual([]);
  });

  test("keeps the theme scripts the policy allows, and only those", () => {
    const html = page(`<script>${THEME_TOGGLE_SCRIPT}</script><script>self.__next_f.push([1])</script>`, `<script>${THEME_HEAD_SCRIPT}</script>`);
    const out = stripScripts(html);
    expect(out).toContain(`<script>${THEME_HEAD_SCRIPT}</script>`);
    expect(out).toContain(`<script>${THEME_TOGGLE_SCRIPT}</script>`);
    expect(out).not.toContain("__next_f");
    expect(checkHtml("a", out)).toEqual([]);
  });
});
