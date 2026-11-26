/**
 * SL-39 (HM-PAY-03, HM-PAY-04): the pure parts of the history and receive screens, tested on Node. The rules (which
 * logs count, the pages, the contact names, the log links) live in @hermit/runtime's wallet service; this only decides
 * what a row says and how the QR code is drawn.
 */
import type { Money, QrCode } from "@hermit/core";

/** WALLET_NETWORK's asset and network (a type-only import keeps this file runnable under Node's type stripping). */
const USDT = { asset: "USDT", network: "eip155:2201" } as const;

/** @hermit/core's formatMoney, passed in by the screen. */
export type FormatMoney = (m: Money, locale: string, maxFractionDigits: number, minFractionDigits?: number) => string;

/** Every listed amount has at least these decimals, so "20.00" and "12.50" read alike (and all six when needed). */
export const LIST_MIN_DECIMALS = 2;

/** USD₮ base units in one whole USD₮. */
const ONE_USDT = 1_000_000n;

/**
 * A cap or a limit as people say it (the wallet home, the caps screen, the payment sheet): a whole amount has no
 * decimals ("20 USD₮", "50 USD₮"); anything else shows its cents and every digit it has ("20.50", "20.000001").
 * Lists of movements keep LIST_MIN_DECIMALS instead, so their column lines up.
 */
export function capMoney(m: Money, locale: string, format: FormatMoney): string {
  return m.amount % ONE_USDT === 0n ? format(m, locale, 0, 0) : format(m, locale, 6, LIST_MIN_DECIMALS);
}

/** The fields of @hermit/runtime's WalletTransfer that a row reads. */
export interface TransferLike {
  direction: "in" | "out" | "self";
  amount: Money;
  counterparty: string;
  contact?: string;
  unknownSender: boolean;
  at?: number;
  block: bigint;
}

export interface TransferRow {
  titleKey: "HM-PAY-03.in" | "HM-PAY-03.out" | "HM-PAY-03.self";
  /** Exact (at least two decimals, all six when needed), signed, in the locale's format, always USD₮. */
  amount: string;
  /** The user's own name for the address, or the address itself. */
  who: string;
  address: string;
  unknownSender: boolean;
  when?: string;
  /** No block time from the RPC: the block number instead. */
  whenBlock?: string;
}

/** US-PAY-03, CT-01: one row of HM-PAY-03. Anything but USD₮ on Stable testnet throws: it is never shown as money. */
export function transferRow(t: TransferLike, locale: string, format: FormatMoney, timeZone?: string): TransferRow {
  if (t.amount.asset !== USDT.asset || t.amount.network !== USDT.network) throw new TypeError("Only USD₮ on Stable testnet.");
  const value = format(t.amount, locale, 6, LIST_MIN_DECIMALS);
  const sign = t.direction === "in" ? "+" : t.direction === "out" ? "-" : "";
  const row: TransferRow = {
    titleKey: `HM-PAY-03.${t.direction}`,
    amount: sign + value,
    who: t.contact ?? t.counterparty,
    address: t.counterparty,
    unknownSender: t.unknownSender,
  };
  if (t.at !== undefined) row.when = new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short", ...(timeZone ? { timeZone } : {}) }).format(new Date(t.at));
  else row.whenBlock = new Intl.NumberFormat(locale, { useGrouping: true }).format(t.block);
  return row;
}

/** "0x9C3f…2F41": the start (with 0x) and the end of an address. Only for a name's secondary line or the user's own. */
const cut = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

/**
 * Who a movement was with, as the row shows it. Address poisoning: an attacker sends dust from a look-alike address
 * that shares the real one's first and last characters, hoping it gets copied back from the history; a cut address
 * makes the two the same. So an address with no saved name is shown whole (`whole`: mono, wrapping, never cut); only a
 * saved payee's name may sit over a cut address. A move to the user's own address names no one.
 */
export function transferParty(t: TransferLike): { name?: string; address: string; whole: boolean } {
  return t.contact ? { name: t.contact, address: cut(t.counterparty), whole: false } : { address: t.counterparty, whole: true };
}

/** The user's own address on the wallet home: cut, with copy beside it (HM-PAY-04 shows it whole). */
export const ownAddress = (address: string) => cut(address);

/** Q129: the QR code holds the bare address, the form every wallet's scanner reads. */
export function receiveQrText(address: string): string {
  if (!/^0x[0-9a-fA-F]{40}$/.test(address)) throw new TypeError("Not an address.");
  return address;
}

/** The QR code as dark rectangles (one per run in a row) on a light square with the four-module quiet zone. */
export function qrCells(q: QrCode): { side: number; rects: { x: number; y: number; w: number }[] } {
  const rects: { x: number; y: number; w: number }[] = [];
  q.dark.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      if (!row[x]) continue;
      const start = x;
      while (x + 1 < row.length && row[x + 1]) x++;
      rects.push({ x: start + 4, y: y + 4, w: x - start + 1 });
    }
  });
  return { side: q.size + 8, rects };
}
