import type { SqlPort } from "./ports.ts";

/**
 * The on-device schema (PRD 2.9), as numbered, forward-only migrations.
 * Each W1 slice owns one pre-assigned slot (Part 3.6), so parallel agents never edit the same migration.
 * Statements use IF NOT EXISTS so databases created by the earlier per-module `migrate()` calls upgrade cleanly.
 */
export interface Migration {
  id: number;
  name: string;
  /** The slice that owns this migration slot. */
  slice: string;
  sql: string;
}

export const MIGRATIONS: readonly Migration[] = [
  {
    id: 1,
    name: "notes",
    slice: "SL-04",
    sql: `
      CREATE TABLE IF NOT EXISTS notes (
        id INTEGER PRIMARY KEY, fact TEXT NOT NULL, tainted INTEGER NOT NULL, created_at INTEGER NOT NULL);
      CREATE VIRTUAL TABLE IF NOT EXISTS notes_fts USING fts5(
        fact, content='notes', content_rowid='id', tokenize='unicode61 remove_diacritics 2');
      CREATE TRIGGER IF NOT EXISTS notes_ai AFTER INSERT ON notes BEGIN
        INSERT INTO notes_fts(rowid, fact) VALUES (new.id, new.fact); END;
      CREATE TRIGGER IF NOT EXISTS notes_ad AFTER DELETE ON notes BEGIN
        INSERT INTO notes_fts(notes_fts, rowid, fact) VALUES ('delete', old.id, old.fact); END;`,
  },
  {
    id: 2,
    name: "audit",
    slice: "SL-08",
    sql: `
      CREATE TABLE IF NOT EXISTS audit (
        seq INTEGER PRIMARY KEY, ts INTEGER NOT NULL, session_id TEXT NOT NULL, event TEXT NOT NULL,
        skill TEXT, args_hash TEXT, decision TEXT, outcome TEXT,
        prev_hash TEXT NOT NULL, hash TEXT NOT NULL, sig TEXT NOT NULL);
      CREATE TRIGGER IF NOT EXISTS audit_no_update BEFORE UPDATE ON audit BEGIN
        SELECT RAISE(ABORT, 'audit is append-only'); END;`,
  },
  {
    id: 3,
    name: "reminders",
    slice: "SL-05",
    sql: `
      CREATE TABLE IF NOT EXISTS reminders (
        id INTEGER PRIMARY KEY, text TEXT NOT NULL, at INTEGER NOT NULL,
        state TEXT NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','fired','done','cancelled')),
        notification_id TEXT, created_at INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS reminders_pending ON reminders (state, at);`,
  },
  {
    id: 4,
    name: "messages",
    slice: "SL-06",
    sql: `
      CREATE TABLE IF NOT EXISTS conversations (
        id TEXT PRIMARY KEY, app TEXT NOT NULL CHECK (app IN ('whatsapp','whatsapp_business')),
        title TEXT NOT NULL, key TEXT NOT NULL, reply_handle TEXT, last_at INTEGER NOT NULL,
        UNIQUE (app, key));
      CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY, conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
        sender TEXT NOT NULL, text TEXT NOT NULL, at INTEGER NOT NULL, notification_key TEXT NOT NULL,
        UNIQUE (notification_key, at));
      CREATE INDEX IF NOT EXISTS messages_by_conversation ON messages (conversation_id, at);`,
  },
  {
    id: 5,
    name: "sessions_and_turns",
    slice: "SL-02",
    sql: `
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY, attended INTEGER NOT NULL, tainted INTEGER NOT NULL DEFAULT 0, started_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS chat_turns (
        id INTEGER PRIMARY KEY, session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
        role TEXT NOT NULL CHECK (role IN ('user','assistant','tool','system')),
        text TEXT NOT NULL, untrusted INTEGER NOT NULL DEFAULT 0, outcome TEXT, at INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS chat_turns_by_session ON chat_turns (session_id, at);`,
  },
  {
    id: 6,
    name: "approvals",
    slice: "SL-07",
    sql: `
      CREATE TABLE IF NOT EXISTS approvals (
        request_id TEXT PRIMARY KEY, session_id TEXT NOT NULL, skill TEXT NOT NULL, args_hash TEXT NOT NULL,
        state TEXT NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','approved','denied','expired')),
        at INTEGER NOT NULL);`,
  },
  {
    id: 7,
    name: "settings_and_model",
    slice: "SL-01",
    sql: `
      CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS model_installs (
        model_id TEXT PRIMARY KEY, sha256 TEXT NOT NULL, path TEXT NOT NULL, size INTEGER NOT NULL, verified_at INTEGER);`,
  },
  {
    id: 8,
    name: "local_events",
    slice: "W0",
    sql: `
      CREATE TABLE IF NOT EXISTS local_events (
        id INTEGER PRIMARY KEY, name TEXT NOT NULL, at INTEGER NOT NULL, session_id TEXT, props TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS local_events_by_name ON local_events (name, at);`,
  },
  {
    id: 9,
    name: "host_counters",
    slice: "SL-25",
    sql: `
      CREATE TABLE IF NOT EXISTS host_counters (host TEXT PRIMARY KEY, count INTEGER NOT NULL, last_at INTEGER NOT NULL);`,
  },
  {
    id: 10,
    name: "audit_cleared_count",
    slice: "SL-32",
    sql: `
      ALTER TABLE audit ADD COLUMN cleared_count INTEGER;`,
  },
  {
    // ENT-Briefing (FR-NIGHT-02): one briefing per morning; the body holds the sections, the suggestions with
    // their arguments and hash, and the overnight log. The audit reason is the night job's code (US-NIGHT-03).
    id: 11,
    name: "briefings",
    slice: "SL-24",
    sql: `
      CREATE TABLE IF NOT EXISTS briefings (
        id TEXT PRIMARY KEY, date TEXT NOT NULL UNIQUE, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, body TEXT NOT NULL);
      ALTER TABLE audit ADD COLUMN reason TEXT;`,
  },
  {
    // ENT-VaultItem (FR-VAULT-01): names and exact origins readable, username, secret and notes sealed with the vault
    // key (AES-256-GCM, bound to the id). vault_meta holds the key check that proves an unwrapped key is this vault's.
    id: 12,
    name: "vault",
    slice: "SL-33",
    sql: `
      CREATE TABLE IF NOT EXISTS vault_items (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, origins TEXT NOT NULL, sealed TEXT NOT NULL,
        created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS vault_meta (
        id INTEGER PRIMARY KEY CHECK (id = 1), version INTEGER NOT NULL, key_check TEXT NOT NULL, created_at INTEGER NOT NULL);`,
  },
  {
    // SL-37 (FR-CAGE-06): every nonce a Keystore-signed approval used, so a signature is accepted once. Rows past their
    // expiry are pruned (an expired approval is refused by its expiry anyway). The audit keeps the signed payload's
    // hash and the signature on the approval entry.
    id: 13,
    name: "approval_nonces",
    slice: "SL-37",
    sql: `
      CREATE TABLE IF NOT EXISTS approval_nonces (nonce TEXT PRIMARY KEY, expires_at INTEGER NOT NULL, used_at INTEGER NOT NULL);
      ALTER TABLE audit ADD COLUMN payload_hash TEXT;
      ALTER TABLE audit ADD COLUMN approval_sig TEXT;`,
  },
  {
    // ENT-ProfileField (US-FORM-03): the personal profile that fills forms, one row per kind, inside the vault's
    // encrypted database. A sensitive field holds only its value sealed with the vault key (AES-256-GCM, bound to the
    // kind); any other field holds its value. The checks keep a sensitive field from ever holding a plain value.
    id: 14,
    name: "profile",
    slice: "SL-35",
    sql: `
      CREATE TABLE IF NOT EXISTS profile_fields (
        kind TEXT PRIMARY KEY CHECK (kind IN ('given_name','family_name','email','phone','street_address','address_line2','city',
          'region','postal_code','country','birth_date','id_number','tax_id','passport_number')),
        sensitive INTEGER NOT NULL CHECK (sensitive IN (0, 1)),
        value TEXT, sealed TEXT, updated_at INTEGER NOT NULL,
        CHECK ((sensitive = 0 AND value IS NOT NULL AND sealed IS NULL) OR (sensitive = 1 AND value IS NULL AND sealed IS NOT NULL)),
        CHECK (sensitive = 1 OR kind NOT IN ('id_number','tax_id','passport_number')));`,
  },
  {
    // SL-40 (US-PAY-05, US-PAY-06, FR-PAY-03, FR-PAY-05): ENT-SpendingCap (per payment and rolling per day, USD₮ base
    // units as decimal text, one row per asset and network), ENT-Contact (payees the user saved on HM-PAY-05, one per
    // address and network) and the spend ledger: every transfer authorization reserved before its approval sheet, so
    // pending ones count against the caps until they settle or are proven void. A row's money never changes; only a
    // pending row's status (and its transaction hash) may.
    id: 15,
    name: "payments",
    slice: "SL-40",
    sql: `
      CREATE TABLE IF NOT EXISTS spending_caps (
        asset TEXT NOT NULL, network TEXT NOT NULL, per_payment TEXT NOT NULL, per_day TEXT NOT NULL, updated_at INTEGER NOT NULL,
        PRIMARY KEY (asset, network));
      CREATE TABLE IF NOT EXISTS contacts (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, address TEXT NOT NULL, network TEXT NOT NULL, created_at INTEGER NOT NULL,
        UNIQUE (address COLLATE NOCASE, network));
      CREATE TABLE IF NOT EXISTS spend_ledger (
        nonce TEXT PRIMARY KEY, amount TEXT NOT NULL, asset TEXT NOT NULL, network TEXT NOT NULL, payer TEXT NOT NULL,
        token TEXT NOT NULL, recipient TEXT NOT NULL, valid_before INTEGER NOT NULL, at_ms INTEGER NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('pending', 'settled', 'void')), tx_hash TEXT);
      CREATE INDEX IF NOT EXISTS spend_ledger_window ON spend_ledger (asset, network, at_ms);
      CREATE TRIGGER IF NOT EXISTS spend_ledger_moves_forward BEFORE UPDATE ON spend_ledger
        WHEN OLD.status <> 'pending' OR NEW.nonce IS NOT OLD.nonce OR NEW.amount IS NOT OLD.amount OR NEW.asset IS NOT OLD.asset
          OR NEW.network IS NOT OLD.network OR NEW.payer IS NOT OLD.payer OR NEW.token IS NOT OLD.token
          OR NEW.recipient IS NOT OLD.recipient OR NEW.valid_before IS NOT OLD.valid_before OR NEW.at_ms IS NOT OLD.at_ms
        BEGIN SELECT RAISE(ABORT, 'spend_ledger rows only move from pending'); END;`,
  },
  {
    // SL-41 (US-PAY-07, FR-PAY-04): what an x402 purchase bought. One row per authorization reserved for a merchant,
    // keyed by its spend_ledger nonce: the requirement hash (the address the user asked for and the offer's scheme,
    // network, token, payee and amount) so a second authorization for the same thing is refused while one is pending,
    // and the merchant's origin. Its status is the ledger row's; a row here never changes.
    id: 16,
    name: "merchant_purchases",
    slice: "SL-41",
    sql: `
      CREATE TABLE IF NOT EXISTS merchant_purchases (
        nonce TEXT PRIMARY KEY, requirement_hash TEXT NOT NULL CHECK (length(requirement_hash) = 64),
        origin TEXT NOT NULL CHECK (origin LIKE 'https://%'), created_at INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS merchant_purchases_requirement ON merchant_purchases (requirement_hash);
      CREATE TRIGGER IF NOT EXISTS merchant_purchases_fixed BEFORE UPDATE ON merchant_purchases
        BEGIN SELECT RAISE(ABORT, 'merchant_purchases rows never change'); END;`,
  },
];

/** Applies every migration not yet recorded, each in its own transaction. Returns the ids it applied. */
export async function migrate(sql: SqlPort, migrations: readonly Migration[] = MIGRATIONS): Promise<number[]> {
  const ids = migrations.map((m) => m.id);
  if (new Set(ids).size !== ids.length || ids.some((id, i) => i > 0 && id <= ids[i - 1]!)) {
    throw new Error("Migration ids must be unique and increasing.");
  }
  await sql.exec("CREATE TABLE IF NOT EXISTS schema_migrations (id INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at INTEGER NOT NULL)");
  const done = new Set((await sql.query<{ id: number }>("SELECT id FROM schema_migrations")).map((r) => r.id));
  const applied: number[] = [];
  for (const m of migrations) {
    if (done.has(m.id)) continue;
    await sql.transaction(async (tx) => {
      await tx.exec(m.sql);
      await tx.exec("INSERT INTO schema_migrations (id, name, applied_at) VALUES (?, ?, ?)", [m.id, m.name, Date.now()]);
    });
    applied.push(m.id);
  }
  return applied;
}
