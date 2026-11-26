import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { activityLine, ACTIVITY_LINE_KEYS } from "./activity-view.ts";

const locale = (name: string) => JSON.parse(readFileSync(new URL(`../../../packages/copy/locales/${name}.json`, import.meta.url), "utf8")) as Record<string, string>;
const es = locale("es-419");
const en = locale("en");

test("HM-ACT-01: a step a mode let run is ran with its mode, never approved, and names the bot as it is called now", () => {
  for (const mode of ["ask", "auto", "dont_ask"] as const) {
    const line = activityLine({ skill: "reply_message", mark: "ran", reason: `mode.${mode}`, bot: "b3", botName: "Recetas" });
    assert.deepEqual(line, { who: { name: "Recetas" }, what: `HM-ACT-01.byMode.${mode}`, tone: "soft" });
  }
  // The mode stays on a step that then failed or read others' text (F-M28), beside that outcome.
  assert.deepEqual(activityLine({ skill: "read_web", mark: "failed", reason: "mode.auto", bot: "b1", botName: "Precios" }), {
    who: { name: "Precios" }, what: "HM-ACT-01.byMode.auto", outcome: "HM-ACT-01.mark.failed", tone: "coral",
  });
  // The user's own approval in Ask reads as today, with the bot's name.
  assert.deepEqual(activityLine({ skill: "reply_message", mark: "approved", bot: "hermit", botName: "Hermit" }), { who: { name: "Hermit" }, outcome: "HM-ACT-01.mark.approved", tone: "soft" });
});

test("HM-ACT-01: a bot that is gone reads as a deleted bot; a row no bot wrote names none", () => {
  assert.deepEqual(activityLine({ skill: "reply_message", mark: "ran", reason: "mode.dont_ask", bot: "b9" }).who, { key: "HM-ACT-01.botDeleted" });
  assert.equal(es["HM-ACT-01.botDeleted"], "bot borrado");
  assert.equal(en["HM-ACT-01.botDeleted"], "deleted bot");
  assert.deepEqual(activityLine({ skill: "remind", mark: "ran" }), { tone: "soft" });
  // A night job's reason is its own code, not a mode.
  assert.deepEqual(activityLine({ skill: "night.agenda", mark: "skipped", reason: "paused.hot" }), { outcome: "HM-ACT-01.mark.skipped", tone: "soft" });
});

test("HM-ACT-01: a change to a bot names the bot and says what changed; the global mode names no bot", () => {
  assert.deepEqual(activityLine({ skill: "bot", mark: "ran", reason: "bot.created", bot: "b1", botName: "Precios" }), { who: { name: "Precios" }, what: "HM-ACT-01.act.bot.created", tone: "soft" });
  assert.deepEqual(activityLine({ skill: "bot", mark: "ran", reason: "bot.deleted", bot: "b9" }), { who: { key: "HM-ACT-01.botDeleted" }, what: "HM-ACT-01.act.bot.deleted", tone: "soft" });
  assert.deepEqual(activityLine({ skill: "bot", mark: "ran", reason: "bot.note_shared", bot: "b2", botName: "Recetas" }).what, "HM-ACT-01.act.bot.note_shared");
  assert.deepEqual(activityLine({ skill: "bot", mark: "ran", reason: "mode.inherit", bot: "b1", botName: "Precios" }).what, "HM-ACT-01.act.mode.inherit");
  assert.deepEqual(activityLine({ skill: "bot", mark: "ran", reason: "mode.dont_ask", bot: "b1", botName: "Precios" }).what, "HM-ACT-01.act.mode.dont_ask");
  assert.deepEqual(activityLine({ skill: "bot", mark: "ran", reason: "mode.auto" }), { what: "HM-ACT-01.act.globalMode.auto", tone: "soft" });
  // A code this build doesn't know still names the bot, and says nothing it can't.
  assert.deepEqual(activityLine({ skill: "bot", mark: "ran", reason: "bot.someday", bot: "b1", botName: "Precios" }), { who: { name: "Precios" }, tone: "soft" });
});

test("HM-ACT-01: every code the bots API logs has its words, and every key the line uses exists in both locales", () => {
  const api = readFileSync(new URL("../../../packages/runtime/src/bots.ts", import.meta.url), "utf8");
  const union = /type BotReason =([^;]+);/.exec(api)![1]!;
  const codes = [...union.matchAll(/"(bot\.[a-z_]+|mode\.[a-z_]+)"/g)].map((m) => m[1]!);
  assert.ok(codes.includes("bot.created") && codes.includes("bot.note_shared") && codes.includes("mode.inherit"), codes.join(","));
  for (const code of codes) assert.ok(activityLine({ skill: "bot", mark: "ran", reason: code, bot: "b1", botName: "x" }).what, code);
  for (const mode of ["ask", "auto", "dont_ask"]) assert.ok(activityLine({ skill: "bot", mark: "ran", reason: `mode.${mode}` }).what, `global ${mode}`);
  for (const [name, dict] of [["es-419", es], ["en", en]] as const) {
    for (const key of ACTIVITY_LINE_KEYS) {
      assert.equal(typeof dict[key], "string", `${name} ${key}`);
      assert.doesNotMatch(dict[key]!, /[–—{]/, `${name} ${key}`);
    }
  }
});
