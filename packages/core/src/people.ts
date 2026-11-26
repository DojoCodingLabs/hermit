/**
 * People by name (PDR-028, Q48, Q49): "llama a mi mamá", "text Carlos on WhatsApp", "forward it to Ana".
 * Code, never the model, turns a name the user said into a number or an address: the model never sees the contact
 * list, only the one entry code matched, after the user approves it on the sheet. Pure; the phone adapter reads the
 * contacts (READ_CONTACTS) and nothing here stores them.
 */

export type ContactsPermission = "granted" | "denied" | "not_asked";

/** One contact as the phone's contacts provider has it. Read for one turn, never stored. */
export interface ContactEntry {
  name: string;
  /** The contact's own nickname field ("Mamá", "Anita"), if the user filled one in. */
  nickname?: string;
  phones: Array<{ number: string; label?: string }>;
  emails: Array<{ address: string; label?: string }>;
}

/** The phone's contacts (READ_CONTACTS). Never prompts by itself: the app asks only when the user taps Allow. */
export interface ContactsPort {
  permission(): Promise<ContactsPermission>;
  /** Every contact with a number or an address. Called only after a name from the user's words needs it. */
  entries(): Promise<ContactEntry[]>;
}

/** Where a number or address found by name came from: the phone's contacts, or an address the user emailed before. */
export type PersonSource = "contacts" | "sent_mail";

export interface PersonCandidate {
  /** The contact's own name, or the name the user said for an address they emailed before. */
  name: string;
  /** The number (the contact's form, digits and an optional leading plus) or the address (lowercased). */
  value: string;
  /** The contact's label for that number or address ("Mobile", "Work"). */
  label?: string;
  sources: PersonSource[];
}

/** A number or address code found by name this turn, for the sheet (RenderContext.found) and the executor's re-check. */
export interface FoundPerson {
  /** The argument it fills ("phone", "to"). */
  field: string;
  kind: "phone" | "email";
  name: string;
  value: string;
  sources: PersonSource[];
}

/** Lowercase, accents removed, anything but letters and digits turned into single spaces. */
export function foldName(text: string): string {
  return text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

const LEAD = /^(?:(?:mi|mis|my|a|al|to|the|la|el|para|for|con|with|de)\s+)+/;

/** The name to look up: folded, without a possessive or a preposition in front ("mi mamá" is "mama"). */
export function personQuery(name: string): string {
  const folded = foldName(name);
  const q = folded.replace(LEAD, "");
  return LEAD.test(`${q} `) && !q.includes(" ") ? "" : q;
}

const containsWords = (haystack: string, words: string) => words !== "" && ` ${haystack} `.includes(` ${words} `);

/** The name appears, as whole words, in the user's own text (invariant 1: only the user's words choose the person). */
export function nameInWords(name: string, userText: string): boolean {
  return containsWords(foldName(userText), personQuery(name));
}

const digits = (s: string) => s.replace(/\D/g, "");
const phoneValue = (raw: string) => {
  const d = digits(raw);
  return d.length >= 7 && d.length <= 15 ? (raw.trim().startsWith("+") ? "+" : "") + d : undefined;
};
const EMAIL = /^[^\s@<>,;"()]+@[^\s@<>,;"()]+\.[A-Za-z]{2,24}$/;
const emailValue = (raw: string) => (EMAIL.test(raw.trim()) ? raw.trim().toLowerCase() : undefined);
const keyOf = (kind: "phone" | "email", value: string) => (kind === "phone" ? digits(value) : value);

/**
 * Contacts whose own name or nickname holds the name as whole words, as one candidate per number (or address).
 * No synonyms: "mom" finds a contact only if the contact is called or nicknamed "Mom" (invariant 2).
 */
export function matchContacts(name: string, entries: readonly ContactEntry[], kind: "phone" | "email"): PersonCandidate[] {
  const q = personQuery(name);
  if (!q) return [];
  const out: PersonCandidate[] = [];
  const seen = new Set<string>();
  for (const e of entries) {
    if (!containsWords(foldName(e.name), q) && !(e.nickname && containsWords(foldName(e.nickname), q))) continue;
    const values = kind === "phone"
      ? e.phones.map((p) => ({ value: phoneValue(p.number), label: p.label }))
      : e.emails.map((m) => ({ value: emailValue(m.address), label: m.label }));
    for (const v of values) {
      if (!v.value) continue;
      const key = `${e.name}\n${keyOf(kind, v.value)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ name: e.name, value: v.value, ...(v.label ? { label: v.label } : {}), sources: ["contacts"] });
    }
  }
  return out;
}

/**
 * Addresses the user emailed before (the address book's "sent" entries, SL-49) whose own words hold the name:
 * "Ana" finds ana.lopez@ and ana@, "Ana López" also finds analopez@. An address someone only wrote from is never
 * here, so a look-alike sender can't compete for the name.
 */
export function matchSentAddresses(name: string, addresses: readonly string[]): PersonCandidate[] {
  const q = personQuery(name);
  if (!q) return [];
  const said = name.trim().replace(/^(?:(?:mi|mis|my|a|al|to|the|la|el|para|for|con|with|de)\s+)+/i, "");
  const out: PersonCandidate[] = [];
  for (const raw of addresses) {
    const value = emailValue(raw);
    if (!value || out.some((c) => c.value === value)) continue;
    const local = value.split("@")[0]!;
    const words = foldName(local.replace(/[._+'-]+|\d+/g, " "));
    if (containsWords(words, q) || local.replace(/[^a-z]/g, "") === q.replace(/ /g, "")) out.push({ name: said, value, sources: ["sent_mail"] });
  }
  return out;
}

/** One candidate per number or address, keeping every source and the contact's name over the said one. */
export function mergeCandidates(...lists: PersonCandidate[][]): PersonCandidate[] {
  const out: PersonCandidate[] = [];
  for (const c of lists.flat()) {
    const kind = c.value.includes("@") ? "email" : "phone";
    const same = out.find((o) => keyOf(kind, o.value) === keyOf(kind, c.value));
    if (!same) out.push({ ...c, sources: [...c.sources] });
    else for (const s of c.sources) if (!same.sources.includes(s)) same.sources.push(s);
  }
  return out;
}

/** "ending 1234": how a number is shown when Hermit asks which one (the full number goes on the sheet). */
export function lastDigits(value: string, n = 4): string {
  return digits(value).slice(-n);
}
