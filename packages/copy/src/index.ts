/**
 * CT-10: copy and locales. Every string a person sees has a key `screenId.element`
 * (for example `HM-APPR-01.approve`) or `common.*`, in es-419 and English.
 */
export type Locale = "en" | "es-419";
export type Dictionary = Readonly<Record<string, string>>;

export const LOCALES: readonly Locale[] = ["es-419", "en"];

/** Any Spanish locale (es, es-CR, es-MX, es-ES...) gets es-419; everything else gets English (ADR-013). */
export function resolveLocale(tag: string | undefined, override?: Locale): Locale {
  if (override) return override;
  return tag && /^es\b/i.test(tag) ? "es-419" : "en";
}

export const KEY_PATTERN = /^(HM-[A-Z0-9]+-\d{2}|common)\.[a-z][a-zA-Z0-9]*(\.[a-z_][a-zA-Z0-9_]*)*$/;

export class CopyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CopyError";
  }
}

/**
 * Looks a key up and fills `{name}` placeholders. A missing key throws in tests and dev,
 * so a screen can't ship with a hard-coded or forgotten string.
 */
export function createTranslator(dict: Dictionary) {
  return function t(key: string, vars: Record<string, string | number> = {}): string {
    const text = dict[key];
    if (text === undefined) throw new CopyError(`Missing copy key ${key}.`);
    return text.replace(/\{(\w+)\}/g, (_, name: string) => {
      if (!(name in vars)) throw new CopyError(`Copy key ${key} needs {${name}}.`);
      return String(vars[name]);
    });
  };
}

/** The placeholders a string uses, so both locales can be checked to agree. */
export function placeholders(text: string): string[] {
  return [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]!).sort();
}
