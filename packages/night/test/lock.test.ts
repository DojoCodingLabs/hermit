import { describe, expect, test } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { migrate } from "@hermit/core";
import { nodeSql } from "@hermit/sql-node";
import { createNightLock, NIGHT_LOCK_TTL_MS } from "../src/index.ts";

const T = 1_000_000;

describe("the night run lock (Q69: never two runs at once)", () => {
  test("one owner at a time; the holder renews; release frees it", async () => {
    const sql = nodeSql();
    await migrate(sql);
    const lock = createNightLock(sql);
    expect(await lock.acquire("worker", T)).toBe(true);
    expect(await lock.acquire("app", T + 1)).toBe(false);
    // The holder takes it again (a renew), which pushes the expiry out.
    expect(await lock.acquire("worker", T + NIGHT_LOCK_TTL_MS - 1)).toBe(true);
    expect(await lock.acquire("app", T + NIGHT_LOCK_TTL_MS + 1)).toBe(false);
    await lock.release("app"); // someone else's release changes nothing
    expect(await lock.acquire("app", T + 2)).toBe(false);
    await lock.release("worker");
    expect(await lock.acquire("app", T + 3)).toBe(true);
  });

  test("a run killed mid-night doesn't hold the lock forever: it expires", async () => {
    const sql = nodeSql();
    await migrate(sql);
    const lock = createNightLock(sql);
    expect(await lock.acquire("killed", T)).toBe(true);
    expect(await lock.acquire("next", T + NIGHT_LOCK_TTL_MS - 1)).toBe(false);
    expect(await lock.acquire("next", T + NIGHT_LOCK_TTL_MS)).toBe(true);
  });

  test("a damaged value never blocks the night shift for good", async () => {
    const sql = nodeSql();
    await migrate(sql);
    await sql.exec("INSERT INTO settings (key, value) VALUES ('night.lock', '{broken')");
    expect(await createNightLock(sql).acquire("a", T)).toBe(true);
  });

  test("two connections to one database file (the headless task and the app): exactly one wins", async () => {
    const dir = mkdtempSync(join(tmpdir(), "hermit-lock-"));
    try {
      const a = nodeSql(join(dir, "db.sqlite"));
      await migrate(a);
      const b = nodeSql(join(dir, "db.sqlite"));
      const results = await Promise.all([createNightLock(a).acquire("headless", T), createNightLock(b).acquire("app", T)]);
      expect(results.filter(Boolean)).toHaveLength(1);
      const [row] = await b.query<{ value: string }>("SELECT value FROM settings WHERE key = 'night.lock'");
      expect(JSON.parse(row!.value).owner).toBe(results[0] ? "headless" : "app");
      a.close();
      b.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
