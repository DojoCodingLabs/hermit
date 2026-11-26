/**
 * SL-20, FR-VAULT-04: which origin an Android autofill request comes from, and whether a stored origin equals it
 * exactly. The Kotlin service in apps/mobile/modules/hermit-autofill mirrors this file (OriginMatch.kt); both run the
 * vectors in test/autofill-origin-vectors.json, so change them together.
 *
 * Origins are `https://host[:port]`, `http://host[:port]` or `android://<cert>@<package>`, where `<cert>` is the
 * SHA-256 of the app's signing certificate in base64url without padding (the Digital Asset Links and WebAuthn
 * `android:apk-key-hash` digest). A package name alone is not an identity: anyone can sideload an app under any
 * package name, but not with its owner's key.
 *
 * Exact means equal after canonical form only (lowercase scheme and host, no trailing dot, no default port): no
 * subdomains, no parent domains, no wildcards, no lookalike folding. A web domain is believed only from a browser whose
 * package and signing certificate are both on the allowlist; any other app that shows a web page is that app, because
 * it controls the page and could read what is filled.
 */

/** One web page node Android reported (ViewNode.getWebDomain and getWebScheme). Android reports no port. */
export interface AutofillWebNode {
  domain: string;
  scheme?: string;
}

export interface AutofillRequest {
  /** The requesting app's package (AssistStructure.getActivityComponent). */
  packageName: string;
  /** SHA-256 of each current signing certificate (SigningInfo.apkContentsSigners), base64url without padding. */
  certDigests: string[];
  /** The web origin of each field Hermit would fill, from its nearest ancestor with a web domain. */
  web: AutofillWebNode[];
}

/** Package name to the signing certificate digests that make it a trusted browser. */
export type BrowserAllowlist = Readonly<Record<string, readonly string[]>>;

/**
 * The browsers whose web domains Hermit believes: release builds from Google's Credential Manager privileged apps list
 * (https://www.gstatic.com/gpm-passkeys-privileged-apps/apps.json, read 2026-11-14), converted from colon hex.
 */
export const TRUSTED_BROWSERS: BrowserAllowlist = {
  "com.android.chrome": ["8P1sW0EPJcslw7UzRsiXL64w-O50Ed-RBICtay1g24M"],
  "com.sec.android.app.sbrowser": ["NN8Oep8c8YkuRcBWtJc82BzPFIpAUNEa6krFpl-QCkI"],
  "org.mozilla.firefox": ["p4tipRZbRJSy_q2edqKA0i2Tf-5iUa7OWZRGsuoxmwQ"],
};

export type OriginRefusal = "bad_package" | "no_signing_cert" | "multiple_signers" | "no_web_scheme" | "bad_web_origin" | "mixed_web_origins";

export type RequestOrigin = { ok: true; origin: string } | { ok: false; reason: OriginRefusal };

export type OriginMatch = { match: true; origin: string } | { match: false; origin?: string; reason: OriginRefusal | "no_match" };

const PACKAGE = /^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z][A-Za-z0-9_]*)+$/;
/** 32 bytes in base64url without padding: 43 characters, the last one carrying only 4 bits. */
const DIGEST = /^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/;
const APP = /^android:\/\/([^@]+)@(.+)$/;
const LABEL = "[a-z0-9](?:[a-z0-9-]*[a-z0-9])?";
const HOST = new RegExp(`^${LABEL}(?:\\.${LABEL})*$`);
const WEB = /^(https?):\/\/([^/:?#@\s]+)(?::(\d{1,5}))?\/?$/i;
const DEFAULT_PORT: Record<string, string> = { http: "80", https: "443" };

function host(raw: string): string | undefined {
  const h = raw.toLowerCase().replace(/\.$/, "");
  return HOST.test(h) ? h : undefined;
}

/** The canonical form of a stored or reported origin, or undefined when it is not exactly an origin. */
export function normalizeOrigin(origin: string): string | undefined {
  if (origin.startsWith("android://")) {
    const m = APP.exec(origin);
    return m && DIGEST.test(m[1]!) && PACKAGE.test(m[2]!) ? origin : undefined;
  }
  const m = WEB.exec(origin);
  if (!m) return undefined;
  const scheme = m[1]!.toLowerCase();
  const h = host(m[2]!);
  if (!h) return undefined;
  const port = m[3];
  if (port !== undefined) {
    const n = Number(port);
    if (port.startsWith("0") || n < 1 || n > 65535) return undefined;
    if (port !== DEFAULT_PORT[scheme]) return `${scheme}://${h}:${port}`;
  }
  return `${scheme}://${h}`;
}

/** The one origin a request comes from, or why none can be trusted. */
export function requestOrigin(request: AutofillRequest, browsers: BrowserAllowlist): RequestOrigin {
  if (!PACKAGE.test(request.packageName)) return { ok: false, reason: "bad_package" };
  const certs = request.certDigests;
  if (certs.length === 0 || !certs.every((d) => DIGEST.test(d))) return { ok: false, reason: "no_signing_cert" };
  if (certs.length > 1) return { ok: false, reason: "multiple_signers" };
  const cert = certs[0]!;
  const isBrowser = Object.prototype.hasOwnProperty.call(browsers, request.packageName) && browsers[request.packageName]!.includes(cert);
  if (!isBrowser || request.web.length === 0) return { ok: true, origin: `android://${cert}@${request.packageName}` };
  const seen = new Set<string>();
  for (const node of request.web) {
    if (!node.scheme) return { ok: false, reason: "no_web_scheme" };
    const scheme = node.scheme.toLowerCase();
    const h = host(node.domain);
    if ((scheme !== "https" && scheme !== "http") || !h) return { ok: false, reason: "bad_web_origin" };
    seen.add(`${scheme}://${h}`);
  }
  if (seen.size > 1) return { ok: false, reason: "mixed_web_origins" };
  return { ok: true, origin: [...seen][0]! };
}

/**
 * SL-36: one vault login as the autofill service sees it before anything is approved. `ref` is the item's id hash
 * (`vaultItemHash`, 64 hex), so the index never holds the id; `name` and `origins` are what FR-VAULT-02 already
 * treats as non-secret. Never a username, a password or a note.
 */
export interface LoginIndexEntry {
  ref: string;
  name: string;
  origins: string[];
}

/** The most logins offered for one form. The Kotlin service (LoginFills.MAX_OFFERED) offers the same. */
export const LOGIN_MAX_OFFERED = 5;

/** The logins offered to a request, in index order: `refs` is empty when none is, with the reason. */
export type LoginOffer = { origin?: string; reason?: OriginRefusal | "no_match"; refs: string[] };

const REF = /^[0-9a-f]{64}$/;

/**
 * SL-36, FR-VAULT-04: which vault logins may be offered to this request. Only an item that stores the requester's
 * exact origin (`matchAutofillOrigin`): a web page reported by a trusted browser, or an app by its signing key and
 * package. A malformed ref or stored origin never matches.
 */
export function loginsFor(request: AutofillRequest, index: readonly LoginIndexEntry[], browsers: BrowserAllowlist = TRUSTED_BROWSERS): LoginOffer {
  const from = requestOrigin(request, browsers);
  if (!from.ok) return { reason: from.reason, refs: [] };
  const refs = index
    .filter((e) => REF.test(e.ref) && e.origins.some((o) => normalizeOrigin(o) === from.origin))
    .map((e) => e.ref)
    .slice(0, LOGIN_MAX_OFFERED);
  return refs.length ? { origin: from.origin, refs } : { origin: from.origin, reason: "no_match", refs };
}

/** Whether a credential stored for `stored` origins may be offered to this request. Malformed stored origins never match. */
export function matchAutofillOrigin(request: AutofillRequest, stored: readonly string[], browsers: BrowserAllowlist = TRUSTED_BROWSERS): OriginMatch {
  const from = requestOrigin(request, browsers);
  if (!from.ok) return { match: false, reason: from.reason };
  const hit = stored.some((s) => normalizeOrigin(s) === from.origin);
  return hit ? { match: true, origin: from.origin } : { match: false, origin: from.origin, reason: "no_match" };
}
