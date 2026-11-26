import { describe, expect, test } from "vitest";
import { nodeSql } from "@hermit/sql-node";
import { MIGRATIONS, migrate, type Migration } from "../src/schema.ts";
import { clearTables, erasePlan, runErase, schemaTables, SECRET_KEYS, type EraseJournal, type EraseJournalPort, type EraseStep } from "../src/erase.ts";

/** A phone in miniature: what the erase must remove, and a journal that survives a kill. */
function fakePhone() {
  const state = {
    capturing: true,
    nightScheduled: true,
    modelLoaded: true,
    scheduledReminders: 2,
    kvCaches: new Set(["auto-1", "hermit-v1-qwen"]),
    database: true,
    captureQueue: true,
    modelFiles: new Set(["model.gguf", "model.gguf.sha256", "model.gguf.part"]),
    secrets: new Map<string, string>(Object.values(SECRET_KEYS).map((k) => [k, "secret"])),
    walletKey: true,
    clearedTables: [] as string[],
    ran: [] as string[],
  };
  let journal: EraseJournal | undefined;
  const journalPort: EraseJournalPort = {
    async read() {
      return journal && structuredClone(journal);
    },
    async write(j) {
      journal = structuredClone(j);
    },
    async clear() {
      journal = undefined;
    },
  };
  let failAt: string | undefined;
  // Every step is idempotent: removing what is already gone succeeds.
  const execute = async (step: EraseStep) => {
    if (step.id === failAt) {
      failAt = undefined;
      throw new Error(`killed during ${step.id}`);
    }
    state.ran.push(step.id);
    switch (step.kind) {
      case "stop_capture":
        state.capturing = false;
        break;
      case "stop_night_shift":
        state.nightScheduled = false;
        break;
      case "release_model":
        state.modelLoaded = false;
        break;
      case "cancel_notifications":
        state.scheduledReminders = 0;
        break;
      case "delete_kv_caches":
        state.kvCaches.clear();
        break;
      case "clear_tables":
        if (state.database) state.clearedTables.push(...step.tables);
        break;
      case "delete_database":
        state.database = false;
        break;
      case "delete_capture_queue":
        state.captureQueue = false;
        break;
      case "delete_model_files":
        state.modelFiles.clear();
        break;
      case "destroy_wallet_key":
        state.walletKey = false;
        break;
      case "delete_secret":
        // The database key must outlive the database file, or a resumed erase strands an encrypted file.
        if (step.key === SECRET_KEYS.db && state.database) throw new Error("db key deleted before the database");
        state.secrets.delete(step.key);
        break;
    }
  };
  return {
    state,
    journalPort,
    execute,
    failNextAt(id: string) {
      failAt = id;
    },
    journal: () => journal,
  };
}

const ids = (plan: EraseStep[]): string[] => plan.map((s) => s.id);

describe("erase plan (US-SET-03, HM-SET-03)", () => {
  test("covers every table the schema creates, plus the migration record", () => {
    const tables = schemaTables();
    for (const t of ["notes", "audit", "reminders", "conversations", "messages", "sessions", "chat_turns", "approvals", "settings", "model_installs", "local_events", "schema_migrations"]) {
      expect(tables).toContain(t);
    }
    // FTS is an index over notes: emptied by notes' delete trigger, never cleared directly.
    expect(tables).not.toContain("notes_fts");
    const clear = erasePlan().find((s) => s.kind === "clear_tables");
    expect(clear).toMatchObject({ tables });
  });

  test("a table added by a later migration is erased without touching the plan", () => {
    const later: Migration[] = [...MIGRATIONS, { id: 99, name: "vault", slice: "SL-99", sql: "CREATE TABLE IF NOT EXISTS vault_items (id TEXT PRIMARY KEY)" }];
    expect(schemaTables(later)).toContain("vault_items");
  });

  test("children are cleared before their parents", () => {
    const tables = schemaTables();
    expect(tables.indexOf("messages")).toBeLessThan(tables.indexOf("conversations"));
    expect(tables.indexOf("chat_turns")).toBeLessThan(tables.indexOf("sessions"));
  });

  test("deletes the database, every key, the KV caches, captured messages, scheduled reminders and the model file", () => {
    const plan = erasePlan();
    const kinds = plan.map((s) => s.kind);
    for (const k of ["stop_capture", "stop_night_shift", "release_model", "cancel_notifications", "delete_kv_caches", "clear_tables", "delete_database", "delete_capture_queue", "delete_model_files"] as const) {
      expect(kinds).toContain(k);
    }
    const secrets = plan.flatMap((s) => (s.kind === "delete_secret" ? [s.key] : []));
    expect(secrets.sort()).toEqual(Object.values(SECRET_KEYS).sort());
  });

  test("order: stop writers, then data, then the database file, and the keys last", () => {
    const order = ids(erasePlan());
    const at = (id: string) => order.indexOf(id);
    expect(at("stop_capture")).toBeLessThan(at("tables"));
    // Q69: the night shift (its schedule, its service and a pass in flight) stops before anything is deleted,
    // and before the model it may be using is released.
    expect(at("night_shift")).toBeLessThan(at("release_model"));
    expect(at("night_shift")).toBeLessThan(at("tables"));
    expect(at("notifications")).toBeLessThan(at("tables"));
    expect(at("release_model")).toBeLessThan(at("kv_caches"));
    expect(at("release_model")).toBeLessThan(at("model_files"));
    expect(at("tables")).toBeLessThan(at("database"));
    expect(at("database")).toBeLessThan(at(`secret:${SECRET_KEYS.db}`));
    const lastData = Math.max(at("database"), at("capture_queue"), at("model_files"), at("kv_caches"));
    for (const key of Object.values(SECRET_KEYS)) expect(at(`secret:${key}`)).toBeGreaterThan(lastData);
  });

  test("SL-54: every token in the credential store (MCP servers and connectors) goes, after the data and before the keys", () => {
    const plan = erasePlan();
    expect(plan.find((s) => s.id === "credentials")).toEqual({ id: "credentials", kind: "delete_credentials" });
    const order = ids(plan);
    expect(order.indexOf("credentials")).toBeGreaterThan(order.indexOf("database"));
    for (const key of Object.values(SECRET_KEYS)) expect(order.indexOf("credentials")).toBeLessThan(order.indexOf(`secret:${key}`));
  });

  test("SL-37: the Keystore approval key is destroyed after the data, before the secrets", () => {
    const order = ids(erasePlan());
    const at = (id: string) => order.indexOf(id);
    expect(erasePlan().find((s) => s.id === "approval_key")).toEqual({ id: "approval_key", kind: "destroy_approval_key" });
    expect(at("approval_key")).toBeGreaterThan(at("database"));
    for (const key of Object.values(SECRET_KEYS)) expect(at("approval_key")).toBeLessThan(at(`secret:${key}`));
  });

  test("SL-38: the wallet key (and its Keystore key) is destroyed after the data, and the sealed seed's record with the secrets", () => {
    const plan = erasePlan();
    const order = ids(plan);
    const at = (id: string) => order.indexOf(id);
    expect(plan.find((s) => s.id === "wallet_key")).toEqual({ id: "wallet_key", kind: "destroy_wallet_key" });
    expect(at("wallet_key")).toBeGreaterThan(at("database"));
    for (const key of Object.values(SECRET_KEYS)) expect(at("wallet_key")).toBeLessThan(at(`secret:${key}`));
    // The record holds the sealed seed: it is a secret the plan deletes, by the key the app writes it under.
    expect(plan.filter((s) => s.kind === "delete_secret").map((s) => (s as { key: string }).key)).toContain("hermit.wallet.v1");
  });

  test("step ids are unique, so the journal can name them", () => {
    const order = ids(erasePlan());
    expect(new Set(order).size).toBe(order.length);
  });
});

describe("runErase (resumable, idempotent)", () => {
  test("a full run leaves nothing behind and clears its journal", async () => {
    const phone = fakePhone();
    const progress: Array<[number, number]> = [];
    const result = await runErase(erasePlan(), phone.execute, phone.journalPort, { now: () => 1, onProgress: (done, total) => progress.push([done, total]) });
    expect(result).toEqual({ ok: true });
    expect(phone.state).toMatchObject({ capturing: false, nightScheduled: false, modelLoaded: false, scheduledReminders: 0, database: false, captureQueue: false, walletKey: false });
    expect(phone.state.kvCaches.size).toBe(0);
    expect(phone.state.modelFiles.size).toBe(0);
    expect(phone.state.secrets.size).toBe(0);
    expect(phone.journal()).toBeUndefined();
    const total = erasePlan().length;
    expect(progress.at(-1)).toEqual([total, total]);
  });

  test("the journal exists before the first step runs", async () => {
    const phone = fakePhone();
    let seen: EraseJournal | undefined;
    await runErase(erasePlan(), async (step) => {
      if (step.id === "stop_capture") seen = await phone.journalPort.read();
      await phone.execute(step);
    }, phone.journalPort, { now: () => 42 });
    expect(seen).toEqual({ version: 1, startedAt: 42, done: [] });
  });

  test("interrupted mid-way: the journal keeps what finished, and the next run resumes from there", async () => {
    const phone = fakePhone();
    phone.failNextAt("database");
    const first = await runErase(erasePlan(), phone.execute, phone.journalPort, { now: () => 1 });
    expect(first).toEqual({ ok: false, failedStep: "database", done: 6, total: erasePlan().length });
    expect(phone.journal()?.done).toEqual(["stop_capture", "night_shift", "release_model", "notifications", "kv_caches", "tables"]);
    expect(phone.state.database).toBe(true);
    expect(phone.state.secrets.size).toBe(Object.keys(SECRET_KEYS).length);

    phone.state.ran.length = 0;
    const resumed: Array<[number, number]> = [];
    const second = await runErase(erasePlan(), phone.execute, phone.journalPort, { now: () => 2, onProgress: (d, t) => resumed.push([d, t]) });
    expect(second).toEqual({ ok: true });
    // Finished steps are not run again; the resumed run starts its count where the first stopped.
    expect(phone.state.ran[0]).toBe("database");
    expect(phone.state.ran).not.toContain("stop_capture");
    expect(resumed[0]).toEqual([6, erasePlan().length]);
    expect(phone.state.secrets.size).toBe(0);
    expect(phone.journal()).toBeUndefined();
  });

  test("a kill between deleting a key and recording it is safe: the step runs again and succeeds", async () => {
    const phone = fakePhone();
    const plan = erasePlan();
    const lastKey = plan.at(-1)!;
    // Simulate: the key was deleted, then the app died before the journal recorded it.
    await phone.journalPort.write({ version: 1, startedAt: 1, done: ids(plan).slice(0, -1) });
    phone.state.database = false;
    phone.state.secrets.clear();
    expect(await runErase(plan, phone.execute, phone.journalPort, { now: () => 2 })).toEqual({ ok: true });
    expect(phone.state.ran).toEqual([lastKey.id]);
  });

  test("running again after everything is gone is a no-op that succeeds", async () => {
    const phone = fakePhone();
    await runErase(erasePlan(), phone.execute, phone.journalPort, { now: () => 1 });
    expect(await runErase(erasePlan(), phone.execute, phone.journalPort, { now: () => 2 })).toEqual({ ok: true });
  });

  test("a journal from an unknown version is not trusted: the run starts over", async () => {
    const phone = fakePhone();
    await phone.journalPort.write({ version: 7, startedAt: 1, done: ids(erasePlan()) } as unknown as EraseJournal);
    expect(await runErase(erasePlan(), phone.execute, phone.journalPort, { now: () => 2 })).toEqual({ ok: true });
    expect(phone.state.ran).toEqual(ids(erasePlan()));
  });
});

describe("clearTables (on a real SQLite)", () => {
  test("empties every table, the notes index included", async () => {
    const sql = nodeSql();
    await migrate(sql);
    const now = 1_700_000_000_000;
    await sql.exec("INSERT INTO notes (fact, tainted, created_at) VALUES ('passport expires in March', 0, ?)", [now]);
    await sql.exec("INSERT INTO audit (seq, ts, session_id, event, prev_hash, hash, sig) VALUES (1, ?, 's', 'e', 'p', 'h', 'sig')", [now]);
    await sql.exec("INSERT INTO reminders (text, at, created_at) VALUES ('call mom', ?, ?)", [now, now]);
    await sql.exec("INSERT INTO conversations (id, app, title, key, last_at) VALUES ('c1', 'whatsapp', 'Ana', 'k', ?)", [now]);
    await sql.exec("INSERT INTO messages (conversation_id, sender, text, at, notification_key) VALUES ('c1', 'Ana', 'hola', ?, 'n1')", [now]);
    await sql.exec("INSERT INTO sessions (id, attended, started_at) VALUES ('s1', 1, ?)", [now]);
    await sql.exec("INSERT INTO chat_turns (session_id, role, text, at) VALUES ('s1', 'user', 'hola', ?)", [now]);
    await sql.exec("INSERT INTO approvals (request_id, session_id, skill, args_hash, at) VALUES ('r', 's1', 'reply', 'h', ?)", [now]);
    await sql.exec("INSERT INTO settings (key, value) VALUES ('onboarding.done', '1')");
    await sql.exec("INSERT INTO model_installs (model_id, sha256, path, size) VALUES ('m', 'x', '/p', 1)");
    await sql.exec("INSERT INTO local_events (name, at, props) VALUES ('turn', ?, '{}')", [now]);

    await clearTables(sql, schemaTables());

    for (const t of schemaTables()) {
      const [row] = await sql.query<{ n: number }>(`SELECT count(*) AS n FROM ${t}`);
      expect(row!.n, t).toBe(0);
    }
    expect(await sql.query("SELECT rowid FROM notes_fts WHERE notes_fts MATCH 'passport'")).toEqual([]);
  });

  test("is idempotent and tolerates tables that were never created", async () => {
    const sql = nodeSql();
    await expect(clearTables(sql, schemaTables())).resolves.toBeUndefined();
    await migrate(sql);
    await clearTables(sql, schemaTables());
    await expect(clearTables(sql, schemaTables())).resolves.toBeUndefined();
  });
  test("the erase list covers the bot tables", () => expect(schemaTables()).toEqual(expect.arrayContaining(["bots", "bot_grants", "bot_sources"])));
});
