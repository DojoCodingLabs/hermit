import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { RESERVED_GROUPS, SKILL_GROUPS, type BotLook } from "@hermit/core/bots";
import type { BotProposalView } from "../../../packages/runtime/src/bot-api.ts";
import { BOT_REFUSALS } from "../../../packages/runtime/src/bot-api.ts";
import { BOT_TEMPLATES, capBotName, formPatch, fromBot, fromProposal, fromTemplate, formNeedsFingerprint, formProblems, noteActions, proposalCard, refusalLine, settingsResult, shownGroups, toNewBot, type BotForm } from "./bot-form-view.ts";

const LOOK: BotLook = { shape: "whelk", color: "sand" };
const form = (over: Partial<BotForm> = {}): BotForm => ({ name: "Viajes", role: "Planeas los viajes de la familia Prueba.", look: LOOK, grants: ["web_read", "notes"], sites: "wikivoyage.org", connectors: [], mode: null, ...over });
const PROPOSAL: BotProposalView = { offerId: "o1", name: "Viajes", role: "Planeas los viajes de la familia Prueba.", look: LOOK, grants: ["web_read", "notes"], sources: { sites: ["wikivoyage.org"], connectors: [] }, tainted: false, needsFingerprint: false, mode: "ask" };
const locale = (name: string) => JSON.parse(readFileSync(new URL(`../../../packages/copy/locales/${name}.json`, import.meta.url), "utf8")) as Record<string, string>;
const es = locale("es-419");
const en = locale("en");

test("HM-BOT-03: the form's problems match the runtime's limits", () => {
  assert.deepEqual(formProblems(form({ name: " " })), ["name_empty"]);
  assert.deepEqual(formProblems(form({ name: "n".repeat(41), role: "r".repeat(801), sites: "wikivoyage.org, 192.168.0.1" })), ["name_too_long", "role_too_long", "bad_site"]);
  assert.deepEqual(formProblems(form()), []);
});
test("HM-BOT-03: a bot name is capped at 40 code points, keeping emoji whole", () => {
  assert.equal(capBotName("😀".repeat(40)), "😀".repeat(40));
  assert.equal(capBotName("😀".repeat(41)), "😀".repeat(40));
  assert.equal(capBotName("n".repeat(41)), "n".repeat(40));
  assert.equal(capBotName("Viajes"), "Viajes");
});

test("HM-BOT-03: a role of 800 emoji passes, 801 does not", () => {
  assert.deepEqual(formProblems(form({ role: "😀".repeat(800) })), []);
  assert.deepEqual(formProblems(form({ role: "😀".repeat(801) })), ["role_too_long"]);
});

test("HM-BOT-03: the fingerprint for mail send, logins, pay or Don't ask, and only when newly granted", () => {
  assert.equal(formNeedsFingerprint(form({ grants: ["mail_read"] })), false);
  assert.equal(formNeedsFingerprint(form({ grants: ["mail_send"] })), true);
  assert.equal(formNeedsFingerprint(form({ mode: "dont_ask" })), true);
  assert.equal(formNeedsFingerprint(form({ grants: ["mail_send", "notes"] }), { grants: ["mail_send"], mode: null }), false);
});
test("HM-BOT-03, HM-BOT-04: only the bot's own mode counts, as in the runtime (Task 18, ruling 5)", () => {
  // A bot that inherits brings no Don't ask of its own, whatever the global mode is: creating or copying it takes no word.
  assert.equal(formNeedsFingerprint(form({ mode: null })), false);
  // An own Don't ask the bot already has asks nothing again; one it newly takes asks, also over a mode it had.
  assert.equal(formNeedsFingerprint(form({ mode: "dont_ask" }), { grants: form().grants, mode: "dont_ask" }), false);
  assert.equal(formNeedsFingerprint(form({ mode: "dont_ask" }), { grants: form().grants, mode: "auto" }), true);
  assert.equal(formNeedsFingerprint(form({ mode: null }), { grants: form().grants, mode: "dont_ask" }), false);
});
test("HM-BOT-03, HM-BOT-04: every group and every refusal has its words in both locales", () => {
  for (const [name, dict] of [["es-419", es], ["en", en]] as const) {
    for (const g of SKILL_GROUPS) assert.ok(dict[`HM-BOT-04.group.${g}`], `${name} HM-BOT-04.group.${g}`);
    for (const r of BOT_REFUSALS) assert.ok(dict[`HM-BOT-04.refused.${r}`], `${name} HM-BOT-04.refused.${r}`);
  }
});
test("HM-BOT-03: sites are read as registrable domains", () => {
  assert.deepEqual(toNewBot(form({ sites: "https://www.wikivoyage.org/x\ncp.pt" })).sources.sites, ["wikivoyage.org", "cp.pt"]);
});
test("HM-BOT-03: a proposal and a template prefill the form", () => {
  assert.deepEqual(fromProposal(PROPOSAL).grants, PROPOSAL.grants);
  assert.equal(fromTemplate("travel", (key) => key, LOOK).sites, "wikivoyage.org");
  assert.equal(fromTemplate("travel", (key) => key, LOOK).name, "HM-BOT-03.template.travel.name");
});
test("HM-BOT-03: every template has its name and role in both locales, and holds only groups the form shows", () => {
  for (const [name, dict] of [["es-419", es], ["en", en]] as const) {
    for (const tpl of BOT_TEMPLATES) for (const k of ["name", "role"]) assert.ok(dict[`HM-BOT-03.template.${tpl.id}.${k}`], `${name} ${tpl.id} ${k}`);
  }
  assert.deepEqual(BOT_TEMPLATES.map((x) => x.id), ["travel", "recipes", "agenda", "inbox"]);
  for (const tpl of BOT_TEMPLATES) for (const g of tpl.grants) assert.ok(shownGroups().includes(g), `${tpl.id} ${g}`);
});
test("HM-BOT-04: the logins group stays out of the form until a skill carries it, and contacts shows", () => {
  assert.ok(!shownGroups().includes("vault_logins"));
  assert.ok(shownGroups().includes("contacts"));
  assert.ok(shownGroups().includes("wallet_pay"));
});
test("HM-BOT-04: the form hides exactly the groups core reserves, read from core's one list (Task 18, ruling 6)", () => {
  assert.deepEqual(SKILL_GROUPS.filter((g) => !shownGroups().includes(g)), [...RESERVED_GROUPS]);
  const src = readFileSync(new URL("./bot-form-view.ts", import.meta.url), "utf8");
  assert.match(src, /import \{[^}]*\bRESERVED_GROUPS\b[^}]*\} from "@hermit\/core\/bots"/);
  assert.doesNotMatch(src, /\["vault_logins"\]/);
});
test("HM-BOT-04: a note's actions follow where it lives and where it came from", () => {
  const own = { id: 1, fact: "a", tainted: false, createdAt: 0 };
  assert.deepEqual(noteActions(own, false), { delete: true, share: true });
  assert.deepEqual(noteActions({ ...own, tainted: true }, false), { delete: true, share: false });
  assert.deepEqual(noteActions({ ...own, shared: true }, false), { delete: false, share: false });
  assert.deepEqual(noteActions({ ...own, shared: true }, true), { delete: true, share: false });
});
test("HM-BOT-04: a bot becomes a form, and only what changed goes back as a patch", () => {
  const bot = { id: "b1", name: "Viajes", role: "Planeas los viajes de la familia Prueba.", primary: false, look: LOOK, pinOrder: null, hidden: false, notify: true, mode: null, grants: ["web_read" as const, "notes" as const], sources: { sites: ["wikivoyage.org"], connectors: [] }, createdAt: 0 };
  const base = fromBot(bot);
  assert.deepEqual(base, form());
  assert.deepEqual(formPatch(base, base), {});
  assert.deepEqual(formPatch({ ...base, name: " Genea ", grants: ["notes", "web_read"] }, base), { name: "Genea" });
  assert.deepEqual(formPatch({ ...base, look: { ...LOOK, color: "ink" }, grants: ["notes"], sites: "wikivoyage.org, cp.pt" }, base), {
    look: { shape: "whelk", color: "ink" }, grants: ["notes"], sources: { sites: ["wikivoyage.org", "cp.pt"], connectors: [] },
  });
  assert.deepEqual(formPatch({ ...base, mode: "auto" }, base), {});
});
test("HM-BOT-04: a refusal or a flash becomes one line in code's words, and a refusal wins", () => {
  assert.equal(settingsResult(undefined, undefined, "Viajes"), undefined);
  assert.deepEqual(settingsResult("too_many_pins", undefined, "Viajes"), { key: "HM-BOT-04.refused.too_many_pins", vars: { name: "Viajes" }, tone: "bad" });
  assert.deepEqual(settingsResult(undefined, "saved", "Viajes"), { key: "HM-BOT-04.saved", tone: "ok" });
  assert.deepEqual(settingsResult(undefined, "reset", "Viajes"), { key: "HM-BOT-04.resetDone", tone: "ok" });
  assert.equal(settingsResult("busy", "saved", "Viajes")?.tone, "bad");
  for (const [name, dict] of [["es-419", es], ["en", en]] as const) for (const k of ["HM-BOT-04.saved", "HM-BOT-04.resetDone"]) assert.ok(dict[k], `${name} ${k}`);
});
test("HM-BOT-04: a busy bot is the one named, not always Hermit; a change that threw says it failed (Task 18, ruling 4)", () => {
  assert.deepEqual(refusalLine("busy", "Recetas"), { key: "HM-BOT-04.refused.busy", vars: { name: "Recetas" } });
  assert.deepEqual(settingsResult("busy", undefined, "Recetas"), { key: "HM-BOT-04.refused.busy", vars: { name: "Recetas" }, tone: "bad" });
  assert.equal(en["HM-BOT-04.refused.busy"]!.replace("{name}", "Recetas"), "Recetas is busy. Try again in a moment.");
  assert.equal(es["HM-BOT-04.refused.busy"]!.replace("{name}", "Recetas"), "Recetas está ocupado. Intenta en un momento.");
  // Every refusal takes the bot's name, used or not, so no screen can show one without it.
  for (const r of BOT_REFUSALS) assert.deepEqual(refusalLine(r, "Recetas").vars, { name: "Recetas" });
  assert.deepEqual(refusalLine("failed", "Recetas"), { key: "HM-BOT-01.changeFailed", vars: { name: "Recetas" } });
});
test("HM-CHAT-01: the card for a tainted proposal offers only Review; an ordinary one offers Create beside it (Task 18, ruling 8)", () => {
  assert.deepEqual(proposalCard({ ...PROPOSAL, tainted: true, needsFingerprint: true }), { actions: ["review"], note: "tainted", mode: "ask" });
  assert.deepEqual(proposalCard({ ...PROPOSAL, tainted: true }), { actions: ["review"], note: "tainted", mode: "ask" });
  assert.deepEqual(proposalCard(PROPOSAL), { actions: ["create", "review"], mode: "ask" });
  assert.deepEqual(proposalCard({ ...PROPOSAL, needsFingerprint: true }), { actions: ["create", "review"], note: "fingerprint", mode: "ask" });
});
test("HM-CHAT-01 (final review I3): the card shows the mode the new bot runs in, and says so before Create when it is Auto or Don't ask", () => {
  assert.equal(proposalCard(PROPOSAL).modeNote, undefined);
  assert.deepEqual(proposalCard({ ...PROPOSAL, mode: "auto" }), { actions: ["create", "review"], mode: "auto", modeNote: "HM-CHAT-01.proposal.modeAuto" });
  assert.deepEqual(proposalCard({ ...PROPOSAL, mode: "dont_ask", tainted: true }), { actions: ["review"], note: "tainted", mode: "dont_ask", modeNote: "HM-CHAT-01.proposal.modeDontAsk" });
  assert.equal(proposalCard({ ...PROPOSAL, mode: "dont_ask" }).modeNote, "HM-CHAT-01.proposal.modeDontAsk");
});
test("HM-CHAT-01 (final review I3): the card's mode words exist in both languages with the same placeholders", () => {
  for (const key of ["HM-CHAT-01.proposal.mode", "HM-CHAT-01.proposal.modeValue", "HM-CHAT-01.proposal.modeAuto", "HM-CHAT-01.proposal.modeDontAsk"]) {
    assert.ok(es[key] && en[key], key);
    assert.deepEqual(es[key]!.match(/\{\w+\}/g) ?? [], en[key]!.match(/\{\w+\}/g) ?? [], key);
    assert.doesNotMatch(es[key]! + en[key]!, /[\u2013\u2014]/);
  }
  assert.match(en["HM-CHAT-01.proposal.modeValue"]!, /\{mode\}/);
});
test("HM-BOT-03 (M4): the name limit counts code points, as the store does; an emoji name at the limit passes", () => {
  assert.deepEqual(formProblems(form({ name: "\u{1F980}".repeat(40) })), []);
  assert.deepEqual(formProblems(form({ name: "\u{1F980}".repeat(41) })), ["name_too_long"]);
});
