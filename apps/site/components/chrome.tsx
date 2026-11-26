import { LOCALE, href, translator, type Lang, type Page } from "../lib/i18n";
import { REPO_URL, SHOW_PARTNERS, repoFile } from "../lib/site-config.mjs";
import { BrandImage } from "./brand-image";
import { Glyph } from "./glyphs";
import { ThemeToggle } from "./theme-toggle";

/** The signature, verbatim (AGENTS.md rule 8, BRANDBOOK "Signature"). It stays in English in both languages. */
export const SIGNATURE = {
  line: "Hermit, built by Dojo Coding (dojocoding.io). Powered by QVAC (qvac.tether.io) from Tether (tether.io).",
  disclaimer: "Hermit is an independent project, not affiliated with or endorsed by Tether.",
} as const;

/** The home page's sections, in page order, as header links: [anchor id, copy key]. */
const SECTIONS = [
  ["does", "common.navDoes"],
  ["private", "common.navPrivacy"],
  ["evals", "common.navEvals"],
  ["source", "common.navSource"],
  ["lab", "common.navLab"],
] as const;

export function Header({ lang, page }: { lang: Lang; page: Page }) {
  const t = translator(lang);
  const other = LOCALE[lang].other;
  const home = href(lang, "");
  return (
    <header className="site-header">
      <a className="skip" href="#main">{t("common.skip")}</a>
      <div className="bar">
        <a className="home" href={home} aria-current={page === "" ? "page" : undefined}>
          <BrandImage light="logo/lockup-ink.svg" dark="logo/lockup-foam.svg" alt={t("common.home")} width={135} height={52} eager />
        </a>
        <nav className="nav" aria-label={t("common.navLabel")}>
          <ul>
            {SECTIONS.map(([id, key]) => (
              <li key={id}><a href={`${home}#${id}`}>{t(key)}</a></li>
            ))}
          </ul>
        </nav>
        <div className="bar-end">
          <ThemeToggle t={t} />
          <a className="lang" href={href(other, page)} hrefLang={LOCALE[other].tag} lang={LOCALE[other].tag}>
            <span className="sr-only" lang={LOCALE[lang].tag}>{t("common.switchLabel")}: </span>
            {t("common.switchTo")}
          </a>
          <a className="button primary small" href={REPO_URL} aria-label={t("common.star")}>
            <Glyph name="star" />
            <span className="long">{t("common.star")}</span>
            <span className="short">{t("common.starShort")}</span>
          </a>
        </div>
      </div>
    </header>
  );
}

/** The three logos, in order (Dojo Coding, QVAC, Tether), then the signature and the not-affiliated line. */
export function Signature({ label }: { label: string }) {
  return (
    <div className="signature-block">
      <ul className="partners" aria-label={label}>
        <li>
          <a href="https://dojocoding.io">
            <BrandImage light="partners/dojocoding-mark.png" alt="Dojo Coding" width={40} height={40} />
          </a>
        </li>
        <li>
          <a href="https://qvac.tether.io/">
            <BrandImage light="partners/qvac-logo-ink.svg" dark="partners/qvac-logo.svg" alt="QVAC" width={148} height={16} />
          </a>
        </li>
        <li>
          <a href="https://tether.io/">
            <BrandImage light="partners/tether-logo-ink.svg" dark="partners/tether-logo.svg" alt="Tether" width={74} height={32} />
          </a>
        </li>
      </ul>
      <p className="signature" lang="en">
        Hermit, built by Dojo Coding (<a href="https://dojocoding.io">dojocoding.io</a>). Powered by QVAC (
        <a href="https://qvac.tether.io/">qvac.tether.io</a>) from Tether (<a href="https://tether.io/">tether.io</a>).
      </p>
      <p className="signature" lang="en">{SIGNATURE.disclaimer}</p>
    </div>
  );
}

/**
 * The legal lines every footer ends with: the partners line while SHOW_PARTNERS is on (lib/site-config.mjs), then
 * the trademark line and the app stores' marks with their not-affiliated line.
 */
export function Legal({ lang }: { lang: Lang }) {
  const t = translator(lang);
  return (
    <div className="legal">
      {SHOW_PARTNERS ? <Signature label={t("common.partnersLabel")} /> : null}
      <p>{t("common.footerTrademark")}</p>
      <p>{t("common.footerStores")}</p>
    </div>
  );
}

export function Footer({ lang }: { lang: Lang }) {
  const t = translator(lang);
  const links: ReadonlyArray<[string, string]> = [
    [href(lang, "privacy/"), t("common.footerPrivacy")],
    [href(lang, "download/"), t("common.footerDownload")],
    [REPO_URL, t("common.footerCode")],
    [repoFile("LICENSE"), t("common.footerLicense")],
    [repoFile("LICENSE-ART.md"), t("common.footerArt")],
  ];
  return (
    <footer className="site-footer">
      <div className="wrap footer-top">
        <div className="footer-brand">
          <BrandImage light="logo/lockup-ink.svg" dark="logo/lockup-foam.svg" alt="Hermit" width={135} height={52} />
          <p className="footer-tagline display">
            {t("HM-SITE-01.taglineA")} <em>{t("HM-SITE-01.taglineB")}</em>
          </p>
        </div>
        <nav aria-label={t("common.footerLabel")}>
          <ul className="footer-links">
            {links.map(([url, text]) => (
              <li key={url}><a href={url}>{text}</a></li>
            ))}
          </ul>
        </nav>
      </div>
      <div className="wrap">
        <Legal lang={lang} />
      </div>
    </footer>
  );
}
