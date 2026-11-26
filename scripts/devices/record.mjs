#!/usr/bin/env node
// The device-report workflow's record job: adds the report from the issue in the event file to the device-data
// branch (data/devices and the table in docs/devices.md). It never opens, edits or approves a pull request: a
// maintainer opens one from device-data and merges it. It runs from the default branch's checkout, with that
// checkout's scripts, and writes only into a worktree of the branch.
//
// Reports wait on the branch until they are in the default branch. The branch starts again from the default branch
// only when every report on it is already there (merged, squashed or pushed); otherwise the new report goes on top.
// Runs for different issues can race: a push that loses is tried again on top of the winner.
//
//   ISSUE=12 BASE=main GITHUB_REPOSITORY=o/r GITHUB_EVENT_PATH=... RUNNER_TEMP=... GITHUB_OUTPUT=... node scripts/devices/record.mjs
//
// Appends changed=true|false and url=<link> to GITHUB_OUTPUT: the pull request a maintainer opened from device-data,
// else the page that compares the branch with the default branch.
import { execFileSync } from "node:child_process";
import { appendFileSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { readEntries, renderTable, updateDoc } from "./table.mjs";
import { extractReport, isReportForm, validateReport, writeReport } from "./validate.mjs";

export const BRANCH = "device-data";
const TRIES = 5;
const BOT = ["-c", "user.name=github-actions[bot]", "-c", "user.email=41898282+github-actions[bot]@users.noreply.github.com"];

const run = (cmd, args, cwd) => execFileSync(cmd, args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
const tryRun = (cmd, args, cwd) => {
  try {
    return { ok: true, out: run(cmd, args, cwd) };
  } catch (err) {
    return { ok: false, out: String(err.stderr ?? err.message) };
  }
};

/** The valid report in the event's issue; throws when there is none (the check job let it through, so it's a bug). */
function reportFrom(eventPath) {
  const body = JSON.parse(readFileSync(eventPath, "utf8"))?.issue?.body ?? "";
  if (!isReportForm(body)) throw new Error("the issue wasn't filed with the Device report form");
  const found = extractReport(body);
  const errors = [...found.errors, ...(found.report === undefined ? [] : validateReport(found.report).errors)];
  if (errors.length) throw new Error(`the report doesn't pass: ${errors.join("; ")}`);
  return found.report;
}

/**
 * Where the reporter can follow the report: the open pull request a maintainer made from device-data, else the page
 * comparing the branch with the default branch. Reading pull requests is only for this link, so if it fails the
 * compare page stands in.
 */
function linkFor(repo, base, cwd) {
  const found = tryRun("gh", ["pr", "list", "--repo", repo, "--head", BRANCH, "--base", base, "--state", "open", "--json", "url", "--limit", "1"], cwd);
  if (found.ok) {
    try {
      const url = JSON.parse(found.out)[0]?.url;
      if (typeof url === "string" && url.startsWith("https://")) return url;
    } catch {
      // Not what gh prints: the compare page below.
    }
  }
  return `https://github.com/${repo}/compare/${base}...${BRANCH}`;
}

export function record({ issue, base, repo, eventPath, temp, cwd = process.cwd(), wait = (ms) => execFileSync("sleep", [String(ms / 1000)]) }) {
  if (!/^[0-9]+$/.test(String(issue))) throw new Error("ISSUE is not a number");
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(String(repo))) throw new Error("GITHUB_REPOSITORY is not owner/name");
  const number = Number(issue);
  const report = reportFrom(eventPath);
  const data = join(temp, BRANCH);
  let pushed = false;
  for (let attempt = 1; attempt <= TRIES && !pushed; attempt++) {
    tryRun("git", ["worktree", "remove", "--force", data], cwd);
    rmSync(data, { recursive: true, force: true });
    run("git", ["worktree", "prune"], cwd);
    const tip = run("git", ["ls-remote", "origin", `refs/heads/${BRANCH}`], cwd).split(/\s+/)[0] ?? "";
    // Where this attempt starts, and what the push may replace. No branch yet: start it from the default branch.
    let start = "HEAD";
    let lease = [`--force-with-lease=${BRANCH}:`];
    if (tip) {
      run("git", ["fetch", "--no-tags", "--depth=1", "origin", BRANCH], cwd);
      // Reports on the branch that the default branch doesn't have, or has differently, still wait for a maintainer.
      const waiting = run("git", ["diff", "--name-only", "--no-renames", "--diff-filter=AM", "HEAD", "FETCH_HEAD", "--", "data/devices"], cwd);
      if (waiting) {
        start = "FETCH_HEAD";
        lease = [];
      } else {
        // Everything on the branch is in the default branch already: start again from it, unless the branch moves.
        lease = [`--force-with-lease=${BRANCH}:${tip}`];
      }
    }
    run("git", ["worktree", "add", "-B", BRANCH, data, start], cwd);
    const saved = writeReport(join(data, "data", "devices"), number, report);
    const docPath = join(data, "docs", "devices.md");
    writeFileSync(docPath, updateDoc(readFileSync(docPath, "utf8"), renderTable(readEntries(join(data, "data", "devices")))));
    run("git", ["add", "--all", "--", "data/devices", "docs/devices.md"], data);
    if (tryRun("git", ["diff", "--cached", "--quiet"], data).ok) return { changed: false };
    run("git", [...BOT, "commit", "-q", "-m", `Device report from issue #${number}`, "-m", `data/devices/${saved.name}`], data);
    pushed = tryRun("git", ["push", ...lease, "origin", BRANCH], data).ok;
    if (!pushed && attempt < TRIES) wait(1000 * attempt + Math.floor(Math.random() * 2000));
  }
  if (!pushed) throw new Error(`couldn't push ${BRANCH} after ${TRIES} tries`);
  return { changed: true, url: linkFor(repo, base, cwd) };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    const env = process.env;
    const result = record({ issue: env.ISSUE, base: env.BASE, repo: env.GITHUB_REPOSITORY, eventPath: env.GITHUB_EVENT_PATH, temp: env.RUNNER_TEMP });
    if (env.GITHUB_OUTPUT) appendFileSync(env.GITHUB_OUTPUT, `changed=${result.changed}\n${result.url ? `url=${result.url}\n` : ""}`);
    console.log(result.changed ? `recorded: ${result.url}` : "nothing new to record");
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  }
}
