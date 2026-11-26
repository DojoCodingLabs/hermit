/**
 * SL-39 (US-PAY-04, HM-PAY-04): a QR code encoder, so the receive screen draws the address's code on the phone with no
 * network call and no extra dependency. Byte mode (UTF-8), error correction level M, versions 1 to 10 (up to 213
 * bytes; an address is 42). The steps follow ISO/IEC 18004: data bits, Reed-Solomon blocks over GF(256), function
 * patterns, the zigzag placement, and the mask with the lowest penalty.
 */
import { utf8ToBytes } from "@noble/hashes/utils.js";

export interface QrCode {
  /** Modules per side (21 for version 1, 4 more per version). */
  size: number;
  version: number;
  mask: number;
  /** `dark[y][x]`: true for a dark module. The four-module quiet zone around it is the renderer's to draw. */
  dark: boolean[][];
}

/** Level M per version 1 to 10: ECC codewords per block and the number of blocks. */
const ECC_PER_BLOCK = [10, 16, 26, 18, 24, 16, 18, 22, 22, 26];
const BLOCKS = [1, 1, 1, 2, 2, 4, 4, 4, 5, 5];
/** Level M's two format bits. */
const FORMAT_M = 0;
export const QR_MAX_VERSION = 10;

function rawDataModules(ver: number): number {
  let r = (16 * ver + 128) * ver + 64;
  if (ver >= 2) {
    const n = Math.floor(ver / 7) + 2;
    r -= (25 * n - 10) * n - 55;
    if (ver >= 7) r -= 36;
  }
  return r;
}

const dataCodewords = (ver: number) => Math.floor(rawDataModules(ver) / 8) - ECC_PER_BLOCK[ver - 1]! * BLOCKS[ver - 1]!;

/** Byte mode: 4 mode bits, an 8-bit count (16 from version 10), then the bytes. */
const bitsNeeded = (ver: number, bytes: number) => 4 + (ver < 10 ? 8 : 16) + 8 * bytes;

function gfMul(x: number, y: number): number {
  let z = 0;
  for (let i = 7; i >= 0; i--) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d);
    z ^= ((y >>> i) & 1) * x;
  }
  return z;
}

function rsDivisor(degree: number): number[] {
  const r = new Array<number>(degree).fill(0);
  r[degree - 1] = 1;
  let root = 1;
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < r.length; j++) {
      r[j] = gfMul(r[j]!, root);
      if (j + 1 < r.length) r[j]! ^= r[j + 1]!;
    }
    root = gfMul(root, 0x02);
  }
  return r;
}

function rsRemainder(data: readonly number[], divisor: readonly number[]): number[] {
  const r = new Array<number>(divisor.length).fill(0);
  for (const b of data) {
    const factor = b ^ r.shift()!;
    r.push(0);
    divisor.forEach((d, i) => (r[i]! ^= gfMul(d, factor)));
  }
  return r;
}

function alignmentPositions(ver: number, size: number): number[] {
  if (ver === 1) return [];
  const n = Math.floor(ver / 7) + 2;
  const step = Math.ceil((ver * 4 + 4) / (n * 2 - 2)) * 2;
  const out = [6];
  for (let pos = size - 7; out.length < n; pos -= step) out.splice(1, 0, pos);
  return out;
}

/** The data codewords for `bytes` at `ver`, padded, split into blocks with their ECC and interleaved. */
function codewords(bytes: Uint8Array, ver: number): number[] {
  const bits: number[] = [];
  const put = (value: number, len: number) => {
    for (let i = len - 1; i >= 0; i--) bits.push((value >>> i) & 1);
  };
  put(0b0100, 4);
  put(bytes.length, ver < 10 ? 8 : 16);
  for (const b of bytes) put(b, 8);
  const capacity = dataCodewords(ver) * 8;
  put(0, Math.min(4, capacity - bits.length));
  put(0, (8 - (bits.length % 8)) % 8);
  for (let pad = 0xec; bits.length < capacity; pad ^= 0xec ^ 0x11) put(pad, 8);
  const data: number[] = [];
  for (let i = 0; i < bits.length; i += 8) data.push(bits.slice(i, i + 8).reduce((a, b) => (a << 1) | b, 0));

  const numBlocks = BLOCKS[ver - 1]!;
  const eccLen = ECC_PER_BLOCK[ver - 1]!;
  const raw = Math.floor(rawDataModules(ver) / 8);
  const numShort = numBlocks - (raw % numBlocks);
  const shortLen = Math.floor(raw / numBlocks);
  const divisor = rsDivisor(eccLen);
  const blocks: number[][] = [];
  for (let i = 0, k = 0; i < numBlocks; i++) {
    const dat = data.slice(k, k + shortLen - eccLen + (i < numShort ? 0 : 1));
    k += dat.length;
    const ecc = rsRemainder(dat, divisor);
    // A short block gets a placeholder so every block has the same length; it is skipped when interleaving.
    if (i < numShort) dat.push(0);
    blocks.push([...dat, ...ecc]);
  }
  const out: number[] = [];
  for (let i = 0; i < blocks[0]!.length; i++) {
    blocks.forEach((b, j) => {
      if (i !== shortLen - eccLen || j >= numShort) out.push(b[i]!);
    });
  }
  return out;
}

const MASKS: ((x: number, y: number) => boolean)[] = [
  (x, y) => (x + y) % 2 === 0,
  (_x, y) => y % 2 === 0,
  (x) => x % 3 === 0,
  (x, y) => (x + y) % 3 === 0,
  (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0,
  (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
  (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0,
  (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
];

function build(ver: number, cw: readonly number[], mask: number): boolean[][] {
  const size = ver * 4 + 17;
  const dark = Array.from({ length: size }, () => new Array<boolean>(size).fill(false));
  const fixed = Array.from({ length: size }, () => new Array<boolean>(size).fill(false));
  const set = (x: number, y: number, on: boolean) => {
    dark[y]![x] = on;
    fixed[y]![x] = true;
  };

  for (let i = 0; i < size; i++) {
    set(6, i, i % 2 === 0);
    set(i, 6, i % 2 === 0);
  }
  const finder = (cx: number, cy: number) => {
    for (let dy = -4; dy <= 4; dy++) {
      for (let dx = -4; dx <= 4; dx++) {
        const d = Math.max(Math.abs(dx), Math.abs(dy));
        const x = cx + dx;
        const y = cy + dy;
        if (x >= 0 && x < size && y >= 0 && y < size) set(x, y, d !== 2 && d !== 4);
      }
    }
  };
  finder(3, 3);
  finder(size - 4, 3);
  finder(3, size - 4);
  const align = alignmentPositions(ver, size);
  const last = align.length - 1;
  align.forEach((ax, i) =>
    align.forEach((ay, j) => {
      if ((i === 0 && j === 0) || (i === 0 && j === last) || (i === last && j === 0)) return;
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) set(ax + dx, ay + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
    }),
  );

  // Format bits (level M and the mask), BCH(15, 5), twice.
  const fdata = (FORMAT_M << 3) | mask;
  let rem = fdata;
  for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
  const fbits = ((fdata << 10) | rem) ^ 0x5412;
  const fb = (i: number) => ((fbits >>> i) & 1) === 1;
  for (let i = 0; i <= 5; i++) set(8, i, fb(i));
  set(8, 7, fb(6));
  set(8, 8, fb(7));
  set(7, 8, fb(8));
  for (let i = 9; i < 15; i++) set(14 - i, 8, fb(i));
  for (let i = 0; i < 8; i++) set(size - 1 - i, 8, fb(i));
  for (let i = 8; i < 15; i++) set(8, size - 15 + i, fb(i));
  set(8, size - 8, true);

  // Version bits from version 7, BCH(18, 6), twice.
  if (ver >= 7) {
    let r = ver;
    for (let i = 0; i < 12; i++) r = (r << 1) ^ ((r >>> 11) * 0x1f25);
    const vbits = (ver << 12) | r;
    for (let i = 0; i < 18; i++) {
      const on = ((vbits >>> i) & 1) === 1;
      const a = size - 11 + (i % 3);
      const b = Math.floor(i / 3);
      set(a, b, on);
      set(b, a, on);
    }
  }

  // The zigzag, two columns at a time from the right, skipping the vertical timing column.
  let bit = 0;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let v = 0; v < size; v++) {
      for (let j = 0; j < 2; j++) {
        const x = right - j;
        const up = ((right + 1) & 2) === 0;
        const y = up ? size - 1 - v : v;
        if (fixed[y]![x] || bit >= cw.length * 8) continue;
        dark[y]![x] = ((cw[bit >>> 3]! >>> (7 - (bit & 7))) & 1) === 1;
        bit++;
      }
    }
  }

  const m = MASKS[mask]!;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (!fixed[y]![x] && m(x, y)) dark[y]![x] = !dark[y]![x];
  return dark;
}

/** ISO/IEC 18004's four penalty rules; the lowest total picks the mask. */
export function qrPenalty(dark: readonly (readonly boolean[])[]): number {
  const size = dark.length;
  let score = 0;
  const at = (x: number, y: number, rows: boolean) => (rows ? dark[y]![x]! : dark[x]![y]!);
  for (const rows of [true, false]) {
    for (let y = 0; y < size; y++) {
      let run = 1;
      for (let x = 1; x <= size; x++) {
        if (x < size && at(x, y, rows) === at(x - 1, y, rows)) run++;
        else {
          if (run >= 5) score += 3 + (run - 5);
          run = 1;
        }
      }
      // A finder-like 1:1:3:1:1 with four light modules on one side (outside the symbol counts as light).
      for (let x = -4; x < size; x++) {
        const v = (i: number) => (x + i >= 0 && x + i < size ? at(x + i, y, rows) : false);
        const core = v(4) && !v(5) && v(6) && v(7) && v(8) && !v(9) && v(10);
        if (!core) continue;
        const before = !v(0) && !v(1) && !v(2) && !v(3);
        const after = !v(11) && !v(12) && !v(13) && !v(14);
        if (before) score += 40;
        if (after) score += 40;
      }
    }
  }
  for (let y = 0; y + 1 < size; y++) {
    for (let x = 0; x + 1 < size; x++) {
      const c = dark[y]![x];
      if (c === dark[y]![x + 1] && c === dark[y + 1]![x] && c === dark[y + 1]![x + 1]) score += 3;
    }
  }
  let darkCount = 0;
  for (const row of dark) for (const c of row) if (c) darkCount++;
  const total = size * size;
  score += (Math.ceil(Math.abs(darkCount * 20 - total * 10) / total) - 1) * 10;
  return score;
}

/**
 * The QR code for `text` (UTF-8, byte mode, level M) at the smallest version that holds it. `mask` forces one of the
 * eight masks; otherwise the lowest penalty wins. Throws a RangeError past version 10.
 */
export function encodeQr(text: string, opts: { mask?: number } = {}): QrCode {
  const bytes = utf8ToBytes(text);
  let ver = 1;
  while (ver <= QR_MAX_VERSION && bitsNeeded(ver, bytes.length) > dataCodewords(ver) * 8) ver++;
  if (ver > QR_MAX_VERSION) throw new RangeError("Too long for a QR code here.");
  const cw = codewords(bytes, ver);
  if (opts.mask !== undefined && (!Number.isInteger(opts.mask) || opts.mask < 0 || opts.mask > 7)) throw new RangeError("A mask is 0 to 7.");
  let best: { mask: number; dark: boolean[][]; score: number } | undefined;
  for (const mask of opts.mask !== undefined ? [opts.mask] : [0, 1, 2, 3, 4, 5, 6, 7]) {
    const dark = build(ver, cw, mask);
    const score = opts.mask !== undefined ? 0 : qrPenalty(dark);
    if (!best || score < best.score) best = { mask, dark, score };
  }
  return { size: ver * 4 + 17, version: ver, mask: best!.mask, dark: best!.dark };
}

/** One row as runs of dark modules, `[start, length]`, so a renderer draws a few rectangles instead of every module. */
export function qrDarkRuns(row: readonly boolean[]): [number, number][] {
  const runs: [number, number][] = [];
  for (let x = 0; x < row.length; x++) {
    if (!row[x]) continue;
    const start = x;
    while (x + 1 < row.length && row[x + 1]) x++;
    runs.push([start, x - start + 1]);
  }
  return runs;
}
