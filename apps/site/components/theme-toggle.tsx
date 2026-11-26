// The light and dark switch. A real button: its label says what a press does ("Use dark theme" or "Use light
// theme"), aria-pressed is on while the dark theme shows, and lib/theme.mjs keeps both true. The moon or the sun shows
// by CSS, from the theme on <html>. Hidden when JavaScript doesn't run, since the page then follows the system.
import type { T } from "../lib/i18n";
import { Glyph } from "./glyphs";

export function ThemeToggle({ t }: { t: T }) {
  return (
    <button
      type="button"
      className="theme-toggle"
      aria-pressed="false"
      aria-label={t("common.themeDark")}
      data-dark={t("common.themeDark")}
      data-light={t("common.themeLight")}
    >
      <Glyph name="moon" className="moon" />
      <Glyph name="sun" className="sun" />
    </button>
  );
}
