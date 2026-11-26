import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { briefingView, NIGHT_JOBS, nightBackgroundView, nightSettingsView, type Briefing, type JobReport, type PauseReason, type SuggestionStatus } from "../src/index.ts";
import { COOL, settings } from "./helpers.ts";

const load = (name: string): Record<string, string> => JSON.parse(readFileSync(new URL(`../../copy/locales/${name}.json`, import.meta.url), "utf8"));
const locales = { en: load("en"), "es-419": load("es-419") };

/** Every value under a key ending in "Key" or "Keys", anywhere in a view. */
function keysIn(v: unknown, out: string[] = []): string[] {
  if (Array.isArray(v)) v.forEach((x) => keysIn(x, out));
  else if (v && typeof v === "object") {
    for (const [k, x] of Object.entries(v)) {
      if (/Keys?$/.test(k)) out.push(...(Array.isArray(x) ? (x as string[]) : [x as string]));
      else keysIn(x, out);
    }
  }
  return out;
}

const REASONS: PauseReason[] = ["hot", "battery_low", "not_charging", "screen_on", "no_wifi"];
const STATUSES: SuggestionStatus[] = ["pending", "done", "declined", "unavailable", "failed"];

describe("HM-NIGHT-01 and HM-NIGHT-02 copy (CT-10)", () => {
  test("every key the views can produce exists in en and es-419", () => {
    const keys = new Set<string>();
    const jobs: JobReport[] = [];
    for (const status of ["pending", "ran", "paused", "skipped", "failed"] as const) for (const job of NIGHT_JOBS) jobs.push({ job, status });
    for (const reason of [...REASONS, "outside_window" as const]) jobs.push({ job: "mail", status: "skipped", reason });
    for (const stop of [undefined, ...REASONS]) {
      const b: Briefing = {
        id: "b", date: "2026-11-14", createdAt: 1, updatedAt: 1, closed: false, jobs, refusals: [{ job: "mail", skill: "x", at: 1 }],
        sections: NIGHT_JOBS.map((job) => ({ job, untrusted: true, quotes: [], items: [], count: 0 })),
        suggestions: STATUSES.flatMap((status) => (["reply_draft", "other"] as const).flatMap((kind) => (["email", "inbound_message", "web"] as const).map((taintKind) => ({
          id: `${status}${kind}${taintKind}`, job: "mail" as const, kind, skill: "mail_draft", args: {}, argsHash: "h", tainted: true, taintKind, vars: { who: "a", subject: "b" }, status, createdAt: 1,
        })))),
        ...(stop ? { stop } : {}),
      };
      keysIn(briefingView(b)).forEach((k) => keys.add(k));
    }
    keysIn(briefingView(undefined)).forEach((k) => keys.add(k));
    for (const problem of [{ window: { start: "x", end: "y" } }, { window: { start: "02:00", end: "02:00" } }, { briefingAt: "03:00" }, { jobs: [] }]) {
      keysIn(nightSettingsView(settings(problem), { ...COOL, charging: false, thermalStatus: 3, batteryPercent: 5, network: "none" })).forEach((k) => keys.add(k));
    }
    const bg = { supported: true, scheduled: true, ignoringBatteryOptimizations: true, notificationsAllowed: false };
    for (const status of [undefined, bg, { ...bg, scheduled: false }, { ...bg, ignoringBatteryOptimizations: false }, { ...bg, ignoringBatteryOptimizations: false, lastBlockedAt: 2 }]) {
      for (const enabled of [true, false]) keysIn(nightBackgroundView(enabled, status)).forEach((k) => keys.add(k));
    }
    for (const k of ["HM-NIGHT-01.background.title", "HM-NIGHT-01.background.notifyTitle", "HM-NIGHT-01.background.notifyText"]) keys.add(k);
    for (const k of keys) {
      expect(locales.en[k], k).toBeTruthy();
      expect(locales["es-419"][k], k).toBeTruthy();
    }
    expect(keys.size).toBeGreaterThan(40);
  });
});
