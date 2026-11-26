/// <reference types="node" />
// Shell avatars (multi-bot wave 1, Task 13): every look has art, every fill is a brand token (never the mode colors),
// and every fill stands out from its theme's canvas.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { SHELL_COLORS, SHELL_SHAPES } from "../../../packages/core/src/bots.ts";
import { SHELL_ART, SHELL_FILL } from "./shells.ts";
import { palettes } from "./theme.ts";

type TokenFile = { color: Record<"light" | "dark", Record<string, { value: string }>> };
const TOKENS = JSON.parse(readFileSync(new URL("../../../docs/brand/tokens.json", import.meta.url), "utf8")) as TokenFile;

function brandTokenValues(): string[] {
  return [...Object.values(TOKENS.color.light), ...Object.values(TOKENS.color.dark)].map((t) => t.value.toUpperCase());
}
const CORAL = [TOKENS.color.light.coral.value.toUpperCase(), TOKENS.color.dark.coral.value.toUpperCase()];
const AMBER = [TOKENS.color.light.amber.value.toUpperCase(), TOKENS.color.dark.amber.value.toUpperCase()];

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}
function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
}
const CANVAS = { light: palettes.light.canvas, dark: palettes.dark.canvas };

test("every shape and color has art", () => {
  for (const s of SHELL_SHAPES) { assert.ok(SHELL_ART[s].body.startsWith("M"), s); assert.equal(SHELL_ART[s].eyes.length, 2); }
  for (const c of SHELL_COLORS) assert.match(SHELL_FILL[c].light + SHELL_FILL[c].dark, /^#[0-9A-F]{6}#[0-9A-F]{6}$/i);
});

test("shell fills are brand tokens and never the mode colors", () => {
  const tokens = brandTokenValues();
  for (const c of SHELL_COLORS) for (const v of Object.values(SHELL_FILL[c])) {
    assert.ok(tokens.includes(v.toUpperCase()), v);
    assert.ok(![...CORAL, ...AMBER].includes(v.toUpperCase()), v);
  }
});

test("every shell stands out from its theme's canvas", () => {
  for (const c of SHELL_COLORS) for (const theme of ["light", "dark"] as const)
    assert.ok(contrast(SHELL_FILL[c][theme], CANVAS[theme]) >= 3, `${c} ${theme}`);
});

test("the canvases are the brand's paper and abyss", () => {
  assert.equal(CANVAS.light.toUpperCase(), TOKENS.color.light.paper!.value.toUpperCase());
  assert.equal(CANVAS.dark.toUpperCase(), TOKENS.color.dark.abyss!.value.toUpperCase());
});

/** The extent of a path made of absolute commands, from every coordinate pair it names. */
function extent(d: string): { w: number; h: number } {
  const n = (d.match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number);
  const xs = n.filter((_, i) => i % 2 === 0), ys = n.filter((_, i) => i % 2 === 1);
  return { w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
}

test("every shell is wide enough to read at 40 px", () => {
  for (const s of SHELL_SHAPES) { const { w, h } = extent(SHELL_ART[s].body); assert.ok(w >= h * 0.5, `${s} ${w} by ${h}`); }
});

// A tilted shell tilts its eyes with it, which moves their box by a unit or so.
test("the eyes are the same size on every shape", () => {
  const sizes = SHELL_SHAPES.map((s) => extent(SHELL_ART[s].eyes[0]));
  for (const e of sizes) { assert.ok(Math.abs(e.h - sizes[0]!.h) < 1.5, JSON.stringify(sizes)); assert.ok(Math.abs(e.w - sizes[0]!.w) < 1.5); }
});
