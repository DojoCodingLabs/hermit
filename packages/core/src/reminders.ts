import type { NotifierPort, SqlPort } from "./ports.ts";
import { localParts, modelWhen } from "./local-time.ts";
import { parseDateTime } from "./time.ts";

/** FR-REM-01 and FR-REM-02. */
export type ReminderState = "pending" | "fired" | "done" | "cancelled";

export interface Reminder {
  id: number;
  text: string;
  at: number;
  state: ReminderState;
  createdAt: number;
}

/** Product rule (FR-REM-02): no reminders more than a year ahead. */
export const MAX_REMINDER_AHEAD_MS = 366 * 24 * 60 * 60 * 1000;
export const MAX_REMINDER_TEXT = 200;

const TRANSITIONS: Record<ReminderState, readonly ReminderState[]> = {
  pending: ["fired", "cancelled"],
  fired: ["done"],
  done: [],
  cancelled: [],
};

export class ReminderError extends Error {
  constructor(
    readonly code: "in_past" | "too_far" | "bad_time" | "empty" | "not_found" | "bad_transition",
    message: string,
  ) {
    super(message);
    this.name = "ReminderError";
  }
}

export interface Reminders {
  /** `at` is the model's ISO-8601 text, read in the phone's zone when it has no offset. */
  schedule(text: string, at: string): Promise<Reminder>;
  pending(): Promise<Reminder[]>;
  transition(id: number, to: ReminderState): Promise<Reminder>;
  cancel(id: number): Promise<Reminder>;
}

interface Row { id: number; text: string; at: number; state: ReminderState; created_at: number }
const fromRow = (r: Row): Reminder => ({ id: r.id, text: r.text, at: r.at, state: r.state, createdAt: r.created_at });

export function createReminders(sql: SqlPort, notifier: NotifierPort, opts: { timeZone: string; now?: () => number }): Reminders {
  const now = opts.now ?? Date.now;
  const get = async (id: number) => {
    const [row] = await sql.query<Row>("SELECT * FROM reminders WHERE id = ?", [id]);
    if (!row) throw new ReminderError("not_found", `No reminder ${id}.`);
    return fromRow(row);
  };
  const api: Reminders = {
    async schedule(text, at) {
      const body = text.trim().slice(0, MAX_REMINDER_TEXT);
      if (!body) throw new ReminderError("empty", "A reminder needs something to remind about.");
      let when: number;
      try {
        when = parseDateTime(at, opts.timeZone);
      } catch {
        throw new ReminderError("bad_time", `"${at}" is not a time I understand.`);
      }
      const t = now();
      // Deterministic repair: small models often write a past year (their training year). If only the year
      // is behind, move to the current year, or the next one if that date has passed too.
      if (when <= t) when = withCurrentYear(at, when, t, opts.timeZone);
      if (when <= t) throw new ReminderError("in_past", `That time has already passed. It is now ${modelWhen(t, t, opts.timeZone)}; use a later date and time.`);
      if (when - t > MAX_REMINDER_AHEAD_MS) throw new ReminderError("too_far", "Reminders can be at most a year ahead.");
      // The row and the alarm succeed or fail together: no reminder that never fires.
      return sql.transaction(async (tx) => {
        await tx.exec("INSERT INTO reminders (text, at, state, created_at) VALUES (?, ?, 'pending', ?)", [body, when, t]);
        const [row] = await tx.query<Row>("SELECT * FROM reminders WHERE rowid = last_insert_rowid()");
        const notificationId = await notifier.schedule({ id: String(row!.id), at: when, title: body });
        await tx.exec("UPDATE reminders SET notification_id = ? WHERE id = ?", [notificationId, row!.id]);
        return fromRow(row!);
      });
    },
    async pending() {
      return (await sql.query<Row>("SELECT * FROM reminders WHERE state = 'pending' ORDER BY at")).map(fromRow);
    },
    async transition(id, to) {
      const r = await get(id);
      if (!TRANSITIONS[r.state].includes(to)) throw new ReminderError("bad_transition", `A ${r.state} reminder can't become ${to}.`);
      await sql.exec("UPDATE reminders SET state = ? WHERE id = ?", [to, id]);
      return { ...r, state: to };
    },
    async cancel(id) {
      const [row] = await sql.query<Row & { notification_id: string | null }>("SELECT * FROM reminders WHERE id = ?", [id]);
      const updated = await api.transition(id, "cancelled");
      if (row?.notification_id) await notifier.cancel(row.notification_id);
      return updated;
    },
  };
  return api;
}

/** The same month, day and time in the current year (or the next), when the model's year is in the past. */
function withCurrentYear(at: string, when: number, now: number, timeZone: string): number {
  const m = /^(\d{4})(-\d{2}-\d{2}T[\d:.]+(?:Z|[+-]\d{2}:?\d{2})?)$/.exec(at.trim());
  if (!m) return when;
  const year = localParts(now, timeZone).y;
  if (Number(m[1]) >= year) return when;
  for (const y of [year, year + 1]) {
    try {
      const candidate = parseDateTime(`${y}${m[2]}`, timeZone);
      if (candidate > now) return candidate;
    } catch {
      return when;
    }
  }
  return when;
}
