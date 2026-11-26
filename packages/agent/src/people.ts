import { lastDigits, matchContacts, matchSentAddresses, mergeCandidates, nameInWords, type ContactEntry, type FoundPerson, type PersonCandidate, type SkillDef } from "@hermit/core";
import { emailOf, parseAddresses } from "@hermit/skills";
import type { Choice, PeopleDeps } from "./types.ts";

type Args = Record<string, unknown>;

export type PeopleOutcome =
  /** Run the call with these arguments; `found` holds what code found by name (empty when nothing was). */
  | { kind: "go"; args: Args; found: FoundPerson[]; notes: string[]; offer: boolean }
  /** End the turn with this question: nobody, or more than one person, matched; or a send has no recipient. */
  | { kind: "ask"; question: string; choices: Choice[]; notes: string[]; offer: boolean };

const K = (name: string) => `HM-CHAT-01.people.${name}`;
const s = (v: unknown) => (typeof v === "string" ? v.trim() : "");
const MAX_CHOICES = 6;
const MAX_SUGGESTIONS = 5;

const digitCount = (v: string) => v.replace(/\D/g, "").length;
const isValue = (kind: "phone" | "email", v: string) => (kind === "phone" ? digitCount(v) >= 7 && digitCount(v) <= 15 : parseAddresses(v).length > 0);
/** A name the model put where the number or address goes ("Mamá" in phone): no digits, no "@". */
const nameIn = (kind: "phone" | "email", v: string) => (v && !isValue(kind, v) && (kind === "phone" ? digitCount(v) === 0 : !v.includes("@")) ? v : "");

function without(args: Args, ...keys: string[]): Args {
  const out = { ...args };
  for (const k of keys) delete out[k];
  return out;
}

/**
 * PDR-028: turns a person the user named into the number or address the call needs, by code, before the cage.
 * 1. Only the user's own words this turn choose the person: a name that isn't in them is never looked up.
 * 2. The contacts are read and matched here; the model gets nothing but the one entry the user then approves.
 * 3. Nobody, or more than one, matches: the turn ends with a question (names with the last four digits, or the
 *    addresses), never a guess.
 * 5. Without the contacts permission: the phone skills keep today's behavior (the other app's picker), a send asks
 *    for the address; `offer` tells the chat it may offer the permission.
 * `filled` is what the model gave before the normalizer, so a name it wrote into the number field is still seen.
 */
export async function resolvePeople(def: SkillDef, filled: Args, args: Args, userText: string, deps: PeopleDeps): Promise<PeopleOutcome> {
  const spec = def.recipient;
  const notes: string[] = [];
  if (!spec) return { kind: "go", args, found: [], notes, offer: false };
  const { field, kind } = spec;
  const go = (a: Args, found: FoundPerson[] = [], offer = false): PeopleOutcome => ({ kind: "go", args: a, found, notes, offer });

  // The user's own number or address (the normalizer kept only those): nothing to look up.
  if (isValue(kind, s(args[field]))) return go(without(args, "person"));

  const name = s(filled.person) || nameIn(kind, s(filled[field])) || s(args.person);
  // Whatever stood in the field isn't a number or address the user gave: it goes, with the name.
  const bare = without(args, "person", field);
  if (!name) return spec.required ? askAddress(undefined, false) : go(bare);
  if (!nameInWords(name, userText)) {
    notes.push(`person: "${name.slice(0, 80)}" is not in the user's words, so nobody was looked up`);
    return spec.required ? askAddress(undefined, false) : go(bare);
  }

  const permission = deps.contacts ? await deps.contacts.permission().catch(() => "denied" as const) : undefined;
  const granted = permission === "granted";
  const offer = deps.contacts !== undefined && !granted;
  const entries: ContactEntry[] = granted ? await deps.contacts!.entries().catch(() => []) : [];

  let candidates: PersonCandidate[];
  if (kind === "phone") candidates = matchContacts(name, entries, "phone");
  else {
    const sent = deps.pastRecipients ? await deps.pastRecipients().catch(() => []) : [];
    // Contacts first, so a person in both keeps the contact's name; an address mail can't carry is no candidate.
    candidates = mergeCandidates(matchContacts(name, entries, "email"), matchSentAddresses(name, sent)).filter((c) => emailOf(c.value) === c.value);
  }

  if (candidates.length === 1) {
    const c = candidates[0]!;
    notes.push(`${field}: found "${name.slice(0, 80)}" by name (${c.sources.join(", ")})`);
    return go({ ...bare, person: name, [field]: c.value }, [{ field, kind, name: c.name, value: c.value, sources: c.sources }], offer);
  }
  if (candidates.length > 1) {
    const shown = candidates.slice(0, MAX_CHOICES);
    // The full values live only in the tappable choices the screen gets; a tap sends just the picked one as the
    // user's words. The question is stored in the history the model reads, so it shows masked labels only.
    const choices = shown.map((c): Choice => ({ label: choiceLabel(c, false), text: c.value }));
    notes.push(`${field}: ${candidates.length} people match "${name.slice(0, 80)}", asked which`);
    const question = [deps.say(K(kind === "phone" ? "which_phone" : "which_email"), userText, { name }), ...shown.map((c) => `• ${choiceLabel(c, true)}`)].join("\n");
    return { kind: "ask", question, choices, notes, offer };
  }
  if (kind === "phone") {
    // Permission off: today's behavior, the other app's own picker chooses (invariant 5).
    if (!granted) return go(bare, [], offer);
    notes.push(`${field}: nobody called "${name.slice(0, 80)}" in the contacts, asked for the number`);
    return { kind: "ask", question: deps.say(K("none_phone"), userText, { name }), choices: [], notes, offer };
  }
  return askAddress(name, offer);

  function choiceLabel(c: PersonCandidate, masked: boolean): string {
    if (kind === "email") return `${c.name}, ${masked ? maskEmail(c.value) : c.value}`;
    const ending = deps.say(K("ending"), userText, { name: c.name, digits: lastDigits(c.value) });
    return c.label ? `${ending} (${c.label})` : ending;
  }

  /** Q48 (a): when Hermit has to ask for an address, people the user emailed before are tappable suggestions. */
  async function askAddress(who: string | undefined, offerIt: boolean): Promise<PeopleOutcome> {
    const sent = deps.pastRecipients ? await deps.pastRecipients().catch(() => []) : [];
    const recent = [...sent].reverse().map((a) => emailOf(a)).filter((a, i, all): a is string => a !== undefined && all.indexOf(a) === i).slice(0, MAX_SUGGESTIONS);
    const key = who ? (recent.length ? "none_email_suggest" : "none_email") : recent.length ? "who_email_suggest" : "who_email";
    return { kind: "ask", question: deps.say(K(key), userText, who ? { name: who } : {}), choices: recent.map((a) => ({ label: a, text: a })), notes, offer: offerIt };
  }
}

/** "ana.lopez@example.com" is "a***@example.com": enough to tell addresses apart by domain, not to use one. */
export function maskEmail(address: string): string {
  const [local = "", domain = ""] = address.split("@");
  return `${local.slice(0, 1)}***@${domain}`;
}

/**
 * The history keeps the call, not the number or address found by name (invariant 6): contact data is never stored in
 * Hermit's database beyond the turn that needed it. The user's own words, the sheet and the audit hash are unchanged.
 */
export function redactFound(text: string, found: readonly FoundPerson[]): string {
  let out = text;
  for (const f of found) {
    out = out.split(f.value).join("(found by name)");
    if (f.kind === "phone") {
      const d = f.value.replace(/\D/g, "");
      if (d) out = out.split(d).join("(found by name)");
    }
  }
  return out;
}
