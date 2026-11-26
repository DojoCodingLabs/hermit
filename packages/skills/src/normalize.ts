import { extractWhen, localIso, localIsoOf, splitClauses, type NormalizeContext } from "@hermit/core";
import { addressesIn, parseAddresses } from "./mail-address.ts";

type Args = Record<string, unknown>;

const foldWords = (t: string) => t.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").split(/[^\p{L}\p{N}]+/u).filter((w) => w.length >= 3);

/** Date part ("YYYY-MM-DD") and time part ("HH:MM") of a model-written local date-time, if it has them. */
function parts(v: unknown): { date?: string; time?: string } {
  const m = typeof v === "string" ? /^(\d{4}-\d{2}-\d{2})(?:T(\d{2}:\d{2}))?/.exec(v) : null;
  return m ? { date: m[1], ...(m[2] ? { time: m[2] } : {}) } : {};
}

function nextDay(date: string): string {
  return new Date(Date.UTC(+date.slice(0, 4), +date.slice(5, 7) - 1, +date.slice(8, 10) + 1, 12)).toISOString().slice(0, 10);
}

function addHour(date: string, time: string): string {
  const [h, m] = time.split(":").map(Number);
  if (h! < 23) return localIso(date, `${String(h! + 1).padStart(2, "0")}:${String(m).padStart(2, "0")}`);
  return localIso(nextDay(date), `00:${String(m).padStart(2, "0")}`);
}

/** remind.at from the user's words when they name a time, a day, or "in N hours". */
export function normalizeRemind(args: Args, ctx: NormalizeContext): { args: Args; notes: string[] } {
  // Several requests in one message: the reminder's text and time come from its own clause only.
  const own = splitClauses(ctx.userText);
  if (own.length > 1) {
    const mine = own.find((c) => /recu[eé]rdame|rec[oó]rdame|av[ií]same|remind me|alarma|recordatorio/i.test(c)) ?? own[0]!;
    const textClauses = typeof args.text === "string" ? splitClauses(args.text) : [];
    const trimmed = textClauses.length > 1 ? { ...args, text: textClauses[0] } : args;
    const r = normalizeRemind(trimmed, { ...ctx, userText: mine });
    return trimmed === args ? r : { args: r.args, notes: ["text: kept the reminder's own clause", ...r.notes] };
  }
  const w = extractWhen(ctx.userText, ctx.now, ctx.timeZone);
  // "el día del cumpleaños de mi mamá" / "on my mom's birthday": the date the user gave that day earlier in
  // this chat ("el cumpleaños de mi mamá es el 20 de noviembre"). The model guessed Nov 18 on the trajectory eval.
  const dayOf = /(?:el\s+)?d[ií]a\s+del?\s+(.+?)(?:\s+(?:que|para|a\s+las)\b|[,.]|$)|on\s+(?:the\s+day\s+of\s+)?((?:my|his|her|our)\s+.+?(?:birthday|anniversary|wedding|graduation))/iu.exec(ctx.userText);
  if (dayOf && !w.namedDay && w.time && ctx.earlier?.length) {
    const key = foldWords(dayOf[1] ?? dayOf[2] ?? "").filter((x) => x.length >= 4);
    for (const said of ctx.earlier) {
      const ew = extractWhen(said, ctx.now, ctx.timeZone);
      if (!ew.namedDay || !ew.date) continue;
      const words = new Set(foldWords(said));
      if (key.length && key.filter((k) => words.has(k)).length >= Math.min(2, key.length)) {
        const at = localIso(ew.date, w.time);
        return at === args.at ? { args, notes: [] } : { args: { ...args, at }, notes: [`at: ${String(args.at)} -> ${at} (the date the user gave earlier)`] };
      }
    }
  }
  const model = parts(args.at);
  let at: string | undefined;
  if (w.at !== undefined) at = localIsoOf(w.at, ctx.timeZone);
  else if (w.date && w.time) at = localIso(!w.namedDay && model.date && model.date > w.date ? model.date : w.date, w.time);
  else if (w.namedDay && w.date && model.time) at = localIso(w.date, model.time);
  if (!at || at === args.at) return { args, notes: [] };
  return { args: { ...args, at }, notes: [`at: ${String(args.at)} -> ${at} (from the user's words)`] };
}

/** calendar_add.start and end from the user's words ("el viernes de 10 a 11"). */
export function normalizeCalendarAdd(args: Args, ctx: NormalizeContext): { args: Args; notes: string[] } {
  const w = extractWhen(ctx.userText, ctx.now, ctx.timeZone);
  const ms = parts(args.start);
  const me = parts(args.end);
  const date = w.date ?? ms.date;
  const startTime = w.time ?? ms.time;
  if (!date || !startTime) return { args, notes: [] };
  const start = localIso(date, startTime);
  // The model's end is only kept when the words gave no time at all (a corrected start makes it unreliable).
  const modelEnd = me.date && me.time ? localIso(me.date === ms.date ? date : me.date, me.time) : undefined;
  const endDate = w.endNextDay ? nextDay(date) : date;
  const end = w.endTime ? localIso(endDate, w.endTime) : !w.time && modelEnd && modelEnd > start ? modelEnd : addHour(date, startTime);
  const notes: string[] = [];
  if (start !== args.start) notes.push(`start: ${String(args.start)} -> ${start} (from the user's words)`);
  if (end !== args.end) notes.push(`end: ${String(args.end)} -> ${end}`);
  return notes.length ? { args: { ...args, start, end }, notes } : { args, notes };
}

/** calendar_read.from and to cover the whole named day ("¿qué tengo el lunes?"). */
export function normalizeCalendarRead(args: Args, ctx: NormalizeContext): { args: Args; notes: string[] } {
  const w = extractWhen(ctx.userText, ctx.now, ctx.timeZone);
  if (!w.namedDay || !w.date) return { args, notes: [] };
  const from = localIso(w.date, "00:00");
  const to = `${w.date}T23:59:59`;
  if (from === args.from && to === args.to) return { args, notes: [] };
  return { args: { ...args, from, to }, notes: [`range: ${String(args.from)} to ${String(args.to)} -> ${w.date} (from the user's words)`] };
}

/**
 * reply_message.text is the message itself. BotPsy often passes the instruction through ("dile que voy
 * tarde", "tell him I'm late"); the leading instruction is cut by code, so the approval sheet and the
 * contact see only the message.
 */
const INSTRUCTION = /^\s*(?:(?:por favor|porfa|please|pls)[,\s]+)?(?:d[ií]le|dec[ií]le|d[ií]gale|cont[eé]stale|contestale|resp[oó]ndele|av[ií]sale|escr[ií]bele|m[aá]ndale|tell|text|message|reply to|answer|write)(?:\s+(?:a\s+)?[\p{L}.'-]+(?:\s+[\p{L}.'-]+)?)?\s+(?:que|that|diciendo que|saying)\s+/iu;

/** "tell Pedro I'll be there at 8": an English instruction with a capitalized name and no "that". */
const TELL_NAME = /^\s*(?:(?:please|pls)[,\s]+)?(?:tell|text|message)\s+\p{Lu}[\p{L}.'-]*\s+(?!that\b)/u;

/** The message from an instruction, or undefined when the words aren't one. */
function messageIn(instruction: string): string | undefined {
  const cut = instruction.replace(INSTRUCTION, "");
  const rest = cut !== instruction ? cut : instruction.replace(TELL_NAME, "");
  if (rest === instruction || !rest.trim()) return undefined;
  return rest.charAt(0).toUpperCase() + rest.slice(1);
}

export function normalizeReply(args: Args, ctx?: NormalizeContext): { args: Args; notes: string[] } {
  if (typeof args.text !== "string") return { args, notes: [] };
  // The user's own words carry the message ("decile a la Vale que llego a las 8"): they win over whatever
  // the model wrote (it once sent back the contact's own question). Otherwise clean the model's text.
  const fromUser = ctx ? messageIn(ctx.userText) : undefined;
  const text = fromUser ?? messageIn(args.text);
  if (!text || text === args.text) return { args, notes: [] };
  return { args: { ...args, text }, notes: [fromUser ? "text: the message as the user said it" : `text: kept the message, dropped the instruction`] };
}

/** remember.fact is the fact itself, not "anota que ..." / "remember that ..." (BotPsy often passes the instruction through). */
const REMEMBER = /^\s*(?:(?:por favor|porfa|please|pls)[,\s]+)?(?:recuerda|record[aá]|acu[eé]rdate(?: de)?|acordate(?: de)?|anota|apunta|guarda|guard[aá]|toma nota(?: de)?|ten en cuenta|remember|note|keep in mind|save|store|write down|jot down)(?:\s+(?:esto|this))?\s*(?:que|that|:)?\s+/iu;


export function normalizeRemember(args: Args, ctx?: NormalizeContext): { args: Args; notes: string[] } {
  if (typeof args.fact !== "string") return { args, notes: [] };
  // The user's own words win when they carry the instruction and the model's fact barely shares their words
  // (translated or reworded): "recuerda que mi pasaporte vence en marzo" was saved as "my passport expires...".
  // In a message with several requests, only the clause that asks to remember counts.
  const clause = ctx ? (splitClauses(ctx.userText).find((c) => REMEMBER.test(c)) ?? ctx.userText) : "";
  const said = clause.replace(REMEMBER, "");
  if (ctx && said !== clause && said.trim().length >= 3) {
    const theirs = new Set(foldWords(said));
    const mine = foldWords(args.fact);
    const shared = mine.filter((w) => theirs.has(w)).length;
    if (mine.length && shared / mine.length < 0.5) {
      const fact = said.trim().replace(/[.!]+$/, "");
      return { args: { ...args, fact: fact.charAt(0).toUpperCase() + fact.slice(1) }, notes: ["fact: the user's own words (the model's version didn't match them)"] };
    }
  }
  const cut = args.fact.replace(REMEMBER, "");
  if (cut === args.fact || cut.trim().length < 3) return { args, notes: [] };
  return { args: { ...args, fact: cut.charAt(0).toUpperCase() + cut.slice(1) }, notes: ["fact: kept the fact, dropped the instruction"] };
}

/**
 * read_messages.contact from the user's words when the model left it empty ("¿me escribió el Pipe?",
 * "text Carlos I'm outside"): BotPsy often read everyone's messages instead of the named person's.
 * Only fills an empty contact; never replaces one the model gave.
 */
const CONTACT_PATTERNS: readonly RegExp[] = [
  // Group chats: "revisa el grupo de la familia", "the soccer team group".
  /((?:grupo|chat)\s+(?:de\s+(?:la\s+|los\s+|las\s+|mi\s+)?)?[\p{L}][\p{L}'-]*)/iu,
  /(?:the|my)\s+([\p{L}][\p{L}'-]*(?:\s+[\p{L}][\p{L}'-]*)?)\s+(?:group|chat)\b/iu,
  // Spanish: verbs of telling or replying, then optional article or possessive, then the name.
  /(?:d[ií]le|dec[ií]le|av[ií]sale|cont[eé]stale|resp[oó]ndele|escr[ií]bele|m[aá]ndale(?:\s+un\s+(?:wasap|whatsapp|mensaje|msj))?)\s+(?:a\s+)?(?:la\s+|el\s+|al\s+|mi\s+|mis\s+)?((?:(?:dra?|don|doña|ing|lic|profe|sr|sra)\.?\s+)?[\p{L}][\p{L}'-]*(?:\s+[\p{Lu}][\p{L}'-]*)?)/iu,
  // Spanish: who wrote or what someone said.
  /(?:me\s+escribi[oó]|me\s+mand[oó]\s+algo|me\s+contest[oó]|me\s+respondi[oó]|q(?:u[eé])?\s+(?:me\s+)?dijo|q(?:u[eé])?\s+dice)\s+(?:la\s+|el\s+|mi\s+)?([\p{L}][\p{L}'-]*)/iu,
  /(?:^|\s)(?:la\s+|el\s+|mi\s+)?([\p{L}][\p{L}'-]*)\s+(?:me\s+escribi[oó]|me\s+mand[oó]|me\s+contest[oó])/iu,
  /(?:mensajes?|wasaps?|whatsapps?)\s+de\s+(?:la\s+|el\s+|mi\s+)?([\p{L}][\p{L}'-]*)/iu,
  // English: verbs of telling or replying, then the name.
  /(?:text|tell|message|msg|answer|reply\s+to|send)\s+(?:my\s+|the\s+)?((?:(?:dr|mr|mrs|ms)\.?\s+)?[\p{L}][\p{L}'-]*)/iu,
  /let\s+(?:my\s+)?((?:(?:dr|mr|mrs|ms)\.?\s+)?[\p{L}][\p{L}'-]*)\s+know/iu,
  /(?:did|has|if|whether)\s+(?:my\s+)?([\p{L}][\p{L}'-]*)\s+(?:write|wrote|text|texted|answer|answered|reply|replied|message|messaged)/iu,
  /(?:messages?|texts?)\s+from\s+(?:my\s+)?([\p{L}][\p{L}'-]*)/iu,
];
const NOT_A_CONTACT = /^(me|us|him|her|them|que|that|a|an|the|el|la|lo|le|algo|something|back|everyone|todos|messages?|mensajes?)$/i;

export function normalizeReadMessages(args: Args, ctx?: NormalizeContext): { args: Args; notes: string[] } {
  if (!ctx) return { args, notes: [] };
  const given = typeof args.contact === "string" ? args.contact.trim() : "";
  if (given) {
    // A contact the user never named is invented ("user", "me"): drop it and read everyone instead.
    const fold = (t: string) => t.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    const head = fold(given).split(/\s+/).find((w) => w.length > 1 && !/^(dra?|dr|don|mr|mrs|ms|sr|sra)\.?$/.test(w)) ?? "";
    if (head && fold(ctx.userText).includes(head)) return { args, notes: [] };
    const rest = { ...args };
    delete rest.contact;
    return normalizeReadMessages(rest, ctx).args.contact ? normalizeReadMessages(rest, ctx) : { args: rest, notes: [`contact: dropped "${given}", not in the user's words`] };
  }
  for (const [i, p] of CONTACT_PATTERNS.entries()) {
    const m = p.exec(ctx.userText);
    // The first two patterns are group chats: their names are whole phrases ("grupo de la familia").
    if (i < 2 && m?.[1]) return { args: { ...args, contact: m[1].trim() }, notes: [`contact: "${m[1].trim()}" from the user's words`] };
    // Keep a surname only when it is capitalized as written ("Dra. Morales", not "Morales diciendo").
    const words = (m?.[1] ?? "").trim().split(/\s+/);
    const keep = words.filter((w, i) => i === 0 || /^\p{Lu}/u.test(w) || /\.$/.test(words[i - 1] ?? ""));
    const name = keep.join(" ");
    if (name && !NOT_A_CONTACT.test(name)) return { args: { ...args, contact: name }, notes: [`contact: "${name}" from the user's words`] };
  }
  return { args, notes: [] };
}

/** An empty account means every account (US-MAIL-08): drop it rather than search for "". */
function dropEmptyAccount(args: Args, notes: string[]): Args {
  if (args.account === undefined || (typeof args.account === "string" && args.account.trim())) return args;
  const rest = { ...args };
  delete rest.account;
  notes.push("account: empty, so every account");
  return rest;
}

const UNREAD_WORDS = /(?<![\p{L}])(sin leer|no le[ií]dos?|nuevos?|nuevas?|unread|new)(?![\p{L}])/iu;
const RECENT_WORDS = /(?<![\p{L}])([uú]ltimos?|[uú]ltimas?|recientes?|latest|recent|last|todos|all)(?![\p{L}])/iu;
const COUNT = /(?<![\p{L}\p{N}])(\d{1,3})\s+(?:\p{L}+\s+)?(?:correos?|e-?mails?|mails?|mensajes?|messages?)(?![\p{L}])/iu;
const MAIL_MAX = 50;

/** mail_list: unread or recent, and a count, from the user's own words; the model's guess stands otherwise. */
export function normalizeMailList(args: Args, ctx?: NormalizeContext): { args: Args; notes: string[] } {
  const notes: string[] = [];
  let out = dropEmptyAccount(args, notes);
  if (!ctx) return { args: out, notes };
  const unread = UNREAD_WORDS.test(ctx.userText);
  const recent = RECENT_WORDS.test(ctx.userText);
  if (unread && out.unreadOnly !== true) {
    out = { ...out, unreadOnly: true };
    notes.push("unreadOnly: the user asked for unread or new email");
  } else if (!unread && recent && out.unreadOnly !== false) {
    out = { ...out, unreadOnly: false };
    notes.push("unreadOnly: the user asked for the latest email");
  }
  const n = COUNT.exec(ctx.userText);
  if (n) {
    const max = Math.min(Math.max(Number(n[1]), 1), MAIL_MAX);
    if (out.max !== max) {
      out = { ...out, max };
      notes.push(`max: ${max} from the user's words`);
    }
  }
  return { args: out, notes };
}

/** Words that name email itself, or join words: every search term must match, so these would hide the message. */
const SEARCH_FILLER = new Set([
  "email", "emails", "e-mail", "e-mails", "mail", "mails", "correo", "correos", "mensaje", "mensajes", "message", "messages", "inbox", "bandeja",
  "de", "del", "la", "el", "los", "las", "un", "una", "the", "a", "an", "of", "from", "about", "sobre", "con", "with", "my", "mi", "mis", "that", "que",
]);

/** mail_search: the query keeps only words that must appear in the message; the sender lives in from. */
export function normalizeMailSearch(args: Args, ctx?: NormalizeContext): { args: Args; notes: string[] } {
  const notes: string[] = [];
  let out = dropEmptyAccount(args, notes);
  void ctx;
  const from = typeof out.from === "string" ? out.from.trim() : "";
  if (typeof out.from === "string" && !from) {
    const rest = { ...out };
    delete rest.from;
    out = rest;
  }
  if (typeof out.query === "string") {
    const fold = (w: string) => w.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
    const fromWords = new Set(from.split(/\s+/).map(fold).filter(Boolean));
    const kept = out.query.split(/\s+/).filter((w) => w && !SEARCH_FILLER.has(fold(w)) && !fromWords.has(fold(w)));
    const query = kept.join(" ");
    if (query !== out.query) {
      notes.push(`query: "${out.query}" to "${query}"`);
      if (query) out = { ...out, query };
      else {
        const rest = { ...out };
        delete rest.query;
        out = rest;
      }
    }
  }
  return { args: out, notes };
}

/** mail_read: "3" or "M3" is the short id "m3" that mail_list handed out. */
export function normalizeMailRead(args: Args, ctx?: NormalizeContext): { args: Args; notes: string[] } {
  void ctx;
  const raw = typeof args.messageId === "string" || typeof args.messageId === "number" ? String(args.messageId).trim() : "";
  const m = /^[mM]?(\d{1,4})$/.exec(raw);
  if (!m || raw === `m${m[1]}`) return { args, notes: [] };
  return { args: { ...args, messageId: `m${m[1]}` }, notes: [`messageId: "${raw}" to "m${m[1]}"`] };
}

/**
 * reminder_cancel.which from the user's own words when they name a time ("cancela el recordatorio de las 9"):
 * the model once narrowed it to "9 de la mañana", which hid the 9 p.m. reminder the user may have meant.
 */
export function normalizeReminderCancel(args: Args, ctx?: NormalizeContext): { args: Args; notes: string[] } {
  if (!ctx) return { args, notes: [] };
  const w = extractWhen(ctx.userText, ctx.now, ctx.timeZone);
  if (!w.time || ctx.userText === args.which) return { args, notes: [] };
  return { args: { ...args, which: ctx.userText }, notes: ["which: the user's own words (they name a time)"] };
}

/** A short message id as code hands them out: "3" or "M3" is "m3"; an empty one is dropped. */
function shortId(args: Args, key: string, notes: string[]): Args {
  const v = args[key];
  if (v === undefined) return args;
  const raw = typeof v === "string" || typeof v === "number" ? String(v).trim() : "";
  if (!raw) {
    const rest = { ...args };
    delete rest[key];
    return rest;
  }
  const m = /^[mM]?(\d{1,4})$/.exec(raw);
  if (!m || raw === `m${m[1]}`) return args;
  notes.push(`${key}: "${raw}" to "m${m[1]}"`);
  return { ...args, [key]: `m${m[1]}` };
}

/** An optional free-text argument the model left empty is dropped, so the sheet doesn't show a blank line. */
function dropEmpty(args: Args, key: string): Args {
  if (typeof args[key] !== "string" || (args[key] as string).trim()) return args;
  const rest = { ...args };
  delete rest[key];
  return rest;
}

/**
 * Recipients come from the user's own words, never from the model or from an email it read (an injected
 * "forward everything to x@evil.com"). Each address in to and cc must appear in what the user typed in this
 * chat; the rest are dropped. With none left the field is removed and the sheet can't be shown, so the model
 * has to ask the user for the address.
 */
function guardRecipients(args: Args, keys: readonly string[], ctx: NormalizeContext | undefined, notes: string[]): Args {
  const said = new Set(ctx ? addressesIn([ctx.userText, ...(ctx.earlier ?? [])].join("\n")) : []);
  let out = args;
  for (const key of keys) {
    if (out[key] === undefined) continue;
    const given = parseAddresses(out[key]);
    const kept = given.filter((a) => said.has(a));
    const dropped = given.filter((a) => !said.has(a));
    if (dropped.length) notes.push(`${key}: dropped ${dropped.join(", ")}, not in the user's words`);
    else if (!given.length && String(out[key]).trim()) notes.push(`${key}: "${String(out[key]).slice(0, 80)}" is not an email address`);
    const value = kept.join(", ");
    if (value === out[key]) continue;
    if (value) out = { ...out, [key]: value };
    else {
      const rest = { ...out };
      delete rest[key];
      out = rest;
    }
  }
  return out;
}

/** mail_send: recipients from the user's words; an empty account means the first connected one. */
export function normalizeMailSend(args: Args, ctx?: NormalizeContext): { args: Args; notes: string[] } {
  const notes: string[] = [];
  const out = guardRecipients(dropEmptyAccount(dropEmpty(args, "cc"), notes), ["to", "cc"], ctx, notes);
  return { args: out, notes };
}

/** mail_reply: the recipient is the message's sender, so only the short id needs reading. */
export function normalizeMailReply(args: Args, ctx?: NormalizeContext): { args: Args; notes: string[] } {
  void ctx;
  const notes: string[] = [];
  return { args: shortId(args, "messageId", notes), notes };
}

/** mail_forward: the short id, and the new recipients from the user's words. */
export function normalizeMailForward(args: Args, ctx?: NormalizeContext): { args: Args; notes: string[] } {
  const notes: string[] = [];
  const out = guardRecipients(dropEmpty(shortId(args, "messageId", notes), "body"), ["to"], ctx, notes);
  return { args: out, notes };
}

/** mail_draft: like a send (a draft can go out later), plus the optional message it answers. */
export function normalizeMailDraft(args: Args, ctx?: NormalizeContext): { args: Args; notes: string[] } {
  const notes: string[] = [];
  const out = guardRecipients(dropEmptyAccount(dropEmpty(dropEmpty(shortId(args, "messageId", notes), "subject"), "to"), notes), ["to"], ctx, notes);
  return { args: out, notes };
}

const ARCHIVE_WORDS = /(?<![\p{L}])archiv\p{L}*/iu;
const LABEL_WORDS = /(?<![\p{L}])(etiqueta\p{L}*|label\p{L}*)(?![\p{L}])/iu;
const READ_WORDS = /(?<![\p{L}])(le[ií]d[oa]s?|as read|read)(?![\p{L}])/iu;
const ALL_SHOWN = /^(all|todos|todas|those|these|them|esos|esas|estos|estas|all shown)$/i;

/**
 * mail_modify: the ids as code hands them out ("m1 m2"), "shown" for everything the last list or search
 * showed, and the action the user's own words name.
 */
export function normalizeMailModify(args: Args, ctx?: NormalizeContext): { args: Args; notes: string[] } {
  const notes: string[] = [];
  let out = dropEmpty(args, "label");
  const raw = typeof out.messageIds === "string" ? out.messageIds.trim() : "";
  if (ALL_SHOWN.test(raw)) {
    out = { ...out, messageIds: "shown" };
    notes.push(`messageIds: "${raw}" to the messages just shown`);
  } else if (raw && raw !== "shown") {
    const ids = [...new Set([...raw.matchAll(/(?<![\p{L}\p{N}])[mM]?(\d{1,4})(?![\p{N}])/gu)].map((m) => `m${m[1]}`))];
    const joined = ids.join(" ");
    if (joined && joined !== raw) {
      out = { ...out, messageIds: joined };
      notes.push(`messageIds: "${raw}" to "${joined}"`);
    }
  }
  if (ctx) {
    const action = ARCHIVE_WORDS.test(ctx.userText) ? "archive" : LABEL_WORDS.test(ctx.userText) ? "label" : READ_WORDS.test(ctx.userText) ? "mark_read" : undefined;
    if (action && out.action !== action) {
      notes.push(`action: ${String(out.action)} to ${action} (from the user's words)`);
      out = { ...out, action };
    }
  }
  return { args: out, notes };
}
