import { describe, expect, test } from "vitest";
import { buildIntent, emailsIn, phonesIn, phoneFromUser, emailFromUser, INTENT_ACTIONS } from "../src/intents.ts";

describe("phone numbers and email addresses in the user's own words (FR-APP-02)", () => {
  test("finds phone numbers as written, with or without a country code", () => {
    expect(phonesIn("mándale un WhatsApp al +506 8888-1234 que ya voy")).toEqual(["+50688881234"]);
    expect(phonesIn("text 8888 1234 and (555) 010-9999")).toEqual(["88881234", "5550109999"]);
  });

  test("times, dates, short numbers and amounts are not phone numbers", () => {
    expect(phonesIn("wake me at 6:30 on 2026-11-14, it's 12 degrees, gate code 4589")).toEqual([]);
  });

  test("finds email addresses, lowercased", () => {
    expect(emailsIn("escríbele a Ana.Mora@Example.com y a pedro@example.org")).toEqual(["ana.mora@example.com", "pedro@example.org"]);
  });

  test("a model number counts only when the user wrote those exact digits this turn", () => {
    expect(phoneFromUser("+506 8888 1234", "call +506 8888 1234")).toBe("+50688881234");
    expect(phoneFromUser("88881234", "llama al 8888-1234")).toBe("88881234");
    // Copied from a message the user never typed.
    expect(phoneFromUser("+1 555 010 7777", "call the number in Ana's message")).toBeUndefined();
    // A country code the model added is a guess: the user's digits must match exactly.
    expect(phoneFromUser("+506 8888 1234", "llama al 8888 1234")).toBeUndefined();
  });

  test("an email counts only when the user wrote it this turn", () => {
    expect(emailFromUser("Ana@example.com", "email ana@example.com the notes")).toBe("ana@example.com");
    expect(emailFromUser("boss@evil.example", "email my boss the notes")).toBeUndefined();
  });
});

describe("buildIntent (FR-APP-01): every intent only opens another app prefilled", () => {
  test("open_whatsapp_chat uses wa.me with the text, number without the plus", () => {
    expect(buildIntent("open_whatsapp_chat", { phone: "+50688881234", text: "Voy en camino & llego pronto" })).toEqual({
      action: "android.intent.action.VIEW",
      data: "https://wa.me/50688881234?text=Voy%20en%20camino%20%26%20llego%20pronto",
    });
  });

  test("open_whatsapp_chat without a number lets the person pick the chat in WhatsApp", () => {
    expect(buildIntent("open_whatsapp_chat", { text: "hola" })?.data).toBe("https://wa.me/?text=hola");
  });

  test("compose_sms uses SENDTO smsto with the body, so nothing is sent", () => {
    expect(buildIntent("compose_sms", { phone: "88881234", body: "Ya voy" })).toEqual({
      action: "android.intent.action.SENDTO",
      data: "smsto:88881234",
      extras: { sms_body: "Ya voy" },
    });
    expect(buildIntent("compose_sms", { body: "Ya voy" })?.data).toBe("smsto:");
  });

  test("compose_email uses SENDTO mailto with recipients, subject and body in the address and the extras", () => {
    expect(buildIntent("compose_email", { to: "ana@example.com, pedro@example.org", subject: "Notas", body: "Hola Ana" })).toEqual({
      action: "android.intent.action.SENDTO",
      data: "mailto:ana@example.com,pedro@example.org?subject=Notas&body=Hola%20Ana",
      extras: { "android.intent.extra.EMAIL": ["ana@example.com", "pedro@example.org"], "android.intent.extra.SUBJECT": "Notas", "android.intent.extra.TEXT": "Hola Ana" },
    });
    expect(buildIntent("compose_email", { body: "Hola" })?.data).toBe("mailto:?body=Hola");
  });

  test("dial uses ACTION_DIAL (never ACTION_CALL)", () => {
    expect(buildIntent("dial", { phone: "+50688881234" })).toEqual({ action: "android.intent.action.DIAL", data: "tel:+50688881234" });
    expect(buildIntent("dial", {})).toEqual({ action: "android.intent.action.DIAL" });
  });

  test("navigate opens any maps app on the destination", () => {
    expect(buildIntent("navigate", { destination: "Clínica Dental Mora, San José" })).toEqual({
      action: "android.intent.action.VIEW",
      data: "geo:0,0?q=Cl%C3%ADnica%20Dental%20Mora%2C%20San%20Jos%C3%A9",
    });
  });

  test("share opens the share sheet with the text", () => {
    expect(buildIntent("share", { text: "https://example.com/menu" })).toEqual({
      action: "android.intent.action.SEND",
      type: "text/plain",
      extras: { "android.intent.extra.TEXT": "https://example.com/menu" },
      chooser: true,
    });
  });

  test("set_alarm shows the clock app's own screen (SKIP_UI false) with hour and minutes as integers", () => {
    expect(buildIntent("set_alarm", { time: "06:05", label: "Gym" })).toEqual({
      action: "android.intent.action.SET_ALARM",
      extras: { "android.intent.extra.alarm.MESSAGE": "Gym", "android.intent.extra.alarm.SKIP_UI": false },
      intExtras: { "android.intent.extra.alarm.HOUR": 6, "android.intent.extra.alarm.MINUTES": 5 },
    });
    expect(buildIntent("set_alarm", { time: "7:30" })?.intExtras).toEqual({ "android.intent.extra.alarm.HOUR": 7, "android.intent.extra.alarm.MINUTES": 30 });
    expect(buildIntent("set_alarm", { time: "25:00" })).toBeUndefined();
    expect(buildIntent("set_alarm", { time: "six" })).toBeUndefined();
  });

  test("add_contact opens the contacts app's insert screen; the person saves it", () => {
    expect(buildIntent("add_contact", { name: "Ana (trabajo)", phone: "+50688881234", email: "ana@example.com" })).toEqual({
      action: "android.intent.action.INSERT",
      type: "vnd.android.cursor.dir/raw_contact",
      extras: { name: "Ana (trabajo)", phone: "+50688881234", email: "ana@example.com", finishActivityOnSaveCompleted: true },
    });
  });

  test("unknown skills build nothing, and every action is on the allow-list", () => {
    expect(buildIntent("reply_message", { text: "x" })).toBeUndefined();
    const all = [
      buildIntent("open_whatsapp_chat", { text: "a" }), buildIntent("compose_sms", { body: "a" }), buildIntent("compose_email", { body: "a" }),
      buildIntent("dial", {}), buildIntent("navigate", { destination: "a" }), buildIntent("share", { text: "a" }),
      buildIntent("set_alarm", { time: "06:00" }), buildIntent("add_contact", { name: "a" }),
    ];
    for (const spec of all) expect(INTENT_ACTIONS).toContain(spec!.action);
    expect(INTENT_ACTIONS).not.toContain("android.intent.action.CALL");
  });
});
