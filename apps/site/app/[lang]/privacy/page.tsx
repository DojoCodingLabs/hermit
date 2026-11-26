// HM-SITE-02: the public privacy policy. It states that Hermit collects nothing and lists every outbound
// connection the app can make (lib/connections.ts, kept in step with the app's sources by test/connections.test.ts).
import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Footer, Header } from "../../../components/chrome";
import { CONNECTIONS, hostVars } from "../../../lib/connections";
import { langOf, translator } from "../../../lib/i18n";
import { pageMetadata } from "../../../lib/meta";

type Props = { params: Promise<{ lang: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  return pageMetadata(await langOf(params), "HM-SITE-02", "privacy/");
}

const PERMISSIONS = ["Notifications", "Calendar", "Contacts", "Alarms", "Background", "Biometric", "Autofill", "Internet"] as const;
const OTHERS = ["Whatsapp", "Calendar", "Apps"] as const;

export default async function Privacy({ params }: Props) {
  const lang = await langOf(params);
  const t = translator(lang);
  const k = (key: string, vars?: Record<string, string>) => t(`HM-SITE-02.${key}`, vars);
  const section = (id: string, title: string, body: ReactNode) => (
    <section aria-labelledby={id}>
      <h2 id={id}>{title}</h2>
      {body}
    </section>
  );
  return (
    <>
      <Header lang={lang} page="privacy/" />
      <main id="main" tabIndex={-1} className="wrap prose">
        <h1 className="display">{k("title")}</h1>
        <p className="meta">{k("updated", { date: k("updatedDate") })}</p>

        {section("short", k("shortTitle"), (
          <ul className="checks">
            <li>{k("short1")}</li>
            <li>{k("short2")}</li>
            <li>{k("short3")}</li>
          </ul>
        ))}

        {section("phone", k("phoneTitle"), (
          <>
            <p>{k("phoneBody")}</p>
            <p>{k("phoneContacts")}</p>
            <p>{k("phoneCodes")}</p>
          </>
        ))}

        {section("connections", k("connectionsTitle"), (
          <>
            <p>{k("connectionsIntro")}</p>
            <div className="table-scroll" role="region" aria-labelledby="connections" tabIndex={0}>
              <table>
                <thead>
                  <tr>
                    <th scope="col">{k("colWhat")}</th>
                    <th scope="col">{k("colWhere")}</th>
                    <th scope="col">{k("colWhen")}</th>
                  </tr>
                </thead>
                <tbody>
                  {CONNECTIONS.map((c) => (
                    <tr key={c.id}>
                      <th scope="row">{k(`conn${c.id}`)}</th>
                      <td>{k(`conn${c.id}Where`, hostVars(c))}</td>
                      <td>{k(`conn${c.id}When`)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        ))}

        {section("others", k("othersTitle"), (
          <ul>
            {OTHERS.map((o) => <li key={o}>{k(`others${o}`)}</li>)}
          </ul>
        ))}

        {section("wallet", k("walletTitle"), <p>{k("walletBody")}</p>)}

        {section("permissions", k("permissionsTitle"), (
          <>
            <p>{k("permissionsIntro")}</p>
            <ul>
              {PERMISSIONS.map((p) => <li key={p}>{k(`perm${p}`)}</li>)}
            </ul>
            <p>{k("permNever")}</p>
          </>
        ))}

        {section("delete", k("deleteTitle"), <p>{k("deleteBody")}</p>)}
        {section("limits", k("limitsTitle"), <p>{k("limitsBody")}</p>)}
        {section("site", k("siteTitle"), <p>{k("siteBody")}</p>)}
        {section("downloads", k("downloadsTitle"), <p>{k("downloadsBody")}</p>)}
        {section("contact", k("contactTitle"), <p>{k("contactPending")}</p>)}
        {section("changes", k("changesTitle"), <p>{k("changesBody")}</p>)}
      </main>
      <Footer lang={lang} />
    </>
  );
}
