// WCAG 2.2 AA: every text color the stylesheet uses meets 4.5:1 on every surface it sits on, in both themes, and the
// chart's marks meet 3:1 on the Deep sea band.
import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

const css = readFileSync(new URL("../app/site.css", import.meta.url), "utf8");
const body = (re: RegExp) => re.exec(css)?.[1] ?? "";
const block = (text: string) => Object.fromEntries([...text.matchAll(/--([\w-]+):\s*(#[0-9A-Fa-f]{6})/g)].map((m) => [m[1]!, m[2]!]));
/** Every token a block declares, whatever its value, for comparing two blocks. */
const declarations = (text: string) => [...text.matchAll(/(--[\w-]+|color-scheme):\s*([^;]+);/g)].map((m) => `${m[1]}: ${m[2]!.trim()}`).sort();
// The dark tokens apply two ways (site.css, "Themes"): the system's dark when no theme is saved, and the switch's dark.
const darkSystem = body(/prefers-color-scheme:\s*dark\)\s*\{\s*:root:not\(\[data-theme="light"\]\)\s*\{([\s\S]*?)\}/);
const darkSwitch = body(/:root\[data-theme="dark"\]\s*\{([\s\S]*?)\}/);
const light = block(body(/:root\s*\{([\s\S]*?)\}/));
const dark = { ...light, ...block(darkSwitch) };

const lum = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
};
const ratio = (a: string, b: string) => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
};

// [text, surface]: body and secondary text, links and buttons on paper, the raised cards and the shell bands; the
// Deep sea band and its stat tiles; the code card; the sample approval sheet's bubbles, rows and button.
const TEXT: Array<[string, string]> = [
  ["text", "bg"], ["text", "raised"], ["text", "band"],
  ["text-soft", "bg"], ["text-soft", "raised"], ["text-soft", "band"],
  ["link", "bg"], ["link", "raised"], ["link", "band"],
  ["on-accent", "accent"], ["on-accent", "accent-hover"], ["caution", "bg"],
  ["deep-text", "deep-bg"], ["deep-soft", "deep-bg"], ["deep-accent", "deep-bg"],
  ["deep-text", "deep-raised"], ["deep-soft", "deep-raised"],
  ["code-text", "code-bg"], ["code-prompt", "code-bg"],
  ["text", "app-canvas"], ["text", "app-you"], ["app-hermit-text", "app-hermit"],
  ["text", "app-sheet"], ["text-soft", "app-sunken"], ["text", "app-sunken"],
];

// [mark, surface]: the chart's two series, as non-text marks (3:1).
const MARKS: Array<[string, string]> = [["series-generic", "deep-bg"], ["series-harness", "deep-bg"]];

describe("contrast (WCAG 2.2 AA)", () => {
  for (const [theme, vars] of [["light", light], ["dark", dark]] as const) {
    test(`${theme} theme: text at 4.5:1`, () => {
      expect(Object.keys(vars).length).toBeGreaterThan(20);
      for (const [fg, bg] of TEXT) {
        expect(vars[fg], `--${fg}`).toBeDefined();
        expect(vars[bg], `--${bg}`).toBeDefined();
        expect(ratio(vars[fg]!, vars[bg]!), `${theme} ${fg} on ${bg}`).toBeGreaterThanOrEqual(4.5);
      }
    });
    test(`${theme} theme: chart marks at 3:1`, () => {
      for (const [fg, bg] of MARKS) expect(ratio(vars[fg]!, vars[bg]!), `${theme} ${fg} on ${bg}`).toBeGreaterThanOrEqual(3);
    });
  }

  test("the system's dark theme and the switch's dark theme are the same tokens", () => {
    expect(declarations(darkSwitch).length).toBeGreaterThan(20);
    expect(declarations(darkSystem)).toEqual(declarations(darkSwitch));
  });

  test("the chart keeps the colors validated on the Deep sea surface", () => {
    expect(light["deep-bg"]).toBe("#06121D");
    expect(light["series-generic"]).toBe("#0A7397");
    expect(light["series-harness"]).toBe("#01AA8E");
    expect(dark["series-generic"]).toBe(light["series-generic"]);
    expect(dark["series-harness"]).toBe(light["series-harness"]);
  });
});
