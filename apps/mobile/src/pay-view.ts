/**
 * SL-40 (HM-APPR-02, HM-PAY-05): the pure parts of the payment sheet and the caps screen, tested on Node. The rules
 * (what may be paid, the caps' checks, the fingerprint before a change) live in @hermit/runtime's payments service;
 * this only names the sheet's lines and reads what the user types into a cap.
 */
import type { SummaryFlag } from "@hermit/core";

/** The sheet's own words for each payment line the runtime flags, so no English label from the summary is shown. */
export const PAY_LINE_KEYS = {
  pay_amount: "HM-APPR-02.amount",
  pay_to: "HM-APPR-02.to",
  pay_payee: "HM-APPR-02.payee",
  pay_typed: "HM-APPR-02.typed",
  pay_network: "HM-APPR-02.network",
  pay_fee: "HM-APPR-02.fee",
  pay_cap_left: "HM-APPR-02.capLeft",
  // SL-41: a purchase from a site that asked for x402.
  pay_site: "HM-APPR-02.site",
  pay_page: "HM-APPR-02.page",
  pay_valid: "HM-APPR-02.valid",
} as const satisfies Partial<Record<SummaryFlag, string>>;

export function payLineKey(flag: SummaryFlag | undefined): string | undefined {
  return flag && flag in PAY_LINE_KEYS ? PAY_LINE_KEYS[flag as keyof typeof PAY_LINE_KEYS] : undefined;
}

/** USD₮ has 6 decimals (CT-01). */
const DECIMALS = 6;

/**
 * A cap as typed ("25", "20.5", "20,50", "$100"), in USD₮ base units, exactly. More decimals than USD₮ has, or a
 * number that reads two ways ("1,000" is one thousand or one), is undefined: the screen asks again, it never guesses.
 */
export function capsAmount(text: string): bigint | undefined {
  const m = /^\s*\$?\s?([0-9]+)(?:[.,]([0-9]+))?\s*$/.exec(text);
  if (!m) return undefined;
  const whole = m[1]!;
  const frac = m[2] ?? "";
  if (frac.length > DECIMALS) return undefined;
  if (frac.length === 3 && whole !== "0") return undefined;
  return BigInt(whole) * 10n ** BigInt(DECIMALS) + BigInt(frac.padEnd(DECIMALS, "0") || "0");
}

/** Base units as plain digits for a field ("20.5"), no grouping, no trailing zeros. */
export function baseUnitsText(units: bigint): string {
  const scale = 10n ** BigInt(DECIMALS);
  const frac = (units % scale).toString().padStart(DECIMALS, "0").replace(/0+$/, "");
  return frac ? `${units / scale}.${frac}` : `${units / scale}`;
}
