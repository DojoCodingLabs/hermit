import type { PermissionMode } from "@hermit/core";
import type { RosterRow } from "@hermit/runtime";

/** HM-BOT-01: the row's second line. The user's own words say "Tú: ..."; the bot's reply shows as it is. */
export function rowLine(row: RosterRow): { key: string; vars?: Record<string, string> } | { text: string } {
  const p = row.preview;
  if (!p) return { key: "HM-BOT-01.empty" };
  return p.who === "user" ? { key: "HM-BOT-01.you", vars: { text: p.text } } : { text: p.text };
}

/** HM-BOT-01: a row's time is its last turn's. A bot with no turn yet shows none (Hermit's own row starts at time 0, never shown as 1969). */
export function rowTime(row: RosterRow): number | undefined {
  return row.preview ? row.lastAt : undefined;
}

/** HM-BOT-04: a chip only for the two modes that act without asking each time. */
export function modeChip(mode: PermissionMode): { key: "HM-BOT-04.chip.auto"; tone: "amber" } | { key: "HM-BOT-04.chip.dontAsk"; tone: "coral" } | undefined {
  if (mode === "auto") return { key: "HM-BOT-04.chip.auto", tone: "amber" };
  if (mode === "dont_ask") return { key: "HM-BOT-04.chip.dontAsk", tone: "coral" };
  return undefined;
}

/** What TalkBack hears for a roster row: the name (then "coordinador" for Hermit), the line, the time, pinned, the mode. */
export function rowSpoken(p: { name: string; primary: boolean; preview: string; time: string; pinned: boolean; chip?: string }, words: { primary: string; pinned: string }): string {
  return [p.name, p.primary ? words.primary : "", p.preview, p.time, p.pinned ? words.pinned : "", p.chip ?? ""].filter(Boolean).join(", ");
}

/** HM-BOT-02's bar: the bot's face and name hide on Hermit's first run (the page stages the crab); the mode chip never hides. */
export function headerParts(o: { quiet: boolean; mode: PermissionMode }) {
  return { identity: !o.quiet, chip: modeChip(o.mode) };
}

/** Where a chat for Hermit opens from, so Back always lands on the roster: the steps to run, in order. */
export type RouteStep = { kind: "replace" | "push"; href: string | { pathname: string; params: Record<string, string> } } | { kind: "dismissAll" };
export const hermitChatHref = { pathname: "/chat", params: { bot: "hermit" } } as const;
export function hermitChatSteps(from: "onboarding" | "stack"): RouteStep[] {
  // Onboarding's screens are replaced by the roster; a screen opened from the roster is popped back to it.
  return [from === "onboarding" ? { kind: "replace", href: "/" } : { kind: "dismissAll" }, { kind: "push", href: hermitChatHref }];
}
