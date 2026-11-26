import { zoneOffsetMinutes } from "./time.ts";

/**
 * When a request happens, read from the user's own words (Spanish and English), by code. A 0.8B model gets
 * weekdays and hours wrong and copies the current time (harness-diagnosis.md); this reads what is
 * unambiguous and leaves the rest to the model. It never guesses: no match, no field.
 */
export interface When {
  /** Local calendar date, YYYY-MM-DD, when the words name a day (today, tomorrow, a weekday) or a time pins it. */
  date?: string;
  /** Local wall time HH:MM when the words name a time. */
  time?: string;
  /** End of a range ("de 10 a 11", "from 1 to 2pm"). */
  endTime?: string;
  /** The range ends after midnight ("de 10pm a 1am"). */
  endNextDay?: boolean;
  /** "en 2 horas", "in 30 minutes": an exact instant. */
  at?: number;
  /** True when the date came from a named day, not inferred from the time alone. */
  namedDay: boolean;
}

const WEEKDAYS: Record<string, number> = {
  domingo: 0, lunes: 1, martes: 2, "miércoles": 3, miercoles: 3, jueves: 4, viernes: 5, "sábado": 6, sabado: 6,
  sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6,
};

const B = "(?<![\\p{L}\\p{N}])";
const E = "(?![\\p{L}\\p{N}])";
const re = (src: string) => new RegExp(src.replaceAll("\\b<", B).replaceAll(">\\b", E), "iu");

// Digit-tolerant on the left, so "8am" and "10pm" count (review finding 4).
const reL = (src: string) => new RegExp(src.replaceAll("\\b<", "(?<![\\p{L}])").replaceAll(">\\b", E), "iu");
const PM = reL(String.raw`\b<(pm|p\.m\.|de la tarde|de la noche|por la tarde|por la noche|en la tarde|en la noche|tonight|esta noche|esta tarde|evening|afternoon|night)>\b`);
const AM = reL(String.raw`\b<(am|a\.m\.|de la mañana|de la manana|por la mañana|por la manana|en la mañana|en la manana|de la madrugada|morning)>\b`);

/** Night words that turn "12" into midnight. */
const NIGHT = re(String.raw`\b<(de la noche|por la noche|en la noche|esta noche|tonight|at night)>\b`);

const NUMBER_WORDS: Record<string, number> = {
  una: 1, uno: 1, one: 1, dos: 2, two: 2, tres: 3, three: 3, cuatro: 4, four: 4, cinco: 5, five: 5, seis: 6, six: 6,
  siete: 7, seven: 7, ocho: 8, eight: 8, nueve: 9, nine: 9, diez: 10, ten: 10, once: 11, eleven: 11, doce: 12, twelve: 12,
};

/**
 * Rewrites the ways people say times into the forms readTimes knows: number words after a time lead
 * ("a las nueve"), "half past 8", "quarter to 9", hyphen ranges ("6-7am", "3-4:30pm").
 */
function canonical(text: string): string {
  let t = text.toLowerCase();
  t = t.replace(/(?<![\p{L}])(a las|a la|at|de las|desde las|hasta las|from|to|until)\s+(una|uno|one|dos|two|tres|three|cuatro|four|cinco|five|seis|six|siete|seven|ocho|eight|nueve|nine|diez|ten|once|eleven|doce|twelve)(?![\p{L}])/gu, (_m, lead: string, w: string) => `${lead} ${NUMBER_WORDS[w]}`);
  t = t.replace(/(?<![\p{L}])half past (\d{1,2})(?!\d)/gu, "at $1:30");
  t = t.replace(/(?<![\p{L}])quarter past (\d{1,2})(?!\d)/gu, "at $1:15");
  t = t.replace(/(?<![\p{L}])quarter to (\d{1,2})(?!\d)/gu, (_m, h: string) => `at ${(Number(h) + 11) % 12 || 12}:45`);
  t = t.replace(/(?<![\d:])(\d{1,2}(?::\d{2})?)\s*-\s*(\d{1,2}(?::\d{2})?)\s*(am|pm|a\.m\.|p\.m\.)?(?![\p{L}\d])/gu, (_m, a: string, b: string, ap?: string) => `from ${a}${ap ?? ""} to ${b}${ap ?? ""}`);
  // A bare range start ("block 2 to 3pm"): give it a lead so it reads as a time.
  t = t.replace(/(?<!(?:de|from|a las|at)\s)(?<![\p{L}\d:])(\d{1,2}(?::\d{2})?)\s+(to|a|hasta)\s+(\d{1,2}(?::\d{2})?)(?![\d:])/gu, "from $1 $2 $3");
  return t;
}

/** Local Y-M-D of an instant in a zone. */
function localDate(t: number, timeZone: string): { y: number; m: number; d: number; dow: number; minutes: number } {
  const local = new Date(t + zoneOffsetMinutes(t, timeZone) * 60000);
  return { y: local.getUTCFullYear(), m: local.getUTCMonth() + 1, d: local.getUTCDate(), dow: local.getUTCDay(), minutes: local.getUTCHours() * 60 + local.getUTCMinutes() };
}

function ymd(y: number, m: number, d: number): string {
  const t = new Date(Date.UTC(y, m - 1, d, 12));
  return t.toISOString().slice(0, 10);
}

const hhmm = (minutes: number) => `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;

interface TimeWord {
  h: number;
  min: number;
  explicitPm?: boolean;
  explicitAm?: boolean;
  /** "a la una menos cuarto": 15 minutes before the hour, applied after am/pm is resolved. */
  minusQuarter?: boolean;
  /** Led by "a las"/"at", or carrying minutes or am/pm: certainly a clock time. */
  strong: boolean;
  /** Range end: led by "a"/"to"/"hasta"/"until". */
  rangeEnd: boolean;
}

/** The hour words: "a las 7:30", "at 10", "10pm", "10 y media", "noon", "mediodía", in text order. */
function readTimes(text: string): TimeWord[] {
  const out: Array<TimeWord & { at: number }> = [];
  const noon = re(String.raw`\b<(mediod[ií]a|noon|midday)>\b`).exec(text);
  if (noon) out.push({ h: 12, min: 0, strong: true, rangeEnd: false, at: noon.index });
  const midnight = re(String.raw`\b<(medianoche|midnight)>\b`).exec(text);
  if (midnight) out.push({ h: 0, min: 0, explicitAm: true, strong: true, rangeEnd: false, at: midnight.index });
  // "a las 10 y media", "at 7:30", "las 9", "10pm", "de 10 a 11", "from 1 to 2pm"
  const pattern = new RegExp(`${B}(?:(a las|a la|las|at|de|from|to|a|hasta|until|till)\\s+)?(\\d{1,2})(?:[:.h](\\d{2}))?\\s*(y media|y cuarto|menos cuarto|am|a\\.m\\.|pm|p\\.m\\.)?${E}`, "giu");
  for (const m of text.matchAll(pattern)) {
    const lead = (m[1] ?? "").toLowerCase();
    const h = Number(m[2]);
    let min = m[3] ? Number(m[3]) : 0;
    const suffix = (m[4] ?? "").toLowerCase();
    // A bare number is a time only with a lead word ("a las 7", "at 7"), minutes ("7:30") or am/pm.
    if (!lead && !m[3] && !suffix) continue;
    // Not a time: "15 minutos", "10 minutes", dates like "4 de mayo", amounts and counts.
    const after = text.slice((m.index ?? 0) + m[0].length).trimStart().toLowerCase();
    if (/^(horas?|hours?|hrs?\b|minutos?|minutes?|mins?\b|d[ií]as?|days?|de (enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre)|años?|years?|personas?|people|dólares|dolares|dollars|pills?|pastillas?|cosas|things|veces|times|%)/.test(after)) continue;
    if (h > 23 || min > 59) continue;
    if (suffix === "y media") min = 30;
    else if (suffix === "y cuarto") min = 15;
    out.push({
      h,
      min,
      minusQuarter: suffix === "menos cuarto",
      explicitPm: suffix === "pm" || suffix === "p.m.",
      explicitAm: suffix === "am" || suffix === "a.m.",
      strong: lead === "a las" || lead === "a la" || lead === "at" || !!m[3] || /^(am|pm|a\.m\.|p\.m\.)$/.test(suffix) || suffix === "y media" || suffix === "y cuarto" || suffix === "menos cuarto",
      rangeEnd: lead === "a" || lead === "to" || lead === "hasta" || lead === "until" || lead === "till",
      at: m.index ?? 0,
    });
  }
  return out.sort((x, y) => x.at - y.at);
}

export function extractWhen(text: string, now: number, timeZone: string): When {
  const t = canonical(text);
  const today = localDate(now, timeZone);
  const result: When = { namedDay: false };

  // Relative: "en 2 horas", "in 30 minutes", "dentro de 1 hora".
  const rel = t.match(re(String.raw`\b<(?:en|dentro de|in)\s+(\d{1,3}|una|un|an|a|one|media)\s+(horas?|hours?|hrs?|minutos?|minutes?|mins?)(\s+(?:y media|and a half))?>\b`));
  if (rel) {
    const n = rel[1] === "media" ? 0.5 : /^(una|un|an|a|one)$/.test(rel[1]!) ? 1 : Number(rel[1]);
    const unit = /^h/.test(rel[2]!) ? 3_600_000 : 60_000;
    result.at = now + n * unit + (rel[3] ? unit / 2 : 0);
    return result;
  }

  // Day: "pasado mañana", "mañana" (not "de la mañana"), "tomorrow", "hoy/today/tonight", weekdays.
  let offset: number | undefined;
  if (re(String.raw`\b<pasado mañana|day after tomorrow>\b`).test(t)) offset = 2;
  else if (re(String.raw`\b<(tomorrow)>\b`).test(t) || /(^|[^\p{L}])(?<!la |por la |en la |de la )mañana(?![\p{L}])/u.test(t)) offset = 1;
  else if (re(String.raw`\b<(hoy|today|tonight|esta noche|esta tarde|this evening|this afternoon)>\b`).test(t)) offset = 0;
  else {
    for (const [name, dow] of Object.entries(WEEKDAYS)) {
      if (!re(`\\b<${name}>\\b`).test(t)) continue;
      const diff = (dow - today.dow + 7) % 7;
      offset = diff === 0 ? 7 : diff;
      break;
    }
  }
  if (offset !== undefined) {
    result.date = ymd(today.y, today.m, today.d + offset);
    result.namedDay = true;
  }
  // Absolute dates: "el 20 de noviembre", "November 20", "Nov 20th", "the 20th of November". The next time
  // that date comes around (today counts).
  if (offset === undefined) {
    const abs = absoluteDate(t, today);
    if (abs) {
      result.date = abs.date;
      result.namedDay = true;
      offset = Math.max(1, abs.daysAhead); // a named future day for the time rules below ("a las 3" is 15:00)
    }
  }

  const times = readTimes(t);
  if (!times.length) return result;
  const pm = PM.test(t);
  const am = AM.test(t);
  const night = NIGHT.test(t);
  // The first certain clock time wins over a number that only looks like one ("las dos cosas a las 9").
  let startIdx = Math.max(0, times.findIndex((x) => x.strong));
  // A strong range end ("from 1 to 2pm") starts at the time just before it.
  if (times[startIdx]!.rangeEnd && startIdx > 0) startIdx--;
  const first = times[startIdx]!;
  const next = times[startIdx + 1];
  const second = next && next.rangeEnd ? next : undefined;
  const resolve = (x: TimeWord, rangePm: boolean): number => {
    let h = x.h;
    if (h === 12 && night && !x.explicitPm) h = 0; // "a las 12 de la noche", "tonight at 12": midnight
    else if ((x.explicitPm || ((pm || rangePm) && !x.explicitAm)) && h < 12) h += 12;
    else if ((x.explicitAm || (am && !x.explicitPm)) && h === 12) h = 0;
    else if (!x.explicitAm && !am && !x.explicitPm && !pm && h >= 1 && h <= 5 && offset !== undefined && offset > 0) h += 12; // "mañana a las 3": afternoon
    return h * 60 + x.min - (x.minusQuarter ? 15 : 0);
  };
  // A range's am/pm on its end applies to its start ("from 1 to 2pm").
  let start = resolve(first, !!second?.explicitPm);
  let end = second ? resolve(second, false) : undefined;
  if (end !== undefined && end <= start) {
    // "de 12 a 1" is 12:00 to 13:00; "de 10pm a 1am" ends after midnight.
    if (!second!.explicitAm && !am && end + 12 * 60 > start && end + 12 * 60 < 24 * 60) end += 12 * 60;
    else end += 24 * 60;
  }
  const midnightTonight = first.h === 12 && night && !first.explicitPm;
  const ambiguous = !first.explicitAm && !first.explicitPm && !pm && !am && first.h >= 1 && first.h <= 12;
  if (start < 0) start += 24 * 60; // "a las 12 menos cuarto" of the night
  if (offset === undefined) {
    // No day named: the next time this clock reading comes around (at 21:00, "a las 10" is 22:00 today and
    // "a las 7:30" is 07:30 tomorrow).
    if (ambiguous && start < 12 * 60 && start + 12 * 60 > today.minutes && start <= today.minutes) start += 12 * 60;
    const day = start > today.minutes ? 0 : 1;
    result.date = ymd(today.y, today.m, today.d + day);
  } else if (midnightTonight) {
    // "tonight at 12" is the midnight that ends the named day.
    result.date = ymd(today.y, today.m, today.d + offset + 1);
  }
  result.time = hhmm(start % (24 * 60));
  if (end !== undefined) {
    result.endTime = hhmm(end % (24 * 60));
    if (end >= 24 * 60) result.endNextDay = true;
  }
  return result;
}

const MONTHS: Record<string, number> = {
  enero: 1, febrero: 2, marzo: 3, abril: 4, mayo: 5, junio: 6, julio: 7, agosto: 8, septiembre: 9, setiembre: 9, octubre: 10, noviembre: 11, diciembre: 12,
  january: 1, jan: 1, february: 2, feb: 2, march: 3, mar: 3, april: 4, apr: 4, may: 5, june: 6, jun: 6, july: 7, jul: 7, august: 8, aug: 8,
  september: 9, sep: 9, sept: 9, october: 10, oct: 10, november: 11, nov: 11, december: 12, dec: 12,
};
const MONTH = Object.keys(MONTHS).sort((a, b) => b.length - a.length).join("|");

function absoluteDate(t: string, today: { y: number; m: number; d: number }): { date: string; daysAhead: number } | undefined {
  const dayFirst = new RegExp(`(?<![\\p{L}\\p{N}:])(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:de|of)\\s+(${MONTH})(?![\\p{L}])`, "iu").exec(t);
  const monthFirst = new RegExp(`(?<![\\p{L}])(${MONTH})\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?(?![\\p{N}:])`, "iu").exec(t);
  const m = dayFirst ? { day: Number(dayFirst[1]), month: MONTHS[dayFirst[2]!.toLowerCase()]! } : monthFirst ? { day: Number(monthFirst[2]), month: MONTHS[monthFirst[1]!.toLowerCase()]! } : undefined;
  if (!m || m.day < 1 || m.day > 31) return undefined;
  const thisYear = Date.UTC(today.y, m.month - 1, m.day);
  const base = Date.UTC(today.y, today.m - 1, today.d);
  const y = thisYear >= base ? today.y : today.y + 1;
  const target = Date.UTC(y, m.month - 1, m.day);
  if (new Date(target).getUTCDate() !== m.day) return undefined; // "31 de febrero"
  return { date: ymd(y, m.month, m.day), daysAhead: Math.round((target - base) / 86_400_000) };
}

/** "YYYY-MM-DDTHH:MM:00" local wall time, the argument format the skills take. */
export function localIso(date: string, time: string): string {
  return `${date}T${time}:00`;
}

/** Local wall time of an instant as "YYYY-MM-DDTHH:MM:00". */
export function localIsoOf(t: number, timeZone: string): string {
  const l = localDate(t, timeZone);
  return localIso(ymd(l.y, l.m, l.d), hhmm(l.minutes));
}
