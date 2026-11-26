// Dev-only: out/index.html, a grid of every captured shot with its screen ID and name, and the approved mockup next to
// it when out/mockups holds one (copy docs/design/mockups/screens there from the design branch to compare).
import { existsSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

export function writeIndex(path, shots) {
  const mockupOf = (x) => (x.mockup && existsSync(join(dirname(path), "mockups", x.mockup)) ? `<figure><a href="mockups/${esc(x.mockup)}"><img loading="lazy" class="mock" src="mockups/${esc(x.mockup)}" alt="mockup"></a><figcaption>mockup</figcaption></figure>` : "");
  const groups = new Map();
  for (const s of shots) {
    const key = `${s.id}|${s.name}|${s.variant}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(s);
  }
  const cards = [...groups.values()]
    .map((g) => {
      const s = g[0];
      const imgs = g
        .map(
          (x) => `<figure><a href="screens/${esc(x.file)}"><img loading="lazy" src="screens/${esc(x.file)}" alt="${esc(`${x.id} ${x.name}, ${x.theme}, ${x.lang}`)}"></a><figcaption>${esc(x.theme)} / ${esc(x.lang)}${x.full ? ` · <a href="screens/${esc(x.full)}">full length</a>` : ""}${x.errors.length ? ` <span class="err" title="${esc(x.errors.join("\n\n"))}">console errors</span>` : ""}</figcaption></figure>${mockupOf(x)}`,
        )
        .join("");
      return `<section><h2><span class="id">${esc(s.id)}</span> ${esc(s.name)}</h2><p class="meta">route <code>/${esc(s.route)}</code>${s.variant ? `, state <code>${esc(s.variant)}</code>` : ""}${s.note ? `. ${esc(s.note)}` : ""}</p><div class="row">${imgs}</div></section>`;
    })
    .join("\n");
  writeFileSync(
    path,
    `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Hermit screens as built</title>
<style>
body{font:15px/1.45 -apple-system,system-ui,sans-serif;margin:0;padding:24px 32px;background:#f4f1ec;color:#222}
h1{margin:0 0 4px}p.lead{margin:0 0 24px;color:#555;max-width:900px}
section{margin:0 0 36px}h2{font-size:18px;margin:0 0 2px}.id{font-family:ui-monospace,monospace;background:#222;color:#fff;padding:1px 6px;border-radius:4px;font-size:14px}
.meta{margin:0 0 10px;color:#666;font-size:13px}.row{display:flex;gap:16px;flex-wrap:wrap}
figure{margin:0}img{width:206px;height:457px;object-fit:cover;object-position:top;border:1px solid #ccc;border-radius:12px;background:#fff;display:block}
figcaption{font-size:12px;color:#666;margin-top:4px}img.mock{border:2px dashed #8a5912}.err{color:#b4483a;cursor:help;border-bottom:1px dotted}
code{font-size:12px}
</style></head><body>
<h1>Hermit screens, as built</h1>
<p class="lead">Each picture is the real screen code from <code>apps/mobile/src/app</code> and <code>apps/mobile/src/components</code>, rendered in headless Chromium through react-native-web at 412 by 915 (a Galaxy S26-sized window, 2x), with sample data in place of the phone. Known differences from the phone: the font is the Mac's system font, not Roboto (the serif titles fall back to the Mac's serif); the header is drawn to match Android's native-stack header; native views (the web page inside HM-WEB-02) are labelled placeholders. Click a picture to open it full size; "full length" shows a scrolling screen's whole content.</p>
<p class="lead">Sample data, not a phone: a fictional user in Santiago (a kept chat, a 127.45 USD&#8366; Stable testnet wallet with five transfers and two saved payees, five vault logins, two saved web tasks, memories, WhatsApp messages, reminders, a night briefing, one MCP server and one connector). Approval sheets use the skills' own <code>describeAction</code> lines. Core screens are shot in light and dark, es-419 and English; the rest in light and dark, es-419. Regenerate with <code>cd apps/mobile/preview &amp;&amp; pnpm install --ignore-workspace &amp;&amp; node build.mjs &amp;&amp; node shoot.mjs &amp;&amp; pnpm compress</code>; the pictures stay in <code>apps/mobile/preview/out</code> and are not committed.</p>
${cards}
</body></html>
`,
  );
}
