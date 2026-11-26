// Desktop harness eval: same cases, same GGUF, same harness code as the phone, on llama-server.
// Usage: node --experimental-strip-types src/mac-eval.ts <profile-id> [--url http://localhost:8090] [--out file.jsonl]
import { writeFileSync } from "node:fs";
import { describeNowForModel } from "@hermit/core";
import { createModelPort, profileById } from "@hermit/model";
import { firstWinSkills } from "@hermit/skills";
import { FIRST_WIN_CASES } from "./first-win-cases.ts";
import { familyOf, VA_CASES } from "./va-cases.ts";
import { HOLDOUT_CASES } from "./holdout-cases.ts";
import { HOLDOUT2_CASES } from "./holdout2-cases.ts";
import { MESSAGING_CASES } from "./messaging-cases.ts";
import { MEMDEC_CASES } from "./memdec-cases.ts";
import { runEval } from "./score.ts";
import { llamaServerEngine, type Trace } from "./llama-engine.ts";

const args = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const found = profileById(args[0] ?? "botpsy-q4-two-stage-nothink");
if (!found) {
  console.error(`unknown profile ${args[0]}`);
  process.exit(2);
}
const profile = { ...found };
// Harness overrides for ablations: --format two_stage|native_tools, --think N (0 = off).
const format = flag("--format");
const think = flag("--think");
if (format) profile.format = format as typeof profile.format;
if (args.includes("--fast-route")) profile.fastRoute = true;
const promptStyle = flag("--prompt");
if (promptStyle) profile.prompt = promptStyle as "menu" | "slim";
if (think !== undefined) profile.thinking = Number(think) > 0 ? { mode: "on", budgetTokens: Number(think) } : { mode: "off" };
const url = flag("--url") ?? "http://localhost:8090";
const out = flag("--out");

// A fixed clock so every run sees the same "now" (Wednesday 2026-11-11 21:00, Costa Rica).
const NOW = Date.parse("2026-11-11T21:00:00-06:00");
const traces: Trace[] = [];
const engine = llamaServerEngine(url, traces);
// The same clock for the router's day words (W1 review: they were read on the real clock in UTC, so a run's routes
// depended on when it ran).
const port = createModelPort(engine, profile, firstWinSkills, () => ({ language: "en", now: describeNowForModel(NOW, "America/Costa_Rica"), profile: [], clock: { now: NOW, timeZone: "America/Costa_Rica" } }));

const rows: unknown[] = [];
const results: Array<Awaited<ReturnType<typeof runEval>>["results"][number]> = [];
// --set va: the 124-case Virtual Assistant set by family; default: the first-win 40.
// --set holdout: 90 cases written blind to the harness code; their failures have since been read, so they count as
// development data. --set holdout2: the original blind set, published, so it no longer counts as blind (docs/evals.md).
const SETS = { va: VA_CASES, holdout: HOLDOUT_CASES, holdout2: HOLDOUT2_CASES, messaging: MESSAGING_CASES, memdec: MEMDEC_CASES } as const;
const CASES = SETS[flag("--set") as keyof typeof SETS] ?? FIRST_WIN_CASES;
for (const c of CASES) {
  const before = traces.length;
  const r = await runEval([c], port, args.includes("--raw") ? undefined : { now: NOW, timeZone: "America/Costa_Rica" });
  const res = r.results[0]!;
  results.push(res);
  rows.push({ id: c.id, input: c.input, expect: c.expect, pass: res.pass, reason: res.reason, got: res.got, ms: res.ms, raw: traces.slice(before) });
  console.log(`${res.pass ? "pass" : "FAIL"}  ${c.id.padEnd(16)} ${res.pass ? "" : `${res.reason}`}`);
}
const by = (lang: string) => CASES.filter((c, i) => c.lang === lang && results[i]!.pass).length;
const families = [...new Set(CASES.map(familyOf))];
const fam = families.map((f) => { const ix = CASES.map((c, i) => [c, i] as const).filter(([c]) => familyOf(c) === f); return `${f} ${ix.filter(([, i]) => results[i]!.pass).length}/${ix.length}`; }).join(" | ");
const ms = results.map((r) => r.ms).sort((a, b) => a - b);
// Prompt reading is most of a phone turn (~200 tok/s on the S26): report what each case had to read.
const read = traces.reduce((n, t) => n + (t.promptTokens ?? 0), 0);
const reused = traces.reduce((n, t) => n + (t.cachedTokens ?? 0), 0);
console.log(`prompt tokens read ${read} (${Math.round(read / Math.max(1, results.length))} per case), reused from cache ${reused}, calls ${traces.length}${profile.stablePrefix ? " stable-prefix" : ""}`);
const passed = results.filter((r) => r.pass).length;
console.log(`\n${profile.id} format=${profile.format} prompt=${profile.prompt ?? "default"}${profile.fastRoute ? " fast-route" : ""} thinking=${JSON.stringify(profile.thinking)}: ${passed}/${results.length} | es ${by("es")} | en ${by("en")} | median ${ms[Math.floor(ms.length / 2)]} ms\n  ${fam}`);
if (out) writeFileSync(out, rows.map((r) => JSON.stringify(r)).join("\n") + "\n");
