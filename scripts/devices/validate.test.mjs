// The device report validator (validate.mjs): good reports pass, and everything the schema or the privacy rules
// forbid fails with a message that names the field and never repeats what was written there.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { MAX_DEPTH, canonicalJson, extractReport, issueComment, loadSchema, reportFileName, schemaErrors, validateReport, writeReport } from "./validate.mjs";

// A version 1 report, as filed before reports named their platform, and version 2 reports from each platform.
const GOOD = JSON.parse(readFileSync(new URL("./fixtures/good-report.json", import.meta.url), "utf8"));
const ANDROID = JSON.parse(readFileSync(new URL("./fixtures/good-report-android.json", import.meta.url), "utf8"));
const IPHONE = JSON.parse(readFileSync(new URL("./fixtures/good-report-iphone.json", import.meta.url), "utf8"));
const SCHEMA = loadSchema();
const TODAY = new Date("2026-11-26T12:00:00Z");
const SCRIPT = fileURLToPath(new URL("./validate.mjs", import.meta.url));

const clone = () => JSON.parse(JSON.stringify(GOOD));
const check = (report) => validateReport(report, SCHEMA, { today: TODAY });
/** A copy of the good report with one change, checked. */
const mutated = (change) => {
  const r = clone();
  change(r);
  return check(r);
};

const body = (json, { box = "X", notes = "_No response_" } = {}) =>
  ["### Report", "", "```json", json, "```", "", "### Notes", "", notes, "", "### Privacy", "", `- [${box}] This report contains no personal data`, ""].join("\n");

test("the good fixture passes the schema and the privacy rules", () => {
  assert.deepEqual(check(clone()), { ok: true, errors: [] });
});

test("version 2 reports from an Android phone and from an iPhone pass", () => {
  assert.deepEqual(check(ANDROID), { ok: true, errors: [] });
  assert.deepEqual(check(IPHONE), { ok: true, errors: [] });
});

/** A copy of `report` with one change, checked. */
const changed = (report, change) => {
  const r = JSON.parse(JSON.stringify(report));
  change(r);
  return check(r);
};

/** Each change fails with a message matching its pattern. */
const failsWith = (cases) => {
  for (const [report, change, message] of cases) {
    const v = changed(report, change);
    assert.equal(v.ok, false, String(message));
    assert.ok(v.errors.some((e) => message.test(e)), `${message}: ${v.errors.join("; ")}`);
  }
};

test("version 2: the device says its platform, and each platform has only its own fields", () => {
  failsWith([
    [ANDROID, (r) => { delete r.device.platform; }, /^report\.device: misses platform$/],
    [ANDROID, (r) => { r.device.platform = "web"; }, /^report\.device\.platform: isn't one of the allowed values$/],
    [ANDROID, (r) => { r.device.modelId = "iPhone99,1"; }, /^report\.device: has a field that isn't in the schema \(modelId\)$/],
    [IPHONE, (r) => { r.device.api = 35; }, /^report\.device: has a field that isn't in the schema \(api\)$/],
    [IPHONE, (r) => { r.device.abi = "arm64-v8a"; }, /^report\.device: has a field that isn't in the schema \(abi\)$/],
    [IPHONE, (r) => { r.device.android = "15"; }, /^report\.device: has a field that isn't in the schema \(android\)$/],
    [IPHONE, (r) => { delete r.device.ios; }, /^report\.device: misses ios$/],
    [IPHONE, (r) => { r.device.modelId = "Lab phone 1"; }, /^report\.device\.modelId: doesn't have the allowed form$/],
    [IPHONE, (r) => { r.device.ios = "twenty"; }, /^report\.device\.ios: doesn't have the allowed form$/],
    // Version 1 is the Android shape, with no platform.
    [GOOD, (r) => { r.device.platform = "android"; }, /^report\.device\.platform: isn't in a version 1 report$/],
    [GOOD, (r) => { r.device = JSON.parse(JSON.stringify(IPHONE.device)); }, /^report\.device\.platform: isn't in a version 1 report$/],
  ]);
});

test("an iPhone's model identifier may be unknown, as on a simulator", () => {
  assert.deepEqual(changed(IPHONE, (r) => { r.device.modelId = "unknown"; }), { ok: true, errors: [] });
});

test("the platform's own thermal state is for iPhone reports only, and agrees with the mapped one", () => {
  failsWith([
    [ANDROID, (r) => { r.runtime.osThermalMax = "serious"; }, /^report\.runtime\.osThermalMax: is for an iPhone report only$/],
    [GOOD, (r) => { r.runtime.osThermalStart = "nominal"; }, /^report\.runtime\.osThermalStart: is for an iPhone report only$/],
    [IPHONE, (r) => { r.runtime.osThermalMax = "fair"; }, /^report\.runtime\.osThermalMax: doesn't match thermalMax$/],
    [IPHONE, (r) => { r.runtime.osThermalStart = "toasty"; }, /^report\.runtime\.osThermalStart: isn't one of the allowed values$/],
  ]);
  // A state iOS never reports reads as unknown, whatever the mapped one was; and both may be left out.
  assert.deepEqual(changed(IPHONE, (r) => { r.runtime.thermalMax = "moderate"; r.runtime.osThermalMax = "unknown"; }), { ok: true, errors: [] });
  assert.deepEqual(changed(IPHONE, (r) => { delete r.runtime.osThermalStart; delete r.runtime.osThermalMax; }), { ok: true, errors: [] });
});

test("oneOf: a value that fits no shape gets the errors of the shape it says it is, else the field that tells them apart", () => {
  const schema = {
    oneOf: [
      { type: "object", additionalProperties: false, required: ["kind", "a"], properties: { kind: { const: "x" }, a: { type: "integer" } } },
      { type: "object", additionalProperties: false, required: ["kind", "b"], properties: { kind: { const: "y" }, b: { type: "string" } } },
    ],
  };
  assert.deepEqual(schemaErrors(schema, { kind: "x", a: 1 }), []);
  assert.deepEqual(schemaErrors(schema, { kind: "y", b: 2 }), ["report.b: should be text"]);
  assert.deepEqual(schemaErrors(schema, { kind: "z" }), ["report.kind: isn't one of the allowed values"]);
  assert.deepEqual(schemaErrors(schema, {}), ["report: misses kind"]);
  assert.deepEqual(schemaErrors(schema, 3), ["report: should be an object"]);
  assert.deepEqual(schemaErrors({ oneOf: [{ type: "integer" }, { type: "number" }] }, 2), ["report: matches more than one allowed shape"]);
  assert.deepEqual(schemaErrors({ oneOf: [{ type: "integer" }, { type: "boolean" }] }, "x"), ["report: isn't one of the allowed shapes"]);
});

test("perCase and the optional fields may be left out", () => {
  const r = clone();
  delete r.eval.perCase;
  delete r.device.coreMaxMHz;
  delete r.device.chipVendor;
  delete r.device.lowRam;
  delete r.runtime.cpuMask;
  delete r.runtime.cpuset;
  delete r.speed.prefillTokensPerSecond;
  r.speed.sweep = [];
  assert.deepEqual(check(r), { ok: true, errors: [] });
});

test("a field the schema doesn't list fails, at the top and inside an object", () => {
  for (const [where, change] of [
    ["report", (r) => { r.serial = "TEST-SERIAL-0000"; }],
    ["report.device", (r) => { r.device.deviceName = "Lab phone"; }],
    ["report.speed.sweep[0]", (r) => { r.speed.sweep[0].note = "fast"; }],
    ["report.eval.perCase[0]", (r) => { r.eval.perCase[0].input = "remind me to call"; }],
  ]) {
    const v = mutated(change);
    assert.equal(v.ok, false, where);
    assert.ok(v.errors.some((e) => e.startsWith(`${where}: has a field that isn't in the schema`)), `${where}: ${v.errors.join("; ")}`);
  }
});

test("missing, mistyped and out-of-range fields fail", () => {
  const cases = [
    [(r) => { delete r.eval; }, /report: misses eval/],
    [(r) => { r.device.cores = "8"; }, /report\.device\.cores: should be an integer/],
    [(r) => { r.device.api = 35.5; }, /report\.device\.api: should be an integer/],
    [(r) => { r.speed.tokensPerSecond = 99999; }, /report\.speed\.tokensPerSecond: is above 5000/],
    [(r) => { r.speed.firstTokenMs = -1; }, /report\.speed\.firstTokenMs: is below 0/],
    [(r) => { r.device.ramGB = 512; }, /report\.device\.ramGB: is above 64/],
    [(r) => { r.schema = "hermit-device-report/3"; }, /^report\.schema: isn't one of the allowed values$/],
    [(r) => { r.runtime.thermalStart = "toasty"; }, /report\.runtime\.thermalStart: isn't one of the allowed values/],
    [(r) => { r.run.date = "2026-13-01"; }, /report\.run\.date: doesn't have the allowed form/],
    [(r) => { r.device.model = "X".repeat(60); }, /report\.device\.model: is longer than 48 characters/],
    [(r) => { r.eval.perCase[0].id = "es-secret-1"; }, /report\.eval\.perCase\[0\]\.id: isn't one of the allowed values/],
    [(r) => { r.speed.sweep = new Array(9).fill(r.speed.sweep[0]); }, /report\.speed\.sweep: has more than 8 items/],
  ];
  for (const [change, message] of cases) {
    const v = mutated(change);
    assert.equal(v.ok, false, String(message));
    assert.ok(v.errors.some((e) => message.test(e)), `${message}: ${v.errors.join("; ")}`);
  }
});

test("anything that isn't an object fails cleanly", () => {
  for (const value of [null, [], "report", 7]) assert.deepEqual(check(value).errors, ["report: should be an object"]);
});

test("emails, web addresses, long numbers and hex ids are refused in every string", () => {
  for (const [value, message] of [
    ["lab@example.org", /looks like an email address/],
    ["https://phone.example", /looks like a web address/],
    ["www.phone-shop.example", /looks like a web address/],
    ["phone-shop.com", /looks like a web address/],
    ["5550100123", /has a long run of digits/],
    ["9774d56d682e549c", /looks like an identifier/],
  ]) {
    const v = mutated((r) => { r.device.model = value; });
    assert.equal(v.ok, false, value);
    assert.ok(v.errors.some((e) => e.startsWith("report.device.model:") && message.test(e)), `${value}: ${v.errors.join("; ")}`);
    // The message names the field, never the text that was there.
    assert.ok(v.errors.every((e) => !e.includes(value)), value);
  }
});

test("a report nested thousands of levels deep fails with a message, not a stack overflow", () => {
  let deep = "x";
  for (let i = 0; i < 20_000; i++) deep = [deep];
  const v = mutated((r) => { r.device.model = deep; });
  assert.equal(v.ok, false);
  assert.ok(v.errors.some((e) => e.endsWith("is nested too deeply")), v.errors.join("; "));
  assert.ok(MAX_DEPTH >= 4, "the schema itself nests four levels");
});

test("model codes with digits, slashes and plus signs are fine", () => {
  for (const model of ["2311DRK48G", "MT6765V/WB", "Note 13 Pro+", "moto g play - 2024", "Qualcomm Technologies, Inc SM6225"]) {
    assert.deepEqual(mutated((r) => { r.device.model = model; }), { ok: true, errors: [] }, model);
  }
});

test("the numbers must agree with each other", () => {
  for (const [change, message] of [
    [(r) => { r.eval.score = 13; }, /report\.eval\.score: is more than n/],
    [(r) => { r.eval.perCase.pop(); }, /report\.eval\.perCase: has 11 cases but n is 12/],
    [(r) => { r.eval.perCase[0].pass = false; }, /report\.eval\.perCase: 10 passed but score is 11/],
    [(r) => { r.eval.perCase[1].id = r.eval.perCase[0].id; }, /report\.eval\.perCase: repeats a case/],
    [(r) => { r.eval.firstActionMedianMs = 60000; }, /report\.eval\.firstActionMedianMs: is more than p90Ms/],
    [(r) => { r.eval.p90Ms = 90000; }, /report\.eval\.p90Ms: is outside the cases' times/],
    [(r) => { r.speed.sweep[0].threads = 4; }, /report\.speed\.sweep: repeats a thread count/],
    [(r) => { r.run.pausedMs = 600000; }, /report\.run\.pausedMs: is more than durationMs/],
    [(r) => { r.run.thermalPauses = 0; }, /report\.run\.pausedMs: is above 0 with no pauses/],
    [(r) => { r.run.date = "2099-01-01"; }, /report\.run\.date: is in the future/],
    [(r) => { r.run.date = "2025-12-31"; }, /report\.run\.date: is before the Device lab existed/],
  ]) {
    const v = mutated(change);
    assert.equal(v.ok, false, String(message));
    assert.ok(v.errors.some((e) => message.test(e)), `${message}: ${v.errors.join("; ")}`);
  }
});

test("the validator refuses a schema keyword it doesn't implement instead of skipping it", () => {
  assert.throws(() => schemaErrors({ type: "string", format: "email" }, "x"), /format is not supported/);
});

test("a field name someone made up is shown without markup", () => {
  const r = clone();
  r["@everyone <img src=x>"] = 1;
  const v = check(r);
  assert.ok(v.errors.some((e) => e === "report: has a field that isn't in the schema (everyoneimgsrcx)"), v.errors.join("; "));
});

test("the issue form's body gives back the report and checks the privacy box", () => {
  const json = JSON.stringify(GOOD, null, 2);
  assert.deepEqual(extractReport(body(json)), { report: GOOD, errors: [] });
  // Pasted with its own code fence inside the form's: the fences go, the JSON stays.
  assert.deepEqual(extractReport(body("```json\n" + json + "\n```")).report, GOOD);
  // Windows line ends.
  assert.deepEqual(extractReport(body(json).replace(/\n/g, "\r\n")).report, GOOD);
});

test("the issue body fails without the box ticked, without a report, or with broken JSON", () => {
  assert.deepEqual(extractReport(body(JSON.stringify(GOOD), { box: " " })).errors, ["The box saying the report contains no personal data isn't ticked."]);
  assert.deepEqual(extractReport("### Notes\n\nhello").errors, ["The issue has no Report field. File it with the Device report form."]);
  assert.deepEqual(extractReport(body("_No response_")).errors, ["The Report field is empty."]);
  assert.match(extractReport(body("{ not json")).errors[0], /^The Report field isn't valid JSON/);
  assert.deepEqual(extractReport("x".repeat(70000)).errors, ["The issue is too long to be a device report."]);
});

test("a second Report heading in the notes can't replace the first one", () => {
  const other = { ...GOOD, app: "9.9.9" };
  const text = body(JSON.stringify(GOOD), { notes: "### Report\n\n```json\n" + JSON.stringify(other) + "\n```" });
  assert.equal(extractReport(text).report.app, "0.1.0");
});

test("the file name is the phone's slug and a hash of the report's content, whatever the key order", () => {
  const name = reportFileName(GOOD);
  assert.match(name, /^examplecorp-ex-1000-[0-9a-f]{8}\.json$/);
  const reordered = JSON.parse(JSON.stringify({ run: GOOD.run, eval: GOOD.eval, speed: GOOD.speed, runtime: GOOD.runtime, device: GOOD.device, model: GOOD.model, app: GOOD.app, schema: GOOD.schema }));
  assert.equal(reportFileName(reordered), name);
  assert.notEqual(reportFileName({ ...GOOD, app: "0.1.1" }), name);
  assert.equal(canonicalJson({ b: 1, a: [{ d: 1, c: 2 }] }), '{"a":[{"c":2,"d":1}],"b":1}');
});

test("an edited issue replaces the report it filed before; another issue's report stays", () => {
  const dir = mkdtempSync(join(tmpdir(), "hermit-devices-"));
  try {
    const first = writeReport(dir, 7, GOOD);
    const other = writeReport(dir, 8, { ...GOOD, app: "0.2.0" });
    const edited = writeReport(dir, 7, { ...GOOD, app: "0.1.1" });
    assert.deepEqual(readdirSync(dir).sort(), [other.name, edited.name].sort());
    assert.notEqual(first.name, edited.name);
    const saved = JSON.parse(readFileSync(join(dir, edited.name), "utf8"));
    assert.deepEqual(Object.keys(saved), ["issue", "report"]);
    assert.equal(saved.issue, 7);
    assert.equal(saved.report.app, "0.1.1");
    // The same report again from another issue is a duplicate: the first one stays as it was.
    const again = writeReport(dir, 9, { ...GOOD, app: "0.2.0" });
    assert.equal(again.duplicateOf, 8);
    assert.equal(JSON.parse(readFileSync(join(dir, other.name), "utf8")).issue, 8);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the failure comment lists the problems and says how to fix them, with no mentions or links", () => {
  const text = issueComment(["report.device.model: looks like an email address", "report: misses eval"]);
  assert.match(text, /- report\.device\.model: looks like an email address/);
  assert.match(text, /- report: misses eval/);
  assert.match(text, /edit this issue/i);
  assert.ok(!/@|https?:/.test(text));
});

/** Runs the CLI on an issue event file, as the workflow does. */
function runEvent(event, extra = []) {
  const dir = mkdtempSync(join(tmpdir(), "hermit-event-"));
  const eventPath = join(dir, "event.json");
  writeFileSync(eventPath, JSON.stringify(event));
  const output = join(dir, "output");
  const comment = join(dir, "comment.md");
  writeFileSync(output, "");
  let code = 0;
  let stdout;
  try {
    stdout = execFileSync(process.execPath, [SCRIPT, "--event", eventPath, "--github-output", output, "--comment", comment, ...extra.map((a) => a.replace("$DIR", dir))], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  } catch (err) {
    code = err.status;
    stdout = err.stdout;
  }
  const read = (p) => { try { return readFileSync(p, "utf8"); } catch { return undefined; } };
  return { code, stdout, output: read(output), comment: read(comment), dir };
}

test("the CLI reads the issue from the event file: a good report sets valid=true and writes the data file", () => {
  const r = runEvent({ issue: { number: 42, body: body(JSON.stringify(GOOD, null, 2)) } }, ["--write", "$DIR/data"]);
  try {
    assert.equal(r.code, 0);
    assert.match(r.output, /^valid=true$/m);
    const name = reportFileName(GOOD);
    assert.match(r.output, new RegExp(`^file=${name}$`, "m"));
    assert.equal(r.stdout.trim(), name);
    assert.deepEqual(JSON.parse(readFileSync(join(r.dir, "data", name), "utf8")), { issue: 42, report: JSON.parse(canonicalJson(GOOD)) });
  } finally {
    rmSync(r.dir, { recursive: true, force: true });
  }
});

test("the CLI, as the device-report workflow runs it, takes an iPhone's report and names its file after the iPhone", () => {
  const r = runEvent({ issue: { number: 46, body: body(JSON.stringify(IPHONE, null, 2)) } }, ["--write", "$DIR/data"]);
  try {
    assert.equal(r.code, 0);
    assert.match(r.output, /^valid=true$/m);
    assert.match(r.output, /^file=apple-iphone-99-example-[0-9a-f]{8}\.json$/m);
  } finally {
    rmSync(r.dir, { recursive: true, force: true });
  }
});

test("the CLI on a bad report sets valid=false and writes the comment; with --write it fails", () => {
  const bad = { ...GOOD, serial: "TEST-SERIAL-0000" };
  const r = runEvent({ issue: { number: 43, body: body(JSON.stringify(bad)) } });
  const w = runEvent({ issue: { number: 43, body: body(JSON.stringify(bad)) } }, ["--write", "$DIR/data"]);
  try {
    assert.equal(r.code, 0);
    assert.match(r.output, /^valid=false$/m);
    assert.match(r.comment, /has a field that isn't in the schema \(serial\)/);
    assert.ok(!r.comment.includes("TEST-SERIAL-0000"));
    assert.equal(w.code, 1);
    assert.throws(() => readdirSync(join(w.dir, "data")));
  } finally {
    rmSync(r.dir, { recursive: true, force: true });
    rmSync(w.dir, { recursive: true, force: true });
  }
});

test("the CLI validates a report file given by path", () => {
  const dir = mkdtempSync(join(tmpdir(), "hermit-file-"));
  try {
    const good = join(dir, "good.json");
    const bad = join(dir, "bad.json");
    writeFileSync(good, JSON.stringify(GOOD));
    writeFileSync(bad, JSON.stringify({ ...GOOD, app: "lab@example.org" }));
    assert.match(execFileSync(process.execPath, [SCRIPT, good], { encoding: "utf8" }), /valid/);
    assert.throws(() => execFileSync(process.execPath, [SCRIPT, bad], { encoding: "utf8", stdio: "pipe" }), (err) => err.status === 1 && /report\.app/.test(err.stderr));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

for (const flag of ["--help", "-h"]) {
  test(`the CLI prints the usage for ${flag} and exits 0`, () => {
    const out = execFileSync(process.execPath, [SCRIPT, flag], { encoding: "utf8" });
    assert.match(out, /node scripts\/devices\/validate\.mjs report\.json/);
    assert.match(out, /--event "\$GITHUB_EVENT_PATH" \[--github-output FILE\] \[--comment FILE\] \[--write DIR\]/);
  });
}

for (const args of [["--chek"], ["--event"], ["a.json", "b.json"], [], ["--event", "e.json", "extra.json"]]) {
  test(`the CLI refuses ${args.join(" ") || "no arguments"}: usage and exit 1`, () => {
    assert.throws(
      () => execFileSync(process.execPath, [SCRIPT, ...args], { stdio: "pipe", encoding: "utf8" }),
      (err) => err.status === 1 && /usage:/.test(err.stderr) && !/ENOENT/.test(err.stderr),
    );
  });
}

test("an issue that wasn't filed with the report form (the device-lab label marks other issues too) is skipped without a comment", () => {
  const r = runEvent({ issue: { number: 44, body: "The chat freezes on my phone.\n\n### Steps\n\n1. Open it." } });
  try {
    assert.equal(r.code, 0);
    assert.match(r.output, /^valid=false$/m);
    assert.match(r.output, /^form=false$/m);
    assert.equal(r.comment, undefined);
  } finally {
    rmSync(r.dir, { recursive: true, force: true });
  }
  const filed = runEvent({ issue: { number: 45, body: body(JSON.stringify(GOOD)) } });
  try {
    assert.match(filed.output, /^form=true$/m);
  } finally {
    rmSync(filed.dir, { recursive: true, force: true });
  }
});
