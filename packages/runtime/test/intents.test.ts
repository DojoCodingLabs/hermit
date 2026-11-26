/**
 * SL-58 through the composition root: intent skills with a fake launcher and a fake engine that answers the way QVAC
 * does (raw JSON for the two-stage format). Copy comes from the real locale files.
 */
import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { nodeSql } from "@hermit/sql-node";
import { ed25519Signer } from "@hermit/cage";
import type { ApprovalRequest, IntentSpec } from "@hermit/core";
import { profileById, type CompletionEngine, type EngineRequest } from "@hermit/model";
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

function setup(script: string[], opts: { intents?: boolean } = {}) {
  const requests: EngineRequest[] = [];
  let i = 0;
  const engine: CompletionEngine = {
    async complete(req) {
      requests.push(req);
      return { text: script[i++] ?? '{"choice":"respond"}', toolCalls: [] };
    },
  };
  const opened: IntentSpec[] = [];
  const sheets: ApprovalRequest[] = [];
  let n = 0;
  const hermit = createHermit({
    sql: nodeSql(),
    signer: ed25519Signer(new Uint8Array(32).fill(9)),
    notifier: { schedule: async () => "n", cancel: async () => {} },
    calendar: { list: async () => [], add: async () => {}, calendars: async () => [] },
    replySender: { send: async () => "sent" },
    engine,
    approvals: { request: async (r) => (sheets.push(r), { kind: "approved", biometric: true, argsHash: r.call.argsHash }) },
    ...(opts.intents === false ? {} : { intents: { launcher: { open: async (spec) => (opened.push(spec), "opened") }, copy } }),
    now: () => NOW,
    timeZone: () => "America/Costa_Rica",
    language: () => "es-419",
    newId: () => `id${++n}`,
  }, PROFILE);
  return { hermit, requests, opened, sheets };
}

describe("intent skills in the app (SL-58)", () => {
  test("opens WhatsApp prefilled with no sheet in a clean session; the answer comes from copy in the user's language", async () => {
    const w = setup(['{"choice":"open_whatsapp_chat","args":{"phone":"+506 8888 1234","text":"ya voy"}}']);
    await w.hermit.init();
    const s = await w.hermit.startSession();
    const view = await w.hermit.send(s, "mándale un WhatsApp al +506 8888 1234 que ya voy");
    expect(w.opened).toEqual([{ action: "android.intent.action.VIEW", data: "https://wa.me/50688881234?text=Ya%20voy" }]);
    expect(view).toEqual({ kind: "reply", text: copy("es-419", "HM-CHAT-01.opened.open_whatsapp_chat") });
    expect(w.sheets).toHaveLength(0);
    // One model call: the pick. Nothing after the app opened.
    expect(w.requests).toHaveLength(1);
  });

  test("English words get the English answer", async () => {
    const w = setup(['{"choice":"set_alarm","args":{"time":"18:00"}}']);
    await w.hermit.init();
    const s = await w.hermit.startSession();
    const view = await w.hermit.send(s, "please wake me up at 6 am");
    expect(w.opened[0]?.intExtras).toEqual({ "android.intent.extra.alarm.HOUR": 6, "android.intent.extra.alarm.MINUTES": 0 });
    expect(view).toEqual({ kind: "reply", text: copy("en", "HM-CHAT-01.opened.set_alarm", { time: "06:00" }) });
  });

  test("the intent skills are on the menu only when the app wires a launcher", async () => {
    const off = setup(['{"choice":"respond"}', "No puedo."], { intents: false });
    await off.hermit.init();
    await off.hermit.send(await off.hermit.startSession(), "hola");
    expect(JSON.stringify(off.requests[0]!.jsonSchema)).not.toContain("open_whatsapp_chat");

    const on = setup(['{"choice":"respond"}', "Hola."]);
    await on.hermit.init();
    await on.hermit.send(await on.hermit.startSession(), "hola");
    expect(JSON.stringify(on.requests[0]!.jsonSchema)).toContain("open_whatsapp_chat");
  });
});
