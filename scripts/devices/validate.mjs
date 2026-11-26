#!/usr/bin/env node
// Checks a Hermit device report against docs/devices/schema.json and the privacy rules, and reads one from a GitHub
// issue for the device-report workflow. Nothing from the issue is ever run: the event file is read as data, the
// report's JSON goes through JSON.parse, and messages name fields, never what was written in them.
//
//   node scripts/devices/validate.mjs report.json
//   node scripts/devices/validate.mjs --event "$GITHUB_EVENT_PATH" [--github-output FILE] [--comment FILE] [--write DIR]
//
// With --event it appends to --github-output valid=true|false, form=true|false (the issue was filed with the Device
// report form, so a problem is worth a comment) and file=NAME; it writes the failure comment to --comment; and with
// --write it saves a valid report as DIR/<phone>-<hash>.json ({ issue, report }). Exit 0, or 1 when --write was
// asked for a report that isn't valid (or on a bad call).
import { createHash } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

/** The newest report format. Version 1 reports, Android only and from before the platform was named, stay valid. */
export const REPORT_SCHEMA = "hermit-device-report/2";
const SCHEMA_PATH = fileURLToPath(new URL("../../docs/devices/schema.json", import.meta.url));
/** The Device lab didn't exist before this day, so no report can be older. */
const FIRST_DAY = "2026-11-01";
const MAX_BODY = 65536;
const MAX_REPORT = 20000;

export function loadSchema(path = SCHEMA_PATH) {
  return JSON.parse(readFileSync(path, "utf8"));
}

// The JSON Schema keywords this validator implements. Any other keyword in the schema is an error, so a constraint
// can never be skipped silently.
const KEYWORDS = new Set(["type", "const", "enum", "pattern", "minLength", "maxLength", "minimum", "maximum", "required", "properties", "additionalProperties", "items", "minItems", "maxItems", "oneOf", "$ref", "$defs"]);
const ANNOTATIONS = new Set(["$schema", "$id", "$comment", "title", "description"]);

const isObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const TYPE_OK = {
  object: isObject,
  array: Array.isArray,
  string: (v) => typeof v === "string",
  boolean: (v) => typeof v === "boolean",
  integer: (v) => Number.isInteger(v),
  number: (v) => typeof v === "number" && Number.isFinite(v),
};
const A = { object: "an object", array: "a list", string: "text", boolean: "true or false", integer: "an integer", number: "a number" };

/** A field name someone made up, safe to show: letters, digits and underscores, at most 32. */
const safeKey = (k) => String(k).replace(/[^A-Za-z0-9_]/g, "").slice(0, 32) || "unnamed";

function resolve(root, ref) {
  const m = /^#\/\$defs\/([A-Za-z0-9_]+)$/.exec(ref);
  const target = m && root.$defs ? root.$defs[m[1]] : undefined;
  if (!target) throw new Error(`schema $ref ${ref} is not a local $defs entry`);
  return target;
}

const deref = (root, s) => (s.$ref ? deref(root, resolve(root, s.$ref)) : s);

/**
 * oneOf: exactly one shape must fit. When none does, the errors are those of the shape the value says it is: every
 * const field it has matches, and a required one isn't missing (a device whose platform is ios is checked as an
 * iPhone). A const field that matches no shape is named; failing that, a const field every shape requires.
 */
function oneOfErrors(schema, value, root, path) {
  const shapes = schema.oneOf.map((s) => deref(root, s));
  const results = shapes.map((s) => schemaErrors(s, value, root, path));
  const fitting = results.filter((r) => !r.length).length;
  if (fitting === 1) return [];
  if (fitting > 1) return [`${path}: matches more than one allowed shape`];
  const consts = (s) => Object.entries(s.properties ?? {}).filter(([, p]) => "const" in p);
  if (isObject(value)) {
    const claims = (s) => consts(s).every(([k, p]) => (Object.hasOwn(value, k) ? value[k] === p.const : !(s.required ?? []).includes(k)));
    const i = shapes.findIndex(claims);
    if (i >= 0) return results[i];
    const named = shapes.flatMap(consts).find(([k]) => Object.hasOwn(value, k));
    if (named) return [`${path}.${named[0]}: isn't one of the allowed values`];
    const everywhere = consts(shapes[0]).find(([k]) => shapes.every((s) => (s.required ?? []).includes(k)));
    if (everywhere) return [`${path}: misses ${everywhere[0]}`];
  }
  const first = results[0].join("\n");
  return results.every((r) => r.join("\n") === first) ? results[0] : [`${path}: isn't one of the allowed shapes`];
}

/** Errors for `value` against `schema` (the subset in KEYWORDS), each "path: what is wrong". */
export function schemaErrors(schema, value, root = schema, path = "report") {
  for (const k of Object.keys(schema)) {
    if (!KEYWORDS.has(k) && !ANNOTATIONS.has(k)) throw new Error(`schema keyword ${k} is not supported by this validator`);
  }
  if (schema.$ref) return schemaErrors(resolve(root, schema.$ref), value, root, path);
  if (schema.oneOf) {
    const beside = Object.keys(schema).filter((k) => k !== "oneOf" && !ANNOTATIONS.has(k));
    if (beside.length) throw new Error(`schema keyword ${beside[0]} next to oneOf is not supported by this validator`);
    return oneOfErrors(schema, value, root, path);
  }
  const errors = [];
  if (schema.type) {
    if (!TYPE_OK[schema.type]) throw new Error(`schema type ${schema.type} is not supported by this validator`);
    if (!TYPE_OK[schema.type](value)) return [`${path}: should be ${A[schema.type]}`];
  }
  if ("const" in schema && value !== schema.const) errors.push(`${path}: should be ${schema.const}`);
  if (schema.enum && !schema.enum.includes(value)) errors.push(`${path}: isn't one of the allowed values`);
  if (typeof value === "string") {
    const length = [...value].length;
    if (schema.minLength !== undefined && length < schema.minLength) errors.push(`${path}: is shorter than ${schema.minLength} characters`);
    if (schema.maxLength !== undefined && length > schema.maxLength) errors.push(`${path}: is longer than ${schema.maxLength} characters`);
    if (schema.pattern !== undefined && !new RegExp(schema.pattern, "u").test(value)) errors.push(`${path}: doesn't have the allowed form`);
  }
  if (typeof value === "number") {
    if (schema.minimum !== undefined && value < schema.minimum) errors.push(`${path}: is below ${schema.minimum}`);
    if (schema.maximum !== undefined && value > schema.maximum) errors.push(`${path}: is above ${schema.maximum}`);
  }
  if (isObject(value)) {
    for (const key of schema.required ?? []) if (!Object.hasOwn(value, key)) errors.push(`${path}: misses ${key}`);
    const props = schema.properties ?? {};
    for (const key of Object.keys(value)) {
      if (Object.hasOwn(props, key)) errors.push(...schemaErrors(props[key], value[key], root, `${path}.${key}`));
      else if (schema.additionalProperties === false) errors.push(`${path}: has a field that isn't in the schema (${safeKey(key)})`);
    }
  }
  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) errors.push(`${path}: has fewer than ${schema.minItems} items`);
    if (schema.maxItems !== undefined && value.length > schema.maxItems) errors.push(`${path}: has more than ${schema.maxItems} items`);
    if (schema.items) value.forEach((item, i) => errors.push(...schemaErrors(schema.items, item, root, `${path}[${i}]`)));
  }
  return errors;
}

// What personal data looks like in a string. The schema's patterns already keep most of it out; these say why.
const PRIVATE = [
  [/@/, "looks like an email address"],
  [/[a-z][a-z0-9+.-]*:\/\/|\bwww\.|\b[a-z0-9-]+\.(com|net|org|io|dev|app|me|co|ai|xyz|info|biz|us|uk|de|es|mx|cr|br|ar|cl|ly|gg|tv|link|site|online|example)\b/i, "looks like a web address"],
  [/[0-9]{10,}/, "has a long run of digits (a phone number or an IMEI is never in a report)"],
  [/\b[0-9a-f]{16,}\b/i, "looks like an identifier (a serial or an Android ID is never in a report)"],
];

/** How deep a report may nest. The schema needs four levels; deeper input is refused before it can exhaust the stack. */
export const MAX_DEPTH = 16;

/** Every string anywhere in `value`, checked for personal data; fields are named, values never repeated. */
export function privacyErrors(value, path = "report", depth = 0) {
  if (depth > MAX_DEPTH && (Array.isArray(value) || isObject(value))) return [`${path}: is nested too deeply`];
  if (typeof value === "string") return PRIVATE.filter(([re]) => re.test(value)).map(([, why]) => `${path}: ${why}`);
  if (Array.isArray(value)) return value.flatMap((v, i) => privacyErrors(v, `${path}[${i}]`, depth + 1));
  if (isObject(value)) return Object.keys(value).flatMap((k) => privacyErrors(value[k], `${path}.${safeKey(k)}`, depth + 1));
  return [];
}

const day = (d) => d.toISOString().slice(0, 10);

/** iOS's thermal states and the state each one is mapped to on Android's scale (apps/mobile/src/platform-facts.ts). */
const IOS_THERMAL = { nominal: "none", fair: "light", serious: "severe", critical: "critical" };

/** Checks the numbers against each other; runs only on a report the schema accepts. */
function consistencyErrors(r, today) {
  const errors = [];
  // Version 1 is from before reports named their platform; version 2 always names it.
  const named = Object.hasOwn(r.device, "platform");
  if (r.schema === "hermit-device-report/1" && named) errors.push("report.device.platform: isn't in a version 1 report");
  if (r.schema !== "hermit-device-report/1" && !named) errors.push("report.device: misses platform");
  for (const [own, mapped] of [["osThermalStart", "thermalStart"], ["osThermalMax", "thermalMax"]]) {
    if (!Object.hasOwn(r.runtime, own)) continue;
    if (r.device.platform !== "ios") errors.push(`report.runtime.${own}: is for an iPhone report only`);
    else if (r.runtime[own] !== "unknown" && IOS_THERMAL[r.runtime[own]] !== r.runtime[mapped]) errors.push(`report.runtime.${own}: doesn't match ${mapped}`);
  }
  const e = r.eval;
  if (e.score > e.n) errors.push("report.eval.score: is more than n");
  if (e.firstActionMedianMs > e.p90Ms) errors.push("report.eval.firstActionMedianMs: is more than p90Ms");
  if (e.perCase) {
    if (e.perCase.length !== e.n) errors.push(`report.eval.perCase: has ${e.perCase.length} cases but n is ${e.n}`);
    const passed = e.perCase.filter((c) => c.pass).length;
    if (passed !== e.score) errors.push(`report.eval.perCase: ${passed} passed but score is ${e.score}`);
    if (new Set(e.perCase.map((c) => c.id)).size !== e.perCase.length) errors.push("report.eval.perCase: repeats a case");
    const ms = e.perCase.map((c) => c.ms);
    const [lo, hi] = [Math.min(...ms), Math.max(...ms)];
    for (const k of ["firstActionMedianMs", "p90Ms"]) if (e[k] < lo || e[k] > hi) errors.push(`report.eval.${k}: is outside the cases' times`);
  }
  const counts = [r.speed.threads, ...r.speed.sweep.map((s) => s.threads)];
  if (new Set(counts).size !== counts.length) errors.push("report.speed.sweep: repeats a thread count");
  if (r.run.pausedMs > r.run.durationMs) errors.push("report.run.pausedMs: is more than durationMs");
  if (r.run.thermalPauses === 0 && r.run.pausedMs > 0) errors.push("report.run.pausedMs: is above 0 with no pauses");
  const tomorrow = day(new Date(today.getTime() + 86_400_000));
  if (r.run.date > tomorrow) errors.push("report.run.date: is in the future");
  if (r.run.date < FIRST_DAY) errors.push("report.run.date: is before the Device lab existed");
  return errors;
}

/** The whole check: the schema, the privacy rules on every string, then (when the shape is right) the numbers. */
export function validateReport(report, schema = loadSchema(), { today = new Date() } = {}) {
  const shape = schemaErrors(schema, report);
  const errors = [...shape, ...privacyErrors(report)];
  if (!shape.length) errors.push(...consistencyErrors(report, today));
  return { ok: errors.length === 0, errors };
}

/** The issue form's fields, as GitHub renders them: "### Label" then the answer. The first heading of a name wins. */
function sections(body) {
  const out = new Map();
  let current;
  for (const line of body.split(/\r?\n/)) {
    const m = /^###\s+(.+?)\s*$/.exec(line);
    if (m) {
      current = out.has(m[1]) ? undefined : m[1];
      if (current) out.set(current, []);
      continue;
    }
    if (current) out.get(current).push(line);
  }
  return out;
}

/** Whether an issue was filed with the Device report form: it has the form's Report field. */
export function isReportForm(body) {
  return typeof body === "string" && body.length <= MAX_BODY && sections(body).has("Report");
}

/** The report from an issue filed with the Device report form, and whether its privacy box is ticked. */
export function extractReport(body) {
  if (typeof body !== "string" || body.length > MAX_BODY) return { errors: ["The issue is too long to be a device report."] };
  const fields = sections(body);
  const lines = fields.get("Report");
  if (!lines) return { errors: ["The issue has no Report field. File it with the Device report form."] };
  // The form wraps the answer in a json code fence; a pasted fence inside it goes too. JSON has no line that starts
  // with ``` (a string can't hold a raw line break), so dropping fence lines never cuts the report.
  const text = lines.filter((l) => !/^\s*```/.test(l)).join("\n").trim();
  const errors = [];
  let report;
  if (!text || text === "_No response_") errors.push("The Report field is empty.");
  else if (text.length > MAX_REPORT) errors.push("The Report field is too long to be a device report.");
  else {
    try {
      report = JSON.parse(text);
    } catch {
      errors.push("The Report field isn't valid JSON. Paste it exactly as the app copied it.");
    }
  }
  const privacy = (fields.get("Privacy") ?? []).join("\n");
  if (!/^\s*-\s*\[[xX]\]/m.test(privacy)) errors.push("The box saying the report contains no personal data isn't ticked.");
  return report === undefined ? { errors } : { report, errors };
}

/** JSON with every object's keys sorted, so the same report always gives the same bytes. */
export function canonicalJson(value) {
  const sort = (v) => (Array.isArray(v) ? v.map(sort) : isObject(v) ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, sort(v[k])])) : v);
  return JSON.stringify(sort(value));
}

/** <maker-model>-<first 8 hex of the report's SHA-256>.json */
export function reportFileName(report) {
  const slug = `${report.device.manufacturer} ${report.device.model}`.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "phone";
  const hash = createHash("sha256").update(canonicalJson(report)).digest("hex").slice(0, 8);
  return `${slug}-${hash}.json`;
}

/**
 * Saves a valid report as DIR/<name> holding { issue, report }. A report this issue filed before (it was edited) is
 * replaced; the same report already filed by another issue stays as it was, and `duplicateOf` names that issue.
 */
export function writeReport(dir, issue, report) {
  mkdirSync(dir, { recursive: true });
  const name = reportFileName(report);
  const target = join(dir, name);
  if (existsSync(target)) {
    const before = JSON.parse(readFileSync(target, "utf8"));
    if (before.issue !== issue) return { name, duplicateOf: before.issue };
  }
  for (const f of readdirSync(dir)) {
    if (!f.endsWith(".json") || f === name) continue;
    let saved;
    try {
      saved = JSON.parse(readFileSync(join(dir, f), "utf8"));
    } catch {
      continue;
    }
    if (saved?.issue === issue) rmSync(join(dir, f));
  }
  writeFileSync(target, `${JSON.stringify({ issue, report: JSON.parse(canonicalJson(report)) }, null, 2)}\n`);
  return { name };
}

/** The comment on an issue whose report didn't pass: what is wrong, and how to fix it. */
export function issueComment(errors) {
  const shown = errors.slice(0, 20).map((e) => `- ${e}`);
  if (errors.length > 20) shown.push(`- and ${errors.length - 20} more`);
  return [
    "Thanks for running the Device lab. This report can't go in the device table yet:",
    "",
    ...shown,
    "",
    "To fix it, edit this issue: paste the report exactly as the app made it (Copy, in the Device lab), keep the box about personal data ticked, and save. The check runs again on every edit.",
    "",
  ].join("\n");
}

export const USAGE = [
  "usage:",
  "  node scripts/devices/validate.mjs report.json",
  '  node scripts/devices/validate.mjs --event "$GITHUB_EVENT_PATH" [--github-output FILE] [--comment FILE] [--write DIR]',
].join("\n");

/**
 * The command line, or a usage error. Unknown flags, a flag with no value and a wrong number of report files are
 * refused, so a typo can't turn into a file name. Errors only repeat the command line, never a report's contents.
 */
export function parseCli(argv) {
  if (argv.includes("--help") || argv.includes("-h")) return { help: true };
  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      strict: true,
      allowPositionals: true,
      options: { event: { type: "string" }, "github-output": { type: "string" }, comment: { type: "string" }, write: { type: "string" } },
    });
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
  const { values, positionals } = parsed;
  if (values.event === undefined && positionals.length !== 1) return { error: "give one report file, or --event FILE" };
  if (values.event !== undefined && positionals.length > 0) return { error: "--event takes no report file" };
  return { values, file: positionals[0] };
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
  const flag = (name) => cli.values[name.slice(2)];
  const eventPath = flag("--event");
  if (!eventPath) {
    const file = cli.file;
    const v = validateReport(JSON.parse(readFileSync(file, "utf8")));
    if (v.ok) console.log(`valid: ${file}`);
    else console.error(v.errors.join("\n"));
    return v.ok ? 0 : 1;
  }
  const event = JSON.parse(readFileSync(eventPath, "utf8"));
  const issue = event?.issue?.number;
  if (!Number.isInteger(issue) || issue < 1) throw new Error("the event has no issue number");
  const body = event.issue.body ?? "";
  const output = flag("--github-output");
  const comment = flag("--comment");
  const write = flag("--write");
  // The device-lab label marks other issues too (ones that need a real phone): without the form's Report field this
  // isn't a device report, so there is nothing to check and nothing to say.
  if (!isReportForm(body)) {
    if (output) appendFileSync(output, "valid=false\nform=false\n");
    console.error(`issue ${issue}: not filed with the Device report form`);
    return write ? 1 : 0;
  }
  const found = extractReport(body);
  const errors = [...found.errors];
  if (found.report !== undefined) errors.push(...validateReport(found.report).errors);
  const valid = errors.length === 0;
  if (output) appendFileSync(output, `valid=${valid}\nform=true\n${valid ? `file=${reportFileName(found.report)}\n` : ""}`);
  if (!valid) {
    if (comment) writeFileSync(comment, issueComment(errors));
    console.error(`issue ${issue}: ${errors.length} problems`);
    return write ? 1 : 0;
  }
  if (write) {
    const saved = writeReport(write, issue, found.report);
    if (saved.duplicateOf !== undefined) console.error(`issue ${issue}: the same report is already in the table from issue ${saved.duplicateOf}`);
    console.log(saved.name);
  } else {
    console.log("valid");
  }
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
