// SL-50 spike: BotPsy on known web tasks over simulated accessibility-tree pages, on the Mac lab's
// llama-server with the phone's GGUF. Code sequences, validates and guards; the model picks one action a step.
// Usage: node --experimental-transform-types src/web-task-eval.ts [--mode free|forced|both] [--think N]
//          [--no-grammar] [--harness v0|v1|v2] [--set dev|noise|holdout] [--seeds 7,8,9] [--only id] [--url http://localhost:8090] [--out file.jsonl]
import { writeFileSync } from "node:fs";
import { llamaServerEngine, type Trace } from "./llama-engine.ts";
import { formatSummary, summarize } from "./web/report.ts";
import { runWebTask, type Harness, type Mode, type TaskResult } from "./web/runner.ts";
import { HOLDOUT_WEB_TASKS } from "./web/holdout-sites.ts";
import { NOISY_WEB_TASKS, WEB_TASKS } from "./web/sites.ts";

const args = process.argv.slice(2);
const flag = (n: string) => (args.indexOf(n) >= 0 ? args[args.indexOf(n) + 1] : undefined);
const modeArg = flag("--mode") ?? "both";
const modes: Mode[] = modeArg === "both" ? ["forced", "free"] : [modeArg as Mode];
const think = Number(flag("--think") ?? 0);
const thinking = think > 0 ? { enabled: true, budgetTokens: think } : { enabled: false };
const grammar = !args.includes("--no-grammar");
const harness = (flag("--harness") ?? "v2") as Harness;
const seeds = (flag("--seeds") ?? "7").split(",").map(Number);
const only = flag("--only");
// --set dev (default, tuned on), noise (dev on cluttered pages), holdout (never tuned on).
const set = flag("--set") ?? "dev";
const pool = set === "holdout" ? HOLDOUT_WEB_TASKS : set === "noise" ? NOISY_WEB_TASKS : WEB_TASKS;
const tasks = only ? pool.filter((t) => t.id.startsWith(only)) : pool;
const traces: Trace[] = [];
const engine = llamaServerEngine(flag("--url") ?? "http://localhost:8090", traces);
const label = `botpsy-q4 harness=${harness} think=${think || "off"} grammar=${grammar ? "on" : "off"} seeds=${seeds.join(",")} set=${set}`;

const rows: unknown[] = [];
const report: string[] = [];
for (const mode of modes) {
  const results: TaskResult[] = [];
  for (const seed of seeds) {
    process.env.HERMIT_SEED = String(seed);
    for (const task of tasks) {
      const before = traces.length;
      const r = await runWebTask(task, engine, { mode, thinking, grammar, harness });
      results.push(r);
      const used = traces.slice(before);
      rows.push({ ...r, seed, promptTokens: used.reduce((n, t) => n + (t.promptTokens ?? 0), 0), reasoning: used.map((t) => t.reasoning.slice(0, 600)) });
      const marks = r.steps.map((s) => (s.correct ? "+" : "x")).join("");
      console.log(`${mode.padEnd(6)} s${seed} ${r.success ? "PASS" : mode === "free" ? "fail" : "    "} ${task.id.padEnd(26)} ${marks.padEnd(16)} ${r.stop}${r.injectionFollowed ? " INJECTED" : ""}`);
      for (const s of r.steps.filter((x) => !x.correct)) console.log(`         ${s.page.padEnd(10)} ${s.error ?? s.raw.replace(/\s+/g, " ").slice(0, 140)}`);
    }
  }
  report.push(formatSummary(label, summarize(results, tasks), mode));
}
const read = traces.reduce((n, t) => n + (t.promptTokens ?? 0), 0);
console.log(`\n${report.join("\n")}\n  prompt tokens per call ${Math.round(read / Math.max(1, traces.length))} over ${traces.length} calls`);
const out = flag("--out");
if (out) writeFileSync(out, rows.map((r) => JSON.stringify(r)).join("\n") + "\n");
