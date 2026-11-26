// The root address. On Vercel, vercel.json sends Spanish browsers to /es/ and everyone else to /en/ before this page
// is reached; on any other static host this page lets the visitor pick, with no script. It is also every page's
// x-default alternate.
import type { Metadata } from "next";
import { BrandImage } from "../../components/brand-image";
import { Legal } from "../../components/chrome";
import { Glyph } from "../../components/glyphs";
import { ThemeToggle } from "../../components/theme-toggle";
import { LANGS, LOCALE, href, translator } from "../../lib/i18n";
import { chooserMetadata } from "../../lib/meta";

export const metadata: Metadata = chooserMetadata();

const NAME = { es: "Español", en: "English" } as const;

export default function Chooser() {
  const es = translator("es");
  return (
    <>
      <div className="corner-toggle">
        <ThemeToggle t={es} />
      </div>
      <main id="main" className="chooser">
        <div className="wrap chooser-inner">
          <BrandImage className="chooser-logo" light="logo/lockup-ink.svg" dark="logo/lockup-foam.svg" alt="Hermit" width={135} height={52} eager />
          <h1 className="sr-only">Hermit</h1>
          <div className="chooser-crab">
            <BrandImage light="mascot/rig/hello.svg" dark="mascot/rig/hello-dark.svg" alt={es("HM-SITE-01.mascotAlt")} width={693} height={601} eager />
          </div>
          <ul className="choices">
            {LANGS.map((lang) => {
              const t = translator(lang);
              return (
                <li key={lang} lang={LOCALE[lang].tag}>
                  <p className="display choice-line">
                    {t("HM-SITE-01.taglineA")} <em>{t("HM-SITE-01.taglineB")}</em>
                  </p>
                  <a className="button primary" href={href(lang, "")} hrefLang={LOCALE[lang].tag}>
                    {NAME[lang]}
                    <span className="button-icon" aria-hidden="true"><Glyph name="arrowRight" /></span>
                  </a>
                </li>
              );
            })}
          </ul>
        </div>
      </main>
      <footer className="site-footer">
        <div className="wrap">
          <Legal lang="es" />
        </div>
      </footer>
    </>
  );
}
