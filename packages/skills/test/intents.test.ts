import { describe, expect, test } from "vitest";
import { validateArgs, type NormalizeContext } from "@hermit/core";
import { intentSkillById, intentSkills } from "../src/intents.ts";

// Wednesday 2026-11-11, 21:00 in Costa Rica.
const NOW = Date.UTC(2026, 10, 12, 3, 0);
const ctx = (userText: string): NormalizeContext => ({ userText, now: NOW, timeZone: "America/Costa_Rica" });
const sk = (id: string) => intentSkillById(id)!;
const norm = (id: string, args: Record<string, unknown>, said: string) => sk(id).normalize!(args, ctx(said));
const render = { conversation: () => undefined };

describe("intent skills catalog (FR-APP-01)", () => {
  test("the eight intent skills, each local_write and never producing untrusted text", () => {
    expect(intentSkills.map((s) => [s.id, s.risk, s.producesUntrusted])).toEqual(
      ["open_whatsapp_chat", "compose_sms", "compose_email", "dial", "navigate", "share", "set_alarm", "add_contact"].map((id) => [id, "local_write", false]),
    );
  });

  test("menu lines fit the 300 character budget and schemas are closed objects", () => {
    for (const s of intentSkills) {
      expect(s.menuLine.length, s.id).toBeLessThanOrEqual(300);
      expect(s.args.additionalProperties, s.id).toBe(false);
      const props = Object.keys(s.args.properties as object);
      for (const r of s.args.required as string[]) expect(props, `${s.id}.${r}`).toContain(r);
    }
  });

  test("a number is never required: without one the other app's own picker chooses the person", () => {
    for (const id of ["open_whatsapp_chat", "compose_sms", "dial"]) expect(validateArgs({ ...(id === "dial" ? {} : id === "compose_sms" ? { body: "hi" } : { text: "hi" }) }, sk(id).args), id).toEqual([]);
  });
});

describe("approval sheets show exactly what the other app will get", () => {
  test("WhatsApp with and without a number", () => {
    expect(sk("open_whatsapp_chat").describeAction({ phone: "+50688881234", text: "Ya voy" }, render)).toEqual({
      title: "Open WhatsApp with this message?",
      lines: [{ label: "To", labelKey: "to", value: "+50688881234" }, { label: "Message", labelKey: "message", value: "Ya voy" }],
    });
    expect(sk("open_whatsapp_chat").describeAction({ text: "Ya voy" }, render).lines[0]).toEqual({ label: "To", labelKey: "to", value: "You pick the chat in WhatsApp", valueKey: "pickChatWhatsapp" });
  });

  test("email, alarm, contact, navigate, share, dial", () => {
    expect(sk("compose_email").describeAction({ to: "ana@example.com", subject: "Notas", body: "Hola" }, render).lines).toEqual([
      { label: "To", labelKey: "to", value: "ana@example.com" }, { label: "Subject", labelKey: "subject", value: "Notas" }, { label: "Message", labelKey: "message", value: "Hola" },
    ]);
    expect(sk("set_alarm").describeAction({ time: "06:00", label: "Gym" }, render).lines).toEqual([{ label: "Time", labelKey: "time", value: "06:00" }, { label: "Label", labelKey: "label", value: "Gym" }]);
    expect(sk("add_contact").describeAction({ name: "Ana", phone: "88881234" }, render).lines).toEqual([{ label: "Name", labelKey: "name", value: "Ana" }, { label: "Phone", labelKey: "phone", value: "88881234" }]);
    expect(sk("navigate").describeAction({ destination: "the dentist" }, render).lines).toEqual([{ label: "Destination", labelKey: "destination", value: "the dentist" }]);
    expect(sk("share").describeAction({ text: "https://example.com" }, render).lines).toEqual([{ label: "Text", labelKey: "text", value: "https://example.com" }]);
    expect(sk("dial").describeAction({}, render).lines).toEqual([{ label: "Number", labelKey: "number", value: "You pick who to call in the dialer", valueKey: "pickNumberDialer" }]);
  });
});

describe("normalizers: numbers and addresses only from the user's own words (FR-APP-02)", () => {
  test("a number the user didn't write is dropped, so the other app's picker decides", () => {
    const r = norm("open_whatsapp_chat", { phone: "+1 555 010 7777", text: "Ya voy" }, "escríbele a Carlos por WhatsApp que ya voy");
    expect(r.args).toEqual({ text: "Ya voy" });
    expect(r.notes.join()).toMatch(/phone: dropped/);
  });

  test("the user's number replaces the model's formatting; a missing one is filled from the words", () => {
    expect(norm("dial", { phone: "8888-1234" }, "llama al 8888 1234").args).toEqual({ phone: "88881234" });
    expect(norm("dial", {}, "call +506 8888 1234 please").args).toEqual({ phone: "+50688881234" });
    expect(norm("compose_sms", { body: "hi" }, "sms 8888 1234 and 7777 1234 saying hi").args).toEqual({ body: "Hi" });
  });

  test("email recipients the user didn't write are dropped; written ones are kept or filled", () => {
    expect(norm("compose_email", { to: "boss@evil.example, ana@example.com", body: "x" }, "email ana@example.com the notes").args.to).toBe("ana@example.com");
    expect(norm("compose_email", { body: "x" }, "send an email to ana@example.com and pedro@example.org").args.to).toBe("ana@example.com, pedro@example.org");
    expect(norm("compose_email", { to: "boss@evil.example", body: "x" }, "email my boss the notes").args).toEqual({ body: "x" });
    expect(norm("add_contact", { name: "Ana", email: "x@evil.example" }, "save Ana as a contact").args).toEqual({ name: "Ana" });
  });

  test("the message is the user's own words after the instruction", () => {
    expect(norm("open_whatsapp_chat", { text: "text Carlos on WhatsApp that I'm on my way" }, "text Carlos on WhatsApp that I'm on my way").args).toEqual({ text: "I'm on my way" });
    expect(norm("compose_sms", { phone: "88881234", body: "dile que ya voy" }, "mándale un mensaje de texto al 8888 1234 que ya voy").args).toEqual({ phone: "88881234", body: "Ya voy" });
    // No instruction in the words: the model's text stands.
    expect(norm("open_whatsapp_chat", { text: "Happy birthday!" }, "wish Carlos happy birthday on WhatsApp").args).toEqual({ text: "Happy birthday!" });
  });

  test("the destination comes from the user's words", () => {
    expect(norm("navigate", { destination: "Dentist" }, "navigate to the dentist on 5th avenue").args).toEqual({ destination: "the dentist on 5th avenue" });
    expect(norm("navigate", { destination: "x" }, "llévame al Mall San Pedro").args).toEqual({ destination: "Mall San Pedro" });
    expect(norm("navigate", { destination: "Casa de Ana" }, "vamos donde Ana").args).toEqual({ destination: "Casa de Ana" });
  });

  test("the alarm time is read by code from the user's words", () => {
    expect(norm("set_alarm", { time: "18:00" }, "wake me at 6 am").args).toEqual({ time: "06:00" });
    expect(norm("set_alarm", { time: "6:00" }, "ponme una alarma a las 6:30 de la mañana").args).toEqual({ time: "06:30" });
    expect(norm("set_alarm", { time: "07:00", label: "Gym" }, "set an alarm for the gym").args).toEqual({ time: "07:00", label: "Gym" });
  });
});
