import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const prd = readFileSync(join(root, "docs/prd/hermit-prd.md"), "utf8");
const states = readFileSync(join(root, "docs/prd/hermit-ui-states-and-edge-cases.md"), "utf8");

const between = (text, from, to) => {
  const start = text.indexOf(from);
  assert.ok(start >= 0, `missing heading ${from}`);
  const end = to ? text.indexOf(to, start) : text.length;
  assert.ok(end > start, `missing heading ${to}`);
  return text.slice(start, end);
};
const statesPart3 = between(states, "## Part 3", "## Part 5");
const statesPart5 = between(states, "## Part 5", "## Part 6");
const ids = (text, re) => [...new Set(text.match(re) ?? [])];

test("every HM-BOT screen in the states spec is in the PRD's inventory", () => {
  for (const id of ids(states, /HM-BOT-0\d/g)) assert.ok(prd.includes(`| ${id} |`), id);
});
test("every EC-BOT a states row names is defined in Part 5", () => {
  for (const id of ids(statesPart3, /EC-BOT-\d{2}/g)) assert.match(statesPart5, new RegExp(`\\| ${id} \\|`), id);
});
test("the bots' decisions and epic are in the PRD", () => {
  for (const id of ["**PDR-029:", "**PDR-030:", "**PDR-031:", "| EP-28 | Bots |", "## EP-28: Bots", "**FR-CAGE-08.**"]) assert.ok(prd.includes(id), id);
  assert.match(prd, /US-NIGHT-05[\s\S]{0,400}Superseded by US-BOT-11/);
  assert.match(prd, /\*\*FR-BOT-\d{2}\.\*\*[^\n]*\bapps\b/); // the groups' list names apps
});
test("the states spec defines twelve bot edge cases", () => {
  assert.deepEqual(ids(statesPart5, /EC-BOT-\d{2}/g), Array.from({ length: 12 }, (_, i) => `EC-BOT-${String(i + 1).padStart(2, "0")}`));
});
