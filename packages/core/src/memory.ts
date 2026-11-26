import type { SqlPort } from "./ports.ts";

export const MAX_FACT_CHARS = 500;
export const PROFILE_MAX_CHARS = 1400;
/** forget refuses queries that would delete more than this; the user should be more specific. */
export const MAX_FORGET = 5;

export interface Note { id: number; fact: string; tainted: boolean; createdAt: number }

export class MemoryError extends Error {
  constructor(readonly code: "too_long" | "empty" | "no_provenance" | "too_broad", message: string) {
    super(message);
  }
}

/** Where HM-MEM-01 left off: the last note shown, newest-first order (createdAt, then id). */
export interface MemoryCursor { createdAt: number; id: number }

export interface MemoryPage { notes: Note[]; next?: MemoryCursor }

export const MEMORY_PAGE = 30;

export interface Memory {
  migrate(): Promise<void>;
  /** `tainted` is required: where a fact came from must be stated, never assumed trusted. */
  remember(fact: string, opts: { tainted: boolean; now?: number }): Promise<{ id: number }>;
  recall(query: string, limit?: number): Promise<Note[]>;
  /** The newest notes, for when a search finds nothing (the fact may be saved in the other language). */
  recent(limit?: number): Promise<Note[]>;
  forget(query: string): Promise<number>;
  /** HM-MEM-01: newest first; `query` keeps notes containing every word as a prefix ("pas" finds "passport"). */
  list(opts?: { query?: string; limit?: number; after?: MemoryCursor }): Promise<MemoryPage>;
  /** HM-MEM-02: one note, or undefined once it is gone. */
  get(id: number): Promise<Note | undefined>;
  /** Deleting one note from HM-MEM-01/02: the same delete `forget` runs, for one id. False if it was already gone. */
  delete(id: number): Promise<boolean>;
  profileSnapshot(maxChars?: number): Promise<string>;
}

/** Words only, each quoted, so user punctuation can never become FTS5 syntax. `prefix` matches as the user types. */
function ftsQuery(text: string, join: "OR" | "AND", prefix = false): string | null {
  const words = text.match(/[\p{L}\p{N}]+/gu) ?? [];
  return words.length ? words.map((w) => `"${w}"${prefix ? "*" : ""}`).join(` ${join} `) : null;
}

type Row = { id: number; fact: string; tainted: number; created_at: number };
const toNote = (r: Row): Note => ({ id: r.id, fact: r.fact, tainted: r.tainted === 1, createdAt: r.created_at });

export function createMemory(sql: SqlPort): Memory {
  const match = async (query: string, limit: number, join: "OR" | "AND") => {
    const q = ftsQuery(query, join);
    if (!q) return [];
    return sql.query<Row>(
      `SELECT n.id, n.fact, n.tainted, n.created_at FROM notes_fts f JOIN notes n ON n.id = f.rowid
       WHERE notes_fts MATCH ? ORDER BY bm25(notes_fts) LIMIT ?`,
      [q, limit],
    );
  };

  // The one delete path: forget (the skill) and delete (the memory screens) both end here.
  const remove = (ids: number[]) =>
    sql.transaction(async (tx) => {
      let n = 0;
      for (const id of ids) {
        const [hit] = await tx.query<{ id: number }>("SELECT id FROM notes WHERE id = ?", [id]);
        if (!hit) continue;
        await tx.exec("DELETE FROM notes WHERE id = ?", [id]);
        n++;
      }
      return n;
    });

  return {
    async migrate() {
      await sql.exec(`
        CREATE TABLE IF NOT EXISTS notes (
          id INTEGER PRIMARY KEY, fact TEXT NOT NULL, tainted INTEGER NOT NULL, created_at INTEGER NOT NULL);
        CREATE VIRTUAL TABLE IF NOT EXISTS notes_fts USING fts5(
          fact, content='notes', content_rowid='id', tokenize='unicode61 remove_diacritics 2');
        CREATE TRIGGER IF NOT EXISTS notes_ai AFTER INSERT ON notes BEGIN
          INSERT INTO notes_fts(rowid, fact) VALUES (new.id, new.fact); END;
        CREATE TRIGGER IF NOT EXISTS notes_ad AFTER DELETE ON notes BEGIN
          INSERT INTO notes_fts(notes_fts, rowid, fact) VALUES ('delete', old.id, old.fact); END;`);
    },

    async remember(fact, opts) {
      if (typeof opts?.tainted !== "boolean") throw new MemoryError("no_provenance", "State whether this fact came from untrusted content.");
      const text = fact.trim();
      if (!text) throw new MemoryError("empty", "Nothing to remember.");
      if (text.length > MAX_FACT_CHARS) throw new MemoryError("too_long", `Facts are limited to ${MAX_FACT_CHARS} characters.`);
      return sql.transaction(async (tx) => {
        // The same fact twice is one note (a model repeating itself must not fill memory with copies).
        const [same] = await tx.query<{ id: number }>("SELECT id FROM notes WHERE fact = ? AND tainted = ?", [text, opts.tainted ? 1 : 0]);
        if (same) return { id: same.id };
        await tx.exec("INSERT INTO notes (fact, tainted, created_at) VALUES (?, ?, ?)", [text, opts.tainted ? 1 : 0, opts.now ?? Date.now()]);
        const [row] = await tx.query<{ id: number }>("SELECT last_insert_rowid() AS id");
        return { id: row!.id };
      });
    },

    async recall(query, limit = 5) {
      return (await match(query, limit, "OR")).map(toNote);
    },

    async recent(limit = 5) {
      const rows = await sql.query<Row>("SELECT id, fact, tainted, created_at FROM notes ORDER BY created_at DESC, id DESC LIMIT ?", [limit]);
      return rows.map(toNote);
    },

    async forget(query) {
      // Deleting is stricter than finding: every word must match, so a vague query can't wipe the store.
      const hits = await match(query, MAX_FORGET + 1, "AND");
      if (hits.length > MAX_FORGET) throw new MemoryError("too_broad", "That matches too many notes. Ask which one to forget.");
      return remove(hits.map((h) => h.id));
    },

    async list(opts = {}) {
      const limit = Math.max(1, opts.limit ?? MEMORY_PAGE);
      const where: string[] = [];
      const params: unknown[] = [];
      const q = opts.query ? ftsQuery(opts.query, "AND", true) : null;
      if (q) {
        where.push("n.id IN (SELECT rowid FROM notes_fts WHERE notes_fts MATCH ?)");
        params.push(q);
      }
      if (opts.after) {
        where.push("(n.created_at < ? OR (n.created_at = ? AND n.id < ?))");
        params.push(opts.after.createdAt, opts.after.createdAt, opts.after.id);
      }
      // One extra row tells whether another page exists.
      const rows = await sql.query<Row>(
        `SELECT n.id, n.fact, n.tainted, n.created_at FROM notes n ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
         ORDER BY n.created_at DESC, n.id DESC LIMIT ?`,
        [...params, limit + 1],
      );
      const notes = rows.slice(0, limit).map(toNote);
      const last = notes.at(-1);
      return rows.length > limit && last ? { notes, next: { createdAt: last.createdAt, id: last.id } } : { notes };
    },

    async get(id) {
      const [row] = await sql.query<Row>("SELECT id, fact, tainted, created_at FROM notes WHERE id = ?", [id]);
      return row ? toNote(row) : undefined;
    },

    async delete(id) {
      return (await remove([id])) === 1;
    },

    // Built once per session and kept frozen, so the model's cached prompt prefix stays valid.
    // Tainted facts never enter it: they're only reachable through recall, which taints the session.
    async profileSnapshot(maxChars = PROFILE_MAX_CHARS) {
      const rows = await sql.query<Row>("SELECT id, fact, tainted, created_at FROM notes WHERE tainted = 0 ORDER BY created_at DESC, id DESC");
      const lines: string[] = [];
      let size = 0;
      for (const r of rows) {
        const line = `- ${r.fact}`;
        const next = size + line.length + (lines.length ? 1 : 0);
        if (next > maxChars) break;
        lines.push(line);
        size = next;
      }
      return lines.join("\n");
    },
  };
}
