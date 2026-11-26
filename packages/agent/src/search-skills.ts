import { parseWebUrl, searchRequestUrl, tidyQuery, type SearchProvider, type SearchProviderId, type WebFetchPort } from "@hermit/core";
import { skillById } from "@hermit/skills";
import { decodeEntities } from "./web-extract.ts";
import { fetchHtml, type HtmlOutcome, type WebLanguage } from "./web-skills.ts";
import type { SkillResult, SkillRuntime } from "./types.ts";

/** One search result as code read it from the provider's page. Every field is someone else's text (untrusted). */
export interface SearchResult {
  url: string;
  /** Parsed by code from the url, the only part of a result the main model sees. */
  domain: string;
  title: string;
  snippet: string;
}

/** The reader's context is small (8k tokens): a few results, each cut short. */
export const SEARCH_LIMITS = { results: 5, title: 120, snippet: 300 } as const;

/** Plain text: inline tags (the provider's bold query words) vanish, any other tag is a space. */
const text = (html: string, max: number) =>
  decodeEntities(html.replace(/<\/?(?:b|i|em|strong|span|mark|wbr)\b[^>]*>/gi, "").replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim().slice(0, max).trim();

const attr = (tag: string, name: string) => new RegExp(`\\s${name}\\s*=\\s*("([^"]*)"|'([^']*)')`, "i").exec(tag)?.slice(2).find((v) => v !== undefined);

/** Blocks of `html` that open with a `tag` whose class list has `cls`; `skip` drops blocks whose class list has it. */
function blocks(html: string, tag: string, cls: string, skip?: string): string[] {
  const opens = [...html.matchAll(new RegExp(`<${tag}\\b[^>]*>`, "gi"))].filter((m) => (attr(m[0], "class") ?? "").split(/\s+/).includes(cls));
  return opens
    .map((m, i) => ({ classes: (attr(m[0], "class") ?? "").split(/\s+/), body: html.slice(m.index!, opens[i + 1]?.index ?? html.length) }))
    .filter((b) => !skip || !b.classes.includes(skip))
    .map((b) => b.body);
}

/** DuckDuckGo links go through its redirect (`//duckduckgo.com/l/?uddg=<the real address>`). */
function ddgTarget(href: string): string {
  const raw = decodeEntities(href);
  const m = /[?&]uddg=([^&]+)/.exec(raw);
  if (!m) return raw.startsWith("//") ? `https:${raw}` : raw;
  try {
    return decodeURIComponent(m[1]!);
  } catch {
    return "";
  }
}

function anchor(block: string, cls: string): { href: string; inner: string } | undefined {
  for (const m of block.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)) {
    if ((attr(m[0], "class") ?? "").split(/\s+/).includes(cls)) return { href: attr(m[0], "href") ?? "", inner: m[2]! };
  }
  return undefined;
}

function parseDuckDuckGo(html: string) {
  return blocks(html, "div", "result", "result--ad").map((b) => {
    const a = anchor(b, "result__a");
    const snip = anchor(b, "result__snippet")?.inner ?? /<[a-z]+\b[^>]*class="[^"]*\bresult__snippet\b[^"]*"[^>]*>([\s\S]*?)<\/(?:td|div|span)>/i.exec(b)?.[1] ?? "";
    return a ? { href: ddgTarget(a.href), title: a.inner, snippet: snip } : undefined;
  });
}

function parseSearxng(html: string) {
  return blocks(html, "article", "result").map((b) => {
    const a = /<h3\b[^>]*>[\s\S]*?<a\b([^>]*)>([\s\S]*?)<\/a>/i.exec(b);
    const snip = /<p\b[^>]*class="[^"]*\bcontent\b[^"]*"[^>]*>([\s\S]*?)<\/p>/i.exec(b)?.[1] ?? "";
    return a ? { href: decodeEntities(attr(`<a${a[1]}>`, "href") ?? ""), title: a[2]!, snippet: snip } : undefined;
  });
}

/**
 * The results on a provider's page, read by code (no model): at most 5, each a public web address with a plain title
 * and snippet. Ads, links back to the provider and addresses that aren't public web pages are dropped.
 */
export function parseSearchResults(provider: SearchProviderId, html: string): SearchResult[] {
  const raw = provider === "duckduckgo" ? parseDuckDuckGo(html) : parseSearxng(html);
  const out: SearchResult[] = [];
  for (const r of raw) {
    const u = r && parseWebUrl(r.href);
    if (!r || !u || u.domain === "duckduckgo.com" || u.domain.endsWith(".duckduckgo.com")) continue;
    const title = text(r.title, SEARCH_LIMITS.title) || u.domain;
    out.push({ url: u.url, domain: u.domain, title, snippet: text(r.snippet, SEARCH_LIMITS.snippet) });
    if (out.length >= SEARCH_LIMITS.results) break;
  }
  return out;
}

/** What the quarantined reader is given: the results, numbered, with their site. */
export function readerText(results: SearchResult[]): string {
  return results.map((r, i) => [`${i + 1}. ${r.title}`, `Site: ${r.domain}`, ...(r.snippet ? [r.snippet] : [])].join("\n")).join("\n\n");
}

/** A provider's "are you a robot?" page instead of results (DuckDuckGo's anomaly check). */
const isBotCheck = (html: string) => /anomaly-modal|challenge-form|\/anomaly\.js|captcha/i.test(html);

export interface SearchSkillDeps {
  fetch: WebFetchPort;
  /** The provider chosen in settings for this turn, or undefined when search is off. */
  provider(): SearchProvider | undefined;
  /** The quarantined reader (FR-WEB-03): no skills, only the results and the user's own question. */
  read(input: { question: string; text: string; language: WebLanguage }): Promise<{ answer: string; quotes: string[] } | undefined>;
  language(userText: string): WebLanguage;
  /** Copy (CT-10): every sentence the user sees comes from the locale files. */
  t(language: WebLanguage, key: string, vars?: Record<string, string>): string;
}

const def = () => {
  const d = skillById("search_web");
  if (!d) throw new Error("skill search_web is missing from the catalog");
  return d;
};

type Failure = Exclude<HtmlOutcome["kind"], "html"> | "no_results" | "bot_check";

const FAILURE: Record<Failure, { key: string; model: string }> = {
  offline: { key: "HM-CHAT-01.searchOffline", model: "The phone is offline, so nothing was searched." },
  no_results: { key: "HM-CHAT-01.searchNoResults", model: "The search found no results." },
  bot_check: { key: "HM-CHAT-01.searchBlocked", model: "The search provider asked for a robot check instead of answering, so there are no results." },
  bad_url: { key: "HM-CHAT-01.searchFailed", model: "The search couldn't be made." },
  insecure: { key: "HM-CHAT-01.searchFailed", model: "The search provider redirected to plain http, so its answer wasn't read." },
  other_domain: { key: "HM-CHAT-01.searchFailed", model: "The search provider redirected to another site, so its answer wasn't read." },
  too_many_redirects: { key: "HM-CHAT-01.searchFailed", model: "The search provider kept redirecting, so its answer wasn't read." },
  timeout: { key: "HM-CHAT-01.searchFailed", model: "The search provider took too long to answer." },
  too_large: { key: "HM-CHAT-01.searchFailed", model: "The search provider's answer was too large to read." },
  not_html: { key: "HM-CHAT-01.searchFailed", model: "The search provider didn't answer with a results page." },
  http: { key: "HM-CHAT-01.searchFailed", model: "The search provider answered with an error." },
  payment_required: { key: "HM-CHAT-01.searchFailed", model: "The search provider asked for a payment, so nothing was searched or paid." },
  failed: { key: "HM-CHAT-01.searchFailed", model: "The search couldn't be made." },
};

/**
 * search_web (US-WEB-03, FR-WEB-04). Only the query goes to the provider chosen in settings. Titles and snippets go
 * only to the quarantined reader; the main model gets the reader's summary and code-made facts (provider, query,
 * sites), wrapped untrusted, and the turn ends on a reply written by code that cites the sites. So nothing in a
 * result can pick a skill, in this turn or through the main model.
 */
export function searchWebSkills(deps: SearchSkillDeps): SkillRuntime[] {
  return [
    {
      def: def(),
      destination: () => deps.provider()?.base,
      async execute(args, ctx): Promise<SkillResult> {
        const userText = ctx.userText ?? "";
        const lang = deps.language(userText);
        const provider = deps.provider();
        if (!provider) return { ok: false, untrusted: false, modelText: "Web search is off in settings, so nothing was searched.", reply: deps.t(lang, "HM-CHAT-01.searchOff") };
        // The cage decided on one destination, read once for this call; the sheet, if any, named one provider. If the
        // setting changed since either, what was decided is not what would run. No decided destination: fail closed.
        const decided = ctx.destination !== undefined && ctx.destination === provider.base;
        if (!decided || (ctx.approvedBinding !== undefined && ctx.approvedBinding !== provider.base)) {
          return { ok: false, untrusted: false, modelText: "The search provider changed after the approval, so nothing was searched.", reply: deps.t(lang, "HM-CHAT-01.searchChanged") };
        }
        // The user approved this provider on the sheet (FR-WEB-02): later searches to it this session don't ask. Its
        // own list, by exact address: it never approves reading pages on the provider's site. A run a bot's mode let
        // through is no one's approval, so it is never remembered.
        if (ctx.approvedArgsHash && !ctx.byMode) {
          const known = ctx.session.approvedSearchProviders ?? [];
          if (!known.includes(provider.base)) ctx.session.approvedSearchProviders = [...known, provider.base];
        }
        const query = tidyQuery(typeof args.query === "string" ? args.query : "");
        const vars = { provider: provider.label };
        const fail = (kind: Failure): SkillResult => ({ ok: false, untrusted: false, modelText: FAILURE[kind].model, reply: deps.t(lang, FAILURE[kind].key, vars) });
        if (!query) return fail("bad_url");

        const got = await fetchHtml(deps.fetch, searchRequestUrl(provider, query));
        // Nothing from a result reached anyone on a failure, so the session isn't tainted by it.
        if (got.kind !== "html") return fail(got.kind);
        const results = parseSearchResults(provider.id, got.body);
        if (!results.length) return fail(isBotCheck(got.body) ? "bot_check" : "no_results");

        const sources = [...new Set(results.map((r) => r.domain))].join(", ");
        const summary = await deps.read({ question: userText, text: readerText(results), language: lang }).catch(() => undefined);
        const facts = `Searched ${provider.label} for "${query}". Results from: ${sources}.`;
        if (!summary) {
          return {
            ok: true, untrusted: true, taintKind: "web",
            modelText: `${facts} No reliable answer came out of them.`,
            reply: deps.t(lang, "HM-CHAT-01.searchNoAnswer", { ...vars, sources }),
          };
        }
        return {
          ok: true, untrusted: true, taintKind: "web",
          modelText: `${facts} Summary by the reader: ${summary.answer}`,
          reply: deps.t(lang, "HM-CHAT-01.searchAnswer", { answer: summary.answer, sources }),
        };
      },
    },
  ];
}
