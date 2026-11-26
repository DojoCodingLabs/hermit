import { describe, expect, test } from "vitest";
import { nodeSql } from "@hermit/sql-node";
import { migrate, MIGRATIONS } from "../src/schema.ts";
import { createMemory } from "../src/memory.ts";

const W1_TABLES = ["notes", "audit", "reminders", "conversations", "messages", "sessions", "chat_turns", "approvals", "settings", "model_installs", "local_events"];

describe("schema (PRD 2.9)", () => {
  test("creates every W1 table", async () => {
    const sql = nodeSql();
    expect(await migrate(sql)).toEqual(MIGRATIONS.map((m) => m.id));
    const tables = (await sql.query<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table'")).map((t) => t.name);
    for (const t of W1_TABLES) expect(tables).toContain(t);
  });

  test("running twice applies nothing new", async () => {
    const sql = nodeSql();
    await migrate(sql);
    expect(await migrate(sql)).toEqual([]);
  });

  test("upgrades a database made by the old per-module migrate", async () => {
    const sql = nodeSql();
    const memory = createMemory(sql);
    await memory.migrate();
    await memory.remember("Passport expires in March", { tainted: false });
    await migrate(sql);
    expect(await memory.recall("passport")).toHaveLength(1);
  });

  test("every slot names its owning slice", () => {
    for (const m of MIGRATIONS) expect(m.slice).toMatch(/^(SL-\d{2}|W0)$/);
  });

  test("the audit table is append-only", async () => {
    const sql = nodeSql();
    await migrate(sql);
    await sql.exec("INSERT INTO audit (seq, ts, session_id, event, prev_hash, hash, sig) VALUES (1, 1, 's', 'e', 'p', 'h', 'g')");
    await expect(sql.exec("UPDATE audit SET event = 'x' WHERE seq = 1")).rejects.toThrow(/append-only/);
  });

  test("states outside the lifecycle are refused", async () => {
    const sql = nodeSql();
    await migrate(sql);
    await expect(sql.exec("INSERT INTO reminders (text, at, state, created_at) VALUES ('x', 1, 'snoozed', 1)")).rejects.toThrow();
  });

  test("a failing migration rolls back and is not recorded", async () => {
    const sql = nodeSql();
    await expect(migrate(sql, [{ id: 1, name: "bad", slice: "W0", sql: "CREATE TABLE ok (x); NOT SQL" }])).rejects.toThrow();
    expect(await sql.query("SELECT * FROM schema_migrations")).toEqual([]);
  });

  test("SL-24: the briefings table (ENT-Briefing) and the night reason on the audit table", async () => {
    const sql = nodeSql();
    await migrate(sql);
    await sql.exec("INSERT INTO briefings (id, date, created_at, updated_at, body) VALUES ('b1', '2026-11-14', 1, 1, '{}')");
    await expect(sql.exec("INSERT INTO briefings (id, date, created_at, updated_at, body) VALUES ('b2', '2026-11-14', 2, 2, '{}')")).rejects.toThrow();
    const cols = (await sql.query<{ name: string }>("PRAGMA table_info(audit)")).map((c) => c.name);
    expect(cols).toContain("reason");
  });

  test("ids must increase", async () => {
    await expect(migrate(nodeSql(), [MIGRATIONS[1]!, MIGRATIONS[0]!])).rejects.toThrow(/increasing/);
  });
});
