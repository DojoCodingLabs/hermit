import assert from "node:assert/strict";
import { test } from "node:test";
import type { RosterRow } from "@hermit/runtime";
import { headerParts, hermitChatHref, hermitChatSteps, modeChip, rowLine, rowSpoken, rowTime } from "./roster-view.ts";

const row = (over: Partial<RosterRow>): RosterRow => ({
  bot: { id: "b1", name: "Precios", role: "", primary: false, pinOrder: null, hidden: false, notify: true, mode: null, grants: [], sources: { sites: [], connectors: [] }, createdAt: 1 },
  mode: "ask",
  lastAt: 1,
  ...over,
});

test("HM-BOT-01: a row says who wrote last, and the mode chip shows only for Auto and Don't ask", () => {
  assert.deepEqual(rowLine(row({ preview: { who: "user", text: "hola" } })), { key: "HM-BOT-01.you", vars: { text: "hola" } });
  assert.deepEqual(rowLine(row({ preview: { who: "bot", text: "Encontré el bautismo." } })), { text: "Encontré el bautismo." });
  assert.deepEqual(rowLine(row({})), { key: "HM-BOT-01.empty" });
  assert.equal(modeChip("ask"), undefined);
  assert.deepEqual(modeChip("auto"), { key: "HM-BOT-04.chip.auto", tone: "amber" });
  assert.deepEqual(modeChip("dont_ask"), { key: "HM-BOT-04.chip.dontAsk", tone: "coral" });
});

test("HM-BOT-01: Hermit's row is read with its line, time and mode, plus coordinator", () => {
  const words = { primary: "coordinador", pinned: "Fijado" };
  assert.equal(rowSpoken({ name: "Hermit", primary: true, preview: "2 bots trabajando", time: "Hace 2 min", pinned: false, chip: "Auto" }, words), "Hermit, coordinador, 2 bots trabajando, Hace 2 min, Auto");
  assert.equal(rowSpoken({ name: "Recetas", primary: false, preview: "Sin mensajes", time: "Ayer", pinned: true }, words), "Recetas, Sin mensajes, Ayer, Fijado");
});

test("HM-BOT-02: the first-run bar hides the identity but keeps the mode chip", () => {
  assert.deepEqual(headerParts({ quiet: true, mode: "dont_ask" }), { identity: false, chip: { key: "HM-BOT-04.chip.dontAsk", tone: "coral" } });
  assert.deepEqual(headerParts({ quiet: false, mode: "ask" }), { identity: true, chip: undefined });
});

test("HM-BOT-01: every way into Hermit's chat leaves the roster beneath it", () => {
  assert.deepEqual(hermitChatSteps("onboarding"), [{ kind: "replace", href: "/" }, { kind: "push", href: hermitChatHref }]);
  assert.deepEqual(hermitChatSteps("stack"), [{ kind: "dismissAll" }, { kind: "push", href: hermitChatHref }]);
});

test("HM-BOT-01 (final review I1): a row with no turn shows no time, so Hermit's fresh row never reads 1969", () => {
  assert.equal(rowTime(row({ lastAt: 0 })), undefined);
  assert.equal(rowTime(row({ lastAt: 1 })), undefined);
  assert.equal(rowTime(row({ lastAt: 5000, preview: { who: "bot", text: "hola" } })), 5000);
});
