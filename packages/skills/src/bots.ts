import { MAX_BOT_NAME_CHARS, MAX_ROLE_CHARS, RESERVED_GROUPS, SKILL_GROUPS, skillId, type JsonSchema, type SkillDef, type SkillGroup } from "@hermit/core";

/**
 * Multi-bot (spec 6.4 "Creating a bot", 6.8): "créame un bot de viajes". The model picks this skill and drafts the
 * bot: its name, its role, the permission groups it needs and the sites it works from. It creates nothing. The runtime
 * keeps the draft as an offer and the chat shows a card code renders from those fields; the bot exists only once the
 * user taps Create (with the fingerprint when the groups need it) or reviews it on HM-BOT-03. It never sets a mode, so
 * a proposal can't choose Don't ask, and it names no connectors.
 */
type Args = { name?: string; role?: string; grants?: SkillGroup[]; sites?: string[] };

/** A proposal lists at most this many sites. */
export const MAX_PROPOSED_SITES = 5;

const args: JsonSchema = {
  type: "object",
  properties: {
    name: { type: "string", description: "The bot's name, short, in the user's language", maxLength: MAX_BOT_NAME_CHARS },
    role: { type: "string", description: "The bot's instructions: what it does and how, in the user's language", maxLength: MAX_ROLE_CHARS },
    // Only groups a bot may hold: a reserved one (no skill carries it yet, and no screen shows it) is never proposed.
    grants: { type: "array", description: "Only the permission groups its job needs", items: { type: "string", enum: SKILL_GROUPS.filter((g) => !RESERVED_GROUPS.includes(g)) }, uniqueItems: true },
    sites: { type: "array", description: "Websites it works from, if any (domains or links)", items: { type: "string", maxLength: 200 }, maxItems: MAX_PROPOSED_SITES },
  },
  required: ["name", "role"],
  additionalProperties: false,
};

export const createBotDef: SkillDef<Args> = {
  id: skillId("create_bot"),
  version: 1,
  // Nothing is created, sent or stored for good: an offer in memory, and a card behind the user's own tap.
  risk: "read",
  producesUntrusted: false,
  // Low, and no group on purpose: only Hermit, the primary bot, holds it.
  tier: "low",
  menuLine: "Propose a new specialist bot when the user asks you to create or set up a bot (\"créame un bot que...\", \"hazme un bot para...\", \"make me a bot that...\"). It only shows a card; nothing is created until the user taps Create.",
  args,
  // Never asked for (a read), so no sheet shows it; the card is drawn from the offer's typed fields.
  describeAction: (a) => ({ title: "Propose a bot", lines: [{ label: "Name", labelKey: "name", value: String(a.name ?? "") }] }),
};
