import type { FoundPerson } from "./people.ts";
import type { SignedApprovalTerms } from "./approval-key.ts";
import type { ReadKind, RiskTier, SkillGroup } from "./bots.ts";

export type SkillId = string & { readonly __brand: "SkillId" };

export const skillId = (id: string): SkillId => id as SkillId;

/**
 * What a skill can do to the world. Policy keys off this (CT-05, FR-CAGE-02).
 * - read: reads data already on the phone.
 * - local_write: changes data on the phone (notes, reminders, calendar, intents).
 * - network: reads from the network (web pages, mail, connector reads).
 * - remote_write: changes something off the phone that isn't a message (archive mail, submit a form, connector writes).
 * - send: a message leaves the phone in the user's name.
 * - credential: a password or token is used.
 * - spend: money moves.
 */
export type Risk = "read" | "local_write" | "network" | "remote_write" | "send" | "credential" | "spend";

export const RISKS: readonly Risk[] = ["read", "local_write", "network", "remote_write", "send", "credential", "spend"];

export type JsonSchema = Record<string, unknown>;

/**
 * HM-APPR-01: the id of a line label Hermit's own skill code wrote. The sheet shows `HM-APPR-01.label.<id>` in the
 * user's language; `label` stays the English text the model and the audit read. Set in code only, next to the
 * literal label, and never derived from a label's text: a connector's or MCP tool's argument named "Amount" or "To"
 * has no `labelKey` and is shown as the tool's own field. Lines type it as a string (literals in nested arrays widen);
 * the app's test checks every labelKey in code is one of these ids.
 */
export type SummaryLabelId =
  | "to" | "message" | "account" | "cc" | "change" | "destination" | "email" | "emailN" | "ends" | "event" | "fact" | "forget"
  | "forwarding" | "from" | "host" | "howMany" | "label" | "lookingFor" | "name" | "newRecipient" | "number" | "page"
  | "phone" | "provider" | "reminder" | "request" | "search" | "senderName" | "server" | "service" | "site" | "starts"
  | "subject" | "text" | "time" | "tool" | "when" | "which";

/**
 * HM-APPR-01: the id of a fixed value Hermit's own skill code wrote ("All connected accounts", "Unread", "You pick the
 * chat in WhatsApp"). The sheet shows `HM-APPR-01.value.<id>` in the user's language; `value` stays the English text
 * the model and the audit read. Set in code only, next to the literal, never derived from a value's text: a value from
 * the arguments, the user's words or a tool is shown as it is, and a connector's or MCP tool's line never gets one.
 */
export type SummaryValueId =
  | "allAccounts" | "everyone" | "mostRecent" | "unread" | "pickChatWhatsapp" | "pickPersonApp" | "addRecipientApp"
  | "pickNumberDialer" | "archive" | "markRead" | "addLabel";

export interface ApprovalSummary {
  title: string;
  /**
   * `flag` marks a line the sheet must call out in its own words: a recipient not seen before (FR-MAIL-04), or where
   * a number or address found by name came from (PDR-028: "from your contacts", "you emailed before").
   */
  lines: Array<{
    label: string; value: string; flag?: SummaryFlag; labelKey?: SummaryLabelId | (string & {}); labelVars?: Record<string, string>;
    valueKey?: SummaryValueId | (string & {});
  }>;
  /**
   * Set when trusted data can't say who or what the action reaches (an unknown conversation).
   * The loop refuses the call instead of asking: a person can't approve what the sheet can't show.
   */
  unresolved?: string;
  /**
   * The exact identity the sheet showed (recipient id and name). The executor re-resolves it at send time
   * and refuses on any mismatch, so what runs is what was approved even if data changed meanwhile.
   */
  binding?: string;
}

export type SummaryFlag = "new_recipient" | "from_contacts" | "emailed_before"
  /**
   * SL-40 (HM-APPR-02): the payment sheet's lines, so the sheet labels them in the user's language: the amount, the
   * recipient's full address, a saved payee's name, the network, the fee estimate and what the daily cap leaves.
   */
  | "pay_amount" | "pay_to" | "pay_payee" | "pay_typed" | "pay_network" | "pay_fee" | "pay_cap_left"
  /**
   * SL-41 (HM-APPR-02 for an x402 purchase): the merchant's host and the page the user asked for, and how long the
   * signed authorization can settle.
   */
  | "pay_site" | "pay_page" | "pay_valid";

/**
 * Trusted data the app supplies when rendering an approval. Anything shown on
 * the approval sheet comes from here or from the exact args, never from model prose.
 */
export interface RenderContext {
  conversation(id: string): { name: string; address: string } | undefined;
  /** Mail accounts and the messages the user was shown (SL-49). Absent until a mail account is wired. */
  mail?: MailRenderContext;
  /** The search provider chosen in settings (US-WEB-03). Absent when search is off. */
  search?: { label: string; base: string; domain: string };
  /** Numbers and addresses code found by name for this call (PDR-028), so the sheet says where each came from. */
  found?: readonly FoundPerson[];
}

/** A connected mail account as the send sheet shows it (US-MAIL-08). Never holds a secret. */
export interface MailRenderAccount {
  id: string;
  address: string;
  /** The address and its label, as the user named it ("ana@work.com (work)"). */
  name: string;
}

/** A message mail_list or mail_search showed, by its short id: headers only, as the provider gave them. */
export interface MailRenderMessage {
  ref: string;
  accountId: string;
  from: string;
  subject: string;
}

/**
 * Trusted mail data for the send, draft and organize sheets (FR-MAIL-04, CT-06): the accounts, the messages
 * code handed out short ids for, and which addresses the user already wrote to.
 */
export interface MailRenderContext {
  /** The account that sends, from the optional account argument; the first connected one when none is named. */
  sender(wanted: unknown): { ok: true; account: MailRenderAccount } | { ok: false; reason: string };
  account(id: string): MailRenderAccount | undefined;
  message(ref: string): MailRenderMessage | undefined;
  /** The short ids the last mail_list or mail_search showed, in order. */
  shown(): string[];
  /**
   * The address is the user's own account, one the user sent mail to (an approved send the provider accepted)
   * or one the user typed in the app. An address seen only in incoming headers is never known.
   */
  known(address: string): boolean;
}

/** A menu entry. Execution is bound in the app, behind the cage. */
export interface SkillDef<A = Record<string, unknown>> {
  id: SkillId;
  /** The tool description the model sees: when to use it, with trigger phrases (at most 300 characters). */
  menuLine: string;
  version: number;
  args: JsonSchema;
  risk: Risk;
  /** Output can carry attacker-controlled text, so it taints the session. */
  producesUntrusted: boolean;
  /** Pure rendering of the exact action for the approval sheet. Never written by the model. */
  describeAction(args: A, ctx: RenderContext): ApprovalSummary;
  /**
   * Deterministic correction of validated arguments from the user's own words (times and dates read by
   * code, harness-diagnosis.md). Returns the args to use and a note per change, for the activity log.
   * Runs before the cage, so approvals bind the corrected arguments.
   */
  normalize?(args: A, ctx: NormalizeContext): { args: A; notes: string[] };
  /**
   * The argument that names who the action reaches, when a name the user said may stand for it (PDR-028). Code
   * resolves the name from the phone's contacts or the people the user emailed before; the model never does.
   * `required`: the action can't run without one, so Hermit asks the user when nothing is found.
   */
  recipient?: { field: string; kind: "phone" | "email"; required?: boolean };
  /**
   * SL-37 (FR-CAGE-06): for spend and credential skills, what the Keystore signature covers besides the args hash,
   * read by code from the exact arguments: the amount (USD₮ only) and recipient of a payment, the site of a password.
   * A spend or credential skill without it can't be approved.
   */
  approvalTerms?(args: A): SignedApprovalTerms;
  /** Risk tier, set by code; a skill without one is high (tierOf). */
  tier?: RiskTier;
  /** The permission group this skill belongs to; a skill outside a bot's groups is denied in code. */
  group?: SkillGroup;
}

export interface NormalizeContext {
  /** The user's latest message, never tool output. */
  userText: string;
  /** The user's earlier messages in this session, newest first (their own words only, never tool output). */
  earlier?: string[];
  now: number;
  timeZone: string;
}

export interface ToolCall {
  id: string;
  skill: SkillId;
  args: Record<string, unknown>;
  argsHash: string;
  repairs: string[];
  /**
   * The https address the call contacts when it isn't in its args (search_web's provider, US-WEB-03). Set by code
   * from settings, never by the model, once per call: the cage decides on it and the skill refuses to contact
   * anything else (FR-WEB-02).
   */
  destination?: string;
}

export interface TaintSource {
  kind: "web" | "email" | "inbound_message" | "file" | "notification" | "bot";
  ref: string;
  at: number;
}

export interface SessionState {
  id: string;
  /** Sticky for the session until the user clears it. */
  taint: TaintSource[];
  /** No human present (background work): asks become denies. */
  unattended: boolean;
  /**
   * Web domains the user approved a fetch from in this session (FR-WEB-02): later fetches from them don't ask.
   * Held in memory by the runtime, so a new session or a restart asks again.
   */
  approvedDomains?: string[];
  /**
   * Search providers (their exact base address) the user approved a search_web call to in this session (US-WEB-03).
   * Its own list: a search approval never opens pages on the provider's site, and a page approval never approves
   * searching. Held in memory like approvedDomains.
   */
  approvedSearchProviders?: string[];
  /** The bot this session belongs to; Hermit's when absent. */
  botId?: string;
  /** What this session has read so far (private data, the web). Held in memory only. */
  reads?: ReadKind[];
}

export interface Msg {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  untrusted?: boolean;
  /**
   * W1: on a tool result, the reply code wrote from what the action really did or found (a confirmation, a listing),
   * in the user's language. The model port answers with it once nothing more is owed; the model never sees it, and it
   * isn't kept past the turn.
   */
  answer?: string;
}
