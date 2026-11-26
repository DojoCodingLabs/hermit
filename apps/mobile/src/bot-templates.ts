import type { BotLook, SkillGroup } from "@hermit/core/bots";

/** HM-BOT-03: the templates the "＋" offers first. Their name and role are copy (HM-BOT-03.template.<id>.name and .role). */
export type BotTemplateId = "travel" | "recipes" | "agenda" | "inbox";

export const BOT_TEMPLATES: ReadonlyArray<{ id: BotTemplateId; grants: SkillGroup[]; sites: string[] }> = [
  { id: "travel", grants: ["web_read", "notes"], sites: ["wikivoyage.org"] },
  { id: "recipes", grants: ["web_read", "notes", "reminders"], sites: [] },
  { id: "agenda", grants: ["calendar", "reminders", "notes"], sites: [] },
  { id: "inbox", grants: ["mail_read", "notes"], sites: [] },
];

/** A template's first shell, so four bots made from templates don't all wear the same one. */
export const TEMPLATE_LOOKS: Record<BotTemplateId, BotLook> = {
  travel: { shape: "whelk", color: "sand" },
  recipes: { shape: "conch", color: "seaglass" },
  agenda: { shape: "moon", color: "stone" },
  inbox: { shape: "nerite", color: "ink" },
};

/** The look of a bot made from scratch. */
export const BLANK_LOOK: BotLook = { shape: "turban", color: "seaglass" };
