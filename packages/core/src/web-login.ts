/**
 * SL-56 (US-CONN-07, FR-VAULT-04): a vault login for a service with no API, used only in the in-app browser. The
 * login step itself is SL-53's (the vault's login for the recipe's exact origin, a Keystore-signed `credential`
 * approval, the fill checked for origin in the same page call). This file is what comes after the sign-in click:
 * code reads what the page shows and decides whether the user is signed in, the site refused, or the site asks for a
 * one-time code or a captcha. A code or a captcha is the user's to do on the live page: Hermit never types or solves
 * one. A refusal is never reported as done.
 *
 * The page's report only ever stops or pauses a task. Nothing in it chooses an item, an origin or an action.
 */

/** What the page script reports after a sign-in click, from the top frame only. Page words: data, never instructions. */
export interface SignInFacts {
  /** A visible password field. */
  password: boolean;
  /** Visible text, number and tel inputs: their `autocomplete`, `name` (or id), label and `inputmode`. */
  fields: Array<{ autocomplete: string; name: string; label: string; inputmode: string }>;
  /** Every frame's address (`src`). */
  frames: string[];
  /** An element with a known captcha widget's class or a `data-sitekey`. */
  widget: boolean;
}

export type SignInCheck = "signed_in" | "rejected" | "code" | "captcha";

export const MAX_SIGNIN_FIELDS = 30;
export const MAX_SIGNIN_FRAMES = 20;

// A one-time code field, by its name or label, in English and Spanish. "Code" alone is not one (discount, postal).
const CODE_WORDS =
  /(?<![\p{L}\p{N}])(?:otp|totp|mfa|2fa|one[\s_-]?time|two[\s_-]?factor|2[\s_-]?step|two[\s_-]?step|verification[\s_-]?code|security[\s_-]?code|auth(?:entication)?[\s_-]?code|code (?:we|that we) sent|c[oó]digo (?:de )?(?:verificaci[oó]n|seguridad|acceso|confirmaci[oó]n|un solo uso)|c[oó]digo que te (?:enviamos|hemos enviado)|verificaci[oó]n en dos pasos)(?![\p{L}\p{N}])/iu;

/** Captcha providers' frames, by exact host (or a subdomain of the provider's own domain) and, for Google, the path. */
// Parsed by hand like `originOf`: core has no `URL` (ES2022 lib only, and Hermes's is incomplete). An address with
// user info is no frame address.
const FRAME_ADDRESS = /^https:\/\/([^/?#@:]+)(?::\d{1,5})?([/?#].*)?$/i;

function captchaFrame(src: string): boolean {
  const m = FRAME_ADDRESS.exec(src.trim());
  if (!m) return false;
  const host = m[1]!.toLowerCase().replace(/\.$/, "");
  const path = m[2] ?? "/";
  const under = (domain: string) => host === domain || host.endsWith(`.${domain}`);
  if ((host === "www.google.com" || under("recaptcha.net")) && path.startsWith("/recaptcha/")) return true;
  return under("hcaptcha.com") || host === "challenges.cloudflare.com" || under("arkoselabs.com") || under("funcaptcha.com");
}

function codeField(f: SignInFacts["fields"][number]): boolean {
  if (f.autocomplete.trim().toLowerCase() === "one-time-code") return true;
  return CODE_WORDS.test(f.name.normalize("NFC")) || CODE_WORDS.test(f.label.normalize("NFC"));
}

/**
 * The page after a sign-in click. A captcha or a code comes first (the user acts on the page, then the page is read
 * again); then a password field still showing means the site refused; otherwise the user is signed in.
 */
export function checkSignIn(f: SignInFacts): SignInCheck {
  if (f.widget || f.frames.some(captchaFrame)) return "captcha";
  if (f.fields.some(codeField)) return "code";
  if (f.password) return "rejected";
  return "signed_in";
}

/**
 * SL-56b (Q138, Q140): how long after the sign-in click a code may arrive and still be taken: five minutes, the time
 * Android's SMS User Consent API listens for one message. A message from before the click or after this is no code.
 */
export const CODE_WINDOW_MS = 5 * 60_000;

/**
 * SL-56b: the one field a code may be typed into, by its index in the page's report: exactly one one-time code field.
 * None, or several (one box per digit), is no field: the user types the code on the page.
 */
export function codeFieldIndex(f: SignInFacts): number | undefined {
  const hits = f.fields.flatMap((x, i) => (codeField(x) ? [i] : []));
  return hits.length === 1 ? hits[0] : undefined;
}

const cut = (v: unknown, max: number) => (typeof v === "string" ? v.slice(0, max) : "");

/**
 * The page script's report, checked field by field. A report that isn't one is undefined: the runner can't tell, so
 * the user checks the page. A field's unreadable part reads as empty, never dropping the field.
 */
export function asSignInFacts(raw: unknown): SignInFacts | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const o = raw as Record<string, unknown>;
  if (typeof o.password !== "boolean" || typeof o.widget !== "boolean" || !Array.isArray(o.fields) || !Array.isArray(o.frames)) return undefined;
  if (!o.frames.every((x) => typeof x === "string")) return undefined;
  const fields = o.fields.slice(0, MAX_SIGNIN_FIELDS).map((x) => {
    const y = (x && typeof x === "object" ? x : {}) as Record<string, unknown>;
    return { autocomplete: cut(y.autocomplete, 60), name: cut(y.name, 120), label: cut(y.label, 200), inputmode: cut(y.inputmode, 20) };
  });
  return { password: o.password, fields, frames: (o.frames as string[]).slice(0, MAX_SIGNIN_FRAMES).map((s) => s.slice(0, 500)), widget: o.widget };
}
