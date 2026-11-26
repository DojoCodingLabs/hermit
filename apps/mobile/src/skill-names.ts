/**
 * HM-ACT-01 and HM-NIGHT-02: a skill or a signed-log row in words. Screens never show a skill id ("search_web") or a
 * row's status code ("read_untrusted"); the activity entry (HM-ACT-02) keeps the raw metadata for whoever checks it.
 */

const named = (ids: string[]) => Object.fromEntries(ids.map((id) => [id, `common.skill.${id}`]));

/** Skill id, or the `skill` a non-skill log row carries, to its name's copy key. */
export const SKILL_NAME_KEYS: Readonly<Record<string, string>> = {
  ...named([
    "add_contact", "calendar_add", "calendar_read", "compose_email", "compose_sms", "connect_service", "create_bot", "bot", "dial", "fill_form",
    "fill_login", "forget", "mail_draft", "mail_forward", "mail_list", "mail_modify", "mail_read", "mail_reply",
    "mail_search", "mail_send", "navigate", "open_whatsapp_chat", "pay", "pay_merchant", "read_messages", "read_web",
    "recall", "remember", "remind", "reminder_cancel", "reminders_list", "reply_message", "search_web", "set_alarm",
    "share", "web_code", "web_pay", "web_read", "web_repair", "web_signin", "web_step", "web_submit", "web_task",
    // Rows that are the user's own act, not a skill call.
    "connector", "profile", "spending", "vault", "wallet", "unknown",
  ]),
  // Night shift rows (SL-24): the job's own name.
  "night": "HM-NIGHT-01.title",
  "night.agenda": "HM-NIGHT-01.job.agenda",
  "night.reminders": "HM-NIGHT-01.job.reminders",
  "night.messages": "HM-NIGHT-01.job.messages",
  "night.mail": "HM-NIGHT-01.job.mail",
};

/** The copy key naming a skill or log row. A connector's or MCP tool's action, or anything new, still gets words. */
export function skillName(id: string): string {
  if (Object.hasOwn(SKILL_NAME_KEYS, id)) return SKILL_NAME_KEYS[id]!;
  if (id.startsWith("mcp_")) return "common.skill.mcp";
  if (id.startsWith("conn_")) return "common.skill.connectorAction";
  return "common.skill.other";
}

/** A row's mark (@hermit/cage ActivityMark) in words. */
export const markKey = (mark: string) => `HM-ACT-01.mark.${mark}`;
