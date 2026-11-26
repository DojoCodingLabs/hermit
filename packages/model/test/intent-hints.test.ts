import { describe, expect, test, vi } from "vitest";
import { connectSkill, firstWinSkills, intentSkills, payDef, payMerchantDef, webSkills } from "@hermit/skills";
import { narrowMenu, routeIntent } from "../src/intent-hints.ts";

const ids = (text: string) => narrowMenu(text, firstWinSkills).map((s) => s.id);

describe("intent hints narrow the menu, never widen it", () => {
  test.each([
    ["recuérdame comprar pan mañana a las 7", ["remind"]],
    ["recuerdame llamar a mama a las 9 de la noche", ["remind"]],
    ["avísame en 2 horas", ["remind"]],
    ["remind me to call Ana at 5", ["remind"]],
    ["recuerda que mi pasaporte vence en marzo", ["remember"]],
    ["remember that the wifi is on the fridge", ["remember"]],
    ["olvida lo del pasaporte", ["forget"]],
    ["dile a Ana que voy tarde", ["read_messages", "reply_message"]],
    ["¿Ana me escribió?", ["read_messages"]],
    ["¿qué tengo mañana?", ["calendar_read"]],
  ])("%s", (text, expected) => {
    expect(ids(text).sort()).toEqual([...expected].sort());
  });

  test("no hint keeps the full menu", () => {
    expect(ids("hola")).toHaveLength(firstWinSkills.length);
  });

  test("a hint for a skill that isn't offered falls back to what is offered", () => {
    const onlyRecall = firstWinSkills.filter((s) => s.id === "recall");
    expect(narrowMenu("recuérdame algo", onlyRecall).map((s) => s.id)).toEqual(["recall"]);
  });

  test.each([
    ["pon en mi calendario almuerzo con Sofía mañana de 12 a 1", ["calendar_add"], true],
    ["schedule a call with the bank on Friday at 9am", ["calendar_add"], true],
    ["agenda una reunión", ["calendar_add"], false],
    ["respóndele a Carla que sí voy", ["read_messages", "reply_message"], true],
    ["¿qué código tenía la puerta?", ["recall"], true],
    ["what was the gate code again?", ["recall"], true],
    ["what am I allergic to?", ["recall"], true],
    ["recuérdame algo mañana", ["remind"], false],
    ["don't let me forget the doctor's appointment tomorrow at 3pm", ["remind"], true],
    ["mándale un mensaje", ["read_messages"], false],
    // review findings 2 and 3: "tell me" is not a reply; "don't forget to" is not a deletion
    ["tell me what Ana said", ["read_messages"], true],
    ["let me know if Pedro wrote", ["read_messages"], true],
    ["don't forget to buy milk at 5pm", ["remind"], true],
    ["no te olvides de llamar a mamá a las 6", ["remind"], true],
    ["let Dr. Patel know I need to move my appointment", ["read_messages", "reply_message"], true],
    ["send grandma a message that we're on our way", ["read_messages", "reply_message"], true],
    ["msg priya: running late", ["read_messages", "reply_message"], true],
    ["can you see if my sister answered", ["read_messages"], true],
    ["revisa el grupo de la familia", ["read_messages"], true],
    ["recordame cual es la placa de mi carro", ["recall"], true],
    ["¿qué recordatorios tengo?", ["reminders_list"], true],
    ["what reminders do I have tomorrow", ["reminders_list"], true],
    ["cancela el recordatorio de las 9", ["reminder_cancel"], true],
    ["ya no me recuerdes lo del banco", ["reminder_cancel"], true],
    ["cancel my 9 o'clock reminder", ["reminder_cancel"], true],
    ["pon un recordatorio", ["remind"], false],
    ["remind me what my frequent flyer number is", ["recall"], true],
    ["cual es el pin de mi tarjeta del banco", ["recall"], true],
    ["how do i take my coffee?", ["recall"], true],
    ["when's our anniversary", ["recall"], true],
    ["delete the thing about my parking spot", ["forget"], true],
    ["what's the capital of my country Costa Rica", firstWinSkills.map((s) => s.id as string), false],
    ["what can you do?", firstWinSkills.map((s) => s.id as string), false],
  ])("route: %s", (text, skills, force) => {
    const r = routeIntent(text, firstWinSkills);
    expect(r.skills.map((s) => s.id).sort()).toEqual([...skills].sort());
    expect(r.force).toBe(force);
  });

  test.each([
    ["llama a mi mamá", true],
    ["cómprame unos audífonos", true],
    ["order me a pizza", true],
    ["will it rain tomorrow", true],
    ["recuérdame llamar a mamá a las 6", false],
    ["remind me to buy milk at 5pm", false],
    ["hola", false],
  ])("out of scope: %s", (text, out) => {
    expect(!!routeIntent(text, firstWinSkills).outOfScope).toBe(out);
  });
});

describe("a link routes to read_web (US-WEB-01)", () => {
  const all = [...firstWinSkills, ...webSkills];
  test.each([
    "¿qué dice https://example.com/refunds sobre reembolsos?",
    "what does this say about refunds? https://shop.example.com/help",
    "resúmeme www.example.com/blog/post",
    "read https://example.com and tell me what my options are",
  ])("%s", (text) => {
    expect(routeIntent(text, all)).toMatchObject({ skills: [{ id: "read_web" }], force: true });
  });

  test("a link inside a reminder or a reply stays that request", () => {
    expect(routeIntent("recuérdame mañana a las 9 leer https://example.com/a", all).skills.map((s) => s.id)).toEqual(["remind"]);
    expect(routeIntent("dile a Ana que lea https://example.com/a", all).skills.map((s) => s.id).sort()).toEqual(["read_messages", "reply_message"]);
  });

  test("without read_web on the menu, a link changes nothing", () => {
    expect(routeIntent("what does https://example.com say?", firstWinSkills).skills).toHaveLength(firstWinSkills.length);
  });
});

describe("asking to search, or for current facts, offers search_web (US-WEB-03)", () => {
  const all = [...firstWinSkills, ...webSkills];
  test.each([
    "busca en internet vuelos baratos a Lima",
    "búscame en google el horario del museo de oro",
    "googlea quién ganó el partido",
    "search the web for the best pupusas in San José",
    "look up the opening hours of the national museum online",
  ])("an explicit search is forced: %s", (text) => {
    expect(routeIntent(text, all)).toMatchObject({ skills: [{ id: "search_web" }], force: true });
  });

  test.each([
    "¿va a llover mañana en Lima?",
    "what's the weather in Bogotá tomorrow?",
    "¿cuáles son las noticias de hoy?",
    "¿a cuánto está el dólar hoy?",
  ])("a current-facts question is offered search, unforced, so the model decides: %s", (text) => {
    const r = routeIntent(text, all);
    expect(r.skills.map((s) => s.id)).toEqual(["search_web"]);
    expect(r.force).toBe(false);
    expect(r.outOfScope).toBeUndefined();
  });

  test("a link still goes to read_web; mail search and reminders stay theirs", () => {
    expect(routeIntent("busca en internet qué dice https://example.com/a", all).skills.map((s) => s.id)).toEqual(["read_web"]);
    expect(routeIntent("recuérdame mañana a las 9 buscar vuelos", all).skills.map((s) => s.id)).toEqual(["remind"]);
    expect(routeIntent("¿cuál es mi número de pasaporte?", all).skills.map((s) => s.id)).toEqual(["recall"]);
  });

  test("without search_web on the menu, weather stays out of scope", () => {
    expect(routeIntent("¿va a llover mañana en Lima?", firstWinSkills)).toMatchObject({ outOfScope: true });
  });
});

describe("clause planner (several requests in one message)", () => {
  test("one route per clause, in order; a single request stays one route", async () => {
    const { planIntents } = await import("../src/intent-hints.ts");
    const ids = (t: string) => planIntents(t, firstWinSkills).map((r) => r.skills.map((s) => s.id).join("+"));
    expect(ids("recuérdame mañana a las 9 llamar al banco y anota que mi cuenta es 1234")).toEqual(["remind", "remember"]);
    expect(ids("remind me at 5pm to call mom and also note that the gate code is 4589")).toEqual(["remind", "remember"]);
    expect(ids("recuérdame mañana a las 9 llamar al banco")).toEqual(["remind"]);
    expect(ids("¿qué me perdí?")).toEqual(["read_messages"]);
  });
});

describe("intent skills (SL-58): routed only when the app offers them", () => {
  const withIntents = [...firstWinSkills, ...intentSkills];
  const route = (text: string) => {
    const r = routeIntent(text, withIntents);
    return { skills: r.skills.map((s) => s.id as string).sort(), force: r.force };
  };

  test.each([
    ["mándale un WhatsApp al +506 8888 1234 que ya voy", ["open_whatsapp_chat"], true],
    ["text 8888 1234 on WhatsApp that I'm late", ["open_whatsapp_chat"], true],
    ["text Carlos on WhatsApp that I'm on my way", ["open_whatsapp_chat", "read_messages", "reply_message"], true],
    ["escríbele a Carlos por WhatsApp que ya voy", ["open_whatsapp_chat", "read_messages", "reply_message"], true],
    ["llama a mi mamá", ["dial"], true],
    ["call Mom", ["dial"], true],
    ["márcale al 8888 1234", ["dial"], true],
    ["wake me at 6", ["set_alarm"], true],
    ["pon una alarma a las 5:30", ["set_alarm"], true],
    ["ponme una alarma", ["set_alarm"], false],
    ["envíale un SMS al 8888 1234 que ya voy", ["compose_sms"], true],
    ["send a text message to 8888 1234 saying hi", ["compose_sms"], true],
    ["email ana@example.com the meeting notes", ["compose_email"], true],
    ["escríbele un correo a Ana con las notas", ["compose_email"], true],
    ["navigate to the dentist", ["navigate"], true],
    ["llévame al aeropuerto", ["navigate"], true],
    ["¿cómo llego al Mall San Pedro?", ["navigate"], true],
    ["share this: the party is at 8", ["share"], true],
    ["compártelo", ["share"], true],
    ["save this number as Ana's work: 8888 1234", ["add_contact"], true],
    ["guarda el 8888 1234 como Pedro", ["add_contact"], true],
    ["agrega a Ana a mis contactos", ["add_contact"], true],
  ])("%s", (text, skills, force) => {
    expect(route(text)).toEqual({ skills: [...skills].sort(), force });
  });

  test("the first-win routes stay as they were", () => {
    expect(route("recuérdame llamar a mamá a las 9").skills).toEqual(["remind"]);
    expect(route("remind me at 5 to call the bank").skills).toEqual(["remind"]);
    expect(route("dile a Ana que voy tarde").skills).toEqual(["read_messages", "reply_message"]);
    expect(route("¿qué me dijo Ana por WhatsApp?").skills).toEqual(["read_messages"]);
    expect(route("remember that the wifi is on the fridge").skills).toEqual(["remember"]);
    expect(route("what do you call a group of crows?").skills).toHaveLength(withIntents.length);
  });

  test("an alarm for a day after tomorrow is a reminder: the clock app only knows the next time that clock time comes", () => {
    vi.useFakeTimers();
    vi.setSystemTime(Date.UTC(2026, 10, 11, 15)); // Wednesday
    try {
      expect(route("pon una alarma el viernes a las 6").skills).toEqual(["remind"]);
      expect(route("set an alarm for tomorrow at 6").skills).toEqual(["set_alarm"]);
    } finally {
      vi.useRealTimers();
    }
  });

  test("without the intent skills on the menu nothing changes", () => {
    expect(ids("wake me up tomorrow at 6:45 for the bus")).toEqual(["remind"]);
    expect(routeIntent("llama a mi mamá", firstWinSkills).outOfScope).toBe(true);
    expect(ids("save this number as Ana's work: 8888 1234")).toEqual(["remember"]);
  });
});

describe("the alarm-or-reminder line is drawn on the phone's own day and clock (W1 review 3)", () => {
  const offered = [...firstWinSkills, ...intentSkills];
  const skills = (text: string, clock: { now: number; timeZone: string }) => routeIntent(text, offered, clock).skills.map((s) => s.id).sort();
  // Thursday 20:00 in Costa Rica is already Friday 02:00 in UTC.
  const thursdayEvening = { now: Date.parse("2026-11-26T20:00:00-06:00"), timeZone: "America/Costa_Rica" };

  test("'el viernes' at 20:00 on Thursday is tomorrow's alarm, not one a week away", () => {
    expect(skills("despiértame el viernes a las 7", thursdayEvening)).toEqual(["set_alarm"]);
    expect(skills("pon una alarma mañana a las 6", thursdayEvening)).toEqual(["set_alarm"]);
    expect(skills("wake me up on Friday at 7", thursdayEvening)).toEqual(["set_alarm"]);
  });

  test("two days on is still a reminder", () => {
    expect(skills("pon una alarma el sábado a las 7", thursdayEvening)).toEqual(["remind"]);
    expect(skills("pon una alarma pasado mañana a las 6", thursdayEvening)).toEqual(["remind"]);
  });

  test("a zone ahead of UTC: Friday 08:00 in Tokyo is still Thursday in UTC", () => {
    const fridayMorning = { now: Date.parse("2026-11-27T08:00:00+09:00"), timeZone: "Asia/Tokyo" };
    expect(skills("wake me up on Saturday at 7", fridayMorning)).toEqual(["set_alarm"]);
    expect(skills("pon una alarma el domingo a las 6", fridayMorning)).toEqual(["remind"]);
  });

  test("the port routes on the clock its context gives", async () => {
    const { createModelPort } = await import("../src/port.ts");
    const { profileById } = await import("../src/profile.ts");
    const picks: string[] = [];
    const e = { complete: async (req: { tools?: Array<{ name: string }> }) => (picks.push((req.tools ?? []).map((t) => t.name).join(",")), { text: "", toolCalls: [{ name: "set_alarm", arguments: { time: "07:00" } }] }) };
    const port = createModelPort(e as never, profileById("botpsy-q4-native-think256")!, offered, () => ({ language: "es-419", now: "Thursday, November 26, 2026, 20:00 local time", profile: [], clock: thursdayEvening }));
    const picked = await port.pick({ prefixCacheKey: "k", messages: [{ role: "user", content: "despiértame el viernes a las 7" }], menu: offered.map((s) => s.id) });
    expect(picked.choice).toBe("set_alarm");
    expect(picks[0]).toBe("set_alarm");
  });
});

describe("connect_service (SL-55): asking to connect a service routes to it, only when it is offered", () => {
  const all = [...firstWinSkills, ...webSkills, connectSkill];
  test.each([
    "connect to my gym's booking system",
    "Connect me to Todoist",
    "please connect hermit to https://docs.taskly.example.com/api",
    "conéctate a mi sistema de reservas del gimnasio",
    "conectate con Todoist",
    "vincula Hermit con mi app de facturas",
  ])("%s", (text) => {
    expect(routeIntent(text, all)).toMatchObject({ skills: [{ id: "connect_service" }], force: true });
  });

  test("other requests and questions stay as they were", () => {
    expect(routeIntent("my phone won't connect to wifi, why?", all).skills.map((s) => s.id)).not.toEqual(["connect_service"]);
    expect(routeIntent("read https://example.com and summarize it", all).skills.map((s) => s.id)).toEqual(["read_web"]);
    expect(routeIntent("connect to Todoist", [...firstWinSkills, ...webSkills]).skills.some((s) => s.id === "connect_service")).toBe(false);
  });
});

describe("SL-40: paying a person", () => {
  const all = [...firstWinSkills, payDef];
  test.each(["send Ana 20 dollars", "mándale 20 dólares a Ana", "págale a Carlos $5", "pay 0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed 5 usdt", "envíale 7 USD a mi mamá"])("%s is a payment, forced", (t) => {
    expect(routeIntent(t, all)).toMatchObject({ force: true });
    expect(routeIntent(t, all).skills.map((s) => s.id)).toEqual(["pay"]);
  });
  test.each(["¿cuánto le pagué a Ana?", "send Ana an email about the 20 dollars"])("%s is not routed to pay", (t) => {
    expect(routeIntent(t, all).skills.map((s) => s.id)).not.toEqual(["pay"]);
  });
  test("without pay on the menu, a payment isn't routed to it", () => {
    expect(routeIntent("send Ana 20 dollars", firstWinSkills).skills.map((s) => s.id)).not.toEqual(["pay"]);
  });
});

describe("SL-41: paying a site that asks for x402", () => {
  const all = [...firstWinSkills, ...webSkills, payDef, payMerchantDef];
  test.each([
    "pay for https://api.example.com/report",
    "buy access to https://news.example.com/article/1",
    "págale a https://api.example.com/datos",
    "compra el acceso a https://example.com/premium",
    "pay 0.01 dollars for https://api.example.com/report",
    "pay for it",
    "sí, págala",
  ])("%s buys the page, forced", (t) => {
    expect(routeIntent(t, all)).toMatchObject({ force: true });
    expect(routeIntent(t, all).skills.map((s) => s.id)).toEqual(["pay_merchant"]);
  });
  test.each(["read https://example.com and summarize it", "send Ana 20 dollars", "how much does https://example.com charge?", "send https://example.com to Ana"])(
    "%s is not routed to pay_merchant",
    (t) => {
      expect(routeIntent(t, all).skills.map((s) => s.id)).not.toEqual(["pay_merchant"]);
    },
  );
  test("without pay_merchant on the menu, a link with a paying verb is read, never paid", () => {
    expect(routeIntent("pay for https://api.example.com/report", [...firstWinSkills, ...webSkills, payDef]).skills.map((s) => s.id)).toEqual(["read_web"]);
  });
});
