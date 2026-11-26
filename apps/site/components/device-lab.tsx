// The device lab call to action on the home page, kept in one file so it is easy to change:
// - the words are the `HM-SITE-01.lab*` keys in locales/en.json and locales/es-419.json;
// - LAB_STEPS lists the steps, each one `labStep<N>Title` and `labStep<N>Body`; add or remove a number to change them;
// - DEVICES_GUIDE is where the button goes (lib/site-config.mjs builds it from the repository URL).
import type { T } from "../lib/i18n";
import { repoFile } from "../lib/site-config.mjs";
import { BrandImage } from "./brand-image";
import { Glyph } from "./glyphs";

export const DEVICES_GUIDE = repoFile("docs/devices.md");

const LAB_STEPS = [1, 2, 3] as const;

export function DeviceLab({ t }: { t: T }) {
  const k = (key: string) => t(`HM-SITE-01.${key}`);
  return (
    <section id="lab" className="section lab" aria-labelledby="lab-title">
      <div className="wrap lab-grid">
        <div className="lab-art">
          <BrandImage light="mascot/rig/11-new-phone.svg" dark="mascot/rig/11-new-phone-dark.svg" alt={k("labAlt")} width={693} height={601} />
        </div>
        <div className="lab-text">
          <p className="kicker">{k("labKicker")}</p>
          <h2 id="lab-title" className="display section-title">{k("labTitle")}</h2>
          <p className="section-lede">{k("labBody")}</p>
          <ol className="lab-steps">
            {LAB_STEPS.map((n) => (
              <li key={n}>
                <span className="lab-num" aria-hidden="true">{n}</span>
                <h3>{k(`labStep${n}Title`)}</h3>
                <p>{k(`labStep${n}Body`)}</p>
              </li>
            ))}
          </ol>
          <p className="actions">
            <a className="button primary" href={DEVICES_GUIDE}>
              {k("labCta")}
              <span className="button-icon" aria-hidden="true"><Glyph name="arrowUpRight" /></span>
            </a>
          </p>
          <p className="fine-note">{k("labNeeds")}</p>
        </div>
      </div>
    </section>
  );
}
