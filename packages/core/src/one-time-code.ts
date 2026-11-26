/**
 * US-MSG-07, ASM-13: Android 15 and later hide one-time codes in notifications from listener apps like
 * Hermit. Older Android versions don't, so Hermit hides them itself before anything is stored or shown
 * to the model. The detector fails closed: a message that might carry a code is treated as one. Hiding an
 * ordinary message costs a little context; keeping a code would put a login secret on disk.
 */

// Words that announce a code, in Spanish and English, matched in lower case, with or without accents.
const KEYWORD =
  /(?<![\p{L}\p{N}])(?:c[oó]digos?|codes?|otp|pin|clave|contrase[nñ]a|password|passcode|token|verif\p{L}*|2fa|mfa|autentica\p{L}*|authenticat\p{L}*|one[\s-]?time|un solo uso|no (?:lo |la |le )?compart\p{L}*|nunca compart\p{L}*|don'?t share|do not share|never share)(?![\p{L}\p{N}])/u;

// 4 to 10 digits, optionally grouped by single spaces, dots or hyphens ("482913", "482-913", "88 21 74").
const DIGITS = /(?<![\p{L}\p{N}])\p{Nd}(?:[ \u00a0.-]?\p{Nd}){3,9}(?!\p{N})/u;
// Letters and digits mixed, 4 to 10 long ("AB7K2Q"); checked on the upper-cased text.
const ALNUM = /(?<![\p{L}\p{N}])(?=[A-Z0-9]*[0-9])(?=[A-Z0-9]*[A-Z])[A-Z0-9]{4,10}(?![\p{L}\p{N}])/u;
// A message that is nothing but a code ("482913", "G-482913").
const BARE = /^(?:[A-Z]{1,2}-)?\p{Nd}(?:[ \u00a0.-]?\p{Nd}){3,9}$/u;

/** Full-width digits become ASCII, and invisible format characters (zero-width spaces) are removed. */
function normalize(text: string): string {
  return text.normalize("NFKC").replace(/\p{Cf}/gu, "");
}

export function looksLikeOneTimeCode(text: string): boolean {
  const t = normalize(text).trim();
  if (!t) return false;
  if (BARE.test(t.toUpperCase())) return true;
  if (!KEYWORD.test(t.toLowerCase())) return false;
  return DIGITS.test(t) || ALNUM.test(t.toUpperCase());
}

// SL-56b (Q138): the code itself, out of one message Hermit fetched for a paused sign-in (an SMS the user allowed in
// Android's dialog, or an email from the site). Only the code leaves this function; the message is never stored and
// never reaches the model. It fails closed: no announcing word, or two different candidates, is no code, and the
// user types it on the page.

// 4 to 10 digits, optionally grouped by single spaces, dots or hyphens, every match in a line.
const DIGITS_ALL = /(?<![\p{L}\p{N}])\p{Nd}(?:[ \u00a0.-]?\p{Nd}){3,9}(?!\p{N})/gu;
// Upper-case letters and digits mixed, 4 to 10 long, as written (a mixed-case word is no code).
const ALNUM_ALL = /(?<![\p{L}\p{N}])(?=[A-Z0-9]*[0-9])(?=[A-Z0-9]*[A-Z])[A-Z0-9]{4,10}(?![\p{L}\p{N}])/gu;

/** The shape a code must have before anything shows it or types it: 4 to 10 upper-case letters or digits, one digit. */
export function codeShapeOk(code: string): boolean {
  return /^(?=[A-Z0-9]*[0-9])[A-Z0-9]{4,10}$/.test(code);
}

function candidates(line: string): string[] {
  const out: string[] = [];
  for (const m of line.matchAll(DIGITS_ALL)) out.push(m[0].replace(/[ \u00a0.-]/g, ""));
  for (const m of line.matchAll(ALNUM_ALL)) out.push(m[0]);
  return out;
}

/**
 * The one code in a message: the candidates on the lines that announce a code (and the line right after each, where
 * an email puts the code on its own), or a message that is nothing but a code. Undefined unless exactly one.
 */
export function extractOneTimeCode(text: string): string | undefined {
  const t = normalize(text).trim();
  if (!t) return undefined;
  if (BARE.test(t.toUpperCase())) {
    const code = t.replace(/^[A-Za-z]{1,2}-/, "").replace(/[ \u00a0.-]/g, "");
    return codeShapeOk(code) ? code : undefined;
  }
  const lines = t.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const found = new Set<string>();
  lines.forEach((line, i) => {
    if (!KEYWORD.test(line.toLowerCase())) return;
    for (const c of candidates(line)) found.add(c);
    const next = lines[i + 1];
    if (next !== undefined) for (const c of candidates(next)) found.add(c);
  });
  if (found.size !== 1) return undefined;
  const [code] = [...found];
  return code !== undefined && codeShapeOk(code) ? code : undefined;
}
