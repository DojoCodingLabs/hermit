// Usage: pnpm --filter @hermit/eval eval [cases.jsonl] [--model fake]
// The QVAC desktop adapter arrives with spike S4 (docs/build/wave-0-spikes.md).
import { readFileSync } from "node:fs";
import { FakeModel } from "./fake-model.ts";
import { loadCases } from "./cases.ts";
import { runEval } from "./score.ts";
import { parseCliArgs } from "./cli-args.ts";

const PASS_BAR = 0.85; // Q5: at least 85% correct calls

const parsed = parseCliArgs(process.argv.slice(2));
const file = parsed.file ?? new URL("../cases/first-win.jsonl", import.meta.url).pathname;
const modelName = parsed.model;
if (modelName !== "fake") {
  console.error(`eval: model "${modelName}" isn't wired yet. Only "fake" exists until spike S4.`);
  process.exit(2);
}

const cases = loadCases(readFileSync(file, "utf8"));
const report = await runEval(cases, new FakeModel({}));
for (const r of report.results) console.log(`${r.pass ? "pass" : "FAIL"}  ${r.id}${r.reason ? `  (${r.reason})` : ""}`);
const ratio = report.total ? report.passed / report.total : 0;
console.log(`\n${report.passed}/${report.total} correct (${Math.round(ratio * 100)}%), bar is ${PASS_BAR * 100}%`);
process.exit(ratio >= PASS_BAR ? 0 : 1);
