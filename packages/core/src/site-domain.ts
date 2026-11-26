/**
 * SL-56b (Q138, Q141): which email sender may give a web task its one-time code. A site sends its codes from its own
 * registrable domain (`no-reply@example.com` for `https://shop.example.com`), so the sender's registrable domain must
 * equal the site's. There is no full public suffix list on the phone, so this fails closed: a host under a shared
 * hosting suffix gets one more label, a two-letter country domain with a common second level (`co.cr`, `com.mx`) gets
 * three, an IP address or a bare suffix gets none, and a free mail service (where anyone can have an address) never
 * counts. Parsed by hand: core has no `URL` (ES2022 lib only).
 */

// Hosts where anyone can publish a site: each subdomain is its own owner.
const SHARED = [
  "github.io", "gitlab.io", "vercel.app", "netlify.app", "pages.dev", "workers.dev", "web.app", "firebaseapp.com", "appspot.com",
  "herokuapp.com", "onrender.com", "fly.dev", "glitch.me", "blogspot.com", "wordpress.com", "wixsite.com", "squarespace.com",
  "azurewebsites.net", "cloudfront.net", "amazonaws.com", "ngrok.io", "ngrok.app", "repl.co", "surge.sh", "neocities.org",
];

// Second levels of two-letter country domains that are suffixes themselves (`co.cr`, `com.mx`, `gov.uk`).
const SECOND_LEVEL = new Set(["com", "co", "net", "org", "gov", "gob", "edu", "ac", "or", "go", "fi", "ed", "sa", "nom", "mil", "info", "biz", "ne", "gv", "ltd", "plc", "sch", "int", "web", "nic"]);

// Free mail services, by the first label of their registrable domain (`yahoo.com`, `hotmail.es`, `outlook.com.mx`).
const FREE_MAIL = new Set([
  "gmail", "googlemail", "outlook", "hotmail", "live", "msn", "yahoo", "ymail", "rocketmail", "icloud", "me", "mac", "aol", "proton",
  "protonmail", "pm", "gmx", "mail", "yandex", "zoho", "tutanota", "tuta", "fastmail", "hey", "inbox", "qq", "163", "126",
]);

const LABEL = /^(?!-)[a-z0-9-]{1,63}(?<!-)$/;

/** The registrable domain of a host name, or undefined when there is none Hermit can trust (an IP, a bare suffix). */
export function registrableDomain(host: string): string | undefined {
  const h = host.trim().toLowerCase().replace(/\.$/, "");
  const labels = h.split(".");
  if (labels.length < 2 || !labels.every((l) => LABEL.test(l))) return undefined;
  if (/^\d+$/.test(labels[labels.length - 1]!)) return undefined;
  const shared = SHARED.find((s) => h === s || h.endsWith(`.${s}`));
  const suffix = shared
    ? shared.split(".").length
    : labels[labels.length - 1]!.length === 2 && SECOND_LEVEL.has(labels[labels.length - 2]!) ? 2 : 1;
  if (labels.length <= suffix) return undefined;
  return labels.slice(-(suffix + 1)).join(".");
}

/** The bare address of a From header (`Name <a@b.c>` or `a@b.c`), lower case, or undefined. */
export function senderAddress(from: string): string | undefined {
  const angle = /<([^<>]*)>\s*$/.exec(from);
  const raw = (angle ? angle[1]! : from).trim().toLowerCase();
  return /^[^\s@<>"]+@[^\s@<>"]+$/.test(raw) ? raw : undefined;
}

/** The host of an https origin, or undefined. */
function httpsHost(origin: string): string | undefined {
  const m = /^https:\/\/([^/?#@:[\]]+)(?::\d{1,5})?$/i.exec(origin.trim());
  return m ? m[1]!.toLowerCase() : undefined;
}

/**
 * Whether an email's sender may give the code for this task's origin: its registrable domain is the site's, and the
 * site is no free mail service. The page's words never enter this: the origin is the recipe's, the sender the mail's.
 */
export function codeSenderMatches(from: string, origin: string): boolean {
  const host = httpsHost(origin);
  const address = senderAddress(from);
  if (!host || !address) return false;
  const site = registrableDomain(host);
  const sender = registrableDomain(address.slice(address.lastIndexOf("@") + 1));
  if (!site || site !== sender) return false;
  return !FREE_MAIL.has(site.split(".")[0]!);
}

/**
 * The WebOTP line (`@shop.example.com #482913`, the message's last line), or undefined. A line naming an embedded site
 * after the code (`... #482913 @widget.example`) is no line Hermit uses: that code is the embedded site's.
 */
export function webOtpLine(text: string): { host: string; code: string } | undefined {
  const lines = text.trim().split(/\r?\n/);
  const m = /^@([a-z0-9.-]+) #([A-Za-z0-9]{4,10})$/i.exec((lines[lines.length - 1] ?? "").trim());
  return m ? { host: m[1]!.toLowerCase().replace(/\.$/, ""), code: m[2]! } : undefined;
}

/**
 * SL-56b (security review, Q140): whether an SMS is bound to the task's site, so a code from any sender can't be typed.
 * With a WebOTP line (or anything that looks like one), only that: its host must be the origin's host exactly and its
 * code the one taken. Without one, the message must name the site's full registrable domain, or a host on it, as a
 * token, case-insensitive. A brand name alone ("Your Example code is 482913") is not enough: many sites' texts say
 * only that, and those fall back to the user typing the code. The page's words never enter this.
 */
export function smsBoundToOrigin(text: string, code: string, origin: string): boolean {
  const host = httpsHost(origin);
  const site = host ? registrableDomain(host) : undefined;
  if (!host || !site) return false;
  const lines = text.trim().split(/\r?\n/);
  if (/^\s*@\S+\s+#/.test(lines[lines.length - 1] ?? "")) {
    const otp = webOtpLine(text);
    return otp !== undefined && otp.host === host && otp.code === code;
  }
  const words = text.normalize("NFKC").toLowerCase().split(/[^\p{L}\p{N}.-]+/u).map((w) => w.replace(/^[.-]+|[.-]+$/g, ""));
  return words.some((w) => w === site || w.endsWith(`.${site}`));
}

/** The site's registrable domain an email sender must be on, or undefined when no email can give its code. */
export function codeMailDomain(origin: string): string | undefined {
  const host = httpsHost(origin);
  const site = host ? registrableDomain(host) : undefined;
  return site && !FREE_MAIL.has(site.split(".")[0]!) ? site : undefined;
}
