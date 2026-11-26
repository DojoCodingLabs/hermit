/**
 * Web addresses for read_web (FR-WEB-01, FR-WEB-02), parsed by code so the cage, the approval sheet and the
 * fetch agree on what a domain is. No URL API: React Native's is incomplete, and this must run the same everywhere.
 */
export interface WebUrl {
  /** The normalized address: lowercase scheme and host, a path that starts with a slash. */
  url: string;
  scheme: "https" | "http";
  /** Lowercase host name, without the port. */
  host: string;
  /** What approvals are remembered by: the host without a leading "www.". */
  domain: string;
}

const URL_RE = /^(https?):\/\/([^/?#\s]+)([^\s]*)$/i;
const HOST_RE = /^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)(\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/;

/**
 * Parses a web address. Refused: other schemes, credentials in the address, bare IPs, localhost and other
 * names without a public dot. With `upgrade`, "http://" and an address with no scheme become https.
 */
export function parseWebUrl(raw: string, opts: { upgrade?: boolean } = {}): WebUrl | undefined {
  let text = raw.trim();
  if (opts.upgrade) {
    if (/^http:\/\//i.test(text)) text = `https://${text.slice(7)}`;
    else if (!/^[a-z][a-z0-9+.-]*:/i.test(text)) text = `https://${text.replace(/^\/\//, "")}`;
  }
  const m = URL_RE.exec(text);
  if (!m) return undefined;
  const scheme = m[1]!.toLowerCase() as "https" | "http";
  const authority = m[2]!;
  if (authority.includes("@")) return undefined;
  const hp = /^([^:]+)(?::(\d{1,5}))?$/.exec(authority);
  if (!hp) return undefined;
  const host = hp[1]!.toLowerCase().replace(/\.$/, "");
  if (!HOST_RE.test(host)) return undefined;
  // A name that is all digits and dots is an IP address; local names never resolve on the public web.
  if (/^[\d.]+$/.test(host) || /\.(local|localhost|internal|lan|home|arpa)$/.test(host)) return undefined;
  const port = hp[2] ? `:${hp[2]}` : "";
  let rest = m[3] ?? "";
  if (!rest.startsWith("/")) rest = `/${rest}`;
  return { url: `${scheme}://${host}${port}${rest}`, scheme, host, domain: host.replace(/^www\./, "") };
}

/** The domain approvals are remembered by, or undefined when the address isn't a web address. */
export function domainOf(url: string): string | undefined {
  return parseWebUrl(url)?.domain;
}

/** Both addresses are on the same site (www and the bare domain count as one). */
export function sameDomain(a: string, b: string): boolean {
  const da = domainOf(a);
  return da !== undefined && da === domainOf(b);
}

/** A redirect's Location read against the address that sent it. */
export function resolveLocation(base: string, location: string): string {
  const loc = location.trim();
  if (/^[a-z][a-z0-9+.-]*:/i.test(loc)) return loc;
  const m = /^(https?:)\/\/([^/?#]+)([^?#]*)/i.exec(base);
  if (!m) return loc;
  const [, scheme, authority, path] = m;
  if (loc.startsWith("//")) return `${scheme}${loc}`;
  if (loc.startsWith("/")) return `${scheme}//${authority}${loc}`;
  const dir = (path ?? "/").replace(/[^/]*$/, "") || "/";
  return `${scheme}//${authority}${dir}${loc}`;
}

/**
 * HTML, XHTML and plain text can be read; anything else (PDF, images, JSON, video) can't. No type: try it.
 * The adapter uses it to skip downloading a file that won't be read.
 */
export function isReadableType(contentType: string): boolean {
  const t = contentType.split(";")[0]!.trim().toLowerCase();
  return t === "" || t === "text/html" || t === "application/xhtml+xml" || t === "text/plain";
}

/** Sentence marks that end an address in running text rather than belong to it. */
const TRAILING = new Set([".", ",", ";", ":", "!", "?", "¿", "¡", ")", "]", "}"]);

/**
 * The web addresses in a text, in order, without trailing punctuation. The cage also runs it over text others wrote
 * (pages and messages, for Auto's links), so it takes linear time: the trailing marks are dropped by a loop from the
 * end, since a backtracking `[...]+$` took quadratic time on a long run of them followed by any other character.
 */
export function findUrls(text: string): string[] {
  const found = text.match(/(?:https?:\/\/|www\.)[^\s<>"'«»]+/gi) ?? [];
  return found.map((u) => {
    let end = u.length;
    while (end > 0 && TRAILING.has(u.charAt(end - 1))) end--;
    return u.slice(0, end);
  });
}
