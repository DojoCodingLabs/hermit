// SL-52 spike: BotPsy drafts connector specs from API doc excerpts on the Mac lab's llama-server (the phone's
// GGUF). Code assembles, validates and scores; findings in docs/research/connector-draft-spike.md.
// Usage: node --experimental-transform-types --no-warnings src/connector-draft-eval.ts [--mode owned|raw]
//          [--harness v0|v1] [--think N] [--set dev|holdout] [--seeds 7,8,9] [--only id] [--url http://localhost:8090] [--out file.jsonl]
import { writeFileSync } from "node:fs";
import { llamaServerEngine, type Trace } from "./llama-engine.ts";
import { draftConnector, type Harness, type Mode } from "./connector-draft/draft.ts";
import { DEV_FIXTURES } from "./connector-draft/fixtures.ts";
import { HOLDOUT_FIXTURES } from "./connector-draft/holdout.ts";
import { formatSummary, scoreDraft, summarize, type FixtureScore } from "./connector-draft/score.ts";

const args = process.argv.slice(2);
const flag = (n: string) => (args.indexOf(n) >= 0 ? args[args.indexOf(n) + 1] : undefined);
const mode = (flag("--mode") ?? "owned") as Mode;
const harness = (flag("--harness") ?? "v0") as Harness;
const think = Number(flag("--think") ?? 0);
const thinking = think > 0 ? { enabled: true, budgetTokens: think } : { enabled: false };
const seeds = (flag("--seeds") ?? "7").split(",").map(Number);
const set = flag("--set") ?? "dev";
const pool = set === "holdout" ? HOLDOUT_FIXTURES : DEV_FIXTURES;
const only = flag("--only");
const fixtures = only ? pool.filter((f) => f.id.startsWith(only)) : pool;
const traces: Trace[] = [];
const engine = llamaServerEngine(flag("--url") ?? "http://localhost:8090", traces);

const rows: unknown[] = [];
const scores: FixtureScore[] = [];
const started = Date.now();
for (const seed of seeds) {
  process.env.HERMIT_SEED = String(seed);
  for (const f of fixtures) {
    const before = traces.length;
    const d = await draftConnector(engine, f.doc, { mode, thinking, harness });
    const s = scoreDraft(f, d.header, d.ops, d.assembled, mode);
    scores.push(s);
    const used = traces.slice(before);
    rows.push({ seed, ...s, opScores: s.ops, failures: d.failures, header: d.header, ops: d.ops, spec: d.assembled.spec, ms: used.reduce((n, t) => n + t.ms, 0), promptTokens: used.reduce((n, t) => n + (t.promptTokens ?? 0), 0), reasoning: used.map((t) => t.reasoning.slice(0, 800)) });
    const marks = s.ops.map((o) => (!o.matched ? "." : o.method && o.path && o.paramsExact && o.riskCorrect ? "+" : o.underRisk ? "!" : "x")).join("");
    const verdict = s.shouldRefuse ? (s.outcomeCorrect ? "REFUSED-OK" : "NOT-REFUSED") : s.fullyCorrect ? "CORRECT" : s.valid ? "valid" : "INVALID";
    console.log(`s${seed} ${verdict.padEnd(11)} ${f.id.padEnd(24)} ops ${marks.padEnd(5)} extra ${s.extraOps}${d.failures.length ? ` parse-fail ${d.failures.length}` : ""}${s.refused ? ` refused: ${s.refused}` : ""}`);
    for (const e of s.validationErrors.slice(0, 4)) console.log(`      error: ${e}`);
    for (const o of s.ops.filter((x) => x.matched && !(x.method && x.path && x.paramsExact && x.riskCorrect))) {
      console.log(`      ${o.gold} -> ${o.got} params ${JSON.stringify(o.paramNames)} risk ${o.risk ?? "?"} (gold ${o.goldRisk})${o.underRisk ? " UNDER" : ""}`);
    }
  }
}
const calls = traces.length;
const read = traces.reduce((n, t) => n + (t.promptTokens ?? 0), 0);
const ms = traces.map((t) => t.ms).sort((a, b) => a - b);
const label = `botpsy-q4 mode=${mode} harness=${harness} think=${think || "off"} set=${set} seeds=${seeds.join(",")}`;
console.log(`\n${formatSummary(label, summarize(scores))}\n  calls ${calls}, prompt tokens per call ${Math.round(read / Math.max(1, calls))}, median call ${ms[Math.floor(ms.length / 2)]} ms, total ${Math.round((Date.now() - started) / 1000)} s`);
const out = flag("--out");
if (out) writeFileSync(out, rows.map((r) => JSON.stringify(r)).join("\n") + "\n");
