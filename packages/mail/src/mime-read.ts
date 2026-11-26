/*
 * A raw message (RFC 5322, as IMAP's BODY[] gives it) to what Hermit reads (FR-MAIL-02): From, To, Cc and Subject
 * decoded (RFC 2047 encoded words, 8-bit UTF-8 headers), the Date, Message-ID and References for a reply, and the
 * first text/plain part (else text/html) out of its transfer encoding and charset. Pure and platform-free. The input
 * may be cut short by a partial fetch: whatever arrived is read. Caps on headers, parts and depth keep a hostile
 * message from costing more than a normal one; nothing here runs, loads or follows anything in it.
 */
import { base64ToBytes, splitAddresses, utf8Decode } from "./text.ts";

export interface ReadMessage {
  from: string;
  to: string[];
  cc: string[];
  subject: string;
  date?: number;
  messageId?: string;
  references?: string;
  text?: string;
  html?: string;
}

const MAX_HEADERS = 300;
const MAX_HEADER_CHARS = 16_384;
const MAX_PARTS = 64;
const MAX_DEPTH = 5;
const MAX_TEXT = 200_000;

function bytesOf(s: string): Uint8Array {
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i) & 0xff;
  return out;
}

// Windows-1252's 0x80 to 0x9F; the WHATWG Encoding standard reads iso-8859-1, latin1 and us-ascii labels this way too.
const W1252 = [0x20ac, 0x81, 0x201a, 0x192, 0x201e, 0x2026, 0x2020, 0x2021, 0x2c6, 0x2030, 0x160, 0x2039, 0x152, 0x8d, 0x17d, 0x8f, 0x90, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2013, 0x2014, 0x2dc, 0x2122, 0x161, 0x203a, 0x153, 0x9d, 0x17e, 0x178];

function cp1252(bytes: Uint8Array): string {
  let out = "";
  for (const b of bytes) out += String.fromCharCode(b >= 0x80 && b <= 0x9f ? W1252[b - 0x80]! : b);
  return out;
}

const isUtf8 = (bytes: Uint8Array) => !utf8Decode(bytes).includes("�");

/** Text in a declared charset: UTF-8, the Windows-1252 family, else UTF-8 when it decodes cleanly, Windows-1252 if not. */
export function decodeCharset(bytes: Uint8Array, charset: string | undefined): string {
  const cs = (charset ?? "").trim().toLowerCase();
  if (cs === "utf-8" || cs === "utf8") return utf8Decode(bytes);
  if (["iso-8859-1", "iso8859-1", "latin1", "l1", "iso-8859-15", "windows-1252", "cp1252"].includes(cs)) return cp1252(bytes);
  return isUtf8(bytes) ? utf8Decode(bytes) : cp1252(bytes);
}

/** Quoted-printable (RFC 2045) to bytes: soft line breaks removed, =XX decoded, anything else kept as it is. */
export function quotedPrintable(text: string): Uint8Array {
  const s = text.replace(/=\r?\n/g, "");
  const out = new Uint8Array(s.length);
  let n = 0;
  for (let i = 0; i < s.length; i++) {
    const hex = s[i] === "=" ? s.slice(i + 1, i + 3) : "";
    if (/^[0-9A-Fa-f]{2}$/.test(hex)) {
      out[n++] = parseInt(hex, 16);
      i += 2;
    } else out[n++] = s.charCodeAt(i) & 0xff;
  }
  return out.slice(0, n);
}

const WORD = "=\\?([^?\\s]{1,40})\\?([bBqQ])\\?([^?\\s]*)\\?=";

/** A header's raw value (a binary string) as text: 8-bit UTF-8 or Windows-1252, encoded words decoded, one line. */
export function decodeHeader(raw: string): string {
  let text = /[\x80-\xff]/.test(raw) ? decodeCharset(bytesOf(raw), undefined) : raw;
  // Whitespace between two encoded words is not part of the text (RFC 2047 section 6.2).
  text = text.replace(new RegExp(`(${WORD})\\s+(?=${WORD})`, "g"), "$1");
  text = text.replace(new RegExp(WORD, "g"), (_m, cs: string, enc: string, data: string) =>
    decodeCharset(enc.toUpperCase() === "B" ? base64ToBytes(data) : quotedPrintable(data.replace(/_/g, " ")), cs.split("*")[0]),
  );
  // eslint-disable-next-line no-control-regex -- control characters (CR and LF above all) are exactly what is removed
  return text.replace(/[\x00-\x1f\x7f]+/g, " ").replace(/\s+/g, " ").trim();
}

interface Part {
  headers: Map<string, string>;
  body: string;
}

/** Headers (unfolded, the first of each name, capped) and the body, of a message or a MIME part. */
function splitPart(raw: string): Part {
  const headers = new Map<string, string>();
  const blank = /^\r?\n/.exec(raw) ?? /\r?\n\r?\n/.exec(raw);
  const head = blank ? raw.slice(0, blank.index) : raw;
  const body = blank ? raw.slice(blank.index + blank[0].length) : "";
  const lines = head.replace(/\r?\n(?=[ \t])/g, "").split(/\r?\n/);
  for (const line of lines.slice(0, MAX_HEADERS)) {
    const colon = line.indexOf(":");
    if (colon <= 0) continue;
    const name = line.slice(0, colon).trim().toLowerCase();
    if (!/^[!-9;-~]{1,76}$/.test(name) || headers.has(name)) continue;
    headers.set(name, line.slice(colon + 1, colon + 1 + MAX_HEADER_CHARS).trim());
  }
  return { headers, body };
}

/** A Content-Type or Content-Disposition: the value before the first `;`, lower case, and its parameters. */
export function headerParams(value: string | undefined): { value: string; params: Map<string, string> } {
  const pieces: string[] = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < (value ?? "").length; i++) {
    const c = value![i]!;
    if (c === "\\" && quoted && i + 1 < value!.length) {
      cur += value![++i];
      continue;
    }
    if (c === '"') quoted = !quoted;
    else if (c === ";" && !quoted) {
      pieces.push(cur);
      cur = "";
      continue;
    } else cur += c;
  }
  pieces.push(cur);
  const params = new Map<string, string>();
  for (const p of pieces.slice(1, 32)) {
    const eq = p.indexOf("=");
    if (eq <= 0) continue;
    const name = p.slice(0, eq).trim().toLowerCase();
    if (!params.has(name)) params.set(name, p.slice(eq + 1).trim());
  }
  return { value: pieces[0]!.trim().toLowerCase(), params };
}

/** Where a delimiter line `--boundary` starts, at or after `from`: at a line's start and not a longer boundary. */
function delimiterAt(body: string, delim: string, from: number): number {
  for (let i = from; ; ) {
    let at = 0;
    if (i > 0 || !body.startsWith(delim)) {
      const nl = body.indexOf(`\n${delim}`, Math.max(0, i - 1));
      if (nl < 0) return -1;
      at = nl + 1;
    }
    const after = body[at + delim.length];
    if (after === undefined || after === "-" || after === "\r" || after === "\n" || after === " " || after === "\t") return at;
    i = at + 1;
  }
}

/** The parts of a multipart body; the last one may be cut short. */
function multipartParts(body: string, boundary: string): string[] {
  const delim = `--${boundary}`;
  const out: string[] = [];
  let at = delimiterAt(body, delim, 0);
  while (at >= 0 && out.length < MAX_PARTS) {
    const after = at + delim.length;
    if (body.startsWith("--", after)) break;
    const lineEnd = body.indexOf("\n", after);
    if (lineEnd < 0) break;
    const next = delimiterAt(body, delim, lineEnd + 1);
    const content = body.slice(lineEnd + 1, next < 0 ? body.length : next);
    // The line break before a delimiter belongs to the delimiter (RFC 2046 section 5.1.1).
    out.push(next < 0 ? content : content.replace(/\r?\n$/, ""));
    at = next;
  }
  return out;
}

const BOUNDARY = /^[0-9A-Za-z'()+_,\-./:=? ]{0,69}[0-9A-Za-z'()+_,\-./:=?]$/;

function transferDecode(body: string, encoding: string | undefined): Uint8Array {
  const enc = (encoding ?? "").trim().toLowerCase();
  if (enc === "base64") return base64ToBytes(body);
  if (enc === "quoted-printable") return quotedPrintable(body);
  return bytesOf(body);
}

const unquote = (v: string | undefined) => v?.replace(/^"(.*)"$/, "$1");

function walk(raw: string, depth: number, found: { text?: string; html?: string; parts: number }): void {
  if (depth > MAX_DEPTH || ++found.parts > MAX_PARTS || found.text !== undefined) return;
  const part = splitPart(raw);
  const type = headerParams(part.headers.get("content-type") || "text/plain");
  if (type.value.startsWith("multipart/")) {
    const boundary = unquote(type.params.get("boundary"));
    if (!boundary || !BOUNDARY.test(boundary)) return;
    for (const p of multipartParts(part.body, boundary)) walk(p, depth + 1, found);
    return;
  }
  if (headerParams(part.headers.get("content-disposition")).value === "attachment") return;
  const kind = type.value === "text/plain" ? "text" : type.value === "text/html" ? "html" : undefined;
  if (!kind || found[kind] !== undefined) return;
  const bytes = transferDecode(part.body, part.headers.get("content-transfer-encoding"));
  found[kind] = decodeCharset(bytes, unquote(type.params.get("charset"))).slice(0, MAX_TEXT);
}

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const ZONES: Record<string, number> = { ut: 0, gmt: 0, z: 0, est: -300, edt: -240, cst: -360, cdt: -300, mst: -420, mdt: -360, pst: -480, pdt: -420 };

/** An RFC 5322 date ("Tue, 1 Jul 2003 10:52:37 +0200") to epoch ms; undefined when it isn't one. */
export function mailHeaderDate(text: string): number | undefined {
  const m = /^\s*(?:[A-Za-z]{3},\s*)?(\d{1,2})\s+([A-Za-z]{3})\s+(\d{2,4})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([+-]\d{4}|[A-Za-z]{1,5})?/.exec(text);
  if (!m) return undefined;
  const month = MONTHS.indexOf(m[2]!.toLowerCase());
  let year = Number(m[3]);
  if (m[3]!.length === 2) year += year < 50 ? 2000 : 1900;
  const [day, hour, minute, second] = [Number(m[1]), Number(m[4]), Number(m[5]), Number(m[6] ?? 0)];
  if (month < 0 || day < 1 || day > 31 || hour > 23 || minute > 59 || second > 60 || year < 1970) return undefined;
  const zone = m[7] ?? "+0000";
  const offset = /^[+-]\d{4}$/.test(zone) ? (zone[0] === "-" ? -1 : 1) * (Number(zone.slice(1, 3)) * 60 + Number(zone.slice(3))) : (ZONES[zone.toLowerCase()] ?? 0);
  return Date.UTC(year, month, day, hour, minute, second) - offset * 60_000;
}

const MESSAGE_ID = /<[^<>\s]{1,250}>/g;

export function readMessage(raw: string): ReadMessage {
  const top = splitPart(raw);
  const h = (name: string) => top.headers.get(name);
  const found: { text?: string; html?: string; parts: number } = { parts: 0 };
  walk(raw, 0, found);
  const id = (h("message-id") ?? "").match(MESSAGE_ID)?.[0];
  const refs = (h("references") ?? "").match(MESSAGE_ID)?.slice(-20).join(" ");
  const date = h("date") !== undefined ? mailHeaderDate(h("date")!) : undefined;
  return {
    from: decodeHeader(h("from") ?? ""),
    to: splitAddresses(decodeHeader(h("to") ?? "")),
    cc: splitAddresses(decodeHeader(h("cc") ?? "")),
    subject: decodeHeader(h("subject") ?? ""),
    ...(date !== undefined ? { date } : {}),
    ...(id ? { messageId: id } : {}),
    ...(refs ? { references: refs } : {}),
    ...(found.text !== undefined ? { text: found.text } : {}),
    ...(found.html !== undefined ? { html: found.html } : {}),
  };
}
