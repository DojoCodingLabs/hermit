import { parseWebUrl } from "./web.ts";

/**
 * search_web's provider (US-WEB-03, FR-WEB-04), chosen on HM-SET-02 and kept in the `search.provider` setting.
 * Q58: until the user picks, DuckDuckGo's HTML results (no key, no account); the first search in a session still
 * shows the approval sheet with the provider and the query. The user's own SearXNG instance is the other choice.
 */
export type SearchProviderId = "duckduckgo" | "searxng";

export interface SearchProvider {
  id: SearchProviderId;
  /** What the sheet and the privacy screen call it. */
  label: string;
  /** The https address searches go to; also what an approval is bound to. */
  base: string;
  /** What approvals are remembered by (FR-WEB-02). */
  domain: string;
}

/** A choice on HM-SET-02, before it is saved. */
export type SearchChoice = { id: "duckduckgo" } | { id: "off" } | { id: "searxng"; address: string };

const DUCKDUCKGO: SearchProvider = { id: "duckduckgo", label: "DuckDuckGo", base: "https://html.duckduckgo.com/html/", domain: "html.duckduckgo.com" };

/** A query longer than this is cut: the provider needs the question, not a paragraph. */
export const MAX_QUERY = 200;

/** The base address of a SearXNG instance: https, a public host, no query or fragment, ending in a slash. */
function searxBase(raw: string, upgrade: boolean): { base: string; host: string; domain: string } | undefined {
  const u = parseWebUrl(raw, { upgrade });
  if (u?.scheme !== "https") return undefined;
  const path = u.url.slice(`https://${u.host}`.length).replace(/[?#].*$/, "");
  const base = `https://${u.host}${path.endsWith("/") ? path : `${path}/`}`;
  return { base, host: u.host, domain: u.domain };
}

/**
 * The provider a setting names. Absent or empty: DuckDuckGo. "off", or anything this build can't read: none, so
 * nothing is searched (fail closed).
 */
export function searchProvider(setting: string | undefined): SearchProvider | undefined {
  if (setting === undefined || setting === "" || setting === "duckduckgo") return DUCKDUCKGO;
  if (setting.startsWith("searxng:")) {
    const s = searxBase(setting.slice("searxng:".length), false);
    return s ? { id: "searxng", label: `SearXNG (${s.host})`, base: s.base, domain: s.domain } : undefined;
  }
  return undefined;
}

/** The setting value for a choice, or undefined when a SearXNG address isn't a public https address. */
export function searchSetting(choice: SearchChoice): string | undefined {
  if (choice.id !== "searxng") return choice.id;
  const s = searxBase(choice.address, true);
  return s ? `searxng:${s.base}` : undefined;
}

/** The saved setting as HM-SET-02 shows it. A value that searches nowhere shows as off, which is how it behaves. */
export function searchChoiceOf(setting: string | undefined): SearchChoice {
  const p = searchProvider(setting);
  if (!p) return { id: "off" };
  return p.id === "searxng" ? { id: "searxng", address: p.base } : { id: "duckduckgo" };
}

/** The query as it is sent: one line, single spaces, at most MAX_QUERY characters. */
export function tidyQuery(query: string): string {
  return query.replace(/\s+/g, " ").trim().slice(0, MAX_QUERY).trim();
}

/** The one request a search makes. Only the query is in it (FR-WEB-04): no language, region, user or phone data. */
export function searchRequestUrl(provider: SearchProvider, query: string): string {
  const q = encodeURIComponent(tidyQuery(query));
  return provider.id === "duckduckgo" ? `${provider.base}?q=${q}` : `${provider.base}search?q=${q}`;
}
