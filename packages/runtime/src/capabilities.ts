/**
 * W1 (2026-11-24): the answer to "what can you do?" (`asksWhatHermitCanDo` in @hermit/model), built from the skills on
 * this phone's menu: on the S26 the model invented "Control de dispositivos y aplicaciones". One short line per group
 * of skills, in a fixed order, between an opening and the promise (HM-CHAT-01.can.*).
 *
 * W1 review: only what the phone can use right now. A group whose permission is off, whose account is missing or whose
 * provider is turned off isn't listed; one line says what would unlock the rest, in Settings.
 */
const APPS = ["open_whatsapp_chat", "compose_sms", "compose_email", "dial", "navigate", "share", "set_alarm", "add_contact"];

/** What the phone allows right now. Absent means unknown, and the group is listed as before. */
export interface CapabilityAccess {
  /** Android's notification access, which WhatsApp messages need. */
  notifications?: boolean;
  calendar?: boolean;
  /** A search provider is on (search.provider isn't "off"). */
  search?: boolean;
  /** At least one email account is connected. */
  mailAccount?: boolean;
}

type T = (key: string, vars?: Record<string, string>) => string;

/** `t` looks a key up in the user's language. */
export function capabilityAnswer(skillIds: Iterable<string>, t: T, access: CapabilityAccess = {}): string {
  const ids = new Set(skillIds);
  const lines: string[] = [];
  const missing: string[] = [];
  const group = (key: string, onMenu: boolean, usable = true, need?: string) => {
    if (!onMenu) return;
    if (usable) lines.push(t(`HM-CHAT-01.can.${key}`));
    else if (need) missing.push(t(`HM-CHAT-01.can.need.${need}`));
  };
  group("reminders", ids.has("remind"));
  group("memory", ids.has("remember"));
  group("calendar", ids.has("calendar_read") || ids.has("calendar_add"), access.calendar !== false, "calendar");
  group("messages", ids.has("read_messages"), access.notifications !== false, "notifications");
  group("mail", ids.has("mail_list") || ids.has("mail_search"), access.mailAccount !== false, "mail");
  const searches = ids.has("search_web") && access.search !== false;
  if (ids.has("read_web") || ids.has("search_web")) {
    if (searches) lines.push(t("HM-CHAT-01.can.web"));
    else {
      if (ids.has("read_web")) lines.push(t("HM-CHAT-01.can.webRead"));
      if (ids.has("search_web")) missing.push(t("HM-CHAT-01.can.need.search"));
    }
  }
  group("apps", APPS.some((id) => ids.has(id)));
  group("pay", ids.has("pay"));
  group("connect", ids.has("connect_service"));
  const more = missing.length ? [t("HM-CHAT-01.can.more", { what: listed(missing, t("HM-CHAT-01.can.or")) })] : [];
  return [t("HM-CHAT-01.can.intro"), ...lines, ...more, t("HM-CHAT-01.can.outro")].join("\n");
}

/** "a", "a o b", "a, b o c" (and "or" in English). */
function listed(items: readonly string[], or: string): string {
  if (items.length < 2) return items[0] ?? "";
  return `${items.slice(0, -1).join(", ")} ${or} ${items.at(-1)}`;
}
