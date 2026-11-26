import { readFileSync } from "node:fs";
import type { SpokenLanguage } from "@hermit/core";
import type { AnswerWords } from "../src/answers.ts";

/** The app's real copy (packages/copy/locales), filled the way @hermit/copy's translator fills it. */
const load = (name: string): Record<string, string> => JSON.parse(readFileSync(new URL(`../../copy/locales/${name}.json`, import.meta.url), "utf8"));
const DICTS: Record<SpokenLanguage, Record<string, string>> = { "es-419": load("es-419"), en: load("en") };

export function copy(language: SpokenLanguage, key: string, vars: Record<string, string> = {}): string {
  const text = DICTS[language][key];
  if (text === undefined) throw new Error(`Missing copy key ${key}.`);
  return text.replace(/\{(\w+)\}/g, (_, name: string) => {
    if (!(name in vars)) throw new Error(`Copy key ${key} needs {${name}}.`);
    return vars[name]!;
  });
}

/** Answer words in one language, whatever the user wrote. */
export const wordsIn = (language: SpokenLanguage): AnswerWords => ({ language: () => language, copy });
