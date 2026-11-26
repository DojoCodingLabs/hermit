// HM-APPR-01 (PR #95's rules, applied to values): only labels and values Hermit's own code wrote are translated; a
// value from the arguments, the user's words or a tool is shown as it is; a connector's or MCP tool's line never borrows
// Hermit's words; payment wording appears only on the pay sheets. And the mail sheets (SL-48, SL-49) say what they do.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { approveWords, lineValue, sheetFoot, sheetWords, SUMMARY_VALUE_IDS } from "./approval-view.ts";

const locale = (name: string) => JSON.parse(readFileSync(new URL(`../../../packages/copy/locales/${name}.json`, import.meta.url), "utf8")) as Record<string, string>;
const PACKAGES = new URL("../../../packages/", import.meta.url).pathname;

/** Every package source file that builds an approval sheet's lines (describeAction, or a payment hold's lines). */
function sheetSources(): Array<{ file: string; src: string }> {
  return readdirSync(PACKAGES).flatMap((pkg) => {
    const dir = join(PACKAGES, pkg, "src");
    let files: string[];
    try {
      files = readdirSync(dir, { recursive: true }).map(String).filter((f) => f.endsWith(".ts"));
    } catch {
      return [];
    }
    return files
      .map((f) => ({ file: `${pkg}/src/${f}`, src: readFileSync(join(dir, f), "utf8") }))
      .filter(({ src }) => /describeAction|ApprovalSummary|flag: "pay_/.test(src));
  });
}

/** A network's own name, the same in every language (HM-APPR-02 shows it on the pay sheets only). */
const PROPER_NAMES = new Set(["PAY_NETWORK_LABEL"]);

/**
 * A line's `value:` written as a literal word or an ALL_CAPS constant (`value: "Everyone"`, `value: x || "You pick"`,
 * `value: ALL_ACCOUNTS`) instead of through fixedValue or valueOr, which set the valueKey next to it. Values the runtime
 * already put in the user's language (`deps.say(...)`) and connector request headers are not sheet words.
 */
function untranslatedValues(file: string, src: string): string[] {
  const out: string[] = [];
  for (const m of src.matchAll(/\bvalue: ([^,}\n]*)/g)) {
    const expr = m[1]!;
    if (/\bsay\(|static_header/.test(src.slice(Math.max(0, m.index! - 80), m.index! + expr.length + 8))) continue;
    // Words of three letters or more (a locale argument like "en" is not a value); a constant, not a property read.
    const literal = /"[A-Za-z][^"]{2,}"|'[A-Za-z][^']{2,}'/.test(expr);
    const constant = /\b[A-Z][A-Z0-9_]{3,}\b(?!\.)/.exec(expr)?.[0];
    if (literal || (constant && !PROPER_NAMES.has(constant))) out.push(`${file}: value: ${expr.trim()}`);
  }
  return out;
}

test("HM-APPR-01: every fixed value Hermit's skills write carries a valueKey set in code, never derived from its text", () => {
  const sources = sheetSources();
  assert.ok(sources.some((s) => s.file === "skills/src/catalog.ts"), "the scan reads the skills");
  assert.ok(sources.some((s) => s.file === "skills/src/intents.ts"), "the scan reads the intent skills");
  assert.deepEqual(sources.flatMap((s) => untranslatedValues(s.file, s.src)), []);
  // Every value id used in code is one of the ids, and the ids are exactly @hermit/core's SummaryValueId.
  const all = sources.map((s) => s.src).join("\n") + readFileSync(join(PACKAGES, "skills/src/values.ts"), "utf8");
  const used = new Set([...all.matchAll(/fixedValue\("[^"]+", "([^"]+)"\)|valueOr\([^,]+, (?:"[^"]+"|[A-Z_]+), "([^"]+)"\)|valueKey: "([^"]+)"/g)].map((m) => m[1] ?? m[2] ?? m[3]).filter((x): x is string => !!x));
  for (const id of ["allAccounts", "everyone", "unread", "mostRecent", "pickChatWhatsapp", "archive"]) assert.ok(used.has(id), `the sheets' ${id}`);
  for (const id of used) assert.ok((SUMMARY_VALUE_IDS as readonly string[]).includes(id), id);
  const types = readFileSync(join(PACKAGES, "core/src/types.ts"), "utf8");
  const union = /export type SummaryValueId =([^;]+);/.exec(types)![1]!.split("|").map((x) => x.trim().replace(/"/g, "")).filter(Boolean);
  assert.deepEqual([...SUMMARY_VALUE_IDS].sort(), union.sort());
});

test("HM-APPR-01: the scan catches a fixed English value written straight on a line", () => {
  assert.deepEqual(untranslatedValues("x.ts", `lines: [{ label: "From", labelKey: "from", value: s(a.contact) || "Everyone" }]`), ['x.ts: value: s(a.contact) || "Everyone"']);
  assert.deepEqual(untranslatedValues("x.ts", `{ label: "Account", labelKey: "account", value: s(a.account) || ALL_ACCOUNTS }`), ["x.ts: value: s(a.account) || ALL_ACCOUNTS"]);
  assert.deepEqual(untranslatedValues("x.ts", `{ label: "Account", labelKey: "account", ...valueOr(a.account, ALL_ACCOUNTS, "allAccounts") }`), []);
  assert.deepEqual(untranslatedValues("x.ts", `{ label: "Address", value: deps.say("HM-APPR-02.typedValue", said), flag: "pay_typed" }`), []);
  assert.deepEqual(untranslatedValues("x.ts", `{ label: "Network", value: PAY_NETWORK_LABEL, flag: "pay_network" }`), []);
});

test("HM-APPR-01: every value id has words in es-419 and English, none with an em or en dash or straight quotes", () => {
  for (const name of ["en", "es-419"]) {
    const dict = locale(name);
    for (const id of SUMMARY_VALUE_IDS) {
      const text = dict[`HM-APPR-01.value.${id}`];
      assert.equal(typeof text, "string", `${name} ${id}`);
      assert.doesNotMatch(text!, /[–—"]/, `${name} ${id}`);
    }
  }
  // es-419 says them in Spanish, not in the English the model reads.
  const es = locale("es-419");
  assert.equal(es["HM-APPR-01.value.allAccounts"], "Todas las cuentas conectadas");
  assert.equal(es["HM-APPR-01.value.unread"], "Sin leer");
});

test("HM-APPR-01: a value from Hermit's code shows in copy; any other value shows exactly as it is", () => {
  assert.deepEqual(lineValue("mail_list", { value: "All connected accounts", valueKey: "allAccounts" }), { key: "HM-APPR-01.value.allAccounts" });
  assert.deepEqual(lineValue("open_whatsapp_chat", { value: "You pick the chat in WhatsApp", valueKey: "pickChatWhatsapp" }), { key: "HM-APPR-01.value.pickChatWhatsapp" });
  // The user's words or the arguments, even when they read like a fixed value: never translated.
  assert.deepEqual(lineValue("read_messages", { value: "Everyone" }), { text: "Everyone" });
  assert.deepEqual(lineValue("mail_list", { value: "work" }), { text: "work" });
  // An id Hermit doesn't know is not a key.
  assert.deepEqual(lineValue("mail_list", { value: "Unread", valueKey: "nope" }), { text: "Unread" });
});

test("HM-APPR-01: a connector's or MCP tool's value stays raw, even one that claims Hermit's value key or a payment flag", () => {
  for (const skill of ["mcp_m1_transfer", "conn_bank_send"]) {
    assert.deepEqual(lineValue(skill, { value: "All connected accounts", valueKey: "allAccounts" }), { text: "All connected accounts" });
    assert.deepEqual(lineValue(skill, { value: "Archive", valueKey: "archive", flag: "pay_amount" }), { text: "Archive" });
  }
  // A payment line keeps its value exactly (the amount, the address): values are never payment words.
  assert.deepEqual(lineValue("pay", { value: "20 USD₮", flag: "pay_amount" }), { text: "20 USD₮" });
  for (const id of SUMMARY_VALUE_IDS) assert.doesNotMatch(id, /^(amount|fee|payee|capLeft|network|valid|typed)$/);
});

test("HM-APPR-01: the sheet renders every line's value through lineValue, never the raw text alone", () => {
  const sheet = readFileSync(new URL("./components/ApprovalSheet.tsx", import.meta.url), "utf8");
  assert.match(sheet, /lineValue\(req\.call\.skill, l\)/);
  // The fingerprint prompt is the sheet's own title in the user's language, never the skill's English title.
  assert.doesNotMatch(sheet, /authenticate\(req, req\.summary\.title\)/);
});

test("HM-APPR-01 for mail (SL-48, SL-49): each sheet says what it does: read, send, save a draft, change emails", () => {
  for (const skill of ["mail_list", "mail_search", "mail_read"]) {
    assert.deepEqual(sheetWords(skill), { title: "HM-APPR-01.titleMailRead", deny: "HM-APPR-01.denyRead", signedNote: "HM-APPR-01.signedNote", notes: [] });
    assert.equal(sheetFoot(skill, false), "HM-APPR-01.shownFootRead");
  }
  for (const skill of ["mail_send", "mail_reply", "mail_forward"]) {
    assert.deepEqual(sheetWords(skill), { title: "HM-APPR-01.titleMailSend", deny: "HM-APPR-01.deny", signedNote: "HM-APPR-01.signedNote", notes: [] });
    assert.deepEqual(approveWords(skill, undefined), { label: { key: "HM-APPR-01.sendVerb" }, spoken: { key: "HM-APPR-01.sendVerbSpoken" } });
    assert.equal(sheetFoot(skill, false), "HM-APPR-01.shownFoot");
  }
  assert.deepEqual(sheetWords("mail_draft"), { title: "HM-APPR-01.titleMailDraft", deny: "HM-APPR-01.denySave", signedNote: "HM-APPR-01.signedNote", notes: ["HM-APPR-01.draftNote"] });
  assert.deepEqual(approveWords("mail_draft", undefined), { label: { key: "HM-APPR-01.saveVerb" }, spoken: { key: "HM-APPR-01.saveVerbSpoken" } });
  assert.deepEqual(sheetWords("mail_modify"), { title: "HM-APPR-01.titleMailModify", deny: "HM-APPR-01.denyChange", signedNote: "HM-APPR-01.signedNote", notes: [] });
  for (const skill of ["mail_draft", "mail_modify"]) assert.equal(sheetFoot(skill, false), "HM-APPR-01.shownFootAct");
  // Everything else keeps its foot; a signed sheet keeps the signed one.
  assert.equal(sheetFoot("reply_message", false), "HM-APPR-01.shownFoot");
  assert.equal(sheetFoot("pay", true), "HM-APPR-01.signedFoot");
  for (const name of ["en", "es-419"]) {
    const dict = locale(name);
    for (const skill of ["mail_list", "mail_send", "mail_draft", "mail_modify"]) {
      const w = sheetWords(skill);
      const a = approveWords(skill, undefined);
      for (const key of [w.title, w.deny, w.signedNote, ...w.notes, a.label.key, a.spoken.key, sheetFoot(skill, false)]) assert.equal(typeof dict[key], "string", `${name} ${key}`);
    }
  }
});
