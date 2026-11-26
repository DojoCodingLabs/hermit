/*
 * Outgoing mail as an RFC 5322 message (SL-49): for Gmail's raw send and draft, and for SMTP and IMAP
 * APPEND. Pure and platform-free (no Buffer, btoa or TextEncoder). Plain text only: attachments are V2
 * (PDR-017).
 */

import { emailOf } from "@hermit/skills";

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

export function utf8Encode(text: string): Uint8Array {
  const out: number[] = [];
  for (const ch of text) {
    let cp = ch.codePointAt(0)!;
    if (cp >= 0xd800 && cp <= 0xdfff) cp = 0xfffd;
    if (cp < 0x80) out.push(cp);
    else if (cp < 0x800) out.push(0xc0 | (cp >> 6), 0x80 | (cp & 63));
    else if (cp < 0x10000) out.push(0xe0 | (cp >> 12), 0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63));
    else out.push(0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 63), 0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63));
  }
  return Uint8Array.from(out);
}

export function bytesToBase64(bytes: Uint8Array, url = false): string {
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const [a, b, c] = [bytes[i]!, bytes[i + 1], bytes[i + 2]];
    const n = (a << 16) | ((b ?? 0) << 8) | (c ?? 0);
    out += B64[(n >> 18) & 63]! + B64[(n >> 12) & 63]! + (b === undefined ? "=" : B64[(n >> 6) & 63]!) + (c === undefined ? "=" : B64[n & 63]!);
  }
  return url ? out.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "") : out;
}

/** No control characters at all (CR and LF above all), so a value can never start a header of its own. */
const flat = (v: string) => [...v].map((c) => (c.charCodeAt(0) < 0x20 || c.charCodeAt(0) === 0x7f ? " " : c)).join("").replace(/\s+/g, " ").trim();

/** A header text as RFC 2047 encoded words when it isn't plain ASCII, each word at most 75 characters. */
export function encodeHeaderText(text: string): string {
  const v = flat(text);
  if (/^[\x20-\x7e]*$/.test(v)) return v;
  const words: string[] = [];
  let chunk = "";
  for (const ch of v) {
    if (utf8Encode(chunk + ch).length > 45) {
      words.push(chunk);
      chunk = "";
    }
    chunk += ch;
  }
  if (chunk) words.push(chunk);
  return words.map((w) => `=?UTF-8?B?${bytesToBase64(utf8Encode(w))}?=`).join("\r\n ");
}

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const two = (n: number) => String(n).padStart(2, "0");

/** RFC 5322 date in UTC ("Sat, 14 Nov 2026 15:00:00 +0000"). */
export function mailDate(at: number): string {
  const d = new Date(at);
  return `${DAYS[d.getUTCDay()]}, ${two(d.getUTCDate())} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()} ${two(d.getUTCHours())}:${two(d.getUTCMinutes())}:${two(d.getUTCSeconds())} +0000`;
}

/** A Message-ID as a header may carry it: one bracketed token, nothing else. */
const msgId = (v: string | undefined) => (v && /^<[^<>\s]{1,250}>$/.test(v.trim()) ? v.trim() : undefined);

export interface MimeInput {
  from: string;
  to: string[];
  cc: string[];
  subject: string;
  text: string;
  at: number;
  /** The Message-ID of the message this answers, for threading. */
  inReplyTo?: string;
  /** Its References header; the new message's References add its Message-ID. */
  references?: string;
}

/**
 * The message, CRLF line ends, the body UTF-8 in base64. Every address must already be a bare address
 * (emailOf); anything else throws, so a malformed recipient never reaches a header.
 */
export function buildMime(m: MimeInput): string {
  const addr = (a: string) => {
    const e = emailOf(a);
    if (!e) throw new Error("not an email address");
    return e;
  };
  const replyId = msgId(m.inReplyTo);
  const refs = replyId ? [...flat(m.references ?? "").split(" ").filter((r) => msgId(r)).slice(-20), replyId].join(" ") : undefined;
  const headers = [
    `From: ${addr(m.from)}`,
    `To: ${m.to.map(addr).join(", ")}`,
    ...(m.cc.length ? [`Cc: ${m.cc.map(addr).join(", ")}`] : []),
    `Subject: ${encodeHeaderText(m.subject)}`,
    `Date: ${mailDate(m.at)}`,
    ...(replyId ? [`In-Reply-To: ${replyId}`, `References: ${refs}`] : []),
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
  ];
  const body = bytesToBase64(utf8Encode(m.text.replace(/\r\n?/g, "\n").replace(/\n/g, "\r\n"))).replace(/.{1,76}/g, (l) => `${l}\r\n`);
  return `${headers.join("\r\n")}\r\n\r\n${body}`;
}

/** The text of a forward: the note, then the original's headers and text, as mail clients do. */
export function forwardText(note: string, original: { from: string; to: string[]; subject: string; date: string; text: string }): string {
  return [
    ...(note.trim() ? [note.trim(), ""] : []),
    "---------- Forwarded message ----------",
    `From: ${flat(original.from)}`,
    `Date: ${original.date}`,
    `Subject: ${flat(original.subject)}`,
    ...(original.to.length ? [`To: ${flat(original.to.join(", "))}`] : []),
    "",
    original.text,
  ].join("\n");
}
