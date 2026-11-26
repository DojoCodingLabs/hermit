import {
  allDayDates,
  APP_LABEL,
  extractWhen,
  localParts,
  modelClock,
  modelDay,
  modelWhen,
  parseDateTime,
  ReminderError,
  spokenSpan,
  spokenWhen,
  TimeError,
  type CalendarPort,
  type MessageStore,
  type Reminders,
  type ReplySenderPort,
} from "@hermit/core";
import { replyBinding, skillById } from "@hermit/skills";
import { calendarAnswer, messagesAnswer, quotable, remindersAnswer, speaker, type AnswerWords } from "./answers.ts";
import type { SkillRuntime } from "./types.ts";

/**
 * W1: how the first-win skills tell time and answer. `timeZone` is the phone's; every time the model reads is local
 * words from it (never `toISOString`). With `words`, each skill also writes the user's answer itself (`answer`).
 */
export interface FirstWinOptions {
  timeZone: string;
  now?: () => number;
  words?: AnswerWords;
}

const def = (id: string) => {
  const d = skillById(id);
  if (!d) throw new Error(`skill ${id} is missing from the catalog`);
  return d;
};

/** FR-CAL-01: reads cover at most 31 days. */
export const MAX_CALENDAR_RANGE_MS = 31 * 24 * 60 * 60 * 1000;

/** remind (FR-REM-01, FR-REM-02). `locale` is the app's, for the question when two reminders match. */
export function reminderSkills(reminders: Reminders, display?: { locale: string } & Partial<FirstWinOptions>): SkillRuntime[] {
  const timeZone = display?.timeZone ?? "UTC";
  const now = display?.now ?? Date.now;
  // Local time in words: a raw UTC timestamp confused the model's reply on the S26.
  const when = (at: number) => modelWhen(at, now(), timeZone);
  const words = display?.words;
  return [
    {
      def: def("remind"),
      async execute(args, ctx) {
        try {
          const r = await reminders.schedule(String(args.text ?? ""), String(args.at ?? ""));
          const s = words && speaker(words, ctx.userText);
          return {
            ok: true,
            modelText: `Reminder set for ${when(r.at)}: ${r.text}. Tell the user it's set and when.`,
            ...(s ? { answer: s.t("done.remind", { when: spokenWhen(r.at, now(), timeZone, s.language), text: quotable(r.text) }) } : {}),
          };
        } catch (err) {
          if (err instanceof ReminderError) return { ok: false, modelText: err.message };
          throw err;
        }
      },
    },
    {
      def: def("reminders_list"),
      async execute(_args, ctx) {
        const list = (await reminders.pending()).sort((a, b) => a.at - b.at);
        const s = words && speaker(words, ctx.userText);
        const answer = s ? { answer: remindersAnswer(s, list, now(), timeZone) } : {};
        const items = list.map((r) => ({ at: r.at, text: r.text }));
        if (!list.length) return { ok: true, modelText: "No upcoming reminders.", items, ...answer };
        return { ok: true, modelText: list.map((r) => `- ${when(r.at)}: ${r.text}`).join("\n"), items, ...answer };
      },
    },
    {
      def: def("reminder_cancel"),
      async execute(args, ctx) {
        const list = (await reminders.pending()).sort((a, b) => a.at - b.at);
        const matches = matchReminders(list, String(args.which ?? ""), timeZone);
        if (!matches.length) return { ok: false, modelText: list.length ? `No reminder matches that. Upcoming: ${list.map((r) => `${when(r.at)}: ${r.text}`).join("; ")}` : "There are no upcoming reminders." };
        if (matches.length > 1) {
          // The question in the user's language when the words are wired, else the app's; each time in local words.
          const language = words ? speaker(words, ctx.userText).language : display?.locale.startsWith("es") ? "es-419" : "en";
          const options = matches.map((r) => `${r.text} (${spokenWhen(r.at, now(), timeZone, language)})`);
          const last = options.pop()!;
          const ask = language === "es-419" ? `¿Cuál cancelo: ${options.join(", ")} o ${last}?` : `Which one should I cancel: ${options.join(", ")} or ${last}?`;
          return { ok: false, modelText: `More than one reminder matches: ${matches.map((r) => `${when(r.at)}: ${r.text}`).join("; ")}. Ask the user which one.`, ask };
        }
        const r = matches[0]!;
        await reminders.cancel(r.id);
        const s = words && speaker(words, ctx.userText);
        return {
          ok: true,
          modelText: `Cancelled the reminder "${r.text}" for ${when(r.at)}.`,
          ...(s ? { answer: s.t("done.reminderCancel", { text: quotable(r.text), when: spokenWhen(r.at, now(), timeZone, s.language) }) } : {}),
        };
      },
    },
  ];
}

/**
 * Which pending reminders the user's words point at: by the hour they name ("el de las 9"), else by shared
 * words with the reminder text ("lo de mamá"). Several matches are returned, never guessed between.
 */
export function matchReminders<R extends { at: number; text: string }>(list: readonly R[], which: string, timeZone: string): R[] {
  const w = extractWhen(which, Date.now(), timeZone);
  if (w.time) {
    const [h, m] = w.time.split(":").map(Number);
    const local = (t: number) => {
      const parts = new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(new Date(t));
      return Number(parts.find((p) => p.type === "hour")!.value) * 60 + Number(parts.find((p) => p.type === "minute")!.value);
    };
    // "las 9" may mean 9:00 or 21:00: compare on the 12-hour clock unless the words said which.
    const byTime = list.filter((r) => local(r.at) % 720 === (h! * 60 + m!) % 720);
    if (byTime.length) return byTime;
  }
  const words = (t: string) => new Set(t.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").split(/[^\p{L}\p{N}]+/u).filter((x) => x.length > 2 && !STOP.has(x)));
  const want = words(which);
  if (!want.size) return [];
  const scored = list.map((r) => ({ r, n: [...words(r.text)].filter((x) => want.has(x)).length })).filter((x) => x.n > 0);
  const best = Math.max(0, ...scored.map((x) => x.n));
  return scored.filter((x) => x.n === best).map((x) => x.r);
}

const STOP = new Set(["the", "my", "reminder", "reminders", "cancel", "about", "for", "que", "los", "las", "del", "con", "para", "recordatorio", "recordatorios", "cancela", "cancelar", "quita", "borra", "mio", "mis", "ese", "esa", "eso", "lo"]);

/** calendar_read and calendar_add (FR-CAL-01). Event text written by others is untrusted (the skill says so). */
export function calendarSkills(calendar: CalendarPort, opts: FirstWinOptions): SkillRuntime[] {
  const { timeZone } = opts;
  const now = opts.now ?? Date.now;
  const at = (v: unknown) => parseDateTime(String(v ?? ""), timeZone);
  const ymd = (t: number) => {
    const p = localParts(t, timeZone);
    return `${p.y}-${String(p.m).padStart(2, "0")}-${String(p.d).padStart(2, "0")}`;
  };
  return [
    {
      def: def("calendar_read"),
      async execute(args, ctx) {
        try {
          const from = at(args.from);
          const to = at(args.to);
          if (to <= from) return { ok: false, modelText: "The end must be after the start." };
          if (to - from > MAX_CALENDAR_RANGE_MS) return { ok: false, modelText: "I can read at most 31 days at a time." };
          // An all-day event is its dates (Android keeps them at UTC midnight): one that only touches the range because
          // of that is not on the asked days, and its day is never read in the phone's zone (it would be the evening before).
          const first = ymd(from);
          const last = ymd(Math.max(from, to - 1));
          const events = (await calendar.list(from, to))
            .filter((e) => !e.allDay || (allDayDates(e, timeZone).last >= first && allDayDates(e, timeZone).first <= last))
            .sort((a, b) => Number(!a.allDay) - Number(!b.allDay) || a.start - b.start);
          const s = opts.words && speaker(opts.words, ctx.userText);
          const answer = s ? { answer: calendarAnswer(s, events, { from, to }, now(), timeZone) } : {};
          const items = events.map((e) => ({ at: e.start, end: e.end, text: e.title, ...(e.allDay ? { allDay: true } : {}) }));
          const n = now();
          if (!events.length) return { ok: true, modelText: first === last ? `No events on ${modelDay(from, n, timeZone)}.` : `No events from ${modelDay(from, n, timeZone)} to ${modelDay(to - 1, n, timeZone)}.`, items, ...answer };
          // Local words, the date with each start (W1: UTC ISO times made a 9:00 event read as 15:00).
          const line = (e: (typeof events)[number]) => {
            if (e.allDay) {
              const days = allDayDates(e, timeZone);
              const day = (d: string) => modelDay(parseDateTime(`${d}T12:00`, timeZone), n, timeZone);
              return `- ${day(days.first)}${days.last !== days.first ? ` to ${day(days.last)}` : ""}, all day: ${e.title}`;
            }
            const end = ymd(e.end) === ymd(e.start) ? modelClock(e.end, timeZone) : modelWhen(e.end, n, timeZone);
            return `- ${modelWhen(e.start, n, timeZone)} to ${end}: ${e.title}`;
          };
          return { ok: true, modelText: events.map(line).join("\n"), items, ...answer };
        } catch (err) {
          if (err instanceof TimeError) return { ok: false, modelText: err.message };
          throw err;
        }
      },
    },
    {
      def: def("calendar_add"),
      async execute(args, ctx) {
        try {
          const start = at(args.start);
          const end = at(args.end);
          if (end <= start) return { ok: false, modelText: "The end must be after the start." };
          const title = String(args.title ?? "").slice(0, 120);
          await calendar.add({ title, start, end });
          const s = opts.words && speaker(opts.words, ctx.userText);
          return {
            ok: true,
            modelText: `Added to the calendar: ${title}, ${modelWhen(start, now(), timeZone)} to ${modelWhen(end, now(), timeZone)}.`,
            ...(s ? { answer: s.t("done.calendarAdd", { title: quotable(title, 120), when: spokenSpan(start, end, now(), timeZone, s.language) }) } : {}),
          };
        } catch (err) {
          if (err instanceof TimeError) return { ok: false, modelText: err.message };
          throw err;
        }
      },
    },
  ];
}

/** Control characters and line breaks become spaces: text other people wrote stays on its own line. */
function oneLine(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/[\u0000-\u001f\u007f\u0085\u2028\u2029]+/g, " ");
}

const HIDDEN_CODE_NOTE = "[one-time code hidden: Hermit never reads these codes]";

/**
 * read_messages and reply_message (FR-MSG-01 to FR-MSG-04). `opts` gives the phone's zone for the times the model reads
 * (W1: they were UTC, "20:43:29" for a 14:43 message) and, with `words`, the answers code writes.
 */
export function messageSkills(store: MessageStore, sender: ReplySenderPort, opts?: FirstWinOptions): SkillRuntime[] {
  const timeZone = opts?.timeZone ?? "UTC";
  const now = opts?.now ?? Date.now;
  return [
    {
      def: def("read_messages"),
      async execute(args, ctx) {
        const from = typeof args.contact === "string" && args.contact.trim() ? args.contact : undefined;
        const msgs = (await store.recent({ from, limit: 20 })).reverse();
        const s = opts?.words && speaker(opts.words, ctx.userText);
        const n = now();
        const answer = s
          ? { answer: messagesAnswer(s, msgs.map((m) => ({ conversationId: m.conversationId, conversation: m.conversation, sender: m.sender, text: m.text, at: m.at, ...(m.app !== "whatsapp" ? { business: true } : {}), ...(m.hidden ? { hidden: true } : {}) })), from, n, timeZone) }
          : {};
        const items = msgs.map((m) => ({
          at: m.at, who: m.sender, text: m.hidden ? HIDDEN_CODE_NOTE : m.text, chat: m.conversationId,
          ...(m.conversation !== m.sender ? { conversation: m.conversation } : {}), ...(m.app !== "whatsapp" ? { business: true as const } : {}),
        }));
        if (!msgs.length) return { ok: true, modelText: from ? `No recent messages from ${from}.` : "No recent messages.", items, ...answer };
        // The conversation id is what reply_message takes; the model never names a recipient itself.
        return {
          ok: true,
          modelText: msgs
            // The id leads its line, and every field other people control (sender, chat title, text) is flattened
            // to one line, so none of them can start a line: the harness reads ids only at line starts.
            // WhatsApp Business is named (US-MSG-06); plain WhatsApp stays implicit to keep lines short.
            // A hidden one-time code arrives as a marker the model can explain, never as the code (US-MSG-07).
            // The time is local words, oldest message first (W1).
            .map((m) => `conversationId: ${m.conversationId} | ${modelWhen(m.at, n, timeZone)} | ${m.app === "whatsapp" ? "" : `${APP_LABEL[m.app]} | `}${oneLine(m.sender)}${m.conversation !== m.sender ? ` in ${oneLine(m.conversation)}` : ""}: ${m.hidden ? HIDDEN_CODE_NOTE : oneLine(m.text)}`)
            .join("\n"),
          items,
          ...answer,
        };
      },
    },
    {
      def: def("reply_message"),
      async execute(args, { approvedBinding, userText }) {
        const id = String(args.conversationId ?? "");
        const text = String(args.text ?? "");
        // A send runs only against the recipient the person approved, re-resolved now (CT-06).
        const who = (await store.renderContext()).conversation(id);
        if (!who) return { ok: false, modelText: "That conversation doesn't exist. Read messages first." };
        if (!approvedBinding || approvedBinding !== replyBinding(id, who)) {
          return { ok: false, modelText: "The chat changed since it was approved, so nothing was sent. Ask the user to approve again." };
        }
        const handle = await store.replyHandle(id);
        if (!handle) return { ok: false, modelText: "stale: the notification for that chat is gone, so nothing was sent." };
        const result = await sender.send(handle, text);
        if (result === "stale") {
          await store.dropReplyHandle(id);
          return { ok: false, modelText: "stale: the notification for that chat is gone, so nothing was sent." };
        }
        // The chat's name as WhatsApp shows it (what the sheet showed), and the exact text sent.
        const s = opts?.words && speaker(opts.words, userText);
        return { ok: true, modelText: "Sent.", ...(s ? { answer: s.t("done.reply", { name: quotable(who.name, 60), text: quotable(text, 300) }) } : {}) };
      },
    },
  ];
}
