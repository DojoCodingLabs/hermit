import type { SettingKey } from "./hermit.ts";

/**
 * HM-ONB-02, HM-SET-05 (US-ONB-02, US-SET-05): the app language. The phone's language is the default
 * (es-419 for any Spanish, English otherwise, `resolveLocale` in @hermit/copy); a stored override wins.
 * The model's reply language still follows the user's own words, with this as the fallback (`userLanguage`).
 */
export const LANGUAGE_SETTING = "locale.override" satisfies SettingKey;

export type AppLocale = "es-419" | "en";
export type LanguageChoice = "system" | AppLocale;

/** Only the two exact locales override; absent, "system" or anything else follows the phone. */
export function languageOverride(stored: string | undefined): AppLocale | undefined {
  return stored === "en" || stored === "es-419" ? stored : undefined;
}

export function languageChoice(stored: string | undefined): LanguageChoice {
  return languageOverride(stored) ?? "system";
}

export function languageSettingValue(choice: LanguageChoice): string {
  return choice;
}

/**
 * HM-SET-07 (US-SET-08): dark mode. It follows the system by default; the user can pin light (Quiet craft)
 * or dark (Deep sea). Stored in ENT-Setting `appearance.theme`.
 */
export const THEME_SETTING = "appearance.theme" satisfies SettingKey;

export type ThemeChoice = "system" | "light" | "dark";

export function themeChoice(stored: string | undefined): ThemeChoice {
  return stored === "light" || stored === "dark" ? stored : "system";
}

export function themeSettingValue(choice: ThemeChoice): string {
  return choice;
}

/** The scheme screens draw with. No answer from the system reads as light, the brand's default. */
export function colorScheme(stored: string | undefined, system: "light" | "dark" | null | undefined): "light" | "dark" {
  const choice = themeChoice(stored);
  if (choice !== "system") return choice;
  return system === "dark" ? "dark" : "light";
}

/** What the app hands React Native's `Appearance.setColorScheme`: "auto" removes the override. */
export function colorSchemeOverride(choice: ThemeChoice): "auto" | "light" | "dark" {
  return choice === "system" ? "auto" : choice;
}

/** Layouts are built and checked up to 200% text (NFR-08, PDR-013). */
export const MAX_TEXT_SCALE = 2;

/** HM-SET-07's text size line: the phone's font scale as a whole percent, and whether it is past what layouts are built for. */
export function textScale(fontScale: number): { percent: number; overLimit: boolean } {
  const scale = Number.isFinite(fontScale) && fontScale > 0 ? fontScale : 1;
  return { percent: Math.round(scale * 100), overLimit: scale > MAX_TEXT_SCALE + 1e-9 };
}
