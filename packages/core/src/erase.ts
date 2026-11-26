import type { SqlPort } from "./ports.ts";
import { MIGRATIONS, type Migration } from "./schema.ts";

/**
 * SL-26 (US-SET-03, HM-SET-03): delete everything. A pure, ordered plan of idempotent steps; the phone
 * adapter executes each one, and a journal kept outside the database records the finished ones so an
 * erase interrupted by a kill or a crash resumes on the next launch instead of leaving half a Hermit.
 */

/** Every SecureStore entry Hermit creates. A new secret (vault, wallet) is added here, so the erase covers it. */
export const SECRET_KEYS = {
  /** SQLCipher key of the database (ADR-006). */
  db: "hermit.db.key.v1",
  /** Ed25519 seed that signs the audit log (FR-ACT-01). */
  auditSeed: "hermit.audit.seed.v1",
  /** Biometric-gated approval key (US-APPR-02). */
  approval: "hermit.approval.v1",
  /**
   * SL-38: the wallet record (`WALLET_RECORD_KEY` in wallet.ts): the seed sealed under the wallet key, the address and
   * dates. The wallet key itself has its own Keystore service and its own step (`wallet_key`).
   */
  wallet: "hermit.wallet.v1",
} as const;

/**
 * Android SharedPreferences files a native module writes. A new one is added here, so the erase covers it.
 * - `hermit_autofill`: the indexes the autofill service reads: which kinds the profile has (SL-35), and each vault
 *   login's id hash, name and origins (SL-36). Never a value, a username or a password.
 * - `hermit_autofill_spike`: the autofill service's debug-only diagnostics, the last request (docs/research/autofill-spike.md).
 */
export const NATIVE_PREFERENCES = ["hermit_autofill", "hermit_autofill_spike"] as const;

export type EraseStep =
  /** The WhatsApp listener stops feeding the database. */
  | { id: "stop_capture"; kind: "stop_capture" }
  /**
   * Q69: the night shift stops writing: its background schedule is cancelled, its service stopped, its native
   * settings deleted, and a pass already running is aborted before its next write (and waited for).
   */
  | { id: "night_shift"; kind: "stop_night_shift" }
  /** The model is unloaded, so its files and caches are not in use. */
  | { id: "release_model"; kind: "release_model" }
  /** Reminders already handed to Android's alarm clock would otherwise still fire. */
  | { id: "notifications"; kind: "cancel_notifications" }
  /** QVAC's KV caches encode conversation content in plain files (Q35). */
  | { id: "kv_caches"; kind: "delete_kv_caches" }
  /** Rows first, so the content is gone even if deleting the file is interrupted. */
  | { id: "tables"; kind: "clear_tables"; tables: string[] }
  | { id: "database"; kind: "delete_database" }
  /** Messages the native listener queued while the app was closed (FR-MSG-02). */
  | { id: "capture_queue"; kind: "delete_capture_queue" }
  /** The model file, its partial download and its verification record. */
  | { id: "model_files"; kind: "delete_model_files" }
  /**
   * SL-33: the wrapped vault key (its own SecureStore service) and the Android Keystore key that wrapped it, which
   * SecureStore's delete leaves behind. After the data: the vault rows are already gone with the tables.
   */
  | { id: "vault_key"; kind: "destroy_vault_key" }
  /** SL-37: the Keystore key that signs money and password approvals (non-exportable, so it can only be destroyed). */
  | { id: "approval_key"; kind: "destroy_approval_key" }
  /**
   * SL-38: the wallet worklet is stopped (it drops any open account), then the wrapped wallet key (its own SecureStore
   * service) and the Android Keystore key that wrapped it are destroyed. Without them the sealed seed can never open;
   * the record itself goes with the secrets.
   */
  | { id: "wallet_key"; kind: "destroy_wallet_key" }
  /** Private preferences files native modules keep outside the database (the autofill service's, SL-20 and SL-35). */
  | { id: "native_prefs"; kind: "delete_native_prefs"; names: string[] }
  /**
   * SL-54: every credential the credential store holds (MCP server tokens, connector tokens), deleted on the phone.
   * The server list itself is a setting, cleared with the tables. No revocation here: the erase must work offline.
   */
  | { id: "credentials"; kind: "delete_credentials" }
  | { id: `secret:${string}`; kind: "delete_secret"; key: string };

/**
 * The tables the schema creates, children before parents, ending with the migration record.
 * Virtual (FTS) tables are left out: they index a content table and are emptied by its delete trigger.
 */
export function schemaTables(migrations: readonly Migration[] = MIGRATIONS): string[] {
  const created: string[] = [];
  for (const m of migrations) {
    for (const match of m.sql.matchAll(/CREATE\s+(VIRTUAL\s+)?TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(\w+)/gi)) {
      if (!match[1]) created.push(match[2]!);
    }
  }
  // Later tables may reference earlier ones (messages to conversations), so clear in reverse creation order.
  return [...created.reverse(), "schema_migrations"];
}

/**
 * The order is the safety argument:
 * 1. stop everything that writes (capture, the night shift, the model, scheduled reminders);
 * 2. delete content (caches, rows, the database file, the capture queue, the model file);
 * 3. delete the keys last. The database key outlives the database file: if a resumed erase found the file
 *    without its key, it could neither read nor clear it, and a fresh key would not open it.
 */
export function erasePlan(opts: { migrations?: readonly Migration[]; secrets?: readonly string[] } = {}): EraseStep[] {
  const secrets = opts.secrets ?? Object.values(SECRET_KEYS);
  return [
    { id: "stop_capture", kind: "stop_capture" },
    { id: "night_shift", kind: "stop_night_shift" },
    { id: "release_model", kind: "release_model" },
    { id: "notifications", kind: "cancel_notifications" },
    { id: "kv_caches", kind: "delete_kv_caches" },
    { id: "tables", kind: "clear_tables", tables: schemaTables(opts.migrations) },
    { id: "database", kind: "delete_database" },
    { id: "capture_queue", kind: "delete_capture_queue" },
    { id: "model_files", kind: "delete_model_files" },
    { id: "vault_key", kind: "destroy_vault_key" },
    { id: "approval_key", kind: "destroy_approval_key" },
    { id: "wallet_key", kind: "destroy_wallet_key" },
    { id: "native_prefs", kind: "delete_native_prefs", names: [...NATIVE_PREFERENCES] },
    { id: "credentials", kind: "delete_credentials" },
    ...secrets.map((key) => ({ id: `secret:${key}` as const, kind: "delete_secret" as const, key })),
  ];
}

/** What survives a kill: the steps already finished. Stored outside the database, which the erase deletes. */
export interface EraseJournal {
  version: 1;
  startedAt: number;
  done: string[];
}

export interface EraseJournalPort {
  read(): Promise<EraseJournal | undefined>;
  write(journal: EraseJournal): Promise<void>;
  clear(): Promise<void>;
}

/** Runs one step. Must be idempotent: removing something already gone succeeds. */
export type EraseExecutor = (step: EraseStep) => Promise<void>;

export type EraseResult = { ok: true } | { ok: false; failedStep: string; done: number; total: number };

/**
 * Runs the plan from wherever an earlier run stopped. The journal is written before the first step, so a
 * kill at any point leaves a record the next launch finds; it is cleared only after the last key is gone.
 * A failed step stops the run (later steps may depend on it) and keeps the journal for a retry.
 */
export async function runErase(
  plan: readonly EraseStep[],
  execute: EraseExecutor,
  journal: EraseJournalPort,
  opts: { now: () => number; onProgress?: (done: number, total: number) => void },
): Promise<EraseResult> {
  const found = await journal.read();
  const state: EraseJournal = found?.version === 1 ? { ...found, done: [...found.done] } : { version: 1, startedAt: opts.now(), done: [] };
  if (!found || found.version !== 1) await journal.write(state);
  const total = plan.length;
  const finished = () => plan.filter((s) => state.done.includes(s.id)).length;
  opts.onProgress?.(finished(), total);
  for (const step of plan) {
    if (state.done.includes(step.id)) continue;
    try {
      await execute(step);
    } catch {
      return { ok: false, failedStep: step.id, done: finished(), total };
    }
    state.done.push(step.id);
    await journal.write(state);
    opts.onProgress?.(finished(), total);
  }
  await journal.clear();
  return { ok: true };
}

/** Deletes every row of the given tables that exist, in one transaction. Idempotent. */
export async function clearTables(sql: SqlPort, tables: readonly string[]): Promise<void> {
  const existing = new Set((await sql.query<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table'")).map((r) => r.name));
  const present = tables.filter((t) => existing.has(t));
  if (!present.length) return;
  await sql.transaction(async (tx) => {
    for (const t of present) await tx.exec(`DELETE FROM "${t.replace(/"/g, '""')}"`);
  });
}
