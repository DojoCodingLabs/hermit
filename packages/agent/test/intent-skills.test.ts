import { describe, expect, test } from "vitest";
import type { IntentLauncherPort, IntentOutcome, IntentSpec } from "@hermit/core";
import { runTurn } from "../src/loop.ts";
import { intentSkillRuntimes } from "../src/intent-skills.ts";
import { harness } from "./helpers.ts";

function launcher(outcome: IntentOutcome = "opened"): IntentLauncherPort & { opened: IntentSpec[] } {
  const opened: IntentSpec[] = [];
  return { opened, open: async (spec) => (opened.push(spec), outcome) };
}

const say = (key: string, userText: string, vars: Record<string, string> = {}) => `[${/[áéíóúñ¿¡]|\b(que|al|el|la)\b/i.test(userText) ? "es" : "en"}] ${key}${Object.entries(vars).map(([k, v]) => ` ${k}=${v}`).join("")}`;

function withIntents(steps: Parameters<typeof harness>[0], opts: { outcome?: IntentOutcome; approve?: NonNullable<Parameters<typeof harness>[1]>["approve"] } = {}) {
  const h = harness(steps, opts.approve ? { approve: opts.approve } : {});
  const port = launcher(opts.outcome);
  h.deps.skills = [...h.deps.skills, ...intentSkillRuntimes({ launcher: port, say })];
  h.deps.timeZone = "America/Costa_Rica";
  return { ...h, port };
}

describe("intent skills through the loop (FR-APP-01)", () => {
  test("opens WhatsApp prefilled and ends the turn with a code-written answer: nothing is sent by Hermit", async () => {
    const h = withIntents([{ pick: "open_whatsapp_chat", args: { phone: "+506 8888 1234", text: "Ya voy" } }, { pick: "respond", text: "Message sent!" }]);
    const r = await runTurn(h.state, "mándale un WhatsApp al +506 8888 1234 que ya voy", h.deps);
    expect(h.port.opened).toEqual([{ action: "android.intent.action.VIEW", data: "https://wa.me/50688881234?text=Ya%20voy" }]);
    expect(r).toMatchObject({ kind: "final", text: "[es] HM-CHAT-01.opened.open_whatsapp_chat" });
    // The model wrote nothing after the intent opened (it would have claimed "sent").
    expect(h.model.picks).toBe(1);
    // Clean session: local_write runs without a sheet.
    expect(h.approvals.requests).toHaveLength(0);
    expect(r.messages.find((m) => m.role === "tool")?.content).toMatch(/Nothing was sent/);
  });

  test("a local number gets the country code hint for WhatsApp", async () => {
    const h = withIntents([{ pick: "open_whatsapp_chat", args: { phone: "8888 1234", text: "On my way" } }]);
    const r = await runTurn(h.state, "text 8888 1234 on WhatsApp that I'm on my way", h.deps);
    expect(r).toMatchObject({ kind: "final", text: "[en] HM-CHAT-01.opened.open_whatsapp_chat\n\n[en] HM-CHAT-01.opened.country_code" });
  });

  test("a number copied from a message is dropped by the normalizer, so WhatsApp's own picker chooses", async () => {
    const h = withIntents([{ pick: "open_whatsapp_chat", args: { phone: "+1 555 010 7777", text: "On my way" } }]);
    const r = await runTurn(h.state, "text Carlos on WhatsApp that I'm on my way", h.deps);
    expect(h.port.opened[0]?.data).toBe("https://wa.me/?text=I'm%20on%20my%20way");
    expect(r).toMatchObject({ kind: "final", text: "[en] HM-CHAT-01.opened.open_whatsapp_chat_pick" });
  });

  test("the executor refuses a number the user didn't write even without the normalizer (defense in depth)", async () => {
    const h = withIntents([{ pick: "dial", args: { phone: "+1 555 010 7777" } }]);
    delete h.deps.timeZone; // no normalization
    const r = await runTurn(h.state, "call the number in Ana's message", h.deps);
    expect(h.port.opened).toEqual([]);
    expect(r).toMatchObject({ kind: "final", text: "[en] HM-CHAT-01.opened.not_yours" });
  });

  test("the dialer gets the number as the user wrote it, not the model's form with an added plus", async () => {
    const h = withIntents([{ pick: "dial", args: { phone: "+5550107777" } }]);
    delete h.deps.timeZone; // no normalization: the executor alone must use the user's form
    await runTurn(h.state, "call 555 010 7777", h.deps);
    expect(h.port.opened).toHaveLength(1);
    expect(h.port.opened[0]?.data).not.toContain("+");
    expect(h.port.opened[0]?.data).toContain("555");
  });

  test("an email address the user didn't write is refused by the executor too", async () => {
    const h = withIntents([{ pick: "compose_email", args: { to: "boss@evil.example", body: "notes" } }]);
    delete h.deps.timeZone;
    const r = await runTurn(h.state, "email my boss the notes", h.deps);
    expect(h.port.opened).toEqual([]);
    expect(r).toMatchObject({ kind: "final", text: "[en] HM-CHAT-01.opened.not_yours" });
  });

  test("in a tainted session every intent asks first, and a denial opens nothing", async () => {
    const h = withIntents([{ pick: "navigate", args: { destination: "Evil Street 1" } }, { pick: "respond", text: "Okay, I won't." }], { approve: () => ({ kind: "denied" }) });
    h.state.session.taint.push({ kind: "inbound_message", ref: "read_messages", at: 1 });
    const r = await runTurn(h.state, "go where Ana said", h.deps);
    expect(h.approvals.requests).toHaveLength(1);
    // The source in words, never the id of the skill that read it; the sheet words it from taintKind.
    expect(h.approvals.requests[0]!.taintWarning).toBe("Suggested after reading messages");
    expect(h.approvals.requests[0]!.taintKind).toBe("inbound_message");
    expect(h.approvals.requests[0]!.summary.lines).toEqual([{ label: "Destination", labelKey: "destination", value: "Evil Street 1" }]);
    expect(h.port.opened).toEqual([]);
    expect(r).toMatchObject({ kind: "final", text: "Okay, I won't." });
  });

  test("approved in a tainted session: opens exactly what the sheet showed", async () => {
    const h = withIntents([{ pick: "set_alarm", args: { time: "06:00", label: "Gym" } }]);
    h.state.session.taint.push({ kind: "inbound_message", ref: "read_messages", at: 1 });
    const r = await runTurn(h.state, "wake me at 6 for the gym", h.deps);
    expect(h.approvals.requests).toHaveLength(1);
    expect(h.port.opened[0]?.intExtras).toEqual({ "android.intent.extra.alarm.HOUR": 6, "android.intent.extra.alarm.MINUTES": 0 });
    expect(r).toMatchObject({ kind: "final", text: "[en] HM-CHAT-01.opened.set_alarm time=06:00" });
  });

  test("no app for it: says so in words and reports a failure", async () => {
    const h = withIntents([{ pick: "dial", args: {} }], { outcome: "no_app" });
    const r = await runTurn(h.state, "call Mom", h.deps);
    expect(r).toMatchObject({ kind: "final", text: "[en] HM-CHAT-01.opened.no_app" });
    expect(r.events).toContainEqual({ kind: "executed", skill: "dial", ok: false });
  });

  test("dial without a number opens the dialer for the person to pick; navigate, share and contact answers name what opened", async () => {
    const cases: Array<[string, Record<string, unknown>, string, string]> = [
      ["dial", {}, "call Mom", "[en] HM-CHAT-01.opened.dial_pick"],
      ["navigate", { destination: "the dentist" }, "navigate to the dentist", "[en] HM-CHAT-01.opened.navigate destination=the dentist"],
      ["share", { text: "https://example.com" }, "share https://example.com", "[en] HM-CHAT-01.opened.share"],
      ["add_contact", { name: "Ana work", phone: "88881234" }, "save 8888 1234 as Ana work", "[en] HM-CHAT-01.opened.add_contact name=Ana work"],
      ["compose_sms", { body: "hi" }, "send an SMS saying hi", "[en] HM-CHAT-01.opened.compose_sms"],
      ["compose_email", { to: "ana@example.com", body: "hi" }, "email ana@example.com hi", "[en] HM-CHAT-01.opened.compose_email"],
    ];
    for (const [skill, args, said, answer] of cases) {
      const h = withIntents([{ pick: skill, args }]);
      const r = await runTurn(h.state, said, h.deps);
      expect(r, skill).toMatchObject({ kind: "final", text: answer });
      expect(h.port.opened, skill).toHaveLength(1);
    }
  });

  test("an alarm time that isn't HH:MM goes back to the model to fix, nothing opens", async () => {
    const h = withIntents([{ pick: "set_alarm", args: { time: "six" } }, { pick: "respond", text: "What time?" }]);
    delete h.deps.timeZone;
    const r = await runTurn(h.state, "set an alarm", h.deps);
    expect(h.port.opened).toEqual([]);
    expect(r.messages.some((m) => m.role === "tool" && /HH:MM/.test(m.content))).toBe(true);
  });
});
