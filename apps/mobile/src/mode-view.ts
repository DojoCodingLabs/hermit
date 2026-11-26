import type { PermissionMode } from "@hermit/core";
import { typedWordOk } from "@hermit/runtime/bot-api";

/** What choosing a mode needs first. */
export type ModeStep = "none" | "auto_sheet" | "dont_ask_sheet";

const RANK: Record<PermissionMode, number> = { ask: 0, auto: 1, dont_ask: 2 };

/**
 * HM-BOT-04: the runtime's own-mode rule (modes.setBot, bots.create). `from` and `to` are a bot's own modes, null being
 * "Como el resto" (or, for a new bot, nothing before), or the global mode before and after in Settings. Going up to a
 * looser mode of its own warns (Auto: a plain sheet; Don't ask: the red one, with the word), whatever the global mode is;
 * going down, staying, or back to the global mode (which took its own warning when it was set) asks nothing.
 */
export function modeStep(from: PermissionMode | null, to: PermissionMode | null): ModeStep {
  if (to === null || RANK[to] <= RANK[from ?? "ask"]) return "none";
  return to === "auto" ? "auto_sheet" : "dont_ask_sheet";
}

/** Don't ask's Confirm waits for the word ("entiendo" or "I understand", in either language). */
export const canConfirmDontAsk = (typed: string): boolean => typedWordOk(typed);

/** The Auto sheet's points, in the order shown: what stays safe first, then what now runs without asking, and what still stops it. Code's words only. */
export const AUTO_SHEET_KEYS = [
  "HM-BOT-04.autoSheet.money",
  "HM-BOT-04.autoSheet.runs",
  "HM-BOT-04.autoSheet.links",
  "HM-BOT-04.autoSheet.query",
  "HM-BOT-04.autoSheet.mail",
  "HM-BOT-04.autoSheet.composed",
  "HM-BOT-04.autoSheet.asks",
  "HM-BOT-04.autoSheet.alone",
] as const;

/** The red sheet's points, in the order shown, ending with the field's label. */
export const DONT_ASK_SHEET_KEYS = [
  "HM-BOT-04.dontAskSheet.risk",
  "HM-BOT-04.dontAskSheet.tools",
  "HM-BOT-04.dontAskSheet.money",
  "HM-BOT-04.dontAskSheet.proof",
  "HM-BOT-04.dontAskSheet.typeWord",
] as const;
