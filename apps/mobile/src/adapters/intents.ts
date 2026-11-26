import type { IntentLauncherPort } from "@hermit/core";
import { createTranslator } from "@hermit/copy";
import en from "@hermit/copy/locales/en.json";
import es from "@hermit/copy/locales/es-419.json";
import { HermitIntents } from "../../modules/hermit-intents";

/** FR-APP-01: hands the spec to the other app; that app's screen is where the person acts. */
export const phoneIntents: IntentLauncherPort = {
  open: (spec) => HermitIntents.open(JSON.stringify(spec)),
};

const translators = { en: createTranslator(en), "es-419": createTranslator(es) };

/** Copy for the answer after another app opens, in the language of the user's words (not only the phone's). */
export function intentCopy(language: "es-419" | "en", key: string, vars?: Record<string, string>): string {
  return translators[language](key, vars);
}
