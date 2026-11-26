// A sample of Hermit's approval sheet, drawn in HTML and CSS with the app's own words (packages/copy HM-APPR-01) and
// a synthetic contact. It follows the visitor's theme, like the app does. The drawing is hidden from screen readers;
// the caption says what it shows.
import type { T } from "../lib/i18n";
import { BrandImage } from "./brand-image";
import { Glyph } from "./glyphs";

export function ApprovalPhone({ t }: { t: T }) {
  const k = (key: string) => t(`HM-SITE-01.${key}`);
  return (
    <figure className="phone-figure">
      <div className="phone" aria-hidden="true">
        <div className="phone-screen">
          <div className="phone-status">
            <span>10:08</span>
            <span className="phone-camera" />
            <span className="phone-signal" />
          </div>
          <div className="phone-chat">
            <p className="bubble bubble-you">{k("phoneAsk")}</p>
            <p className="bubble bubble-hermit">{k("phoneReply")}</p>
          </div>
          <div className="phone-sheet">
            <span className="sheet-handle" />
            <BrandImage className="sheet-crab" light="mascot/rig/04-asking.svg" dark="mascot/rig/04-asking-dark.svg" alt={k("phoneAskingAlt")} width={693} height={601} />
            <p className="sheet-title">{k("phoneSheetTitle")}</p>
            <dl className="sheet-rows">
              <div>
                <dt>{k("phoneTo")}</dt>
                <dd>{k("phoneToValue")}</dd>
              </div>
              <div>
                <dt>{k("phoneMessage")}</dt>
                <dd>{k("phoneMessageValue")}</dd>
              </div>
            </dl>
            <span className="sheet-approve">
              <Glyph name="fingerprint" />
              {k("phoneApprove")}
            </span>
            <span className="sheet-deny">{k("phoneDeny")}</span>
          </div>
        </div>
      </div>
      <figcaption className="phone-caption">{k("phoneCaption")}</figcaption>
    </figure>
  );
}
