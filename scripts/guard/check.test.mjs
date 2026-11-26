// Tests for the PR guard. Run them with `node --test scripts/guard/check.test.mjs`.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import process from "node:process";
import { fileURLToPath, URL } from "node:url";
import {
  checkChange,
  deniedPackage,
  findAiAttribution,
  findDashesInLocale,
  findInternalContent,
  findLocaleParityProblems,
  findTelemetryInLockfile,
  findTelemetryInManifest,
  findTelemetryInNativeBuild,
  parsePatterns,
} from "./check.mjs";

const json = (value) => JSON.stringify(value, null, 2);
const lines = (...texts) => texts.map((text, i) => ({ line: i + 1, text }));

describe("telemetry in package.json", () => {
  test("flags an analytics SDK added to dependencies, and names the field", () => {
    const after = json({ dependencies: { react: "19.3.0", "@sentry/react-native": "6.0.0" } });
    const problems = findTelemetryInManifest("apps/mobile/package.json", json({ dependencies: { react: "19.3.0" } }), after);
    assert.equal(problems.length, 1);
    assert.equal(problems[0].check, "telemetry");
    assert.equal(problems[0].path, "apps/mobile/package.json");
    assert.match(problems[0].message, /@sentry\/react-native/);
    assert.match(problems[0].message, /dependencies/);
  });

  test("reads every dependency field", () => {
    const after = json({
      devDependencies: { "posthog-node": "1.0.0" },
      optionalDependencies: { "mixpanel-browser": "1.0.0" },
      peerDependencies: { "@amplitude/analytics-react-native": "1.0.0" },
    });
    assert.equal(findTelemetryInManifest("package.json", null, after).length, 3);
  });

  test("a clean manifest passes", () => {
    const after = json({ dependencies: { react: "19.3.0", "@noble/curves": "2.4.0" }, devDependencies: { typescript: "6.0.3" } });
    assert.deepEqual(findTelemetryInManifest("package.json", null, after), []);
  });

  test("only what the change adds counts: a dependency already on the base is not reported again", () => {
    const before = json({ dependencies: { "posthog-js": "1.0.0" } });
    const after = json({ dependencies: { "posthog-js": "1.2.0", react: "19.3.0" } });
    assert.deepEqual(findTelemetryInManifest("package.json", before, after), []);
  });

  test("catches npm aliases, including an alias swapped in under a name that was already there", () => {
    const fresh = findTelemetryInManifest("package.json", null, json({ dependencies: { "totally-harmless": "npm:@sentry/react-native@6.0.0" } }));
    assert.equal(fresh.length, 1);
    assert.match(fresh[0].message, /totally-harmless/);
    assert.match(fresh[0].message, /@sentry\/react-native/);
    const swapped = findTelemetryInManifest(
      "package.json",
      json({ dependencies: { "left-pad": "1.3.0" } }),
      json({ dependencies: { "left-pad": "npm:posthog-js@1.0.0" } }),
    );
    assert.equal(swapped.length, 1);
  });

  test("catches git and tarball sources that point at a telemetry SDK", () => {
    const after = json({
      dependencies: {
        a: "github:PostHog/posthog-js",
        b: "git+https://github.com/getsentry/sentry-javascript.git",
        c: "https://registry.example.com/mixpanel-react-native-2.0.0.tgz",
        d: "github:example/left-pad",
      },
    });
    const names = findTelemetryInManifest("package.json", null, after).map((p) => /adds "([^"]+)"/.exec(p.message)?.[1]);
    assert.deepEqual(names, ["a", "b", "c"]);
  });

  test("catches telemetry pulled in through overrides", () => {
    const after = json({ pnpm: { overrides: { "left-pad": "npm:@bugsnag/js@8.0.0" } } });
    assert.equal(findTelemetryInManifest("package.json", null, after).length, 1);
  });

  test("a manifest that isn't valid JSON fails closed", () => {
    const problems = findTelemetryInManifest("package.json", null, "{ not json");
    assert.equal(problems.length, 1);
    assert.match(problems[0].message, /not valid JSON/);
  });
});

describe("the denylist", () => {
  test("covers the common analytics, crash, session replay, attribution and ads SDKs", () => {
    const denied = [
      "posthog-js", "posthog-react-native", "@posthog/ai", "@sentry/react-native", "@sentry/node", "sentry-expo", "raven-js",
      "@segment/analytics-react-native", "analytics-node", "mixpanel-browser", "mixpanel-react-native", "@amplitude/analytics-browser",
      "amplitude-js", "@datadog/mobile-react-native", "dd-trace", "firebase", "@firebase/analytics",
      "@react-native-firebase/analytics", "@react-native-firebase/crashlytics", "@bugsnag/react-native", "newrelic",
      "@newrelic/browser-agent", "appcenter", "appcenter-analytics", "appcenter-crashes", "rollbar", "logrocket",
      "@logrocket/react-native", "instabug-reactnative", "react-native-appsflyer", "@rudderstack/rudder-sdk-react-native",
      "@heap/react-native-heap", "@fullstory/react-native", "@hotjar/browser", "smartlook-react-native-wrapper",
      "@embrace-io/react-native", "@vercel/analytics", "@vercel/speed-insights", "expo-insights", "react-ga4",
      "@microsoft/applicationinsights-web", "@opentelemetry/exporter-trace-otlp-http", "@grafana/faro-web-sdk",
      "react-native-google-mobile-ads", "react-native-fbsdk-next", "react-native-adjust", "react-native-branch",
      "@statsig/js-client", "@aptabase/react-native", "plausible-tracker", "@vscode/extension-telemetry",
    ];
    for (const name of denied) assert.ok(deniedPackage(name), name);
  });

  test("doesn't flag look-alikes", () => {
    const allowed = [
      "react", "heap-js", "@opentelemetry/api", "web-vitals", "posthtml", "sentence-splitter", "@formatjs/intl-segmenter",
      "amplitude-normalizer", "@noble/curves", "@op-engineering/op-sqlite", "expo-notifications", "@qvac/sdk",
    ];
    for (const name of allowed) assert.ok(!deniedPackage(name), name);
  });
});

describe("telemetry in lockfiles", () => {
  test("flags a telemetry package that a pnpm lockfile now resolves, once per name, with its line", () => {
    const added = [
      { line: 10, text: "  '@noble/curves@2.4.0':" },
      { line: 20, text: "  '@sentry/core@8.0.0':" },
      { line: 30, text: "  posthog-js@1.200.0:" },
      { line: 40, text: "  'posthog-react-native@4.0.0(react@19.3.0)':" },
      { line: 50, text: "  '@sentry/core@8.0.0':" },
      { line: 60, text: "      resolution: {integrity: sha512-abc}" },
    ];
    const problems = findTelemetryInLockfile("pnpm-lock.yaml", added);
    assert.deepEqual(problems.map((p) => p.line), [20, 30, 40]);
    assert.match(problems[0].message, /@sentry\/core/);
  });

  test("reads npm lockfiles too, nested node_modules included", () => {
    const added = [
      { line: 3, text: '    "node_modules/react": {' },
      { line: 9, text: '    "node_modules/@sentry/core": {' },
      { line: 15, text: '    "node_modules/a/node_modules/mixpanel-browser": {' },
    ];
    const problems = findTelemetryInLockfile("packages/x/package-lock.json", added);
    assert.deepEqual(problems.map((p) => p.line), [9, 15]);
  });
});

describe("telemetry in native build files", () => {
  test("flags Gradle dependencies and plugins for crash reporting and analytics", () => {
    const bad = [
      'implementation "io.sentry:sentry-android:7.0.0"',
      "implementation 'com.google.firebase:firebase-analytics:22.1.0'",
      "id 'com.google.firebase.crashlytics'",
      "apply plugin: 'com.google.gms.google-services'",
      'implementation("com.google.android.gms:play-services-measurement-api:22.1.0")',
      'implementation "com.google.android.gms:play-services-ads:23.0.0"',
      'implementation "com.bugsnag:bugsnag-android:6.0.0"',
      'implementation "com.microsoft.appcenter:appcenter-analytics:5.0.0"',
    ];
    for (const text of bad) assert.equal(findTelemetryInNativeBuild("m/android/build.gradle", [{ line: 1, text }]).length, 1, text);
  });

  test("lets ordinary Android dependencies through, the SMS consent API included", () => {
    const ok = lines(
      'implementation "androidx.webkit:webkit:1.12.1"',
      'implementation "com.google.android.gms:play-services-auth-api-phone:18.1.0"',
      'implementation "net.zetetic:sqlcipher-android:4.6.1"',
    );
    assert.deepEqual(findTelemetryInNativeBuild("m/android/build.gradle", ok), []);
  });

  test("flags iOS pods and Swift packages", () => {
    assert.equal(findTelemetryInNativeBuild("ios/Podfile", lines("  pod 'Sentry', '~> 8.0'", "  pod 'SQLCipher'")).length, 1);
    const swift = lines('.package(url: "https://github.com/getsentry/sentry-cocoa", from: "8.0.0")');
    assert.equal(findTelemetryInNativeBuild("Package.swift", swift).length, 1);
  });
});

describe("dashes in copy", () => {
  const path = "packages/copy/locales/en.json";

  test("flags an em dash in a new key and an en dash in a changed value", () => {
    const before = json({ "common.a": "Plain", "common.b": "Old text" });
    const after = json({ "common.a": "Plain", "common.b": "Pages 1\u20132", "common.c": "Private \u2014 always" });
    const problems = findDashesInLocale(path, before, after);
    assert.equal(problems.length, 2);
    assert.match(problems[0].message, /common\.b/);
    assert.match(problems[0].message, /en dash/);
    assert.match(problems[1].message, /common\.c/);
    assert.match(problems[1].message, /em dash/);
  });

  test("flags look-alike dashes too, and leaves hyphens alone", () => {
    const after = json({
      "common.figure": "1\u20122",
      "common.bar": "\u2015 quote",
      "common.twoEm": "wait\u2E3A",
      "common.hyphen": "Wi-Fi, e-mail and sign-in",
    });
    const flagged = findDashesInLocale(path, null, after).map((p) => p.message);
    assert.equal(flagged.length, 3);
    assert.ok(flagged.every((m) => !m.includes("common.hyphen")));
  });

  test("a value the change didn't touch isn't reported", () => {
    const before = json({ "common.old": "Already \u2014 here" });
    const after = json({ "common.old": "Already \u2014 here", "common.new": "Clean" });
    assert.deepEqual(findDashesInLocale(path, before, after), []);
  });

  test("reads nested objects by their dotted path", () => {
    const problems = findDashesInLocale(path, null, json({ common: { nested: "a \u2014 b" } }));
    assert.equal(problems.length, 1);
    assert.match(problems[0].message, /common\.nested/);
  });

  test("a locale file that isn't valid JSON fails closed", () => {
    assert.match(findDashesInLocale(path, null, '{"common.a": "x",}')[0].message, /not valid JSON/);
  });
});

describe("locale parity", () => {
  const en = (dict) => ({ path: "packages/copy/locales/en.json", text: json(dict) });
  const es = (dict) => ({ path: "packages/copy/locales/es-419.json", text: json(dict) });

  test("the same keys and placeholders pass", () => {
    const problems = findLocaleParityProblems([
      en({ "common.retry": "Try again", "common.when.minutes": "{n} min ago" }),
      es({ "common.retry": "Intentar de nuevo", "common.when.minutes": "Hace {n} min" }),
    ]);
    assert.deepEqual(problems, []);
  });

  test("a key missing from one locale fails, whichever side it is on", () => {
    const missingInEs = findLocaleParityProblems([en({ "common.a": "A", "common.b": "B" }), es({ "common.a": "A" })]);
    assert.equal(missingInEs.length, 1);
    assert.equal(missingInEs[0].path, "packages/copy/locales/es-419.json");
    assert.match(missingInEs[0].message, /common\.b/);
    const missingInEn = findLocaleParityProblems([en({ "common.a": "A" }), es({ "common.a": "A", "common.c": "C" })]);
    assert.equal(missingInEn.length, 1);
    assert.equal(missingInEn[0].path, "packages/copy/locales/en.json");
  });

  test("placeholders must match key by key", () => {
    const problems = findLocaleParityProblems([en({ "common.hi": "Hi {name}" }), es({ "common.hi": "Hola {nombre}" })]);
    assert.equal(problems.length, 1);
    assert.match(problems[0].message, /common\.hi/);
    assert.match(problems[0].message, /\{name\}/);
  });

  test("works with more than two locales", () => {
    const pt = { path: "packages/copy/locales/pt-BR.json", text: json({ "common.a": "A" }) };
    const problems = findLocaleParityProblems([en({ "common.a": "A", "common.b": "B" }), es({ "common.a": "A", "common.b": "B" }), pt]);
    assert.equal(problems.length, 1);
    assert.equal(problems[0].path, "packages/copy/locales/pt-BR.json");
  });

  test("a long list of missing keys is cut short in the message", () => {
    const many = Object.fromEntries(Array.from({ length: 30 }, (_, i) => [`common.k${i}`, "x"]));
    const [problem] = findLocaleParityProblems([en(many), es({})]);
    assert.match(problem.message, /30 keys/);
    assert.match(problem.message, /and 20 more/);
  });
});

describe("internal content patterns", () => {
  test("comments and blank lines are skipped; slashes make a regular expression; anything else is plain text", () => {
    const patterns = parsePatterns("# a comment\n\n/\\bcodename-\\d+\\b/i\nproject bluebird\nnotes.internal\n");
    assert.equal(patterns.length, 3);
    assert.ok(patterns[0].regex.test("see CODENAME-12 here"));
    assert.ok(patterns[1].regex.test("Project Bluebird says hi"));
    assert.ok(patterns[2].regex.test("from notes.internal"));
    assert.ok(!patterns[2].regex.test("from notesXinternal"), "plain text is literal, so a dot is only a dot");
    assert.equal(patterns[1].number, 4, "a pattern is numbered by its line in the file");
  });

  test("a broken regular expression names its line", () => {
    assert.throws(() => parsePatterns("ok\n/(unclosed/\n"), /line 2/);
  });

  test("flags each added line that matches, by line and pattern number", () => {
    const patterns = parsePatterns("project bluebird\n/\\bcodename-\\d+\\b/i\n");
    const problems = findInternalContent("docs/guide.md", lines("Fine text.", "As Project Bluebird decided.", "See codename-7."), patterns);
    assert.deepEqual(problems.map((p) => [p.line, p.message.includes("pattern 1"), p.message.includes("pattern 2")]), [
      [2, true, false],
      [3, false, true],
    ]);
  });
});

describe("the shipped patterns file", () => {
  const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
  const shipped = parsePatterns(read("./patterns.txt"));
  const hits = (text) => shipped.filter((p) => p.regex.test(text)).map((p) => p.number);
  // The samples are built from pieces, so this file never matches the patterns itself.
  const at = "@";

  test("the Guard workflow passes it, and every line is a pattern the guard can read", () => {
    assert.match(read("../../.github/workflows/guard.yml"), /--patterns scripts\/guard\/patterns\.txt/);
    assert.ok(shipped.length >= 30, `${shipped.length} patterns`);
  });

  test("catches narration, transcripts, run logs, personal data, local paths and secrets", () => {
    for (const text of [
      "Resolved 2026-11-25 by the " + "founder.",
      "The " + "founder asked for a dark mode.",
      "As she put it, in her own " + "words: no.",
      "User" + ": what time is it?",
      "- 2026-11-24 21:12 (" + "abc1234): eval run",
      "Write to ana" + at + "dojocoding.io",
      "see /Users" + "/someone/project",
      "-----BEGIN OPENSSH " + "PRIVATE KEY-----",
      "the token is gh" + "p_" + "a".repeat(36),
    ]) assert.ok(hits(text).length > 0, text);
  });

  test("lets neutral decisions and ordinary docs through", () => {
    for (const text of [
      "Resolved 2026-11-25: bots message each other directly, with loop guards.",
      "Run `pnpm test` from the repository root.",
      "Write to privacy" + at + "dojocoding.io for data requests.",
      "CI checks out the code in /home/runner/work.",
      "The owner of a vault item is the phone that made it.",
    ]) assert.deepEqual(hits(text), [], text);
  });
});

describe("checkChange", () => {
  const file = (status, path, before, after, added = []) => ({ status, path, before, after, added });

  test("runs each check on the files it is about, and reads docs only with a patterns file", () => {
    const patterns = parsePatterns("project bluebird\n");
    const files = [
      file("M", "package.json", json({}), json({ dependencies: { "posthog-js": "1.0.0" } })),
      file("M", "packages/copy/locales/en.json", json({ "common.a": "A" }), json({ "common.a": "A \u2014 B" })),
      file("A", "docs/notes.md", null, "Project Bluebird\n", lines("Project Bluebird")),
      file("A", "README.md", null, "Project Bluebird\n", lines("Project Bluebird")),
      file("A", "apps/site/notes.md", null, "Project Bluebird\n", lines("Project Bluebird")),
    ];
    const locales = [
      { path: "packages/copy/locales/en.json", text: json({ "common.a": "A \u2014 B" }) },
      { path: "packages/copy/locales/es-419.json", text: json({ "common.a": "A" }) },
    ];
    const withPatterns = checkChange({ files, locales }, { patterns });
    assert.deepEqual(withPatterns.map((p) => `${p.check} ${p.path}`), [
      "telemetry package.json",
      "copy dash packages/copy/locales/en.json",
      "internal content README.md",
      "internal content docs/notes.md",
    ]);
    const withoutPatterns = checkChange({ files, locales }, {});
    assert.ok(withoutPatterns.every((p) => p.check !== "internal content"));
  });

  test("checks parity only when the change touches a locale, and a removed locale fails", () => {
    const broken = [
      { path: "packages/copy/locales/en.json", text: json({ "common.a": "A", "common.b": "B" }) },
      { path: "packages/copy/locales/es-419.json", text: json({ "common.a": "A" }) },
    ];
    assert.deepEqual(checkChange({ files: [file("M", "src/x.ts", "a", "b")], locales: broken }, {}), []);
    const touched = checkChange({ files: [file("M", "packages/copy/locales/en.json", json({ "common.a": "A" }), broken[0].text)], locales: broken }, {});
    assert.deepEqual(touched.map((p) => p.check), ["locale parity"]);
    const removed = checkChange({ files: [file("D", "packages/copy/locales/es-419.json", broken[1].text, null)], locales: [broken[0]] }, {});
    assert.deepEqual(removed.map((p) => p.check), ["locale parity"]);
    assert.match(removed[0].message, /removed/);
  });
});

describe("AI co-author trailers", () => {
  const commit = (message) => ({ sha: "a1b2c3d4e5f6a7b8", message });

  test("an AI co-author trailer or an AI tool's footer is flagged, once per commit", () => {
    for (const message of [
      "Add the table\n\nCo-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>",
      "Add the table\n\nCo-authored-by: Claude <noreply@anthropic.com>",
      "Add the table\n\nCo-authored-by: Copilot <198982749+Copilot@users.noreply.github.com>",
      "Add the table\n\nCo-authored-by: Cursor Agent <cursoragent@cursor.com>",
      "Add the table\n\n\u{1F916} Generated with [Claude Code](https://claude.com/claude-code)",
      "Add the table\n\nCo-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>\nCo-authored-by: Copilot <copilot@github.com>",
    ]) {
      const problems = findAiAttribution([commit(message)]);
      assert.equal(problems.length, 1, message);
      assert.equal(problems[0].check, "ai co-author");
      assert.equal(problems[0].path, "commit a1b2c3d4e5f6");
      assert.match(problems[0].message, /pull request's description/);
    }
  });

  test("people, sign-offs and messages that only mention a tool pass", () => {
    for (const message of [
      "Add the table\n\nCo-authored-by: Claude Dupont <claude@example.fr>",
      "Add the table\n\nCo-authored-by: Ana Prueba <123+anaprueba@users.noreply.github.com>",
      "Add the table\n\nSigned-off-by: Ana Prueba <ana@example.org>",
      "Explain how to turn off Copilot's co-author line in CONTRIBUTING.md",
    ]) {
      assert.deepEqual(findAiAttribution([commit(message)]), [], message);
    }
  });

  test("checkChange reports it with the other checks", () => {
    const problems = checkChange({ files: [], commits: [commit("x\n\nCo-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>")] }, {});
    assert.deepEqual(problems.map((p) => p.check), ["ai co-author"]);
  });
});

describe("the command line, on a real git repository", () => {
  const script = fileURLToPath(new URL("./check.mjs", import.meta.url));

  function repo() {
    const dir = mkdtempSync(join(tmpdir(), "hermit-guard-"));
    const hooks = join(dir, ".no-hooks");
    mkdirSync(hooks);
    const git = (...args) =>
      execFileSync("git", ["-c", "user.name=Guard Test", "-c", "user.email=guard@example.com", "-c", "commit.gpgsign=false", "-c", `core.hooksPath=${hooks}`, ...args], {
        cwd: dir,
        stdio: "pipe",
      });
    const write = (path, text) => {
      mkdirSync(dirname(join(dir, path)), { recursive: true });
      writeFileSync(join(dir, path), text);
    };
    const run = (...args) => spawnSync(process.execPath, [script, ...args], { cwd: dir, encoding: "utf8" });
    git("init", "-q", "-b", "main");
    write(".gitignore", ".no-hooks/\n");
    write("package.json", json({ name: "fixture", dependencies: { react: "19.3.0" } }));
    write("packages/copy/locales/en.json", json({ "common.retry": "Try again" }));
    write("packages/copy/locales/es-419.json", json({ "common.retry": "Intentar de nuevo" }));
    write("docs/guide.md", "# Guide\n");
    git("add", "-A");
    git("commit", "-q", "-m", "base");
    git("checkout", "-q", "-b", "change");
    return { dir, git, write, run, done: () => rmSync(dir, { recursive: true, force: true }) };
  }

  test("a commit that credits an AI tool fails until it's amended", () => {
    const r = repo();
    try {
      r.write("docs/guide.md", "# Guide\n\nMore words.\n");
      r.git("commit", "-q", "-am", "docs\n\nCo-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>");
      const out = r.run("--base", "main");
      assert.equal(out.status, 1, out.stdout);
      assert.match(out.stderr, /ai co-author: commit [0-9a-f]{12}: credits an AI tool/);
      r.git("commit", "-q", "--amend", "-m", "docs");
      const after = r.run("--base", "main");
      assert.equal(after.status, 0, after.stderr);
    } finally {
      r.done();
    }
  });

  test("a clean change passes", () => {
    const r = repo();
    try {
      r.write("docs/guide.md", "# Guide\n\nMore words.\n");
      r.git("commit", "-q", "-am", "docs");
      const out = r.run("--base", "main");
      assert.equal(out.status, 0, out.stderr);
      assert.match(out.stdout, /guard: ok/);
    } finally {
      r.done();
    }
  });

  test("a change with a tracker, a dash, a missing key and internal text fails, committed or not", () => {
    const r = repo();
    try {
      r.write("package.json", json({ name: "fixture", dependencies: { react: "19.3.0", "@sentry/react-native": "6.0.0" } }));
      r.write("packages/copy/locales/en.json", json({ "common.retry": "Try again", "common.note": "Saved \u2014 for now" }));
      r.git("commit", "-q", "-am", "change");
      r.write("docs/new-page.md", "Project Bluebird decided this.\n");
      r.write("patterns.txt", "project bluebird\n");
      const out = r.run("--base", "main", "--patterns", "patterns.txt");
      assert.equal(out.status, 1, out.stdout);
      assert.match(out.stderr, /telemetry: package\.json/);
      assert.match(out.stderr, /copy dash: packages\/copy\/locales\/en\.json/);
      assert.match(out.stderr, /locale parity: packages\/copy\/locales\/es-419\.json/);
      assert.match(out.stderr, /internal content: docs\/new-page\.md:1/);
    } finally {
      r.done();
    }
  });

  test("an unknown base or a missing patterns file is a usage error, not a pass", () => {
    const r = repo();
    try {
      assert.equal(r.run("--base", "no-such-branch").status, 2);
      assert.equal(r.run("--base", "main", "--patterns", "missing.txt").status, 2);
    } finally {
      r.done();
    }
  });
});
