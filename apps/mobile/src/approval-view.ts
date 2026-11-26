/**
 * HM-APPR-01: the pure parts of the approval sheet, tested on Node. A skill's describeAction writes its line labels in
 * English (what the model and the audit read) and, for each label Hermit's own code wrote, a `labelKey` set next to
 * it. The sheet shows only those in its own words; the key is never derived from a label's text, so a connector's or
 * MCP tool's argument named "Amount" or "To" can't borrow a Hermit label: it is shown as that tool's own field.
 */
import type { SummaryFlag, SummaryLabelId, SummaryValueId } from "@hermit/core";
import { payLineKey } from "./pay-view.ts";

/** Every SummaryLabelId (@hermit/core), each `HM-APPR-01.label.<id>` in both locales. */
export const SUMMARY_LABEL_IDS: readonly SummaryLabelId[] = [
  "to", "message", "account", "cc", "change", "destination", "email", "emailN", "ends", "event", "fact", "forget", "forwarding",
  "from", "host", "howMany", "label", "lookingFor", "name", "newRecipient", "number", "page", "phone", "provider",
  "reminder", "request", "search", "senderName", "server", "service", "site", "starts", "subject", "text", "time",
  "tool", "when", "which",
];

/** Every SummaryValueId (@hermit/core): the fixed values Hermit's skills write, each `HM-APPR-01.value.<id>` in both locales. */
export const SUMMARY_VALUE_IDS: readonly SummaryValueId[] = [
  "allAccounts", "everyone", "mostRecent", "unread", "pickChatWhatsapp", "pickPersonApp", "addRecipientApp", "pickNumberDialer",
  "archive", "markRead", "addLabel",
];

/** The only skills whose flagged lines may carry HM-APPR-02's payment words. */
export const PAY_SKILLS: ReadonlySet<string> = new Set(["pay", "pay_merchant"]);

/** A connector operation (`conn_<id>_<op>`) or an MCP server's tool (`mcp_<server>_<tool>`): someone else's tool. */
export const isToolSkill = (skill: string) => /^(mcp|conn)_/.test(skill);

/** The labels the connector and MCP runtimes write themselves (who is reached, what is called), not the tool's. */
const TOOL_OWN_LABELS: ReadonlySet<string> = new Set<SummaryLabelId>(["host", "request", "server", "tool"]);

export interface SheetLine {
  label: string;
  flag?: SummaryFlag;
  labelKey?: string;
  labelVars?: Record<string, string>;
}

/** A label in copy (`key`), or the line's own text shown as it is (`text`). */
export type LineLabel = { key: string; vars?: Record<string, string> } | { text: string };

const own = (id: string | undefined): id is SummaryLabelId => id !== undefined && (SUMMARY_LABEL_IDS as readonly string[]).includes(id);

/** What a sheet line's label says, decided by which skill asks, the line's flag and its labelKey, never its text. */
export function lineLabel(skill: string, line: SheetLine): LineLabel {
  if (isToolSkill(skill)) {
    // The runtime's own lines (server, tool, host, request) in Hermit's words; every other line, flags included, is
    // the tool's own field, marked as such.
    if (own(line.labelKey) && TOOL_OWN_LABELS.has(line.labelKey)) return { key: `HM-APPR-01.label.${line.labelKey}` };
    return { key: "HM-APPR-01.toolField", vars: { name: line.label } };
  }
  const payKey = PAY_SKILLS.has(skill) ? payLineKey(line.flag) : undefined;
  if (payKey) return { key: payKey };
  if (line.flag === "from_contacts") return { key: "HM-APPR-01.fromContacts" };
  if (line.flag === "emailed_before") return { key: "HM-APPR-01.emailedBefore" };
  if (own(line.labelKey)) return { key: `HM-APPR-01.label.${line.labelKey}`, ...(line.labelVars ? { vars: line.labelVars } : {}) };
  return { text: line.label };
}

/** A line's value in copy (`key`), or the line's own text shown exactly as it is (`text`). */
export type LineValue = { key: string } | { text: string };

/**
 * What a sheet line's value says. Only a fixed value Hermit's own skill code wrote (its `valueKey`, set next to the
 * literal) is shown in the user's language; anything else (the arguments, the user's words, a page, a payment's amount
 * or address) is shown exactly as it is. A connector's or MCP tool's line is always its own raw value, and a payment
 * line keeps its value whatever it claims.
 */
export function lineValue(skill: string, line: { value: string; valueKey?: string; flag?: SummaryFlag }): LineValue {
  if (isToolSkill(skill) || line.flag?.startsWith("pay_")) return { text: line.value };
  if (line.valueKey !== undefined && (SUMMARY_VALUE_IDS as readonly string[]).includes(line.valueKey)) return { key: `HM-APPR-01.value.${line.valueKey}` };
  return { text: line.value };
}

const MAIL_READS: ReadonlySet<string> = new Set(["mail_list", "mail_search", "mail_read"]);
const MAIL_SENDS: ReadonlySet<string> = new Set(["mail_send", "mail_reply", "mail_forward"]);

/**
 * The trust line under the actions. A signed sheet says Hermit shows it; anything else also says what the fingerprint
 * lets happen: a mail read is only read, a draft or an organize call only happens, anything else is only sent.
 */
export function sheetFoot(skill: string, signed: boolean): string {
  if (signed) return "HM-APPR-01.signedFoot";
  if (MAIL_READS.has(skill)) return "HM-APPR-01.shownFootRead";
  if (skill === "mail_draft" || skill === "mail_modify") return "HM-APPR-01.shownFootAct";
  return "HM-APPR-01.shownFoot";
}

/** The sheet's own words for a skill: the title, the deny button, the note under a signed approval, and notes after it. */
export interface SheetWords {
  title: string;
  deny: string;
  signedNote: string;
  notes: string[];
}

/**
 * HM-APPR-01 and HM-APPR-02 by skill. A payment (SL-40) or an x402 purchase (SL-41) is HM-APPR-02; a password sign-in
 * (`fill_login`, SL-36's words: "Log in with Hermit?", the site in the fingerprint screen, the vault's second
 * fingerprint, "Don't log in"); a one-time code (SL-56b); a search or a page open says "Don't search" or "Don't
 * open"; anything else that leaves the phone says "Don't send".
 */
export function sheetWords(skill: string): SheetWords {
  switch (skill) {
    case "pay":
      return { title: "HM-APPR-02.title", deny: "HM-APPR-02.deny", signedNote: "HM-APPR-02.signedNote", notes: ["HM-APPR-02.unlockNote"] };
    case "pay_merchant":
      return { title: "HM-APPR-02.titleMerchant", deny: "HM-APPR-02.deny", signedNote: "HM-APPR-02.signedNoteMerchant", notes: ["HM-APPR-02.unlockNote"] };
    case "fill_login":
      return { title: "HM-APPR-01.login.title", deny: "HM-APPR-01.login.deny", signedNote: "HM-APPR-01.login.signedNote", notes: ["HM-APPR-01.login.vaultNote"] };
    case "web_code":
      return { title: "HM-APPR-01.titleCode", deny: "HM-APPR-01.denyCode", signedNote: "HM-APPR-01.signedNoteCode", notes: [] };
    case "search_web":
      return { title: "HM-APPR-01.title", deny: "HM-APPR-01.denySearch", signedNote: "HM-APPR-01.signedNote", notes: [] };
    case "read_web":
      return { title: "HM-APPR-01.title", deny: "HM-APPR-01.denyOpen", signedNote: "HM-APPR-01.signedNote", notes: [] };
    // SL-48 and SL-49: a mail read is only read ("Don't read"); a send, reply or forward says it sends; a draft says
    // it is only saved, never sent; organizing says it changes emails (its first line names the change).
    case "mail_list":
    case "mail_search":
    case "mail_read":
      return { title: "HM-APPR-01.titleMailRead", deny: "HM-APPR-01.denyRead", signedNote: "HM-APPR-01.signedNote", notes: [] };
    case "mail_send":
    case "mail_reply":
    case "mail_forward":
      return { title: "HM-APPR-01.titleMailSend", deny: "HM-APPR-01.deny", signedNote: "HM-APPR-01.signedNote", notes: [] };
    case "mail_draft":
      return { title: "HM-APPR-01.titleMailDraft", deny: "HM-APPR-01.denySave", signedNote: "HM-APPR-01.signedNote", notes: ["HM-APPR-01.draftNote"] };
    case "mail_modify":
      return { title: "HM-APPR-01.titleMailModify", deny: "HM-APPR-01.denyChange", signedNote: "HM-APPR-01.signedNote", notes: [] };
    default:
      return { title: "HM-APPR-01.title", deny: "HM-APPR-01.deny", signedNote: "HM-APPR-01.signedNote", notes: [] };
  }
}

/** The values a payment sheet puts first (A1, A7), read from the payment lines' flags only, and only on the pay skills. */
export interface PayFacts {
  amount?: string;
  to?: string;
  payee?: string;
  typed?: string;
  network?: string;
  fee?: string;
  capLeft?: string;
}

const PAY_FACT_OF: Partial<Record<SummaryFlag, keyof PayFacts>> = {
  pay_amount: "amount", pay_to: "to", pay_payee: "payee", pay_typed: "typed", pay_network: "network", pay_fee: "fee", pay_cap_left: "capLeft",
};

/**
 * HM-APPR-02's headline facts. Only a pay skill's flagged lines fill them (the runtime and the payment skill write
 * those, from the user's words, the caps and the chain); any other skill, a connector's or an MCP tool's included,
 * gets none, so no other sheet can look like a payment. The values are shown exactly as the lines carry them.
 */
export function payFacts(skill: string, lines: ReadonlyArray<{ label?: string; flag?: SummaryFlag; value: string }>): PayFacts | undefined {
  if (!PAY_SKILLS.has(skill)) return undefined;
  const facts: PayFacts = {};
  for (const l of lines) {
    const key = l.flag ? PAY_FACT_OF[l.flag] : undefined;
    if (key && facts[key] === undefined) facts[key] = l.value;
  }
  return facts;
}

/** An address cut to its first six and last four characters, for a title; the whole one stays in the details. */
export const shortAddress = (a: string) => (/^0x[0-9a-fA-F]{40}$/.test(a) ? `${a.slice(0, 6)}…${a.slice(-4)}` : a);

/**
 * Who a payment goes to, as the sheet's recipient row shows it. Address poisoning: a look-alike address shares the
 * real one's first and last characters, so an address with no saved name is shown whole (`whole`: mono, wrapping,
 * never cut); only a saved payee's name may sit over a cut address. Read from payFacts only.
 */
export function sheetRecipient(facts: Pick<PayFacts, "to" | "payee" | "typed">): { name?: string; address?: string; whole: boolean } | undefined {
  if (facts.payee) return { name: facts.payee, ...(facts.to ? { address: shortAddress(facts.to) } : {}), whole: false };
  if (facts.to) return { address: facts.to, whole: true };
  return undefined;
}

/** A1: the sheet's title as a question with the verb and the amount when it is a payment to someone; else sheetWords. */
export function sheetTitle(skill: string, facts: PayFacts | undefined): { key: string; vars?: Record<string, string> } {
  // Address poisoning: only a saved payee's name goes in the title; an unnamed address is never cut, so the title
  // says "this address" and the recipient row shows it whole (sheetRecipient).
  if (skill === "pay" && facts?.amount && facts.payee) return { key: "HM-APPR-02.titleTo", vars: { amount: facts.amount, to: facts.payee } };
  if (skill === "pay" && facts?.amount && facts.to) return { key: "HM-APPR-02.titleToAddress", vars: { amount: facts.amount } };
  return { key: sheetWords(skill).title };
}

/**
 * A1: the approve button names the verb ("Pay 20 USD₮", "Use this login", "Send"), with a spoken label that says who.
 * Payment words only on the pay skills' sheets, with the amount from their flagged line; everything else keeps today's
 * "Approve with fingerprint" unless it is Hermit's own message or sign-in skill.
 */
export function approveWords(skill: string, facts: PayFacts | undefined): { label: { key: string; vars?: Record<string, string> }; spoken: { key: string; vars?: Record<string, string> } } {
  if (PAY_SKILLS.has(skill) && facts?.amount) {
    // Spoken whole when there is no saved name (address poisoning), like the recipient row shows it.
    const to = facts.payee ?? facts.to;
    return { label: { key: "HM-APPR-02.approveVerb", vars: { amount: facts.amount } }, spoken: to ? { key: "HM-APPR-02.approveVerbA11y", vars: { amount: facts.amount, to } } : { key: "HM-APPR-02.approveVerb", vars: { amount: facts.amount } } };
  }
  if (skill === "fill_login") return { label: { key: "HM-APPR-01.login.approveVerb" }, spoken: { key: "HM-APPR-01.login.approveVerbSpoken" } };
  if (skill === "reply_message" || MAIL_SENDS.has(skill)) return { label: { key: "HM-APPR-01.sendVerb" }, spoken: { key: "HM-APPR-01.sendVerbSpoken" } };
  if (skill === "mail_draft") return { label: { key: "HM-APPR-01.saveVerb" }, spoken: { key: "HM-APPR-01.saveVerbSpoken" } };
  return { label: { key: "HM-APPR-01.approve" }, spoken: { key: "HM-APPR-01.approve" } };
}

/**
 * Q149: the user's own words of the turn that asked, for "You said". Read from the request's `said` and nothing else:
 * the loop sets it from the turn's input, so the model's text, a tool's output and the sheet's own lines never reach
 * it. A long message is cut to a few lines (the full one opens on a tap); an empty or missing one shows nothing.
 */
export function saidQuote(req: { said?: string }, max = 140): { full: string; short: string; cut: boolean } | undefined {
  const full = req.said?.trim();
  if (!full) return undefined;
  const lines = full.split("\n");
  let short = lines.length > 3 ? lines.slice(0, 3).join("\n") : full;
  if (short.length > max) short = short.slice(0, max).replace(/\s+\S*$/, "");
  const cut = short.length < full.length;
  return { full, short: cut ? `${short.trimEnd()}…` : full, cut };
}

/**
 * The taint warning, in the user's language. With the kind of content read (the chat's loop, the night shift), the
 * sheet says it in its own words; a web task's warning is already the source in the user's words ("the page on
 * {site}"), so it fills the generic sentence. Never the id of the skill that read it.
 */
export function taintLine(req: { taintWarning?: string; taintKind?: string }): { key: string; vars?: Record<string, string> } | undefined {
  if (!req.taintWarning) return undefined;
  if (req.taintKind) return { key: `HM-APPR-01.taintFrom.${req.taintKind}` };
  return { key: "HM-APPR-01.taintWarning", vars: { source: req.taintWarning } };
}
