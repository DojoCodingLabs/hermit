import type { SqlPort } from "./ports.ts";
import type { Msg, SessionState, TaintSource } from "./types.ts";

/**
 * ENT-Session and ENT-ChatTurn: the conversation with Hermit, kept in the encrypted database (US-CHAT-07).
 * Taint is sticky for the life of a session (FR-CAGE-04): once set it is never cleared here.
 */
export interface StoredTurn {
  role: Msg["role"];
  text: string;
  untrusted: boolean;
  /**
   * Set on the assistant message the chat showed as the turn's answer, so a restart can show it again. Q155: "cut" is
   * a reply that stopped at its token cap, "stopped" one the user stopped while it was written; both still say so.
   */
  outcome?: "reply" | "question" | "cut" | "stopped";
  at: number;
}

/**
 * What HM-CHAT-01 showed: the user's words and Hermit's final answers, never tool calls or tool results. `cut` (Q155):
 * the reply stopped short, at its cap or, with `stopped`, because the user stopped it; the chat says so.
 */
export interface TranscriptEntry { kind: "user" | "reply" | "question"; text: string; cut?: true; stopped?: true }

/** Q155: the session's last turn, when it is a reply the chat showed. */
export interface LastReply {
  id: number;
  text: string;
  /** It stopped short: Seguir can write the next part. */
  cut: boolean;
  /** The user stopped it while it was written (a kind of cut). */
  stopped: boolean;
  untrusted: boolean;
}

export interface Sessions {
  start(opts: { id: string; attended: boolean }): Promise<SessionState>;
  load(id: string): Promise<SessionState | undefined>;
  addTurn(sessionId: string, turn: Omit<StoredTurn, "at"> & { at?: number }): Promise<void>;
  markTainted(sessionId: string, source: TaintSource): Promise<SessionState>;
  /** Oldest first, as model messages. Untrusted turns keep their flag. */
  history(sessionId: string, limit?: number): Promise<Msg[]>;
  /** The newest attended session, which the chat resumes after a restart. */
  latest(): Promise<string | undefined>;
  /** Oldest first, the newest `limit` entries (US-CHAT-07). */
  transcript(sessionId: string, limit?: number): Promise<TranscriptEntry[]>;
  /** "Clear conversation": every session and turn goes; notes and the signed log are other tables. */
  clear(): Promise<void>;
  /** Q155: the session's very last turn when it is a reply the chat showed; anything after it means there is none. */
  lastReply(sessionId: string): Promise<LastReply | undefined>;
  /**
   * Q155: Seguir wrote the next part of that reply: its words grow in place, and `outcome` says whether it now ends
   * ("reply"), still stops at its cap ("cut") or was stopped by the user again ("stopped").
   */
  extendReply(sessionId: string, id: number, text: string, outcome: "reply" | "cut" | "stopped"): Promise<void>;
}

interface SessionRow { id: string; attended: number; tainted: number; started_at: number }

/** Taint sources live in memory for the running session; after a restart a tainted session stays tainted. */
const RESTORED: TaintSource = { kind: "inbound_message", ref: "restored", at: 0 };

export function createSessions(sql: SqlPort, now: () => number = Date.now): Sessions {
  const live = new Map<string, SessionState>();
  const api: Sessions = {
    async start({ id, attended }) {
      await sql.exec("INSERT INTO sessions (id, attended, tainted, started_at) VALUES (?, ?, 0, ?)", [id, attended ? 1 : 0, now()]);
      const s: SessionState = { id, taint: [], unattended: !attended };
      live.set(id, s);
      return s;
    },
    async load(id) {
      const cached = live.get(id);
      if (cached) return cached;
      const [row] = await sql.query<SessionRow>("SELECT * FROM sessions WHERE id = ?", [id]);
      if (!row) return undefined;
      const s: SessionState = { id, taint: row.tainted ? [RESTORED] : [], unattended: row.attended === 0 };
      live.set(id, s);
      return s;
    },
    async addTurn(sessionId, t) {
      await sql.exec("INSERT INTO chat_turns (session_id, role, text, untrusted, outcome, at) VALUES (?, ?, ?, ?, ?, ?)", [
        sessionId, t.role, t.text, t.untrusted ? 1 : 0, t.outcome ?? null, t.at ?? now(),
      ]);
    },
    async markTainted(sessionId, source) {
      const s = await api.load(sessionId);
      if (!s) throw new Error(`No session ${sessionId}.`);
      await sql.exec("UPDATE sessions SET tainted = 1 WHERE id = ?", [sessionId]);
      s.taint.push(source);
      return s;
    },
    async history(sessionId, limit = 40) {
      // The window starts at a multiple of half the limit, so it holds between limit/2 and limit messages and
      // its first message changes only every limit/2 messages. A window sliding by one message would change
      // the start of the prompt on every turn and defeat the prompt cache (harness-sota-parity.md).
      const [{ n } = { n: 0 }] = await sql.query<{ n: number }>("SELECT COUNT(*) AS n FROM chat_turns WHERE session_id = ?", [sessionId]);
      const step = Math.max(1, Math.floor(limit / 2));
      const start = Math.ceil(Math.max(0, n - limit) / step) * step;
      const rows = await sql.query<{ role: Msg["role"]; text: string; untrusted: number }>(
        "SELECT role, text, untrusted FROM chat_turns WHERE session_id = ? ORDER BY at, id LIMIT ? OFFSET ?",
        [sessionId, n - start, start],
      );
      return rows.map((r) => (r.untrusted ? { role: r.role, content: r.text, untrusted: true } : { role: r.role, content: r.text }));
    },
    async latest() {
      const [row] = await sql.query<{ id: string }>("SELECT id FROM sessions WHERE attended = 1 ORDER BY started_at DESC, rowid DESC LIMIT 1");
      return row?.id;
    },
    async transcript(sessionId, limit = 60) {
      const rows = await sql.query<{ role: Msg["role"]; text: string; outcome: StoredTurn["outcome"] | null }>(
        `SELECT role, text, outcome FROM chat_turns
         WHERE session_id = ? AND (role = 'user' OR (role = 'assistant' AND outcome IN ('reply', 'question', 'cut', 'stopped')))
         ORDER BY at DESC, id DESC LIMIT ?`,
        [sessionId, limit],
      );
      return rows.reverse().map((r): TranscriptEntry => {
        if (r.role === "user") return { kind: "user", text: r.text };
        if (r.outcome === "question") return { kind: "question", text: r.text };
        if (r.outcome === "cut") return { kind: "reply", text: r.text, cut: true };
        if (r.outcome === "stopped") return { kind: "reply", text: r.text, cut: true, stopped: true };
        return { kind: "reply", text: r.text };
      });
    },
    async lastReply(sessionId) {
      const [row] = await sql.query<{ id: number; role: Msg["role"]; text: string; untrusted: number; outcome: StoredTurn["outcome"] | null }>(
        "SELECT id, role, text, untrusted, outcome FROM chat_turns WHERE session_id = ? ORDER BY at DESC, id DESC LIMIT 1",
        [sessionId],
      );
      if (!row || row.role !== "assistant" || (row.outcome !== "reply" && row.outcome !== "cut" && row.outcome !== "stopped")) return undefined;
      return { id: row.id, text: row.text, cut: row.outcome !== "reply", stopped: row.outcome === "stopped", untrusted: row.untrusted === 1 };
    },
    async extendReply(sessionId, id, text, outcome) {
      // Only an assistant reply of this session; the row keeps its place, so history and transcript read it grown.
      await sql.exec("UPDATE chat_turns SET text = ?, outcome = ? WHERE id = ? AND session_id = ? AND role = 'assistant' AND outcome IN ('reply', 'cut', 'stopped')", [
        text, outcome, id, sessionId,
      ]);
    },
    async clear() {
      await sql.transaction(async (tx) => {
        await tx.exec("DELETE FROM chat_turns");
        await tx.exec("DELETE FROM sessions");
      });
      live.clear();
    },
  };
  return api;
}
