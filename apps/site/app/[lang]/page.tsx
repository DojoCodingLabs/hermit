// HM-SITE-01: the joinhermit.com home page. What Hermit is, what works today and what is coming, how it
// stays private, the harness results, the code, the device lab and the stores. No script: HTML and CSS only.
import type { Metadata } from "next";
import { Fragment } from "react";
import { BrandImage } from "../../components/brand-image";
import { Footer, Header } from "../../components/chrome";
import { DeviceLab } from "../../components/device-lab";
import { Glyph } from "../../components/glyphs";
import { HarnessChart, HarnessStats } from "../../components/harness-chart";
import { HeroCrab } from "../../components/hero-crab";
import { ApprovalPhone } from "../../components/phone";
import { StoreBadges } from "../../components/store-badges";
import { MODEL } from "../../lib/harness";
import { href, langOf, translator } from "../../lib/i18n";
import { pageMetadata } from "../../lib/meta";
import { RELEASE } from "../../lib/release";
import { REPO_URL, repoTree } from "../../lib/site-config.mjs";

type Props = { params: Promise<{ lang: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  return pageMetadata(await langOf(params), "HM-SITE-01", "");
}

/** What works in the code today, and what is still being built (shown under "Coming"). Copy: `<id>Title`, `<id>Body`. */
const TODAY = ["chat", "memory", "reminders", "calendar", "whatsapp", "mail", "vault", "wallet"] as const;
const COMING = ["bots", "routines", "companion"] as const;
/** The facts under the hero. Copy: `spec<Id>` and `spec<Id>Value`. */
const SPECS = ["RunsOn", "Telemetry", "License", "Status"] as const;
/** The privacy rules. Copy: `promise<Id>Title`, `promise<Id>Body`. */
const PROMISES = ["Local", "Memory", "Ok", "Finger", "Telemetry", "Open"] as const;

/** Get the code and run its privacy checks. `git clone` makes a folder named after the repository. */
const COMMANDS = [`git clone ${REPO_URL}`, `cd ${REPO_URL.split("/").pop()}`, "pnpm install", "pnpm check:privacy && pnpm test"];

/** A command that may wrap after each slash on a narrow screen, never in the middle of a word. */
const breakable = (command: string) =>
  command.split("/").map((part, i) => (
    <Fragment key={i}>
      {i > 0 ? (
        <>
          /<wbr />
        </>
      ) : null}
      {part}
    </Fragment>
  ));

export default async function Home({ params }: Props) {
  const lang = await langOf(params);
  const t = translator(lang);
  const k = (key: string, vars?: Record<string, string>) => t(`HM-SITE-01.${key}`, vars);
  const star = (
    <a className="button primary" href={REPO_URL}>
      <Glyph name="star" />
      {t("common.star")}
    </a>
  );
  return (
    <>
      <Header lang={lang} page="" />
      <main id="main" tabIndex={-1}>
        <section className="hero" aria-labelledby="tagline">
          <div className="wrap hero-grid">
            <div className="hero-text">
              <p className="kicker pill rise">{k("kicker")}</p>
              <h1 id="tagline" className="display hero-title rise rise-1">
                <span>{k("taglineA")}</span> <em>{k("taglineB")}</em>
              </h1>
              <p className="hero-lede rise rise-2">{k("lede")}</p>
              <p className="actions rise rise-3">
                {star}
                <a className="button ghost" href="#private">
                  {k("ctaPrivate")}
                  <span className="button-icon" aria-hidden="true"><Glyph name="arrowRight" /></span>
                </a>
              </p>
              <div className="hero-stores rise rise-4">
                <StoreBadges t={t} lang={lang} />
                <p className="fine-note">{k("storesNote")}</p>
              </div>
            </div>
            <div className="hero-art rise rise-2">
              <HeroCrab alt={k("mascotAlt")} />
            </div>
          </div>
          <div className="wrap">
            <dl className="specs" aria-label={k("specsLabel")}>
              {SPECS.map((s) => (
                <div key={s}>
                  <dt>{k(`spec${s}`)}</dt>
                  <dd>{k(`spec${s}Value`)}</dd>
                </div>
              ))}
            </dl>
          </div>
        </section>

        <section id="does" className="section" aria-labelledby="does-title">
          <div className="wrap">
            <header className="section-head split-head">
              <div>
                <p className="kicker">{k("doesKicker")}</p>
                <h2 id="does-title" className="display section-title">{k("doesTitle")}</h2>
              </div>
              <p className="section-lede">{k("doesIntro")}</p>
            </header>
            <h3 className="group-label">
              <Glyph name="check" />
              {k("todayLabel")}
            </h3>
            <ul className="features">
              {TODAY.map((f) => (
                <li key={f}>
                  <h4>{k(`${f}Title`)}</h4>
                  <p>{k(`${f}Body`)}</p>
                </li>
              ))}
            </ul>
            <h3 className="group-label coming-label">
              <span className="ring" aria-hidden="true" />
              {k("comingLabel")}
            </h3>
            <ul className="features coming">
              {COMING.map((f) => (
                <li key={f}>
                  <h4>{k(`${f}Title`)}</h4>
                  <p>{k(`${f}Body`)}</p>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section id="private" className="section band" aria-labelledby="private-title">
          <div className="wrap private-grid">
            <header className="section-head private-head">
              <p className="kicker">{k("privateKicker")}</p>
              <h2 id="private-title" className="display section-title">{k("privateTitle")}</h2>
              <p className="section-lede">{k("privateIntro")}</p>
            </header>
            <div className="private-phone">
              <ApprovalPhone t={t} />
            </div>
            <div className="private-body">
              <ul className="promises">
                {PROMISES.map((p) => (
                  <li key={p}>
                    <h3>{k(`promise${p}Title`)}</h3>
                    <p>{k(`promise${p}Body`)}</p>
                  </li>
                ))}
              </ul>
              <aside className="blocked" aria-labelledby="blocked-title">
                <BrandImage light="mascot/rig/07-blocked.svg" dark="mascot/rig/07-blocked-dark.svg" alt={k("blockedAlt")} width={693} height={601} />
                <div>
                  <h3 id="blocked-title">{k("blockedTitle")}</h3>
                  <p>{k("blockedBody")}</p>
                </div>
              </aside>
              <p>
                <a className="text-link" href={href(lang, "privacy/")}>
                  {k("privacyPolicy")}
                  <Glyph name="arrowRight" />
                </a>
              </p>
            </div>
          </div>
        </section>

        <section id="evals" className="deep" aria-labelledby="evals-title">
          <div className="wrap">
            <header className="evals-head">
              <div>
                <p className="kicker">{k("harnessKicker")}</p>
                <h2 id="evals-title" className="display section-title">
                  {k("harnessTitleA")} <em>{k("harnessTitleB")}</em>
                </h2>
                <p className="section-lede">{k("harnessIntro", { model: MODEL })}</p>
              </div>
              <HarnessStats t={t} lang={lang} />
            </header>
            <HarnessChart t={t} />
            <p className="evals-link">
              <a className="text-link" href={repoTree("packages/eval")}>
                {k("harnessLink")}
                <Glyph name="arrowUpRight" />
              </a>
            </p>
          </div>
        </section>

        <section id="source" className="section" aria-labelledby="source-title">
          <div className="wrap source-grid">
            <div>
              <p className="kicker">{k("sourceKicker")}</p>
              <h2 id="source-title" className="display section-title">
                {k("sourceTitleA")} <em>{k("sourceTitleB")}</em>
              </h2>
              <p className="section-lede">{k("sourceBody")}</p>
              <p className="actions">
                {star}
                <a className="button ghost" href={`${REPO_URL}/contribute`}>
                  {k("sourceContribute")}
                  <span className="button-icon" aria-hidden="true"><Glyph name="arrowUpRight" /></span>
                </a>
              </p>
            </div>
            <figure className="terminal">
              <figcaption>{k("sourceCodeLabel")}</figcaption>
              <pre>
                <code>
                  {COMMANDS.map((command) => (
                    <span key={command} className="line">
                      <span className="prompt" aria-hidden="true">$ </span>
                      {breakable(command)}
                    </span>
                  ))}
                </code>
              </pre>
            </figure>
          </div>
        </section>

        <DeviceLab t={t} />

        <section id="get" className="section get" aria-labelledby="get-title">
          <div className="wrap">
            <div className="get-card">
              <BrandImage className="get-crab" light="mascot/rig/peek.svg" dark="mascot/rig/peek-dark.svg" alt={k("peekAlt")} width={693} height={601} />
              <p className="kicker">{k("getKicker")}</p>
              <h2 id="get-title" className="display section-title">
                {k("getTitleA")} <em>{k("getTitleB")}</em>
              </h2>
              <p className="section-lede">{k("getBody")}</p>
              <p className="actions">
                {star}
                {RELEASE.published ? (
                  <a className="button ghost" href={href(lang, "download/")}>
                    {k("getApk")}
                  </a>
                ) : null}
                <a className="button ghost" href={`${REPO_URL}#develop`}>
                  {k("getSource")}
                  <span className="button-icon" aria-hidden="true"><Glyph name="arrowUpRight" /></span>
                </a>
              </p>
            </div>
          </div>
        </section>
      </main>
      <Footer lang={lang} />
    </>
  );
}
