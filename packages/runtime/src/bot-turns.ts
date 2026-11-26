import { heldGroups, type Bot, type PermissionMode, type ReadKind, type SkillDef } from "@hermit/core";
import { holds, type BotCage } from "@hermit/cage";
import type { BotRole } from "@hermit/model";

/**
 * Multi-bot (spec 6.6): what one turn is built from, for the bot it runs as. Each turn builds its own, so nothing a turn
 * reads, offers or caches reaches another turn through shared state: two bots' turns through the queue keep their own.
 */
export interface BotTurn {
  bot: Bot;
  /** The bot as the cage decides it: its grants, its sources and the mode in effect. */
  cage: BotCage;
  /** The fixed skills it holds: the model's menu. */
  menu: SkillDef[];
  /** The fixed skills it doesn't hold: never offered, and code answers when only one of them fits (HM-BOT-02.withheld). */
  withheld: SkillDef[];
  /** Absent for Hermit, whose prompts stay byte for byte today's. */
  role?: BotRole;
  /** Its own notes and the shared profile, as the prompt's lines (FR-MEM-06). */
  profile: string[];
  /** What the notes in `profile` were read from: the turn's session has read that too (security review 00:40). */
  profileReads: ReadKind[];
  /** `hermit-v1:<botId>` (spec 6.6). */
  cacheKey: string;
}

/** The bot as the cage sees it: it inherits the global mode until it has its own (spec 6.4.1), and Hermit holds every group. */
export function cageFor(bot: Bot, globalMode: PermissionMode): BotCage {
  return { botId: bot.id, primary: bot.primary, mode: bot.mode ?? globalMode, grants: [...heldGroups(bot)], sources: bot.sources };
}

/**
 * The skills the bot holds, by their group or, for a connector's or an MCP server's, by their source (`sourceOf`), and
 * the ones it doesn't, which are never offered (spec 6.4): the cage would deny them anyway, and the loop resolves a
 * person's name for an offered skill before the cage decides.
 */
export function botMenu(defs: readonly SkillDef[], cage: BotCage, sourceOf: (def: SkillDef) => string | undefined = () => undefined): { menu: SkillDef[]; withheld: SkillDef[] } {
  const menu: SkillDef[] = [];
  const withheld: SkillDef[] = [];
  for (const def of defs) (holds(cage, { group: def.group, source: sourceOf(def) }) ? menu : withheld).push(def);
  return { menu, withheld };
}

/** The bot's role for its prompts. Hermit has none in wave 1: its own role text is ignored, so its prompts stay today's. */
export function roleFor(bot: Bot): BotRole | undefined {
  return bot.primary ? undefined : { name: bot.name, text: bot.role };
}
