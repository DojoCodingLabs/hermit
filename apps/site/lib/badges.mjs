// The official App Store and Google Play badges, one pair per language, downloaded unmodified from Apple and Google
// on 2026-11-25 and served from public/badges, so the page loads nothing from either company. scripts/check-site.mjs
// checks every served copy against the SHA-256 below. No recolor, crop, overlay or filter: the CSS only sizes them
// to one visible height and keeps each guideline's clear space (site.css, "Store badges").
//
// Sources:
// - App Store, black, en-us: https://toolbox.marketingtools.apple.com/api/badges/download-on-the-app-store/black/en-us
//   (byte-identical to https://developer.apple.com/app-store/marketing/guidelines/images/badge-download-on-the-app-store.svg)
// - App Store, black, es-mx: https://toolbox.marketingtools.apple.com/api/badges/download-on-the-app-store/black/es-mx
//   (Apple's guidelines link this marketing toolbox; the older tools.applemarketingtools.com address doesn't resolve)
// - Google Play, en: https://play.google.com/intl/en_us/badges/static/images/badges/en_badge_web_generic.png
// - Google Play, es-419: https://play.google.com/intl/en_us/badges/static/images/badges/es-419_badge_web_generic.png
//
// Apple asks for its black badge whenever other stores' badges share the layout, the App Store badge first, and one
// App Store badge per layout, so the pair appears once, in the hero. Neither badge is a link until a listing is live;
// a separate label above them says "Coming soon".

/** Per language: the badges in their required order. `id` names the CSS class (badge-<id>). */
export const BADGES = {
  en: [
    { id: "app-store", store: "Apple", file: "app-store-en-us.svg", width: 120, height: 40, sha256: "a26fc5b38380272c92e9019a2eb8b45542a66814b3e2b203772db8904b9fb99f" },
    { id: "google-play-en", store: "Google", file: "google-play-en.png", width: 646, height: 250, sha256: "f72611e2df8e88204009fd896d05d5e8e83c77009c63943bbffa169559934849" },
  ],
  es: [
    { id: "app-store", store: "Apple", file: "app-store-es-mx.svg", width: 120, height: 40, sha256: "f5c911a6fb1861e0ba1007be5aa84162e8bc13ab6eebf953723ea3b282817be9" },
    { id: "google-play-es-419", store: "Google", file: "google-play-es-419.png", width: 646, height: 250, sha256: "777c1400d580bcc8dc39539c6958874840f5896aca22a5da0abf824518824fab" },
  ],
};
