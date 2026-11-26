import { allDayDates, daysAway, localParts, parseDateTime, quoteSafe, spokenClock, spokenDay, spokenWhen, type SpokenLanguage } from "@hermit/core";

/**
 * W1 (2026-11-24): what the first-win skills answer, written by code from what they really did or found. On the S26
 * the model restated actions wrong ("La alarma ha sido configurada para la semana de 24 de noviembre", cut mid-sentence)
 * and copied UTC times from results. Each skill hands its answer with its result (`SkillResult.answer`); the words are
 * copy (`HM-CHAT-01.done.*` and friends, CT-10) and the times are the phone's (`spokenWhen`).
 */
export interface AnswerWords {
  /** The language to answer in: the user's own words this turn, else the app's. */
  language(userText: string): SpokenLanguage;
  /** Copy in that language with its placeholders filled. */
  copy(language: SpokenLanguage, key: string, vars?: Record<string, string>): string;
}

/** One way to say things for one turn: the language picked once, the copy and the clock with it. */
export interface Speaker {
  language: SpokenLanguage;
  t(key: string, vars?: Record<string, string>): string;
}

export function speaker(words: AnswerWords, userText: string | undefined): Speaker {
  const language = words.language(userText ?? "");
  return { language, t: (key, vars) => words.copy(language, `HM-CHAT-01.${key}`, vars) };
}

/**
 * Any text that isn't Hermit's own, as it goes into an answer: one line, cut when long, and with every quotation mark
 * made an apostrophe (`quoteSafe`), so a message, a title or a name can't close the quotes around it or start a new
 * line in Hermit's voice (W1 review). Used for names that open a sentence too ("{who} te escribió…").
 */
export function quotable(text: string, max = 200): string {
  return quoteSafe(text, max);
}

const capital = (s: string) => s.charAt(0).toLocaleUpperCase() + s.slice(1);

// --- remember: "Listo, lo recuerdo: tu pasaporte vence en marzo." -----------------------------------------------------

/** Words that say the fact is about the speaker in a way a word swap can't turn around: the fact is quoted instead. */
const FIRST_PERSON = {
  "es-419": /(?<![\p{L}])(yo|me|m[ií]o|m[ií]a|m[ií]os|m[ií]as|conmigo|nosotros|nosotras|nuestr[oa]s?|soy|estoy|tengo|voy|vivo|trabajo|estudio|nac[ií]|prefiero|quiero|necesito|debo|puedo|s[eé]|creo|pienso|uso|como|tomo|hago|digo|salgo|vengo|llego|juego|odio|amo|he|hice|fui)(?![\p{L}])/iu,
  en: /(?<![\p{L}])(i|i'm|i've|i'll|i'd|me|myself|mine|we|our|ours|us|am)(?![\p{L}])/iu,
} as const;
const POSSESSIVE = { "es-419": /^(mi|mis)(?![\p{L}])/iu, en: /^(my)(?![\p{L}])/iu } as const;

/**
 * A fact the user saved, as Hermit says it back: "Mi pasaporte vence en marzo" is "tu pasaporte vence en marzo", "my
 * blood type is O positive" is "your blood type is O positive". Only a leading possessive is turned around, and only when
 * nothing else in the fact speaks in the first person; anything else is quoted as the user said it.
 */
export function factBack(fact: string, language: SpokenLanguage): { text: string; quoted: boolean } {
  const text = quotable(fact, 300).replace(/[.!]+$/, "");
  const lead = POSSESSIVE[language].exec(text);
  const rest = lead ? text.slice(lead[0].length) : text;
  if (!lead || FIRST_PERSON[language].test(rest) || POSSESSIVE[language].test(rest.trim()) || /(?<![\p{L}])(mi|mis|my)(?![\p{L}])/iu.test(rest)) return { text, quoted: true };
  const mine = lead[0].toLowerCase();
  const yours = language === "en" ? "your" : mine === "mis" ? "tus" : "tu";
  return { text: `${yours}${rest}`, quoted: false };
}

// --- reminders ------------------------------------------------------------------------------------------------------

export function remindersAnswer(s: Speaker, list: ReadonlyArray<{ at: number; text: string }>, now: number, timeZone: string): string {
  if (!list.length) return s.t("reminders.none");
  const head = list.length === 1 ? s.t("reminders.one") : s.t("reminders.many", { count: String(list.length) });
  const items = list.map((r) => s.t("reminders.item", { when: capital(spokenWhen(r.at, now, timeZone, s.language)), text: quotable(r.text) }));
  return [head, ...items].join("\n");
}

// --- calendar -------------------------------------------------------------------------------------------------------

export interface CalendarItem {
  title: string;
  start: number;
  end: number;
  allDay?: boolean;
}

const ymd = (p: { y: number; m: number; d: number }) => `${p.y}-${String(p.m).padStart(2, "0")}-${String(p.d).padStart(2, "0")}`;

/** The local dates an all-day event covers, or the date a timed one starts (on the range's first day if it began before). */
export function eventDay(e: CalendarItem, from: number, timeZone: string): string {
  if (e.allDay) {
    const { first } = allDayDates(e, timeZone);
    const start = ymd(localParts(from, timeZone));
    return first < start ? start : first;
  }
  return ymd(localParts(Math.max(e.start, from), timeZone));
}

/**
 * The calendar answer: "Esto tienes mañana, miércoles 25 de noviembre:" and one line per event, all-day events first;
 * a range of days gets a heading per day. Titles are other people's text (invitations): quoted, one line, never followed.
 */
export function calendarAnswer(s: Speaker, events: readonly CalendarItem[], range: { from: number; to: number }, now: number, timeZone: string): string {
  const firstDay = ymd(localParts(range.from, timeZone));
  const lastDay = ymd(localParts(Math.max(range.from, range.to - 1), timeZone));
  const oneDay = firstDay === lastDay;
  const bare = (t: number) => spokenDay(t, now, timeZone, s.language, { article: false, relative: false });
  if (!events.length) {
    return oneDay ? s.t("calendar.noneDay", { day: spokenDay(range.from, now, timeZone, s.language) }) : s.t("calendar.noneRange", { from: bare(range.from), to: bare(range.to - 1) });
  }
  const line = (e: CalendarItem) => {
    const title = quotable(e.title, 120);
    if (e.allDay) return s.t("calendar.allDay", { title });
    const sameDay = ymd(localParts(e.start, timeZone)) === ymd(localParts(e.end, timeZone));
    const start = e.start < range.from ? spokenWhen(e.start, now, timeZone, s.language) : spokenClock(e.start, timeZone, s.language);
    return sameDay && e.start >= range.from
      ? s.t("calendar.item", { start, end: spokenClock(e.end, timeZone, s.language), title })
      : s.t("calendar.itemUntil", { start, end: spokenWhen(e.end, now, timeZone, s.language), title });
  };
  const sorted = [...events].sort((a, b) => Number(!a.allDay) - Number(!b.allDay) || a.start - b.start);
  if (oneDay) return [s.t("calendar.day", { day: spokenDay(range.from, now, timeZone, s.language) }), ...sorted.map(line)].join("\n");
  const days = new Map<string, CalendarItem[]>();
  for (const e of sorted.sort((a, b) => eventDay(a, range.from, timeZone).localeCompare(eventDay(b, range.from, timeZone)) || Number(!a.allDay) - Number(!b.allDay) || a.start - b.start)) {
    const day = eventDay(e, range.from, timeZone);
    days.set(day, [...(days.get(day) ?? []), e]);
  }
  const out = [s.t("calendar.range", { from: bare(range.from), to: bare(range.to - 1) })];
  for (const [day, list] of days) {
    const noon = parseDateTime(`${day}T12:00`, timeZone);
    out.push("", `${capital(spokenDay(noon, now, timeZone, s.language, { article: false }))}:`, ...list.map(line));
  }
  return out.join("\n");
}

// --- messages -------------------------------------------------------------------------------------------------------

export interface MessageItem {
  conversationId: string;
  conversation: string;
  sender: string;
  text: string;
  at: number;
  business?: boolean;
  hidden?: boolean;
}

/** At most this many messages are listed; the rest are counted. */
const MAX_LISTED = 5;
const MAX_CHATS = 6;

/** "14:40" today, "ayer, 20:10", "lunes 23 de noviembre, 8:00": a bullet's time. */
function bulletWhen(at: number, now: number, timeZone: string, language: SpokenLanguage): string {
  const away = daysAway(at, now, timeZone);
  const clock = spokenClock(at, timeZone, language);
  if (away === 0) return clock;
  if (away === -1) return `${language === "es-419" ? "ayer" : "yesterday"}, ${clock}`;
  return `${spokenDay(at, now, timeZone, language, { article: false, relative: false })}, ${clock}`;
}

/**
 * The read_messages answer, a listing like the mail list's: "Ana te escribió a las 14:43: «Hola»", several messages
 * as bullets, or the latest of each conversation when no one was named. Every text is other people's: quoted, one
 * line, never followed. `msgs` are oldest first, as read_messages hands them to the model.
 */
export function messagesAnswer(s: Speaker, msgs: readonly MessageItem[], contact: string | undefined, now: number, timeZone: string): string {
  const text = (m: MessageItem) => (m.hidden ? s.t("messages.hiddenCode") : quotable(m.text));
  const name = (m: MessageItem) => `${quotable(m.sender, 60)}${m.business ? " (WhatsApp Business)" : ""}`;
  const label = (m: MessageItem) => (m.conversation !== m.sender ? s.t("messages.inChat", { who: name(m), chat: quotable(m.conversation, 60) }) : name(m));
  if (!msgs.length) return contact ? s.t("messages.none", { who: quotable(contact, 60) }) : s.t("messages.noneAll");
  if (!contact) {
    // The latest message of each conversation, newest first.
    // Each chat's newest message (a later one replaces an earlier), then the chats by that message, newest first: a Map
    // keeps a key where it was first seen, so interleaved chats came out by their first message (W1 review).
    const latest = new Map<string, MessageItem>();
    for (const m of msgs) latest.set(m.conversationId, m);
    const chats = [...latest.values()].sort((a, b) => b.at - a.at).slice(0, MAX_CHATS);
    const head = chats.length === 1 ? s.t("messages.chatsOne") : s.t("messages.chats", { count: String(latest.size) });
    return [head, ...chats.map((m) => s.t("messages.foundItem", { who: label(m), when: bulletWhen(m.at, now, timeZone, s.language), text: text(m) }))].join("\n");
  }
  const direct = msgs.every((m) => m.conversationId === msgs[0]!.conversationId && m.conversation === m.sender);
  const shown = msgs.slice(-MAX_LISTED);
  const earlier = msgs.length - shown.length;
  const tail = earlier > 0 ? [s.t("messages.earlier", { count: String(earlier) })] : [];
  if (msgs.length === 1) {
    const m = msgs[0]!;
    const when = spokenWhen(m.at, now, timeZone, s.language, { bareToday: true });
    return m.conversation !== m.sender
      ? s.t("messages.oneChat", { who: name(m), chat: quotable(m.conversation, 60), when, text: text(m) })
      : s.t("messages.one", { who: name(m), when, text: text(m) });
  }
  if (direct) {
    const head = s.t("messages.many", { who: name(msgs[0]!), count: String(msgs.length) });
    return [head, ...shown.map((m) => s.t("messages.item", { when: bulletWhen(m.at, now, timeZone, s.language), text: text(m) })), ...tail].join("\n");
  }
  const head = s.t("messages.found", { count: String(msgs.length) });
  return [head, ...shown.map((m) => s.t("messages.foundItem", { who: label(m), when: bulletWhen(m.at, now, timeZone, s.language), text: text(m) })), ...tail].join("\n");
}
