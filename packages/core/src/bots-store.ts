import type { SqlPort } from "./ports.ts";
import {
  MAX_BOT_NAME_CHARS, MAX_BOTS, MAX_PINS, MAX_ROLE_CHARS, normalizeSite, SHELL_COLORS, SHELL_SHAPES, SKILL_GROUPS,
  type Bot, type BotLook, type BotSources, type PermissionMode, type SkillGroup,
} from "./bots.ts";
import { quoteSafe } from "./quote.ts";

/** Bots (multi-bot wave 1): the rows behind the chat list. Hermit's row is made by migration 17 and is never removed. */

export type BotErrorCode = "not_found" | "primary" | "too_many_bots" | "too_many_pins" | "name_empty" | "name_too_long" | "role_too_long" | "bad_site";

export class BotError extends Error {
  constructor(readonly code: BotErrorCode, message: string) {
    super(message);
    this.name = "BotError";
  }
}

export interface NewBotRow {
  name: string;
  role: string;
  look?: BotLook;
  grants: SkillGroup[];
  sources: BotSources;
  mode: PermissionMode | null;
}

export interface BotActivity {
  botId: string;
  lastAt: number;
  preview?: { who: "user" | "bot"; text: string };
}

export interface BotsStore {
  list(): Promise<Bot[]>;
  get(id: string): Promise<Bot | undefined>;
  create(input: { id: string } & NewBotRow): Promise<Bot>;
  update(id: string, patch: Partial<NewBotRow> & { notify?: boolean }): Promise<Bot>;
  pin(id: string, pinned: boolean): Promise<Bot>;
  setHidden(id: string, hidden: boolean): Promise<Bot>;
  remove(id: string): Promise<void>;
  activity(): Promise<BotActivity[]>;
  nextLook(): Promise<BotLook>;
}

interface BotRow {
  id: string; name: string; role: string; shape: string | null; color: string | null; is_primary: number;
  pin_order: number | null; hidden: number; notify: number; mode: PermissionMode | null; created_at: number;
}

// eslint-disable-next-line no-control-regex -- flattening control characters is the point.
const NAME_BREAKS = /[\u0000-\u001f\u007f-\u009f\u2028\u2029\u200e\u200f\u202a-\u202e\u2066-\u2069]+/g;
// eslint-disable-next-line no-control-regex -- removing control characters other than line breaks is the point.
const ROLE_CONTROLS = /[\u0000-\u0009\u000b\u000c\u000e-\u001f\u007f-\u009f]/g;

function cleanName(raw: string): string {
  const name = raw.replace(NAME_BREAKS, " ").trim();
  if (name === "") throw new BotError("name_empty", "A bot needs a name.");
  if ([...name].length > MAX_BOT_NAME_CHARS) throw new BotError("name_too_long", `A bot's name is at most ${MAX_BOT_NAME_CHARS} characters.`);
  return name;
}

function cleanRole(raw: string): string {
  const role = raw.replace(ROLE_CONTROLS, "").trim();
  if ([...role].length > MAX_ROLE_CHARS) throw new BotError("role_too_long", `A bot's role is at most ${MAX_ROLE_CHARS} characters.`);
  return role;
}

function cleanSources(sources: BotSources): BotSources {
  const sites = new Set<string>();
  for (const s of sources.sites) {
    const site = normalizeSite(s);
    if (site === undefined) throw new BotError("bad_site", "That isn't a website a bot can be limited to.");
    sites.add(site);
  }
  const connectors = new Set(sources.connectors.map((c) => c.trim()).filter((c) => c !== ""));
  return { sites: [...sites], connectors: [...connectors] };
}

const inOrder = (grants: readonly SkillGroup[]): SkillGroup[] => SKILL_GROUPS.filter((g) => grants.includes(g));

export function createBotsStore(sql: SqlPort, now: () => number = Date.now): BotsStore {
  async function load(q: SqlPort, where = "", params: unknown[] = []): Promise<Bot[]> {
    const rows = await q.query<BotRow>(`SELECT * FROM bots ${where} ORDER BY is_primary DESC, created_at, rowid`, params);
    if (rows.length === 0) return [];
    const grants = await q.query<{ bot_id: string; grp: SkillGroup }>("SELECT bot_id, grp FROM bot_grants");
    const sources = await q.query<{ bot_id: string; kind: "site" | "connector"; value: string }>("SELECT bot_id, kind, value FROM bot_sources ORDER BY rowid");
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      role: r.role,
      primary: r.is_primary === 1,
      ...(r.shape !== null && r.color !== null ? { look: { shape: r.shape, color: r.color } as BotLook } : {}),
      pinOrder: r.pin_order,
      hidden: r.hidden === 1,
      notify: r.notify === 1,
      mode: r.mode,
      grants: inOrder(grants.filter((g) => g.bot_id === r.id).map((g) => g.grp)),
      sources: {
        sites: sources.filter((s) => s.bot_id === r.id && s.kind === "site").map((s) => s.value),
        connectors: sources.filter((s) => s.bot_id === r.id && s.kind === "connector").map((s) => s.value),
      },
      createdAt: r.created_at,
    }));
  }

  async function require(q: SqlPort, id: string): Promise<Bot> {
    const [bot] = await load(q, "WHERE id = ?", [id]);
    if (!bot) throw new BotError("not_found", "That bot doesn't exist.");
    return bot;
  }

  async function writeChildren(q: SqlPort, id: string, grants: SkillGroup[] | undefined, sources: BotSources | undefined): Promise<void> {
    if (grants) {
      await q.exec("DELETE FROM bot_grants WHERE bot_id = ?", [id]);
      for (const g of inOrder(grants)) await q.exec("INSERT INTO bot_grants (bot_id, grp) VALUES (?, ?)", [id, g]);
    }
    if (sources) {
      await q.exec("DELETE FROM bot_sources WHERE bot_id = ?", [id]);
      for (const s of sources.sites) await q.exec("INSERT INTO bot_sources (bot_id, kind, value) VALUES (?, 'site', ?)", [id, s]);
      for (const c of sources.connectors) await q.exec("INSERT INTO bot_sources (bot_id, kind, value) VALUES (?, 'connector', ?)", [id, c]);
    }
  }

  async function nextLook(q: SqlPort): Promise<BotLook> {
    const used = await q.query<{ shape: string; color: string }>("SELECT shape, color FROM bots WHERE shape IS NOT NULL AND color IS NOT NULL");
    for (const shape of SHELL_SHAPES) {
      for (const color of SHELL_COLORS) {
        if (!used.some((u) => u.shape === shape && u.color === color)) return { shape, color };
      }
    }
    return { shape: SHELL_SHAPES[0], color: SHELL_COLORS[0] };
  }

  return {
    list: () => load(sql),

    async get(id) {
      return (await load(sql, "WHERE id = ?", [id]))[0];
    },

    async create(input) {
      const name = cleanName(input.name);
      const role = cleanRole(input.role);
      const sources = cleanSources(input.sources);
      return sql.transaction(async (tx) => {
        const [row] = await tx.query<{ n: number }>("SELECT COUNT(*) AS n FROM bots");
        if (Number(row?.n ?? 0) >= MAX_BOTS) throw new BotError("too_many_bots", `At most ${MAX_BOTS} bots.`);
        const look = input.look ?? (await nextLook(tx));
        await tx.exec(
          "INSERT INTO bots (id, name, role, shape, color, mode, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
          [input.id, name, role, look.shape, look.color, input.mode, now()],
        );
        await writeChildren(tx, input.id, input.grants, sources);
        return require(tx, input.id);
      });
    },

    async update(id, patch) {
      const name = patch.name !== undefined ? cleanName(patch.name) : undefined;
      const role = patch.role !== undefined ? cleanRole(patch.role) : undefined;
      const sources = patch.sources !== undefined ? cleanSources(patch.sources) : undefined;
      return sql.transaction(async (tx) => {
        const bot = await require(tx, id);
        const sets: string[] = [];
        const params: unknown[] = [];
        const set = (col: string, value: unknown) => { sets.push(`${col} = ?`); params.push(value); };
        if (name !== undefined) set("name", name);
        if (role !== undefined) set("role", role);
        if (patch.look !== undefined && !bot.primary) { set("shape", patch.look.shape); set("color", patch.look.color); }
        if ("mode" in patch && patch.mode !== undefined) set("mode", patch.mode);
        if (patch.notify !== undefined) set("notify", patch.notify ? 1 : 0);
        if (sets.length > 0) await tx.exec(`UPDATE bots SET ${sets.join(", ")} WHERE id = ?`, [...params, id]);
        // Hermit's grants are today's global settings, never rows here.
        await writeChildren(tx, id, bot.primary ? undefined : patch.grants, sources);
        return require(tx, id);
      });
    },

    async pin(id, pinned) {
      return sql.transaction(async (tx) => {
        const bot = await require(tx, id);
        if (bot.primary || (bot.pinOrder !== null) === pinned) return bot;
        if (!pinned) {
          await tx.exec("UPDATE bots SET pin_order = NULL WHERE id = ?", [id]);
        } else {
          const [row] = await tx.query<{ n: number; top: number | null }>("SELECT COUNT(*) AS n, MAX(pin_order) AS top FROM bots WHERE pin_order IS NOT NULL");
          if (Number(row?.n ?? 0) >= MAX_PINS) throw new BotError("too_many_pins", `At most ${MAX_PINS} pinned bots.`);
          await tx.exec("UPDATE bots SET pin_order = ? WHERE id = ?", [Number(row?.top ?? 0) + 1, id]);
        }
        return require(tx, id);
      });
    },

    async setHidden(id, hidden) {
      const bot = await require(sql, id);
      if (bot.primary) throw new BotError("primary", "Hermit can't be hidden.");
      // A hidden bot can't be unpinned from the roster, so hiding it frees its pin slot.
      await sql.exec(hidden ? "UPDATE bots SET hidden = 1, pin_order = NULL WHERE id = ?" : "UPDATE bots SET hidden = 0 WHERE id = ?", [id]);
      return require(sql, id);
    },

    async remove(id) {
      await sql.transaction(async (tx) => {
        const bot = await require(tx, id);
        if (bot.primary) throw new BotError("primary", "Hermit can't be deleted.");
        await tx.exec("DELETE FROM chat_turns WHERE session_id IN (SELECT id FROM sessions WHERE bot_id = ?)", [id]);
        await tx.exec("DELETE FROM sessions WHERE bot_id = ?", [id]);
        await tx.exec("DELETE FROM notes WHERE bot_id = ?", [id]);
        await tx.exec("DELETE FROM bot_grants WHERE bot_id = ?", [id]);
        await tx.exec("DELETE FROM bot_sources WHERE bot_id = ?", [id]);
        await tx.exec("DELETE FROM bots WHERE id = ?", [id]);
      });
    },

    async activity() {
      const rows = await sql.query<{ bot_id: string; role: "user" | "assistant"; text: string; at: number }>(
        `SELECT bot_id, role, text, at FROM (
           SELECT s.bot_id AS bot_id, t.role AS role, t.text AS text, t.at AS at,
                  ROW_NUMBER() OVER (PARTITION BY s.bot_id ORDER BY t.at DESC, t.id DESC) AS rn
           FROM chat_turns t JOIN sessions s ON s.id = t.session_id
           WHERE t.role = 'user' OR (t.role = 'assistant' AND t.outcome IN ('reply', 'question', 'cut', 'stopped'))
         ) WHERE rn = 1 ORDER BY at DESC, bot_id`,
      );
      return rows.map((r) => ({
        botId: r.bot_id,
        lastAt: r.at,
        preview: { who: r.role === "user" ? ("user" as const) : ("bot" as const), text: quoteSafe(r.text, 80) },
      }));
    },

    nextLook: () => nextLook(sql),
  };
}
