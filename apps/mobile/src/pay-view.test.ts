import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { baseUnitsText, capsAmount, payLineKey, PAY_LINE_KEYS } from "./pay-view.ts";

const locale = (name: string) => JSON.parse(readFileSync(new URL(`../../../packages/copy/locales/${name}.json`, import.meta.url), "utf8")) as Record<string, string>;
const types = readFileSync(new URL("../../../packages/core/src/types.ts", import.meta.url), "utf8");

test("HM-APPR-02: every payment line the runtime flags is labelled in the user's language, in both locales", () => {
  const flags = [...new Set([...types.matchAll(/"(pay_[a-z_]+)"/g)].map((m) => m[1]!))].sort();
  assert.deepEqual(Object.keys(PAY_LINE_KEYS).sort(), flags);
  for (const name of ["en", "es-419"]) {
    const dict = locale(name);
    for (const key of Object.values(PAY_LINE_KEYS)) assert.equal(typeof dict[key], "string", `${name} ${key}`);
  }
  assert.equal(payLineKey("pay_fee"), "HM-APPR-02.fee");
  // Other flags keep their own words (HM-APPR-01), and an unflagged line keeps the summary's label.
  assert.equal(payLineKey("from_contacts"), undefined);
  assert.equal(payLineKey(undefined), undefined);
});

test("HM-PAY-05: a cap is read exactly, in USD₮ base units, never as a float", () => {
  assert.equal(capsAmount("25"), 25_000_000n);
  assert.equal(capsAmount(" 20.5 "), 20_500_000n);
  assert.equal(capsAmount("20,50"), 20_500_000n);
  assert.equal(capsAmount("$100"), 100_000_000n);
  assert.equal(capsAmount("0.000001"), 1n);
  assert.equal(capsAmount("0"), 0n);
  assert.equal(capsAmount("0.1234567"), undefined, "more decimals than USD₮ has");
  assert.equal(capsAmount("0,123"), 123_000n, "a leading zero can't be a thousands group");
});

test("HM-PAY-05: a cap that reads two ways, or isn't a number, is refused, not guessed", () => {
  for (const text of ["1,000", "1.000", "1.000,50", "", " ", "abc", "-5", "1e3", "20 dollars", "1..2", "٢٠"]) {
    assert.equal(capsAmount(text), undefined, JSON.stringify(text));
  }
});

test("HM-PAY-05: the caps in force fill the fields as plain digits", () => {
  assert.equal(baseUnitsText(25_000_000n), "25");
  assert.equal(baseUnitsText(20_500_000n), "20.5");
  assert.equal(baseUnitsText(1n), "0.000001");
  assert.equal(capsAmount(baseUnitsText(123_456_789n)), 123_456_789n);
});
