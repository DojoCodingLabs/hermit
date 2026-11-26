import { isReadableType, parseWebUrl, resolveLocation, type WebFetchPort } from "@hermit/core";
import { skillById } from "@hermit/skills";
import { excerptFor, extractReadable } from "./web-extract.ts";
import type { SkillResult, SkillRuntime } from "./types.ts";

/** FR-WEB-01: at most 5 redirects and a 2 MB body; a time limit so a slow site can't hold the turn. */
export const WEB_LIMITS = {
  maxRedirects: 5,
  maxBytes: 2 * 1024 * 1024,
  timeoutMs: 15_000,
  /** What the reader is given: its context is 8k tokens, shared with its prompt and its answer. */
  readerChars: 8_000,
} as const;

export type FetchOutcome =
  | { kind: "page"; url: string; domain: string; title: string; text: string; truncated: boolean }
  | { kind: "bad_url" }
  /** A hop pointed to plain http. */
  | { kind: "insecure" }
  /** A hop pointed to another site, which the approval didn't cover. */
  | { kind: "other_domain"; to: string; toDomain: string }
  | { kind: "too_many_redirects" }
  | { kind: "offline" }
  | { kind: "timeout" }
  | { kind: "too_large" }
  | { kind: "not_html"; contentType: string }
  | { kind: "http"; status: number }
  /** SL-41: the site answered 402, asking for a payment. read_web never pays; it says so. */
  | { kind: "payment_required"; url: string; domain: string }
  | { kind: "empty" }
  | { kind: "failed" };

/** An https page's raw body after every hop passed the checks, or why it couldn't be had. */
export type HtmlOutcome =
  | { kind: "html"; url: string; domain: string; body: string; contentType: string; truncated: boolean }
  /**
   * SL-41: a 402 at an address that passed every hop check, with its x402 headers and body for code to parse
   * (`readMerchantOffer`). Untrusted: never shown to the model or the reader.
   */
  | { kind: "payment_required"; url: string; domain: string; status: 402; headers: Record<string, string>; body: string }
  | Exclude<FetchOutcome, { kind: "page" } | { kind: "empty" } | { kind: "payment_required" }>;

/**
 * Fetches an https address through the port (FR-WEB-01). Every hop is checked by code: https only, the same site as
 * the address the user approved, at most 5 redirects; an error status or a file that isn't a page is refused.
 */
export async function fetchHtml(port: WebFetchPort, address: string): Promise<HtmlOutcome> {
  const start = parseWebUrl(address);
  if (start?.scheme !== "https") return { kind: "bad_url" };
  let url = start.url;
  for (let hops = 0; ; hops++) {
    const hop = await port.get(url, { maxBytes: WEB_LIMITS.maxBytes, timeoutMs: WEB_LIMITS.timeoutMs });
    if (hop.kind === "error") return { kind: hop.reason };
    // The platform followed redirects itself and can't say where it landed: refuse rather than trust.
    if (hop.kind === "page" && hop.redirected && !hop.url) return { kind: "failed" };
    const landed = hop.kind === "redirect" ? resolveLocation(url, hop.location) : hop.url || url;
    const next = parseWebUrl(landed);
    if (!next) return { kind: "failed" };
    if (next.scheme !== "https") return { kind: "insecure" };
    if (next.domain !== start.domain) return { kind: "other_domain", to: next.url, toDomain: next.domain };
    if (hop.kind === "redirect") {
      if (hops >= WEB_LIMITS.maxRedirects) return { kind: "too_many_redirects" };
      url = next.url;
      continue;
    }
    if (hop.status === 402) return { kind: "payment_required", url: next.url, domain: next.domain, status: 402, headers: { ...hop.x402 }, body: hop.body };
    if (hop.status >= 400) return { kind: "http", status: hop.status };
    if (!isReadableType(hop.contentType)) return { kind: "not_html", contentType: hop.contentType.split(";")[0]!.trim() };
    return { kind: "html", url: next.url, domain: next.domain, body: hop.body, contentType: hop.contentType, truncated: hop.truncated };
  }
}

/** fetchHtml, then the page's readable text (read_web). */
export async function fetchReadable(port: WebFetchPort, address: string): Promise<FetchOutcome> {
  const got = await fetchHtml(port, address);
  if (got.kind === "payment_required") return { kind: "payment_required", url: got.url, domain: got.domain };
  if (got.kind !== "html") return got;
  const { title, text } = extractReadable(got.body, got.contentType);
  if (!text) return { kind: "empty" };
  return { kind: "page", url: got.url, domain: got.domain, title, text, truncated: got.truncated };
}

/** The page an answer used, for HM-WEB-01. Kept by the app in memory only; it is other people's text. */
export interface WebPageRecord {
  url: string;
  domain: string;
  title: string;
  /** Exactly what the reader was given. */
  text: string;
  /** The page was longer than the reader's share: only the parts closest to the question were used. */
  cut: boolean;
  /** The body was over 2 MB and was cut before reading. */
  truncated: boolean;
  answer?: string;
  quotes: string[];
}

export type WebLanguage = "es-419" | "en";

export interface WebSkillDeps {
  fetch: WebFetchPort;
  /**
   * The quarantined reader (FR-WEB-03): a separate model call with no skills that sees only the page text and the
   * user's own question. Undefined when it has no usable summary.
   */
  read(input: { question: string; text: string; language: WebLanguage }): Promise<{ answer: string; quotes: string[] } | undefined>;
  /** The language of the user's words, for the reader and the reply. */
  language(userText: string): WebLanguage;
  /** Copy (CT-10): every sentence the user sees comes from the locale files. */
  t(language: WebLanguage, key: string, vars?: Record<string, string>): string;
  /** Called with each page that was read, for HM-WEB-01. */
  onPage?(page: WebPageRecord): void;
}

const def = () => {
  const d = skillById("read_web");
  if (!d) throw new Error("skill read_web is missing from the catalog");
  return d;
};

const FAILURE: Record<Exclude<FetchOutcome["kind"], "page">, { key: string; model: string }> = {
  bad_url: { key: "HM-WEB-01.badUrl", model: "That isn't an https address, so nothing was opened." },
  insecure: { key: "HM-WEB-01.insecure", model: "The site redirected to plain http, so the page wasn't read." },
  other_domain: { key: "HM-WEB-01.otherDomain", model: "The site redirected to another site, which wasn't approved, so the page wasn't read." },
  too_many_redirects: { key: "HM-WEB-01.tooManyRedirects", model: "The site redirected more than 5 times, so the page wasn't read." },
  offline: { key: "HM-WEB-01.offline", model: "The phone is offline, so the page wasn't opened." },
  timeout: { key: "HM-WEB-01.timeout", model: "The site took too long to answer, so the page wasn't read." },
  too_large: { key: "HM-WEB-01.tooLarge", model: "The page is over 2 MB, so it wasn't downloaded." },
  not_html: { key: "HM-WEB-01.notHtml", model: "The link isn't a web page (it is a file), so it wasn't read." },
  http: { key: "HM-WEB-01.httpError", model: "The site answered with an error, so there was nothing to read." },
  // SL-41: reading never pays. Paying is its own skill, asked for by the user, with its own sheet and fingerprint.
  payment_required: { key: "HM-WEB-01.paymentRequired", model: "The site asks for a payment (HTTP 402) to show this page, so nothing was read or paid. The user can ask to pay for it." },
  empty: { key: "HM-WEB-01.empty", model: "The page has no readable text." },
  failed: { key: "HM-WEB-01.failed", model: "The page couldn't be opened." },
};

/**
 * A page's readable text, through the quarantined reader, as the turn's answer: the reader sees only the excerpt and
 * the user's question; the model gets the typed summary, untrusted. read_web uses it, and SL-41's pay_merchant for the
 * page it paid for.
 */
export async function answerFromPage(
  deps: Pick<WebSkillDeps, "read" | "t" | "onPage">,
  got: Extract<FetchOutcome, { kind: "page" }>,
  userText: string,
  lang: WebLanguage,
): Promise<SkillResult> {
  const title = got.title || got.domain;
  const excerpt = excerptFor(got.text, userText, WEB_LIMITS.readerChars);
  const summary = await deps.read({ question: userText, text: excerpt.text, language: lang }).catch(() => undefined);
  deps.onPage?.({
    url: got.url, domain: got.domain, title, text: excerpt.text, cut: excerpt.cut, truncated: got.truncated,
    ...(summary ? { answer: summary.answer } : {}), quotes: summary?.quotes ?? [],
  });
  if (!summary) {
    return {
      ok: true, untrusted: true,
      modelText: `Read the page "${title}" (${got.domain}), but no reliable answer came out of it.`,
      reply: deps.t(lang, "HM-WEB-01.noAnswer", { title, domain: got.domain }),
    };
  }
  const quoted = summary.quotes.length ? `\nQuotes: ${summary.quotes.map((q) => `"${q}"`).join("; ")}` : "";
  return {
    ok: true, untrusted: true,
    modelText: `Page "${title}" (${got.domain}), summarized by the reader: ${summary.answer}${quoted}`,
    reply: deps.t(lang, "HM-WEB-01.answer", { answer: summary.answer, title, domain: got.domain }),
  };
}

/**
 * read_web (US-WEB-01, US-WEB-02, US-WEB-04). The page goes only to the quarantined reader; the main loop gets the
 * reader's typed summary, wrapped as untrusted, and the turn ends on a reply written by code from it, citing the
 * page's title and domain. So nothing on the page can pick a skill, in this turn or through the main model.
 */
export function readWebSkills(deps: WebSkillDeps): SkillRuntime[] {
  return [
    {
      def: def(),
      async execute(args, ctx): Promise<SkillResult> {
        const userText = ctx.userText ?? "";
        const lang = deps.language(userText);
        const url = typeof args.url === "string" ? parseWebUrl(args.url) : undefined;
        // The user approved this domain on the sheet (FR-WEB-02): later fetches from it this session don't ask. A run a
        // bot's mode let through is no one's approval, so it is never remembered.
        if (url?.scheme === "https" && ctx.approvedArgsHash && !ctx.byMode) {
          const known = ctx.session.approvedDomains ?? [];
          if (!known.includes(url.domain)) ctx.session.approvedDomains = [...known, url.domain];
        }
        const got = await fetchReadable(deps.fetch, url?.url ?? "");
        if (got.kind !== "page") {
          const f = FAILURE[got.kind];
          const domain = url?.domain ?? "";
          const vars: Record<string, string> =
            got.kind === "other_domain" ? { domain, to: got.toDomain }
            : got.kind === "http" ? { domain, status: String(got.status) }
            : got.kind === "not_html" ? { domain, type: got.contentType || "?" }
            : { domain };
          // Nothing from the page reached anyone, so the session isn't tainted by a failure.
          return { ok: false, untrusted: false, modelText: f.model, reply: deps.t(lang, f.key, vars) };
        }
        return answerFromPage(deps, got, userText, lang);
      },
    },
  ];
}
