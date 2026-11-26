// Dev-only: the polish round's evidence page, docs/design/polish/index.html (committed). It shows the pictures in
// docs/design/polish/shots and the clips in docs/design/polish/clips, which stay on the machine (gitignored), like the
// design benchmark's references. Run after shoot.mjs and clips.mjs:
//   node polish-gallery.mjs        copies out/screens to shots/after and writes the page
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const polish = resolve(here, "../../../docs/design/polish");
const shots = join(polish, "shots");
const after = join(shots, "after");
mkdirSync(after, { recursive: true });
for (const f of readdirSync(join(here, "out/screens"))) copyFileSync(join(here, "out/screens", f), join(after, f));

const read = (p, fallback) => (existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) : fallback);
const afterManifest = read(join(after, "manifest.json"), []);
const beforeManifest = read(join(shots, "before/manifest.json"), []);
const wordsBefore = read(join(shots, "before/words.json"), {});
const wordsAfter = read(join(shots, "after/words.json"), {});
const notes = read(join(polish, "iterations.json"), {});
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const has = (rel) => existsSync(join(polish, rel));
const img = (rel, alt, cls = "") => (has(rel) ? `<a href="${esc(rel)}"><img loading="lazy" class="${cls}" src="${esc(rel)}" alt="${esc(alt)}"></a>` : `<div class="missing">${esc(rel)}<br>not on this machine</div>`);
const fig = (rel, cap, cls) => `<figure>${img(rel, cap, cls)}<figcaption>${esc(cap)}</figcaption></figure>`;

// The hero states: before, after in both themes, English, and 200% text.
const HERO = [
  { key: "chat-empty", title: "Chat, first run", file: "index-empty", x2: "index-empty-x2" },
  { key: "chat", title: "Chat, a conversation", file: "index", x2: "index-x2" },
  { key: "chat-working", title: "Chat, Hermit working", file: "index-working" },
  { key: "pay-sheet", title: "Payment approval sheet", file: "index-pay", x2: "index-pay-x2" },
  { key: "wallet", title: "Wallet home", file: "wallet", x2: "wallet-x2" },
  { key: "welcome", title: "Onboarding welcome", file: "welcome", x2: "welcome-x2" },
];
const wordsLine = (k) => (wordsBefore[k] && wordsAfter[k] ? `<p class="meta">Words on screen: <b>${wordsBefore[k].words}</b> before, <b>${wordsAfter[k].words}</b> after (${Math.round((1 - wordsAfter[k].words / wordsBefore[k].words) * 100)}% fewer).</p>` : "");
const hero = HERO.map((h) => {
  const iters = (notes[h.key] ?? []).map((it) => `<div class="iter"><h4>${esc(it.title)}</h4>${has(`shots/compare/${it.image}`) ? img(`shots/compare/${it.image}`, it.title, "wide") : ""}<ul>${it.notes.map((n) => `<li>${esc(n)}</li>`).join("")}</ul></div>`).join("");
  return `<section><h2>${esc(h.title)}</h2>${wordsLine(h.key)}<div class="row">
${fig(`shots/before/${h.file}-light-es-419.png`, "before, light", "before")}
${fig(`shots/after/${h.file}-light-es-419.png`, "after, light")}
${fig(`shots/after/${h.file}-dark-es-419.png`, "after, Deep sea")}
${fig(`shots/after/${h.file}-light-en.png`, "after, English")}
${h.x2 ? fig(`shots/after/${h.x2}-light-es-419.png`, "after, 200% text") : ""}
</div>${iters ? `<h3>Next to the references, round by round</h3>${iters}` : ""}</section>`;
}).join("\n");

// Phase 2: every other screen, by family, each next to its references for two rounds or more.
const FAMILIES = [
  { key: "lists", title: "Lists", files: ["activity", "memories", "messages", "reminders", "vault", "wallet-history", "browser", "mcp"], x2: "activity-x2" },
  { key: "settings", title: "Settings", files: ["settings", "use", "privacy", "appearance", "sign-in-options", "night", "profile", "connect"], x2: "settings-x2" },
  { key: "details", title: "Detail screens", files: ["activity-entry", "memory", "vault-item", "web", "wallet-receive", "wallet-caps", "browser-plan", "approval-key"], x2: "activity-entry-x2" },
  { key: "sheets", title: "Sheets", files: ["index-credential", "index-merchant", "index-message", "index-menu", "wallet-info", "index-credential-info"], x2: "index-credential-x2" },
  { key: "empty", title: "Empty states", files: ["memories-empty", "messages-forbidden", "vault-vault_locked", "vault-none", "reminders-empty", "calendar-forbidden", "briefing-empty", "browser-empty"], x2: "memories-empty-x2" },
];
const families = FAMILIES.map((f) => {
  const iters = (notes[f.key] ?? []).map((it) => `<div class="iter"><h4>${esc(it.title)}</h4>${has(`shots/compare/${it.image}`) ? img(`shots/compare/${it.image}`, it.title, "wide") : ""}<ul>${it.notes.map((n) => `<li>${esc(n)}</li>`).join("")}</ul></div>`).join("");
  const shots = f.files.map((file) => fig(`shots/after/${file}-light-es-419.png`, file, "small")).join("");
  return `<section><h2>${esc(f.title)}</h2><div class="row">${shots}${fig(`shots/after/${f.x2}-light-es-419.png`, `${f.x2.replace(/-x2$/, "")}, 200% text`, "small")}</div>${iters ? `<h3>Next to the references, round by round</h3>${iters}` : `<p class="meta">No rounds written yet.</p>`}</section>`;
}).join("\n");

// Motion.
const CLIPS = [
  ["empty-chat", "The empty chat: the animated crab breathing, blinking and waving hello on the stage's radial fade"],
  ["sheet-opening", "The payment sheet rising on its spring over the fading backdrop"],
  ["button-press", "The wallet's first blocks rising in; the primary and the tonal button sinking on press"],
  ["new-message", "A sent message rising in, the status crossfading through the steps, the answer arriving"],
  ["steps-folding", "A finished turn's steps unfolding and folding"],
  ["segmented", "The segmented control's thumb sliding between choices"],
];
const clips = CLIPS.map(([name, what]) => {
  const rel = ["mp4", "webm"].map((e) => `clips/${name}.${e}`).find(has);
  return `<figure class="clip">${rel ? `<video src="${esc(rel)}" controls loop muted playsinline></video>` : `<div class="missing">clips/${esc(name)}.mp4<br>not on this machine</div>`}<figcaption>${esc(what)}</figcaption></figure>`;
}).join("");

// Accessibility, measured on every after picture.
// The harness's stand-ins for native views ("[preview] native WebView…") are not the app's text.
for (const r of afterManifest) if (r.audit?.text) r.audit.text = r.audit.text.filter((x) => !x.text.startsWith("[preview"));
const audited = afterManifest.filter((r) => r.audit && !r.audit.error);
const sum = (f) => audited.reduce((n, r) => n + f(r), 0);
const failing = audited.filter((r) => r.audit.text.length || r.audit.icons.length || r.audit.targets.length);
const failRows = failing.map((r) => `<tr><td><a href="shots/after/${esc(r.file)}">${esc(r.file)}</a></td><td>${r.audit.text.map((x) => `“${esc(x.text)}” ${esc(x.fg)} on ${esc(x.bg)} = ${x.ratio}:1 (needs ${x.need})`).join("<br>")}</td><td>${r.audit.icons.map((x) => `${esc(x.fg)} on ${esc(x.bg)} = ${x.ratio}:1`).join("<br>")}</td><td>${r.audit.targets.map((x) => `${esc(x.role)} “${esc(x.label)}” ${x.w}×${x.h}`).join("<br>")}</td></tr>`).join("");
const slipping = audited.filter((r) => (r.audit.slips ?? []).length);
const slipRows = slipping.map((r) => `<tr><td><a href="shots/after/${esc(r.file)}">${esc(r.file)}</a></td><td>${r.audit.slips.map((x) => `${esc(x.kind)}: “${esc(x.text)}”`).join("<br>")}</td></tr>`).join("");
const a11y = `<p>${audited.length} pictures audited: <b>${sum((r) => r.audit.textCount)}</b> runs of text and <b>${sum((r) => r.audit.iconCount)}</b> icons measured on the pixels; <b>${sum((r) => r.audit.text.length)}</b> text runs under WCAG 2.2 AA, <b>${sum((r) => r.audit.icons.length)}</b> icons under 3:1, <b>${sum((r) => r.audit.targets.length)}</b> touch targets under 48 dp.</p>${failing.length ? `<table><tr><th>Picture</th><th>Text</th><th>Icons</th><th>Targets</th></tr>${failRows}</table>` : ""}
<p>Writing slips found on the same pictures (a mono value ending on one or two characters, a line repeating the one before it, a row description past two lines, a fallback label): <b>${sum((r) => (r.audit.slips ?? []).length)}</b>.</p>${slipping.length ? `<table><tr><th>Picture</th><th>Slips</th></tr>${slipRows}</table>` : ""}`;

// Every screen: before and after, light; after in Deep sea.
const beforeFiles = new Set(beforeManifest.map((r) => r.file));
const seen = new Set();
const all = afterManifest
  .filter((r) => r.theme === "light" && r.lang === "es-419" && !seen.has(r.file) && seen.add(r.file))
  .map((r) => {
    const dark = r.file.replace("-light-", "-dark-");
    return `<div class="pair"><h4><span class="id">${esc(r.id)}</span> ${esc(r.name)}</h4><div class="row">${beforeFiles.has(r.file) ? fig(`shots/before/${r.file}`, "before", "small before") : ""}${fig(`shots/after/${r.file}`, "after", "small")}${has(`shots/after/${dark}`) ? fig(`shots/after/${dark}`, "after, Deep sea", "small") : ""}</div></div>`;
  })
  .join("\n");

writeFileSync(
  join(polish, "index.html"),
  `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Hermit polish round: before and after</title>
<style>
body{font:15px/1.5 -apple-system,system-ui,sans-serif;margin:0;padding:28px 36px;background:#f4f1ec;color:#222;max-width:1700px}
h1{margin:0 0 6px}h2{margin:40px 0 4px;font-size:22px}h3{margin:18px 0 8px;font-size:16px}h4{margin:0 0 6px;font-size:14px}
p.lead{max-width:960px;color:#444}.meta{color:#555;margin:0 0 10px}.row{display:flex;gap:14px;flex-wrap:wrap;align-items:flex-start}
figure{margin:0}figcaption{font-size:12px;color:#666;margin-top:4px}
img{width:240px;border-radius:14px;border:1px solid #d8d2c8;display:block;background:#fff}img.small{width:170px}img.before{opacity:.92;border-style:dashed}img.wide{width:100%;max-width:1600px;border-radius:8px}
.iter{margin:10px 0 22px}.iter ul{margin:6px 0 0 18px;padding:0;max-width:1100px}.clip video{width:300px;border-radius:14px;border:1px solid #d8d2c8;background:#000}
.missing{width:170px;height:120px;border:1px dashed #b4483a;border-radius:12px;font-size:11px;color:#b4483a;display:flex;align-items:center;justify-content:center;text-align:center;padding:6px}
.pair{display:inline-block;vertical-align:top;margin:0 22px 26px 0}.id{font-family:ui-monospace,monospace;background:#222;color:#fff;padding:1px 6px;border-radius:4px;font-size:12px}
table{border-collapse:collapse;font-size:12px}td,th{border:1px solid #d8d2c8;padding:4px 8px;vertical-align:top;text-align:left}
code{font-size:12px}
</style></head><body>
<h1>Hermit polish round: before and after</h1>
<p class="lead">The real screens from <code>apps/mobile/src</code>, rendered by the preview harness (<code>apps/mobile/preview</code>, react-native-web in headless Chromium at 412 by 915, 2x) with sample data, in the brand faces the app now bundles. Before is <code>origin/master</code> at 68055a1; after is <code>design/polish</code>. What changed and why: <a href="decisions.md">decisions.md</a>; the tells: <a href="audit.md">audit.md</a>. The pictures and clips stay on this machine (gitignored). Regenerate: <code>cd apps/mobile/preview &amp;&amp; node build.mjs &amp;&amp; node shoot.mjs &amp;&amp; node clips.mjs &amp;&amp; node polish-gallery.mjs</code>.</p>
<h2>Hero screens</h2>
${hero}
<h2 style="margin-top:56px">Phase 2: every other screen, by family</h2>
<p class="meta">Each family against two or three references from the design benchmark, with the issues found and what changed, round by round. The full set of screens, before and after, is at the end.</p>
${families}
<h2>Motion</h2>
<p class="meta">Recorded with Playwright in the preview (react-native-web runs the same Animated code on the JavaScript thread; the phone runs it on the native driver). LayoutAnimation is a no-op on the web, so the folding clip shows the rows fading in without the layout easing. The crab's own motion (idle, blink, the hello wave) is the mascot's; the first clip shows it on this round's stage.</p>
<div class="row">${clips}</div>
<h2>Accessibility, measured</h2>
<p class="meta">Contrast is measured on each picture: in every run of text the most common color is the background actually behind it and the strongest color away from it is the ink actually drawn (opacity and overlays included); 4.5:1 for text, 3:1 for large text and icons. Touch targets from the rendered size of every button, link, switch and radio. With a sheet open only the sheet is audited.</p>
${a11y}
<h2>Every screen</h2>
<p class="meta">Every screen the harness renders, before (dashed) and after, in Quiet craft and Deep sea.</p>
${all}
</body></html>
`,
);
console.log(`wrote ${join(polish, "index.html")}: ${afterManifest.length} after pictures, ${audited.length} audited`);
