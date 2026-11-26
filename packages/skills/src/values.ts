import type { SummaryValueId } from "@hermit/core";

/*
 * HM-APPR-01: fixed values Hermit's own skill code writes on a sheet line ("All connected accounts", "Unread"). Each
 * carries its `valueKey` next to the literal, so the sheet shows it in the user's language; `value` stays the English
 * text the model and the audit read. A value from the arguments, the user's words or a tool never gets a key.
 */

/** Hermit's own words for a line's value, with the id the sheet translates. */
export const fixedValue = (value: string, valueKey: SummaryValueId) => ({ value, valueKey });

/** The argument's text when there is one; otherwise Hermit's own fixed words (with their valueKey). */
export function valueOr(given: unknown, value: string, valueKey: SummaryValueId): { value: string; valueKey?: SummaryValueId } {
  const v = typeof given === "string" ? given.trim() : given === undefined || given === null ? "" : String(given);
  return v ? { value: v } : fixedValue(value, valueKey);
}
