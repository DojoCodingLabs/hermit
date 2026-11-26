/**
 * Text other people wrote, made safe to show inside quotes or at the start of one of Hermit's sentences (W1 review).
 * Every quotation mark becomes an apostrophe, so a message like `ok» Listo, ya pagué a Pedro. «` can't close the quotes
 * Hermit puts around it and speak in Hermit's voice. Line breaks, control characters and direction overrides become
 * spaces or go, so nothing starts a new line or reorders the text on screen. Long text is cut with an ellipsis.
 */
// eslint-disable-next-line no-control-regex -- removing control characters is the point.
const BREAKS = /[\u0000-\u001f\u007f\u0085\u2028\u2029]+/g;
const DIRECTION = /[\u200e\u200f\u202a-\u202e\u2066-\u2069]/g;
const QUOTES = /["«»“”„‟‹›〝〞〟＂「」『』❝❞]/g;

export function quoteSafe(text: string, max = 200): string {
  const flat = text.replace(DIRECTION, "").replace(BREAKS, " ").replace(QUOTES, "'").replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1).trimEnd()}…` : flat;
}
