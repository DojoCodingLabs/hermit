/**
 * CT-01: Money. Amounts are integer base units (bigint) with an asset and a network.
 * No floats anywhere; formatting happens only at display.
 */
export interface Money {
  /** Base units of the asset (USD₮ has 6 decimals, so 1 USD₮ is 1_000_000n). */
  amount: bigint;
  asset: string;
  network: string;
}

export class MoneyError extends Error {
  constructor(
    readonly code: "mismatch" | "negative" | "precision" | "unknown_asset",
    message: string,
  ) {
    super(message);
    this.name = "MoneyError";
  }
}

/** Decimals per asset code. Payment networks ship with the app (2.12); unknown assets refuse to format. */
export const ASSET_DECIMALS: Readonly<Record<string, number>> = { USDT: 6, USDC: 6, ETH: 18, BTC: 8 };

export function money(amount: bigint, asset: string, network: string): Money {
  if (amount < 0n) throw new MoneyError("negative", "Amounts are never negative; direction is a separate field.");
  return { amount, asset, network };
}

function same(a: Money, b: Money): void {
  if (a.asset !== b.asset || a.network !== b.network) {
    throw new MoneyError("mismatch", `Cannot combine ${a.asset} on ${a.network} with ${b.asset} on ${b.network}.`);
  }
}

export function addMoney(a: Money, b: Money): Money {
  same(a, b);
  return { ...a, amount: a.amount + b.amount };
}

export function subMoney(a: Money, b: Money): Money {
  same(a, b);
  return money(a.amount - b.amount, a.asset, a.network);
}

export function compareMoney(a: Money, b: Money): -1 | 0 | 1 {
  same(a, b);
  return a.amount < b.amount ? -1 : a.amount > b.amount ? 1 : 0;
}

/** Parse a decimal string a person typed ("20", "20.5") into base units. Rejects more decimals than the asset has. */
export function parseMoney(text: string, asset: string, network: string): Money {
  const decimals = ASSET_DECIMALS[asset];
  if (decimals === undefined) throw new MoneyError("unknown_asset", `Unknown asset ${asset}.`);
  const m = /^(\d+)(?:\.(\d+))?$/.exec(text.trim());
  if (!m) throw new MoneyError("precision", `"${text}" is not an amount.`);
  const [, whole, frac = ""] = m;
  if (frac.length > decimals) throw new MoneyError("precision", `${asset} has at most ${decimals} decimals.`);
  return money(BigInt(whole + frac.padEnd(decimals, "0")), asset, network);
}

/**
 * Display only. Uses the locale's separators; never feeds back into arithmetic. `minFractionDigits` pads with zeros, so
 * amounts listed together share one format ("20.00" next to "12.50"); digits past it are kept up to the maximum.
 */
export function formatMoney(m: Money, locale: string, maxFractionDigits = 2, minFractionDigits = 0): string {
  const decimals = ASSET_DECIMALS[m.asset];
  if (decimals === undefined) throw new MoneyError("unknown_asset", `Unknown asset ${m.asset}.`);
  const base = 10n ** BigInt(decimals);
  const whole = m.amount / base;
  const frac = (m.amount % base).toString().padStart(decimals, "0").slice(0, maxFractionDigits).replace(/0+$/, "").padEnd(Math.min(minFractionDigits, maxFractionDigits), "0");
  const parts = new Intl.NumberFormat(locale, { minimumFractionDigits: 1 }).formatToParts(1.5);
  const sep = parts.find((p) => p.type === "decimal")?.value ?? ".";
  const wholeText = new Intl.NumberFormat(locale, { useGrouping: true }).format(whole);
  return `${frac ? `${wholeText}${sep}${frac}` : wholeText} ${m.asset === "USDT" ? "USD₮" : m.asset}`;
}
