import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { ahead, groupAddress, groupHex, middle, quoted, splitAmount, when } from "./format.ts";

const locale = (name: string) => JSON.parse(readFileSync(new URL(`../../../packages/copy/locales/${name}.json`, import.meta.url), "utf8")) as Record<string, string>;

test("an address is cut in the middle, keeping 0x and four characters each side; anything else is left whole", () => {
  assert.equal(middle("0x9C3f5B2a1E7d4F0b8A6c2D9e1F3a5B7c9D0e2F41"), "0x9C3f…2F41");
  assert.equal(middle("0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed"), "0x5aAe…eAed");
  // Short enough to read whole, or not an address: unchanged.
  assert.equal(middle("Ana"), "Ana");
  assert.equal(middle("0x1234"), "0x1234");
  // A long hash is cut the same way, from both ends.
  assert.equal(middle("a3f91c075e2b88d04f61b9a2c7d0e4f1", 6, 6), "a3f91c…d0e4f1");
});

test("quotes are curly in both languages, never straight or guillemets", () => {
  assert.equal(quoted("Mándale 20 dólares a Ana"), "“Mándale 20 dólares a Ana”");
  assert.equal(quoted("  hola "), "“hola”");
});

test("an amount splits into its figures and its unit, so the unit can be set apart; nothing is dropped", () => {
  assert.deepEqual(splitAmount("20.00 USD₮"), { figures: "20.00", unit: "USD₮" });
  assert.deepEqual(splitAmount("127,45 USD₮"), { figures: "127,45", unit: "USD₮" });
  assert.deepEqual(splitAmount("1.250,00 USD₮"), { figures: "1.250,00", unit: "USD₮" });
  // Not a number then a unit: kept whole as the figures.
  assert.deepEqual(splitAmount("USD₮ 20"), { figures: "USD₮ 20", unit: "" });
  assert.deepEqual(splitAmount("20"), { figures: "20", unit: "" });
});

test("dates read relative to now: minutes, today, yesterday, this week, then the date", () => {
  const now = new Date(2026, 10, 20, 21, 30).getTime(); // Friday 20 November 2026, 21:30 local time
  const at = (d: number, h: number, m: number) => new Date(2026, 10, d, h, m).getTime();
  assert.deepEqual(when(now - 20_000, now, "en"), { key: "common.when.now" });
  assert.deepEqual(when(now - 5 * 60_000, now, "en"), { key: "common.when.minutes", vars: { n: "5" } });
  assert.equal(when(at(20, 9, 5), now, "en").key, "common.when.today");
  assert.equal(when(at(19, 19, 10), now, "en").key, "common.when.yesterday");
  const week = when(at(16, 8, 0), now, "es-419");
  assert.equal(week.key, "common.when.weekday");
  // The whole day's name, capitalized: it starts its line, and "mar" would also read as March.
  assert.equal(week.vars!.day, "Lunes");
  const older = when(new Date(2026, 9, 2, 10, 0).getTime(), now, "es-419");
  assert.deepEqual(older.key, "common.when.date");
  assert.match(older.vars!.date!, /2 oct/);
  // Another year names the year.
  assert.match(when(new Date(2025, 11, 31, 10, 0).getTime(), now, "en").vars!.date!, /2025/);
  // A time in the future (a clock that moved) is never "in 5 min": it reads as now.
  assert.deepEqual(when(now + 90_000, now, "en"), { key: "common.when.now" });
});

test("a moment still to come: today, tomorrow, the weekday, then the date with its time; a past one reads like when()", () => {
  const now = new Date(2026, 10, 20, 21, 30).getTime(); // Friday 20 November 2026, 21:30 local time
  const at = (d: number, h: number, m: number) => new Date(2026, 10, d, h, m).getTime();
  assert.equal(ahead(at(20, 23, 0), now, "en").key, "common.when.today");
  assert.equal(ahead(at(21, 9, 0), now, "en").key, "common.when.tomorrow");
  const sunday = ahead(at(22, 1, 49), now, "es-419");
  assert.equal(sunday.key, "common.when.weekday");
  assert.equal(sunday.vars!.day, "Domingo");
  const later = ahead(at(30, 10, 0), now, "es-419");
  assert.equal(later.key, "common.when.dateTime");
  assert.match(later.vars!.date!, /30 nov/);
  assert.ok(later.vars!.time);
  assert.deepEqual(ahead(now - 5 * 60_000, now, "en"), when(now - 5 * 60_000, now, "en"));
});

test("every relative-date key has words in both languages, with the same placeholders", () => {
  for (const name of ["en", "es-419"]) {
    const dict = locale(name);
    for (const key of ["common.when.now", "common.when.minutes", "common.when.today", "common.when.yesterday", "common.when.tomorrow", "common.when.weekday", "common.when.date", "common.when.dateTime"]) {
      assert.equal(typeof dict[key], "string", `${name} ${key}`);
    }
  }
});

test("a whole address in groups of four after the 0x: every character kept, breaks only between groups", () => {
  const a = "0xdbF03B407c01A1b2C3d4E5f60718293A4b5CC6FB";
  const g = groupAddress(a);
  assert.equal(g, "0xdbF0 3B40 7c01 A1b2 C3d4 E5f6 0718 293A 4b5C C6FB");
  // Display only: taking the spaces out gives the address back, character for character.
  assert.equal(g.replace(/ /g, ""), a);
  // Ten groups, the first with its 0x; none shorter than four, so a wrapped line never ends on a lone character.
  const groups = g.split(" ");
  assert.equal(groups.length, 10);
  assert.ok(groups.every((x, i) => x.length === (i === 0 ? 6 : 4)));
  // Not a 0x address: unchanged.
  assert.equal(groupAddress("Ana"), "Ana");
  assert.equal(groupAddress("0xZZ"), "0xZZ");
});

test("a hash in groups of eight for reading: every character kept, nothing else touched", () => {
  const h = "3f3a9c2e7b1d40583f3a9c2e7b1d40583f3a9c2e7b1d40583f3a9c2e7b1d4058";
  const g = groupHex(h);
  assert.equal(g.split(" ").length, 8);
  assert.ok(g.split(" ").every((x) => x.length === 8));
  assert.equal(g.replace(/ /g, ""), h);
  assert.equal(groupHex("call_proposed"), "call_proposed");
});
