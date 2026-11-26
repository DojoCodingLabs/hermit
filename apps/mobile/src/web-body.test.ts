import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { bodyWanted, charsetOf, decodeBody, readCapped, requestHeaders, X402_RESPONSE_HEADERS, x402Headers, type ChunkReader, transportFor } from "./web-body.ts";

/** A stream of `chunks`, endless when `forever`, recording how much was pulled and whether it was cancelled. */
function source(chunks: Uint8Array[], forever = false) {
  let i = 0;
  const seen = { pulled: 0, cancelled: false };
  const reader: ChunkReader = {
    async read() {
      if (seen.cancelled) return { done: true };
      const value = forever ? new Uint8Array(1024).fill(97) : chunks[i++];
      if (!value) return { done: true };
      seen.pulled += value.length;
      return { done: false, value };
    },
    async cancel() {
      seen.cancelled = true;
    },
  };
  return { reader, seen };
}

test("a body under the cap is read whole", async () => {
  const { reader, seen } = source([new Uint8Array([104, 105]), new Uint8Array([33])]);
  const out = await readCapped(reader, 10);
  assert.deepEqual([...out.bytes], [104, 105, 33]);
  assert.equal(out.truncated, false);
  assert.equal(seen.cancelled, false);
});

test("an endless body stops at the cap: cancelled, cut to exactly maxBytes, nothing more pulled", async () => {
  const { reader, seen } = source([], true);
  const out = await readCapped(reader, 2 * 1024 * 1024);
  assert.equal(out.bytes.length, 2 * 1024 * 1024);
  assert.equal(out.truncated, true);
  assert.equal(seen.cancelled, true);
  // At most one chunk past the cap was received before cancelling.
  assert.ok(seen.pulled <= 2 * 1024 * 1024 + 1024);
});

test("exactly the cap is not truncated", async () => {
  const { reader } = source([new Uint8Array(5), new Uint8Array(5)]);
  assert.equal((await readCapped(reader, 10)).truncated, false);
});

test("charset from the content type, utf-8 by default", () => {
  assert.equal(charsetOf("text/html; charset=ISO-8859-1"), "iso-8859-1");
  assert.equal(charsetOf('text/html; charset="UTF-8"'), "utf-8");
  assert.equal(charsetOf("text/html"), "utf-8");
});

test("decodes UTF-8 and Latin-1, and a sequence cut by the cap ends in a replacement character", () => {
  const es = new TextEncoder().encode("Devolución ¿cuándo? “30 días” 😀");
  assert.equal(decodeBody(es, "text/html; charset=utf-8"), "Devolución ¿cuándo? “30 días” 😀");
  assert.equal(decodeBody(new Uint8Array([0x61, 0xf1, 0x6f]), "text/html; charset=iso-8859-1"), "año");
  const cut = es.subarray(0, es.length - 2);
  assert.ok(decodeBody(cut, "text/html").endsWith("�"));
});

test("without TextDecoder (Hermes), the hand decoder gives the same text", () => {
  const saved = globalThis.TextDecoder;
  // @ts-expect-error simulating a runtime without TextDecoder
  delete globalThis.TextDecoder;
  try {
    const es = new TextEncoder().encode("Devolución ¿cuándo? “30 días” 😀");
    assert.equal(decodeBody(es, "text/html"), "Devolución ¿cuándo? “30 días” 😀");
    assert.equal(decodeBody(new Uint8Array([0x61, 0xf1, 0x6f]), "text/html; charset=windows-1252"), "año");
    assert.equal(decodeBody(new Uint8Array([0x61, 0xff, 0x62]), "text/html"), "a�b");
    assert.ok(decodeBody(es.subarray(0, es.length - 1), "text/html").endsWith("�"));
  } finally {
    globalThis.TextDecoder = saved;
  }
});

test("SL-41: only the x402 response headers are reported, and they are core's list", () => {
  const ports = readFileSync(new URL("../../../packages/core/src/ports.ts", import.meta.url), "utf8");
  const core = /X402_RESPONSE_HEADERS = \[([^\]]+)\]/.exec(ports)![1]!.split(",").map((s) => s.trim().replace(/"/g, ""));
  assert.deepEqual([...X402_RESPONSE_HEADERS], core);
  const sent: Record<string, string> = { "payment-required": "eyJ4IjoxfQ==", "set-cookie": "a=b", "x-payment-response": "" };
  assert.deepEqual(x402Headers((n) => sent[n] ?? null), { "payment-required": "eyJ4IjoxfQ==" });
});

test("SL-41: the one payment header a caller may add, as one line of base64", () => {
  assert.deepEqual(requestHeaders("text/html", undefined), { Accept: "text/html" });
  assert.deepEqual(requestHeaders("text/html", { name: "PAYMENT-SIGNATURE", value: "eyJ4IjoxfQ==" }), { Accept: "text/html", "PAYMENT-SIGNATURE": "eyJ4IjoxfQ==" });
  assert.throws(() => requestHeaders("text/html", { name: "Cookie", value: "a" }));
  assert.throws(() => requestHeaders("text/html", { name: "X-PAYMENT", value: "abc\r\nCookie: a=b" }));
});

test("SL-41: a 402's body is read whatever its type", () => {
  assert.equal(bodyWanted(402, false), true);
  assert.equal(bodyWanted(200, false), false);
  assert.equal(bodyWanted(200, true), true);
});

test("a paid read always goes through expo/fetch, never React Native's fetch or XHR, which follow redirects (security review)", () => {
  assert.equal(transportFor(true, true), "expo");
  assert.equal(transportFor(true, false), "expo");
  assert.equal(transportFor(false, false), "xhr");
  assert.equal(transportFor(false, true), "fetch");
});
