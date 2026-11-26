import {
  findUrls, parseWebUrl, PRIVATE_GROUPS, readKind, registrableDomain, tierOf,
  type BotSources, type PermissionMode, type ReadKind, type Risk, type RiskTier, type SessionState, type SkillGroup, type ToolCall,
} from "@hermit/core";
import type { PolicyDecision } from "./policy.ts";

/**
 * Multi-bot (spec 6.4, 6.4.1): how a bot's grants, sources and permission mode settle the cage's decision. Pure, and it
 * takes only a type from policy.ts: `decide` works out today's decision and hands it here, so neither module runs the
 * other's code when it loads.
 */

/** The bot a turn runs for, as the cage needs it. Code sets it from the bot's row and the mode in effect. */
export interface BotCage {
  botId: string;
  primary: boolean;
  /** The mode in effect: the bot's own, or the global mode it inherits. */
  mode: PermissionMode;
  grants: readonly SkillGroup[];
  sources: BotSources;
}

/** What code knows about the called skill. `source`: a connector or MCP server id, set by code. */
export interface SkillFacts { tier?: RiskTier; group?: SkillGroup; source?: string }

const SEARCH = "search_web";

/** The primary bot holds every skill; another bot holds a skill through its group or its source, and nothing else. */
export function holds(bot: BotCage, skill: SkillFacts): boolean {
  if (bot.primary) return true;
  if (skill.group !== undefined) return bot.grants.includes(skill.group);
  if (skill.source !== undefined) return bot.sources.connectors.includes(skill.source);
  return false;
}

/**
 * The call reads from the bot's own sources: a page whose https host has a listed site as its registrable domain (a
 * look-alike host, plain http, or a site named anywhere else in the address never counts), or a listed connector. A
 * search never counts in wave 1: no alone turns exist yet, and wave 2 scopes a search to a listed site.
 */
export function inSources(call: ToolCall, skill: SkillFacts, sources: BotSources): boolean {
  if (call.skill === SEARCH) return false;
  if (skill.group === "web_read" || skill.group === "web_tasks") {
    const url = typeof call.args.url === "string" ? parseWebUrl(call.args.url) : undefined;
    const site = url?.scheme === "https" ? registrableDomain(url.host) : undefined;
    return site !== undefined && sources.sites.includes(site);
  }
  return skill.source !== undefined && sources.connectors.includes(skill.source);
}

/**
 * The call's `url` is, exactly, an address written in `text` (http or bare read as https). The call's side is the whole
 * argument, parsed as the fetch will use it (parseWebUrl's href), never an address found inside it: with anything after
 * a known address (a quote, `<`, `>`, a space, a backtick and whatever follows) it is another address, or none.
 */
export function urlInText(call: ToolCall, text: string | undefined): boolean {
  const url = typeof call.args.url === "string" ? parseWebUrl(call.args.url)?.url : undefined;
  if (!url || !text) return false;
  return findUrls(text).some((u) => parseWebUrl(u, { upgrade: true })?.url === url);
}

const NOT_GRANTED = "This bot doesn't have that permission.";
const MONEY = "Payments and logins never start from a bot's own work.";
const SPLIT = "Alone, a bot can't read private data and use the web in the same run. It waits as a suggestion.";
const SUGGEST = "No one is here to approve. It waits as a suggestion.";
const AUTO = "Auto runs low-risk steps without asking.";
const DONT_ASK = "Don't ask runs this without asking.";
const SOURCES = "Alone, a bot may read, keep notes and use its own sources.";

interface BotCall {
  call: ToolCall;
  risk: Risk;
  session: SessionState;
  bot: BotCage;
  skill: SkillFacts;
  /** The user's own words this turn. */
  userText?: string;
  /** What this turn's skills read from others (see `decide`). */
  readText?: string;
}

/**
 * Settles today's decision (`base`, where an unattended session's asks are still asks) for a bot, in this order:
 * 1. A skill the bot doesn't hold is denied, in every mode.
 * 2. Money and logins come before every tier step. In a chat, today's hard limits hold (the fingerprint and the
 *    signature, denied when tainted); alone, never, and a code-written note stands in (Q206).
 * 3. A deny stays a deny, in every mode.
 * 4. In a chat: Ask is today's rules; Auto runs a low step that would ask; Don't ask runs every step that would ask.
 * 5. Alone, Don't ask runs everything that's left.
 * 6. Alone, in Ask and Auto, a run that read private data can't use the web, and the other way round.
 * 7. Alone, in Ask and Auto: reads, notes, the private data the bot holds, and its own sites and connectors.
 * 8. Alone, Auto runs a low step anywhere, except a search in wave 1.
 * 9. The rest waits as a suggestion.
 * A step the mode let run without a sheet carries `byMode`; the loop binds it like an approval. When today's decision
 * already allows the step, it is returned as it is.
 */
export function decideForBot(base: PolicyDecision, input: BotCall): PolicyDecision {
  const { call, risk, session, bot, skill } = input;
  const alone = session.unattended;
  const run = (mode: PermissionMode, ruleId: string, reason: string): PolicyDecision =>
    base.effect === "ask" ? { ...base, effect: "allow", ruleId, reason, requireBiometric: false, byMode: mode } : base;

  if (!holds(bot, skill)) return deny("bot-not-granted", NOT_GRANTED); // 1
  if (risk === "spend" || risk === "credential") return alone ? deny("bot-alone-money", MONEY, "money_note") : base; // 2
  if (base.effect === "deny") return base; // 3
  if (bot.mode === "dont_ask") return run("dont_ask", "mode-dont-ask", DONT_ASK); // 4 (Don't ask) and 5
  const auto = bot.mode === "auto" && autoRuns(input);
  if (!alone) return auto ? run("auto", "mode-auto-low", AUTO) : base; // 4 (Ask, Auto)

  const kind = readKind(skill.group, skill.source);
  const other: ReadKind = kind === "private" ? "web" : "private";
  if (kind !== undefined && session.reads?.includes(other)) return deny("bot-alone-split", SPLIT, "suggestion"); // 6
  if (aloneAllowed(input)) return run(bot.mode, "bot-alone-sources", SOURCES); // 7
  if (auto && call.skill !== SEARCH) return run("auto", "mode-auto-low", AUTO); // 8
  return { ...deny("bot-alone-suggest", SUGGEST, "suggestion"), taintInfluenced: base.taintInfluenced }; // 9
}

/**
 * Auto runs a low step without asking. A link runs only when its exact address is in the user's words or in what this
 * turn read: an address the model wrote can carry the user's data out, so it asks as in Ask (alone, a suggestion). A
 * search sends its query only to the user's own provider.
 */
function autoRuns({ call, skill, userText, readText }: BotCall): boolean {
  if (tierOf(skill) !== "low") return false;
  const link = typeof call.args.url === "string" || (call.skill !== SEARCH && (skill.group === "web_read" || skill.group === "web_tasks"));
  return !link || urlInText(call, userText) || urlInText(call, readText);
}

/** What a bot may do alone in Ask and Auto (spec 6.4.1): read, save notes, read the private data it holds, use its sources. */
function aloneAllowed({ call, risk, skill, bot }: BotCall): boolean {
  if (risk === "read" || call.skill === "remember") return true;
  if (risk !== "network") return false;
  if (skill.group !== undefined && PRIVATE_GROUPS.includes(skill.group)) return true;
  return inSources(call, skill, bot.sources);
}

function deny(ruleId: string, reason: string, followUp?: PolicyDecision["followUp"]): PolicyDecision {
  return { effect: "deny", ruleId, reason, requireBiometric: false, taintInfluenced: false, ...(followUp ? { followUp } : {}) };
}
