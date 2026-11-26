/*
 * Email addresses for the send, reply, forward and draft skills (SL-49). Deliberately narrow: no quoted local
 * parts, comments or whitespace, so an address can never carry a header break or a second recipient.
 */

const ADDRESS = /^[A-Za-z0-9._%+'-]{1,64}@[A-Za-z0-9-]{1,63}(?:\.[A-Za-z0-9-]{1,63})*\.[A-Za-z]{2,24}$/;
const IN_TEXT = /[A-Za-z0-9._%+'-]{1,64}@[A-Za-z0-9-]{1,63}(?:\.[A-Za-z0-9-]{1,63})*\.[A-Za-z]{2,24}/g;

/** The bare address, lowercased, from "Name <a@x.com>" or "a@x.com"; undefined when it is not one. */
export function emailOf(text: string): string | undefined {
  const t = text.trim();
  const inner = /<([^<>]*)>\s*$/.exec(t)?.[1] ?? t;
  const v = inner.trim();
  return ADDRESS.test(v) ? v.toLowerCase() : undefined;
}

/**
 * The display name of a header value ("Luis Pérez <luis@x.com>" is Luis Pérez), for a hint next to the bare
 * address. Undefined when there is none or when it holds anything shaped like an address: a name such as
 * "boss@company.com" <attacker@evil.com> must never put a second address on an approval sheet.
 */
export function displayNameOf(text: string): string | undefined {
  const m = /^(.*?)<[^<>]*>\s*$/.exec(text.trim());
  if (!m) return undefined;
  const name = m[1]!.replace(/["\\]/g, "").replace(/\s+/g, " ").trim();
  if (!name || name.includes("@")) return undefined;
  return name.length > 60 ? `${name.slice(0, 57)}...` : name;
}

/** The addresses in a recipients field ("a@x.com, Ana <b@y.com>; c@z.org"), in order, without repeats. */
export function parseAddresses(value: unknown): string[] {
  if (typeof value !== "string") return [];
  const parts = value.split(/[,;]/).flatMap((p) => (/<[^<>]*>/.test(p) ? [p] : p.split(/\s+/)));
  const out: string[] = [];
  for (const p of parts) {
    const a = emailOf(p);
    if (a && !out.includes(a)) out.push(a);
  }
  return out;
}

/** Every address written in free text (the user's own message), lowercased, in order, without repeats. */
export function addressesIn(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(IN_TEXT)) {
    const a = m[0].replace(/[.'-]+$/, "").toLowerCase();
    if (ADDRESS.test(a) && !out.includes(a)) out.push(a);
  }
  return out;
}

/**
 * Names that belong to a provider's system labels or well-known folders (SL-49 review): Gmail's system labels
 * (TRASH, SPAM, INBOX, UNREAD, STARRED, IMPORTANT, SENT, DRAFT, CHAT, CATEGORY_*), Outlook's well-known
 * folders and the usual IMAP special-use mailboxes, in English and Spanish. Labeling is a remote_write: with
 * one of these names it would trash, junk or move mail, which is not what labeling asks.
 */
const SYSTEM_LABELS = new Set([
  "inbox", "trash", "spam", "unread", "starred", "important", "sent", "draft", "drafts", "chat", "bin", "junk", "junk email", "junk e-mail",
  "deleted", "deleted items", "deleted messages", "sent items", "sent mail", "sent messages", "all mail", "archive", "archives", "outbox",
  "clutter", "conversation history", "recoverable items", "scheduled", "snoozed", "flagged",
  "bandeja de entrada", "papelera", "correo no deseado", "no deseado", "elementos eliminados", "eliminados", "enviados", "elementos enviados",
  "borradores", "archivo", "destacados", "importantes", "bandeja de salida", "todos", "todo el correo",
]);

/** The label name collides (case-insensitively, the whole name or any path segment) with a system label or folder. */
export function systemLabel(name: string): boolean {
  const n = name.trim().toLowerCase().replace(/\s+/g, " ");
  if (!n) return false;
  if (n.startsWith("[gmail]") || n.startsWith("[google mail]")) return true;
  const parts = [n, ...n.split(/[/.]/).map((x) => x.trim())].filter(Boolean);
  return parts.some((x) => SYSTEM_LABELS.has(x) || x.startsWith("category_"));
}
