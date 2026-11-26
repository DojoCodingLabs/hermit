/// <reference types="node" />
// HM-SET-10, the Device lab: the report in plain words, and the link that opens the GitHub form with it filled in.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createTranslator, type Dictionary } from "@hermit/copy";
import { clockText, issueLink, MAX_FORM_URL, REPORT_FORM_URL, reportGroups, reportText } from "./device-lab-view.ts";

const locale = (name: string) => JSON.parse(readFileSync(new URL(`../../../packages/copy/locales/${name}.json`, import.meta.url), "utf8")) as Dictionary;
const report = JSON.parse(readFileSync(new URL("../../../scripts/devices/fixtures/good-report.json", import.meta.url), "utf8"));
const en = createTranslator(locale("en"));
const es = createTranslator(locale("es-419"));

const flat = (groups: ReturnType<typeof reportGroups>) => groups.flatMap((g) => [g.title, ...g.rows.flatMap((r) => [r.label, r.value])]).join("\n");

test("the report in plain words: every part of it, in both languages, with no key or placeholder missing", () => {
  for (const [t, tag] of [[en, "en"], [es, "es-419"]] as const) {
    const groups = reportGroups(report, t, tag);
    assert.deepEqual(groups.map((g) => g.rows.length > 0), [true, true, true, true, true]);
    for (const g of groups) for (const r of g.rows) assert.ok(r.label.trim() && r.value.trim(), `${tag}: ${g.title}`);
    assert.ok(!/\{\w+\}/.test(flat(groups)), `${tag}: a placeholder was left unfilled`);
  }
  const text = flat(reportGroups(report, en, "en"));
  for (const shown of [
    "Examplecorp EX-1000", "Examplechip XC9000", "7.5 GB", "15 (API 35)", "8 cores, arm64-v8a", "4 at 2.0 GHz, 3 at 2.6 GHz, 1 at 3.1 GHz",
    "dotprod, i8mm", "4 threads, mid-range plan", "0-7 (top-app)", "cores mask f0", "thinking up to 256 tokens", "Context of 8,192 tokens, batches of 512, 4 threads reading",
    "cool at the start, a little warm at most", "18.4 tokens a second with 4 threads", "72.5 tokens a second", "4.8 s", "3.9 s",
    "With 2 threads", "writes 11.2 tokens a second", "first token in 8.6 s", "11 of 12", "31.0 s", "47.0 s",
    "es-remind-1", "Right, 30.5 s", "Wrong, 47.0 s: picked respond", "9 min 12 s", "Once, 45 s", "2026-11-25", "Hermit 0.1.0, botpsy-q4-native-think256",
  ]) assert.ok(text.includes(shown), `missing: ${shown}\n${text}`);
});

test("what the phone couldn't say reads as unknown, and no processor feature reads as none", () => {
  const bare = JSON.parse(JSON.stringify(report));
  bare.device.cpuFeatures = { dotprod: false, i8mm: false, sve2: false, sme2: false };
  bare.runtime.allowedCpus = "unknown";
  delete bare.runtime.cpuset;
  delete bare.device.coreMaxMHz;
  bare.run.thermalPauses = 0;
  bare.run.pausedMs = 0;
  const text = flat(reportGroups(bare, en, "en"));
  for (const shown of ["None of the ones the model uses", "Cores Hermit may use\nUnknown", "Pauses for heat\nNone"]) assert.ok(text.includes(shown), `missing: ${shown}`);
  assert.ok(!text.includes("Top clock of each core"));
});

test("File it on GitHub: the form's link carries the report, the title names the phone", () => {
  const link = issueLink(report);
  assert.equal(link.prefilled, true);
  const url = new URL(link.url);
  assert.equal(`${url.origin}${url.pathname}`, REPORT_FORM_URL);
  assert.equal(url.searchParams.get("template"), "device_report.yml");
  assert.equal(url.searchParams.get("title"), "Device report: Examplecorp EX-1000");
  assert.deepEqual(JSON.parse(url.searchParams.get("report")!), report);
  assert.ok(link.url.length <= MAX_FORM_URL);
});

test("a report too long for a link opens the empty form instead", () => {
  const long = JSON.parse(JSON.stringify(report));
  long.device.model = "M".repeat(40);
  long.speed.sweep = Array.from({ length: 200 }, (_, i) => ({ threads: i + 1, tokensPerSecond: 1, loadMs: 1 }));
  const link = issueLink(long);
  assert.equal(link.prefilled, false);
  assert.equal(new URL(link.url).searchParams.get("report"), null);
  assert.equal(new URL(link.url).searchParams.get("template"), "device_report.yml");
});

test("the exact text is the report's JSON, and nothing else", () => {
  assert.deepEqual(JSON.parse(reportText(report)), report);
  assert.equal(reportText(report), JSON.stringify(report, null, 2));
});

test("the time so far reads minutes and seconds", () => {
  assert.equal(clockText(0), "0:00");
  assert.equal(clockText(65_400), "1:05");
  assert.equal(clockText(600_000), "10:00");
});
