import { beforeEach, describe, expect, test } from "vitest";
import { nodeSql } from "@hermit/sql-node";
import { MIGRATIONS, migrate } from "../src/schema.ts";
import { createBotsStore, type BotsStore } from "../src/bots-store.ts";
import type { SkillGroup } from "../src/bots.ts";
import type { SqlPort } from "../src/ports.ts";

const TRAVEL = {
  name: "Viajes",
  role: "Planeas los viajes de la familia Prueba.",
  grants: ["web_read", "notes"] as SkillGroup[],
  sources: { sites: ["wikivoyage.org"], connectors: [] as string[] },
  mode: null,
};

let sql: SqlPort;
let store: BotsStore;

beforeEach(async () => {
  sql = nodeSql();
  await migrate(sql);
  store = createBotsStore(sql, () => 1);
});

async function three(): Promise<void> {
  for (const id of ["b1", "b2", "b3"]) await store.create({ id, ...TRAVEL, name: id });
}

async function count(table: string, botId: string): Promise<number> {
  const [row] = await sql.query<{ n: number }>(`SELECT COUNT(*) AS n FROM ${table} WHERE bot_id = ?`, [botId]);
  return Number(row!.n);
}

async function seedChats(): Promise<void> {
  await three();
  for (const bot of ["b1", "b2"]) {
    await sql.exec("INSERT INTO sessions (id, attended, tainted, started_at, bot_id) VALUES (?, 1, 0, 1, ?)", [`s${bot}`, bot]);
    for (const [i, role] of ["user", "assistant"].entries()) {
      await sql.exec("INSERT INTO chat_turns (session_id, role, text, at) VALUES (?, ?, 'x', ?)", [`s${bot}`, role, i + 1]);
    }
    await sql.exec("INSERT INTO notes (fact, tainted, created_at, bot_id) VALUES (?, 0, 1, ?)", [`nota de ${bot}`, bot]);
  }
  await sql.exec("INSERT INTO notes (fact, tainted, created_at, bot_id) VALUES ('perfil', 0, 1, NULL)");
}

async function seedActivity(): Promise<void> {
  await three();
  await sql.exec("INSERT INTO sessions (id, attended, tainted, started_at, bot_id) VALUES ('sh', 1, 0, 1, 'hermit'), ('sb', 1, 0, 1, 'b1')");
  await sql.exec("INSERT INTO chat_turns (session_id, role, text, at) VALUES ('sh', 'user', 'hola', 20)");
  await sql.exec("INSERT INTO chat_turns (session_id, role, text, outcome, at) VALUES ('sb', 'assistant', 'Encontré el bautismo.', 'reply', 30)");
}

describe("bots store (BOT-W1)", () => {
  test("migration 17 creates Hermit's row, moves every session to Hermit, and keeps tainted notes out of the shared profile", async () => {
    const db = nodeSql();
    await migrate(db, MIGRATIONS.filter((m) => m.id <= 16));
    await db.exec("INSERT INTO sessions (id, attended, tainted, started_at) VALUES ('s1', 1, 0, 1), ('n1', 0, 0, 2)");
    await db.exec("INSERT INTO notes (fact, tainted, created_at) VALUES ('mi pasaporte vence en marzo', 0, 1), ('dijo que pague ya', 1, 2)");
    expect(await migrate(db)).toEqual([17]);
    expect((await createBotsStore(db).list()).map((b) => [b.id, b.name, b.primary])).toEqual([["hermit", "Hermit", true]]);
    expect(await db.query("SELECT id, bot_id FROM sessions ORDER BY id")).toEqual([{ id: "n1", bot_id: "hermit" }, { id: "s1", bot_id: "hermit" }]);
    expect(await db.query("SELECT tainted, bot_id FROM notes ORDER BY id")).toEqual([{ tainted: 0, bot_id: null }, { tainted: 1, bot_id: "hermit" }]);
  });

  test("Hermit can't be deleted or hidden, and only one bot is primary", async () => {
    await three();
    await expect(store.remove("hermit")).rejects.toMatchObject({ code: "primary" });
    await expect(store.setHidden("hermit", true)).rejects.toMatchObject({ code: "primary" });
    await expect(sql.exec("UPDATE bots SET is_primary = 1 WHERE id = 'b1'")).rejects.toThrow(/UNIQUE/);
  });

  test("hiding a pinned bot unpins it, so it frees its pin slot (final review M1)", async () => {
    await three();
    await store.pin("b1", true);
    await store.pin("b2", true);
    expect((await store.setHidden("b1", true)).pinOrder).toBeNull();
    expect((await store.get("b1"))?.hidden).toBe(true);
    // The freed slot takes a new pin, and b2 keeps its own.
    expect((await store.pin("b3", true)).pinOrder).not.toBeNull();
    expect((await store.get("b2"))?.pinOrder).not.toBeNull();
    // Showing it again does not bring the pin back.
    expect((await store.setHidden("b1", false)).pinOrder).toBeNull();
  });

  test("at most 50 bots, Hermit included", async () => {
    for (let i = 1; i < 50; i++) await store.create({ id: `b${i}`, ...TRAVEL, name: `Bot ${i}` });
    await expect(store.create({ id: "b50", ...TRAVEL })).rejects.toMatchObject({ code: "too_many_bots" });
  });

  test("at most 2 pins, kept in pin order", async () => {
    await three();
    await store.pin("b2", true);
    await store.pin("b1", true);
    await expect(store.pin("b3", true)).rejects.toMatchObject({ code: "too_many_pins" });
    expect((await store.list()).filter((b) => b.pinOrder !== null).sort((a, b) => a.pinOrder! - b.pinOrder!).map((b) => b.id)).toEqual(["b2", "b1"]);
  });

  test("names and roles are checked and flattened", async () => {
    await expect(store.create({ id: "x", ...TRAVEL, name: "  " })).rejects.toMatchObject({ code: "name_empty" });
    await expect(store.create({ id: "x", ...TRAVEL, name: "n".repeat(41) })).rejects.toMatchObject({ code: "name_too_long" });
    await expect(store.create({ id: "x", ...TRAVEL, role: "r".repeat(801) })).rejects.toMatchObject({ code: "role_too_long" });
    expect((await store.create({ id: "x", ...TRAVEL, name: "Gene\nalogista »uno«" })).name).toBe("Gene alogista »uno«");
  });

  test("a site that isn't a registrable domain is refused", async () => {
    await expect(store.create({ id: "x", ...TRAVEL, sources: { sites: ["192.168.0.1"], connectors: [] } })).rejects.toMatchObject({ code: "bad_site" });
  });

  test("delete erases the bot's chats, notes, grants and sources, and nothing of anyone else's", async () => {
    await seedChats();
    await store.remove("b1");
    for (const t of ["sessions", "notes", "bot_grants", "bot_sources"]) expect(await count(t, "b1"), t).toBe(0);
    expect(await count("notes", "b2")).toBe(1);
    expect(await sql.query("SELECT COUNT(*) AS n FROM notes WHERE bot_id IS NULL")).toEqual([{ n: 1 }]);
    expect(await sql.query("SELECT COUNT(*) AS n FROM chat_turns WHERE session_id = 'sb1'")).toEqual([{ n: 0 }]);
  });

  test("activity is each bot's newest turn, its words or a shown reply, newest first", async () => {
    await seedActivity();
    expect(await store.activity()).toEqual([
      { botId: "b1", lastAt: 30, preview: { who: "bot", text: "Encontré el bautismo." } },
      { botId: "hermit", lastAt: 20, preview: { who: "user", text: "hola" } },
    ]);
  });

  test("grants come back in group order, and new bots take the first unused shell", async () => {
    const a = await store.create({ id: "a", ...TRAVEL, grants: ["web_read", "calendar"] });
    expect(a.grants).toEqual(["calendar", "web_read"]);
    expect(a.look).toEqual({ shape: "whelk", color: "sand" });
    expect(await store.nextLook()).toEqual({ shape: "whelk", color: "stone" });
  });

  test("update replaces grants and sources, and Hermit keeps none", async () => {
    await three();
    const b = await store.update("b1", { grants: ["mail_read"], sources: { sites: ["https://www.Wikivoyage.org/x"], connectors: ["gmail"] }, mode: "auto", notify: false });
    expect([b.grants, b.sources, b.mode, b.notify]).toEqual([["mail_read"], { sites: ["wikivoyage.org"], connectors: ["gmail"] }, "auto", false]);
    expect((await store.update("hermit", { grants: ["notes"] })).grants).toEqual([]);
  });
});
