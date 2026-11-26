/*
 * Mail bodies to plain text (FR-MAIL-02). Pure and platform-free: no atob, Buffer or TextDecoder, which
 * Hermes does not all provide.
 */

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const B64_INDEX = new Map([...B64].map((c, i) => [c, i]));

/** Base64 or base64url to bytes; characters outside the alphabet (padding, line breaks) are skipped. */
export function base64ToBytes(text: string): Uint8Array {
  const clean = [...text.replace(/-/g, "+").replace(/_/g, "/")].filter((c) => B64_INDEX.has(c));
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let o = 0;
  for (let i = 0; i < clean.length; i += 4) {
    const n = [0, 1, 2, 3].map((k) => B64_INDEX.get(clean[i + k] ?? "A") ?? 0);
    const v = (n[0]! << 18) | (n[1]! << 12) | (n[2]! << 6) | n[3]!;
    const bytes = [(v >> 16) & 255, (v >> 8) & 255, v & 255].slice(0, Math.max(0, Math.min(3, clean.length - i - 1)));
    for (const b of bytes) out[o++] = b;
  }
  return out.slice(0, o);
}

/** UTF-8 bytes to text; a malformed sequence becomes U+FFFD instead of throwing. */
export function utf8Decode(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; ) {
    const b = bytes[i]!;
    const need = b < 0x80 ? 0 : b >= 0xf8 ? -1 : b >= 0xf0 ? 3 : b >= 0xe0 ? 2 : b >= 0xc0 ? 1 : -1;
    if (need < 0) {
      out += "�";
      i++;
      continue;
    }
    if (need === 0) {
      out += String.fromCharCode(b);
      i++;
      continue;
    }
    let cp = b & (need === 1 ? 0x1f : need === 2 ? 0x0f : 0x07);
    let ok = true;
    for (let k = 1; k <= need; k++) {
      const c = bytes[i + k];
      if (c === undefined || (c & 0xc0) !== 0x80) {
        ok = false;
        break;
      }
      cp = (cp << 6) | (c & 0x3f);
    }
    if (!ok || cp > 0x10ffff) {
      out += "�";
      i++;
      continue;
    }
    out += String.fromCodePoint(cp);
    i += need + 1;
  }
  return out;
}

export const decodeBase64Text = (data: string) => utf8Decode(base64ToBytes(data));

const NAMED: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: "\"", apos: "'", nbsp: " ", iexcl: "¡", iquest: "¿", copy: "©", reg: "®", euro: "€", hellip: "...", ndash: "-", mdash: "-",
  laquo: "«", raquo: "»", ldquo: "\"", rdquo: "\"", lsquo: "'", rsquo: "'", middot: "·", deg: "°",
  aacute: "á", eacute: "é", iacute: "í", oacute: "ó", uacute: "ú", Aacute: "Á", Eacute: "É", Iacute: "Í", Oacute: "Ó", Uacute: "Ú",
  ntilde: "ñ", Ntilde: "Ñ", uuml: "ü", Uuml: "Ü", agrave: "à", egrave: "è", ccedil: "ç", atilde: "ã", otilde: "õ", acirc: "â", ecirc: "ê", ocirc: "ô",
};

/** HTML character references to text (Gmail snippets carry them). */
export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]{1,6}|#[0-9]{1,7}|[a-z]{2,8});/gi, (whole, ref: string) => {
    if (ref[0] === "#") {
      const cp = ref[1] === "x" || ref[1] === "X" ? parseInt(ref.slice(2), 16) : parseInt(ref.slice(1), 10);
      return cp > 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : whole;
    }
    return NAMED[ref] ?? whole;
  });
}

/** An HTML body as readable lines: no scripts, styles, tags or blank lines. */
export function htmlToText(html: string): string {
  const text = html
    .replace(/<(script|style|head|title)\b[\s\S]*?<\/\1\s*>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<br\s*\/?>|<\/(p|div|li|tr|h[1-6]|blockquote|table)\s*>/gi, "\n")
    .replace(/<[^>]*>/g, "");
  return plainText(decodeEntities(text))
    .split("\n")
    .filter((l) => l.trim())
    .join("\n");
}

/** Line endings and runs of spaces normalized; each line trimmed. */
export function plainText(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((l) => l.replace(/[ \t\u00a0]+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * A field other people control, flattened so it can't start a line or add a field in the listing the model
 * reads (the harness reads ids only at line starts): newlines and control characters become spaces, and the
 * field separator "|" becomes "/".
 */
export function oneLine(text: string): string {
  return [...text].map((c) => (c.charCodeAt(0) < 0x20 || c.charCodeAt(0) === 0x7f ? " " : c)).join("").replace(/\|/g, "/").replace(/\s+/g, " ").trim();
}

export function clip(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 3).trimEnd()}...`;
}

/** Splits an address header ("Ana <a@x.com>, \"Pérez, Luis\" <l@x.com>") at commas outside quotes and brackets. */
export function splitAddresses(header: string | undefined): string[] {
  if (!header) return [];
  const out: string[] = [];
  let cur = "";
  let quoted = false;
  let depth = 0;
  for (const c of header) {
    if (c === "\"") quoted = !quoted;
    else if (c === "<" && !quoted) depth++;
    else if (c === ">" && !quoted) depth = Math.max(0, depth - 1);
    if (c === "," && !quoted && depth === 0) {
      if (cur.trim()) out.push(cur.trim());
      cur = "";
    } else cur += c;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}
