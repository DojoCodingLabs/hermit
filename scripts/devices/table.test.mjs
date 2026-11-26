// The device table (table.mjs): built from data/devices, written between the markers in docs/devices.md.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { readEntries, renderTable, updateDoc, END, START } from "./table.mjs";
import { writeReport } from "./validate.mjs";

// A version 1 report, and version 2 reports from an Android phone and an iPhone.
const GOOD = JSON.parse(readFileSync(new URL("./fixtures/good-report.json", import.meta.url), "utf8"));
const ANDROID = JSON.parse(readFileSync(new URL("./fixtures/good-report-android.json", import.meta.url), "utf8"));
const IPHONE = JSON.parse(readFileSync(new URL("./fixtures/good-report-iphone.json", import.meta.url), "utf8"));
const SCRIPT = fileURLToPath(new URL("./table.mjs", import.meta.url));
const ROOT = fileURLToPath(new URL("../../", import.meta.url));

const faster = () => {
  const r = JSON.parse(JSON.stringify(ANDROID));
  r.device.manufacturer = "Samplemaker";
  r.device.model = "SM-200";
  r.device.chip = "SC-77";
  delete r.device.chipVendor;
  r.speed.tokensPerSecond = 35.25;
  r.speed.firstTokenMs = 1250;
  r.runtime.batterySaver = true;
  r.run.thermalPauses = 0;
  r.run.pausedMs = 0;
  return r;
};

test("no reports: the table says so", () => {
  assert.equal(renderTable([]), "No reports yet. Run the Device lab and file yours: the steps are above.");
});

test("one row per report, fastest first, with the plan's numbers in plain units", () => {
  const table = renderTable([
    { file: "examplecorp-ex-1000-aaaaaaaa.json", issue: 3, report: GOOD },
    { file: "samplemaker-sm-200-bbbbbbbb.json", issue: 4, report: faster() },
  ]);
  const lines = table.split("\n");
  assert.equal(lines[0], "| Phone | Chip | RAM | System | Threads | Tokens/s | First token | Right | First action, median | First action, p90 | Notes | App | Date | Data |");
  assert.match(lines[1], /^\| :-+ \|/);
  assert.equal(lines[2], "| Samplemaker SM-200 | SC-77 | 7.5 GB | Android 15 (API 35) | 4 | 35.3 | 1.3 s | 11/12 | 31.0 s | 47.0 s | battery saver on | 0.1.0 | 2026-11-25 | [json](../data/devices/samplemaker-sm-200-bbbbbbbb.json) |");
  assert.equal(lines[3], "| Examplecorp EX-1000 | Examplechip XC9000 | 7.5 GB | Android 15 (API 35) | 4 | 18.4 | 4.8 s | 11/12 | 31.0 s | 47.0 s | paused once for heat | 0.1.0 | 2026-11-25 | [json](../data/devices/examplecorp-ex-1000-aaaaaaaa.json) |");
  assert.equal(lines.length, 4);
});

test("an iPhone shows its model identifier and iOS version, and a version 1 report reads as Android", () => {
  const slower = JSON.parse(JSON.stringify(IPHONE));
  slower.speed.tokensPerSecond = 9.5;
  const lines = renderTable([
    { file: "apple-iphone-99-example-cccccccc.json", issue: 5, report: slower },
    { file: "examplecorp-ex-1000-aaaaaaaa.json", issue: 3, report: GOOD },
  ]).split("\n");
  assert.equal(lines[2], "| Examplecorp EX-1000 | Examplechip XC9000 | 7.5 GB | Android 15 (API 35) | 4 | 18.4 | 4.8 s | 11/12 | 31.0 s | 47.0 s | paused once for heat | 0.1.0 | 2026-11-25 | [json](../data/devices/examplecorp-ex-1000-aaaaaaaa.json) |");
  assert.equal(lines[3], "| Apple iPhone 99 Example (iPhone99,1) | unknown | 7.5 GB | iOS 27.0 | 4 | 9.5 | 4.8 s | 11/12 | 31.0 s | 47.0 s | paused once for heat | 0.1.0 | 2026-11-25 | [json](../data/devices/apple-iphone-99-example-cccccccc.json) |");
});

test("a pipe can never break the table", () => {
  const r = JSON.parse(JSON.stringify(GOOD));
  r.device.model = "EX|1000";
  assert.match(renderTable([{ file: "x.json", issue: 1, report: r }]), /EX\\\|1000/);
});

test("the table goes between the markers and nothing else in the page changes", () => {
  const doc = `# Devices\n\nIntro.\n\n${START}\nold table\n${END}\n\nAfter.\n`;
  assert.equal(updateDoc(doc, "new table"), `# Devices\n\nIntro.\n\n${START}\nnew table\n${END}\n\nAfter.\n`);
  assert.throws(() => updateDoc("# Devices\n", "t"), /markers/);
});

test("data files are checked: a bad report or a stray field stops the table", () => {
  const dir = mkdtempSync(join(tmpdir(), "hermit-table-"));
  try {
    const { name } = writeReport(dir, 5, GOOD);
    assert.deepEqual(readEntries(dir).map((e) => [e.file, e.issue]), [[name, 5]]);
    writeFileSync(join(dir, "zz-bad.json"), JSON.stringify({ issue: 6, report: { ...GOOD, serial: "TEST-SERIAL-0000" } }));
    assert.throws(() => readEntries(dir), /zz-bad\.json: report: has a field that isn't in the schema \(serial\)/);
    writeFileSync(join(dir, "zz-bad.json"), JSON.stringify({ issue: 6, report: GOOD, note: "hi" }));
    assert.throws(() => readEntries(dir), /zz-bad\.json: should hold only issue and report/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a missing data folder is an empty table", () => {
  assert.deepEqual(readEntries(join(tmpdir(), "hermit-no-such-folder")), []);
});

test("the CLI writes the doc, and --check fails when the doc is out of date", () => {
  const dir = mkdtempSync(join(tmpdir(), "hermit-table-cli-"));
  try {
    const data = join(dir, "data");
    mkdirSync(data);
    const doc = join(dir, "devices.md");
    writeFileSync(doc, `# Devices\n\n${START}\n${END}\n`);
    writeReport(data, 9, GOOD);
    assert.throws(() => execFileSync(process.execPath, [SCRIPT, "--data", data, "--doc", doc, "--check"], { stdio: "pipe" }), (err) => err.status === 1);
    execFileSync(process.execPath, [SCRIPT, "--data", data, "--doc", doc]);
    assert.match(readFileSync(doc, "utf8"), /\| Examplecorp EX-1000 \|/);
    execFileSync(process.execPath, [SCRIPT, "--data", data, "--doc", doc, "--check"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("docs/devices.md holds the table the repository's data gives", () => {
  execFileSync(process.execPath, [SCRIPT, "--check"], { cwd: ROOT, stdio: "pipe" });
});
