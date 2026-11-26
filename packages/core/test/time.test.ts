import { describe, expect, test } from "vitest";
import { describeNow, describeNowForModel, parseDateTime, TimeError, zoneOffsetMinutes } from "../src/time.ts";

describe("time (CT-02)", () => {
  test("reads wall-clock time in the phone's zone", () => {
    // Costa Rica is UTC-6 all year.
    expect(parseDateTime("2026-11-12T21:00", "America/Costa_Rica")).toBe(Date.UTC(2026, 10, 13, 3, 0));
  });

  test("an explicit offset or Z wins over the zone", () => {
    expect(parseDateTime("2026-11-12T21:00:00Z", "America/Costa_Rica")).toBe(Date.UTC(2026, 10, 12, 21, 0));
    expect(parseDateTime("2026-11-12T21:00-05:00", "America/Costa_Rica")).toBe(Date.UTC(2026, 10, 13, 2, 0));
  });

  test("handles daylight saving time", () => {
    // New York: EDT (UTC-4) in July, EST (UTC-5) in January.
    expect(parseDateTime("2026-07-01T09:00", "America/New_York")).toBe(Date.UTC(2026, 6, 1, 13, 0));
    expect(parseDateTime("2026-01-15T09:00", "America/New_York")).toBe(Date.UTC(2026, 0, 15, 14, 0));
    expect(zoneOffsetMinutes(Date.UTC(2026, 6, 1), "America/New_York")).toBe(-240);
  });

  test("refuses dates that don't exist or aren't ISO", () => {
    for (const bad of ["2026-02-30T10:00", "tomorrow at 9", "2026-11-12 21:00", "2026-11-12T25:00"]) {
      expect(() => parseDateTime(bad, "UTC"), bad).toThrow(TimeError);
    }
  });

  test("tells the model the local time with its offset and weekday", () => {
    expect(describeNow(Date.UTC(2026, 10, 12, 0, 20), "America/Costa_Rica")).toBe("2026-11-11T18:20:00-06:00 (Wednesday)");
    // The model's clock line has no ISO-with-offset string to copy, and crosses midnight correctly.
    expect(describeNowForModel(Date.UTC(2026, 10, 12, 0, 20), "America/Costa_Rica")).toBe("Wednesday, November 11, 2026, 18:20 local time (today is 2026-11-11; tomorrow is Thursday 2026-11-12; then Friday 2026-11-13, Saturday 2026-11-14, Sunday 2026-11-15, Monday 2026-11-16, Tuesday 2026-11-17, Wednesday 2026-11-18)");
    expect(describeNowForModel(Date.UTC(2026, 10, 12, 5, 59), "America/Costa_Rica")).toContain("23:59 local time (today is 2026-11-11");
  });
});
