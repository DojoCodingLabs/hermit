import type { ActivityMark } from "@hermit/cage";
import { markKey } from "./skill-names.ts";

/**
 * HM-ACT-01: a row's second line. The log holds codes and ids only; this turns them into copy keys, and the bot's id into
 * the name it has now (the runtime reads it when the row is shown, ActivityRowView), never stored.
 */

/** A row as the runtime gives it: the signed log's metadata, and the bot's name now when it still exists. */
export interface ActivityRowFacts { skill: string; mark: string; reason?: string; bot?: string; botName?: string }

export interface ActivityLine {
  /** The bot that ran the step or that the user changed: its name now, or "bot borrado" once it is gone. */
  who?: { name: string } | { key: string };
  /** What a change to a bot or a mode was; on a step, the permission mode that let it run without asking (never "approved"). */
  what?: string;
  /** The outcome, only when it isn't the ordinary "done". */
  outcome?: string;
  /** Coral for a refusal or a failure, amber for others' content, soft otherwise. */
  tone: "coral" | "amber" | "soft";
}

/** How an outcome reads in a row: nothing for the ordinary "ran", coral for a refusal or a failure, amber for outside content. */
export const OUTCOME: Partial<Record<ActivityMark, "coral" | "amber" | "soft">> = {
  approved: "soft", blocked: "coral", denied: "soft", failed: "coral", read_untrusted: "amber", proposed: "soft", skipped: "soft",
};

/** The reasons the loop logs on a step a permission mode let run (spec 6.4.1); mode.ask is wave 2's alone source reads. */
const MODE_RUNS = ["mode.ask", "mode.auto", "mode.dont_ask"] as const;

/** What the bots API logs when the user changes a bot (packages/runtime/src/bots.ts, BotReason). */
const BOT_ACTS = [
  "bot.created", "bot.updated", "bot.granted", "bot.duplicated", "bot.pinned", "bot.hidden", "bot.reset", "bot.deleted", "bot.note_shared",
  "mode.ask", "mode.auto", "mode.dont_ask", "mode.inherit",
] as const;

/** The global mode, set in Settings for all of Hermit: logged with no bot. */
const GLOBAL_MODES = ["mode.ask", "mode.auto", "mode.dont_ask"] as const;

const has = (list: readonly string[], code: string | undefined): code is string => code !== undefined && list.includes(code);

/**
 * In order: the bot (its name now, or deleted); for a change to a bot or to the global mode, what changed; for a step a
 * permission mode let run, which mode; and the outcome when it isn't "done". Only codes this build knows get words.
 */
export function activityLine(row: ActivityRowFacts): ActivityLine {
  const line: ActivityLine = { tone: OUTCOME[row.mark as ActivityMark] ?? "soft" };
  if (row.bot !== undefined) line.who = row.botName !== undefined ? { name: row.botName } : { key: "HM-ACT-01.botDeleted" };
  if (row.skill === "bot") {
    if (row.bot !== undefined && has(BOT_ACTS, row.reason)) line.what = `HM-ACT-01.act.${row.reason}`;
    else if (row.bot === undefined && has(GLOBAL_MODES, row.reason)) line.what = `HM-ACT-01.act.globalMode.${row.reason.slice("mode.".length)}`;
  } else if (has(MODE_RUNS, row.reason)) {
    line.what = `HM-ACT-01.byMode.${row.reason.slice("mode.".length)}`;
  }
  if (OUTCOME[row.mark as ActivityMark]) line.outcome = markKey(row.mark);
  return line;
}

/** Every key the line can name (each exists in both locales; the activity view test checks it). */
export const ACTIVITY_LINE_KEYS: readonly string[] = [
  "HM-ACT-01.botDeleted",
  ...BOT_ACTS.map((code) => `HM-ACT-01.act.${code}`),
  ...GLOBAL_MODES.map((code) => `HM-ACT-01.act.globalMode.${code.slice("mode.".length)}`),
  ...MODE_RUNS.map((code) => `HM-ACT-01.byMode.${code.slice("mode.".length)}`),
];
