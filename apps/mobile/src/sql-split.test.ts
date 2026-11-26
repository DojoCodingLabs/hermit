import assert from "node:assert/strict";
import { test } from "node:test";
import { splitStatements } from "./sql-split.ts";

test("splits statements and keeps trigger bodies whole", () => {
  const script = `
    CREATE TABLE notes (id INTEGER PRIMARY KEY, fact TEXT);
    CREATE TRIGGER notes_ai AFTER INSERT ON notes BEGIN
      INSERT INTO notes_fts(rowid, fact) VALUES (new.id, new.fact); END;
    CREATE INDEX i ON notes (fact);`;
  const parts = splitStatements(script);
  assert.equal(parts.length, 3);
  assert.match(parts[1]!, /^CREATE TRIGGER[\s\S]*END;$/);
});

test("ignores empty statements", () => {
  assert.deepEqual(splitStatements(";;  ;"), []);
});
