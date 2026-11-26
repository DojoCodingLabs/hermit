import { MAX_BOT_NAME_CHARS, MAX_ROLE_CHARS, RESERVED_GROUPS, SKILL_GROUPS, needsFingerprint, normalizeSite, type Bot, type BotLook, type PermissionMode, type SkillGroup } from "@hermit/core/bots";
import type { BotPatch, BotProposalView, NewBot } from "@hermit/runtime";
import { BLANK_LOOK, BOT_TEMPLATES, type BotTemplateId } from "./bot-templates.ts";

export { BOT_TEMPLATES, type BotTemplateId } from "./bot-templates.ts";

/** HM-BOT-03 and HM-BOT-04: what the user is editing. `sites` is the field's text; `mode` null is "Como el resto". */
export interface BotForm { name: string; role: string; look: BotLook; grants: SkillGroup[]; sites: string; connectors: string[]; mode: PermissionMode | null }

/** Sites are typed with commas, spaces or new lines between them. */
const siteWords = (sites: string) => sites.split(/[\s,]+/).filter(Boolean);

/** The refusals the runtime would give for the same fields, found before Create so each shows beside its field. */
export function formProblems(f: BotForm): Array<"name_empty" | "name_too_long" | "role_too_long" | "bad_site"> {
  const out: Array<"name_empty" | "name_too_long" | "role_too_long" | "bad_site"> = [];
  const name = f.name.trim();
  if (!name) out.push("name_empty");
  else if ([...name].length > MAX_BOT_NAME_CHARS) out.push("name_too_long");
  if (f.role.trim().length > MAX_ROLE_CHARS) out.push("role_too_long");
  if (siteWords(f.sites).some((w) => normalizeSite(w) === undefined)) out.push("bad_site");
  return out;
}

/**
 * Task 1's one rule as the runtime applies it: on the bot's own mode only. A null mode ("Como el resto") brings no Don't
 * ask of its own, whatever the global mode is (the global took the word and the fingerprint when it was set), so
 * creating or copying a bot that inherits needs nothing for its mode. `before` is the saved bot, on HM-BOT-04.
 */
export function formNeedsFingerprint(f: BotForm, before?: { grants: readonly SkillGroup[]; mode: PermissionMode | null }): boolean {
  return needsFingerprint(
    { grants: f.grants, mode: f.mode ?? "ask" },
    before && { grants: before.grants, mode: before.mode ?? "ask" },
  );
}

export function toNewBot(f: BotForm): NewBot {
  const sites = [...new Set(siteWords(f.sites).map(normalizeSite).filter((d): d is string => d !== undefined))];
  return { name: f.name.trim(), role: f.role.trim(), look: f.look, grants: f.grants, sources: { sites, connectors: f.connectors }, mode: f.mode };
}

export function fromTemplate(id: BotTemplateId, t: (key: string) => string, look: BotLook): BotForm {
  const tpl = BOT_TEMPLATES.find((x) => x.id === id)!;
  return { name: t(`HM-BOT-03.template.${id}.name`), role: t(`HM-BOT-03.template.${id}.role`), look, grants: [...tpl.grants], sites: tpl.sites.join(", "), connectors: [], mode: null };
}

export function fromProposal(p: BotProposalView): BotForm {
  return { name: p.name, role: p.role, look: p.look, grants: [...p.grants], sites: p.sources.sites.join(", "), connectors: [...p.sources.connectors], mode: null };
}

/**
 * The groups the form lists: all but core's reserved ones, the groups no skill carries yet (the logins group, which still
 * has its words). The runtime refuses the same list (reserved_group), so the user never grants what the form can't show.
 */
export function shownGroups(): SkillGroup[] {
  return SKILL_GROUPS.filter((g) => !RESERVED_GROUPS.includes(g));
}

/**
 * HM-BOT-04: what a note's row offers. A shared note is everyone's, so only Hermit's settings delete it; sharing is
 * for the bot's own notes, and never for one saved after reading outside text (tainted facts stay out of the profile).
 */
export function noteActions(note: { tainted: boolean; shared?: true }, inHermit: boolean): { delete: boolean; share: boolean } {
  return { delete: note.shared ? inHermit : true, share: !note.shared && !note.tainted };
}

/** HM-BOT-04: a saved bot as the form edits it (Hermit wears the crab, so it has no look of its own). */
export function fromBot(b: Bot): BotForm {
  return { name: b.name, role: b.role, look: b.look ?? BLANK_LOOK, grants: [...b.grants], sites: b.sources.sites.join(", "), connectors: [...b.sources.connectors], mode: b.mode };
}

const sameSet = (a: readonly string[], b: readonly string[]) => a.length === b.length && [...a].sort().join("\n") === [...b].sort().join("\n");

/** What Save sends: only the fields that changed. The mode isn't one of them (it has its own call, and its own sheet). */
export function formPatch(f: BotForm, before: BotForm): BotPatch {
  const next = toNewBot(f);
  const was = toNewBot(before);
  return {
    ...(next.name !== was.name ? { name: next.name } : {}),
    ...(next.role !== was.role ? { role: next.role } : {}),
    ...(next.look!.shape !== was.look!.shape || next.look!.color !== was.look!.color ? { look: next.look! } : {}),
    ...(!sameSet(next.grants, was.grants) ? { grants: next.grants } : {}),
    ...(!sameSet(next.sources.sites, was.sources.sites) || !sameSet(next.sources.connectors, was.sources.connectors) ? { sources: next.sources } : {}),
  };
}

/**
 * HM-BOT-03, HM-BOT-04 and Hermit's proposal card: a change that didn't happen, in code's words. `reason` is the runtime's
 * refusal, or `failed` when the change itself threw (said as a failure, never passed off as a busy bot). Every line gets
 * the name of the bot the screen is about, so a busy bot is the one named (Task 18), not always Hermit.
 */
export function refusalLine(reason: string, name: string): { key: string; vars: { name: string } } {
  return { key: reason === "failed" ? "HM-BOT-01.changeFailed" : `HM-BOT-04.refused.${reason}`, vars: { name } };
}

/** HM-BOT-04: what the page says after a change to the bot named `name`, in code's words. A refusal wins over a "done" line. */
export function settingsResult(refused: string | undefined, flash: "saved" | "reset" | undefined, name: string): { key: string; vars?: { name: string }; tone: "bad" | "ok" } | undefined {
  if (refused) return { ...refusalLine(refused, name), tone: "bad" };
  if (flash) return { key: flash === "saved" ? "HM-BOT-04.saved" : "HM-BOT-04.resetDone", tone: "ok" };
  return undefined;
}

/**
 * HM-CHAT-01: what Hermit's proposal card offers (Review Focus 2). A proposal drafted after Hermit read others' text offers
 * only Review, the whole form, never a one-tap Create, and says why; an ordinary one offers Create beside Review, with a
 * note when Create will ask for the fingerprint.
 */
export function proposalCard(p: Pick<BotProposalView, "tainted" | "needsFingerprint" | "mode">): { actions: Array<"create" | "review">; note?: "tainted" | "fingerprint"; mode: PermissionMode; modeNote?: "HM-CHAT-01.proposal.modeAuto" | "HM-CHAT-01.proposal.modeDontAsk" } {
  // The mode the bot will run in shows on every card; Auto and Don't ask add a line, so Create is never a surprise.
  const modeNote = p.mode === "auto" ? ({ modeNote: "HM-CHAT-01.proposal.modeAuto" } as const) : p.mode === "dont_ask" ? ({ modeNote: "HM-CHAT-01.proposal.modeDontAsk" } as const) : {};
  if (p.tainted) return { actions: ["review"], note: "tainted", mode: p.mode, ...modeNote };
  return { actions: ["create", "review"], ...(p.needsFingerprint ? { note: "fingerprint" as const } : {}), mode: p.mode, ...modeNote };
}
