// HM-ONB-02, HM-SET-05 and HM-SET-07: the stored language and color scheme, applied to every screen. The rules
// are in packages/runtime/src/display.ts; this file reads ENT-Setting `locale.override` and `appearance.theme`
// once the runtime is ready and applies them (copy through ./i18n, the scheme through React Native's Appearance).
import { useEffect, useSyncExternalStore } from "react";
import { Appearance } from "react-native";
import {
  LANGUAGE_SETTING, THEME_SETTING, colorSchemeOverride, languageChoice, languageOverride, languageSettingValue, themeChoice, themeSettingValue,
  type Hermit, type LanguageChoice, type ThemeChoice,
} from "@hermit/runtime";
import { useHermit } from "./hermit-context";
import { deviceLocale, setAppLocale } from "./i18n";

export interface Display {
  language: LanguageChoice;
  theme: ThemeChoice;
  /** False until the stored values are read; the choices stay disabled until then (ST-LOAD). */
  loaded: boolean;
}

let current: Display = { language: "system", theme: "system", loaded: false };
let loadedFrom: Hermit | undefined;
const listeners = new Set<() => void>();

function publish(next: Partial<Display>) {
  current = { ...current, ...next };
  for (const l of listeners) l();
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

function applyLanguage(choice: LanguageChoice) {
  setAppLocale(languageOverride(choice) ?? deviceLocale());
}

function applyTheme(choice: ThemeChoice) {
  Appearance.setColorScheme(colorSchemeOverride(choice));
}

/** Mounted once under the providers: reads both settings when the runtime is ready and applies them. */
export function useDisplaySync(): void {
  const { status } = useHermit();
  useEffect(() => {
    if (status.kind === "not_wired" || status.kind === "failed") {
      // No settings to read: the phone's language and scheme hold; a choice made now lasts for this run only.
      if (!current.loaded) publish({ loaded: true });
      return;
    }
    if (status.kind !== "ready" || loadedFrom === status.hermit) return;
    const hermit = status.hermit;
    loadedFrom = hermit;
    Promise.all([hermit.settings.get(LANGUAGE_SETTING), hermit.settings.get(THEME_SETTING)]).then(
      ([lang, theme]) => {
        const language = languageChoice(lang);
        const scheme = themeChoice(theme);
        applyLanguage(language);
        applyTheme(scheme);
        publish({ language, theme: scheme, loaded: true });
      },
      () => publish({ loaded: true }),
    );
  }, [status]);
}

export function useDisplay(): Display {
  return useSyncExternalStore(subscribe, () => current);
}

/** Stores first, then applies: a failed save changes nothing on screen. Without a runtime it applies for this run. */
export async function setLanguage(hermit: Hermit | undefined, choice: LanguageChoice): Promise<void> {
  if (hermit) await hermit.settings.set(LANGUAGE_SETTING, languageSettingValue(choice));
  applyLanguage(choice);
  publish({ language: choice });
}

export async function setTheme(hermit: Hermit | undefined, choice: ThemeChoice): Promise<void> {
  if (hermit) await hermit.settings.set(THEME_SETTING, themeSettingValue(choice));
  applyTheme(choice);
  publish({ theme: choice });
}
