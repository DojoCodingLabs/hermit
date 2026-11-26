// Hermit's design tokens for the app (docs/design/polish/decisions.md). Every color is a docs/brand/tokens.json value,
// or a mix of two of them (`mix`): the surfaces between the canvas and white, the tonal fills between a surface and an
// accent, and the scrims. Light is Quiet craft; dark is Deep sea.
const light = {
  paper: "#F5EDE1", shell: "#EBDDCB", stone: "#D3C2AE", ink: "#2B221B", inkSoft: "#6B5E52",
  seaglass: "#4F7C6D", seaglassDeep: "#3B6456", coral: "#B4483A", amber: "#8A5912",
} as const;
const dark = {
  abyss: "#06121D", trench: "#0D2233", current: "#1A4A5E", kelp: "#8FA9B5", foam: "#E7F1F0", glow: "#5EF0CF",
  coral: "#FF8A7A", amber: "#F2B65A",
} as const;
const white = "#FFFFFF";

/** The color `t` of the way from `a` to `b` (both #RRGGBB), as #RRGGBB. */
export function mix(a: string, b: string, t: number): string {
  const ch = (c: string, i: number) => parseInt(c.slice(1 + i * 2, 3 + i * 2), 16);
  const hex = (i: number) => Math.round(ch(a, i) + (ch(b, i) - ch(a, i)) * t).toString(16).padStart(2, "0");
  return `#${hex(0)}${hex(1)}${hex(2)}`.toUpperCase();
}

/** A token color at partial opacity, for hairlines, pressed states and shadows (never for text). */
function alpha(hex: string, a: number): string {
  const ch = (i: number) => parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16);
  return `rgba(${ch(0)},${ch(1)},${ch(2)},${a})`;
}

// Surfaces, back to front: the canvas, sunken fields and tracks, raised groups and cards, overlay sheets.
const lightCanvas = light.paper;
const lightRaised = mix(light.paper, white, 0.6);
const lightOverlay = mix(light.paper, white, 0.7);
const lightSunken = mix(light.paper, light.shell, 0.5);
const darkCanvas = dark.abyss;
const darkRaised = dark.trench;
const darkOverlay = mix(dark.trench, dark.current, 0.3);
const darkSunken = mix(dark.abyss, dark.trench, 0.5);

/**
 * Roles, not raw colors. Contrast (WCAG 2.2, a11y-scan.test.ts): every text role passes 4.5:1 on the surfaces it is
 * drawn on; light amber and coral text stay off the sunken fill (their tints are mixed from the raised surface).
 * The older role names stay as aliases, so every screen reads the new surfaces without changing its code.
 */
export const palettes = {
  light: {
    dark: false,
    // Surfaces.
    canvas: lightCanvas, raised: lightRaised, overlay: lightOverlay, sunken: lightSunken,
    hairline: alpha(light.ink, 0.12), pressed: alpha(light.ink, 0.06),
    // Text.
    text: light.ink, textSoft: light.inkSoft,
    // Accent (Hermit), "needs you" (amber), blocked (coral), each with its tonal fill.
    accent: light.seaglassDeep, onAccent: light.paper, accentTint: mix(lightCanvas, light.seaglassDeep, 0.1), mark: light.seaglass,
    amber: light.amber, onAmber: light.paper, amberTint: mix(lightRaised, light.amber, 0.08),
    coral: light.coral, onCoral: light.paper, coralTint: mix(lightRaised, light.coral, 0.07),
    // Chat.
    userBubble: light.shell, userText: light.ink, hermitBubble: light.seaglassDeep, hermitText: light.paper, hermitBorder: light.seaglassDeep,
    // A sheet's backdrop, and the color soft shadows are tinted with.
    scrim: alpha(light.ink, 0.36), shadow: light.ink,
    track: lightSunken, meter: light.seaglassDeep,
    // The crab's quiet stage: a disc just off the canvas.
    stage: mix(light.paper, light.shell, 0.4),
    // The QR code is ink on paper in both themes, so every scanner reads it.
    qrInk: light.ink, qrPaper: light.paper,
    // Aliases of the first design pass (same colors, older names).
    background: lightCanvas, bg: lightCanvas, surface: lightRaised, sheet: lightOverlay, border: alpha(light.ink, 0.12), line: alpha(light.ink, 0.12),
    outline: light.inkSoft, soft: light.inkSoft, fill: light.seaglassDeep, onFill: light.paper, link: light.seaglassDeep,
    approve: light.amber, blocked: light.coral, logoTint: light.ink,
  },
  dark: {
    dark: true,
    canvas: darkCanvas, raised: darkRaised, overlay: darkOverlay, sunken: darkSunken,
    hairline: alpha(dark.foam, 0.1), pressed: alpha(dark.foam, 0.06),
    text: dark.foam, textSoft: dark.kelp,
    accent: dark.glow, onAccent: dark.abyss, accentTint: mix(darkCanvas, dark.glow, 0.12), mark: dark.glow,
    amber: dark.amber, onAmber: dark.abyss, amberTint: mix(darkCanvas, dark.amber, 0.12),
    coral: dark.coral, onCoral: dark.abyss, coralTint: mix(darkCanvas, dark.coral, 0.12),
    userBubble: dark.current, userText: dark.foam, hermitBubble: dark.trench, hermitText: dark.foam, hermitBorder: dark.current,
    scrim: alpha(dark.abyss, 0.7), shadow: "#000000",
    track: dark.current, meter: dark.glow,
    stage: mix(dark.abyss, dark.trench, 0.75),
    qrInk: light.ink, qrPaper: light.paper,
    background: darkCanvas, bg: darkCanvas, surface: darkRaised, sheet: darkOverlay, border: alpha(dark.foam, 0.1), line: alpha(dark.foam, 0.1),
    outline: dark.kelp, soft: dark.kelp, fill: dark.glow, onFill: dark.abyss, link: dark.glow,
    approve: dark.amber, blocked: dark.coral, logoTint: dark.foam,
  },
} as const;

export type Palette = (typeof palettes)[keyof typeof palettes];
/** A palette role that holds a color (every key but `dark`). */
export type ColorRole = Exclude<keyof Palette, "dark">;

/**
 * One radius family. 10: icon tiles and small marks; 14: fields, quotes and panels inside a surface; 20: groups, cards
 * and bubbles; 28: sheets; full: buttons, badges, avatars and the composer. Inner corners are the outer minus the gap.
 */
export const radius = { tile: 10, field: 14, card: 20, bubble: 20, sheet: 28, pill: 999 } as const;

/** The 4 pt grid. */
export const space = [4, 8, 12, 16, 20, 24, 32, 48, 64] as const;
/** The grid by name. `gutter` is every screen's side margin; `section` the gap between groups. */
export const s = { xs: 4, sm: 8, md: 12, lg: 16, gutter: 20, xl: 24, xxl: 32, section: 32, x3: 48, x4: 64 } as const;

/** The brand faces, embedded at build time by expo-font (app.json) and loaded by @font-face in the preview. */
export const font = { display: "Newsreader", ui: "InstrumentSans", mono: "JetBrainsMono" } as const;

/** Type sizes in dp (tokens.json's scale, plus 13 for footnotes and 56 for amounts). */
export const size = { caption: 12, footnote: 13, small: 14, body: 16, lead: 19, title: 26, display: 34, hero: 40, amount: 56 } as const;

/**
 * Soft shadows, tinted with the palette's shadow color: a raised group sits a little above the canvas, a sheet well
 * above everything. Deep sea leans on its lighter surfaces instead (elevation tints), so its shadows only deepen.
 */
export function shadow(p: Palette, level: "raised" | "overlay" | "lifted"): string | undefined {
  if (p.dark) return level === "overlay" ? "0px -12px 48px rgba(0,0,0,0.55)" : level === "lifted" ? "0px 8px 24px rgba(0,0,0,0.45)" : undefined;
  const c = (a: number) => alpha(p.shadow, a);
  if (level === "overlay") return `0px -10px 40px ${c(0.14)}, 0px -1px 3px ${c(0.05)}`;
  if (level === "lifted") return `0px 1px 2px ${c(0.08)}, 0px 6px 18px ${c(0.1)}`;
  return `0px 1px 2px ${c(0.05)}, 0px 4px 14px ${c(0.05)}`;
}
