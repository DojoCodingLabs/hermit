import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import type { RuntimePlan } from "@hermit/model";
import { firstWinSkills } from "@hermit/skills";
import { LAB_CASE_IDS, type LabRun } from "../src/device-lab.ts";
import { buildDeviceReport, median, p90, REPORT_SCHEMA, type PhoneFacts } from "../src/device-report.ts";

// The report format and its checker live with the device table (docs/devices, scripts/devices): the report built here
// must pass that exact checker, field for field.
const schema = JSON.parse(readFileSync(new URL("../../../docs/devices/schema.json", import.meta.url), "utf8"));
const goodReport = JSON.parse(readFileSync(new URL("../../../scripts/devices/fixtures/good-report.json", import.meta.url), "utf8"));
const validatorUrl = new URL("../../../scripts/devices/validate.mjs", import.meta.url).href;
const { validateReport } = (await import(validatorUrl)) as { validateReport(report: unknown, schema?: unknown, o?: { today?: Date }): { ok: boolean; errors: string[] } };
const check = (report: unknown) => validateReport(report, schema, { today: new Date("2026-11-26T12:00:00Z") });

const GB = 1024 ** 3;
// A made-up phone (Examplecorp EX-1000): 1 + 3 + 4 cores, 7.5 GB, Android 15.
const facts: PhoneFacts = {
  manufacturer: "Examplecorp",
  model: "EX-1000",
  socManufacturer: "Examplechip",
  socModel: "XC9000",
  cpuinfoHardware: "",
  buildHardware: "exm",
  totalRamBytes: 7.5 * GB,
  lowRam: false,
  androidRelease: "15",
  apiLevel: 35,
  abis: ["arm64-v8a", "armeabi-v7a"],
  logicalCores: 8,
  clusters: [{ cpus: [7], maxFreqKHz: 3_100_000 }, { cpus: [4, 5, 6], maxFreqKHz: 2_600_000 }, { cpus: [0, 1, 2, 3], maxFreqKHz: 2_000_000 }],
  cpuFeatures: { dotprod: true, i8mm: true, sve2: false, sme2: false },
  allowedCpus: [0, 1, 2, 3, 4, 5, 6, 7],
  cpuset: "/top-app",
  batterySaver: false,
};

const plan: RuntimePlan = { tier: "mid", device: "cpu", threads: 4, threadsBatch: 4, cpuMask: "f0", ctxSize: 8192, ubatch: 512, cacheCheckpoints: 4, thinkingBudget: 256, maxReplyTokens: 120, longReplyTokens: 800, fastRoute: false };
const profile = { id: "botpsy-q4-native-think256", thinking: { mode: "on" as const, budgetTokens: 256 }, fastRoute: false, contextTokens: 8192 };
const times = [30500, 28800, 25100, 26400, 31000, 33200, 34900, 29700, 47000, 36100, 22000, 51200];
const choices = ["remind", "remember", "recall", "forget", "calendar_read", "read_messages", "remind", "remember", "respond", "read_messages", "ask_user", "respond"];
const lab: LabRun = {
  plan,
  speed: {
    planned: { threads: 4, tokensPerSecond: 18.43, prefillTokensPerSecond: 72.51, firstTokenMs: 4800.4, loadMs: 3900 },
    sweep: [{ threads: 2, tokensPerSecond: 11.2, prefillTokensPerSecond: 40.1, firstTokenMs: 8600, loadMs: 2100 }],
  },
  cases: LAB_CASE_IDS.map((id, i) => ({ id, pass: id !== "en-cal-add-1", ms: times[i]!, choice: choices[i]! })),
  thermal: { start: 0, max: 1, pauses: 1, pausedMs: 45_000 },
  startedAt: Date.parse("2026-11-25T18:00:00Z"),
  endedAt: Date.parse("2026-11-25T18:09:12Z"),
};
const build = (over: { facts?: PhoneFacts; lab?: LabRun; app?: string } = {}) => buildDeviceReport({ app: over.app ?? "0.1.0", profile, facts: over.facts ?? facts, lab: over.lab ?? lab });

/** Every key path in a value, lists as [] ("device.coreMaxMHz[]", "eval.perCase[].id"). */
function valuePaths(v: unknown, path = ""): string[] {
  if (Array.isArray(v)) return v.flatMap((x) => valuePaths(x, `${path}[]`)).concat(path ? [path] : []);
  if (v && typeof v === "object") return Object.entries(v).flatMap(([k, x]) => [path ? `${path}.${k}` : k, ...valuePaths(x, path ? `${path}.${k}` : k)]);
  return [];
}

/** Every property path the schema allows, the same way. */
function schemaPaths(s: Record<string, unknown>, path = ""): string[] {
  const node = typeof s.$ref === "string" ? (schema.$defs as Record<string, Record<string, unknown>>)[s.$ref.split("/").pop()!]! : s;
  if (node.items) return [...(path ? [path] : []), ...schemaPaths(node.items as Record<string, unknown>, `${path}[]`)].filter((p, i, a) => a.indexOf(p) === i);
  const props = (node.properties ?? {}) as Record<string, Record<string, unknown>>;
  return Object.entries(props).flatMap(([k, x]) => {
    const p = path ? `${path}.${k}` : k;
    return [p, ...schemaPaths(x, p).filter((q) => q !== p)];
  });
}

const sorted = (xs: string[]) => [...new Set(xs)].sort();

describe("buildDeviceReport", () => {
  test("made from fixture facts it is exactly the report the device table's checker accepts", () => {
    const report = build();
    expect(report).toEqual(goodReport);
    expect(check(report)).toEqual({ ok: true, errors: [] });
  });

  test("redaction: the report has exactly the schema's fields, no more and no fewer (a new field needs a schema change)", () => {
    expect(sorted(valuePaths(build()))).toEqual(sorted(schemaPaths(schema)));
  });

  test("redaction: whatever else the facts carry never reaches the report", () => {
    const poisoned = {
      ...facts,
      serial: "TEST-SERIAL-0000",
      androidId: "9774d56d682e549c",
      deviceName: "Personal Phone Name",
      account: "someone@example.org",
      location: "9.93,-84.08",
      contacts: ["Contact Name"],
    } as PhoneFacts;
    const text = JSON.stringify(build({ facts: poisoned }));
    for (const secret of ["TEST-SERIAL-0000", "9774d56d682e549c", "Personal Phone Name", "someone@example.org", "9.93", "Contact Name"]) expect(text).not.toContain(secret);
  });

  test("redaction: personal text in a fact Android reports is dropped, and the report still passes", () => {
    const odd: PhoneFacts = {
      ...facts,
      manufacturer: "someone@example.org",
      model: "https://phone.example/x",
      socModel: undefined,
      cpuinfoHardware: "Board 356938035643809",
      buildHardware: "www.shop.example",
      androidRelease: "Baklava",
    };
    const report = build({ facts: odd });
    const text = JSON.stringify(report);
    for (const secret of ["someone", "example.org", "phone.example", "356938035643809", "shop.example"]) expect(text).not.toContain(secret);
    expect(report.device).toMatchObject({ manufacturer: "unknown", model: "unknown", chip: "unknown", chipSource: "unknown", android: "15" });
    expect(report.device.chipVendor).toBeUndefined();
    expect(check(report)).toEqual({ ok: true, errors: [] });
  });

  test("what the phone couldn't say is left out or unknown, and the report still passes", () => {
    const bare: PhoneFacts = { totalRamBytes: 3.2 * GB, apiLevel: 33, logicalCores: 4 };
    const report = build({ facts: bare, lab: { ...lab, plan: { ...plan, cpuMask: undefined } as RuntimePlan, thermal: { pauses: 0, pausedMs: 0 } } });
    expect(report.device).toEqual({
      manufacturer: "unknown", model: "unknown", chip: "unknown", chipSource: "unknown", ramGB: 3.2, android: "13", api: 33, abi: "unknown", cores: 4,
      cpuFeatures: { dotprod: false, i8mm: false, sve2: false, sme2: false },
    });
    expect(report.runtime).toMatchObject({ allowedCpus: "unknown", thermalStart: "unknown", thermalMax: "unknown", batterySaver: false });
    expect(report.runtime.cpuMask).toBeUndefined();
    expect(report.runtime.cpuset).toBeUndefined();
    expect(check(report)).toEqual({ ok: true, errors: [] });
  });

  test("the chip comes from Android's SoC model, else the cpuinfo Hardware line, else the build's hardware", () => {
    expect(build({ facts: { ...facts, socModel: undefined } }).device).toMatchObject({ chip: "exm", chipSource: "build" });
    expect(build({ facts: { ...facts, socModel: "unknown", cpuinfoHardware: "Qualcomm Technologies, Inc SM6225" } }).device).toMatchObject({ chip: "Qualcomm Technologies, Inc SM6225", chipSource: "cpuinfo" });
    expect(build({ facts: { ...facts, socModel: "unknown", cpuinfoHardware: "Qualcomm Technologies, Inc SM6225" } }).device.chipVendor).toBeUndefined();
  });

  test("numbers are rounded and clamped to what the schema allows", () => {
    const report = build({ lab: { ...lab, speed: { planned: { threads: 4, tokensPerSecond: 0.04, firstTokenMs: 12.7, loadMs: 3_999_999_999 }, sweep: [] } } });
    expect(report.speed).toEqual({ threads: 4, tokensPerSecond: 0, firstTokenMs: 13, loadMs: 3_600_000, sweep: [] });
    expect(build({ facts: { ...facts, totalRamBytes: 300 * GB } }).device.ramGB).toBe(64);
    expect(build({ app: "dev build" }).app).toBe("0.0.0");
  });

  test("an action outside the schema's list is recorded as other", () => {
    const report = build({ lab: { ...lab, cases: lab.cases.map((c, i) => (i === 0 ? { ...c, choice: "launch_rocket" } : c)) } });
    expect(report.eval.perCase?.[0]?.choice).toBe("other");
  });

  test("the median and the 90th percentile are the lab's: the middle case and the one at 90 percent, rounded up", () => {
    expect(median([5, 1, 3])).toBe(3);
    expect(median([4, 1, 3, 2])).toBe(3);
    expect(p90([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])).toBe(10);
    expect(p90(times)).toBe(47000);
    expect(median([])).toBe(0);
  });
});

describe("the schema and the lab agree", () => {
  test("the report's schema id", () => {
    expect(schema.properties.schema.const).toBe(REPORT_SCHEMA);
  });

  test("perCase ids are exactly the lab's cases", () => {
    expect(schema.properties.eval.properties.perCase.items.properties.id.enum).toEqual([...LAB_CASE_IDS]);
  });

  test("every first action the first-win menu offers can be recorded", () => {
    const allowed: string[] = schema.properties.eval.properties.perCase.items.properties.choice.enum;
    for (const s of firstWinSkills) expect(allowed).toContain(s.id);
    for (const extra of ["respond", "ask_user", "other"]) expect(allowed).toContain(extra);
  });
});
