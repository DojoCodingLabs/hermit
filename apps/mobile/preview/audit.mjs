// Dev-only: the accessibility audit run on every capture (docs/design/polish). Contrast is measured on the picture
// itself, not read from styles: for each visible run of text (and each icon), the pixels inside its box are counted,
// the most common color is the background actually behind it, and the strongest color away from it is the ink actually
// drawn (opacity, overlays and anti-aliasing included). WCAG 2.2 AA: 4.5:1 for text, 3:1 for large text (24 px, or
// 18.66 px bold) and for icons. Touch targets: every button, link, switch and radio at least 48 by 48 dp.
// Disabled controls are skipped for contrast, as WCAG allows; text under aria-hidden is skipped (decorative copies).
// Writing slips the polish reviews caught are checked on every picture too: a mono value whose last line holds one or
// two characters ("orphan"); a line that repeats the one before it, such as a section label equal to its first row or
// a badge echoed by the sentence after it ("repeat"); a description in a row (a button, a link, a row with a switch)
// running past two lines ("long"); and a stand-in label, such as a made-up skill id's "Otra acción" ("fallback").
import { readFileSync } from "node:fs";

const locale = (name) => JSON.parse(readFileSync(new URL(`../../../packages/copy/locales/${name}.json`, import.meta.url), "utf8"));
/** The words a fallback label renders as, in both languages (a skill id the app doesn't know). */
const FALLBACKS = ["es-419", "en"].map((l) => locale(l)["common.skill.other"]);

/** Runs in the page. `b64` is the PNG just captured of the same viewport, at `dpr` device pixels per dp. */
async function measure({ b64, dpr, fallbacks }) {
  const img = new Image();
  img.src = `data:image/png;base64,${b64}`;
  await img.decode();
  const canvas = document.createElement("canvas");
  canvas.width = img.width;
  canvas.height = img.height;
  const g = canvas.getContext("2d", { willReadFrequently: true });
  g.drawImage(img, 0, 0);
  const lin = (v) => ((v /= 255) <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  const lum = ([r, gr, b]) => 0.2126 * lin(r) + 0.7152 * lin(gr) + 0.0722 * lin(b);
  const ratio = (a, b) => {
    const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m);
    return (x + 0.05) / (y + 0.05);
  };
  const hex = (c) => `#${c.map((v) => v.toString(16).padStart(2, "0")).join("").toUpperCase()}`;
  /** The background (most common color) and the ink (the strongest color away from it seen at least 3 times). */
  const sample = (rect) => {
    const x = Math.max(0, Math.floor(rect.left * dpr));
    const y = Math.max(0, Math.floor(rect.top * dpr));
    const w = Math.min(canvas.width - x, Math.ceil(rect.width * dpr));
    const h = Math.min(canvas.height - y, Math.ceil(rect.height * dpr));
    if (w < 2 || h < 2) return null;
    const data = g.getImageData(x, y, w, h).data;
    const counts = new Map();
    for (let i = 0; i < data.length; i += 4) {
      const key = (data[i] << 16) | (data[i + 1] << 8) | data[i + 2];
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    const rgb = (k) => [(k >> 16) & 255, (k >> 8) & 255, k & 255];
    let bgKey = 0;
    let most = -1;
    for (const [k, n] of counts) if (n > most) [bgKey, most] = [k, n];
    const bg = rgb(bgKey);
    let ink = bg;
    let best = 1;
    for (const [k, n] of counts) {
      if (n < 3) continue;
      const c = rgb(k);
      const r = ratio(c, bg);
      if (r > best) [ink, best] = [c, r];
    }
    return { bg, ink, ratio: best };
  };
  // With a sheet open, only the sheet is audited: what is behind the scrim is not available to read or press.
  const modal = [...document.querySelectorAll('[aria-modal="true"]')].pop();
  const decorative = (el) => !!el.closest('[aria-hidden="true"]') || (modal ? !modal.contains(el) : false);
  const disabled = (el) => !!el.closest('[aria-disabled="true"]');
  const onScreen = (r) => r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < innerHeight && r.right > 0 && r.left < innerWidth;
  /** How much of a box its scrolling and clipping ancestors leave in view (0 to 1). */
  const shown = (el, r) => {
    let top = r.top;
    let bottom = r.bottom;
    for (let e = el.parentElement; e; e = e.parentElement) {
      const o = getComputedStyle(e);
      if (o.overflowY === "visible" && o.overflowX === "visible") continue;
      const c = e.getBoundingClientRect();
      top = Math.max(top, c.top);
      bottom = Math.min(bottom, c.bottom);
    }
    top = Math.max(top, 0);
    bottom = Math.min(bottom, innerHeight);
    return Math.max(0, bottom - top) / r.height;
  };
  const text = [];
  const icons = [];
  const targets = [];
  const runs = [];
  let textCount = 0;
  let iconCount = 0;
  for (const el of document.querySelectorAll("#root *")) {
    if (decorative(el)) continue;
    const box = el.getBoundingClientRect();
    if (!onScreen(box)) continue;
    const node = [...el.childNodes].find((n) => n.nodeType === 3 && n.textContent.trim());
    if (node && !node.textContent.trim().startsWith("[preview")) runs.push({ el, node });
    // The harness's own stand-ins for native views ("[preview] …") are not the app's text.
    if (node && !disabled(el) && !node.textContent.trim().startsWith("[preview")) {
      // The text's own line boxes, not the element's padding, so the sample is mostly glyphs and what is behind them.
      const range = document.createRange();
      range.selectNodeContents(node);
      // Line boxes narrower than 4 dp are the spaces where a line wraps: no glyphs to measure.
      // A line scrolled half out of its list is not read there: only lines mostly in view are measured.
      const rects = [...range.getClientRects()].filter((r) => onScreen(r) && r.width >= 4 && shown(el, r) > 0.8);
      if (rects.length) {
        textCount++;
        const cs = getComputedStyle(el);
        const size = parseFloat(cs.fontSize);
        const large = size >= 24 || (size >= 18.66 && Number(cs.fontWeight) >= 700);
        const need = large ? 3 : 4.5;
        // A line box with no glyph pixels in it (a wrapped line's empty tail) measures nothing: its ink is then the
        // text's own color as styled, against the background the pixels show.
        const css = (cs.color.match(/[\d.]+/g) ?? []).slice(0, 3).map(Number);
        const worst = rects
          .map(sample)
          .filter(Boolean)
          .map((m) => (m.ratio < 1.1 && css.length === 3 ? { ...m, ink: css, ratio: ratio(css, m.bg) } : m))
          .sort((a, b) => a.ratio - b.ratio)[0];
        if (worst && worst.ratio < need) text.push({ text: el.textContent.trim().slice(0, 60), fg: hex(worst.ink), bg: hex(worst.bg), ratio: Math.round(worst.ratio * 100) / 100, need });
      }
    }
    const role = el.getAttribute("role");
    if (["button", "link", "switch", "radio", "checkbox"].includes(role)) {
      if (box.height < 47.5 || box.width < 47.5) targets.push({ role, label: (el.getAttribute("aria-label") || el.textContent || "").trim().slice(0, 50), w: Math.round(box.width), h: Math.round(box.height) });
    }
  }
  // Icons: every drawn svg (they sit under aria-hidden, being decorative to TalkBack, but they must still be seen).
  for (const svg of document.querySelectorAll("#root svg")) {
    const box = svg.getBoundingClientRect();
    if (!onScreen(box) || box.width > 64 || disabled(svg) || (modal && !modal.contains(svg))) continue;
    const m = sample(box);
    // An icon box the picture shows nothing in (clipped by its row, or still off screen) isn't measured.
    if (!m || m.ratio < 1.1) continue;
    iconCount++;
    if (m.ratio < 3) icons.push({ fg: hex(m.ink), bg: hex(m.bg), ratio: Math.round(m.ratio * 100) / 100, w: Math.round(box.width) });
  }
  // Writing slips.
  const slips = [];
  const norm = (x) => x.toLowerCase().replace(/[“”"«»]/g, "").replace(/\s+/g, " ").trim();
  const lineCounts = (node) => {
    const per = new Map();
    const tx = node.textContent;
    for (let i = 0; i < tx.length; i++) {
      if (/\s/.test(tx[i])) continue;
      const r = document.createRange();
      r.setStart(node, i);
      r.setEnd(node, i + 1);
      const b = r.getBoundingClientRect();
      if (!b.width) continue;
      const k = Math.round(b.top);
      per.set(k, (per.get(k) ?? 0) + 1);
    }
    return [...per.entries()].sort((a, b) => a[0] - b[0]).map((e) => e[1]);
  };
  // A row: a button or a link, a row holding a switch, or a list row's layout (a 32 or 40 dp tile or initial first).
  const inRow = (el) => {
    let e = el;
    for (let i = 0; i < 7 && e && e.id !== "root"; i++, e = e.parentElement) {
      const role = e.getAttribute("role");
      if (role === "button" || role === "link") return true;
      if (e.querySelector(':scope > [role="switch"], :scope > * > [role="switch"]')) return true;
      const first = e.firstElementChild?.getBoundingClientRect();
      if (getComputedStyle(e).flexDirection === "row" && e.children.length >= 2 && first && first.width >= 28 && first.width <= 44 && Math.abs(first.width - first.height) <= 2) return true;
    }
    return false;
  };
  // Text faded out entirely (a page bar's small title before the large one scrolls by) isn't on screen to read.
  const seen = (el) => {
    let o = 1;
    for (let e = el; e && e.id !== "root"; e = e.parentElement) o *= Number(getComputedStyle(e).opacity);
    return o > 0.05;
  };
  let prev = "";
  for (const { el, node } of runs.filter((r) => seen(r.el))) {
    const t = node.textContent.trim();
    const cs = getComputedStyle(el);
    const counts = lineCounts(node);
    if (/JetBrains/i.test(cs.fontFamily) && counts.length > 1 && counts[counts.length - 1] <= 2) slips.push({ kind: "orphan", text: t.slice(0, 70) });
    const a = norm(prev);
    const b = norm(t);
    if (a.length >= 5 && (b === a || [":", " ·", ".", ","].some((sep) => b.startsWith(a + sep)))) slips.push({ kind: "repeat", text: `${prev.slice(0, 40)} / ${t.slice(0, 50)}` });
    if (parseFloat(cs.fontSize) <= 14.5 && counts.length > 2 && inRow(el)) slips.push({ kind: "long", text: t.slice(0, 70), lines: counts.length });
    if (fallbacks.includes(t)) slips.push({ kind: "fallback", text: t });
    prev = t;
  }
  return { textCount, iconCount, text, icons, targets, slips };
}

/** Captures the page as it is and audits that picture. */
export async function audit(page) {
  const png = await page.screenshot();
  const dpr = await page.evaluate(() => window.devicePixelRatio);
  return page.evaluate(measure, { b64: png.toString("base64"), dpr, fallbacks: FALLBACKS });
}

/** The words a person reads on screen (for the copy diet's before and after), from the rendered text. */
export async function words(page) {
  return page.evaluate(() => {
    const out = [];
    for (const el of document.querySelectorAll("#root *")) {
      if (el.closest('[aria-hidden="true"]')) continue;
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      for (const n of el.childNodes) if (n.nodeType === 3 && n.textContent.trim()) out.push(n.textContent.trim());
    }
    return out;
  });
}
