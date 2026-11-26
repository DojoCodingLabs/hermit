import type { SqlPort } from "./ports.ts";

/**
 * CT-03: local events (PRD 2.13). One envelope for every event. Events never leave the phone,
 * and they carry no content: props are numbers, booleans or short codes, never message text.
 */
export const EVENT_NAMES = [
  "EVT-MODEL-01",
  "EVT-MODEL-02",
  "EVT-APPR-01",
  "EVT-APPR-02",
  "EVT-CAGE-01",
  "EVT-MSG-01",
  "EVT-MSG-02",
  "EVT-NIGHT-01",
  "EVT-PRIV-01",
  "EVT-PAY-01",
  "EVT-MOVE-01",
  "EVT-MAIL-01",
  "EVT-CONN-01",
  "EVT-WEB-01",
] as const;

export type EventName = (typeof EVENT_NAMES)[number];
export type EventProp = number | boolean | string;

export interface LocalEvent {
  name: EventName;
  at: number;
  sessionId?: string;
  props: Record<string, EventProp>;
}

/** Codes, hosts and outcomes fit; sentences don't. Keeps content out of the event log. */
export const MAX_EVENT_STRING = 64;
/** A code, a host or an outcome: no spaces, so a sentence can't slip in. */
const CODE = /^[A-Za-z0-9._:/-]+$/;

export class EventError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EventError";
  }
}

export function validateEvent(e: LocalEvent): void {
  if (!(EVENT_NAMES as readonly string[]).includes(e.name)) throw new EventError(`Unknown event ${e.name}.`);
  for (const [k, v] of Object.entries(e.props)) {
    if (typeof v === "string" && (v.length > MAX_EVENT_STRING || !CODE.test(v))) {
      throw new EventError(`Event prop "${k}" looks like content; events carry codes, not text.`);
    }
    if (typeof v !== "string" && typeof v !== "number" && typeof v !== "boolean") throw new EventError(`Event prop "${k}" must be a number, boolean or short code.`);
  }
}

export interface EventLog {
  record(e: Omit<LocalEvent, "at"> & { at?: number }): Promise<void>;
  list(opts?: { name?: EventName; limit?: number }): Promise<LocalEvent[]>;
  clear(): Promise<void>;
}

/** Backed by the `local_events` table from the schema (migration 0008). */
export function createEventLog(sql: SqlPort, now: () => number = Date.now): EventLog {
  return {
    async record(input) {
      const e: LocalEvent = { name: input.name, at: input.at ?? now(), sessionId: input.sessionId, props: input.props };
      validateEvent(e);
      await sql.exec("INSERT INTO local_events (name, at, session_id, props) VALUES (?, ?, ?, ?)", [e.name, e.at, e.sessionId ?? null, JSON.stringify(e.props)]);
    },
    async list(opts = {}) {
      const rows = await sql.query<{ name: EventName; at: number; session_id: string | null; props: string }>(
        `SELECT name, at, session_id, props FROM local_events ${opts.name ? "WHERE name = ?" : ""} ORDER BY at DESC, id DESC LIMIT ?`,
        opts.name ? [opts.name, opts.limit ?? 100] : [opts.limit ?? 100],
      );
      return rows.map((r) => ({ name: r.name, at: r.at, sessionId: r.session_id ?? undefined, props: JSON.parse(r.props) }));
    },
    async clear() {
      await sql.exec("DELETE FROM local_events");
    },
  };
}
