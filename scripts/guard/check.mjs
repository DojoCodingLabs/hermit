#!/usr/bin/env node
// The PR guard. It compares a change with its base and fails when the change:
//
//   1. adds a telemetry, analytics, ads or crash reporting SDK: in any package.json (aliases, git and tarball
//      sources and overrides included), in what a pnpm or npm lockfile resolves, or in a Gradle or iOS build file;
//   2. adds an em dash, an en dash or a look-alike to packages/copy/locales/*.json;
//   3. leaves those locales without the same keys and the same {placeholders};
//   4. adds a line under docs/, or to a top-level Markdown file, that matches a pattern in the patterns file
//      (scripts/guard/patterns.txt ships with the repository; without --patterns this check is skipped);
//   5. adds a commit with an AI co-author trailer or an AI tool's "Generated with" line. Name the agent in the pull
//      request's description instead (CONTRIBUTING.md, Working with AI agents).
//
// Plain Node with no dependencies:
//
//   node scripts/guard/check.mjs [--base <ref>] [--patterns <file>]
//
// It reads what you committed and what you haven't yet, untracked files included, against the merge base of <ref>
// and HEAD. The default <ref> is origin/HEAD, then origin/main, then origin/master. Exit codes: 0 clean, 1 problems
// found, 2 the guard couldn't run (a bad argument, a missing base or an unreadable patterns file).
//
// The patterns file has one pattern per line. Blank lines and lines starting with # are skipped. A line written
// as /source/flags is a regular expression; any other line is plain text, matched without regard to case.
import { spawnSync } from "node:child_process";
import process from "node:process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, posix, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// 1. Telemetry ---------------------------------------------------------------------------------------------------

/**
 * Package names that phone home: product analytics, crash and error reporting, performance monitoring, session
 * replay, attribution, marketing engagement and ads. Anchored where a brand name is also an ordinary word.
 */
const NPM_DENY = [
  // Product analytics.
  /posthog/, /mixpanel/, /^@amplitude\//, /^amplitude(-js)?$/, /^react-native-amplitude/, /^@segment\//,
  /rudderstack/, /^rudder-sdk/, /^@heap\//, /countly/, /matomo/, /^@snowplow\//, /^@statsig\//, /^statsig-/,
  /^@aptabase\//, /^plausible-tracker$/, /^fathom-client$/, /appmetrica/,
  // Google, Firebase, Microsoft and Vercel analytics.
  /^firebase(-|$)/, /^@firebase\//, /^@react-native-firebase\//, /(^|[/-])firebase([/-]|$)/, /^react-ga4?$/,
  /^ga-4-react$/, /(^|[/-])gtag(-|$)/, /^@next\/third-parties$/, /applicationinsights/, /^@vercel\/(analytics|speed-insights)$/,
  /^expo-(insights|firebase-.+|analytics-.+|ads-.+|facebook)$/,
  // Crash and error reporting.
  /^@sentry(-internal)?\//, /(^|[/-])sentry([/-]|$)/, /^raven(-js)?$/, /bugsnag/, /rollbar/, /raygun/, /honeybadger/,
  /airbrake/, /^@?trackjs(\/|$)/, /instabug/, /crashlytics/, /^@embrace-io\//, /(^|[/-])crash-?report(er|ers|ing|s)?([/-]|$)/,
  // Performance monitoring.
  /datadog/, /^dd-trace$/, /newrelic/, /^appcenter(-|$)/, /^@dynatrace\//, /appdynamics/, /^elastic-apm-/,
  /^@elastic\/apm-rum/, /^@grafana\/faro-/, /^@honeycombio\//, /^@opentelemetry\/exporter-/,
  // Session replay.
  /logrocket/, /fullstory/, /hotjar/, /smartlook/, /^@openreplay\//, /^@highlight-run\//, /^highlight\.run$/,
  /uxcam|ux-cam/, /contentsquare/, /^@microsoft\/(react-native-)?clarity$/,
  // Attribution and marketing engagement.
  /appsflyer/, /^react-native-adjust$/, /^@adjust\//, /^react-native-branch$/, /^branch-sdk$/, /kochava/,
  /^@braze\//, /appboy/, /customerio/, /onesignal/,
  // Ads.
  /google-mobile-ads/, /admob/, /^react-native-fbads$/, /^react-native-fbsdk/, /applovin/, /ironsource/, /unity-ads/,
  // Anything that says what it is.
  /(^|[/-])analytics([/-]|$)/, /(^|[/-])telemetry([/-]|$)/,
];

/** Words that give a telemetry SDK away in a git or tarball source, where there is no package name to read. */
const SOURCE_DENY = /posthog|sentry|segmentio|mixpanel|amplitude|datadog|bugsnag|newrelic|appcenter|crashlytics|firebase|rollbar|logrocket|instabug|appsflyer|fullstory|hotjar|smartlook|rudderstack|countly|matomo|raygun|honeybadger|airbrake|embrace-io|statsig|aptabase|openreplay|highlight-run|dynatrace|appdynamics|braze|onesignal|customerio|analytics|telemetry/i;

/** Native build files: Gradle coordinates and plugins, CocoaPods and Swift packages. */
const NATIVE_DENY = [
  /\bio\.sentry\b/i,
  /\bcom\.google\.firebase\b/i,
  /\bcom\.google\.gms[.:]google-services\b/i,
  /\bplay-services-(measurement|analytics|ads)\b/i,
  /\bcom\.(bugsnag|datadoghq|amplitude|mixpanel|appsflyer|instabug|newrelic|segment|posthog|heapanalytics|fullstory|smartlook|raygun|rollbar|applovin|ironsource|kochava|braze|appboy|onesignal|uxcam|contentsquare|dynatrace|appdynamics)\b/i,
  /\bio\.(logrocket|embrace|branch|rudderstack|customer\.android)\b/i,
  /\bcom\.microsoft\.(appcenter|clarity)\b/i,
  /\bcom\.adjust\.sdk\b/i,
  /\bcom\.facebook\.android:(facebook-android-sdk|facebook-core|facebook-common|audience-network-sdk)\b/i,
  /\bcom\.unity3d\.ads\b/i,
  /\b(pod|dependency)\s*\(?\s*['"](Sentry|Firebase\w*|Bugsnag\w*|Mixpanel\w*|Amplitude\w*|PostHog\w*|Segment\w*|AppCenter\w*|Datadog\w*|NewRelic\w*|Instabug\w*|AppsFlyer\w*|Google-Mobile-Ads-SDK|FBSDK\w*|FBAudienceNetwork|Branch|Adjust|LogRocket|FullStory|Smartlook\w*|Embrace\w*)\b/,
  /github\.com\/(getsentry|posthog|segmentio|mixpanel|amplitude|datadog|bugsnag|newrelic|microsoft\/appcenter|instabug|appsflyersdk|firebase\/firebase-ios-sdk|googleads)\b/i,
];

const DEPENDENCY_FIELDS = ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"];
const WHY_TELEMETRY = "Hermit has no telemetry: no analytics, ads, crash reporting or tracking SDKs (AGENTS.md).";

/** True when a package name is on the denylist. */
export function deniedPackage(name) {
  return NPM_DENY.some((re) => re.test(name.toLowerCase()));
}

/** "npm:@scope/pkg@1.2.3" -> "@scope/pkg"; "npm:pkg" -> "pkg". */
function aliasTarget(spec) {
  const rest = spec.slice(4);
  const at = rest.indexOf("@", rest.startsWith("@") ? 1 : 0);
  return at === -1 ? rest : rest.slice(0, at);
}

const isSource = (spec) => /^(git\+|git:|github:|gitlab:|bitbucket:|https?:)/i.test(spec) || spec.includes("://");

/** What an entry installs: the alias target, the source without its commit, or the name itself. */
function identity(name, spec) {
  if (typeof spec !== "string") return name;
  if (spec.startsWith("npm:")) return aliasTarget(spec);
  if (isSource(spec)) return spec.replace(/#.*$/, "").toLowerCase();
  return name;
}

/** Every [field, name, spec] in a manifest's dependency fields and overrides, nested overrides included. */
function manifestEntries(manifest) {
  const out = [];
  for (const field of DEPENDENCY_FIELDS) {
    for (const [name, spec] of Object.entries(manifest?.[field] ?? {})) out.push({ field, name, spec, override: false });
  }
  const walk = (field, value, path) => {
    if (typeof value === "string") out.push({ field, name: path, spec: value, override: true });
    else if (value && typeof value === "object") for (const [k, v] of Object.entries(value)) walk(field, v, path ? `${path} > ${k}` : k);
  };
  walk("overrides", manifest?.overrides, "");
  walk("resolutions", manifest?.resolutions, "");
  walk("pnpm.overrides", manifest?.pnpm?.overrides, "");
  return out;
}

function parseJson(path, text, check) {
  try {
    return { value: JSON.parse(text) };
  } catch (err) {
    return { problem: { check, path, message: `is not valid JSON, so the guard can't check it (${err.message}).` } };
  }
}

/** The telemetry SDKs a change adds to one package.json. `before` is null for a new file. */
export function findTelemetryInManifest(path, before, after) {
  const parsed = parseJson(path, after, "telemetry");
  if (parsed.problem) return [parsed.problem];
  let old = {};
  if (before !== null && before !== undefined) {
    try {
      old = JSON.parse(before);
    } catch {
      old = {};
    }
  }
  const known = new Set(manifestEntries(old).map((e) => `${e.name}\u0000${identity(e.name, e.spec)}`));
  const problems = [];
  for (const entry of manifestEntries(parsed.value)) {
    const id = identity(entry.name, entry.spec);
    if (known.has(`${entry.name}\u0000${id}`)) continue;
    const spec = typeof entry.spec === "string" ? entry.spec : "";
    let message;
    if (!entry.override && deniedPackage(entry.name)) message = `adds "${entry.name}" (${entry.field})`;
    else if (spec.startsWith("npm:") && deniedPackage(id)) message = `adds "${entry.name}", an alias for "${id}" (${entry.field})`;
    else if (isSource(spec) && SOURCE_DENY.test(spec)) message = `adds "${entry.name}" from ${spec} (${entry.field})`;
    if (message) problems.push({ check: "telemetry", path, message: `${message}. ${WHY_TELEMETRY}` });
  }
  return problems;
}

const PNPM_KEY = /^ {2}'?\/?((?:@[^@'\s/]+\/)?[^@'\s/]+)@/;
const NPM_KEY = /"(?:[^"]*\/)?node_modules\/((?:@[^/"]+\/)?[^/"]+)"\s*:/;

/** Telemetry packages a lockfile now resolves, from the lines the change adds to it. Once per name. */
export function findTelemetryInLockfile(path, added) {
  const seen = new Set();
  const problems = [];
  for (const { line, text } of added) {
    const name = (PNPM_KEY.exec(text) ?? NPM_KEY.exec(text))?.[1];
    if (!name || seen.has(name) || !deniedPackage(name)) continue;
    seen.add(name);
    problems.push({ check: "telemetry", path, line, message: `resolves "${name}". Find the dependency that pulls it in and drop it. ${WHY_TELEMETRY}` });
  }
  return problems;
}

/** Telemetry SDKs in the lines a change adds to a Gradle, CocoaPods or Swift package file. */
export function findTelemetryInNativeBuild(path, added) {
  const problems = [];
  for (const { line, text } of added) {
    const hit = NATIVE_DENY.map((re) => re.exec(text)?.[0]).find(Boolean);
    if (hit) problems.push({ check: "telemetry", path, line, message: `adds ${hit.trim()}. ${WHY_TELEMETRY}` });
  }
  return problems;
}

// 2. Dashes in copy ----------------------------------------------------------------------------------------------

const DASHES = new Map([
  ["\u2014", "an em dash (U+2014)"],
  ["\u2013", "an en dash (U+2013)"],
  ["\u2012", "a figure dash (U+2012)"],
  ["\u2015", "a horizontal bar (U+2015)"],
  ["\u2E3A", "a two-em dash (U+2E3A)"],
  ["\u2E3B", "a three-em dash (U+2E3B)"],
  ["\uFE58", "a small em dash (U+FE58)"],
  ["\uFE31", "a vertical em dash (U+FE31)"],
  ["\uFE32", "a vertical en dash (U+FE32)"],
]);

/** Leaf values by dotted path, so nested locale files read the same as flat ones. */
function flatten(value, prefix = "", out = new Map()) {
  if (value !== null && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) flatten(v, prefix ? `${prefix}.${k}` : k, out);
  } else {
    out.set(prefix, value);
  }
  return out;
}

/** Dashes in the values a change adds or rewrites in one locale file. `before` is null for a new file. */
export function findDashesInLocale(path, before, after) {
  const parsed = parseJson(path, after, "copy dash");
  if (parsed.problem) return [parsed.problem];
  let old = new Map();
  if (before !== null && before !== undefined) {
    try {
      old = flatten(JSON.parse(before));
    } catch {
      old = new Map();
    }
  }
  const problems = [];
  for (const [key, value] of flatten(parsed.value)) {
    if (typeof value !== "string" || old.get(key) === value) continue;
    const found = [...DASHES].filter(([ch]) => value.includes(ch)).map(([, name]) => name);
    if (found.length) {
      problems.push({ check: "copy dash", path, message: `"${key}" has ${found.join(" and ")}. Use a period, a comma, a colon or parentheses instead.` });
    }
  }
  return problems;
}

// 3. Locale parity -----------------------------------------------------------------------------------------------

const placeholdersOf = (text) => (typeof text === "string" ? [...text.matchAll(/\{(\w+)\}/g)].map((m) => `{${m[1]}}`).sort() : []);

function listShort(items, max = 10) {
  const shown = items.slice(0, max).join(", ");
  return items.length > max ? `${shown} and ${items.length - max} more` : shown;
}

/** Every locale must have the same keys, and each key the same placeholders. Files that don't parse are skipped. */
export function findLocaleParityProblems(locales) {
  const parsed = [];
  for (const { path, text } of locales) {
    try {
      parsed.push({ path, name: posix.basename(path), map: flatten(JSON.parse(text)) });
    } catch {
      // Reported by the dash check when the change touches it.
    }
  }
  if (parsed.length < 2) return [];
  const problems = [];
  const all = new Set(parsed.flatMap((l) => [...l.map.keys()]));
  for (const locale of parsed) {
    const missing = [...all].filter((k) => !locale.map.has(k)).sort();
    if (!missing.length) continue;
    const owners = parsed.filter((l) => l !== locale && missing.some((k) => l.map.has(k))).map((l) => l.name);
    const count = missing.length === 1 ? "1 key" : `${missing.length} keys`;
    const verb = owners.length === 1 ? "has" : "have";
    problems.push({ check: "locale parity", path: locale.path, message: `is missing ${count} that ${owners.join(" and ")} ${verb}: ${listShort(missing)}.` });
  }
  const [first, ...rest] = parsed;
  for (const key of [...first.map.keys()].sort()) {
    const want = placeholdersOf(first.map.get(key)).join(" ");
    for (const other of rest) {
      if (!other.map.has(key)) continue;
      const got = placeholdersOf(other.map.get(key)).join(" ");
      if (got === want) continue;
      problems.push({
        check: "locale parity",
        path: other.path,
        message: `"${key}" has different placeholders: ${first.name} has ${want || "none"}, ${other.name} has ${got || "none"}.`,
      });
    }
  }
  return problems;
}

// 4. Internal content in public docs -----------------------------------------------------------------------------

const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Reads a patterns file: `/source/flags` lines are regular expressions, other lines plain text. */
export function parsePatterns(text) {
  const patterns = [];
  text.split(/\r?\n/).forEach((raw, i) => {
    const line = raw.trim();
    if (!line || line.startsWith("#")) return;
    const number = i + 1;
    const literal = /^\/(.+)\/([a-z]*)$/.exec(line);
    try {
      const regex = literal ? new RegExp(literal[1], literal[2].replace(/[gy]/g, "")) : new RegExp(escapeRegExp(line), "i");
      patterns.push({ number, regex });
    } catch (err) {
      throw new Error(`line ${number}: ${err.message}`, { cause: err });
    }
  });
  return patterns;
}

/** Added lines that match a pattern. The message names the pattern's line, never the pattern itself. */
export function findInternalContent(path, added, patterns) {
  const problems = [];
  for (const { line, text } of added) {
    for (const { number, regex } of patterns) {
      if (regex.test(text)) {
        problems.push({
          check: "internal content",
          path,
          line,
          message: `matches pattern ${number} in the patterns file. Public docs must not quote internal notes, decisions or tooling.`,
        });
      }
    }
  }
  return problems;
}

// The whole change ------------------------------------------------------------------------------------------------

const LOCALE_DIRS = ["packages/copy/locales"];
const LOCKFILES = new Set(["pnpm-lock.yaml", "package-lock.json", "npm-shrinkwrap.json"]);
const NATIVE_FILES = new Set(["build.gradle", "build.gradle.kts", "settings.gradle", "settings.gradle.kts", "Podfile", "Package.swift"]);

const isLocale = (path) => LOCALE_DIRS.some((dir) => posix.dirname(path) === dir && path.endsWith(".json"));
const isNativeBuild = (path) => NATIVE_FILES.has(posix.basename(path)) || /\.podspec$|\.versions\.toml$/.test(path);
const isPublicDoc = (path) => path.startsWith("docs/") || (!path.includes("/") && /\.md$/i.test(path));
const isManifest = (path) => posix.basename(path) === "package.json" && !path.split("/").includes("node_modules");

/** The files the guard reads; everything else in a change is only counted. */
export function isRelevant(path) {
  return isManifest(path) || LOCKFILES.has(posix.basename(path)) || isNativeBuild(path) || isLocale(path) || isPublicDoc(path);
}

// 5. AI co-author trailers -----------------------------------------------------------------------------------------

/** Addresses only AI tools use, and names of AI products. A person who happens to be called Claude is not flagged. */
const AI_ADDRESS = /(?:^|[.@])(?:anthropic\.com|openai\.com|cursor\.(?:com|sh)|codeium\.com|windsurf\.com|devin\.ai|cognition\.ai)$|^copilot@github\.com$|^\d+\+copilot@users\.noreply\.github\.com$/i;
const AI_NAME = /\b(?:claude(?=[\s-]+(?:code|opus|sonnet|haiku|fable|instant|\d))|copilot|cursor[\s-]?agent|codex|devin|jules|aider|chatgpt|gemini code assist|windsurf)\b/i;
const CO_AUTHOR = /^\s*co-authored-by:\s*(.*?)\s*<([^>]*)>\s*$/i;
const GENERATED = /generated (?:with|by) \[?(?:claude(?: code)?|copilot|cursor|codex|chatgpt|devin|aider|windsurf|jules)\b/i;

/** `commits` are { sha, message }. One problem per commit that credits an AI tool as a co-author or says it generated the change. */
export function findAiAttribution(commits) {
  const problems = [];
  for (const { sha, message } of commits) {
    const lines = message.split(/\r?\n/);
    const hit = lines.find((text) => {
      const m = CO_AUTHOR.exec(text);
      return (m && (AI_ADDRESS.test(m[2].trim()) || AI_NAME.test(m[1]))) || GENERATED.test(text);
    });
    if (hit) {
      problems.push({
        check: "ai co-author",
        path: `commit ${sha.slice(0, 12)}`,
        message: `credits an AI tool ("${hit.trim()}"). Remove the line and amend the commit, and name the agent in the pull request's description instead (CONTRIBUTING.md, Working with AI agents).`,
      });
    }
  }
  return problems;
}

const ORDER = ["telemetry", "copy dash", "locale parity", "internal content", "ai co-author"];

/**
 * Runs every check on a change: `files` are { status, path, oldPath?, before, after, added } and `locales` are the
 * locale files as they are after the change ({ path, text }). Parity runs only when the change touches a locale.
 */
export function checkChange({ files, locales = [], commits = [] }, { patterns = [] } = {}) {
  const problems = [];
  let localeTouched = false;
  for (const f of files) {
    const name = posix.basename(f.path);
    const gone = f.after === null || f.after === undefined;
    if (isManifest(f.path) && !gone) problems.push(...findTelemetryInManifest(f.path, f.before, f.after));
    if (LOCKFILES.has(name)) problems.push(...findTelemetryInLockfile(f.path, f.added ?? []));
    if (isNativeBuild(f.path)) problems.push(...findTelemetryInNativeBuild(f.path, f.added ?? []));
    if (isLocale(f.path) || (f.oldPath && isLocale(f.oldPath))) {
      localeTouched = true;
      if (isLocale(f.path) && !gone) problems.push(...findDashesInLocale(f.path, f.before, f.after));
      const removed = f.status === "D" ? f.path : f.oldPath && f.oldPath !== f.path && isLocale(f.oldPath) ? f.oldPath : null;
      if (removed) {
        problems.push({ check: "locale parity", path: removed, message: "was removed or renamed. Every string lives in every locale, so a locale goes only through an accepted RFC." });
      }
    }
    if (patterns.length && isPublicDoc(f.path) && !gone) problems.push(...findInternalContent(f.path, f.added ?? [], patterns));
  }
  if (localeTouched) problems.push(...findLocaleParityProblems(locales));
  problems.push(...findAiAttribution(commits));
  const rank = (p) => ORDER.indexOf(p.check);
  return problems.sort((a, b) => rank(a) - rank(b) || (a.path < b.path ? -1 : a.path > b.path ? 1 : 0) || (a.line ?? 0) - (b.line ?? 0));
}

export function formatProblems(problems) {
  const head = `guard: ${problems.length === 1 ? "1 problem" : `${problems.length} problems`}\n`;
  const body = problems.map((p) => `${p.check}: ${p.path}${p.line ? `:${p.line}` : ""}: ${p.message}`).join("\n");
  return `${head}${body}\nIf the guard is wrong about your change, say so in the pull request and a maintainer will look.\n`;
}

// Reading the change from git --------------------------------------------------------------------------------------

class UsageError extends Error {
  constructor(message, { usage = false, cause } = {}) {
    super(message, { cause });
    this.usage = usage;
  }
}

function git(args, cwd, { allowFail = false } = {}) {
  const r = spawnSync("git", ["-c", "core.quotePath=false", ...args], { cwd, encoding: "utf8", maxBuffer: 1 << 29 });
  if (r.error) throw new UsageError(`git didn't run: ${r.error.message}`);
  if (r.status !== 0) {
    if (allowFail) return null;
    throw new UsageError(`git ${args[0]} failed: ${r.stderr.trim()}`);
  }
  return r.stdout;
}

/** Added lines with their line numbers in the new file, from a zero-context diff. */
export function addedLinesFromDiff(diff) {
  const out = [];
  let next = 0;
  for (const text of diff.split("\n")) {
    const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(text);
    if (hunk) next = Number(hunk[1]);
    else if (text.startsWith("+") && !text.startsWith("+++")) out.push({ line: next++, text: text.slice(1) });
  }
  return out;
}

const allLines = (text) => text.split(/\r?\n/).map((t, i) => ({ line: i + 1, text: t }));

function readAfter(root, path) {
  const full = join(root, path);
  if (!existsSync(full) || !statSync(full).isFile()) return null;
  return readFileSync(full, "utf8");
}

/** Every changed file between `mergeBase` and the working tree, untracked files included, ready for checkChange. */
function collectChange(root, mergeBase) {
  const entries = [];
  const tokens = git(["diff", "--name-status", "-z", "-M", "--no-ext-diff", mergeBase], root).split("\0").filter(Boolean);
  for (let i = 0; i < tokens.length; ) {
    const status = tokens[i];
    if (/^[RC]/.test(status)) {
      entries.push({ status: status[0], oldPath: tokens[i + 1], path: tokens[i + 2], tracked: true });
      i += 3;
    } else {
      entries.push({ status: status[0], path: tokens[i + 1], tracked: true });
      i += 2;
    }
  }
  for (const path of git(["ls-files", "--others", "--exclude-standard", "-z"], root).split("\0").filter(Boolean)) {
    entries.push({ status: "A", path, tracked: false });
  }

  const files = entries.map((e) => {
    if (!isRelevant(e.path) && !(e.oldPath && isRelevant(e.oldPath))) return { ...e, before: null, after: null, added: [] };
    const fromPath = e.status === "R" || e.status === "C" ? e.oldPath : e.path;
    const before = e.status === "A" && !e.oldPath ? null : git(["show", `${mergeBase}:${fromPath}`], root, { allowFail: true });
    const after = e.status === "D" ? null : readAfter(root, e.path);
    let added = [];
    if (after !== null && !after.includes("\u0000")) {
      added = e.tracked
        ? addedLinesFromDiff(git(["diff", "-U0", "--no-color", "--no-ext-diff", mergeBase, "--", e.path], root))
        : allLines(after);
    }
    return { ...e, before, after, added };
  });

  const locales = [];
  for (const dir of LOCALE_DIRS) {
    const full = join(root, dir);
    if (!existsSync(full)) continue;
    for (const name of readdirSync(full).filter((n) => n.endsWith(".json")).sort()) {
      locales.push({ path: `${dir}/${name}`, text: readFileSync(join(full, name), "utf8") });
    }
  }
  // The commits this change adds, for their messages (check 5). A record ends with \x1e; the hash and the message are
  // split by \x1f.
  const commits = git(["log", "--format=%H%x1f%B%x1e", `${mergeBase}..HEAD`], root)
    .split("\x1e")
    .map((r) => r.replace(/^\n/, ""))
    .filter((r) => r.includes("\x1f"))
    .map((r) => {
      const [sha, message] = r.split("\x1f");
      return { sha, message };
    });
  return { files, locales, commits };
}

function defaultBase(root) {
  for (const ref of ["origin/HEAD", "origin/main", "origin/master"]) {
    if (git(["rev-parse", "--verify", "--quiet", `${ref}^{commit}`], root, { allowFail: true })) return ref;
  }
  return null;
}

const USAGE = `Usage: node scripts/guard/check.mjs [--base <ref>] [--patterns <file>]

  --base <ref>       compare with the merge base of <ref> and HEAD (default: origin/HEAD, origin/main, origin/master)
  --patterns <file>  check docs/ and top-level Markdown for internal content patterns (one per line; # comments;
                     /regex/flags or plain text)
`;

function parseArgs(argv) {
  const opts = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") opts.help = true;
    else if (arg === "--base" || arg === "--patterns") {
      const value = argv[++i];
      if (!value || value.startsWith("--")) throw new UsageError(`${arg} needs a value`, { usage: true });
      opts[arg.slice(2)] = value;
    } else throw new UsageError(`unknown argument ${arg}`, { usage: true });
  }
  return opts;
}

export function main(argv, { cwd = process.cwd(), stdout = process.stdout, stderr = process.stderr } = {}) {
  try {
    const opts = parseArgs(argv);
    if (opts.help) {
      stdout.write(USAGE);
      return 0;
    }
    const root = git(["rev-parse", "--show-toplevel"], cwd).trim();
    let patterns = [];
    if (opts.patterns) {
      const file = resolve(cwd, opts.patterns);
      if (!existsSync(file)) throw new UsageError(`the patterns file ${opts.patterns} doesn't exist`);
      try {
        patterns = parsePatterns(readFileSync(file, "utf8"));
      } catch (err) {
        throw new UsageError(`the patterns file ${opts.patterns}: ${err.message}`, { cause: err });
      }
    }
    const base = opts.base ?? defaultBase(root);
    if (!base) throw new UsageError("found no base to compare with. Pass --base <ref>, for example --base origin/main");
    const mergeBase = git(["merge-base", base, "HEAD"], root, { allowFail: true })?.trim();
    if (!mergeBase) throw new UsageError(`can't find a merge base with ${base}. Fetch it, or pass another --base <ref>`);

    const change = collectChange(root, mergeBase);
    const problems = checkChange(change, { patterns });
    if (problems.length) {
      stderr.write(formatProblems(problems));
      return 1;
    }
    const docs = opts.patterns ? "" : " Docs were not checked for internal content (no --patterns file).";
    const against = mergeBase.startsWith(base) ? mergeBase.slice(0, 12) : `${base} (${mergeBase.slice(0, 12)})`;
    stdout.write(`guard: ok. ${change.files.length} changed files checked against ${against}.${docs}\n`);
    return 0;
  } catch (err) {
    if (!(err instanceof UsageError)) throw err;
    stderr.write(`guard: ${err.message}\n${err.usage ? `\n${USAGE}` : ""}`);
    return 2;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2));
}
