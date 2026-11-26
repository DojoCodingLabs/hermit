#!/usr/bin/env node
// Prints each report's planned thread count next to the other counts the Device lab timed (speed.sweep), so anyone
// can see where another count was faster than the plan. Every data file is checked again (readEntries) first. It only
// reads: it writes no file.
//
//   node scripts/devices/plans.mjs [--data DIR]
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { readEntries } from "./table.mjs";

/** A row is marked when another count beat the plan by more than this. Each count is the mean of only two calls. */
export const BEAT_PLAN_PERCENT = 10;
const ROOT = fileURLToPath(new URL("../../", import.meta.url));

/** One row per report: the plan, the sweep, the fastest count and how much faster than the plan it was. */
export function planRows(entries) {
  return entries.map(({ report: r }) => {
    const plan = r.speed.tokensPerSecond;
    const sweep = r.speed.sweep.map((s) => ({ threads: s.threads, tokensPerSecond: s.tokensPerSecond }));
    // The plan wins a tie, and a count that wrote nothing never wins.
    let fastest = { threads: r.speed.threads, tokensPerSecond: plan };
    for (const s of sweep) if (s.tokensPerSecond > fastest.tokensPerSecond) fastest = s;
    const beaten = fastest.threads !== r.speed.threads;
    const fasterPercent = !beaten ? 0 : plan > 0 ? ((fastest.tokensPerSecond - plan) * 100) / plan : null;
    return {
      phone: `${r.device.manufacturer} ${r.device.model}`,
      chip: r.device.chipVendor ? `${r.device.chipVendor} ${r.device.chip}` : r.device.chip,
      tier: r.runtime.tier,
      allowedCpus: r.runtime.allowedCpus,
      plannedThreads: r.speed.threads,
      plannedTokensPerSecond: plan,
      sweep,
      fastestThreads: fastest.threads,
      fasterPercent,
      planBeaten: beaten && (fasterPercent === null || fasterPercent > BEAT_PLAN_PERCENT),
    };
  });
}

const cell = (v) => String(v).replace(/\|/g, "\\|").replace(/[\r\n]+/g, " ");

const HEADER = ["Phone", "Chip", "Tier", "Allowed cores", "Planned threads", "Planned tokens/s", "Sweep (threads: tokens/s)", "Fastest threads", "Faster than plan", "Plan beaten"];
const ALIGN = [":----", ":----", ":----", ":----", "----:", "----:", ":----", "----:", "----:", ":----"];

/** The table's markdown, in the order the reports come (readEntries sorts them by file name). */
export function renderPlans(entries) {
  const rows = planRows(entries);
  if (!rows.length) return "No reports yet.";
  const body = rows.map((row) => [
    row.phone,
    row.chip,
    row.tier,
    row.allowedCpus,
    row.plannedThreads,
    row.plannedTokensPerSecond.toFixed(1),
    row.sweep.length ? row.sweep.map((s) => `${s.threads}: ${s.tokensPerSecond.toFixed(1)}`).join(", ") : "none",
    row.fastestThreads,
    row.fasterPercent === null ? "n/a" : `${row.fasterPercent.toFixed(1)}%`,
    row.planBeaten ? "yes" : "",
  ]);
  return [HEADER, ALIGN, ...body].map((cells) => `| ${cells.map(cell).join(" | ")} |`).join("\n");
}

function main(argv) {
  const i = argv.indexOf("--data");
  const data = i >= 0 ? argv[i + 1] : join(ROOT, "data", "devices");
  console.log(renderPlans(readEntries(data)));
  return 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  }
}
