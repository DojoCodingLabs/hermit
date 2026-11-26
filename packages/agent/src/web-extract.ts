/**
 * Readable text from a web page (FR-WEB-01), in plain TypeScript: a small tolerant tokenizer, not a DOM. It keeps
 * what a person would read and drops what they can't see (scripts, styles, navigation, forms, hidden elements),
 * which also removes the usual hiding places of injected instructions. What is left still goes only to the
 * quarantined reader: extraction is about reading well, never about safety.
 */
export interface Readable {
  /** The page's title on one line (at most 120 characters), or "" when it has none. */
  title: string;
  /** One block per line, blank lines removed. */
  text: string;
}

const MAX_TITLE = 120;

export function extractReadable(body: string, contentType: string): Readable {
  if (contentType.split(";")[0]!.trim().toLowerCase() === "text/plain") return { title: "", text: tidy(body) };
  return extractHtml(body);
}

/** Elements whose content is never page text. */
const DROP = new Set(["script", "style", "noscript", "template", "svg", "math", "iframe", "object", "canvas", "audio", "video", "form", "button", "select", "textarea", "nav", "aside", "dialog"]);
/** Dropped outside an article or main element (site chrome), kept inside it (an article's own heading). */
const CHROME = new Set(["header", "footer"]);
/** Content is raw text up to the matching close tag. */
const RAW = new Set(["script", "style", "title", "textarea", "noscript", "xmp"]);
const VOID = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"]);
const BLOCK = new Set(["p", "div", "br", "li", "ul", "ol", "dl", "dt", "dd", "h1", "h2", "h3", "h4", "h5", "h6", "tr", "table", "section", "article", "main", "blockquote", "pre", "figure", "figcaption", "hr", "address", "header", "footer", "details", "summary", "caption", "td", "th"]);
const REGION = new Set(["article", "main"]);

function hiddenByAttrs(attrs: Record<string, string>): boolean {
  if ("hidden" in attrs) return true;
  if ((attrs["aria-hidden"] ?? "").toLowerCase() === "true") return true;
  const style = (attrs.style ?? "").toLowerCase().replace(/\s+/g, "");
  return /(^|;)display:none/.test(style) || /(^|;)visibility:hidden/.test(style);
}

function parseAttrs(src: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of src.matchAll(/([^\s=/>"']+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g)) {
    const name = m[1]!.toLowerCase();
    if (!(name in out)) out[name] = decodeEntities(m[2] ?? m[3] ?? m[4] ?? "");
  }
  return out;
}

/** Index just past the ">" that ends a tag starting at `from`, skipping quoted attribute values; -1 if none. */
function tagEnd(html: string, from: number): number {
  let quote = "";
  for (let i = from; i < html.length; i++) {
    const c = html[i]!;
    if (quote) {
      if (c === quote) quote = "";
    } else if (c === '"' || c === "'") {
      quote = c;
    } else if (c === ">") {
      return i + 1;
    }
  }
  return -1;
}

function extractHtml(html: string): Readable {
  const all: string[] = [];
  const region: string[] = [];
  let title = "";
  let ogTitle = "";
  // While dropping an element: its name and how deep inside further same-name elements we are.
  let skip: { name: string; depth: number } | undefined;
  let regionDepth = 0;
  const emit = (text: string) => {
    all.push(text);
    if (regionDepth > 0) region.push(text);
  };

  let i = 0;
  while (i < html.length) {
    const lt = html.indexOf("<", i);
    if (lt < 0) {
      if (!skip) emit(decodeEntities(html.slice(i)));
      break;
    }
    if (lt > i && !skip) emit(decodeEntities(html.slice(i, lt)));
    i = lt;
    if (html.startsWith("<!--", i)) {
      const end = html.indexOf("-->", i + 4);
      i = end < 0 ? html.length : end + 3;
      continue;
    }
    const m = /^<(\/?)([a-zA-Z][a-zA-Z0-9:-]*)/.exec(html.slice(i, i + 64));
    if (!m) {
      if (/^<[!?]/.test(html.slice(i, i + 2))) {
        const end = html.indexOf(">", i);
        i = end < 0 ? html.length : end + 1;
        continue;
      }
      if (!skip) emit("<");
      i++;
      continue;
    }
    const end = tagEnd(html, i + m[0].length);
    if (end < 0) break; // an unterminated tag at the end is dropped
    const closing = m[1] === "/";
    const name = m[2]!.toLowerCase();
    const rawTag = html.slice(i + m[0].length, end - 1);
    i = end;

    if (closing) {
      if (skip) {
        if (name === skip.name && --skip.depth === 0) skip = undefined;
        continue;
      }
      if (REGION.has(name) && regionDepth > 0) regionDepth--;
      if (BLOCK.has(name)) emit("\n");
      continue;
    }

    const selfClosing = rawTag.trimEnd().endsWith("/") || VOID.has(name);
    if (skip) {
      if (name === skip.name && !selfClosing) skip.depth++;
      continue;
    }
    const attrs = parseAttrs(rawTag);
    if (name === "meta" && (attrs.property ?? attrs.name ?? "").toLowerCase() === "og:title") ogTitle = attrs.content ?? "";

    if (RAW.has(name)) {
      const close = html.toLowerCase().indexOf(`</${name}`, i);
      const content = html.slice(i, close < 0 ? html.length : close);
      if (name === "title" && !title) title = decodeEntities(content);
      const after = close < 0 ? -1 : tagEnd(html, close);
      i = after < 0 ? html.length : after;
      continue;
    }
    const drop = DROP.has(name) || (CHROME.has(name) && regionDepth === 0) || hiddenByAttrs(attrs);
    if (drop) {
      if (!selfClosing) skip = { name, depth: 1 };
      continue;
    }
    if (REGION.has(name) && !selfClosing) regionDepth++;
    if (BLOCK.has(name)) emit("\n");
  }

  const regionText = tidy(region.join(""));
  const text = regionText.length >= 200 ? regionText : tidy(all.join(""));
  return { title: oneLine(title || ogTitle).slice(0, MAX_TITLE).trimEnd(), text };
}

function oneLine(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

function tidy(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((l) => l.replace(/[ \t\f\v\u00a0\u2000-\u200b\u202f\u205f\u3000]+/g, " ").trim())
    .filter(Boolean)
    .join("\n");
}

const NAMED: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: "\u00a0", shy: "",
  ndash: "–", mdash: "—", hellip: "…", lsquo: "‘", rsquo: "’", ldquo: "“", rdquo: "”",
  laquo: "«", raquo: "»", bull: "•", middot: "·", copy: "©", reg: "®", trade: "™", deg: "°", euro: "€", pound: "£", cent: "¢", yen: "¥",
  iquest: "¿", iexcl: "¡", ordf: "ª", ordm: "º", times: "×", divide: "÷", frac12: "½",
  aacute: "á", eacute: "é", iacute: "í", oacute: "ó", uacute: "ú", Aacute: "Á", Eacute: "É", Iacute: "Í", Oacute: "Ó", Uacute: "Ú",
  agrave: "à", egrave: "è", igrave: "ì", ograve: "ò", ugrave: "ù", acirc: "â", ecirc: "ê", icirc: "î", ocirc: "ô", ucirc: "û",
  ntilde: "ñ", Ntilde: "Ñ", uuml: "ü", Uuml: "Ü", ccedil: "ç", Ccedil: "Ç", atilde: "ã", otilde: "õ", auml: "ä", ouml: "ö", euml: "ë", iuml: "ï",
};

export function decodeEntities(text: string): string {
  return text.replace(/&(#\d{1,7}|#x[0-9a-f]{1,6}|[a-z][a-z0-9]{1,31});/gi, (whole, ref: string) => {
    if (ref[0] === "#") {
      const code = ref[1] === "x" || ref[1] === "X" ? parseInt(ref.slice(2), 16) : parseInt(ref.slice(1), 10);
      return code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff) ? String.fromCodePoint(code) : whole;
    }
    return NAMED[ref] ?? whole;
  });
}

const stems = (text: string) =>
  text.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").split(/[^\p{L}\p{N}]+/u).filter((w) => w.length >= 4).map((w) => w.slice(0, 6));

/**
 * At most `budget` characters of the page for the reader (FR-WEB-03), whose context is small. A page that fits is
 * passed whole. Otherwise: the opening line, then the lines that share the rarest words with the user's question,
 * in page order; with nothing in common, the start of the page.
 */
export function excerptFor(text: string, question: string, budget: number): { text: string; cut: boolean } {
  if (text.length <= budget) return { text, cut: false };
  const lines = text.split("\n");
  const lineStems = lines.map((l) => new Set(stems(l)));
  const asked = [...new Set(stems(question))];
  // A word in every line says nothing about where the answer is: weigh each by how rare it is.
  const weight = new Map(asked.map((w) => [w, 1 / Math.max(1, lineStems.filter((s) => s.has(w)).length)]));
  const score = lineStems.map((s) => asked.reduce((sum, w) => sum + (s.has(w) ? weight.get(w)! : 0), 0));

  const keep = new Set<number>();
  let used = 0;
  const take = (idx: number) => {
    const cost = lines[idx]!.length + (keep.size ? 1 : 0);
    if (used + cost > budget) return false;
    keep.add(idx);
    used += cost;
    return true;
  };
  if (lines[0]!.length <= budget / 4) take(0);
  const ranked = lines.map((_, idx) => idx).filter((idx) => score[idx]! > 0 && !keep.has(idx)).sort((a, b) => score[b]! - score[a]! || a - b);
  for (const idx of ranked) take(idx);
  if (keep.size <= 1) {
    for (let idx = 0; idx < lines.length; idx++) if (!keep.has(idx) && !take(idx)) break;
  }
  if (!keep.size) return { text: text.slice(0, budget), cut: true };
  return { text: [...keep].sort((a, b) => a - b).map((idx) => lines[idx]).join("\n"), cut: true };
}
