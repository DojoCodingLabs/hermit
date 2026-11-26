/**
 * CT-02: time. Stored as UTC epoch milliseconds; the phone's IANA zone is read at use.
 * The model writes local wall-clock times ("2026-11-12T21:00"); this turns them into instants.
 */

/** Offset of `timeZone` from UTC at `instant`, in minutes (UTC-6 is -360). */
export function zoneOffsetMinutes(instant: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).formatToParts(new Date(instant));
  const n = (t: string) => Number(parts.find((p) => p.type === t)!.value);
  const asUtc = Date.UTC(n("year"), n("month") - 1, n("day"), n("hour"), n("minute"), n("second"));
  return Math.round((asUtc - Math.floor(instant / 1000) * 1000) / 60000);
}

export class TimeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TimeError";
  }
}

const ISO = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?(Z|[+-]\d{2}:?\d{2})?$/;

/**
 * An ISO-8601 date-time to epoch ms. With an explicit offset or Z it is exact; without one it is
 * read as wall-clock time in `timeZone` (DST handled by re-checking the offset at the result).
 */
export function parseDateTime(text: string, timeZone: string): number {
  const m = ISO.exec(text.trim());
  if (!m) throw new TimeError(`"${text}" is not an ISO-8601 date-time.`);
  const [, y, mo, d, h, mi, s = "0", zone] = m;
  const wall = Date.UTC(+y!, +mo! - 1, +d!, +h!, +mi!, +s);
  const check = new Date(wall);
  if (check.getUTCMonth() !== +mo! - 1 || check.getUTCDate() !== +d! || +h! > 23 || +mi! > 59) throw new TimeError(`"${text}" is not a real date.`);
  if (zone === "Z") return wall;
  if (zone) {
    const sign = zone[0] === "-" ? -1 : 1;
    const [hh, mm] = zone.slice(1).replace(":", "").match(/(\d{2})(\d{2})/)!.slice(1);
    return wall - sign * (+hh! * 60 + +mm!) * 60000;
  }
  let guess = wall - zoneOffsetMinutes(wall, timeZone) * 60000;
  guess = wall - zoneOffsetMinutes(guess, timeZone) * 60000;
  return guess;
}

/** "2026-11-11T18:20:00-06:00 (Wednesday)": what the model is told the time is, so it can resolve "in 2 hours". */
export function describeNow(now: number, timeZone: string): string {
  const off = zoneOffsetMinutes(now, timeZone);
  const local = new Date(now + off * 60000).toISOString().slice(0, 19);
  const sign = off < 0 ? "-" : "+";
  const abs = Math.abs(off);
  const weekday = new Intl.DateTimeFormat("en-US", { timeZone, weekday: "long" }).format(new Date(now));
  return `${local}${sign}${String(Math.floor(abs / 60)).padStart(2, "0")}:${String(abs % 60).padStart(2, "0")} (${weekday})`;
}

/**
 * The clock line for model prompts: "Wednesday, November 11, 2026, 21:00 local time (today is 2026-11-11;
 * tomorrow is Thursday 2026-11-12)". No ISO-with-offset string: BotPsy copied describeNow's verbatim into
 * reminder times and contact names (docs/research/harness-diagnosis.md).
 */
export function describeNowForModel(now: number, timeZone: string): string {
  const date = (t: number) => new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(t));
  const long = new Intl.DateTimeFormat("en-US", { timeZone, weekday: "long", year: "numeric", month: "long", day: "numeric" }).format(new Date(now));
  const time = new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(now));
  // The next seven dates by calendar day (not now + 24 h, which repeats a day across DST): a lookup table,
  // because a 0.8B model gets "Friday" or "Monday" wrong when it has to count (harness-diagnosis.md).
  const [y, m, d] = date(now).split("-").map(Number);
  const days = Array.from({ length: 7 }, (_, i) => {
    const noon = new Date(Date.UTC(y!, m! - 1, d! + 1 + i, 12));
    return `${new Intl.DateTimeFormat("en-US", { timeZone: "UTC", weekday: "long" }).format(noon)} ${noon.toISOString().slice(0, 10)}`;
  });
  return `${long}, ${time} local time (today is ${date(now)}; tomorrow is ${days[0]}; then ${days.slice(1).join(", ")})`;
}

/** Display only, in the user's locale and zone. */
export function formatLocalTime(instant: number, locale: string, timeZone: string): string {
  return new Intl.DateTimeFormat(locale, { timeZone, weekday: "short", hour: "numeric", minute: "2-digit", month: "short", day: "numeric" }).format(new Date(instant));
}
