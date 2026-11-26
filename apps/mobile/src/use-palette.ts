import { useColorScheme } from "react-native";
import { useLocale } from "./i18n";
import { palettes, type Palette } from "./theme";

/**
 * The colors for the scheme in use: the phone's, or the one pinned on HM-SET-07 (applied through React Native's
 * Appearance, so `useColorScheme` follows it). Every screen reads its palette here, so this hook also subscribes
 * to the app language: a change on HM-ONB-02 or HM-SET-05 re-renders every screen in place (US-ONB-02).
 */
export function usePalette(): Palette {
  useLocale();
  return useColorScheme() === "dark" ? palettes.dark : palettes.light;
}
