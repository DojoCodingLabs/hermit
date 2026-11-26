import type { SqlPort } from "@hermit/core";

/**
 * Q69: never two night runs at once. The headless task (woken by WorkManager), the in-app fallback timer and
 * the debug "run now" can all reach the same database, sometimes from two connections in one process. The
 * lock is one row in `settings`, taken with a single atomic upsert, so it holds across connections.
 *
 * It expires: a run killed by the system mid-night must not block every later wake. The holder renews it
 * after each job, so a long night keeps it.
 */
export const NIGHT_LOCK_TTL_MS = 45 * 60_000;
const KEY = "night.lock";

export interface NightLock {
  /** Takes the lock, or renews it when `owner` already holds it. False when someone else holds a live one. */
  acquire(owner: string, now: number): Promise<boolean>;
  /** Frees it, only if `owner` holds it. */
  release(owner: string): Promise<void>;
}

export function createNightLock(sql: SqlPort, ttlMs = NIGHT_LOCK_TTL_MS): NightLock {
  return {
    async acquire(owner, now) {
      // The update applies only when the row is unreadable, expired or already ours; one statement, so atomic.
      await sql.exec(
        `INSERT INTO settings (key, value) VALUES (?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value
         WHERE CASE WHEN json_valid(settings.value)
           THEN json_extract(settings.value, '$.owner') = ? OR coalesce(json_extract(settings.value, '$.until'), 0) <= ?
           ELSE 1 END`,
        [KEY, JSON.stringify({ owner, until: now + ttlMs }), owner, now],
      );
      const [row] = await sql.query<{ value: string }>("SELECT value FROM settings WHERE key = ?", [KEY]);
      try {
        return (JSON.parse(row?.value ?? "null") as { owner?: string } | null)?.owner === owner;
      } catch {
        return false;
      }
    },
    async release(owner) {
      await sql.exec("DELETE FROM settings WHERE key = ? AND json_valid(value) AND json_extract(value, '$.owner') = ?", [KEY, owner]);
    },
  };
}
