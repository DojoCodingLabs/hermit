import { describe, expect, test } from "vitest";
import { normalizeCalendarAdd, normalizeCalendarRead, normalizeReadMessages, normalizeReminderCancel, normalizeRemember, normalizeRemind, normalizeReply } from "../src/normalize.ts";

// Wednesday 2026-11-11, 21:00 in Costa Rica.
const ctx = (userText: string) => ({ userText, now: Date.UTC(2026, 10, 12, 3, 0), timeZone: "America/Costa_Rica" });

describe("normalize: times the user's words pin down are read by code", () => {
  test("remind: a copied current hour becomes the time the user said, with a note", () => {
    const r = normalizeRemind({ text: "send the invoice", at: "2026-11-11T21:00:00" }, ctx("ping me at 10 tonight to send the invoice"));
    expect(r.args.at).toBe("2026-11-11T22:00:00");
    expect(r.notes).toHaveLength(1);
  });

  test("remind: a wrong weekday becomes the named day; relative times are exact", () => {
    expect(normalizeRemind({ text: "x", at: "2026-11-15T17:00:00" }, ctx("recuérdame el viernes a las 5 de la tarde")).args.at).toBe("2026-11-13T17:00:00");
    expect(normalizeRemind({ text: "x", at: "2026-11-11T21:00:00" }, ctx("recuérdame en 2 horas")).args.at).toBe("2026-11-11T23:00:00");
  });

  test("remind: a named day without a time keeps the model's time; no time words, nothing changes", () => {
    expect(normalizeRemind({ text: "x", at: "2026-11-20T09:00:00" }, ctx("recuérdame el lunes lo del contador")).args.at).toBe("2026-11-16T09:00:00");
    const same = normalizeRemind({ text: "x", at: "2026-11-12T09:00:00" }, ctx("recuérdame lo del contador"));
    expect(same.notes).toEqual([]);
  });

  test("calendar_add: ranges set start and end; a lone start gets one hour", () => {
    expect(normalizeCalendarAdd({ title: "Dentista", start: "2026-11-15T10:00:00", end: "2026-11-15T11:00:00" }, ctx("agenda dentista el viernes de 10 a 11")).args)
      .toMatchObject({ start: "2026-11-13T10:00:00", end: "2026-11-13T11:00:00" });
    expect(normalizeCalendarAdd({ title: "Banco", start: "2026-11-13T21:00:00", end: "2026-11-13T21:00:00" }, ctx("schedule a call with the bank on Friday at 9am")).args)
      .toMatchObject({ start: "2026-11-13T09:00:00", end: "2026-11-13T10:00:00" });
  });

  test("calendar_read: a named day covers that whole day", () => {
    expect(normalizeCalendarRead({ from: "2026-11-10T00:00:00", to: "2026-11-10T23:59:59" }, ctx("¿qué tengo el lunes?")).args)
      .toEqual({ from: "2026-11-16T00:00:00", to: "2026-11-16T23:59:59" });
  });

  test("reply: the instruction is cut, the message is kept", () => {
    const r = (text: string) => normalizeReply({ conversationId: "wa:1", text }).args.text;
    expect(r("dile que voy 10 minutos tarde")).toBe("Voy 10 minutos tarde");
    expect(r("decile a la Vale que llego tarde")).toBe("Llego tarde");
    expect(r("tell him that I'm on my way")).toBe("I'm on my way");
    expect(r("Voy en camino")).toBe("Voy en camino");
    expect(r("Tell me when you arrive")).toBe("Tell me when you arrive"); // a message, not an instruction
  });

  test("reply: the user's own words carry the message and win over the model's text", () => {
    const r = (userText: string, text: string) => normalizeReply({ conversationId: "wa:1", text }, ctx(userText)).args.text;
    expect(r("decile a la Vale que llego a las 8", "¿A qué hora llegas?")).toBe("Llego a las 8");
    expect(r("tell Pedro I'll be there at 8", "ok")).toBe("I'll be there at 8");
    expect(r("respóndele a Carla", "Sí, ahí nos vemos")).toBe("Sí, ahí nos vemos"); // no message in the words
  });

  test("review findings 6 and 7: an event past midnight ends the next day; \"let me know\" is not an instruction", () => {
    expect(normalizeCalendarAdd({ title: "Cena", start: "2026-11-11T22:00:00", end: "2026-11-12T01:00:00" }, ctx("agenda cena de 10pm a 1am")).args)
      .toMatchObject({ start: "2026-11-11T22:00:00", end: "2026-11-12T01:00:00" });
    expect(normalizeReply({ conversationId: "wa:1", text: "Llego tarde" }, ctx("let me know what Ana said and tell her I'm late")).args.text).not.toMatch(/^What Ana said/);
  });

  test("remember: the fact without the instruction", () => {
    const f = (fact: string) => normalizeRemember({ fact }).args.fact;
    expect(f("anota que la clave de mi banco es 7788")).toBe("La clave de mi banco es 7788");
    expect(f("remember that my car is on level 3")).toBe("My car is on level 3");
    expect(f("guarda esto: mi talla es 42")).toBe("Mi talla es 42");
    expect(f("Mi pasaporte vence en marzo")).toBe("Mi pasaporte vence en marzo");
    expect(f("Note: the gate code is 4589")).toBe("The gate code is 4589");
  });

  test("remember: the user's own words win over a translated or reworded fact", () => {
    const r = (userText: string, fact: string) => normalizeRemember({ fact }, ctx(userText)).args.fact;
    expect(r("recuerda que mi pasaporte vence en marzo", "my passport expires in March of 2027")).toBe("Mi pasaporte vence en marzo");
    expect(r("recuerda que mi placa es BCR123", "Mi placa es BCR123")).toBe("Mi placa es BCR123");
    expect(r("cuál es mi placa", "my plate")).toBe("my plate");
  });

  test("remind on 'the day of' something: the date the user gave earlier in the chat", () => {
    const c = { ...ctx("recuérdame a las 9 de la mañana el día del cumpleaños de mi mamá que la llame"), earlier: ["recuerda que el cumpleaños de mi mamá es el 20 de noviembre"] };
    expect(normalizeRemind({ text: "llamar a mamá", at: "2026-11-18T09:00:00" }, c).args.at).toBe("2026-11-20T09:00:00");
    const e = { ...ctx("remind me at 9 am on my mom's birthday to call her"), earlier: ["remember that my mom's birthday is on November 20"] };
    expect(normalizeRemind({ text: "call mom", at: "2026-11-18T09:00:00" }, e).args.at).toBe("2026-11-20T09:00:00");
    const none = { ...ctx("recuérdame a las 9 de la mañana el día del cumpleaños de mi mamá que la llame"), earlier: ["hola"] };
    expect(normalizeRemind({ text: "llamar a mamá", at: "2026-11-12T09:00:00" }, none).args.at).toBe("2026-11-12T09:00:00");
  });

  test("two requests in one message: each action keeps its own clause", () => {
    const text = "recuérdame mañana a las 9 llamar al banco y anota que mi cuenta es 1234";
    const whole = "recuérdame a las 9 llamar al banco y anota que mi cuenta es 1234";
    expect(normalizeRemember({ fact: whole }, ctx(text)).args.fact).toBe("Mi cuenta es 1234");
    const r = normalizeRemind({ text: whole, at: "2026-11-12T09:00:00" }, ctx(text)).args;
    expect(r.text).toBe("recuérdame a las 9 llamar al banco");
    expect(r.at).toBe("2026-11-12T09:00:00");
  });

  test("reminder_cancel: the user's words when they name a time; otherwise the model's", () => {
    const w = (userText: string, which: string) => normalizeReminderCancel({ which }, ctx(userText)).args.which;
    expect(w("cancela el recordatorio de las 9", "9 de la mañana")).toBe("cancela el recordatorio de las 9");
    expect(w("ya no me recuerdes lo del banco", "banco")).toBe("banco");
  });

  test("read_messages: an empty contact is filled from the user's words; a given one is kept", () => {
    const c = (text: string, contact = "") => normalizeReadMessages(contact ? { contact } : {}, ctx(text)).args.contact ?? (contact ? undefined : "");
    expect(c("parce, ¿me escribió el Pipe?")).toBe("Pipe");
    expect(c("mandale un wasap a la Dra. Morales diciendo que llego tarde")).toBe("Dra. Morales");
    expect(c("avisale a Sofi que ya voy saliendo")).toBe("Sofi");
    expect(c("text Carlos I'm outside")).toBe("Carlos");
    expect(c("let Dr. Patel know I need to move it")).toBe("Dr. Patel");
    expect(c("did Ana write?")).toBe("Ana");
    expect(c("q dijo mi hermano")).toBe("hermano");
    expect(c("¿tengo mensajes nuevos?")).toBe("");
    expect(c("did Ana write?", "Ana María")).toBe("Ana María");
    expect(c("¿qué me perdí?", "user")).toBeUndefined(); // invented: read everyone
    expect(c("¿qué me dijo mi hermana?", "Hermana")).toBe("Hermana");
    expect(c("q dijo mi hermano", "me")).toBe("hermano"); // invented, replaced by the name in the words
  });

  test("remind: a time with no day keeps a later date the model chose from context (the birthday chain)", () => {
    expect(normalizeRemind({ text: "llamar a mamá", at: "2026-11-20T09:00:00" }, ctx("recuérdame a las 9 de la mañana el día del cumpleaños de mi mamá")).args.at).toBe("2026-11-20T09:00:00");
    expect(normalizeRemind({ text: "x", at: "2026-11-11T21:00:00" }, ctx("ping me at 10 tonight")).args.at).toBe("2026-11-11T22:00:00");
  });
});

describe("read_messages contact: groups, articles, one-letter guesses (messaging set)", () => {
  const c = (text: string, contact?: string) =>
    normalizeReadMessages(contact ? { contact } : {}, { userText: text, now: 0, timeZone: "UTC" }).args.contact;
  test.each([
    ["revisa el grupo de la familia", undefined, "grupo de la familia"],
    ["message the soccer team group that practice is cancelled", undefined, "soccer team"],
    ["q dijo mi hermano", "q", "hermano"],
    ["text Carlos I'm outside", undefined, "Carlos"],
  ])("%s", (text, given, want) => {
    expect(String(c(text, given)).toLowerCase()).toContain(want.toLowerCase());
  });
});

/**
 * W1 (2026-11-24, S26 in Costa Rica, UTC-6): the range for "¿qué tengo mañana?" was already right; only the words were
 * wrong (the reply copied UTC times). These keep the range local at the edge hours: 14:35, 23:30 (Wednesday in UTC),
 * and a zone ahead of UTC.
 */
describe("calendar_read and remind days at edge hours (W1)", () => {
  const at = (userText: string, now: number, timeZone: string) => ({ userText, now, timeZone });
  const cr = (local: string) => Date.parse(`${local}-06:00`);
  const CR = "America/Costa_Rica";
  // What the model might pass: today's afternoon.
  const model = { from: "2026-11-24T12:00:00", to: "2026-11-24T23:59:59" };

  test("mañana, hoy and el lunes at 14:35 and at 23:30", () => {
    for (const now of [cr("2026-11-24T14:35"), cr("2026-11-24T23:30")]) {
      expect(normalizeCalendarRead(model, at("¿qué tengo mañana?", now, CR)).args).toEqual({ from: "2026-11-25T00:00:00", to: "2026-11-25T23:59:59" });
      expect(normalizeCalendarRead({ from: "2026-11-25T00:00:00", to: "2026-11-25T23:59:59" }, at("¿qué tengo hoy?", now, CR)).args).toEqual({ from: "2026-11-24T00:00:00", to: "2026-11-24T23:59:59" });
      expect(normalizeCalendarRead(model, at("¿qué tengo el lunes?", now, CR)).args).toEqual({ from: "2026-11-30T00:00:00", to: "2026-11-30T23:59:59" });
    }
  });

  test("a zone ahead of UTC (Tokyo, 08:30 Tuesday, Monday in UTC)", () => {
    const now = Date.parse("2026-11-24T08:30+09:00");
    const monday = { from: "2026-11-23T00:00:00", to: "2026-11-23T23:59:59" };
    expect(normalizeCalendarRead(monday, at("what do I have tomorrow?", now, "Asia/Tokyo")).args).toEqual({ from: "2026-11-25T00:00:00", to: "2026-11-25T23:59:59" });
    expect(normalizeCalendarRead(monday, at("¿qué tengo hoy?", now, "Asia/Tokyo")).args).toEqual({ from: "2026-11-24T00:00:00", to: "2026-11-24T23:59:59" });
  });

  test("remind: mañana a las 9 from 23:30 is the local tomorrow; en 2 minutos is exact", () => {
    expect(normalizeRemind({ text: "llamar al banco", at: "2026-11-26T09:00:00" }, at("recuérdame mañana a las 9 llamar al banco", cr("2026-11-24T23:30"), CR)).args.at).toBe("2026-11-25T09:00:00");
    expect(normalizeRemind({ text: "tomar agua", at: "2026-11-24T14:35:00" }, at("recuérdame en 2 minutos tomar agua", cr("2026-11-24T14:35"), CR)).args.at).toBe("2026-11-24T14:37:00");
  });
});
