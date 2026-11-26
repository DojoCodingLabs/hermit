// Small text helpers for the polish round (docs/design/polish/decisions.md): an address cut in the middle, the house
// quotes, an amount split from its unit, and dates said relative to now. Pure, tested in format.test.ts; the words
// themselves are copy (common.when.*), these only pick the key and fill it.

/** "0x9C3f5B…2F41": the start (with 0x) and the end, which are what people compare; the whole value stays copyable. */
export function middle(text: string, head = 6, tail = 4): string {
  return text.length > head + tail + 1 ? `${text.slice(0, head)}…${text.slice(-tail)}` : text;
}

/**
 * A whole 0x address in groups of four, the way hardware wallets show one for checking: "0xdbF0 3B40 7c01 … C6FB".
 * The 0x stays on the first group, so a line can only break between groups and never leaves a lone character. Display
 * only: copy and selection use the address itself (`groupAddress(a).replace(/ /g, "") === a`). Anything that isn't a
 * 0x address comes back unchanged.
 */
export function groupAddress(address: string): string {
  const m = /^0x([0-9a-fA-F]+)$/.exec(address);
  if (!m) return address;
  const [first, ...rest] = m[1]!.match(/.{1,4}/g)!;
  return [`0x${first}`, ...rest].join(" ");
}

/**
 * A long hex value (a hash, a signature) in groups of eight for reading: lines break only between groups, so none ends
 * on a stray character. Display only, like `groupAddress`: copying uses the value itself.
 */
export function groupHex(value: string, size = 8): string {
  return /^[0-9a-fA-F]+$/.test(value) ? value.match(new RegExp(`.{1,${size}}`, "g"))!.join(" ") : value;
}

/** Someone's words, in curly quotes in both languages (es-419 uses them too; never straight quotes or « »). */
export function quoted(text: string): string {
  return `“${text.trim()}”`;
}

/** "20.00 USD₮" as its figures and its unit, so the figures can be set large and the unit small beside them. */
export function splitAmount(amount: string): { figures: string; unit: string } {
  const m = /^([\d.,\s  ]*\d)\s+(\S.*)$/u.exec(amount.trim());
  return m ? { figures: m[1]!, unit: m[2]! } : { figures: amount.trim(), unit: "" };
}

export type When = { key: string; vars?: Record<string, string> };

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

/** Intl's narrow no-break space (in "9:05 PM") isn't in the brand faces; a no-break space looks the same. */
const tidy = (s: string) => s.replace(/ /g, " ");

/** "lunes" as "Lunes": a weekday that starts its line (Intl writes Spanish weekdays in lower case). */
const capital = (s: string) => s.charAt(0).toLocaleUpperCase() + s.slice(1);

/** The day's name in full ("Martes", not "mar", which also reads as March). */
const weekday = (at: number, locale: string) => capital(new Intl.DateTimeFormat(locale, { weekday: "long" }).format(at));

const timeOf = (at: number, locale: string) => tidy(new Intl.DateTimeFormat(locale, { hour: "numeric", minute: "2-digit" }).format(at));

const startOf = (t: number) => {
  const d = new Date(t);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
};

/** "2 oct", with the year when it isn't this one. */
const dateOf = (at: number, now: number, locale: string) => {
  const sameYear = new Date(at).getFullYear() === new Date(now).getFullYear();
  return tidy(new Intl.DateTimeFormat(locale, sameYear ? { day: "numeric", month: "short" } : { day: "numeric", month: "short", year: "numeric" }).format(at));
};

/**
 * A moment said the way people say it: "Ahora", "Hace 5 min", "Hoy, 9:05 a.m.", "Ayer, 7:10 p.m.", "Lunes, 8:00 a.m."
 * within the week, then the date ("2 oct", with the year when it isn't this one). A moment in the future reads "Ahora".
 */
export function when(at: number, now: number, locale: string): When {
  const age = now - at;
  if (age < MINUTE) return { key: "common.when.now" };
  if (age < 60 * MINUTE) return { key: "common.when.minutes", vars: { n: String(Math.floor(age / MINUTE)) } };
  const time = timeOf(at, locale);
  const days = Math.round((startOf(now) - startOf(at)) / DAY);
  if (days === 0) return { key: "common.when.today", vars: { time } };
  if (days === 1) return { key: "common.when.yesterday", vars: { time } };
  if (days < 7) return { key: "common.when.weekday", vars: { day: weekday(at, locale), time } };
  return { key: "common.when.date", vars: { date: dateOf(at, now, locale) } };
}

/**
 * A moment still to come (a reminder), with its time: "Hoy, 6:00 p.m.", "Mañana, 9:00 a.m.", "Sábado, 12:49 p.m."
 * within the week, then "24 nov, 10:49 p.m.". One already past reads like `when`.
 */
export function ahead(at: number, now: number, locale: string): When {
  if (at < now) return when(at, now, locale);
  const time = timeOf(at, locale);
  const days = Math.round((startOf(at) - startOf(now)) / DAY);
  if (days === 0) return { key: "common.when.today", vars: { time } };
  if (days === 1) return { key: "common.when.tomorrow", vars: { time } };
  if (days < 7) return { key: "common.when.weekday", vars: { day: weekday(at, locale), time } };
  return { key: "common.when.dateTime", vars: { date: dateOf(at, now, locale), time } };
}
