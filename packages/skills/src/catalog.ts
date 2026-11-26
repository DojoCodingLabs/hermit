import { skillId, type ApprovalSummary, type JsonSchema, type MailRenderContext, type RenderContext, type SkillDef } from "@hermit/core";
import { foundLines, personArg } from "./found.ts";
import { displayNameOf, emailOf, parseAddresses, systemLabel } from "./mail-address.ts";
import {
  normalizeCalendarAdd, normalizeCalendarRead, normalizeMailDraft, normalizeMailForward, normalizeMailList, normalizeMailModify, normalizeMailRead, normalizeMailReply, normalizeMailSearch, normalizeMailSend,
  normalizeReadMessages, normalizeReminderCancel, normalizeRemember, normalizeRemind, normalizeReply,
} from "./normalize.ts";
import { fixedValue, valueOr } from "./values.ts";
import { webSkills } from "./web.ts";

const obj = (properties: Record<string, JsonSchema>, required: string[]): JsonSchema => ({
  type: "object",
  properties,
  required,
  additionalProperties: false,
});
const str = (description: string, extra: JsonSchema = {}): JsonSchema => ({ type: "string", description, ...extra });

type Args = Record<string, unknown>;
const s = (v: unknown) => String(v ?? "");

/**
 * The first-win menu (spec §4.6). menuLine is the tool description the model sees: say when to use the tool,
 * with trigger phrases in both languages. One-line descriptions cost 3 to 7 of 40 eval cases
 * (docs/research/harness-diagnosis.md).
 */
export const firstWinSkills: readonly SkillDef<Args>[] = [
  {
    id: skillId("remember"), version: 1, risk: "local_write", producesUntrusted: false,
    menuLine: "Save a personal fact the user tells you so you can recall it later (\"remember that...\", \"note that...\", \"keep in mind...\", \"recuerda que...\", \"anota que...\"). Not for alerts at a time.",
    args: obj({ fact: str("The fact to save, in the user's own language and words", { maxLength: 500 }) }, ["fact"]),
    normalize: normalizeRemember,
    describeAction: (a) => ({ title: "Remember this", lines: [{ label: "Fact", labelKey: "fact", value: s(a.fact) }] }),
  },
  {
    // Memories saved during a tainted session can carry injected text back in.
    // Wave 1 narrows this to per-call taint when a returned memory is tainted.
    id: skillId("recall"), version: 1, risk: "read", producesUntrusted: true,
    menuLine: "Search the facts the user saved before. Use it for any question about the user's own life (their passwords, sizes, documents, where they parked, birthdays): never answer those from your own knowledge.",
    args: obj({ query: str("Keywords to search for, in the user's language", { maxLength: 200 }) }, ["query"]),
    describeAction: (a) => ({ title: "Look in memory", lines: [{ label: "Looking for", labelKey: "lookingFor", value: s(a.query) }] }),
  },
  {
    id: skillId("forget"), version: 1, risk: "local_write", producesUntrusted: false,
    menuLine: "Delete a saved fact when the user asks to forget or delete it (\"forget...\", \"olvida...\", \"borra lo de...\").",
    args: obj({ query: str("Keywords of the fact to delete", { maxLength: 200 }) }, ["query"]),
    describeAction: (a) => ({ title: "Forget this", lines: [{ label: "Forget", labelKey: "forget", value: s(a.query) }] }),
  },
  {
    id: skillId("remind"), version: 1, risk: "local_write", producesUntrusted: false,
    menuLine: "Set an alert that fires at a specific time (\"remind me\", \"ping me\", \"don't let me forget\", \"recuérdame\", \"avísame\", \"no me dejes olvidar\").",
    args: obj({ text: str("What to remind about, short, in the user's language", { maxLength: 200 }), at: str("When: local date and time as YYYY-MM-DDTHH:MM:SS (24-hour clock, no time zone)") }, ["text", "at"]),
    normalize: normalizeRemind,
    describeAction: (a) => ({ title: "Set a reminder", lines: [{ label: "Reminder", labelKey: "reminder", value: s(a.text) }, { label: "When", labelKey: "when", value: s(a.at) }] }),
  },
  {
    // US-REM-03: the user's own reminders, read back in local time.
    id: skillId("reminders_list"), version: 1, risk: "read", producesUntrusted: false,
    menuLine: "List the user's upcoming reminders (\"what reminders do I have?\", \"¿qué recordatorios tengo?\", \"mis recordatorios\").",
    args: obj({}, []),
    describeAction: () => ({ title: "Check reminders", lines: [] }),
  },
  {
    // US-REM-03: cancel by the user's own words; code resolves which reminder (the model never handles ids).
    id: skillId("reminder_cancel"), version: 1, risk: "local_write", producesUntrusted: false,
    menuLine: "Cancel one of the user's reminders (\"cancel my 9 o'clock reminder\", \"cancela el recordatorio de mamá\", \"ya no me recuerdes lo del banco\").",
    args: obj({ which: str("Words that identify the reminder: its time or what it is about, in the user's words", { maxLength: 200 }) }, ["which"]),
    normalize: normalizeReminderCancel,
    describeAction: (a) => ({ title: "Cancel a reminder", lines: [{ label: "Which", labelKey: "which", value: s(a.which) }] }),
  },
  {
    // Invitations are written by other people.
    id: skillId("calendar_read"), version: 1, risk: "read", producesUntrusted: true,
    menuLine: "List the events in the user's calendar between two local date-times (\"what do I have tomorrow\", \"¿qué tengo el viernes?\").",
    args: obj({ from: str("Range start, local YYYY-MM-DDTHH:MM:SS"), to: str("Range end, local YYYY-MM-DDTHH:MM:SS") }, ["from", "to"]),
    normalize: normalizeCalendarRead,
    describeAction: (a) => ({ title: "Check calendar", lines: [{ label: "From", labelKey: "from", value: s(a.from) }, { label: "To", labelKey: "to", value: s(a.to) }] }),
  },
  {
    id: skillId("calendar_add"), version: 1, risk: "local_write", producesUntrusted: false,
    menuLine: "Create a calendar event with a title, start and end (\"put X in my calendar\", \"agenda...\", \"pon ... el viernes de 10 a 11\").",
    args: obj({
      title: str("Event title, in the user's language", { maxLength: 120 }),
      start: str("Local start YYYY-MM-DDTHH:MM:SS"),
      end: str("Local end YYYY-MM-DDTHH:MM:SS (one hour after start if not given)"),
    }, ["title", "start", "end"]),
    normalize: normalizeCalendarAdd,
    describeAction: (a) => ({
      title: "Add to calendar",
      lines: [{ label: "Event", labelKey: "event", value: s(a.title) }, { label: "Starts", labelKey: "starts", value: s(a.start) }, { label: "Ends", labelKey: "ends", value: s(a.end) }],
    }),
  },
  {
    id: skillId("read_messages"), version: 1, risk: "read", producesUntrusted: true,
    menuLine: "Read the user's recent WhatsApp messages, optionally only those from one contact (\"did Ana write?\", \"¿qué me dijo Pedro?\"). Also the first step before replying to someone.",
    args: obj({ contact: str("The contact's name only (a person, never a date), or empty for everyone", { maxLength: 80 }) }, []),
    normalize: normalizeReadMessages,
    describeAction: (a) => ({ title: "Read messages", lines: [{ label: "From", labelKey: "from", ...valueOr(a.contact, "Everyone", "everyone") }] }),
  },
  {
    id: skillId("reply_message"), version: 1, risk: "send", producesUntrusted: false,
    menuLine: "Send a WhatsApp reply in a conversation that read_messages already returned. Needs that conversationId; if you don't have it, call read_messages first.",
    // No free-text recipient: the model names a conversation, the app resolves who that is.
    args: obj({
      conversationId: str("The conversationId exactly as read_messages returned it", { maxLength: 64, pattern: "^[A-Za-z0-9_:.-]+$" }),
      text: str("The exact message to send, in the language the user would use with that contact", { maxLength: 1000 }),
    }, ["conversationId", "text"]),
    normalize: normalizeReply,
    describeAction: (a, ctx) => {
      const id = s(a.conversationId);
      const who = ctx.conversation(id);
      if (!who) {
        return { title: "Send this message?", lines: [{ label: "Message", labelKey: "message", value: s(a.text) }], unresolved: "I don't know that conversation. Read messages first." };
      }
      return {
        title: "Send this message?",
        lines: [
          { label: "To", labelKey: "to", value: `${who.name} (${who.address})` },
          { label: "Message", labelKey: "message", value: s(a.text) },
        ],
        binding: replyBinding(id, who),
      };
    },
  },
];

/** What a reply approval is bound to: the conversation and the name and app the sheet showed. */
export function replyBinding(conversationId: string, who: { name: string; address: string }): string {
  return JSON.stringify([conversationId, who.name, who.address]);
}

const ALL_ACCOUNTS = "All connected accounts";
const account = str("Which email account: an address or a word the user said (work, personal, gmail). Leave empty for all accounts", { maxLength: 100 });

/**
 * Mail reads (FR-MAIL-02, SL-48). Off the first-win menu: the app adds them once a mail account can be
 * connected. Each is a `network` read whose output is other people's text, so the session is tainted and the
 * summary goes through the quarantined reader. The model never sees a provider id: code hands out short
 * message ids ("m3") and resolves them.
 */
export const mailSkillDefs: readonly SkillDef<Args>[] = [
  {
    id: skillId("mail_list"), version: 1, risk: "network", producesUntrusted: true,
    menuLine: "Read the user's recent email (Gmail, Outlook or any connected account), unread by default: \"anything important in my email?\", \"check my inbox\", \"¿tengo correos nuevos?\", \"revisa mi correo\".",
    args: obj({
      account,
      unreadOnly: { type: "boolean", description: "Only unread email. True unless the user asks for the latest or all" },
      max: { type: "integer", minimum: 1, maximum: 50, description: "How many, only if the user said a number" },
    }, []),
    normalize: normalizeMailList,
    describeAction: (a) => ({
      title: "Read email",
      lines: [
        { label: "Account", labelKey: "account", ...valueOr(a.account, ALL_ACCOUNTS, "allAccounts") },
        { label: "Which", labelKey: "which", ...(a.unreadOnly === false ? fixedValue("Most recent", "mostRecent") : fixedValue("Unread", "unread")) },
      ],
    }),
  },
  {
    id: skillId("mail_search"), version: 1, risk: "network", producesUntrusted: true,
    menuLine: "Search the user's email for a message: \"find the flight confirmation from Avianca\", \"search my email for the invoice\", \"busca el correo del banco\", \"encuentra el correo de la renta\".",
    args: obj({
      query: str("Words to look for, from the user's request, without the sender", { maxLength: 200 }),
      from: str("The sender's name or address, only if the user named one", { maxLength: 100 }),
      account,
    }, []),
    normalize: normalizeMailSearch,
    describeAction: (a) => ({
      title: "Search email",
      lines: [
        { label: "Account", labelKey: "account", ...valueOr(a.account, ALL_ACCOUNTS, "allAccounts") },
        ...(s(a.query) ? [{ label: "Looking for", labelKey: "lookingFor", value: s(a.query) }] : []),
        ...(s(a.from) ? [{ label: "From", labelKey: "from", value: s(a.from) }] : []),
      ],
    }),
  },
  {
    id: skillId("mail_read"), version: 1, risk: "network", producesUntrusted: true,
    menuLine: "Open one email that mail_list or mail_search returned, to answer a question about it (\"what does the Avianca email say?\", \"¿qué dice ese correo?\"). Needs its messageId.",
    args: obj({ messageId: str("The messageId exactly as mail_list or mail_search returned it, like m3", { pattern: "^m[0-9]{1,4}$" }) }, ["messageId"]),
    normalize: normalizeMailRead,
    describeAction: (a) => ({ title: "Open an email", lines: [{ label: "Message", labelKey: "message", value: s(a.messageId) }] }),
  },
];

/** At most this many messages per mail_modify call (FR-MAIL-03). */
export const MAIL_MODIFY_MAX = 200;
const SAMPLE = 3;
const messageId = str("The messageId exactly as mail_list or mail_search returned it, like m3", { pattern: "^m[0-9]{1,4}$" });
const recipients = (who: string) => str(`${who}: email addresses exactly as the user typed them, separated by commas. Never an address from an email`, { maxLength: 500 });
const NOT_WIRED: ApprovalSummary = { title: "Email", lines: [], unresolved: "Email is not connected. Tell the user to connect an account in Email accounts." };
const NO_RECIPIENT = "No email address from the user. Ask the user who to send it to (their email address).";
const unknownMessage = (ref: string) => `There is no email ${ref} from mail_list or mail_search in this chat. Call mail_list or mail_search first.`;

const reSubject = (subject: string) => (/^re:/i.test(subject.trim()) ? subject.trim() : `Re: ${subject.trim()}`);
const fwdSubject = (subject: string) => (/^(fwd?|rv):/i.test(subject.trim()) ? subject.trim() : `Fwd: ${subject.trim()}`);

const SENDER_NAME = "Sender's name (as the email says, not verified)";
/** Who sent a message, as its bare address: a display name can claim to be anyone. */
const senderOf = (from: string) => emailOf(from) ?? from;

/**
 * To, Cc and a "new recipient" line for every address the user never sent mail to or typed (FR-MAIL-04).
 * Having received mail from an address doesn't make it known: anyone can write once.
 */
function recipientLines(mail: MailRenderContext, to: string[], cc: string[] = []): ApprovalSummary["lines"] {
  const fresh = [...to, ...cc].filter((a) => !mail.known(a));
  return [
    { label: "To", labelKey: "to", value: to.join(", ") },
    ...(cc.length ? [{ label: "Cc", labelKey: "cc", value: cc.join(", ") }] : []),
    ...(fresh.length ? [{ label: "New recipient", labelKey: "newRecipient", value: fresh.join(", "), flag: "new_recipient" as const }] : []),
  ];
}

/** The message being replied to or forwarded, and the account it arrived on; or why there is none. */
function thread(ctx: RenderContext, ref: unknown): { mail: MailRenderContext; message: NonNullable<ReturnType<MailRenderContext["message"]>>; from: NonNullable<ReturnType<MailRenderContext["account"]>> } | { unresolved: string } {
  const mail = ctx.mail;
  if (!mail) return { unresolved: NOT_WIRED.unresolved! };
  const message = mail.message(s(ref));
  if (!message) return { unresolved: unknownMessage(s(ref)) };
  const from = mail.account(message.accountId);
  if (!from) return { unresolved: "That email's account is not connected anymore." };
  return { mail, message, from };
}

/** The new email a send or a draft shows: from the account, to the user's addresses. */
function composeSheet(title: string, kind: "mail_send" | "mail_draft", a: Args, ctx: RenderContext, needsRecipient: boolean): ApprovalSummary {
  const mail = ctx.mail;
  if (!mail) return NOT_WIRED;
  const sender = mail.sender(a.account);
  if (!sender.ok) return { title, lines: [], unresolved: sender.reason };
  const to = parseAddresses(a.to);
  const cc = parseAddresses(a.cc);
  if (needsRecipient && !to.length) return { title, lines: [], unresolved: NO_RECIPIENT };
  return {
    title,
    lines: [
      { label: "From", labelKey: "from", value: sender.account.name },
      ...(to.length || cc.length ? recipientLines(mail, to, cc) : []),
      ...foundLines(ctx, "to", to),
      ...(s(a.subject) ? [{ label: "Subject", labelKey: "subject", value: s(a.subject) }] : []),
      { label: "Message", labelKey: "message", value: s(a.body) },
    ],
    binding: JSON.stringify(kind === "mail_send" ? [kind, sender.account.id, sender.account.address, to, cc] : [kind, sender.account.id, sender.account.address, to]),
  };
}

/** A reply, sent or saved as a draft: to the message's sender, from the account it arrived on. */
function replySheet(title: string, kind: "mail_reply" | "mail_draft", a: Args, ctx: RenderContext): ApprovalSummary {
  const t = thread(ctx, a.messageId);
  if ("unresolved" in t) return { title, lines: [], unresolved: t.unresolved };
  const to = emailOf(t.message.from);
  if (!to) return { title, lines: [], unresolved: "That email has no sender address to reply to. Tell the user." };
  const subject = reSubject(t.message.subject);
  const fresh = !t.mail.known(to);
  // The To line is exactly the bound address. The sender's display name is theirs to write, so it is only a
  // labeled hint, and never when it carries an address ("boss@company.com" <attacker@evil.com>).
  const name = displayNameOf(t.message.from);
  return {
    title,
    lines: [
      { label: "From", labelKey: "from", value: t.from.name },
      { label: "To", labelKey: "to", value: to },
      ...(name ? [{ label: SENDER_NAME, labelKey: "senderName", value: name }] : []),
      ...(fresh ? [{ label: "New recipient", labelKey: "newRecipient", value: to, flag: "new_recipient" as const }] : []),
      { label: "Subject", labelKey: "subject", value: subject },
      { label: "Message", labelKey: "message", value: s(a.body) },
    ],
    binding: JSON.stringify([kind, t.message.ref, t.message.accountId, t.from.address, to, subject]),
  };
}

/** The messages a mail_modify call means: its short ids, or everything the last list or search showed. */
function modifyTargets(mail: MailRenderContext, ids: unknown): { refs: string[] } | { unresolved: string } {
  const raw = s(ids).trim();
  const refs = raw === "shown" ? mail.shown() : [...new Set(raw.split(/[\s,]+/).filter(Boolean))];
  if (!refs.length) return { unresolved: raw === "shown" ? "No email was shown in this chat. Call mail_list or mail_search first." : "Say which emails, by their messageId." };
  if (refs.length > MAIL_MODIFY_MAX) return { unresolved: `That is ${refs.length} emails; at most ${MAIL_MODIFY_MAX} at a time. Tell the user.` };
  const missing = refs.find((r) => !mail.message(r));
  return missing ? { unresolved: unknownMessage(missing) } : { refs };
}

/** Labeling only adds the user's own labels; a system name would trash, junk or move mail (SL-49 review). */
const SYSTEM_LABEL_REFUSAL = (label: string) =>
  `"${label}" is the name of a system folder (Inbox, Trash, Spam and the like), not a label, so nothing was changed. Tell the user Hermit only adds their own labels, and to pick another name.`;

const MODIFY_TITLES: Record<string, string> = { archive: "Archive these emails?", mark_read: "Mark these emails as read?", label: "Label these emails?" };
/** What mail_modify does, as the sheet's first line: the sheet's title is the same for all three, so the line says it. */
const MODIFY_CHANGES: Record<string, ReturnType<typeof fixedValue>> = {
  archive: fixedValue("Archive", "archive"), mark_read: fixedValue("Mark as read", "markRead"), label: fixedValue("Add a label", "addLabel"),
};

/**
 * Mail writes (FR-MAIL-03, SL-49). A send, a reply and a forward are `send` (always asked, with the
 * fingerprint); saving a draft and archiving, labeling or marking read are `remote_write` (always asked).
 * Every sheet is built here from the arguments and trusted mail data (RenderContext.mail), never from the
 * model's prose, and its binding is what the executor re-checks before anything leaves the phone.
 */
export const mailWriteSkillDefs: readonly SkillDef<Args>[] = [
  {
    id: skillId("mail_send"), version: 1, risk: "send", producesUntrusted: false,
    menuLine: "Send a new email to an address the user gave or a person they named (\"email bob@x.com that I'm running late\", \"manda un correo a Ana diciendo...\"). Always asks the user first.",
    args: obj({
      to: recipients("Recipients"),
      person: personArg("email"),
      cc: recipients("Copy (Cc), only if the user asked"),
      subject: str("A short subject, in the user's language", { maxLength: 200 }),
      body: str("The exact email text to send, in the user's language", { maxLength: 4000 }),
      account,
    }, ["subject", "body"]),
    recipient: { field: "to", kind: "email", required: true },
    normalize: normalizeMailSend,
    describeAction: (a, ctx) => composeSheet("Send this email?", "mail_send", a, ctx, true),
  },
  {
    id: skillId("mail_reply"), version: 1, risk: "send", producesUntrusted: false,
    menuLine: "Reply to an email that mail_list or mail_search returned (\"reply to Luis that I'll be there\", \"responde el correo del banco\", \"contéstale ese correo\"). Needs its messageId. Always asks first.",
    // No recipient argument: a reply goes to the message's sender, read by code from the thread.
    args: obj({ messageId, body: str("The exact reply text, in the language of the email", { maxLength: 4000 }) }, ["messageId", "body"]),
    normalize: normalizeMailReply,
    describeAction: (a, ctx) => replySheet("Send this reply?", "mail_reply", a, ctx),
  },
  {
    id: skillId("mail_forward"), version: 1, risk: "send", producesUntrusted: false,
    menuLine: "Forward an email that mail_list or mail_search returned to an address the user gave or a person they named (\"forward the Avianca email to bob@x.com\", \"reenvía ese correo a Ana\"). Always asks first.",
    args: obj({ messageId, to: recipients("New recipients"), person: personArg("email"), body: str("A short note above the forwarded email, only if the user gave one", { maxLength: 2000 }) }, ["messageId"]),
    recipient: { field: "to", kind: "email", required: true },
    normalize: normalizeMailForward,
    describeAction: (a, ctx) => {
      const title = "Forward this email?";
      const t = thread(ctx, a.messageId);
      if ("unresolved" in t) return { title, lines: [], unresolved: t.unresolved };
      const to = parseAddresses(a.to);
      if (!to.length) return { title, lines: [], unresolved: NO_RECIPIENT };
      const subject = fwdSubject(t.message.subject);
      return {
        title,
        lines: [
          { label: "From", labelKey: "from", value: t.from.name },
          ...recipientLines(t.mail, to),
          ...foundLines(ctx, "to", to),
          { label: "Subject", labelKey: "subject", value: subject },
          { label: "Forwarding", labelKey: "forwarding", value: `${senderOf(t.message.from)}: ${t.message.subject}` },
          ...(s(a.body) ? [{ label: "Message", labelKey: "message", value: s(a.body) }] : []),
        ],
        binding: JSON.stringify(["mail_forward", t.message.ref, t.message.accountId, t.from.address, to, subject]),
      };
    },
  },
  {
    id: skillId("mail_draft"), version: 1, risk: "remote_write", producesUntrusted: false,
    menuLine: "Write an email draft without sending it, saved in the account's Drafts (\"draft a reply to Luis\", \"haz un borrador para ana@x.com\", \"redacta un correo\"). With a messageId it is a reply draft.",
    args: obj({
      to: recipients("Recipients, if the user gave any"),
      person: personArg("email"),
      subject: str("A short subject, in the user's language (not needed for a reply)", { maxLength: 200 }),
      body: str("The draft text, in the user's language", { maxLength: 4000 }),
      messageId: { ...messageId, description: "Only for a reply draft: the messageId of the email it answers" },
      account,
    }, ["body"]),
    recipient: { field: "to", kind: "email" },
    normalize: normalizeMailDraft,
    describeAction: (a, ctx) => (s(a.messageId) ? replySheet("Save this draft?", "mail_draft", a, ctx) : composeSheet("Save this draft?", "mail_draft", a, ctx, false)),
  },
  {
    id: skillId("mail_modify"), version: 1, risk: "remote_write", producesUntrusted: false,
    menuLine: "Archive, label or mark as read emails that mail_list or mail_search returned (\"archive the newsletters\", \"márcalos como leídos\", \"archiva esos correos\"). Up to 200 at a time.",
    args: obj({
      messageIds: str("The messageIds separated by spaces (m1 m4), or shown for every email just listed", { maxLength: 1200, pattern: "^(shown|m[0-9]{1,4}([ ,]+m[0-9]{1,4})*)$" }),
      action: { type: "string", enum: ["archive", "mark_read", "label"], description: "archive, mark_read or label" },
      label: str("The label name, only for label", { maxLength: 60 }),
    }, ["messageIds", "action"]),
    normalize: normalizeMailModify,
    describeAction: (a, ctx) => {
      const title = MODIFY_TITLES[s(a.action)] ?? "Change these emails?";
      const mail = ctx.mail;
      if (!mail) return NOT_WIRED;
      const change = MODIFY_CHANGES[s(a.action)];
      if (!change) return { title, lines: [], unresolved: "Say whether to archive, mark as read or label those emails." };
      if (a.action === "label" && !s(a.label).trim()) return { title, lines: [], unresolved: "Which label? Ask the user for the label name." };
      if (a.action === "label" && systemLabel(s(a.label))) return { title, lines: [], unresolved: SYSTEM_LABEL_REFUSAL(s(a.label).trim()) };
      const t = modifyTargets(mail, a.messageIds);
      if ("unresolved" in t) return { title, lines: [], unresolved: t.unresolved };
      const items = t.refs.map((r) => mail.message(r)!);
      return {
        title,
        lines: [
          { label: "Change", labelKey: "change", ...change },
          { label: "How many", labelKey: "howMany", value: String(items.length) },
          ...items.slice(0, SAMPLE).map((m, i) => ({ label: `Email ${i + 1}`, labelKey: "emailN", labelVars: { n: String(i + 1) }, value: `${senderOf(m.from)}: ${m.subject}` })),
          ...(a.action === "label" ? [{ label: "Label", labelKey: "label", value: s(a.label).trim() }] : []),
        ],
        binding: JSON.stringify(["mail_modify", s(a.action), a.action === "label" ? s(a.label).trim() : "", items.map((m) => [m.ref, m.accountId])]),
      };
    },
  },
];

export { webSkills };

const byId = new Map([...firstWinSkills, ...mailSkillDefs, ...mailWriteSkillDefs, ...webSkills].map((sk) => [sk.id as string, sk]));

export function skillById(id: string): SkillDef<Args> | undefined {
  return byId.get(id);
}
