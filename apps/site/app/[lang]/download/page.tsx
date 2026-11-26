// HM-SITE-03: the APK on GitHub Releases, its SHA-256, the signing certificate and the verify and rebuild steps.
// Until the first signed release is published, lib/release.ts holds placeholders and this page says so.
import type { Metadata } from "next";
import { Footer, Header } from "../../../components/chrome";
import { langOf, translator } from "../../../lib/i18n";
import { pageMetadata } from "../../../lib/meta";
import { RELEASE } from "../../../lib/release";

type Props = { params: Promise<{ lang: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  return pageMetadata(await langOf(params), "HM-SITE-03", "download/");
}

export default async function Download({ params }: Props) {
  const lang = await langOf(params);
  const t = translator(lang);
  const k = (key: string, vars?: Record<string, string>) => t(`HM-SITE-03.${key}`, vars);
  const value = (v: string | null) => (v ? <code className="hash">{v}</code> : <span className="placeholder">{k("pendingValue")}</span>);
  const file = RELEASE.file;
  return (
    <>
      <Header lang={lang} page="download/" />
      <main id="main" tabIndex={-1} className="wrap prose">
        <h1 className="display">{k("title")}</h1>
        <p className="lede">{k("intro")}</p>

        {RELEASE.published ? null : (
          <aside className="notice" aria-labelledby="pending">
            <h2 id="pending">{k("pendingTitle")}</h2>
            <p>{k("pendingBody")}</p>
          </aside>
        )}

        <section aria-labelledby="apk">
          <h2 id="apk">{k("apkTitle")}</h2>
          <p>
            {RELEASE.published && RELEASE.url ? (
              <a className="button primary" href={RELEASE.url}>{k("apkLink", { file })}</a>
            ) : (
              <span className="button disabled" aria-disabled="true">{k("apkPending")}</span>
            )}
          </p>
          <p>{k("needs")}</p>
          <dl className="facts">
            <div>
              <dt>{k("shaLabel")}</dt>
              <dd>{value(RELEASE.sha256)}</dd>
            </div>
            <div>
              <dt>{k("certLabel")}</dt>
              <dd>{value(RELEASE.certSha256)}</dd>
            </div>
          </dl>
        </section>

        <section aria-labelledby="verify">
          <h2 id="verify">{k("verifyTitle")}</h2>
          <ol className="steps">
            <li>{k("verifyStep1")}</li>
            <li>
              {k("verifyStep2")}
              <dl className="commands">
                <div><dt>{k("verifyMac")}</dt><dd><code>shasum -a 256 {file}</code></dd></div>
                <div><dt>{k("verifyLinux")}</dt><dd><code>sha256sum {file}</code></dd></div>
                <div><dt>{k("verifyWindows")}</dt><dd><code>certutil -hashfile {file} SHA256</code></dd></div>
              </dl>
            </li>
            <li>{k("verifyStep3")}</li>
            <li>
              {k("verifyStep4")}
              <pre><code>apksigner verify --print-certs {file}</code></pre>
            </li>
          </ol>
        </section>

        <section aria-labelledby="rebuild">
          <h2 id="rebuild">{k("rebuildTitle")}</h2>
          <p>{k("rebuildBody")}</p>
          {RELEASE.recipeUrl ? (
            <p><a href={RELEASE.recipeUrl}>{k("rebuildLink")}</a></p>
          ) : (
            <p className="placeholder">{k("rebuildPending")}</p>
          )}
        </section>

        <section aria-labelledby="sideload">
          <h2 id="sideload">{k("sideloadTitle")}</h2>
          <p>{k("sideloadBody")}</p>
        </section>
      </main>
      <Footer lang={lang} />
    </>
  );
}
