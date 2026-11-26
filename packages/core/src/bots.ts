import { parseWebUrl } from "./web.ts";
import { registrableDomain } from "./site-domain.ts";

/** Multi-bot contracts (wave 1): the shapes every track builds against. */

export const HERMIT_BOT_ID = "hermit";
/** Hermit included. */
export const MAX_BOTS = 50;
export const MAX_PINS = 2;
export const MAX_BOT_NAME_CHARS = 40;
export const MAX_ROLE_CHARS = 800;

export type PermissionMode = "ask" | "auto" | "dont_ask";
export const PERMISSION_MODES: readonly PermissionMode[] = ["ask", "auto", "dont_ask"];

export type RiskTier = "low" | "medium" | "high";

/** Group ids name permissions, not skills: the group "web_read" is not the web task's skill "web_read" (policy.ts WEB_READ). */
export type SkillGroup =
  | "calendar" | "reminders" | "notes" | "messages_read" | "messages_reply" | "mail_read" | "mail_send"
  | "web_read" | "web_tasks" | "contacts" | "apps" | "vault_logins" | "wallet_pay";
export const SKILL_GROUPS: readonly SkillGroup[] = [
  "calendar", "reminders", "notes", "messages_read", "messages_reply", "mail_read", "mail_send",
  "web_read", "web_tasks", "contacts", "apps", "vault_logins", "wallet_pay",
];
/** Granting one of these (or turning on Don't ask) needs the fingerprint. */
export const FINGERPRINT_GROUPS: readonly SkillGroup[] = ["vault_logins", "mail_send", "wallet_pay"];
/**
 * Groups no bot may hold yet: no skill carries them in wave 1, so HM-BOT-03 doesn't show them. Hermit's create_bot never
 * proposes them, and creating or changing a bot refuses them: the user never grants what the screens don't show.
 */
export const RESERVED_GROUPS: readonly SkillGroup[] = ["vault_logins"];
/** Groups that read the user's private data. */
export const PRIVATE_GROUPS: readonly SkillGroup[] = ["messages_read", "mail_read", "calendar", "contacts"];

export const SHELL_SHAPES = ["whelk", "moon", "turban", "conch", "auger", "nerite"] as const;
/** Ids; the app gives each a light and a dark fill. */
export const SHELL_COLORS = ["sand", "stone", "seaglass", "ink"] as const;
export interface BotLook { shape: (typeof SHELL_SHAPES)[number]; color: (typeof SHELL_COLORS)[number] }

/** `sites`: registrable domains; `connectors`: connector or MCP server ids. */
export interface BotSources { sites: string[]; connectors: string[] }

export interface Bot {
  id: string;
  name: string;
  role: string;
  primary: boolean;
  /** Absent for Hermit, who wears the crab. */
  look?: BotLook;
  pinOrder: number | null;
  hidden: boolean;
  notify: boolean;
  /** null: inherits the global mode. */
  mode: PermissionMode | null;
  grants: SkillGroup[];
  sources: BotSources;
  createdAt: number;
}

export interface ChatSummary { id: string; title?: string; startedAt: number; lastAt: number }

export type ReadKind = "private" | "web";

/** A skill without a tier is high: risk tiers are code, never the model's call. */
export function tierOf(def: { tier?: RiskTier }): RiskTier {
  return def.tier ?? "high";
}

/** What a read brings in: private data from a private group, the web from web groups and every connector or MCP source. */
export function readKind(group: SkillGroup | undefined, source: string | undefined): ReadKind | undefined {
  if (group !== undefined && PRIVATE_GROUPS.includes(group)) return "private";
  if (group === "web_read" || group === "web_tasks") return "web";
  if (source !== undefined) return "web";
  return undefined;
}

export function heldGroups(bot: Pick<Bot, "primary" | "grants">): readonly SkillGroup[] {
  return bot.primary ? SKILL_GROUPS : bot.grants;
}

/** "https://www.Wikivoyage.org/x" becomes "wikivoyage.org"; an IP or a bare suffix gives undefined. */
export function normalizeSite(input: string): string | undefined {
  const url = parseWebUrl(input, { upgrade: true });
  return url ? registrableDomain(url.host) : undefined;
}

/**
 * The one fingerprint rule: a FINGERPRINT_GROUPS group newly held, or the mode becoming dont_ask. Which mode counts:
 * - on create and duplicate, the bot's own mode only. A bot with none inherits the global mode, which took the typed word
 *   and the fingerprint when it was set to Don't ask, so its mode brings nothing new;
 * - setBot compares the bot's own mode before and after, and setGlobal the global mode. The global a bot inherits never
 *   counts, since a bot's own Don't ask outlives the global going down.
 * No `before` means nothing before: a new bot, or a bot with no mode of its own.
 */
export function needsFingerprint(
  next: { grants: readonly SkillGroup[]; mode: PermissionMode },
  before?: { grants: readonly SkillGroup[]; mode: PermissionMode },
): boolean {
  const newGroup = FINGERPRINT_GROUPS.some((g) => next.grants.includes(g) && !before?.grants.includes(g));
  const newDontAsk = next.mode === "dont_ask" && before?.mode !== "dont_ask";
  return newGroup || newDontAsk;
}
