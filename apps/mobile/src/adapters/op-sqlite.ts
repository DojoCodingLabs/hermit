import { open, type DB } from "@op-engineering/op-sqlite";
import { File } from "expo-file-system";
import type { SqlPort } from "@hermit/core";
import { splitStatements } from "../sql-split";

/**
 * SL-10 (spike S2): SqlPort over op-sqlite built with SQLCipher and FTS5 (ADR-006).
 * The key comes from the Keystore-backed store; transactions are queued one at a time, like nodeSql.
 */
const NAME = "hermit.db";
/** The open handle, so the erase can close and delete the very file the runtime uses. */
let live: DB | undefined;

export function encryptedSql(encryptionKey: string): SqlPort {
  const db = open({ name: NAME, encryptionKey });
  live = db;
  let queue: Promise<unknown> = Promise.resolve();
  const port: SqlPort = {
    async exec(sql, params) {
      if (params?.length) await db.execute(sql, params as never[]);
      // executeBatch opens its own transaction, which can't nest inside a migration's; run statements in order instead.
      else for (const statement of splitStatements(sql)) await db.execute(statement);
    },
    async query<T>(sql: string, params?: unknown[]) {
      const r = await db.execute(sql, (params ?? []) as never[]);
      return (r.rows ?? []) as T[];
    },
    transaction<T>(fn: (tx: SqlPort) => Promise<T>) {
      const run = queue.then(async () => {
        await db.execute("BEGIN");
        try {
          const out = await fn(port);
          await db.execute("COMMIT");
          return out;
        } catch (err) {
          await db.execute("ROLLBACK").catch(() => {});
          throw err;
        }
      });
      queue = run.catch(() => {});
      return run;
    },
  };
  return port;
}

/**
 * SL-26: closes and deletes the database file and its journal siblings. Deleting needs no key, so an erase
 * resuming at launch opens the file bare just to remove it. Idempotent; throws if the file survived.
 */
export function deleteDatabase(): void {
  const db = live ?? open({ name: NAME });
  live = undefined;
  const path = db.getDbPath();
  if (new File(`file://${path}`).exists) db.delete();
  else db.close();
  for (const suffix of ["", "-wal", "-shm", "-journal"]) {
    const f = new File(`file://${path}${suffix}`);
    if (f.exists) f.delete();
  }
  if (new File(`file://${path}`).exists) throw new Error("The database file is still there.");
}
