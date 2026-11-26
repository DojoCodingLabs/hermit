import { describe, expect, test } from "vitest";
import { allDayDates, daysAway, localParts, modelDay, modelWhen, spokenClock, spokenDay, spokenSpan, spokenWhen } from "../src/local-time.ts";

// Tuesday 2026-11-24, 14:35 in Costa Rica (UTC-6): the W1 phone session.
const TZ = "America/Costa_Rica";
const at = (iso: string) => Date.parse(`${iso}-06:00`);
const NOW = at("2026-11-24T14:35");
const LATE = at("2026-11-24T23:30"); // already Wednesday in UTC

describe("local parts and days (W1: never UTC)", () => {
  test("an instant's date and wall time in the zone, also when UTC is already tomorrow", () => {
    expect(localParts(LATE, TZ)).toEqual({ y: 2026, m: 11, d: 24, dow: 2, hh: 23, mm: 30 });
    expect(localParts(at("2026-11-25T09:00"), TZ)).toEqual({ y: 2026, m: 11, d: 25, dow: 3, hh: 9, mm: 0 });
  });

  test("calendar days from today, by local date", () => {
    expect(daysAway(at("2026-11-25T00:10"), LATE, TZ)).toBe(1);
    expect(daysAway(at("2026-11-24T00:00"), LATE, TZ)).toBe(0);
    expect(daysAway(at("2026-11-23T23:59"), NOW, TZ)).toBe(-1);
    // Across a DST change (New York, 2026-03-08) a day is still one day.
    expect(daysAway(Date.parse("2026-03-09T08:00-04:00"), Date.parse("2026-03-07T20:00-05:00"), "America/New_York")).toBe(2);
  });
});

describe("times for the model: English, local, 24-hour, with weekday and date", () => {
  test("the stamps say today, tomorrow or yesterday", () => {
    expect(modelWhen(at("2026-11-25T09:00"), NOW, TZ)).toBe("Wednesday, November 25, 2026, 09:00 (tomorrow)");
    expect(modelWhen(at("2026-11-24T14:43"), NOW, TZ)).toBe("Tuesday, November 24, 2026, 14:43 (today)");
    expect(modelWhen(at("2026-11-23T20:10"), NOW, TZ)).toBe("Monday, November 23, 2026, 20:10 (yesterday)");
    expect(modelWhen(at("2026-11-27T17:00"), NOW, TZ)).toBe("Friday, November 27, 2026, 17:00");
    expect(modelDay(at("2026-11-25T09:00"), NOW, TZ)).toBe("Wednesday, November 25, 2026 (tomorrow)");
  });

  test("no UTC and no ISO string reaches the model", () => {
    const s = modelWhen(Date.UTC(2026, 10, 25, 15, 0), NOW, TZ); // 9:00 in Costa Rica
    expect(s).toContain("09:00");
    expect(s).not.toMatch(/15:00|Z\b|T\d\d:/);
  });
});

describe("times for the user (es-419 first, and en)", () => {
  test("the clock: 24-hour in Spanish, AM and PM in English", () => {
    expect(spokenClock(at("2026-11-25T09:00"), TZ, "es-419")).toBe("9:00");
    expect(spokenClock(at("2026-11-24T14:43"), TZ, "es-419")).toBe("14:43");
    expect(spokenClock(at("2026-11-25T00:05"), TZ, "es-419")).toBe("0:05");
    expect(spokenClock(at("2026-11-25T09:00"), TZ, "en")).toBe("9:00 AM");
    expect(spokenClock(at("2026-11-24T14:43"), TZ, "en")).toBe("2:43 PM");
    expect(spokenClock(at("2026-11-24T12:00"), TZ, "en")).toBe("12:00 PM");
    expect(spokenClock(at("2026-11-25T00:30"), TZ, "en")).toBe("12:30 AM");
  });

  test("when, relative to now", () => {
    const es = (iso: string) => spokenWhen(at(iso), NOW, TZ, "es-419");
    expect(es("2026-11-25T09:00")).toBe("mañana, miércoles 25, a las 9:00");
    expect(es("2026-11-24T14:37")).toBe("hoy a las 14:37");
    expect(es("2026-11-23T20:10")).toBe("ayer a las 20:10");
    expect(es("2026-11-27T17:00")).toBe("el viernes 27 a las 17:00");
    expect(es("2026-11-26T01:15")).toBe("el jueves 26 a la 1:15");
    expect(es("2026-12-03T08:00")).toBe("el jueves 3 de diciembre a las 8:00");
    expect(es("2027-01-04T09:00")).toBe("el lunes 4 de enero de 2027 a las 9:00");
    const en = (iso: string) => spokenWhen(at(iso), NOW, TZ, "en");
    expect(en("2026-11-25T09:00")).toBe("tomorrow, Wednesday, November 25, at 9:00 AM");
    expect(en("2026-11-24T14:37")).toBe("today at 2:37 PM");
    expect(en("2026-11-23T20:10")).toBe("yesterday at 8:10 PM");
    expect(en("2026-11-27T17:00")).toBe("on Friday, November 27, at 5:00 PM");
    expect(en("2027-01-04T09:00")).toBe("on Monday, January 4, 2027, at 9:00 AM");
  });

  test("tomorrow in another month names the month", () => {
    const end = at("2026-11-30T20:00");
    expect(spokenWhen(at("2026-12-01T09:00"), end, TZ, "es-419")).toBe("mañana, martes 1 de diciembre, a las 9:00");
  });

  test("a message from today reads as just its time", () => {
    expect(spokenWhen(at("2026-11-24T14:43"), NOW, TZ, "es-419", { bareToday: true })).toBe("a las 14:43");
    expect(spokenWhen(at("2026-11-24T13:05"), NOW, TZ, "es-419", { bareToday: true })).toBe("a las 13:05");
    expect(spokenWhen(at("2026-11-24T01:05"), NOW, TZ, "es-419", { bareToday: true })).toBe("a la 1:05");
    expect(spokenWhen(at("2026-11-24T14:43"), NOW, TZ, "en", { bareToday: true })).toBe("at 2:43 PM");
    expect(spokenWhen(at("2026-11-23T20:10"), NOW, TZ, "es-419", { bareToday: true })).toBe("ayer a las 20:10");
  });

  test("a day", () => {
    expect(spokenDay(at("2026-11-25T00:00"), NOW, TZ, "es-419")).toBe("mañana, miércoles 25 de noviembre");
    expect(spokenDay(at("2026-11-24T08:00"), NOW, TZ, "es-419")).toBe("hoy, martes 24 de noviembre");
    expect(spokenDay(at("2026-11-29T08:00"), NOW, TZ, "es-419")).toBe("el domingo 29 de noviembre");
    expect(spokenDay(at("2026-11-29T08:00"), NOW, TZ, "es-419", { article: false })).toBe("domingo 29 de noviembre");
    expect(spokenDay(at("2027-01-04T08:00"), NOW, TZ, "es-419")).toBe("el lunes 4 de enero de 2027");
    expect(spokenDay(at("2026-11-25T00:00"), NOW, TZ, "en")).toBe("tomorrow, Wednesday, November 25");
    expect(spokenDay(at("2026-11-29T08:00"), NOW, TZ, "en")).toBe("on Sunday, November 29");
    expect(spokenDay(at("2026-11-29T08:00"), NOW, TZ, "en", { article: false })).toBe("Sunday, November 29");
    // The ends of a range: no "mañana".
    expect(spokenDay(at("2026-11-25T00:00"), NOW, TZ, "es-419", { article: false, relative: false })).toBe("miércoles 25 de noviembre");
    expect(spokenDay(at("2026-11-25T00:00"), NOW, TZ, "en", { article: false, relative: false })).toBe("Wednesday, November 25");
  });

  test("a span: one day, or across midnight", () => {
    expect(spokenSpan(at("2026-11-25T10:00"), at("2026-11-25T11:00"), NOW, TZ, "es-419")).toBe("mañana, miércoles 25, de 10:00 a 11:00");
    expect(spokenSpan(at("2026-11-27T10:00"), at("2026-11-27T11:00"), NOW, TZ, "es-419")).toBe("el viernes 27 de 10:00 a 11:00");
    expect(spokenSpan(at("2026-11-24T16:00"), at("2026-11-24T17:00"), NOW, TZ, "es-419")).toBe("hoy de 16:00 a 17:00");
    expect(spokenSpan(at("2026-11-27T22:00"), at("2026-11-28T01:00"), NOW, TZ, "es-419")).toBe("el viernes 27 a las 22:00 hasta el sábado 28 a la 1:00");
    expect(spokenSpan(at("2026-11-25T10:00"), at("2026-11-25T11:00"), NOW, TZ, "en")).toBe("tomorrow, Wednesday, November 25, from 10:00 AM to 11:00 AM");
    expect(spokenSpan(at("2026-11-24T16:00"), at("2026-11-24T17:00"), NOW, TZ, "en")).toBe("today from 4:00 PM to 5:00 PM");
    expect(spokenSpan(at("2026-11-27T22:00"), at("2026-11-28T01:00"), NOW, TZ, "en")).toBe("on Friday, November 27, at 10:00 PM until Saturday, November 28, at 1:00 AM");
  });

  test("a UTC+ zone reads its own day too", () => {
    const tokyo = "Asia/Tokyo";
    const now = Date.parse("2026-11-24T08:30+09:00"); // still Monday in UTC
    expect(spokenWhen(Date.parse("2026-11-25T09:00+09:00"), now, tokyo, "es-419")).toBe("mañana, miércoles 25, a las 9:00");
    expect(modelWhen(Date.parse("2026-11-24T08:45+09:00"), now, tokyo)).toBe("Tuesday, November 24, 2026, 08:45 (today)");
  });
});

describe("all-day events: dates, not instants", () => {
  test("Android keeps them at UTC midnight: the dates are read in UTC, never shifted into the evening before", () => {
    const start = Date.UTC(2026, 10, 25);
    expect(allDayDates({ start, end: Date.UTC(2026, 10, 26) }, TZ)).toEqual({ first: "2026-11-25", last: "2026-11-25" });
    expect(allDayDates({ start, end: Date.UTC(2026, 10, 28) }, TZ)).toEqual({ first: "2026-11-25", last: "2026-11-27" });
  });

  test("a calendar that keeps them at local midnight reads them in the zone", () => {
    expect(allDayDates({ start: at("2026-11-25T00:00"), end: at("2026-11-26T00:00") }, TZ)).toEqual({ first: "2026-11-25", last: "2026-11-25" });
  });
});
