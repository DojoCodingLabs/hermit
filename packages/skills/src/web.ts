import { findUrls, MAX_QUERY, parseWebUrl, skillId, tidyQuery, type JsonSchema, type NormalizeContext, type SkillDef } from "@hermit/core";

type Args = Record<string, unknown>;

const https = (raw: string) => parseWebUrl(raw, { upgrade: true });

/**
 * read_web.url from the user's own words (US-WEB-01): a small model shortens or invents links, and the sheet
 * must show the page the user meant. The links in this message, else in the user's latest earlier message that
 * had any; the model's pick stands when it is one of them, the only one replaces it otherwise. Always https.
 */
export function normalizeReadWeb(args: Args, ctx: NormalizeContext): { args: Args; notes: string[] } {
  const given = typeof args.url === "string" ? args.url : "";
  const mine = (text: string) => findUrls(text).map((u) => https(u)?.url).filter((u): u is string => u !== undefined);
  let said = mine(ctx.userText);
  if (!said.length) said = (ctx.earlier ?? []).map(mine).find((l) => l.length) ?? [];
  const upgraded = https(given)?.url;
  if (upgraded && (said.includes(upgraded) || said.length !== 1)) {
    return { args: { ...args, url: upgraded }, notes: upgraded === given ? [] : ["url: made https"] };
  }
  if (said.length === 1) return { args: { ...args, url: said[0] }, notes: said[0] === given ? [] : ["url: taken from the user's words"] };
  return { args, notes: [] };
}

/** search_web.query: one line, single spaces, capped (the provider gets exactly what the sheet shows). */
export function normalizeSearchWeb(args: Args): { args: Args; notes: string[] } {
  if (typeof args.query !== "string") return { args, notes: [] };
  const query = tidyQuery(args.query);
  return query === args.query ? { args, notes: [] } : { args: { ...args, query }, notes: ["query: tidied"] };
}

const searchArgs: JsonSchema = {
  type: "object",
  properties: { query: { type: "string", description: "What to look up, short, in the user's language", minLength: 1, maxLength: MAX_QUERY } },
  required: ["query"],
  additionalProperties: false,
};

const args: JsonSchema = {
  type: "object",
  properties: { url: { type: "string", description: "The page's full address exactly as the user gave it, starting with https://", maxLength: 2048 } },
  required: ["url"],
  additionalProperties: false,
};

/**
 * Web reading (FR-WEB-01 to FR-WEB-03). A fetch is a network risk: the cage asks the first time per domain per
 * session. The page itself never reaches the main model; only the quarantined reader's summary does.
 */
export const webSkills: readonly SkillDef<Args>[] = [
  {
    id: skillId("read_web"), version: 1, risk: "network", producesUntrusted: true,
    menuLine: "Open a web page the user gives a link to and answer their question about it (\"what does this page say about refunds?\", \"summarize this link\", \"¿qué dice esta página?\", \"resúmeme este enlace\").",
    args,
    normalize: normalizeReadWeb,
    describeAction: (a) => {
      const url = typeof a.url === "string" ? parseWebUrl(a.url) : undefined;
      // Only an https address can be fetched, so only one can be approved (FR-WEB-01).
      if (url?.scheme !== "https") return { title: "Open this page?", lines: [], unresolved: "That isn't a secure web address (https), so I can't open it." };
      return { title: "Open this page?", lines: [{ label: "Page", labelKey: "page", value: url.url }, { label: "Site", labelKey: "site", value: url.domain }] };
    },
  },
  {
    // US-WEB-03, FR-WEB-04: only the query goes to the provider chosen in settings; the cage asks the first time per
    // provider per session. Results reach the main model only through the quarantined reader.
    id: skillId("search_web"), version: 1, risk: "network", producesUntrusted: true,
    menuLine: "Search the web for current facts: news, weather, prices, opening hours, results, anything recent (\"busca en internet...\", \"¿va a llover mañana en Lima?\", \"search the web for...\", \"who won last night?\"). For a link the user gave, use read_web.",
    args: searchArgs,
    normalize: normalizeSearchWeb,
    describeAction: (a, ctx) => {
      const query = typeof a.query === "string" ? a.query : "";
      if (!ctx.search) return { title: "Search the web?", lines: [], unresolved: "Web search is off in Settings, Privacy, so nothing was searched. Tell the user they can pick a search provider there." };
      return {
        title: "Search the web?",
        lines: [{ label: "Search", labelKey: "search", value: query }, { label: "Provider", labelKey: "provider", value: ctx.search.label }],
        // The executor refuses if the provider changed after the sheet showed this one.
        binding: ctx.search.base,
      };
    },
  },
];
