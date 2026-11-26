// US-SET-07, NFR-08: pure checks behind a11y-scan.test.ts. A source scan for controls TalkBack can't name, and the
// WCAG contrast ratio for the palettes in ./theme.ts.

const CONTROLS = ["Pressable", "Switch", "TextInput"] as const;
type Control = (typeof CONTROLS)[number];

/** Drops // and /* *\/ comments so a tag inside a comment isn't read as code; keeps `https://` inside strings. */
export function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
    .replace(/(^|[^:"'`\\])\/\/[^\n]*/g, (_, lead: string) => lead);
}

/** The text of a JSX opening tag from `start` (at `<`) up to its closing `>`, skipping braces and strings. */
function openingTag(src: string, start: number): string {
  let depth = 0;
  let quote: string | undefined;
  for (let i = start + 1; i < src.length; i++) {
    const c = src[i]!;
    if (quote) {
      if (c === quote && src[i - 1] !== "\\") quote = undefined;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") quote = c;
    else if (c === "{") depth++;
    else if (c === "}") depth--;
    else if (c === ">" && depth === 0) return src.slice(start, i + 1);
  }
  return src.slice(start);
}

/** Props at the top level of the tag only (not inside a `{...}` value). */
function topLevelProps(tag: string): Set<string> {
  const props = new Set<string>();
  let depth = 0;
  let quote: string | undefined;
  let word = "";
  for (let i = 0; i < tag.length; i++) {
    const c = tag[i]!;
    if (quote) {
      if (c === quote && tag[i - 1] !== "\\") quote = undefined;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") quote = c;
    else if (c === "{") depth++;
    else if (c === "}") depth--;
    if (depth === 0 && /[A-Za-z]/.test(c)) word += c;
    else {
      if (depth === 0 && c === "=" && word) props.add(word);
      word = "";
    }
  }
  return props;
}

/**
 * Controls with no `accessibilityRole` (Pressable) or no `accessibilityLabel`. A Pressable marked
 * `accessible={false}` (a sheet body that only swallows taps) is skipped: TalkBack never lands on it.
 */
export function unlabelledControls(source: string): Array<{ tag: Control; line: number; missing: string[] }> {
  const src = stripComments(source);
  const out: Array<{ tag: Control; line: number; missing: string[] }> = [];
  const re = new RegExp(`<(${CONTROLS.join("|")})(?=[\\s/>])`, "g");
  for (const m of src.matchAll(re)) {
    const tag = m[1] as Control;
    const text = openingTag(src, m.index);
    if (/\baccessible=\{false\}/.test(text)) continue;
    const props = topLevelProps(text);
    const missing = [
      ...(tag === "Pressable" && !props.has("accessibilityRole") ? ["accessibilityRole"] : []),
      ...(!props.has("accessibilityLabel") ? ["accessibilityLabel"] : []),
    ];
    if (missing.length) out.push({ tag, line: src.slice(0, m.index).split("\n").length, missing });
  }
  return out;
}

function luminance(hex: string): number {
  const n = hex.replace("#", "");
  const [r, g, b] = [0, 2, 4].map((i) => {
    const c = parseInt(n.slice(i, i + 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG 2.2 contrast ratio between two #RRGGBB colors, from 1 to 21. */
export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}
