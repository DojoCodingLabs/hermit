/**
 * PDR-028 (Q48, Q49) through the composition root: names resolved from fake contacts, questions with choices in the
 * user's language from the real locale files, and the permission offered once, never again.
 */
import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { nodeSql } from "@hermit/sql-node";
import { ed25519Signer } from "@hermit/cage";
import type { ApprovalRequest, ContactEntry, ContactsPermission, IntentSpec } from "@hermit/core";
import { profileById, type CompletionEngine } from "@hermit/model";
import { createHermit } from "../src/hermit.ts";

const PROFILE = profileById("botpsy-q4-two-stage-nothink")!;
const NOW = Date.UTC(2026, 10, 14, 15, 0);

const locales = {
  en: JSON.parse(readFileSync(new URL("../../copy/locales/en.json", import.meta.url), "utf8")) as Record<string, string>,
  "es-419": JSON.parse(readFileSync(new URL("../../copy/locales/es-419.json", import.meta.url), "utf8")) as Record<string, string>,
};
const copy = (lang: "en" | "es-419", key: string, vars: Record<string, string> = {}) => {
  const text = locales[lang][key];
  if (text === undefined) throw new Error(`missing copy ${key}`);
  return text.replace(/\{(\w+)\}/g, (_, k: string) => vars[k] ?? `{${k}}`);
};

const CONTACTS: ContactEntry[] = [
  { name: "Mamá", phones: [{ number: "+506 8888 1234" }], emails: [] },
  { name: "Carlos Méndez", phones: [{ number: "+506 8777 0001" }], emails: [] },
  { name: "Carlos Rojas", phones: [{ number: "+506 8777 0002" }], emails: [] },
];

function setup(script: string[], permission: ContactsPermission = "granted") {
  let i = 0;
  const engine: CompletionEngine = { complete: async () => ({ text: script[i++] ?? '{"choice":"respond"}', toolCalls: [] }) };
  const opened: IntentSpec[] = [];
  const sheets: ApprovalRequest[] = [];
  let reads = 0;
  let n = 0;
  const hermit = createHermit({
    sql: nodeSql(),
    signer: ed25519Signer(new Uint8Array(32).fill(9)),
    notifier: { schedule: async () => "n", cancel: async () => {} },
    calendar: { list: async () => [], add: async () => {}, calendars: async () => [] },
    replySender: { send: async () => "sent" },
    engine,
    approvals: { request: async (r) => (sheets.push(r), { kind: "approved", biometric: true, argsHash: r.call.argsHash }) },
    intents: { launcher: { open: async (spec) => (opened.push(spec), "opened") }, copy },
    people: { contacts: { permission: async () => permission, entries: async () => (reads++, CONTACTS) }, copy },
    now: () => NOW,
    timeZone: () => "America/Costa_Rica",
    language: () => "es-419",
    newId: () => `id${++n}`,
  }, PROFILE);
  return { hermit, opened, sheets, reads: () => reads };
}

describe("people by name in the app (PDR-028)", () => {
  test("'llama a mi mamá': the sheet shows her number from the contacts, then the dialer opens", async () => {
    const w = setup(['{"choice":"dial","args":{"person":"mi mamá"}}']);
    await w.hermit.init();
    const s = await w.hermit.startSession();
    const view = await w.hermit.send(s, "llama a mi mamá");
    expect(w.sheets[0]!.summary.lines).toEqual([{ label: "Number", labelKey: "number", value: "+50688881234" }, { label: "From your contacts", value: "Mamá", flag: "from_contacts" }]);
    expect(w.opened).toEqual([{ action: "android.intent.action.DIAL", data: "tel:+50688881234" }]);
    expect(view).toMatchObject({ kind: "reply", text: copy("es-419", "HM-CHAT-01.opened.dial") });
    // Nothing of the contact is kept in the stored conversation but the user's own words and the answer.
    const { entries } = await w.hermit.transcript(s);
    expect(JSON.stringify(entries)).not.toContain("8888");
  });

  test("two Carloses: a question in the user's language with each candidate as a choice", async () => {
    const w = setup(['{"choice":"dial","args":{"person":"Carlos"}}']);
    await w.hermit.init();
    const s = await w.hermit.startSession();
    const view = await w.hermit.send(s, "call Carlos");
    expect(view).toMatchObject({
      kind: "question",
      choices: [
        { label: copy("en", "HM-CHAT-01.people.ending", { name: "Carlos Méndez", digits: "0001" }), text: "+50687770001" },
        { label: copy("en", "HM-CHAT-01.people.ending", { name: "Carlos Rojas", digits: "0002" }), text: "+50687770002" },
      ],
    });
    expect(view.kind === "question" && view.text.startsWith(copy("en", "HM-CHAT-01.people.which_phone", { name: "Carlos" }))).toBe(true);
    expect(w.opened).toEqual([]);
  });

  test("without the permission: the dialer's own picker, the permission offered once, and never again", async () => {
    const w = setup(['{"choice":"dial","args":{"person":"mamá"}}', '{"choice":"dial","args":{"person":"mamá"}}'], "not_asked");
    await w.hermit.init();
    const s = await w.hermit.startSession();
    const first = await w.hermit.send(s, "llama a mamá");
    expect(first).toMatchObject({ kind: "reply", offer: "contacts" });
    expect(w.opened).toEqual([{ action: "android.intent.action.DIAL" }]);
    const second = await w.hermit.send(s, "llama a mamá");
    expect(second).not.toHaveProperty("offer");
    expect(w.reads()).toBe(0);
  });
});
