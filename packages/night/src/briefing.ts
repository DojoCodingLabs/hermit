import type { NotifierPort, SqlPort, TaintSource } from "@hermit/core";
import type { PauseReason } from "./conditions.ts";
import { briefingTime, type NightJobId, type NightSettings } from "./settings.ts";

/** One job's night (US-NIGHT-03). `pending` only before it was ever tried. */
export interface JobReport {
  job: NightJobId;
  status: "pending" | "ran" | "paused" | "skipped" | "failed";
  /** Why it paused or was skipped (a guard), or "outside_window" when the window closed first. */
  reason?: PauseReason | "outside_window";
  at?: number;
}

/** A line in a section. Text other people wrote stays theirs: the section's `untrusted` says so. */
export interface BriefingItem {
  at?: number;
  /** Local time as the skill wrote it, when there is no instant (reminders). */
  when?: string;
  who?: string;
  text: string;
}

export interface BriefingSection {
  job: NightJobId;
  /** Calendar titles, messages and email are other people's text (ST-TAINTED): shown as quotes, never acted on. */
  untrusted: boolean;
  /** The quarantined reader's answer (FR-WEB-03), or the count line from code when it had none. */
  summary?: string;
  quotes: string[];
  items: BriefingItem[];
  count: number;
}

export type SuggestionStatus = "pending" | "done" | "declined" | "unavailable" | "failed";

/**
 * FR-NIGHT-02: an action a night job proposed, stored with its exact arguments and their hash, and run only
 * from the briefing through the normal approval sheet. Proposed by code only, never by text the night read.
 */
export interface Suggestion {
  id: string;
  job: NightJobId;
  /** What it is, for the briefing's copy: a reply draft, or any other proposal (the skill's own sheet title). */
  kind: "reply_draft" | "other";
  skill: string;
  args: Record<string, unknown>;
  argsHash: string;
  /** Proposed in a session that had read other people's text: the morning sheet carries the warning. */
  tainted: boolean;
  taintKind?: TaintSource["kind"];
  /** Values for the briefing's line; other people's text (a sender's name, a subject), shown as quotes. */
  vars: Record<string, string>;
  /** What the app needs to find the target again after a restart (a mail header); never sent to the model. */
  snapshot?: unknown;
  status: SuggestionStatus;
  createdAt: number;
}

/** A step the cage refused that no approval could allow (a payment, a password): listed, never queued. */
export interface Refusal {
  job: NightJobId;
  skill: string;
  at: number;
}

/** ENT-Briefing: one morning's briefing. */
export interface Briefing {
  id: string;
  /** The morning it is for, local "YYYY-MM-DD". */
  date: string;
  createdAt: number;
  updatedAt: number;
  jobs: JobReport[];
  sections: BriefingSection[];
  suggestions: Suggestion[];
  refusals: Refusal[];
  /** Why the last run ended early (a guard tripped); absent when every job ran or the window closed. */
  stop?: PauseReason;
  /** The window closed: nothing more runs for this morning. */
  closed: boolean;
  /** When the morning notice was scheduled (US-NIGHT-02); set once, so a resumed night never repeats it. */
  noticeAt?: number;
}

export interface Briefings {
  save(b: Briefing): Promise<void>;
  get(id: string): Promise<Briefing | undefined>;
  forDate(date: string): Promise<Briefing | undefined>;
  latest(): Promise<Briefing | undefined>;
  setSuggestion(briefingId: string, suggestionId: string, status: SuggestionStatus): Promise<Briefing | undefined>;
}

/** The `briefings` table (migration 11). The body is JSON in the encrypted database, like the chat history. */
export function createBriefings(sql: SqlPort): Briefings {
  const one = async (where: string, params: unknown[]) => {
    const [row] = await sql.query<{ body: string }>(`SELECT body FROM briefings ${where} LIMIT 1`, params);
    return row ? (JSON.parse(row.body) as Briefing) : undefined;
  };
  const api: Briefings = {
    async save(b) {
      await sql.exec(
        "INSERT INTO briefings (id, date, created_at, updated_at, body) VALUES (?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET updated_at = excluded.updated_at, body = excluded.body",
        [b.id, b.date, b.createdAt, b.updatedAt, JSON.stringify(b)],
      );
    },
    get: (id) => one("WHERE id = ?", [id]),
    forDate: (date) => one("WHERE date = ?", [date]),
    latest: () => one("ORDER BY date DESC", []),
    async setSuggestion(briefingId, suggestionId, status) {
      const b = await api.get(briefingId);
      if (!b) return undefined;
      const next = { ...b, suggestions: b.suggestions.map((s) => (s.id === suggestionId ? { ...s, status } : s)) };
      await api.save(next);
      return next;
    },
  };
  return api;
}

/**
 * US-NIGHT-02: the notice at the user's chosen time on the briefing's morning, or right away when that time
 * has passed. One per briefing: its id is the date, so a resumed night replaces it instead of adding another.
 */
export async function scheduleBriefingNotice(
  notifier: NotifierPort,
  settings: NightSettings,
  briefing: Briefing,
  opts: { title: string; timeZone: string; now: number },
): Promise<string> {
  const when = briefingTime(briefing.date, settings.briefingAt, opts.timeZone);
  return notifier.schedule({ id: `briefing-${briefing.date}`, at: Math.max(when, opts.now), title: opts.title });
}
