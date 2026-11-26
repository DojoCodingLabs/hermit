#!/usr/bin/env node
// Builds the device table in docs/devices.md from the reports in data/devices. Every data file is checked again
// (validate.mjs) before it can reach the table, and the table goes only between the two markers.
//
//   node scripts/devices/table.mjs [--data DIR] [--doc FILE]    rewrites the table
//   node scripts/devices/table.mjs --check                      exits 1 when the doc's table is out of date
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { loadSchema, reportFileName, validateReport } from "./validate.mjs";

export const START = "<!-- device-table:start -->";
export const END = "<!-- device-table:end -->";
const ROOT = fileURLToPath(new URL("../../", import.meta.url));
/** From docs/devices.md to a data file. */
const LINK_BASE = "../data/devices/";

/** Every report in `dir`, checked: a bad file stops the table, naming the file and what is wrong. */
export function readEntries(dir, schema = loadSchema()) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((file) => {
      const saved = JSON.parse(readFileSync(join(dir, file), "utf8"));
      const keys = saved && typeof saved === "object" && !Array.isArray(saved) ? Object.keys(saved).sort() : [];
      if (keys.join(",") !== "issue,report") throw new Error(`${file}: should hold only issue and report`);
      if (!Number.isInteger(saved.issue) || saved.issue < 1) throw new Error(`${file}: issue should be a positive integer`);
      const v = validateReport(saved.report, schema);
      if (!v.ok) throw new Error(`${file}: ${v.errors.join("; ")}`);
      const expected = reportFileName(saved.report);
      if (file !== expected) throw new Error(`${file}: should be named ${expected}`);
      return { file, issue: saved.issue, report: saved.report };
    });
}

const cell = (v) => String(v).replace(/\|/g, "\\|").replace(/[\r\n]+/g, " ");
const seconds = (ms) => `${(ms / 1000).toFixed(1)} s`;

function notes(r) {
  const out = [];
  if (r.runtime.batterySaver) out.push("battery saver on");
  if (r.device.lowRam) out.push("low-RAM device");
  const n = r.run.thermalPauses;
  if (n === 1) out.push("paused once for heat");
  else if (n > 1) out.push(`paused ${n} times for heat`);
  return out.join(", ");
}

const HEADER = ["Phone", "Chip", "RAM", "System", "Threads", "Tokens/s", "First token", "Right", "First action, median", "First action, p90", "Notes", "App", "Date", "Data"];
const ALIGN = [":----", ":----", "----:", ":----", "----:", "----:", "----:", "----:", "----:", "----:", ":----", ":----", ":----", ":----"];

/** The table's markdown: fastest first (tokens per second at the plan's thread count). */
export function renderTable(entries) {
  if (!entries.length) return "No reports yet. Run the Device lab and file yours: the steps are above.";
  const phone = (r) => `${r.device.manufacturer} ${r.device.model}`;
  const rows = [...entries]
    .sort((a, b) => b.report.speed.tokensPerSecond - a.report.speed.tokensPerSecond || phone(a.report).localeCompare(phone(b.report)) || b.report.run.date.localeCompare(a.report.run.date) || a.file.localeCompare(b.file))
    .map(({ file, report: r }) => [
      // An iPhone doesn't name its chip; its model identifier says which one it is. A version 1 report is Android's.
      r.device.platform === "ios" ? `${phone(r)} (${r.device.modelId})` : phone(r),
      r.device.platform === "ios" ? "unknown" : r.device.chipVendor ? `${r.device.chipVendor} ${r.device.chip}` : r.device.chip,
      `${r.device.ramGB} GB`,
      r.device.platform === "ios" ? `iOS ${r.device.ios}` : `Android ${r.device.android} (API ${r.device.api})`,
      r.speed.threads,
      r.speed.tokensPerSecond.toFixed(1),
      seconds(r.speed.firstTokenMs),
      `${r.eval.score}/${r.eval.n}`,
      seconds(r.eval.firstActionMedianMs),
      seconds(r.eval.p90Ms),
      notes(r),
      r.app,
      r.run.date,
      `[json](${LINK_BASE}${file})`,
    ]);
  return [HEADER, ALIGN, ...rows].map((cells) => `| ${cells.map(cell).join(" | ")} |`).join("\n");
}

/** The page with `table` between the markers, everything else as it was. */
export function updateDoc(doc, table) {
  const start = doc.indexOf(START);
  const end = doc.indexOf(END, start + START.length);
  if (start < 0 || end < 0) throw new Error(`the page has no ${START} ... ${END} markers`);
  return `${doc.slice(0, start + START.length)}\n${table}\n${doc.slice(end)}`;
}

export const USAGE = [
  "usage:",
  "  node scripts/devices/table.mjs [--data DIR] [--doc FILE]    rewrites the table",
  "  node scripts/devices/table.mjs --check                      exits 1 when the doc's table is out of date",
].join("\n");

/** The command line, or a usage error: an unknown flag or argument, or --data / --doc with no value, is refused. */
export function parseCli(argv) {
  if (argv.includes("--help") || argv.includes("-h")) return { help: true };
  try {
    const { values } = parseArgs({
      args: argv,
      strict: true,
      allowPositionals: false,
      options: { data: { type: "string" }, doc: { type: "string" }, check: { type: "boolean" } },
    });
    return { values };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

function main(argv) {
  const cli = parseCli(argv);
  if (cli.help) {
    console.log(USAGE);
    return 0;
  }
  if (cli.error) {
    console.error(`${cli.error}\n${USAGE}`);
    return 1;
  }
  const data = cli.values.data ?? join(ROOT, "data", "devices");
  const docPath = cli.values.doc ?? join(ROOT, "docs", "devices.md");
  const doc = readFileSync(docPath, "utf8");
  const next = updateDoc(doc, renderTable(readEntries(data)));
  if (cli.values.check) {
    if (next === doc) return 0;
    console.error(`${docPath}: the device table is out of date. Run node scripts/devices/table.mjs`);
    return 1;
  }
  writeFileSync(docPath, next);
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
