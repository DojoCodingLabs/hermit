import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const locale = (name: string) => JSON.parse(readFileSync(new URL(`../../../packages/copy/locales/${name}.json`, import.meta.url), "utf8")) as Record<string, string>;
const es = locale("es-419");
const en = locale("en");
const placeholders = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort();

test("HM-CHAT-01 (final review I2): the clear confirmation names every chat of the bot, older ones included, in both languages", () => {
  for (const key of ["HM-CHAT-01.clearTitle", "HM-CHAT-01.clearBody", "HM-CHAT-01.clearBodyHermit"]) {
    assert.ok(es[key] && en[key], key);
    assert.deepEqual(placeholders(es[key]!), placeholders(en[key]!), key);
    assert.doesNotMatch(es[key]! + en[key]!, /[–—]/, key);
  }
  assert.match(es["HM-CHAT-01.clearTitle"]!, /\{name\}/);
  assert.match(en["HM-CHAT-01.clearTitle"]!, /\{name\}/);
  assert.match(es["HM-CHAT-01.clearBody"]!, /todos tus chats con \{name\}.*anteriores/);
  assert.match(en["HM-CHAT-01.clearBody"]!, /all your chats with \{name\}.*earlier/i);
  assert.match(es["HM-CHAT-01.clearBodyHermit"]!, /todos tus chats con \{name\}.*anteriores/);
  assert.match(en["HM-CHAT-01.clearBodyHermit"]!, /all your chats with \{name\}.*earlier/i);
  // The bot's notes stay; Hermit's memories and the Activity log stay.
  assert.match(es["HM-CHAT-01.clearBody"]!, /notas/);
  assert.match(es["HM-CHAT-01.clearBodyHermit"]!, /recuerdos/);
  assert.match(en["HM-CHAT-01.clearBodyHermit"]!, /memories/);
});
