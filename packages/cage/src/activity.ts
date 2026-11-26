import { PERMISSION_MODES } from "@hermit/core";
import type { AuditEntry, verifyChain } from "./audit.ts";

/**
 * SL-08: what HM-ACT-01 and HM-ACT-03 render from the signed log (US-ACT-01, US-ACT-02, FR-ACT-02, FR-ACT-03).
 * Rows carry metadata and a short hash only; the log never held content, and this never adds any.
 */
export type ActivityMark = "approved" | "blocked" | "denied" | "ran" | "failed" | "read_untrusted" | "proposed" | "cleared"
  /** A night shift job that paused or was skipped (SL-24); the row carries the reason code. */
  | "skipped";

export interface ActivityRow {
  seq: number;
  at: number;
  /** Empty on a "cleared" row: the clear is the user's, not a skill's. */
  skill: string;
  mark: ActivityMark;
  /** The first 8 hex characters of the entry hash, for the monospace column. */
  shortHash: string;
  /** "cleared" rows only: how many entries the clear removed (US-ACT-04). */
  clearedCount?: number;
  /**
   * A code, never text: why a night job paused or was skipped ("paused.hot", SL-24); the action of the user's own act
   * ("vault.revealed", "bot.created"); or, on a call, the permission mode that let it run ("mode.auto", multi-bot).
   */
  reason?: string;
  /** Multi-bot: the bot whose turn made the call or the act; absent for what no bot ran and for entries from before bots. */
  bot?: string;
}

/** SL-32, HM-ACT-02: one audit entry in full, as metadata and hashes only (US-ACT-03, FR-ACT-02). */
export interface ActivityDetail {
  seq: number;
  at: number;
  event: AuditEntry["event"];
  skill?: string;
  decision?: AuditEntry["decision"];
  outcome?: AuditEntry["outcome"];
  argsHash?: string;
  clearedCount?: number;
  reason?: string;
  /** Multi-bot: the bot whose turn wrote the entry. */
  bot?: string;
  prevHash: string;
  hash: string;
  sig: string;
}

export type ChainView = { kind: "verified"; count: number } | { kind: "broken"; atSeq: number; reason: string } | { kind: "empty" };

/** Rows before calls that ran without approval are marked "ran". */
function rawRows(entries: readonly AuditEntry[]): ActivityRow[] {
  const rows: ActivityRow[] = [];
  let current: ActivityRow | undefined;
  for (const e of entries) {
    if (e.event === "log_cleared") {
      rows.push({ seq: e.seq, at: e.ts, skill: "", mark: "cleared", shortHash: e.hash.slice(0, 8), clearedCount: e.clearedCount ?? 0 });
      current = undefined;
      continue;
    }
    // SL-24: a night job is its own row (it is not a skill call), between the calls it made.
    if (e.event === "night_job") {
      const mark: ActivityMark = e.outcome === "ok" ? "ran" : e.outcome === "denied" ? "skipped" : "failed";
      rows.push({ seq: e.seq, at: e.ts, skill: e.skill ?? "night", mark, shortHash: e.hash.slice(0, 8), ...(e.reason ? { reason: e.reason } : {}) });
      current = undefined;
      continue;
    }
    // SL-33, SL-55, SL-38, SL-53 and SL-40: a vault action, a connector install, a wallet action, a web task's take over,
    // stop or saved recipe, or a cap or payee change is the user's own act, its own row; the reason is the action code.
    // Multi-bot: so is a change to a bot or a permission mode.
    if (STANDALONE_ACTS.has(e.event)) {
      rows.push({ seq: e.seq, at: e.ts, skill: e.event, mark: e.outcome === "ok" ? "ran" : "failed", shortHash: e.hash.slice(0, 8), ...(e.reason ? { reason: e.reason } : {}), ...(e.bot ? { bot: e.bot } : {}) });
      current = undefined;
      continue;
    }
    if (e.event === "call_proposed") {
      current = { seq: e.seq, at: e.ts, skill: e.skill ?? "unknown", mark: "proposed", shortHash: e.hash.slice(0, 8), ...(e.bot ? { bot: e.bot } : {}) };
      rows.push(current);
      continue;
    }
    if (!current || e.skill !== current.skill) continue;
    const mark = markFor(e);
    if (mark) Object.assign(current, { mark, shortHash: e.hash.slice(0, 8) });
    // F-M28: the mode that let the step run stays on its row, whatever its final mark (ran, failed, read others' text).
    const mode = modeRun(e);
    if (mode) current.reason = mode;
  }
  return rows.reverse();
}

/** The user's own acts, each its own row (see rawRows). */
const STANDALONE_ACTS: ReadonlySet<AuditEntry["event"]> = new Set(["vault", "connector", "wallet", "web_task", "spending", "bot"]);

/** Multi-bot (spec 6.4.1): the reasons the loop logs on a step a bot's permission mode let run without a sheet. */
const MODE_RUNS: ReadonlySet<string> = new Set(PERMISSION_MODES.map((m) => `mode.${m}`));

/** The mode's reason ("mode.auto") when this is the approval a permission mode gave in place of the user's sheet. */
function modeRun(e: AuditEntry): string | undefined {
  return e.event === "approval" && e.outcome === "ok" && e.reason !== undefined && MODE_RUNS.has(e.reason) ? e.reason : undefined;
}

function markFor(e: AuditEntry): ActivityMark | undefined {
  switch (e.event) {
    case "policy_decided":
      return e.decision === "deny" ? "blocked" : undefined;
    case "approval":
      // F-M28: a step a mode let run ran; nobody approved it, so it never reads "approved".
      if (modeRun(e)) return "ran";
      return e.outcome === "ok" ? "approved" : "denied";
    case "executed":
      // Keep "approved" visible on a send that went out; mark failures either way.
      return e.outcome === "ok" ? undefined : "failed";
    case "taint_added":
      return "read_untrusted";
    default:
      return undefined;
  }
}

/** One row per skill call, newest first: the call's final state wins over its intermediate entries. */
export function activityRows(entries: readonly AuditEntry[]): ActivityRow[] {
  const rows = rawRows(entries);
  const executedOk = new Set<number>();
  let lastCall = -1;
  for (const e of entries) {
    if (e.event === "call_proposed") lastCall = e.seq;
    if (e.event === "executed" && e.outcome === "ok") executedOk.add(lastCall);
  }
  return rows.map((r) => (r.mark === "proposed" && executedOk.has(r.seq) ? { ...r, mark: "ran" } : r));
}

export function chainView(entries: readonly AuditEntry[], result: ReturnType<typeof verifyChain>): ChainView {
  if (!entries.length) return { kind: "empty" };
  return result.ok ? { kind: "verified", count: entries.length } : { kind: "broken", atSeq: result.badSeq, reason: result.reason };
}

/**
 * Entries that are a row on their own: the user's clear, a night job, a vault action, a connector install, a wallet, web
 * task or spending act, a bot or mode change.
 */
const STANDALONE: ReadonlySet<AuditEntry["event"]> = new Set(["log_cleared", "night_job", ...STANDALONE_ACTS]);

/**
 * HM-ACT-02: every entry behind the row that starts at `seq`, oldest first. A call row opens its proposal
 * and the entries the list folded into it (same skill, up to the next call); a cleared row opens itself.
 * Undefined when `seq` does not start a row.
 */
export function activityDetail(entries: readonly AuditEntry[], seq: number): ActivityDetail[] | undefined {
  const start = entries.findIndex((e) => e.seq === seq);
  const first = entries[start];
  if (!first) return undefined;
  if (STANDALONE.has(first.event)) return [detail(first)];
  if (first.event !== "call_proposed") return undefined;
  const out = [detail(first)];
  for (const e of entries.slice(start + 1)) {
    if (e.event === "call_proposed" || STANDALONE.has(e.event)) break;
    if (e.skill === first.skill) out.push(detail(e));
  }
  return out;
}

function detail(e: AuditEntry): ActivityDetail {
  const d: ActivityDetail = { seq: e.seq, at: e.ts, event: e.event, prevHash: e.prevHash, hash: e.hash, sig: e.sig };
  if (e.skill !== undefined) d.skill = e.skill;
  if (e.decision !== undefined) d.decision = e.decision;
  if (e.outcome !== undefined) d.outcome = e.outcome;
  if (e.argsHash !== undefined) d.argsHash = e.argsHash;
  if (e.clearedCount !== undefined) d.clearedCount = e.clearedCount;
  if (e.reason !== undefined) d.reason = e.reason;
  if (e.bot !== undefined) d.bot = e.bot;
  return d;
}
