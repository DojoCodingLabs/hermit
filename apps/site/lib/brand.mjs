// The brand files the site serves, copied byte for byte from docs/brand (the logo lock: the reference drawing, never
// redrawn or recolored). scripts/copy-brand.mjs copies them into public/; scripts/check-site.mjs proves the copies
// still match their sources.
import { SHOW_PARTNERS } from "./site-config.mjs";

/** The partners line's logos (lib/site-config.mjs, SHOW_PARTNERS): served only while the line is on. */
export const PARTNER_FILES = [
  "partners/dojocoding-mark.png",
  "partners/qvac-logo-ink.svg",
  "partners/qvac-logo.svg",
  "partners/tether-logo-ink.svg",
  "partners/tether-logo.svg",
];

/** Every mascot pose the site shows, each with its Deep sea twin. */
const POSES = ["hello", "mark", "blink", "peek", "04-asking", "07-blocked", "11-new-phone"];

/** Paths relative to docs/brand. Each is served at /brand/<same path>. */
export const BRAND_FILES = [
  "logo/lockup-ink.svg",
  "logo/lockup-foam.svg",
  "logo/favicon.svg",
  "logo/png/favicon-32.png",
  "icons/app-icon-light.png",
  "applications/og-v2.png",
  ...POSES.flatMap((pose) => [`mascot/rig/${pose}.svg`, `mascot/rig/${pose}-dark.svg`]),
  ...(SHOW_PARTNERS ? PARTNER_FILES : []),
  "fonts/fonts.css",
  "fonts/InstrumentSans-normal-latin.woff2",
  "fonts/InstrumentSans-normal-latin-ext.woff2",
  "fonts/Newsreader-normal-latin.woff2",
  "fonts/Newsreader-normal-latin-ext.woff2",
  "fonts/Newsreader-italic-latin.woff2",
  "fonts/Newsreader-italic-latin-ext.woff2",
  "fonts/JetBrainsMono-normal-latin.woff2",
  "fonts/JetBrainsMono-normal-latin-ext.woff2",
  "fonts/OFL-Newsreader.txt",
  "fonts/OFL-InstrumentSans.txt",
  "fonts/OFL-JetBrainsMono.txt",
];
