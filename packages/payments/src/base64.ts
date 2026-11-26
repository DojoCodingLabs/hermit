// Standard base64 (RFC 4648, padded), written out so the package needs neither Buffer nor btoa on the phone.
import { X402Error } from "./errors.ts";

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const LOOKUP = new Map([...ALPHABET].map((c, i) => [c, i]));

export function bytesToBase64(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i]!;
    const b = bytes[i + 1];
    const c = bytes[i + 2];
    const n = (a << 16) | ((b ?? 0) << 8) | (c ?? 0);
    out += ALPHABET[(n >> 18) & 63]! + ALPHABET[(n >> 12) & 63]!;
    out += b === undefined ? "=" : ALPHABET[(n >> 6) & 63]!;
    out += c === undefined ? "=" : ALPHABET[n & 63]!;
  }
  return out;
}

export function base64ToBytes(text: string): Uint8Array {
  const clean = text.trim().replace(/-/g, "+").replace(/_/g, "/").replace(/=+$/, "");
  if (clean.length % 4 === 1) throw new X402Error("malformed", "Base64 has an impossible length.");
  const out: number[] = [];
  let buf = 0;
  let bits = 0;
  for (const ch of clean) {
    const v = LOOKUP.get(ch);
    if (v === undefined) throw new X402Error("malformed", "Not base64.");
    buf = (buf << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out.push((buf >> bits) & 0xff);
    }
  }
  return Uint8Array.from(out);
}

export function encodeBase64Json(value: unknown): string {
  return bytesToBase64(new TextEncoder().encode(JSON.stringify(value)));
}

export function decodeBase64Json(text: string): unknown {
  const bytes = base64ToBytes(text);
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    throw new X402Error("malformed", "Base64 did not contain JSON.");
  }
}
