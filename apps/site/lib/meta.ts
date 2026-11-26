import type { Metadata } from "next";
import { LOCALE, href, translator, type Lang, type Page } from "./i18n";
import { SITE_URL } from "./site-config.mjs";

/** The link preview image (docs/brand/applications/og.png, 1200x630): the brand line, in English like all brand art. */
export const OG_IMAGE = { url: "/brand/applications/og.png", width: 1200, height: 630 } as const;

/** Open Graph locale names (language_TERRITORY); es_LA is the one link previews know for Latin American Spanish. */
const OG_LOCALE: Readonly<Record<Lang, string>> = { en: "en_US", es: "es_LA" };

/** The hreflang alternates of a page, both languages plus the chooser at the root as the default. */
function languages(page: Page) {
  return { [LOCALE.es.tag]: href("es", page), [LOCALE.en.tag]: href("en", page), "x-default": "/" };
}

/**
 * Title, description, canonical URL, hreflang alternates and the link preview of one page, all on SITE_URL
 * (joinhermit.com). Relative paths here resolve against `metadataBase`.
 */
export function pageMetadata(lang: Lang, screen: "HM-SITE-01" | "HM-SITE-02" | "HM-SITE-03", page: Page): Metadata {
  const t = translator(lang);
  const title = t(`${screen}.metaTitle`);
  const description = t(`${screen}.metaDescription`);
  const url = href(lang, page);
  const image = { ...OG_IMAGE, alt: t("common.ogAlt") };
  return {
    metadataBase: new URL(SITE_URL),
    title,
    description,
    alternates: { canonical: url, languages: languages(page) },
    openGraph: {
      type: "website",
      siteName: "Hermit",
      title,
      description,
      url,
      locale: OG_LOCALE[lang],
      alternateLocale: [OG_LOCALE[LOCALE[lang].other]],
      images: [image],
    },
    twitter: { card: "summary_large_image", title, description, images: [image] },
  };
}

/** The root address: the language chooser, which is also every page's x-default alternate. */
export function chooserMetadata(): Metadata {
  const t = translator("es");
  const title = t("HM-SITE-00.metaTitle");
  const description = t("HM-SITE-00.metaDescription");
  const image = { ...OG_IMAGE, alt: t("common.ogAlt") };
  return {
    metadataBase: new URL(SITE_URL),
    title,
    description,
    alternates: { canonical: "/", languages: languages("") },
    openGraph: { type: "website", siteName: "Hermit", title, description, url: "/", locale: OG_LOCALE.es, alternateLocale: [OG_LOCALE.en], images: [image] },
    twitter: { card: "summary_large_image", title, description, images: [image] },
  };
}
