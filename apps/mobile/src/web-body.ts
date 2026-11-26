// Size-capped reading for the read_web adapter (FR-WEB-01: 2 MB). The cap holds on the bytes received, so a huge or
// endless body is never downloaded past it. Pure: tested under Node with node --test.

export interface ChunkReader {
  read(): Promise<{ done: boolean; value?: Uint8Array }>;
  cancel(reason?: unknown): Promise<void>;
}

/**
 * Reads at most `maxBytes` from a stream. Once more arrive, the stream is cancelled and the first `maxBytes` are
 * kept with `truncated: true`; nothing past the cap is ever waited for.
 */
export async function readCapped(reader: ChunkReader, maxBytes: number): Promise<{ bytes: Uint8Array; truncated: boolean }> {
  const chunks: Uint8Array[] = [];
  let total = 0;
  let truncated = false;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value?.length) continue;
    if (total + value.length > maxBytes) {
      chunks.push(value.subarray(0, maxBytes - total));
      total = maxBytes;
      truncated = true;
      await reader.cancel().catch(() => {});
      break;
    }
    chunks.push(value);
    total += value.length;
  }
  const bytes = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) {
    bytes.set(c, at);
    at += c.length;
  }
  return { bytes, truncated };
}

/** The charset a Content-Type names, lowercase, or "utf-8". */
export function charsetOf(contentType: string): string {
  return /charset\s*=\s*"?([\w.:-]+)/i.exec(contentType)?.[1]?.toLowerCase() ?? "utf-8";
}

/**
 * Bytes to text. TextDecoder when the runtime has it (with the page's charset when it knows it); otherwise UTF-8 by
 * hand, and Latin-1 for the charsets that are. A sequence cut by the cap ends in U+FFFD, never an exception.
 */
export function decodeBody(bytes: Uint8Array, contentType: string): string {
  const charset = charsetOf(contentType);
  const Decoder = (globalThis as { TextDecoder?: new (label: string) => { decode(b: Uint8Array): string } }).TextDecoder;
  if (Decoder) {
    try {
      return new Decoder(charset).decode(bytes);
    } catch {
      // An unknown label: fall through to the hand decoders.
    }
  }
  if (/^(iso-8859-1|latin1|windows-1252|us-ascii)$/.test(charset)) return Array.from(bytes, (b) => String.fromCharCode(b)).join("");
  return utf8(bytes);
}

function utf8(b: Uint8Array): string {
  let out = "";
  for (let i = 0; i < b.length; ) {
    const c = b[i]!;
    const need = c < 0x80 ? 0 : c >= 0xc2 && c < 0xe0 ? 1 : c >= 0xe0 && c < 0xf0 ? 2 : c >= 0xf0 && c < 0xf5 ? 3 : -1;
    if (need === 0) {
      out += String.fromCharCode(c);
      i++;
      continue;
    }
    if (need < 0) {
      out += "�";
      i++;
      continue;
    }
    // A sequence cut at the end (by the size cap).
    if (i + need >= b.length) {
      out += "�";
      break;
    }
    let cp = c & (0x3f >> need);
    let ok = true;
    for (let k = 1; k <= need; k++) {
      const n = b[i + k]!;
      if ((n & 0xc0) !== 0x80) ok = false;
      cp = (cp << 6) | (n & 0x3f);
    }
    if (!ok) {
      out += "�";
      i++;
      continue;
    }
    out += String.fromCodePoint(cp);
    i += need + 1;
  }
  return out;
}

// --- SL-41: x402 -------------------------------------------------------------------------------------------------

/** The x402 response headers a hop reports, lowercase (core's X402_RESPONSE_HEADERS; the test checks they match). */
export const X402_RESPONSE_HEADERS = ["payment-required", "payment-response", "x-payment-response"] as const;

/** Only those headers, when present. Nothing else the site sends is passed on. */
export function x402Headers(get: (name: string) => string | null | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const name of X402_RESPONSE_HEADERS) {
    const v = get(name);
    if (typeof v === "string" && v) out[name] = v;
  }
  return out;
}

/** The request headers: Accept, and the one x402 payment header a caller may add after the user approved. */
export function requestHeaders(accept: string, payment: { name: string; value: string } | undefined): Record<string, string> {
  if (!payment) return { Accept: accept };
  if (payment.name !== "PAYMENT-SIGNATURE" && payment.name !== "X-PAYMENT") throw new TypeError("refused: not an x402 payment header");
  // One line of base64: anything else could smuggle another header.
  if (!/^[A-Za-z0-9+/=_-]{1,16384}$/.test(payment.value)) throw new TypeError("refused: not a base64 header value");
  return { Accept: accept, [payment.name]: payment.value };
}

/** A 402's body is read whatever its type (an x402 v1 merchant sends its terms as JSON); otherwise only pages are. */
export function bodyWanted(status: number, readable: boolean): boolean {
  return readable || status === 402;
}

/**
 * Which transport a page read uses. A request carrying the x402 payment header always goes through expo/fetch, whose
 * Android side turns OkHttp's redirect following off for `redirect: "manual"`, so the header never reaches a host no
 * hop check saw. React Native's own fetch and XHR follow redirects whatever they are asked (security review).
 */
export function transportFor(paid: boolean, streaming: boolean): "expo" | "fetch" | "xhr" {
  if (paid) return "expo";
  return streaming ? "fetch" : "xhr";
}
