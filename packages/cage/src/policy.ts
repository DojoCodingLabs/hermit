import { parseWebUrl, type PermissionMode, type Risk, type SessionState, type SkillId, type ToolCall } from "@hermit/core";
import { decideForBot, urlInText, type BotCage, type SkillFacts } from "./modes.ts";

export type Effect = "allow" | "deny" | "ask";

export interface PolicyRule {
  id: string;
  /** Matches a specific skill, or every skill. */
  skill: SkillId | "*";
  /** Optionally narrows the rule to one risk class. */
  risk?: Risk;
  /** Floor rules are evaluated first; nothing can loosen them. */
  floor?: boolean;
  when?(call: ToolCall, session: SessionState): boolean;
  effect: Effect;
  requireBiometric?: boolean;
}

export interface PolicyDecision {
  effect: Effect;
  ruleId: string;
  reason: string;
  requireBiometric: boolean;
  taintInfluenced: boolean;
  /**
   * The arguments that run instead of the call's, when the cage allowed only a narrower call (a tainted session's
   * search runs on the user's matched words). The caller runs these and hashes them for the audit.
   */
  args?: Record<string, unknown>;
  /**
   * SL-37 (FR-CAGE-06): spend and credential. The approval must be a signature by the Keystore approval key over the
   * canonical payload (`signed-approval.ts`); the JS proof doesn't count.
   */
  signedApproval?: true;
  /**
   * Multi-bot (spec 6.4.1): the permission mode that let a bot's step run without a sheet. The loop binds the step
   * like an approval (its summary built, an unresolved one blocked, logged as `mode.<mode>`).
   */
  byMode?: PermissionMode;
  /** Multi-bot: what a bot's denied step becomes: a suggestion card, or the code-written note for money and logins (Q206). */
  followUp?: "suggestion" | "money_note";
}

/** SL-40 (US-PAY-05): paying a person in USD₮. */
export const PAY = "pay" as SkillId;
/** SL-41 (US-PAY-07): paying a site that asked for x402, in USD₮. The same ledger, caps, sheet and signature as `pay`. */
export const PAY_MERCHANT = "pay_merchant" as SkillId;
/** The chat's spend skills, the only ones `withPay` opens. */
const PAY_SKILLS: readonly SkillId[] = [PAY, PAY_MERCHANT];

/** First-win defaults (spec §4.3). Spend and credential stay closed until their wave opens them (`withPay`). */
export function defaultRules(): PolicyRule[] {
  return [
    { id: "floor-no-spend", skill: "*", risk: "spend", floor: true, effect: "deny" },
    { id: "floor-no-credential", skill: "*", risk: "credential", floor: true, effect: "deny" },
    { id: "read", skill: "*", risk: "read", effect: "allow" },
    { id: "local-write", skill: "*", risk: "local_write", effect: "allow" },
    // FR-WEB-02: a fetch asks the first time per domain per session; the approval is remembered for that session.
    { id: "network-approved-domain", skill: "*", risk: "network", when: domainApproved, effect: "allow" },
    { id: "network-asks", skill: "*", risk: "network", when: (c, s) => !domainApproved(c, s), effect: "ask" },
    { id: "remote-write-asks", skill: "*", risk: "remote_write", effect: "ask" },
    { id: "send-asks", skill: "*", risk: "send", effect: "ask", requireBiometric: true },
  ];
}

/**
 * SL-40 (US-PAY-05, PDR-011): a payment always asks, with a strong biometric that unlocks one Keystore signature over
 * the exact payload (the hard limits add the signature and deny it in tainted or unattended sessions). There is no
 * "approve for the session" for money, ever.
 */
export function payRules(): PolicyRule[] {
  return [
    { id: "pay-asks", skill: PAY, risk: "spend", effect: "ask", requireBiometric: true },
    { id: "pay-merchant-asks", skill: PAY_MERCHANT, risk: "spend", effect: "ask", requireBiometric: true },
  ];
}

/**
 * The rules with `pay` and `pay_merchant` opened: the spend floor is narrowed to every other skill, and both ask. Only
 * the chat's own turns use this; the night shift, the morning suggestions and web tasks keep the floor.
 */
export function withPay(rules: readonly PolicyRule[]): PolicyRule[] {
  return [
    ...rules.map((r) => (r.id === "floor-no-spend" ? { ...r, when: (c: ToolCall, s: SessionState) => !PAY_SKILLS.includes(c.skill) && (r.when?.(c, s) ?? true) } : r)),
    ...payRules(),
  ];
}

/**
 * SL-35 (US-FORM-01, Q79): filling another app's form from the profile. It is never on the model's menu: Android's
 * autofill service asks, the app builds this call from the request, and the cage decides it like any other action.
 * Profile details leave Hermit for another app, so it is a `send`. It always asks; a fill with a sensitive field
 * (`args.sensitive`, set by code from the profile) asks with the fingerprint (US-FORM-03), and with nobody on screen
 * the ask becomes a deny, so a night pass never fills.
 */
export const FILL_FORM = "fill_form" as SkillId;

export function fillRules(): PolicyRule[] {
  return [
    { id: "fill-sensitive-asks", skill: FILL_FORM, risk: "send", when: (c) => c.args.sensitive === true, effect: "ask", requireBiometric: true },
    { id: "fill-asks", skill: FILL_FORM, risk: "send", when: (c) => c.args.sensitive !== true, effect: "ask" },
  ];
}

/**
 * SL-36 (US-FORM-02, FR-VAULT-04): logging in to a site or an app with a vault login, offered by Android's autofill
 * service only where the requester's verified identity equals a stored origin exactly. Like `fill_form` it is never on
 * the model's menu. It is a `credential`: the hard limits deny it in a tainted or unattended session and otherwise
 * ask with a strong biometric that unlocks one Keystore signature over the exact payload (FR-CAGE-06, SL-37).
 */
export const FILL_LOGIN = "fill_login" as SkillId;

export function loginRules(): PolicyRule[] {
  return [{ id: "login-asks", skill: FILL_LOGIN, risk: "credential", effect: "ask", requireBiometric: true }];
}

/**
 * SL-53 (US-WEB-07 to US-WEB-09, FR-WEB-06 to FR-WEB-09): a web task in the in-app browser. None of these is on the
 * model's menu: the model picks a recipe and fills its parameters, and the task runner builds each call from the recipe
 * and the live page, in the task's own session (never the chat's, but carrying its taint).
 * - web_task: open the recipe's site. The plan on HM-WEB-02 shows the site and every value; Start is the approval.
 * - web_step: a step that commits nothing (open a page, type, pick, click a link), only on the task's exact origin.
 * - web_submit: a click that submits, books, sends or deletes (`remote_write`): it asks every time.
 * - web_signin: a sign-in or grant click (`credential`): fingerprint and Keystore signature, denied when tainted.
 * - web_pay: a pay click (`spend`). Floor-denied in V1 (Q121): Hermit stops and the user pays with their own taps.
 * - web_read: the page as text to the quarantined reader (FR-WEB-03).
 * - web_repair: one failed step's candidates (the page's names for elements of that role) to the model, which picks
 *   one (FR-WEB-10). A local read that taints the task: every later step asks.
 * - web_code (SL-56b, Q138): a one-time code from the SMS the user allowed or the site's email, typed into the page's
 *   one code field on the task's own origin (`credential`): fingerprint and Keystore signature, denied when tainted.
 * Nothing in a task runs unattended: every one of them is floor-denied with nobody on screen.
 */
export const WEB_TASK = "web_task" as SkillId;
export const WEB_STEP = "web_step" as SkillId;
export const WEB_SUBMIT = "web_submit" as SkillId;
export const WEB_SIGNIN = "web_signin" as SkillId;
export const WEB_PAY = "web_pay" as SkillId;
export const WEB_READ = "web_read" as SkillId;
export const WEB_REPAIR = "web_repair" as SkillId;
export const WEB_CODE = "web_code" as SkillId;
const WEB_SKILLS = [WEB_TASK, WEB_STEP, WEB_SUBMIT, WEB_SIGNIN, WEB_PAY, WEB_READ, WEB_REPAIR, WEB_CODE];

export function webTaskRules(): PolicyRule[] {
  const onOrigin = (c: ToolCall) => typeof c.args.origin === "string" && c.args.origin === c.args.taskOrigin;
  return [
    ...WEB_SKILLS.map((skill): PolicyRule => ({ id: "floor-web-unattended", skill, floor: true, when: (_c, s) => s.unattended, effect: "deny" })),
    { id: "web-pay-yourself", skill: WEB_PAY, risk: "spend", floor: true, effect: "deny" },
    { id: "web-open-asks", skill: WEB_TASK, risk: "network", effect: "ask" },
    { id: "web-step-on-origin", skill: WEB_STEP, risk: "network", when: onOrigin, effect: "allow" },
    { id: "web-submit-asks", skill: WEB_SUBMIT, risk: "remote_write", effect: "ask" },
    { id: "web-signin-asks", skill: WEB_SIGNIN, risk: "credential", effect: "ask", requireBiometric: true },
    { id: "web-read", skill: WEB_READ, risk: "read", effect: "allow" },
    { id: "web-repair", skill: WEB_REPAIR, risk: "read", effect: "allow" },
    { id: "web-code-asks", skill: WEB_CODE, risk: "credential", when: onOrigin, effect: "ask", requireBiometric: true },
    ...loginRules(),
    ...fillRules(),
  ];
}

/**
 * The call goes somewhere the user approved in this session, read from the list that belongs to its skill only.
 * search_web: the code-set destination (the provider in settings) is, exactly, a provider address approved for
 * searching. Every other network skill: its `url` is on a domain approved for reading pages. A search approval never
 * opens pages and a page approval never approves a search. Anything that isn't an https address never counts.
 */
export function domainApproved(call: ToolCall, session: SessionState): boolean {
  if (call.skill === "search_web") {
    const dest = call.destination;
    return dest !== undefined && parseWebUrl(dest)?.scheme === "https" && (session.approvedSearchProviders ?? []).includes(dest);
  }
  const url = typeof call.args.url === "string" ? parseWebUrl(call.args.url) : undefined;
  return url?.scheme === "https" && (session.approvedDomains ?? []).includes(url.domain);
}

/** The call's `url` is, exactly, an address the user wrote in their own words this turn (http or bare read as https). */
export function urlInUserWords(call: ToolCall, userText: string | undefined): boolean {
  return urlInText(call, userText);
}

const words = (text: string) => text.normalize("NFC").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();

/** Letters, digits, spaces and the punctuation of a sentence: nothing an address or an encoding is made of. */
const PLAIN = /^[\p{L}\p{N} \t\n.,;:!?¿¡'"()-]*$/u;

/**
 * The query to send in place of the call's `query` (search_web) when it is, word for word, in what the user wrote
 * this turn: its lowercase words, the very string that was matched. Undefined when it isn't the user's words, or has
 * anything beyond plain words and sentence punctuation (`?email=me@x.com`, `%65`, `+`), which the match would ignore.
 */
export function queryInUserWords(call: ToolCall, userText: string | undefined): string | undefined {
  if (typeof call.args.query !== "string" || userText === undefined) return undefined;
  const raw = call.args.query.normalize("NFC");
  const query = words(raw);
  if (!query || !PLAIN.test(raw)) return undefined;
  return ` ${words(userText)} `.includes(` ${query} `) ? query : undefined;
}

const REASONS: Record<Effect, string> = {
  allow: "Allowed by your rules.",
  ask: "Needs your approval.",
  deny: "Blocked by your rules.",
};

/**
 * Deny wins: floor rules first, then any matching deny, then ask, then allow.
 * No matching rule means deny. Then the hard limits, which no rule set can loosen:
 * spend and credential are denied when tainted or unattended and otherwise ask for a Keystore-signed approval, a send or a remote write is never allowed without asking, a tainted
 * session's local writes ask, a tainted session's fetches ask unless the user wrote that exact address (or search
 * query) this turn, a call whose recipient code found by name always asks (PDR-028: the user checks it's the right person),
 * and an unattended session can never ask, so its asks become denies.
 * `context.userText` is the user's own words this turn, never tool output. `context.foundByName` is set by the loop,
 * never by the model, when a number or address in the call came from the contacts or past recipients.
 *
 * Multi-bot (spec 6.4.1): with `context.bot`, that decision is settled by the bot's grants, sources and permission
 * mode (`decideForBot`, modes.ts), and an unattended session's asks are left for the mode. `context.skill` is what code
 * knows about the skill (its tier, group and source). `context.readText` is what this turn's skills brought in from
 * others (pages, messages, mail), set by the loop: never the user's words, and never text the model can write itself
 * (its notes, reminders or events), which would let it launder an address. Auto opens a link without asking only when
 * its exact address is there or in `context.userText`. Without a bot, the decision is exactly today's.
 */
export function decide(
  call: ToolCall,
  risk: Risk,
  session: SessionState,
  rules: PolicyRule[],
  context: { userText?: string; readText?: string; foundByName?: boolean; bot?: BotCage; skill?: SkillFacts } = {},
): PolicyDecision {
  if (!context.bot) return decideBase(call, risk, session, rules, context);
  const base = decideBase(call, risk, session, rules, context, { keepAsks: true });
  return decideForBot(base, {
    call, risk, session, bot: context.bot, skill: context.skill ?? {}, userText: context.userText, readText: context.readText,
  });
}

/** Today's decision. `keepAsks` leaves an unattended session's asks as asks, for a bot's mode to settle. */
function decideBase(
  call: ToolCall,
  risk: Risk,
  session: SessionState,
  rules: PolicyRule[],
  context: { userText?: string; foundByName?: boolean },
  opts: { keepAsks?: boolean } = {},
): PolicyDecision {
  const matches = rules.filter(
    (r) => (r.skill === "*" || r.skill === call.skill) && (r.risk === undefined || r.risk === risk) && (r.when?.(call, session) ?? true),
  );
  const ordered = [...matches.filter((r) => r.floor), ...matches.filter((r) => !r.floor)];
  const pickRule = (effect: Effect) => ordered.find((r) => r.effect === effect);
  const floorDeny = ordered.find((r) => r.floor && r.effect === "deny");
  const rule = floorDeny ?? pickRule("deny") ?? pickRule("ask") ?? pickRule("allow");

  let decision: PolicyDecision = rule
    ? { effect: rule.effect, ruleId: rule.id, reason: REASONS[rule.effect], requireBiometric: rule.requireBiometric ?? false, taintInfluenced: false }
    : { effect: "deny", ruleId: "default-deny", reason: "No rule allows this.", requireBiometric: false, taintInfluenced: false };

  // Hard limits (spec §4.3): no rule set can loosen these.
  // FR-CAGE-02 and FR-CAGE-06 (SL-37): money and passwords are denied when tainted or unattended (the night shift
  // never gets these approvals); otherwise they never run without asking, with a strong biometric that unlocks one
  // Keystore signature over the exact payload. The default rules keep them closed until their wave opens them.
  if (risk === "spend" || risk === "credential") {
    if (session.unattended) {
      return { effect: "deny", ruleId: "hard-unattended-money", reason: "No one is here to approve.", requireBiometric: false, taintInfluenced: false };
    }
    if (session.taint.length > 0) {
      return {
        effect: "deny", ruleId: "hard-tainted-money", reason: "Payments and passwords are blocked after reading content from others.",
        requireBiometric: false, taintInfluenced: true,
      };
    }
    if (decision.effect === "deny") {
      return rule?.floor ? { ...decision, ruleId: "hard-floor", reason: "Payments and passwords aren't available yet." } : decision;
    }
    return {
      effect: "ask", ruleId: decision.ruleId, requireBiometric: true, taintInfluenced: false, signedApproval: true,
      reason: risk === "spend" ? "Payments always need your fingerprint." : "Passwords always need your fingerprint.",
    };
  }
  if (risk === "send" && decision.effect === "allow") {
    const tainted = session.taint.length > 0;
    decision = {
      ...decision,
      effect: "ask",
      requireBiometric: true,
      taintInfluenced: tainted,
      reason: tainted ? "Suggested after reading untrusted content. Needs your approval." : "Sending always needs your approval.",
    };
  }
  // Changes off the phone always ask, like a send but without the fingerprint (FR-CAGE-02).
  if (risk === "remote_write" && decision.effect === "allow") {
    const tainted = session.taint.length > 0;
    decision = {
      ...decision,
      effect: "ask",
      taintInfluenced: tainted,
      reason: tainted ? "Suggested after reading untrusted content. Needs your approval." : "Changes outside your phone always need your approval.",
    };
  }
  // Writes suggested after reading other people's text (saving, forgetting, scheduling) ask first.
  if (risk === "local_write" && session.taint.length > 0 && decision.effect === "allow") {
    decision = { ...decision, effect: "ask", taintInfluenced: true, reason: "Suggested after reading untrusted content. Needs your approval." };
  }
  // A fetch is a way out: after reading others' text, an address on an approved domain can still carry data in it
  // ("https://site/?q=<secret>"), and so can a search query. Only an address or a query the user wrote this turn
  // keeps the approval, and a query runs as the user's words that were matched, never as the model wrote it.
  if (risk === "network" && session.taint.length > 0 && decision.effect === "allow") {
    const ownUrl = urlInUserWords(call, context.userText);
    const ownQuery = ownUrl ? undefined : queryInUserWords(call, context.userText);
    if (ownQuery !== undefined) decision = { ...decision, args: { ...call.args, query: ownQuery } };
    else if (!ownUrl) {
      decision = { ...decision, effect: "ask", taintInfluenced: true, reason: "Suggested after reading untrusted content. Needs your approval." };
    }
  }
  // A name can match the wrong person (two Carloses, a contact saved under an old number): the sheet shows the exact
  // number or address and where it came from, and nothing opens or sends until the user says yes.
  if (context.foundByName && decision.effect === "allow") {
    decision = { ...decision, effect: "ask", reason: "Hermit found this person by name. Check it's the right one." };
  }
  if (session.unattended && decision.effect === "ask" && !opts.keepAsks) {
    decision = { ...decision, effect: "deny", reason: "No one is here to approve." };
  }
  return decision;
}
