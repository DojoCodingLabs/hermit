import { zoneOffsetMinutes } from "@hermit/core";

/**
 * HM-NIGHT-01 (US-NIGHT-01): the night shift's window, its jobs and the time of the morning notice.
 * Times are local wall-clock "HH:MM" in the phone's zone; the window may cross midnight.
 */
export type NightJobId = "agenda" | "reminders" | "messages" | "mail";

/** In the order they run and are listed. */
export const NIGHT_JOBS: readonly NightJobId[] = ["agenda", "reminders", "messages", "mail"];

/** Jobs that reach a server (FR-NIGHT-01: they wait for Wi-Fi). The model and the other reads are on the phone. */
export const JOB_NEEDS_NETWORK: Readonly<Record<NightJobId, boolean>> = { agenda: false, reminders: false, messages: false, mail: true };

export interface NightWindow {
  start: string;
  end: string;
}

export interface NightSettings {
  enabled: boolean;
  window: NightWindow;
  jobs: NightJobId[];
  /** When the briefing notification fires (US-NIGHT-02). */
  briefingAt: string;
}

/**
 * Off until the user turns it on. Email is off too: switching it on is the user's standing permission for the
 * night shift to read unread mail (by day every mail read asks), so it is never on by default (Q67).
 */
export const DEFAULT_NIGHT_SETTINGS: NightSettings = Object.freeze({
  enabled: false,
  window: Object.freeze({ start: "01:00", end: "06:00" }) as NightWindow,
  jobs: Object.freeze(["agenda", "reminders", "messages"]) as unknown as NightJobId[],
  briefingAt: "07:00",
}) as NightSettings;

export type NightSettingsProblem = "bad_time" | "empty_window" | "briefing_in_window" | "no_jobs";

const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/;
const minutesOf = (hhmm: string) => {
  const m = HHMM.exec(hhmm);
  return m ? Number(m[1]) * 60 + Number(m[2]) : undefined;
};

export function validateNightSettings(s: NightSettings): NightSettingsProblem[] {
  const problems: NightSettingsProblem[] = [];
  const start = minutesOf(s.window.start);
  const end = minutesOf(s.window.end);
  const brief = minutesOf(s.briefingAt);
  if (start === undefined || end === undefined || brief === undefined) problems.push("bad_time");
  else {
    if (start === end) problems.push("empty_window");
    else if (inside(brief, start, end)) problems.push("briefing_in_window");
  }
  if (!s.jobs.length) problems.push("no_jobs");
  return problems;
}

/**
 * The stored setting, or the defaults (off) when it is missing, unreadable or invalid in any way: a half-valid
 * setting never turns the night shift on.
 */
export function parseNightSettings(raw: string | undefined): NightSettings {
  if (!raw) return DEFAULT_NIGHT_SETTINGS;
  let v: unknown;
  try {
    v = JSON.parse(raw);
  } catch {
    return DEFAULT_NIGHT_SETTINGS;
  }
  const o = v as Partial<NightSettings> | null;
  if (!o || typeof o !== "object" || typeof o.enabled !== "boolean" || typeof o.briefingAt !== "string") return DEFAULT_NIGHT_SETTINGS;
  const w = o.window as Partial<NightWindow> | undefined;
  if (!w || typeof w.start !== "string" || typeof w.end !== "string") return DEFAULT_NIGHT_SETTINGS;
  if (!Array.isArray(o.jobs) || !o.jobs.every((j) => (NIGHT_JOBS as readonly unknown[]).includes(j))) return DEFAULT_NIGHT_SETTINGS;
  const jobs = NIGHT_JOBS.filter((j) => (o.jobs as unknown[]).includes(j));
  const s: NightSettings = { enabled: o.enabled, window: { start: w.start, end: w.end }, jobs, briefingAt: o.briefingAt };
  return validateNightSettings(s).length ? DEFAULT_NIGHT_SETTINGS : s;
}

const inside = (m: number, start: number, end: number) => (start < end ? m >= start && m < end : m >= start || m < end);

/** Minutes since local midnight. */
export function localMinutes(at: number, timeZone: string): number {
  const local = new Date(at + zoneOffsetMinutes(at, timeZone) * 60_000);
  return local.getUTCHours() * 60 + local.getUTCMinutes();
}

const localDate = (at: number, timeZone: string) => new Date(at + zoneOffsetMinutes(at, timeZone) * 60_000).toISOString().slice(0, 10);

/** Inside [start, end) in local time; a window like 23:00 to 05:00 crosses midnight. */
export function inWindow(at: number, timeZone: string, window: NightWindow): boolean {
  const start = minutesOf(window.start);
  const end = minutesOf(window.end);
  if (start === undefined || end === undefined || start === end) return false;
  return inside(localMinutes(at, timeZone), start, end);
}

/** The morning a night belongs to: the local date of the window's next end at or after `at`. */
export function briefingDate(at: number, timeZone: string, window: NightWindow): string {
  const end = minutesOf(window.end) ?? 0;
  const date = localDate(at, timeZone);
  return localMinutes(at, timeZone) < end ? date : addDays(date, 1);
}

function addDays(date: string, n: number): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y!, m! - 1, d! + n)).toISOString().slice(0, 10);
}

/** Epoch ms of local `hhmm` on `date` in `timeZone`. */
export function localInstant(date: string, hhmm: string, timeZone: string): number {
  const [y, m, d] = date.split("-").map(Number);
  const mins = minutesOf(hhmm) ?? 0;
  const wall = Date.UTC(y!, m! - 1, d!, Math.floor(mins / 60), mins % 60);
  let guess = wall - zoneOffsetMinutes(wall, timeZone) * 60_000;
  guess = wall - zoneOffsetMinutes(guess, timeZone) * 60_000;
  return guess;
}

/** When the morning notice fires for a briefing dated `date`. */
export function briefingTime(date: string, briefingAt: string, timeZone: string): number {
  return localInstant(date, briefingAt, timeZone);
}

/** The next time the window opens strictly after `at` (for the scheduler's next wake). */
export function nextWindowStart(at: number, timeZone: string, window: NightWindow): number {
  const today = localInstant(localDate(at, timeZone), window.start, timeZone);
  return today > at ? today : localInstant(addDays(localDate(at, timeZone), 1), window.start, timeZone);
}
