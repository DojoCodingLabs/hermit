#!/usr/bin/env node
// Fails the build if any workspace package depends on analytics, crash reporting
// or a hosted login broker. "Tells no one" has to be mechanically true.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const DENY = [
  /^@sentry\//, /^sentry-/, /^@posthog\//, /^posthog-/, /^@segment\//, /^analytics-react-native/,
  /^firebase$/, /^@firebase\//, /^@react-native-firebase\/(analytics|crashlytics|perf)/,
  /^@react-native-google-signin\//, /^composio-/, /^@composio\//, /^@bugsnag\//, /^bugsnag/,
  /^@datadog\//, /^@amplitude\//, /^amplitude-/, /^mixpanel/, /^@mixpanel\//,
  /^expo-insights$/, /^@react-native-firebase\/app$/, /^rollbar/, /^logrocket/, /^@logrocket\//,
  /^instabug/, /^@instabug\//, /appsflyer/, /^@rudderstack\//, /^newrelic/, /^@newrelic\//,
];
const denied = (name) => DENY.some((re) => re.test(name));
const FIELDS = ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"];

export function findPrivacyViolations(manifests) {
  const out = [];
  for (const { path, json } of manifests) {
    for (const field of FIELDS) {
      for (const [dep, spec] of Object.entries(json[field] ?? {})) {
        if (denied(dep)) out.push({ path, dep });
        // An npm alias ("x": "npm:@sentry/react-native@6") installs the real package under another name.
        const alias = typeof spec === "string" && spec.startsWith("npm:") ? spec.slice(4).replace(/@[^@/]*$/, "") : null;
        if (alias && denied(alias)) out.push({ path, dep: `${dep} -> ${alias}` });
      }
    }
  }
  return out;
}

/** Every resolved package in a pnpm lockfile, so indirect dependencies can't sneak in. */
export function findLockfileViolations(lockText) {
  const names = new Set();
  const section = lockText.split(/^packages:\s*$/m)[1]?.split(/^\S/m)[0] ?? "";
  for (const m of section.matchAll(/^ {2}'?(@?[^@'\s/]+(?:\/[^@'\s]+)?)@/gm)) names.add(m[1]);
  return [...names].filter(denied).sort();
}

// Native modules' Gradle artifacts (group:name): analytics, crash reporting and Google Sign-In. Google's SMS User
// Consent API (play-services-auth-api-phone, SL-56b) is the SMS retriever only, so it is not play-services-auth.
const GRADLE_DENY = [
  /^com\.google\.firebase:firebase-(analytics|crashlytics|perf|appdistribution)/, /^com\.google\.android\.gms:play-services-measurement/,
  /^com\.google\.android\.gms:play-services-analytics/, /^com\.google\.android\.gms:play-services-auth$/, /^io\.sentry:/,
  /^com\.bugsnag:/, /^com\.datadoghq:/, /^com\.amplitude:/, /^com\.mixpanel/, /^com\.appsflyer:/, /^com\.instabug/, /^com\.newrelic/,
  /^com\.segment/, /^com\.posthog/, /^io\.logrocket/,
];

/** Every `group:name` a Gradle file depends on that is denied. */
export function findGradleViolations(files) {
  const out = [];
  for (const { path, text } of files) {
    for (const m of text.matchAll(/["']([\w.-]+:[\w.-]+)(?::[^"']*)?["']/g)) {
      if (GRADLE_DENY.some((re) => re.test(m[1]))) out.push({ path, dep: m[1] });
    }
  }
  return out;
}

function collectGradle(dir, root, acc = []) {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name.startsWith(".")) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) collectGradle(p, root, acc);
    else if (name === "build.gradle" || name === "build.gradle.kts") acc.push({ path: relative(root, p), text: readFileSync(p, "utf8") });
  }
  return acc;
}

function collect(dir, root, acc = []) {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name.startsWith(".")) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) collect(p, root, acc);
    else if (name === "package.json") acc.push({ path: relative(root, p), json: JSON.parse(readFileSync(p, "utf8")) });
  }
  return acc;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const root = fileURLToPath(new URL("..", import.meta.url));
  const violations = findPrivacyViolations(collect(root, root));
  for (const v of violations) console.error(`privacy: ${v.path} depends on ${v.dep}`);
  const lockPath = join(root, "pnpm-lock.yaml");
  const indirect = existsSync(lockPath) ? findLockfileViolations(readFileSync(lockPath, "utf8")) : [];
  for (const name of indirect) console.error(`privacy: pnpm-lock.yaml resolves ${name}`);
  const gradle = findGradleViolations(collectGradle(root, root));
  for (const v of gradle) console.error(`privacy: ${v.path} depends on ${v.dep}`);
  if (violations.length || indirect.length || gradle.length) process.exit(1);
  console.log("privacy: no analytics, crash reporting or login brokers found");
}
