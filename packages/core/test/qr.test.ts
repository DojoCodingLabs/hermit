/**
 * SL-39 (HM-PAY-04): the QR encoder. The fixtures are full symbols made by an independent encoder (`toqr` 0.1.1, the
 * one Expo's CLI prints with), stored as one hex number per row. With the same mask, Hermit's symbol must be equal to
 * the module: that checks the data bits, Reed-Solomon, interleaving, placement, format and version bits. Which mask
 * wins is a quality choice (every mask decodes), so it is checked against the penalty rules separately.
 */
import { describe, expect, test } from "vitest";
import { encodeQr, qrDarkRuns, qrPenalty } from "../src/qr.ts";

const ADDRESS = "0x9858EfFD232B4033E47d90003D41EC34EcaEda94";

const rows = (q: { dark: boolean[][]; size: number }) =>
  q.dark.map((r) => BigInt("0b" + r.map((b) => (b ? "1" : "0")).join("")).toString(16).padStart(Math.ceil(q.size / 4), "0"));

const V3_ADDRESS_MASK3 = ["1fd41a7f", "10585941", "1747f75d", "175c6c5d", "17467e5d", "1048c341", "1fd5557f", "001b1a00", "16e95b4b", "0f0f3255", "15fc0914", "02af830b", "1a75fd2f", "138c6f2f", "04ff8351", "108b45d2", "1148d119", "0a01778e", "12cf3d10", "06102f0c", "0dc117f9", "001e7719", "1fd91f5c", "10538310", "174b2df7", "17535e2d", "175d06ad", "1043e78a", "1fda9106"];
const V5_UTF8_MASK0 = ["1fc29caa7f", "105a78aa41", "1742d6555d", "1748e5555d", "175b32aa5d", "10457aaa41", "1fd555557f", "00065eaa00", "154a76aa12", "0517b6554d", "0b7af45557", "06acdaaaf0", "10fde8aa1b", "1c835555f9", "1562195503", "031de2aaa2", "06fce3aae0", "053363554f", "0dd9875597", "09a729aaf2", "17720aaa48", "1f905d55d5", "04dfd5551f", "0bb72eaaa2", "0ce936aae0", "02b076554e", "1573f45557", "0e14daaab1", "17e1a8abfb", "0019d5551d", "1fcc19575f", "1046e2a912", "1751e369f8", "174da3163e", "1757075497", "104729a9e2", "1fdfcaab7b"];
const V10_MASK4 = ["1fd977f7ca7ce7f", "104c5ba29f29a41", "174e5d082583e5d", "1754d65d40d625d", "175e7bffda7ca5d", "105e1d247f29c41", "1fd55555555557f", "001c1a4c7583400", "117a8127df29ef9", "113f17b7ca7cb7c", "11e3b21d60d61d6", "028f2a893583483", "17da81d09f29e29", "133f0722ca7cb7c", "136ba27760d61d6", "06033a1c3583480", "11da70ee9f29e2a", "1333f7b7ca7cb7c", "106bbf9d60d61d6", "008314c87583483", "11fd70a21f29e29", "1209f9b78a7cb7c", "1150b09da0d61d6", "18b117c80583483", "19d977a28f29e29", "1a39f1b7ea7cb7c", "09f13d9ff0d61f6", "011292cc7583513", "1f59bbad5f29f59", "031865b44a7c91c", "15f05d5fe0d61f6", "1313f28575835d3", "0d490bf3df29c79", "1f98855a8a7ca2f", "17f83d0c20d6387", "1723f26575835d0", "0e49b86cdf29c7b", "1a98c6bb8a7ca2c", "10f03fd220d6386", "14abcc8475835d3", "0ecdb523df29c79", "1b91cbba8a7ca2c", "18763adc20d6386", "0529c38545835d3", "1fffb7237f29c79", "02a9c3baca7ca2c", "14c63fdca0d6386", "1f38868535835d3", "004f5f27df29df9", "001b23b44a7cb1c", "1fd4dfdd60d6156", "104ab6c47583513", "175fbf57df29df9", "174b73a3ca7ca7f", "17400fb960d60d4", "1046b6dc3583580", "1fd35ca69f29f29"];

describe("the QR encoder (HM-PAY-04)", () => {
  test("an address is version 3 and equals an independent encoder's symbol module for module", () => {
    const q = encodeQr(ADDRESS, { mask: 3 });
    expect(q.version).toBe(3);
    expect(q.size).toBe(29);
    expect(rows(q)).toEqual(V3_ADDRESS_MASK3);
  });

  test("UTF-8 text (₮ is three bytes) with two blocks, and version 10 with version bits and five blocks", () => {
    expect(rows(encodeQr("Hermit ₮ " + "x".repeat(60), { mask: 0 }))).toEqual(V5_UTF8_MASK0);
    const v10 = encodeQr("w".repeat(200), { mask: 4 });
    expect(v10.version).toBe(10);
    expect(rows(v10)).toEqual(V10_MASK4);
  });

  test("without a forced mask, the lowest penalty wins", () => {
    const q = encodeQr(ADDRESS);
    const scores = [0, 1, 2, 3, 4, 5, 6, 7].map((m) => qrPenalty(encodeQr(ADDRESS, { mask: m }).dark));
    expect(qrPenalty(q.dark)).toBe(Math.min(...scores));
    expect(scores.indexOf(Math.min(...scores))).toBe(q.mask);
  });

  test("the smallest version that holds the text; too long or a bad mask refuses", () => {
    expect(encodeQr("a").version).toBe(1);
    expect(encodeQr("a".repeat(14)).version).toBe(1);
    expect(encodeQr("a".repeat(15)).version).toBe(2);
    expect(encodeQr("a".repeat(42)).version).toBe(3);
    expect(encodeQr("a".repeat(43)).version).toBe(4);
    expect(() => encodeQr("a".repeat(214))).toThrow(RangeError);
    expect(() => encodeQr("a", { mask: 8 })).toThrow(RangeError);
  });

  test("rows draw as runs of dark modules", () => {
    expect(qrDarkRuns([true, true, false, true, false, false, true])).toEqual([[0, 2], [3, 1], [6, 1]]);
    expect(qrDarkRuns([false, false])).toEqual([]);
  });
});
