import { describe, expect, it } from "vitest";
import { utf8Decode } from "../src/text.ts";

// #142: only the shortest form is UTF-8 (RFC 3629), and it never encodes U+D800 to U+DFFF. Each byte of such a
// sequence becomes U+FFFD, the same answer a standard decoder gives.
const decode = (...b: number[]) => utf8Decode(new Uint8Array(b));
const standard = (...b: number[]) => new TextDecoder().decode(new Uint8Array(b));

describe("utf8Decode refuses what isn't UTF-8", () => {
  it("turns overlong encodings into U+FFFD", () => {
    expect(decode(0xc0, 0x80)).toBe("��");
    expect(decode(0xc1, 0x81)).toBe("��");
    expect(decode(0xe0, 0x80, 0x80)).toBe("���");
    expect(decode(0xe0, 0x9f, 0xbf)).toBe("���");
    expect(decode(0xf0, 0x80, 0x80, 0x80)).toBe("����");
    expect(decode(0xf0, 0x8f, 0xbf, 0xbf)).toBe("����");
  });

  it("turns encoded surrogates into U+FFFD", () => {
    expect(decode(0xed, 0xa0, 0x80)).toBe("���");
    expect(decode(0xed, 0xbf, 0xbf)).toBe("���");
  });

  it("gives the same answer as a standard decoder for these sequences", () => {
    for (const seq of [[0xc0, 0x80], [0xc1, 0x81], [0xe0, 0x80, 0x80], [0xf0, 0x80, 0x80, 0x80], [0xed, 0xa0, 0x80], [0x61, 0xc0, 0xaf, 0x62]]) {
      expect(decode(...seq), seq.join(" ")).toBe(standard(...seq));
    }
  });

  it("still decodes the shortest form at each length's edges", () => {
    expect(decode(0xc2, 0x80)).toBe("\u0080");
    expect(decode(0xe0, 0xa0, 0x80)).toBe("ࠀ");
    expect(decode(0xed, 0x9f, 0xbf)).toBe("퟿");
    expect(decode(0xee, 0x80, 0x80)).toBe("");
    expect(decode(0xf0, 0x90, 0x80, 0x80)).toBe("\u{10000}");
    expect(decode(0xf4, 0x8f, 0xbf, 0xbf)).toBe("\u{10FFFF}");
  });
});
