import { describe, expect, test } from "vitest";
import { nodeSql } from "../src/index.ts";

describe("nodeSql", () => {
  test("exec and query round trip with params", async () => {
    const db = nodeSql();
    await db.exec("CREATE TABLE t (id INTEGER PRIMARY KEY, name TEXT)");
    await db.exec("INSERT INTO t (name) VALUES (?)", ["Ana"]);
    expect(await db.query<{ name: string }>("SELECT name FROM t WHERE id = ?", [1])).toEqual([{ name: "Ana" }]);
  });

  test("query returns plain objects", async () => {
    const db = nodeSql();
    const [row] = await db.query<object>("SELECT 1 AS one");
    expect(Object.getPrototypeOf(row)).toBe(Object.prototype);
  });

  test("transaction rolls back on error", async () => {
    const db = nodeSql();
    await db.exec("CREATE TABLE t (v INTEGER)");
    await expect(db.transaction(async (tx) => {
      await tx.exec("INSERT INTO t VALUES (1)");
      throw new Error("boom");
    })).rejects.toThrow("boom");
    expect(await db.query("SELECT * FROM t")).toEqual([]);
  });

  test("fts5 matches without accents", async () => {
    const db = nodeSql();
    await db.exec("CREATE VIRTUAL TABLE f USING fts5(body, tokenize='unicode61 remove_diacritics 2')");
    await db.exec("INSERT INTO f VALUES (?), (?)", ["Mi pasaporte vence en marzo", "llamar a mamá"]);
    expect(await db.query("SELECT body FROM f WHERE f MATCH ?", ["pasaporte"])).toHaveLength(1);
    expect(await db.query("SELECT body FROM f WHERE f MATCH ?", ["mama"])).toHaveLength(1);
  });

  test("concurrent transactions run one after another", async () => {
    const db = nodeSql();
    await db.exec("CREATE TABLE t (v INTEGER)");
    const slow = (v: number) => db.transaction(async (tx) => {
      await tx.exec("INSERT INTO t VALUES (?)", [v]);
      await new Promise((r) => setTimeout(r, 5));
    });
    await Promise.all([slow(1), slow(2)]);
    expect(await db.query("SELECT v FROM t ORDER BY v")).toEqual([{ v: 1 }, { v: 2 }]);
  });
});
