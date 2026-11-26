import { HERMIT_BOT_ID, type ReadKind } from "./bots.ts";
import type { SqlPort } from "./ports.ts";
import { migrate } from "./schema.ts";

export const MAX_FACT_CHARS = 500;
export const PROFILE_MAX_CHARS = 1400;
/** forget refuses queries that would delete more than this; the user should be more specific. */
export const MAX_FORGET = 5;

/**
 * `shared`: a note whose bot_id is null, a fact about the user every bot reads. `kinds` (security review 00:40): what the
 * session that saved it had read, private data or the web; absent when neither.
 */
export interface Note { id: number; fact: string; tainted: boolean; createdAt: number; shared?: true; kinds?: ReadKind[] }

/**
 * Where a fact came from must be stated, never assumed: `tainted`, and `kinds`, what the saving session had read
 * (`SessionState.reads`, `[]` for nothing). Both are required, so a forgotten one fails closed. A note saved again keeps
 * every read it followed.
 */
export interface RememberOptions { tainted: boolean; kinds: readonly ReadKind[]; now?: number }

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
  remember(fact: string, opts: RememberOptions): Promise<{ id: number }>;
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
  /** Untainted notes, newest first, at most `maxChars`, with what they were read from (see BotMemory.snapshot). */
  snapshot(maxChars?: number): Promise<ProfileSnapshot>;
  /** One bot's view: its own notes plus the shared profile (notes whose bot_id is null). */
  forBot(botId: string): BotMemory;
}

/** What one bot sees and may change. Own notes are the bot's; shared notes are read by every bot. */
export interface BotMemory {
  readonly botId: string;
  /** The bot's own note. */
  remember(fact: string, opts: RememberOptions): Promise<{ id: number }>;
  /** Own and shared notes. */
  recall(query: string, limit?: number): Promise<Note[]>;
  recent(limit?: number): Promise<Note[]>;
  /** Own notes; only the primary bot (Hermit) also forgets shared ones. MAX_FORGET holds. */
  forget(query: string): Promise<number>;
  list(opts?: { query?: string; limit?: number; after?: MemoryCursor }): Promise<MemoryPage>;
  get(id: number): Promise<Note | undefined>;
  /** Own notes; only Hermit also deletes shared ones. */
  delete(id: number): Promise<boolean>;
  /** Makes one of the bot's own untainted notes part of the shared profile. False for anything else. */
  share(id: number): Promise<boolean>;
  /**
   * Untainted own and shared notes, newest first, at most `maxChars`, as the prompt's lines, and what the notes in them
   * were read from. The text never comes without its kinds: a session whose prompt holds them has read that too.
   */
  snapshot(maxChars?: number): Promise<ProfileSnapshot>;
}

/** The profile a prompt carries (FR-MEM-06) and the read kinds of the notes in it (security review 00:40). */
export interface ProfileSnapshot { text: string; kinds: ReadKind[] }

/** Words only, each quoted, so user punctuation can never become FTS5 syntax. `prefix` matches as the user types. */
function ftsQuery(text: string, join: "OR" | "AND", prefix = false): string | null {
  const words = text.match(/[\p{L}\p{N}]+/gu) ?? [];
  return words.length ? words.map((w) => `"${w}"${prefix ? "*" : ""}`).join(` ${join} `) : null;
}

type Row = { id: number; fact: string; tainted: number; created_at: number; bot_id?: string | null; kinds?: string };
const COLS = "n.id, n.fact, n.tainted, n.created_at, n.bot_id, n.kinds";

/** Read kinds in one order, each once: the column holds "", "private", "web" or "private,web" (migration 17). */
const READ_KINDS: readonly ReadKind[] = ["private", "web"];
const kindsIn = (list: readonly string[]): ReadKind[] => READ_KINDS.filter((k) => list.includes(k));
const kindsOf = (column: string | undefined): ReadKind[] => kindsIn(column ? column.split(",") : []);

const toNote = (r: Row): Note => {
  const kinds = kindsOf(r.kinds);
  return { id: r.id, fact: r.fact, tainted: r.tainted === 1, createdAt: r.created_at, ...(kinds.length ? { kinds } : {}) };
};
const toBotNote = (r: Row): Note => (r.bot_id == null ? { ...toNote(r), shared: true } : toNote(r));

/** A SQL condition on `n` and its parameters. */
interface Scope { where: string; params: unknown[] }
const ALL: Scope = { where: "1 = 1", params: [] };

export function createMemory(sql: SqlPort): Memory {
  const match = async (query: string, limit: number, join: "OR" | "AND", scope: Scope = ALL) => {
    const q = ftsQuery(query, join);
    if (!q) return [];
    return sql.query<Row>(
      `SELECT ${COLS} FROM notes_fts f JOIN notes n ON n.id = f.rowid
       WHERE notes_fts MATCH ? AND ${scope.where} ORDER BY bm25(notes_fts) LIMIT ?`,
      [q, ...scope.params, limit],
    );
  };

  // The one delete path: forget (the skill) and delete (the memory screens) both end here.
  const remove = (ids: number[], scope: Scope = ALL) =>
    sql.transaction(async (tx) => {
      let n = 0;
      for (const id of ids) {
        const [hit] = await tx.query<{ id: number }>(`SELECT n.id FROM notes n WHERE n.id = ? AND ${scope.where}`, [id, ...scope.params]);
        if (!hit) continue;
        await tx.exec("DELETE FROM notes WHERE id = ?", [id]);
        n++;
      }
      return n;
    });

  const insert = async (fact: string, opts: RememberOptions, botId: string | null) => {
    if (typeof opts?.tainted !== "boolean") throw new MemoryError("no_provenance", "State whether this fact came from untrusted content.");
    if (!Array.isArray(opts.kinds) || opts.kinds.some((k) => !READ_KINDS.includes(k))) {
      throw new MemoryError("no_provenance", "State what the session had read before this fact was saved.");
    }
    const text = fact.trim();
    if (!text) throw new MemoryError("empty", "Nothing to remember.");
    if (text.length > MAX_FACT_CHARS) throw new MemoryError("too_long", `Facts are limited to ${MAX_FACT_CHARS} characters.`);
    const kinds = kindsIn(opts.kinds);
    return sql.transaction(async (tx) => {
      // The same fact twice is one note (a model repeating itself must not fill memory with copies). Saved again after
      // other reads, it keeps every read it followed: provenance only ever widens.
      const [same] = await tx.query<{ id: number; kinds: string }>("SELECT id, kinds FROM notes WHERE fact = ? AND tainted = ? AND bot_id IS ?", [text, opts.tainted ? 1 : 0, botId]);
      if (same) {
        const wider = kindsIn([...kindsOf(same.kinds), ...kinds]).join(",");
        if (wider !== same.kinds) await tx.exec("UPDATE notes SET kinds = ? WHERE id = ?", [wider, same.id]);
        return { id: same.id };
      }
      await tx.exec("INSERT INTO notes (fact, tainted, created_at, bot_id, kinds) VALUES (?, ?, ?, ?, ?)", [text, opts.tainted ? 1 : 0, opts.now ?? Date.now(), botId, kinds.join(",")]);
      const [row] = await tx.query<{ id: number }>("SELECT last_insert_rowid() AS id");
      return { id: row!.id };
    });
  };

  const recentIn = async (limit: number, scope: Scope, conv: (r: Row) => Note) =>
    (await sql.query<Row>(`SELECT ${COLS} FROM notes n WHERE ${scope.where} ORDER BY n.created_at DESC, n.id DESC LIMIT ?`, [...scope.params, limit])).map(conv);

  const listIn = async (opts: { query?: string; limit?: number; after?: MemoryCursor }, scope: Scope, conv: (r: Row) => Note): Promise<MemoryPage> => {
    const limit = Math.max(1, opts.limit ?? MEMORY_PAGE);
    const where: string[] = [scope.where];
    const params: unknown[] = [...scope.params];
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
      `SELECT ${COLS} FROM notes n WHERE ${where.join(" AND ")} ORDER BY n.created_at DESC, n.id DESC LIMIT ?`,
      [...params, limit + 1],
    );
    const notes = rows.slice(0, limit).map(conv);
    const last = notes.at(-1);
    return rows.length > limit && last ? { notes, next: { createdAt: last.createdAt, id: last.id } } : { notes };
  };

  const getIn = async (id: number, scope: Scope, conv: (r: Row) => Note) => {
    const [row] = await sql.query<Row>(`SELECT ${COLS} FROM notes n WHERE n.id = ? AND ${scope.where}`, [id, ...scope.params]);
    return row ? conv(row) : undefined;
  };

  // Tainted facts never enter it: they're only reachable through recall, which taints the session. The kinds are those
  // of the notes that fit, the ones a prompt will hold.
  const snapshotIn = async (maxChars: number, scope: Scope): Promise<ProfileSnapshot> => {
    const rows = await sql.query<Row>(`SELECT ${COLS} FROM notes n WHERE n.tainted = 0 AND ${scope.where} ORDER BY n.created_at DESC, n.id DESC`, scope.params);
    const lines: string[] = [];
    const kinds: ReadKind[] = [];
    let size = 0;
    for (const r of rows) {
      const line = `- ${r.fact}`;
      const next = size + line.length + (lines.length ? 1 : 0);
      if (next > maxChars) break;
      lines.push(line);
      kinds.push(...kindsOf(r.kinds));
      size = next;
    }
    return { text: lines.join("\n"), kinds: kindsIn(kinds) };
  };

  // Deleting is stricter than finding: every word must match, so a vague query can't wipe the store.
  const forgetIn = async (query: string, find: Scope, write: Scope) => {
    const hits = await match(query, MAX_FORGET + 1, "AND", find);
    if (hits.length > MAX_FORGET) throw new MemoryError("too_broad", "That matches too many notes. Ask which one to forget.");
    return remove(hits.map((h) => h.id), write);
  };

  const forBot = (botId: string): BotMemory => {
    const read: Scope = { where: "(n.bot_id = ? OR n.bot_id IS NULL)", params: [botId] };
    const own: Scope = { where: "n.bot_id = ?", params: [botId] };
    // Only the primary bot may erase what every bot reads, so a bot that read a hostile page can't.
    const write = botId === HERMIT_BOT_ID ? read : own;
    return {
      botId,
      remember: (fact, opts) => insert(fact, opts, botId),
      recall: async (query, limit = 5) => (await match(query, limit, "OR", read)).map(toBotNote),
      recent: (limit = 5) => recentIn(limit, read, toBotNote),
      forget: (query) => forgetIn(query, write, write),
      list: (opts = {}) => listIn(opts, read, toBotNote),
      get: (id) => getIn(id, read, toBotNote),
      delete: async (id) => (await remove([id], write)) === 1,
      share: (id) =>
        sql.transaction(async (tx) => {
          const [hit] = await tx.query<{ id: number }>("SELECT id FROM notes WHERE id = ? AND bot_id = ? AND tainted = 0", [id, botId]);
          if (!hit) return false;
          await tx.exec("UPDATE notes SET bot_id = NULL WHERE id = ?", [id]);
          return true;
        }),
      snapshot: (maxChars = PROFILE_MAX_CHARS) => snapshotIn(maxChars, read),
    };
  };

  return {
    // One schema path: every database, old or new, gets the whole schema (notes.bot_id included).
    async migrate() {
      await migrate(sql);
    },

    forBot,

    // A fact the global store saves follows the migration's rule: untainted is the user's, tainted stays Hermit's own.
    remember: (fact, opts) => insert(fact, opts, opts?.tainted === false ? null : HERMIT_BOT_ID),

    async recall(query, limit = 5) {
      return (await match(query, limit, "OR")).map(toNote);
    },

    recent: (limit = 5) => recentIn(limit, ALL, toNote),

    forget: (query) => forgetIn(query, ALL, ALL),

    list: (opts = {}) => listIn(opts, ALL, toNote),

    get: (id) => getIn(id, ALL, toNote),

    async delete(id) {
      return (await remove([id])) === 1;
    },

    snapshot: (maxChars = PROFILE_MAX_CHARS) => snapshotIn(maxChars, ALL),
  };
}
