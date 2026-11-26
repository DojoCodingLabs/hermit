// The record job (record.mjs) against a real git remote (a bare repository on disk) and a stand-in for the GitHub CLI
// that logs every call: the branch, the data files, the table and the link. The job never calls the GitHub CLI at
// all: it doesn't open, read or approve pull requests (a maintainer opens one), and its link is always the compare page.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { fileURLToPath } from "node:url";
import { BRANCH, record } from "./record.mjs";
import { reportFileName } from "./validate.mjs";

const GOOD = JSON.parse(readFileSync(new URL("./fixtures/good-report.json", import.meta.url), "utf8"));
const DOC = fileURLToPath(new URL("../../docs/devices.md", import.meta.url));
const ID = ["-c", "user.name=Test", "-c", "user.email=test@localhost"];
const COMPARE = `https://github.com/o/r/compare/main...${BRANCH}`;

const git = (cwd, ...args) => execFileSync("git", [...ID, ...args], { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
const variant = (model, app = "0.1.0") => {
  const r = JSON.parse(JSON.stringify(GOOD));
  r.device.model = model;
  r.app = app;
  return r;
};
const body = (report) => ["### Report", "", "```json", JSON.stringify(report, null, 2), "```", "", "### Notes", "", "_No response_", "", "### Privacy", "", "- [X] This report contains no personal data", ""].join("\n");

// A GitHub CLI that answers like one with an open pull request from a branch named device-data (a fork can have one),
// and logs every call, so a test can prove nothing ever asked it.
const FAKE_GH = `
import { appendFileSync } from "node:fs";
const args = process.argv.slice(2);
appendFileSync(process.env.FAKE_GH_CALLS, JSON.stringify(args) + "\\n");
process.stdout.write(JSON.stringify([{ url: "https://github.com/o/r/pull/666", headRefName: "device-data" }]));
`;

/** A remote with a default branch holding docs/devices.md, a shallow checkout of it, and the stand-in CLI on PATH. */
function world() {
  const root = mkdtempSync(join(tmpdir(), "hermit-record-"));
  const origin = join(root, "origin.git");
  const url = `file://${origin}`;
  execFileSync("git", ["init", "-q", "--bare", "-b", "main", origin]);
  const seed = join(root, "seed");
  execFileSync("git", ["clone", "-q", url, seed], { stdio: "ignore" });
  mkdirSync(join(seed, "docs"));
  copyFileSync(DOC, join(seed, "docs", "devices.md"));
  git(seed, "add", ".");
  git(seed, "commit", "-q", "-m", "docs");
  git(seed, "push", "-q", "origin", "HEAD:main");
  const bin = join(root, "bin");
  mkdirSync(bin);
  writeFileSync(join(bin, "fake-gh.mjs"), FAKE_GH);
  writeFileSync(join(bin, "gh"), `#!/bin/sh\nexec "${process.execPath}" "${join(bin, "fake-gh.mjs")}" "$@"\n`);
  chmodSync(join(bin, "gh"), 0o755);
  const calls = join(root, "gh-calls.jsonl");
  writeFileSync(calls, "");
  const env = { PATH: `${bin}${delimiter}${process.env.PATH}`, FAKE_GH_CALLS: calls };
  const checkout = () => {
    const dir = mkdtempSync(join(root, "checkout-"));
    execFileSync("git", ["clone", "-q", "--depth=1", url, dir], { stdio: "ignore" });
    return dir;
  };
  let events = 0;
  const file = (n, report) => {
    const p = join(root, `event-${events++}.json`);
    writeFileSync(p, JSON.stringify({ issue: { number: n, body: body(report) } }));
    return p;
  };
  const ghCalls = () => readFileSync(calls, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
  const branchFiles = () => {
    const dir = mkdtempSync(join(root, "look-"));
    execFileSync("git", ["clone", "-q", "-b", BRANCH, url, dir], { stdio: "ignore" });
    return { files: readdirSync(join(dir, "data", "devices")).sort(), doc: readFileSync(join(dir, "docs", "devices.md"), "utf8"), log: git(dir, "log", "--format=%s", "origin/main..HEAD") };
  };
  return { root, seed, url, env, checkout, file, ghCalls, branchFiles };
}

/** record() with the stand-in CLI on PATH and no waiting between tries. */
function recordIn(w, issue, report) {
  const env = w.env;
  const saved = Object.fromEntries(Object.keys(env).map((k) => [k, process.env[k]]));
  Object.assign(process.env, env);
  try {
    return record({ issue, base: "main", repo: "o/r", eventPath: w.file(issue, report), temp: mkdtempSync(join(w.root, "temp-")), cwd: w.checkout(), wait: () => {} });
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

/** A maintainer brings device-data into main: a merge (fast-forward) or a squash (one new commit with the same files). */
function mergeIntoMain(w, how) {
  git(w.seed, "fetch", "-q", "origin", "main", BRANCH);
  git(w.seed, "checkout", "-q", "-B", "main", "origin/main");
  if (how === "merge") git(w.seed, "merge", "-q", "--ff-only", `origin/${BRANCH}`);
  else {
    git(w.seed, "merge", "-q", "--squash", `origin/${BRANCH}`);
    git(w.seed, "commit", "-q", "-m", "Device reports (squashed)");
  }
  git(w.seed, "push", "-q", "origin", "HEAD:main");
}

test("reports go onto the device-data branch, and the link is always the compare page; the GitHub CLI is never called", () => {
  const w = world();
  try {
    assert.deepEqual(recordIn(w, 1, GOOD), { changed: true, url: COMPARE });
    const other = variant("EX-2000");
    assert.deepEqual(recordIn(w, 2, other), { changed: true, url: COMPARE });
    const look = w.branchFiles();
    assert.deepEqual(look.files, [reportFileName(GOOD), reportFileName(other)].sort());
    assert.match(look.doc, /\| Examplecorp EX-1000 \|/);
    assert.match(look.doc, /\| Examplecorp EX-2000 \|/);
    assert.deepEqual(look.log.split("\n"), ["Device report from issue #2", "Device report from issue #1"]);
    // The GitHub CLI was never called: no pull request is opened, read, edited or approved.
    assert.deepEqual(w.ghCalls(), []);
    // The same report again (an edit to the notes): nothing new, no commit, no comment.
    assert.deepEqual(recordIn(w, 2, other), { changed: false });
    assert.equal(w.branchFiles().log.split("\n").length, 2);
  } finally {
    rmSync(w.root, { recursive: true, force: true });
  }
});

test("an open pull request from any branch named device-data, a fork's included, never becomes the link", () => {
  const w = world();
  try {
    // The stand-in CLI would answer with a fork's pull request if anything asked it.
    assert.deepEqual(recordIn(w, 1, GOOD), { changed: true, url: COMPARE });
    assert.deepEqual(recordIn(w, 2, variant("EX-2000")), { changed: true, url: COMPARE });
    assert.deepEqual(w.ghCalls(), []);
  } finally {
    rmSync(w.root, { recursive: true, force: true });
  }
});

test("an edited report replaces the one its issue filed", () => {
  const w = world();
  try {
    recordIn(w, 7, GOOD);
    const edited = variant("EX-1000", "0.1.1");
    recordIn(w, 7, edited);
    assert.deepEqual(w.branchFiles().files, [reportFileName(edited)]);
  } finally {
    rmSync(w.root, { recursive: true, force: true });
  }
});

for (const how of ["merge", "squash"]) {
  test(`once every report on the branch is in the default branch (${how}), the branch starts again from it`, () => {
    const w = world();
    try {
      recordIn(w, 1, GOOD);
      mergeIntoMain(w, how);
      const next = variant("EX-3000");
      assert.deepEqual(recordIn(w, 3, next), { changed: true, url: COMPARE });
      const look = w.branchFiles();
      assert.deepEqual(look.log.split("\n"), ["Device report from issue #3"]);
      assert.deepEqual(look.files, [reportFileName(GOOD), reportFileName(next)].sort());
    } finally {
      rmSync(w.root, { recursive: true, force: true });
    }
  });
}

test("reports still waiting on the branch are never replaced: a new one goes on top of them", () => {
  const w = world();
  try {
    // Issue 4's report waits on the branch: nobody has merged it (or its pull request was closed without merging).
    const theirs = mkdtempSync(join(w.root, "theirs-"));
    execFileSync("git", ["clone", "-q", w.url, theirs], { stdio: "ignore" });
    mkdirSync(join(theirs, "data", "devices"), { recursive: true });
    const first = variant("EX-4000");
    writeFileSync(join(theirs, "data", "devices", reportFileName(first)), `${JSON.stringify({ issue: 4, report: first }, null, 2)}\n`);
    git(theirs, "add", ".");
    git(theirs, "commit", "-q", "-m", "Device report from issue #4");
    git(theirs, "push", "-q", "origin", `HEAD:${BRANCH}`);
    recordIn(w, 5, GOOD);
    const look = w.branchFiles();
    assert.deepEqual(look.log.split("\n"), ["Device report from issue #5", "Device report from issue #4"]);
    assert.deepEqual(look.files, [reportFileName(first), reportFileName(GOOD)].sort());
  } finally {
    rmSync(w.root, { recursive: true, force: true });
  }
});

test("a push that loses a race is tried again on top of the winner", () => {
  const w = world();
  try {
    recordIn(w, 1, GOOD);
    // The remote refuses the next push once, the way a push that lost the race to another run fails.
    const hook = join(w.root, "origin.git", "hooks", "pre-receive");
    const marker = join(w.root, "refuse-once");
    writeFileSync(marker, "");
    writeFileSync(hook, `#!/bin/sh\nif [ -f "${marker}" ]; then rm "${marker}"; echo "lost the race" >&2; exit 1; fi\n`);
    chmodSync(hook, 0o755);
    const other = variant("EX-6000");
    assert.deepEqual(recordIn(w, 6, other), { changed: true, url: COMPARE });
    // The remote did refuse the first try, and the second one landed.
    assert.equal(existsSync(marker), false);
    assert.deepEqual(w.branchFiles().files, [reportFileName(GOOD), reportFileName(other)].sort());
  } finally {
    rmSync(w.root, { recursive: true, force: true });
  }
});

test("only a valid report from the form is recorded", () => {
  const w = world();
  try {
    assert.throws(() => recordIn(w, 8, { ...GOOD, serial: "TEST-SERIAL-0000" }), /doesn't pass/);
    assert.throws(() => recordIn(w, "8; rm -rf /", GOOD), /not a number/);
  } finally {
    rmSync(w.root, { recursive: true, force: true });
  }
});
