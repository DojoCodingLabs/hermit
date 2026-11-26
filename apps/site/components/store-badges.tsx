// The official App Store and Google Play badges for one language (lib/badges.mjs), under a separate "Coming soon"
// label. Neither is a link yet: each is a disabled link (role="link", aria-disabled, no href), so it can't be focused
// or followed, and its alt text names the store and says it's coming. When a listing goes live, wrap its badge in a
// real link to that listing and drop the label.
import { BADGES } from "../lib/badges.mjs";
import type { Lang, T } from "../lib/i18n";

export function StoreBadges({ t, lang }: { t: T; lang: Lang }) {
  return (
    <div className="store-badges">
      <p className="badges-label">
        <span className="ring" aria-hidden="true" />
        {t("common.storeSoon")}
      </p>
      <ul className="badges" aria-label={t("common.storesLabel")}>
        {BADGES[lang].map((badge) => (
          <li key={badge.id}>
            <span className={`badge badge-${badge.id}`} role="link" aria-disabled="true">
              <img src={`/badges/${badge.file}`} alt={t(`common.badge${badge.store}Alt`)} width={badge.width} height={badge.height} decoding="async" />
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
