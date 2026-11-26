#!/usr/bin/env node
// The device-report workflow's record job: adds the report from the issue in the event file to the device-data
// branch (data/devices and the table in docs/devices.md) and opens or updates the branch's pull request. It runs from
// the default branch's checkout, with that checkout's scripts, and writes only into a worktree of the branch.
//
// Runs for different issues can race. A push that loses is tried again on top of the winner, and the branch starts
// again from the default branch only when its last pull request is done with (merged or closed), never while another
// run's report waits there for its pull request.
//
//   ISSUE=12 BASE=main GITHUB_REPOSITORY=o/r GITHUB_EVENT_PATH=... RUNNER_TEMP=... GITHUB_OUTPUT=... node scripts/devices/record.mjs
//
// Appends changed=true|false and url=<pull request> to GITHUB_OUTPUT.
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

/** The branch's pull requests, newest first: the open one (if any) and the ones done with. */
function pullRequests(repo) {
  return JSON.parse(run("gh", ["pr", "list", "--repo", repo, "--head", BRANCH, "--state", "all", "--json", "number,state,headRefOid,baseRefName,url", "--limit", "50"]));
}

/** The valid report in the event's issue; throws when there is none (the check job let it through, so it's a bug). */
function reportFrom(eventPath) {
  const body = JSON.parse(readFileSync(eventPath, "utf8"))?.issue?.body ?? "";
  if (!isReportForm(body)) throw new Error("the issue wasn't filed with the Device report form");
  const found = extractReport(body);
  const errors = [...found.errors, ...(found.report === undefined ? [] : validateReport(found.report).errors)];
  if (errors.length) throw new Error(`the report doesn't pass: ${errors.join("; ")}`);
  return found.report;
}

export function record({ issue, base, repo, eventPath, temp, cwd = process.cwd(), wait = (ms) => execFileSync("sleep", [String(ms / 1000)]) }) {
  if (!/^[0-9]+$/.test(String(issue))) throw new Error("ISSUE is not a number");
  const number = Number(issue);
  const report = reportFrom(eventPath);
  const data = join(temp, BRANCH);
  let pushed = false;
  for (let attempt = 1; attempt <= TRIES && !pushed; attempt++) {
    tryRun("git", ["worktree", "remove", "--force", data], cwd);
    rmSync(data, { recursive: true, force: true });
    run("git", ["worktree", "prune"], cwd);
    const tip = run("git", ["ls-remote", "origin", `refs/heads/${BRANCH}`], cwd).split(/\s+/)[0] ?? "";
    const prs = pullRequests(repo);
    const open = prs.some((p) => p.state === "OPEN" && p.baseRefName === base);
    // Where this attempt starts, and what the push may replace.
    let start = "HEAD";
    let lease = [`--force-with-lease=${BRANCH}:`];
    if (tip) {
      const doneWith = !open && prs.some((p) => p.state !== "OPEN" && p.headRefOid === tip);
      if (doneWith) {
        lease = [`--force-with-lease=${BRANCH}:${tip}`];
      } else {
        run("git", ["fetch", "--no-tags", "--depth=1", "origin", BRANCH], cwd);
        start = "FETCH_HEAD";
        lease = [];
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

  const openPr = () => pullRequests(repo).find((p) => p.state === "OPEN" && p.baseRefName === base);
  let pr = openPr();
  const bodyPath = join(temp, "device-data-pr.md");
  if (!pr) {
    writeFileSync(bodyPath, "Device reports filed with the Device report form, each checked by the Device report workflow. Merging adds them to the device table in docs/devices.md.\n\n");
    // Another run may open it a moment before this one: then this one updates it below.
    tryRun("gh", ["pr", "create", "--repo", repo, "--base", base, "--head", BRANCH, "--title", "Device reports", "--body-file", bodyPath], cwd);
    pr = openPr();
    if (!pr) throw new Error("couldn't open the pull request");
  }
  const body = JSON.parse(run("gh", ["pr", "view", String(pr.number), "--repo", repo, "--json", "body"], cwd)).body ?? "";
  const closes = `Closes #${number}`;
  if (!body.split("\n").includes(closes)) {
    writeFileSync(bodyPath, `${body.replace(/\s*$/, "")}\n${closes}\n`);
    run("gh", ["pr", "edit", String(pr.number), "--repo", repo, "--body-file", bodyPath], cwd);
  }
  return { changed: true, url: pr.url };
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
