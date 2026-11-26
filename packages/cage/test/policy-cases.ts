import {
  argsHash, SKILL_GROUPS, skillId,
  type BotSources, type PermissionMode, type Risk, type SessionState, type SkillGroup, type TaintSource, type ToolCall,
} from "@hermit/core";
import type { BotCage } from "../src/modes.ts";
import type { Effect } from "../src/policy.ts";

/** Fixtures shared by the policy tests and the modes tests. */

export const call = (skill: string, args: Record<string, unknown> = {}): ToolCall => ({
  id: "c1", skill: skillId(skill), args, argsHash: argsHash(args), repairs: [],
});
export const session = (over: Partial<SessionState> = {}): SessionState => ({ id: "s1", taint: [], unattended: false, ...over });

export const CLEAN = session();
export const WEB: TaintSource = { kind: "web", ref: "read_web", at: 1 };
export const PAY_CALL = call("pay");
export const WEB_PAY_CALL = call("web_pay");
export const REMEMBER_CALL = call("remember", { fact: "x" });

/** Bot b1, not the primary bot: by default it holds every group and lists no sources. */
export const cage = (mode: PermissionMode, grants: readonly SkillGroup[] = SKILL_GROUPS, sources: BotSources = { sites: [], connectors: [] }): BotCage => ({
  botId: "b1", primary: false, mode, grants, sources,
});

const DDG = "https://html.duckduckgo.com/html/";
const TAINTED = session({ taint: [WEB] });
const ALONE = session({ unattended: true });
const SEARCHED = session({ approvedSearchProviders: [DDG], taint: [WEB] });
const search = (query: string): ToolCall => ({ ...call("search_web", { query }), destination: DDG });
const SEND_CALL = call("reply_message", { conversationId: "c1", text: "voy tarde" });

export interface TodayCase {
  name: string;
  call: ToolCall;
  risk: Risk;
  session: SessionState;
  /** The user's own words this turn. */
  said?: string;
  /** `[effect, ruleId, requireBiometric, taintInfluenced]`, recorded from `decide` on master before bots reached the cage. */
  expected: [Effect, string, boolean, boolean];
}

/** Today's answers under the default rules, written as literals: a decision with no bot must never move from these. */
export const TODAY_CASES: readonly TodayCase[] = [
  { name: "a read", call: call("recall"), risk: "read", session: CLEAN, expected: ["allow", "read", false, false] },
  { name: "a send", call: SEND_CALL, risk: "send", session: CLEAN, expected: ["ask", "send-asks", true, false] },
  { name: "a remote write", call: call("mail_modify"), risk: "remote_write", session: CLEAN, expected: ["ask", "remote-write-asks", false, false] },
  { name: "a local write, clean", call: REMEMBER_CALL, risk: "local_write", session: CLEAN, expected: ["allow", "local-write", false, false] },
  { name: "a local write, tainted", call: REMEMBER_CALL, risk: "local_write", session: TAINTED, expected: ["ask", "local-write", false, true] },
  { name: "a fetch on a new domain", call: call("read_web", { url: "https://example.com/a" }), risk: "network", session: CLEAN, expected: ["ask", "network-asks", false, false] },
  {
    name: "a fetch on an approved domain", call: call("read_web", { url: "https://www.example.com/c?x=1" }), risk: "network",
    session: session({ approvedDomains: ["example.com"] }), expected: ["allow", "network-approved-domain", false, false],
  },
  {
    name: "a tainted search in the user's words", call: search("¡Vuelos   BARATOS!"), risk: "network", session: SEARCHED,
    said: "y ahora busca vuelos baratos", expected: ["allow", "network-approved-domain", false, false],
  },
  {
    name: "a tainted search not in the user's words", call: search("passport ends march 2027"), risk: "network", session: SEARCHED,
    said: "y ahora busca vuelos baratos", expected: ["ask", "network-approved-domain", false, true],
  },
  { name: "a spend, attended", call: PAY_CALL, risk: "spend", session: CLEAN, expected: ["deny", "hard-floor", false, false] },
  { name: "a spend, tainted", call: PAY_CALL, risk: "spend", session: TAINTED, expected: ["deny", "hard-tainted-money", false, true] },
  { name: "a spend, alone", call: PAY_CALL, risk: "spend", session: ALONE, expected: ["deny", "hard-unattended-money", false, false] },
  { name: "an unattended ask", call: SEND_CALL, risk: "send", session: ALONE, expected: ["deny", "send-asks", true, false] },
];
