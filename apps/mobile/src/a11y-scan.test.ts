/// <reference types="node" />
// US-SET-07, NFR-08: every control is labelled for TalkBack. Scans the screens and components for Pressable,
// Switch and TextInput tags that lack a role or a label, and checks the palettes meet WCAG 2.2 AA.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { contrast, stripComments, unlabelledControls } from "./a11y-scan.ts";
import { palettes } from "./theme.ts";

const SRC = new URL(".", import.meta.url).pathname;
const files = ["app", "components"].flatMap((dir) => readdirSync(join(SRC, dir)).filter((f) => f.endsWith(".tsx")).map((f) => join(dir, f))).concat(["app-lock.tsx"]);

test("the scanner flags a Pressable without a role or a label", () => {
  const src = `<Pressable onPress={() => go("/x")} style={s}>\n<Text>{t("a.b")}</Text></Pressable>`;
  assert.deepEqual(unlabelledControls(src), [{ tag: "Pressable", line: 1, missing: ["accessibilityRole", "accessibilityLabel"] }]);
});

test("the scanner accepts a labelled control and one hidden from TalkBack", () => {
  const src = [
    `<Pressable onPress={() => {}} accessibilityRole="button" accessibilityLabel={t("x.y")}>`,
    `<Pressable onPress={() => {}} accessible={false} style={{ a: 1 }}>`,
    `<Switch value={on} accessibilityLabel={t("x.y")} />`,
  ].join("\n");
  assert.deepEqual(unlabelledControls(src), []);
});

test("the scanner ignores tags inside comments and reads arrows inside braces", () => {
  const src = `// <Pressable onPress={x}>\n/* <Switch /> */\n<TextInput onChangeText={(v) => v > 1 && set(v)} accessibilityLabel={t("a.b")} />`;
  assert.equal(stripComments("a // b\nhttps://x.y // c").includes("https://x.y"), true);
  assert.deepEqual(unlabelledControls(src), []);
});

test("every control on every screen has a role and a label from copy", () => {
  const found = files.flatMap((f) => unlabelledControls(readFileSync(join(SRC, f), "utf8")).map((u) => `${f}:${u.line} ${u.tag} lacks ${u.missing.join(", ")}`));
  assert.deepEqual(found, []);
});

test("contrast is computed as WCAG defines it", () => {
  assert.equal(Math.round(contrast("#000000", "#FFFFFF") * 10) / 10, 21);
  assert.equal(contrast("#777777", "#777777"), 1);
});

test("both palettes meet WCAG 2.2 AA for text (4.5:1) and controls (3:1)", () => {
  for (const [name, p] of Object.entries(palettes)) {
    const text: Array<[string, string, string]> = [
      ["text on background", p.text, p.background],
      ["text on surface", p.text, p.surface],
      ["soft text on background", p.textSoft, p.background],
      ["soft text on surface", p.textSoft, p.surface],
      ["on-accent on accent", p.onAccent, p.accent],
      ["on-accent on blocked (the erase button)", p.onAccent, p.blocked],
      ["blocked on background", p.blocked, p.background],
      ["accent links on background", p.accent, p.background],
      ["accent links on surface", p.accent, p.surface],
      ["approve text on background (lock screen)", p.approve, p.background],
    ];
    for (const [what, fg, bg] of text) assert.ok(contrast(fg, bg) >= 4.5, `${name}: ${what} is ${contrast(fg, bg).toFixed(2)}:1`);
    const ui: Array<[string, string, string]> = [
      ["accent on background", p.accent, p.background],
      ["approve on background", p.approve, p.background],
    ];
    for (const [what, fg, bg] of ui) assert.ok(contrast(fg, bg) >= 3, `${name}: ${what} is ${contrast(fg, bg).toFixed(2)}:1`);
  }
});

test("the polish round's surfaces and tints meet WCAG 2.2 AA for the text and icons drawn on them", () => {
  for (const [name, p] of Object.entries(palettes)) {
    const text: Array<[string, string, string]> = [
      ["text on the canvas", p.text, p.canvas],
      ["text on a raised group", p.text, p.raised],
      ["text on a sheet", p.text, p.overlay],
      ["text in a field", p.text, p.sunken],
      ["soft text on the canvas", p.textSoft, p.canvas],
      ["soft text on a raised group", p.textSoft, p.raised],
      ["soft text on a sheet", p.textSoft, p.overlay],
      ["soft text in a field (placeholders, a disabled button)", p.textSoft, p.sunken],
      ["the accent on its tint (tonal buttons, badges)", p.accent, p.accentTint],
      ["amber on its tint (needs-you badges and cards)", p.amber, p.amberTint],
      ["coral on its tint (blocked badges, the destructive button)", p.coral, p.coralTint],
      ["text on an amber tint", p.text, p.amberTint],
      ["text on a coral tint", p.text, p.coralTint],
      ["soft text on an amber tint", p.textSoft, p.amberTint],
      ["soft text on a coral tint", p.textSoft, p.coralTint],
      ["on-accent on the primary button", p.onAccent, p.accent],
      ["accent links on a raised group", p.accent, p.raised],
      ["accent links on a sheet", p.accent, p.overlay],
      ["amber on a sheet", p.amber, p.overlay],
      ["coral on a sheet", p.coral, p.overlay],
    ];
    for (const [what, fg, bg] of text) assert.ok(contrast(fg, bg) >= 4.5, `${name}: ${what} is ${contrast(fg, bg).toFixed(2)}:1`);
    const ui: Array<[string, string, string]> = [
      ["accent icons on their tile", p.accent, p.accentTint],
      ["amber icons on their tile", p.amber, p.amberTint],
      ["coral icons on their tile", p.coral, p.coralTint],
      ["Hermit's mark on a raised group", p.mark, p.raised],
      ["Hermit's mark on a sheet", p.mark, p.overlay],
      ["a switch's outline on a raised group", p.outline, p.raised],
    ];
    for (const [what, fg, bg] of ui) assert.ok(contrast(fg, bg) >= 3, `${name}: ${what} is ${contrast(fg, bg).toFixed(2)}:1`);
  }
});

test("the design pass's color roles meet WCAG 2.2 AA where the screens pair them", () => {
  for (const [name, p] of Object.entries(palettes)) {
    const text: Array<[string, string, string]> = [
      ["your words on your bubble", p.userText, p.userBubble],
      ["Hermit's words on Hermit's bubble", p.hermitText, p.hermitBubble],
      ["on-fill on the primary button", p.onFill, p.fill],
      ["on-amber on amber", p.onAmber, p.amber],
      ["on-coral on coral", p.onCoral, p.coral],
      ["amber text on the page", p.amber, p.bg],
      ["amber text on the sheet", p.amber, p.sheet],
      ["coral text on the page", p.coral, p.bg],
      ["coral text on the sheet", p.coral, p.sheet],
      ["links on the page", p.link, p.bg],
      ["links on the sheet", p.link, p.sheet],
      ["soft text on the sheet", p.soft, p.sheet],
      ["soft text on a group", p.soft, p.surface],
      ["text on the sheet", p.text, p.sheet],
      ["the QR code", p.qrInk, p.qrPaper],
    ];
    for (const [what, fg, bg] of text) assert.ok(contrast(fg, bg) >= 4.5, `${name}: ${what} is ${contrast(fg, bg).toFixed(2)}:1`);
    const ui: Array<[string, string, string]> = [
      ["Hermit's icons on the page", p.mark, p.bg],
      ["Hermit's icons on a group", p.mark, p.surface],
      ["control outlines on the page", p.outline, p.bg],
      ["the meter on the page", p.meter, p.bg],
    ];
    for (const [what, fg, bg] of ui) assert.ok(contrast(fg, bg) >= 3, `${name}: ${what} is ${contrast(fg, bg).toFixed(2)}:1`);
  }
});
