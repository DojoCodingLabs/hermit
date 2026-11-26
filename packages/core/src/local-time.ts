import { zoneOffsetMinutes } from "./time.ts";

/**
 * Times in words, always in the phone's zone (W1, 2026-11-24). The first phone session showed UTC: skills handed the
 * model `toISOString()` times, so a 9:00 event read as 15:00 and a 14:43 message as "20:43:29".
 * - For the model: English, 24-hour, with weekday, date and year, and "(today)", "(tomorrow)" or "(yesterday)"
 *   (`modelWhen`, `modelDay`). The clock line in the prompt (`describeNowForModel`) reads the same way.
 * - For the user: es-419 or English words built here, not by Intl, so the phone (Hermes) and Node say exactly the same
 *   thing: "mañana, miércoles 25, a las 9:00" (`spokenWhen`, `spokenDay`, `spokenSpan`, `spokenClock`).
 */
export type SpokenLanguage = "es-419" | "en";

export interface LocalParts {
  y: number;
  m: number;
  d: number;
  /** 0 is Sunday. */
  dow: number;
  hh: number;
  mm: number;
}

/** The local date and wall time of an instant in `timeZone`. */
export function localParts(at: number, timeZone: string): LocalParts {
  const l = new Date(at + zoneOffsetMinutes(at, timeZone) * 60_000);
  return { y: l.getUTCFullYear(), m: l.getUTCMonth() + 1, d: l.getUTCDate(), dow: l.getUTCDay(), hh: l.getUTCHours(), mm: l.getUTCMinutes() };
}

const dayNumber = (p: Pick<LocalParts, "y" | "m" | "d">) => Math.round(Date.UTC(p.y, p.m - 1, p.d) / 86_400_000);

/** Calendar days from now's local date to the instant's: 0 today, 1 tomorrow, -1 yesterday. DST doesn't change it. */
export function daysAway(at: number, now: number, timeZone: string): number {
  return dayNumber(localParts(at, timeZone)) - dayNumber(localParts(now, timeZone));
}

const EN_DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;
const EN_MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"] as const;
const ES_DAYS = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"] as const;
const ES_MONTHS = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"] as const;

const two = (n: number) => String(n).padStart(2, "0");
const relTag = (away: number) => (away === 0 ? " (today)" : away === 1 ? " (tomorrow)" : away === -1 ? " (yesterday)" : "");
const modelDate = (p: LocalParts) => `${EN_DAYS[p.dow]}, ${EN_MONTHS[p.m - 1]} ${p.d}, ${p.y}`;

/** For the model: "Wednesday, November 25, 2026, 09:00 (tomorrow)". */
export function modelWhen(at: number, now: number, timeZone: string): string {
  const p = localParts(at, timeZone);
  return `${modelDate(p)}, ${two(p.hh)}:${two(p.mm)}${relTag(daysAway(at, now, timeZone))}`;
}

/** For the model: the local time alone, "09:00" (an event's end on its start's day). */
export function modelClock(at: number, timeZone: string): string {
  const p = localParts(at, timeZone);
  return `${two(p.hh)}:${two(p.mm)}`;
}

/** For the model: a date with no time, "Wednesday, November 25, 2026 (tomorrow)". */
export function modelDay(at: number, now: number, timeZone: string): string {
  return `${modelDate(localParts(at, timeZone))}${relTag(daysAway(at, now, timeZone))}`;
}

/** "9:00" and "14:43" (Spanish, 24-hour); "9:00 AM" and "2:43 PM" (English). */
export function spokenClock(at: number, timeZone: string, language: SpokenLanguage): string {
  return clock(localParts(at, timeZone), language);
}

function clock(p: Pick<LocalParts, "hh" | "mm">, language: SpokenLanguage): string {
  if (language === "es-419") return `${p.hh}:${two(p.mm)}`;
  return `${p.hh % 12 || 12}:${two(p.mm)} ${p.hh < 12 ? "AM" : "PM"}`;
}

/** "a las 9:00", "a la 1:15" (es); "at 9:00 AM" (en). */
function atClock(p: LocalParts, language: SpokenLanguage): string {
  return language === "es-419" ? `${p.hh === 1 ? "a la" : "a las"} ${clock(p, language)}` : `at ${clock(p, language)}`;
}

/** The month (and the year) are said when the day isn't close to today. */
function far(p: LocalParts, today: LocalParts, away: number): { month: boolean; year: boolean } {
  const year = p.y !== today.y;
  return { month: year || p.m !== today.m || Math.abs(away) > 6, year };
}

/** "miércoles 25", "jueves 3 de diciembre", "lunes 4 de enero de 2027" (es); "Wednesday, November 25", "Monday, January 4, 2027" (en). */
function dateWords(p: LocalParts, language: SpokenLanguage, show: { month: boolean; year: boolean }): string {
  if (language === "en") return `${EN_DAYS[p.dow]}, ${EN_MONTHS[p.m - 1]} ${p.d}${show.year ? `, ${p.y}` : ""}`;
  return `${ES_DAYS[p.dow]} ${p.d}${show.month ? ` de ${ES_MONTHS[p.m - 1]}` : ""}${show.year ? ` de ${p.y}` : ""}`;
}

/**
 * When something happens, relative to now: "hoy a las 14:37", "mañana, miércoles 25, a las 9:00", "ayer a las 20:10",
 * "el viernes 27 a las 17:00"; "today at 2:37 PM", "tomorrow, Wednesday, November 25, at 9:00 AM", "on Friday,
 * November 27, at 5:00 PM". `bareToday`: something from today reads as just its time ("a las 14:43").
 */
export function spokenWhen(at: number, now: number, timeZone: string, language: SpokenLanguage, opts: { bareToday?: boolean } = {}): string {
  const p = localParts(at, timeZone);
  const away = daysAway(at, now, timeZone);
  const time = atClock(p, language);
  if (away === 0) return opts.bareToday ? time : `${language === "es-419" ? "hoy" : "today"} ${time}`;
  if (away === -1) return `${language === "es-419" ? "ayer" : "yesterday"} ${time}`;
  return `${dayLead(p, localParts(now, timeZone), away, language)} ${time}`;
}

/** The day before a time: "mañana, miércoles 25," and "el viernes 27" (es); "tomorrow, Wednesday, November 25," and "on Friday, November 27," (en). */
function dayLead(p: LocalParts, today: LocalParts, away: number, language: SpokenLanguage): string {
  const show = far(p, today, away);
  if (language === "en") return `${away === 1 ? "tomorrow," : "on"} ${dateWords(p, language, show)},`;
  return away === 1 ? `mañana, ${dateWords(p, language, show)},` : `el ${dateWords(p, language, show)}`;
}

/**
 * A day, with its month: "mañana, miércoles 25 de noviembre", "el viernes 27 de noviembre"; "tomorrow, Wednesday,
 * November 25", "on Friday, November 27". `article: false` drops "el" and "on" ("viernes 27 de noviembre");
 * `relative: false` drops "hoy", "mañana" and "ayer" (for the ends of a range).
 */
export function spokenDay(at: number, now: number, timeZone: string, language: SpokenLanguage, opts: { article?: boolean; relative?: boolean } = {}): string {
  const p = localParts(at, timeZone);
  const away = daysAway(at, now, timeZone);
  const words = dateWords(p, language, { month: true, year: p.y !== localParts(now, timeZone).y });
  const rel = opts.relative === false ? undefined : relativeDay(away, language);
  if (rel) return `${rel}, ${words}`;
  if (opts.article === false) return words;
  return `${language === "es-419" ? "el" : "on"} ${words}`;
}

/**
 * From a start to an end: "mañana, miércoles 25, de 10:00 a 11:00", "hoy de 16:00 a 17:00"; across midnight "el viernes
 * 27 a las 22:00 hasta el sábado 28 a la 1:00". English: "tomorrow, Wednesday, November 25, from 10:00 AM to 11:00 AM".
 */
export function spokenSpan(start: number, end: number, now: number, timeZone: string, language: SpokenLanguage): string {
  const s = localParts(start, timeZone);
  const e = localParts(end, timeZone);
  if (dayNumber(s) !== dayNumber(e)) {
    const until = spokenWhen(end, now, timeZone, language).replace(/^(el|on) /, "");
    return `${spokenWhen(start, now, timeZone, language)} ${language === "es-419" ? "hasta el" : "until"} ${until}`.replace(/hasta el (hoy|mañana|ayer)/, "hasta $1");
  }
  const away = daysAway(start, now, timeZone);
  const range = language === "es-419" ? `de ${clock(s, language)} a ${clock(e, language)}` : `from ${clock(s, language)} to ${clock(e, language)}`;
  if (away === 0 || away === -1) return `${relativeDay(away, language)} ${range}`;
  return `${dayLead(s, localParts(now, timeZone), away, language)} ${range}`;
}

/** "hoy", "mañana", "ayer" (es); "today", "tomorrow", "yesterday" (en); nothing for other days. */
function relativeDay(away: number, language: SpokenLanguage): string | undefined {
  const words = language === "es-419" ? ["ayer", "hoy", "mañana"] : ["yesterday", "today", "tomorrow"];
  return away >= -1 && away <= 1 ? words[away + 1] : undefined;
}

/**
 * The days of an all-day event, first and last (inclusive). Android stores them at UTC midnight, so they are read in
 * UTC: read in Costa Rica, an all-day Wednesday began "Tuesday at 18:00". A calendar that keeps them at local midnight
 * is read in the zone.
 */
export function allDayDates(event: { start: number; end: number }, timeZone: string): { first: string; last: string } {
  const utc = event.start % 86_400_000 === 0;
  const date = (t: number) => {
    const p = utc ? { y: new Date(t).getUTCFullYear(), m: new Date(t).getUTCMonth() + 1, d: new Date(t).getUTCDate() } : localParts(t, timeZone);
    return `${p.y}-${two(p.m)}-${two(p.d)}`;
  };
  const first = date(event.start);
  const last = date(Math.max(event.start, event.end - 1));
  return { first, last: last < first ? first : last };
}
