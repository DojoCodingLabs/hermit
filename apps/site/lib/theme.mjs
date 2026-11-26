// The light and dark theme switch: the only JavaScript the site runs, two inline scripts allowed by their exact
// SHA-256 in the content security policy (lib/csp.mjs). Without JavaScript the page follows the system theme and the
// switch stays hidden.
//
// - THEME_HEAD_SCRIPT runs in <head>, before the first paint: it sets <html data-theme> to the visitor's saved choice,
//   or to "system", which follows prefers-color-scheme. Any data-theme also shows the switch (site.css).
// - THEME_TOGGLE_SCRIPT runs at the end of <body>: the switch flips light and dark, saves the choice for every page
//   and language, and keeps aria-pressed (on when dark) and its label ("Use dark theme" or "Use light theme") true.
//
// Changing either script changes its hash: update SCRIPT_HASHES in lib/csp.mjs and the header in vercel.json
// (test/theme.test.ts and test/vercel.test.ts fail until both match).

/** Where the choice is kept: "light" or "dark". Nothing saved means the system decides. */
export const THEME_KEY = "hermit-theme";

export const THEME_HEAD_SCRIPT = [
  `try { var t = localStorage.getItem("${THEME_KEY}"); } catch (e) {}`,
  `document.documentElement.dataset.theme = t === "light" || t === "dark" ? t : "system";`,
].join("\n");

export const THEME_TOGGLE_SCRIPT = [
  "(function () {",
  `  var d = document.documentElement, b = document.querySelector(".theme-toggle"), m = matchMedia("(prefers-color-scheme: dark)");`,
  "  if (!b) return;",
  `  function dark() { var t = d.dataset.theme; return t === "dark" || (t !== "light" && m.matches); }`,
  `  function sync() { var on = dark(); b.setAttribute("aria-pressed", on ? "true" : "false"); b.setAttribute("aria-label", on ? b.dataset.light : b.dataset.dark); }`,
  "  b.addEventListener(\"click\", function () {",
  `    var t = dark() ? "light" : "dark";`,
  "    d.dataset.theme = t;",
  `    try { localStorage.setItem("${THEME_KEY}", t); } catch (e) {}`,
  "    sync();",
  "  });",
  "  m.addEventListener(\"change\", sync);",
  "  sync();",
  "})();",
].join("\n");
