/**
 * The site ships in es-419 and English. Copy lives in `locales/*.json`, keyed by screen (the app's
 * `screenId.element` pattern, with HM-SITE-0x ids), and a missing key or placeholder fails the build.
 */
import en from "../locales/en.json";
import es from "../locales/es-419.json";

export type Lang = "en" | "es";
type Dict = Readonly<Record<string, string>>;

export const LANGS: readonly Lang[] = ["es", "en"];

/** The URL segment, the BCP 47 tag for `lang`/`hreflang`, and the copy for each language. */
export const LOCALE: Readonly<Record<Lang, { tag: string; dict: Dict; other: Lang }>> = {
  en: { tag: "en", dict: en, other: "es" },
  es: { tag: "es-419", dict: es, other: "en" },
};

export function isLang(value: string): value is Lang {
  return value === "en" || value === "es";
}

export function translator(lang: Lang) {
  const dict = LOCALE[lang].dict;
  return function t(key: string, vars: Record<string, string> = {}): string {
    const text = dict[key];
    if (text === undefined) throw new Error(`Missing copy key ${key} (${lang}).`);
    return text.replace(/\{(\w+)\}/g, (_, name: string) => {
      if (!(name in vars)) throw new Error(`Copy key ${key} needs {${name}}.`);
      return vars[name]!;
    });
  };
}

export type T = ReturnType<typeof translator>;

/** The site's pages, as paths under a language (trailing slash: every page is a folder with index.html). */
export type Page = "" | "privacy/" | "download/";

export const href = (lang: Lang, page: Page) => `/${lang}/${page}`;

/** The language of a `[lang]` route; only `es` and `en` are generated (dynamicParams is off). */
export async function langOf(params: Promise<{ lang: string }>): Promise<Lang> {
  const { lang } = await params;
  if (!isLang(lang)) throw new Error(`Unknown language ${lang}`);
  return lang;
}
