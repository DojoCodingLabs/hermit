// 404.html: Next's default not-found page uses inline styles, which the content security policy refuses, so the site
// ships its own, in both languages, with the site's stylesheet.
import type { Metadata } from "next";
import "./site.css";
import { BrandImage } from "../components/brand-image";
import { Glyph } from "../components/glyphs";
import { Head, ThemeScript } from "../components/head";
import { ThemeToggle } from "../components/theme-toggle";
import { LANGS, LOCALE, href, translator } from "../lib/i18n";

const es = translator("es");

export const metadata: Metadata = { title: es("common.notFoundTitle"), robots: { index: false } };

export default function GlobalNotFound() {
  return (
    <html lang={LOCALE.es.tag}>
      <Head />
      <body>
        <div className="corner-toggle">
          <ThemeToggle t={es} />
        </div>
        <main id="main" className="chooser">
          <div className="wrap chooser-inner">
            <div className="chooser-crab">
              <BrandImage light="mascot/rig/07-blocked.svg" dark="mascot/rig/07-blocked-dark.svg" alt={es("HM-SITE-01.blockedAlt")} width={693} height={601} eager />
            </div>
            <ul className="choices">
              {LANGS.map((lang) => {
                const t = translator(lang);
                const Title = lang === "es" ? "h1" : "p";
                return (
                  <li key={lang} lang={LOCALE[lang].tag}>
                    <Title className="display choice-line">{t("common.notFoundTitle")}</Title>
                    <a className="button primary" href={href(lang, "")} hrefLang={LOCALE[lang].tag}>
                      {t("common.notFoundHome")}
                      <span className="button-icon" aria-hidden="true"><Glyph name="arrowRight" /></span>
                    </a>
                  </li>
                );
              })}
            </ul>
          </div>
        </main>
        <ThemeScript />
      </body>
    </html>
  );
}
