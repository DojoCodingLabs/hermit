// The record job (record.mjs) against a real git remote (a bare repository on disk) and a stand-in for the GitHub CLI
// that keeps pull requests in a JSON file: the branch, the data files, the table and the pull request's body.
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

const git = (cwd, ...args) => execFileSync("git", [...ID, ...args], { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
const variant = (model, app = "0.1.0") => {
  const r = JSON.parse(JSON.stringify(GOOD));
  r.device.model = model;
  r.app = app;
  return r;
};
const body = (report) => ["### Report", "", "```json", JSON.stringify(report, null, 2), "```", "", "### Notes", "", "_No response_", "", "### Privacy", "", "- [X] This report contains no personal data", ""].join("\n");

// The GitHub CLI's pull request commands, the way record.mjs calls them.
const FAKE_GH = `
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
const state = process.env.FAKE_GH_STATE;
const prs = JSON.parse(readFileSync(state, "utf8"));
const save = () => writeFileSync(state, JSON.stringify(prs, null, 2));
const args = process.argv.slice(2);
const flag = (n) => args[args.indexOf(n) + 1];
const tip = (b) => execFileSync("git", ["ls-remote", process.env.FAKE_GH_ORIGIN, "refs/heads/" + b], { encoding: "utf8" }).split(/\\s+/)[0];
const [noun, verb] = args;
if (noun !== "pr") process.exit(2);
if (verb === "list") {
  const fields = flag("--json").split(",");
  const out = prs.filter((p) => p.headRefName === flag("--head")).reverse().map((p) => Object.fromEntries(fields.map((f) => [f, f === "headRefOid" && p.state === "OPEN" ? tip(p.headRefName) : p[f]])));
  process.stdout.write(JSON.stringify(out));
} else if (verb === "create") {
  if (prs.some((p) => p.headRefName === flag("--head") && p.state === "OPEN")) { console.error("a pull request already exists"); process.exit(1); }
  const number = prs.length + 1;
  prs.push({ number, state: "OPEN", headRefName: flag("--head"), baseRefName: flag("--base"), headRefOid: tip(flag("--head")), title: flag("--title"), body: readFileSync(flag("--body-file"), "utf8"), url: "https://github.test/o/r/pull/" + number });
  save();
  process.stdout.write(prs.at(-1).url);
} else if (verb === "view") {
  process.stdout.write(JSON.stringify({ body: prs.find((p) => p.number === Number(args[2])).body }));
} else if (verb === "edit") {
  prs.find((p) => p.number === Number(args[2])).body = readFileSync(flag("--body-file"), "utf8");
  save();
} else process.exit(2);
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
  const state = join(root, "prs.json");
  writeFileSync(state, "[]");
  const env = { PATH: `${bin}${delimiter}${process.env.PATH}`, FAKE_GH_STATE: state, FAKE_GH_ORIGIN: origin };
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
  const prs = () => JSON.parse(readFileSync(state, "utf8"));
  const branchFiles = () => {
    const dir = mkdtempSync(join(root, "look-"));
    execFileSync("git", ["clone", "-q", "-b", BRANCH, url, dir], { stdio: "ignore" });
    return { files: readdirSync(join(dir, "data", "devices")).sort(), doc: readFileSync(join(dir, "docs", "devices.md"), "utf8"), log: git(dir, "log", "--format=%s", "origin/main..HEAD") };
  };
  return { root, seed, url, env, checkout, file, prs, branchFiles };
}

/** record() with the stand-in CLI on PATH and no waiting between tries. */
function recordIn(w, issue, report, cwd = w.checkout()) {
  const saved = Object.fromEntries(Object.keys(w.env).map((k) => [k, process.env[k]]));
  Object.assign(process.env, w.env);
  try {
    return record({ issue, base: "main", repo: "o/r", eventPath: w.file(issue, report), temp: mkdtempSync(join(w.root, "temp-")), cwd, wait: () => {} });
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

test("the first report starts the branch from the default branch and opens the pull request; the next ones add to it", () => {
  const w = world();
  try {
    assert.deepEqual(recordIn(w, 1, GOOD), { changed: true, url: "https://github.test/o/r/pull/1" });
    const other = variant("EX-2000");
    assert.deepEqual(recordIn(w, 2, other), { changed: true, url: "https://github.test/o/r/pull/1" });
    const look = w.branchFiles();
    assert.deepEqual(look.files, [reportFileName(GOOD), reportFileName(other)].sort());
    assert.match(look.doc, /\| Examplecorp EX-1000 \|/);
    assert.match(look.doc, /\| Examplecorp EX-2000 \|/);
    assert.deepEqual(look.log.split("\n"), ["Device report from issue #2", "Device report from issue #1"]);
    const [pr] = w.prs();
    assert.equal(pr.title, "Device reports");
    assert.match(pr.body, /^Closes #1$/m);
    assert.match(pr.body, /^Closes #2$/m);
    // The same report again (an edit to the notes): nothing new, no commit, no comment.
    assert.deepEqual(recordIn(w, 2, other), { changed: false });
    assert.equal(w.branchFiles().log.split("\n").length, 2);
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
    assert.equal(w.prs()[0].body.split("\n").filter((l) => l === "Closes #7").length, 1);
  } finally {
    rmSync(w.root, { recursive: true, force: true });
  }
});

test("after its pull request is merged, the branch starts again from the default branch", () => {
  const w = world();
  try {
    recordIn(w, 1, GOOD);
    // A maintainer merges the pull request into main.
    git(w.seed, "fetch", "-q", "origin", BRANCH);
    git(w.seed, "merge", "-q", "--ff-only", "FETCH_HEAD");
    git(w.seed, "push", "-q", "origin", "HEAD:main");
    const prs = w.prs();
    prs[0].state = "MERGED";
    writeFileSync(w.env.FAKE_GH_STATE, JSON.stringify(prs));
    const next = variant("EX-3000");
    assert.deepEqual(recordIn(w, 3, next), { changed: true, url: "https://github.test/o/r/pull/2" });
    const look = w.branchFiles();
    assert.deepEqual(look.log.split("\n"), ["Device report from issue #3"]);
    assert.deepEqual(look.files, [reportFileName(GOOD), reportFileName(next)].sort());
    assert.equal(w.prs()[1].body.includes("Closes #1"), false);
    assert.match(w.prs()[1].body, /^Closes #3$/m);
  } finally {
    rmSync(w.root, { recursive: true, force: true });
  }
});

test("a branch another run just pushed, with no pull request yet, is built on, never replaced", () => {
  const w = world();
  try {
    // Another run pushed issue 4's report and hasn't opened the pull request yet.
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
    assert.deepEqual(recordIn(w, 6, other), { changed: true, url: "https://github.test/o/r/pull/1" });
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
