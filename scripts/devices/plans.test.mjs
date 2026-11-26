// Plans against the sweep (plans.mjs): each report's planned thread count next to the other counts it timed.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { BEAT_PLAN_PERCENT, planRows, renderPlans } from "./plans.mjs";
import { writeReport } from "./validate.mjs";

const GOOD = JSON.parse(readFileSync(new URL("./fixtures/good-report.json", import.meta.url), "utf8"));
const SCRIPT = fileURLToPath(new URL("./plans.mjs", import.meta.url));

/** The fixture with a planned speed and a sweep of [threads, tokens per second] pairs. */
const report = (planned, sweep, change = () => {}) => {
  const r = JSON.parse(JSON.stringify(GOOD));
  r.speed.threads = planned[0];
  r.runtime.threads = planned[0];
  r.speed.tokensPerSecond = planned[1];
  r.speed.sweep = sweep.map(([threads, tokensPerSecond]) => ({ threads, tokensPerSecond, loadMs: 2000 }));
  change(r);
  return r;
};
const entry = (r, file = "x.json") => ({ file, issue: 1, report: r });

test("the margin is one named number: more than 10 percent", () => {
  assert.equal(BEAT_PLAN_PERCENT, 10);
});

test("no reports: it says so", () => {
  assert.deepEqual(planRows([]), []);
  assert.equal(renderPlans([]), "No reports yet.");
});

test("the plan is fastest: no mark, and the plan's own count is the fastest", () => {
  const [row] = planRows([entry(report([4, 18.4], [[2, 11.2]]))]);
  assert.deepEqual(row, {
    phone: "Examplecorp EX-1000",
    chip: "Examplechip XC9000",
    tier: "mid",
    allowedCpus: "0-7",
    plannedThreads: 4,
    plannedTokensPerSecond: 18.4,
    sweep: [{ threads: 2, tokensPerSecond: 11.2 }],
    fastestThreads: 4,
    fasterPercent: 0,
    planBeaten: false,
  });
});

test("a sweep count beats the plan by more than the margin: the row is marked", () => {
  const r = report([6, 10], [[2, 9.5], [4, 12.5]], (x) => {
    x.device.manufacturer = "Samplemaker";
    x.device.model = "SM-200";
    x.device.chip = "SC-77";
    delete x.device.chipVendor;
    x.runtime.tier = "low";
    x.runtime.allowedCpus = "0-5";
  });
  const [row] = planRows([entry(r)]);
  assert.equal(row.fastestThreads, 4);
  assert.equal(row.fasterPercent, 25);
  assert.equal(row.planBeaten, true);
  const lines = renderPlans([entry(r)]).split("\n");
  assert.equal(lines[0], "| Phone | Chip | Tier | Allowed cores | Planned threads | Planned tokens/s | Sweep (threads: tokens/s) | Fastest threads | Faster than plan | Plan beaten |");
  assert.match(lines[1], /^\| :-+ \|/);
  assert.equal(lines[2], "| Samplemaker SM-200 | SC-77 | low | 0-5 | 6 | 10.0 | 2: 9.5, 4: 12.5 | 4 | 25.0% | yes |");
  assert.equal(lines.length, 3);
});

test("a count faster by no more than the margin is the fastest, but the row isn't marked: two calls are noise", () => {
  const [row] = planRows([entry(report([4, 20], [[2, 22]]))]);
  assert.equal(row.fastestThreads, 2);
  assert.equal(row.fasterPercent, 10);
  assert.equal(row.planBeaten, false);
  assert.match(renderPlans([entry(report([4, 20], [[2, 22]]))]), /\| 2 \| 10\.0% \| {2}\|$/);
});

test("a sweep count that wrote nothing (0 tokens per second) never wins", () => {
  const [row] = planRows([entry(report([4, 15], [[2, 0]]))]);
  assert.deepEqual(row.sweep, [{ threads: 2, tokensPerSecond: 0 }]);
  assert.equal(row.fastestThreads, 4);
  assert.equal(row.fasterPercent, 0);
  assert.equal(row.planBeaten, false);
  assert.match(renderPlans([entry(report([4, 15], [[2, 0]]))]), /\| 2: 0\.0 \| 4 \| 0\.0% \| {2}\|$/);
});

test("a plan that wrote nothing is beaten by any count that did, with no percent to give", () => {
  const [row] = planRows([entry(report([4, 0], [[2, 3]]))]);
  assert.equal(row.fastestThreads, 2);
  assert.equal(row.fasterPercent, null);
  assert.equal(row.planBeaten, true);
  assert.match(renderPlans([entry(report([4, 0], [[2, 3]]))]), /\| 2 \| n\/a \| yes \|$/);
});

test("a report with an empty sweep: the plan is the only count", () => {
  const [row] = planRows([entry(report([4, 18.4], []))]);
  assert.deepEqual(row.sweep, []);
  assert.equal(row.fastestThreads, 4);
  assert.equal(row.fasterPercent, 0);
  assert.equal(row.planBeaten, false);
  assert.match(renderPlans([entry(report([4, 18.4], []))]), /\| 4 \| 18\.4 \| none \| 4 \| 0\.0% \| {2}\|$/);
});

test("a pipe can never break the table", () => {
  const r = report([4, 18.4], [], (x) => {
    x.device.model = "EX|1000";
  });
  assert.match(renderPlans([entry(r)]), /EX\\\|1000/);
});

test("the CLI reads checked data files and only prints", () => {
  const dir = mkdtempSync(join(tmpdir(), "hermit-plans-"));
  try {
    const empty = join(dir, "empty");
    assert.equal(execFileSync(process.execPath, [SCRIPT, "--data", empty], { encoding: "utf8" }), "No reports yet.\n");
    const data = join(dir, "data");
    writeReport(data, 7, report([4, 10], [[2, 12]]));
    const out = execFileSync(process.execPath, [SCRIPT, "--data", data], { encoding: "utf8" });
    assert.match(out, /^\| Phone \|/);
    assert.match(out, /\| Examplecorp EX-1000 \| Examplechip XC9000 \| mid \| 0-7 \| 4 \| 10\.0 \| 2: 12\.0 \| 2 \| 20\.0% \| yes \|\n$/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
