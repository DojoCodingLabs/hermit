import { isPublicHost } from "../spec.ts";

/** An HTTPS URL that passed every check, written one canonical way. */
export interface HttpsUrl {
  href: string;
  /** `https://host`, no port (only 443 is accepted). */
  origin: string;
  host: string;
  /** Starts with "/". */
  path: string;
  /** Without the "?". */
  query: string;
}

const MAX_URL = 2048;
// eslint-disable-next-line no-control-regex -- control characters are exactly what is refused
const REFUSED_CHARS = /[\s\u0000-\u001f\u007f\\#]/;
const PATH = /^\/[A-Za-z0-9\-._~!$&'()*+,;=:@%/]*$/;
const QUERY = /^[A-Za-z0-9\-._~!$&'()*+,;=:@%/?]*$/;
const DOT_SEGMENT = /(^|\/)(\.|%2e){1,2}(\/|$)/i;

/**
 * Parses a URL the MCP client may contact: HTTPS only, an exact public host name (`isPublicHost`, the same
 * check connector specs pass), port 443 or none, no userinfo, no fragment, no backslash, whitespace or
 * control character, and no dot segment. It does not use the platform's URL class: React Native's is a set
 * of regular expressions that reads `https://good.example#@evil.example/` as host `evil.example`, so a parser
 * differential there would let a check and the request disagree. Anything ambiguous is refused, not repaired.
 */
export function parseHttpsUrl(raw: string): HttpsUrl | undefined {
  if (typeof raw !== "string" || raw.length > MAX_URL || REFUSED_CHARS.test(raw)) return undefined;
  if (raw.slice(0, 8).toLowerCase() !== "https://") return undefined;
  const rest = raw.slice(8);
  const end = rest.search(/[/?]/);
  const authority = end === -1 ? rest : rest.slice(0, end);
  const tail = end === -1 ? "" : rest.slice(end);
  if (authority.includes("@") || authority.includes("[")) return undefined;
  const [hostPart, port, ...more] = authority.split(":");
  if (more.length || (port !== undefined && port !== "443")) return undefined;
  const host = (hostPart ?? "").toLowerCase();
  if (!isPublicHost(host)) return undefined;
  const q = tail.indexOf("?");
  const path = (q === -1 ? tail : tail.slice(0, q)) || "/";
  const query = q === -1 ? "" : tail.slice(q + 1);
  if (!PATH.test(path) || DOT_SEGMENT.test(path) || !QUERY.test(query)) return undefined;
  const origin = `https://${host}`;
  return { href: `${origin}${path}${query ? `?${query}` : ""}`, origin, host, path, query };
}

/** Where a 3xx points, through the same checks. Relative-path locations ("c", "../c") are refused. */
export function resolveRedirect(base: HttpsUrl, location: string): HttpsUrl | undefined {
  if (typeof location !== "string") return undefined;
  if (location.startsWith("//")) return parseHttpsUrl(`https:${location}`);
  if (location.startsWith("/")) return parseHttpsUrl(`${base.origin}${location}`);
  return parseHttpsUrl(location);
}

/** The URL without a trailing slash on its path, for comparing identifiers that some servers write both ways. */
export function withoutTrailingSlash(u: HttpsUrl): string {
  const path = u.path.length > 1 && u.path.endsWith("/") ? u.path.slice(0, -1) : u.path === "/" ? "" : u.path;
  return `${u.origin}${path}${u.query ? `?${u.query}` : ""}`;
}
