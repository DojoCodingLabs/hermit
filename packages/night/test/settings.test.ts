import { describe, expect, test } from "vitest";
import {
  blockers, briefingDate, briefingTime, DEFAULT_NIGHT_SETTINGS, inWindow, nextWindowStart, parseNightSettings, UNKNOWN_DEVICE, validateNightSettings,
  type DeviceState, type NightSettings,
} from "../src/index.ts";

const TZ = "America/Costa_Rica"; // UTC-6, no DST
/** 2026-11-14 at hh:mm in Costa Rica. */
const at = (hh: number, mm = 0, day = 14) => Date.UTC(2026, 10, day, hh + 6, mm);
const settings = (over: Partial<NightSettings> = {}): NightSettings => ({ ...DEFAULT_NIGHT_SETTINGS, enabled: true, ...over });
const ok: DeviceState = { charging: true, batteryPercent: 80, thermalStatus: 0, screenOn: false, network: "wifi" };

describe("night shift settings (HM-NIGHT-01, US-NIGHT-01)", () => {
  test("off by default, email off by default, the briefing after the window", () => {
    expect(DEFAULT_NIGHT_SETTINGS.enabled).toBe(false);
    expect(DEFAULT_NIGHT_SETTINGS.jobs).not.toContain("mail");
    expect(validateNightSettings(DEFAULT_NIGHT_SETTINGS)).toEqual([]);
  });

  test("a broken or foreign value reads back as the defaults (off), never as a half setting", () => {
    expect(parseNightSettings(undefined)).toEqual(DEFAULT_NIGHT_SETTINGS);
    expect(parseNightSettings("{not json")).toEqual(DEFAULT_NIGHT_SETTINGS);
    expect(parseNightSettings(JSON.stringify({ enabled: true, window: { start: "25:00", end: "06:00" }, jobs: ["agenda"], briefingAt: "07:00" }))).toEqual(DEFAULT_NIGHT_SETTINGS);
    expect(parseNightSettings(JSON.stringify({ ...DEFAULT_NIGHT_SETTINGS, enabled: true, jobs: ["agenda", "wallet"] }))).toEqual(DEFAULT_NIGHT_SETTINGS);
    const good = settings({ jobs: ["agenda", "mail"] });
    expect(parseNightSettings(JSON.stringify(good))).toEqual(good);
  });

  test("problems: bad times, an empty window, a briefing inside the window, no jobs", () => {
    expect(validateNightSettings(settings({ window: { start: "7:00", end: "06:00" } }))).toContain("bad_time");
    expect(validateNightSettings(settings({ window: { start: "02:00", end: "02:00" } }))).toContain("empty_window");
    expect(validateNightSettings(settings({ window: { start: "01:00", end: "06:00" }, briefingAt: "03:00" }))).toContain("briefing_in_window");
    expect(validateNightSettings(settings({ jobs: [] }))).toContain("no_jobs");
  });

  test("the window may cross midnight", () => {
    const w = { start: "23:00", end: "05:00" };
    expect(inWindow(at(23, 30), TZ, w)).toBe(true);
    expect(inWindow(at(2), TZ, w)).toBe(true);
    expect(inWindow(at(5), TZ, w)).toBe(false);
    expect(inWindow(at(12), TZ, w)).toBe(false);
    expect(inWindow(at(3), TZ, { start: "01:00", end: "06:00" })).toBe(true);
    expect(inWindow(at(0, 59), TZ, { start: "01:00", end: "06:00" })).toBe(false);
  });

  test("the briefing belongs to the morning the window ends on, and is announced at the chosen time", () => {
    const w = { start: "23:00", end: "05:00" };
    expect(briefingDate(at(23, 30, 13), TZ, w)).toBe("2026-11-14");
    expect(briefingDate(at(2), TZ, w)).toBe("2026-11-14");
    expect(briefingTime("2026-11-14", "07:00", TZ)).toBe(at(7));
    expect(nextWindowStart(at(12), TZ, w)).toBe(at(23));
    expect(nextWindowStart(at(2), TZ, w)).toBe(at(23));
  });
});

describe("device guards (FR-NIGHT-01, NFR-04, US-NIGHT-04)", () => {
  test("all clear while charging, cool, above the floor, screen off, on Wi-Fi", () => {
    expect(blockers(ok, { needsNetwork: true })).toEqual([]);
  });

  test("pauses at the moderate thermal status or above, below 30% battery, off the charger, with the screen on", () => {
    expect(blockers({ ...ok, thermalStatus: 1 }, { needsNetwork: false })).toEqual([]);
    expect(blockers({ ...ok, thermalStatus: 2 }, { needsNetwork: false })).toEqual(["hot"]);
    expect(blockers({ ...ok, batteryPercent: 29 }, { needsNetwork: false })).toEqual(["battery_low"]);
    expect(blockers({ ...ok, batteryPercent: 30 }, { needsNetwork: false })).toEqual([]);
    expect(blockers({ ...ok, charging: false }, { needsNetwork: false })).toEqual(["not_charging"]);
    expect(blockers({ ...ok, screenOn: true }, { needsNetwork: false })).toEqual(["screen_on"]);
  });

  test("only jobs that need the network need Wi-Fi", () => {
    expect(blockers({ ...ok, network: "cellular" }, { needsNetwork: false })).toEqual([]);
    expect(blockers({ ...ok, network: "cellular" }, { needsNetwork: true })).toEqual(["no_wifi"]);
    expect(blockers({ ...ok, network: "none" }, { needsNetwork: true })).toEqual(["no_wifi"]);
  });

  test("heat comes first, and a phone that can't be read fails closed", () => {
    expect(blockers({ ...ok, thermalStatus: 4, charging: false }, { needsNetwork: false })[0]).toBe("hot");
    expect(blockers(UNKNOWN_DEVICE, { needsNetwork: false }).length).toBeGreaterThan(0);
    expect(blockers({ ...ok, thermalStatus: Number.NaN }, { needsNetwork: false })).toContain("hot");
    expect(blockers({ ...ok, batteryPercent: Number.NaN }, { needsNetwork: false })).toContain("battery_low");
  });

  test("a manual run (the debug button) skips only the screen check, never heat, battery or the charger", () => {
    expect(blockers({ ...ok, screenOn: true }, { needsNetwork: false, manual: true })).toEqual([]);
    expect(blockers({ ...ok, screenOn: true, thermalStatus: 3 }, { needsNetwork: false, manual: true })).toEqual(["hot"]);
  });
});
