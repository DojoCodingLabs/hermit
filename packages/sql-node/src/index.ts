import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import type { SqlPort } from "@hermit/core";

/** SqlPort over Node's built-in SQLite (FTS5 included). For tests and the eval; the phone uses op-sqlite. */
export function nodeSql(path = ":memory:"): SqlPort & { close(): void } {
  const db = new DatabaseSync(path);
  const params = (p?: unknown[]) => (p ?? []) as SQLInputValue[];
  // One transaction at a time: SQLite can't nest them, so later callers wait their turn.
  let queue: Promise<unknown> = Promise.resolve();

  const port: SqlPort & { close(): void } = {
    async exec(sql, p) {
      if (p && p.length) db.prepare(sql).run(...params(p));
      else db.exec(sql);
    },
    async query<T>(sql: string, p?: unknown[]) {
      return db.prepare(sql).all(...params(p)).map((row) => ({ ...row }) as T);
    },
    transaction<T>(fn: (tx: SqlPort) => Promise<T>) {
      const run = queue.then(async () => {
        db.exec("BEGIN");
        try {
          const out = await fn(port);
          db.exec("COMMIT");
          return out;
        } catch (err) {
          try {
            db.exec("ROLLBACK");
          } catch {
            // keep the original error
          }
          throw err;
        }
      });
      queue = run.catch(() => {});
      return run;
    },
    close: () => db.close(),
  };
  return port;
}
