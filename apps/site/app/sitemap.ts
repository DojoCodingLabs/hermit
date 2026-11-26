// sitemap.xml: every page in both languages on joinhermit.com, each with its hreflang alternates. Written once at
// build time (static export).
import type { MetadataRoute } from "next";
import { LANGS, LOCALE, href, type Page } from "../lib/i18n";
import { SITE_URL } from "../lib/site-config.mjs";

export const dynamic = "force-static";

const PAGES: readonly Page[] = ["", "privacy/", "download/"];

export default function sitemap(): MetadataRoute.Sitemap {
  const languages = (page: Page) => Object.fromEntries(LANGS.map((l) => [LOCALE[l].tag, `${SITE_URL}${href(l, page)}`]));
  return [
    { url: `${SITE_URL}/`, alternates: { languages: languages("") } },
    ...PAGES.flatMap((page) => LANGS.map((lang) => ({ url: `${SITE_URL}${href(lang, page)}`, alternates: { languages: languages(page) } }))),
  ];
}
