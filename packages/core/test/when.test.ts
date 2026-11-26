import { describe, expect, test } from "vitest";
import { extractWhen } from "../src/when.ts";

// Wednesday 2026-11-11, 21:00 in Costa Rica (UTC-6).
const NOW = Date.UTC(2026, 10, 12, 3, 0);
const TZ = "America/Costa_Rica";
const w = (text: string) => extractWhen(text, NOW, TZ);

describe("extractWhen (Spanish and English, by code)", () => {
  test("absolute dates in both languages, the next time they come around", () => {
    // NOW is Wednesday 2026-11-11, 21:00 in Costa Rica.
    expect(w("el cumpleaños de mi mamá es el 20 de noviembre")).toMatchObject({ date: "2026-11-20", namedDay: true });
    expect(w("my mom's birthday is on November 20th")).toMatchObject({ date: "2026-11-20", namedDay: true });
    expect(w("the 3rd of January")).toMatchObject({ date: "2027-01-03" });
    expect(w("el 3 de enero a las 3")).toMatchObject({ date: "2027-01-03", time: "15:00" });
    expect(w("Nov 11 at 9 am")).toMatchObject({ date: "2026-11-11", time: "09:00" });
    expect(w("el 31 de febrero").date).toBeUndefined();
    expect(w("a las 9 de la mañana")).toMatchObject({ time: "09:00" });
    expect(w("a las 9 de la mañana").date).toBe("2026-11-12");
  });

  test.each([
    ["recuérdame llamar a mamá a las 9 de la noche", "2026-11-12", "21:00"], // said at exactly 21:00: next one
    ["a las 6 de la tarde tengo que sacar al perro", "2026-11-12", "18:00"], // 18:00 already passed today
    ["ponme un aviso mañana a las 8 para la reunión", "2026-11-12", "08:00"],
    ["necesito que me avises a las 7:30 para tomar la pastilla", "2026-11-12", "07:30"],
    ["ping me at 10 tonight to send the invoice", "2026-11-11", "22:00"],
    ["I have to call the bank at 9 tomorrow morning", "2026-11-12", "09:00"],
    ["nudge me at 3pm about the dentist", "2026-11-12", "15:00"],
    ["recuérdame mañana a las 7 de la mañana sacar la basura", "2026-11-12", "07:00"],
    ["avísame a las 11 de la noche que apague el horno", "2026-11-11", "23:00"],
    ["recuérdame el viernes a las 5 de la tarde pagar la luz", "2026-11-13", "17:00"],
    ["a las 10 y media de la noche recuérdame llamar a Luis", "2026-11-11", "22:30"],
    ["mañana al mediodía recuérdame comprar pan", "2026-11-12", "12:00"],
    ["recuérdame el lunes a las 9 la reunión con el contador", "2026-11-16", "09:00"],
    ["no me dejes olvidar mañana a las 3 de la tarde la cita", "2026-11-12", "15:00"],
    ["avísame mañana a las 6:45 para el bus", "2026-11-12", "06:45"],
    ["el sábado a las 8 de la mañana recuérdame regar las plantas", "2026-11-14", "08:00"],
    ["remind me Friday at 5pm to pay the electric bill", "2026-11-13", "17:00"],
    ["at 10:30 tonight remind me to call Luis", "2026-11-11", "22:30"],
    ["remind me tomorrow at noon to buy bread", "2026-11-12", "12:00"],
    ["wake me up tomorrow at 6:45 for the bus", "2026-11-12", "06:45"],
    ["mañana a las 3", "2026-11-12", "15:00"],
    ["a las 10", "2026-11-11", "22:00"],
    ["a las 8 menos cuarto", "2026-11-12", "07:45"],
    // number words, half past, evening after the time, 24-hour clock
    ["recuérdame a las nueve y media de la noche", "2026-11-11", "21:30"],
    ["half past 8 tomorrow morning, remind me", "2026-11-12", "08:30"],
    ["set a reminder for 6:30 tomorrow evening", "2026-11-12", "18:30"],
    ["a las 21:30 avísame", "2026-11-11", "21:30"],
    ["quarter to 9 tomorrow", "2026-11-12", "08:45"],
  ])("%s", (text, date, time) => {
    expect(w(text)).toMatchObject({ date, time });
  });

  test("review findings 4 to 6: the right number, midnight, quarter to one, ranges past midnight", () => {
    expect(w("Recuérdame mañana comprar las dos cosas a las 9")).toMatchObject({ date: "2026-11-12", time: "09:00" });
    expect(w("remind me to take 2 to 3 pills tomorrow at 8am")).toMatchObject({ date: "2026-11-12", time: "08:00" });
    expect(w("hacerlo de una vez mañana")).toEqual({ date: "2026-11-12", namedDay: true });
    expect(w("recuérdame a las 12 de la noche")).toMatchObject({ date: "2026-11-12", time: "00:00" });
    expect(w("tonight at 12 remind me")).toMatchObject({ date: "2026-11-12", time: "00:00" });
    expect(w("mañana a la una menos cuarto")).toMatchObject({ date: "2026-11-12", time: "12:45" });
    expect(w("mañana a la una")).toMatchObject({ date: "2026-11-12", time: "13:00" });
    expect(w("agenda cena de 10pm a 1am")).toMatchObject({ time: "22:00", endTime: "01:00", endNextDay: true });
  });

  test("ranges", () => {
    expect(w("agenda dentista el viernes de 10 a 11")).toMatchObject({ date: "2026-11-13", time: "10:00", endTime: "11:00" });
    expect(w("put lunch with Carlos on Thursday from 1 to 2pm")).toMatchObject({ date: "2026-11-12", time: "13:00", endTime: "14:00" });
    expect(w("almuerzo con Sofía mañana de 12 a 1")).toMatchObject({ date: "2026-11-12", time: "12:00", endTime: "13:00" });
    expect(w("gimnasio el sábado de 7 a 8 de la mañana")).toMatchObject({ date: "2026-11-14", time: "07:00", endTime: "08:00" });
    expect(w("add yoga thursday 6-7am")).toMatchObject({ date: "2026-11-12", time: "06:00", endTime: "07:00" });
    expect(w("block 2 to 3pm on monday")).toMatchObject({ date: "2026-11-16", time: "14:00", endTime: "15:00" });
    expect(w("reunión el viernes de 3 a 4:30 de la tarde")).toMatchObject({ date: "2026-11-13", time: "15:00", endTime: "16:30" });
  });

  test("days without times, relative times, and nothing", () => {
    expect(w("¿qué tengo el lunes?")).toEqual({ date: "2026-11-16", namedDay: true });
    expect(w("what's on my schedule tomorrow?")).toEqual({ date: "2026-11-12", namedDay: true });
    expect(w("¿qué tengo el miércoles?").date).toBe("2026-11-18"); // today's weekday means next week
    expect(w("recuérdame en 2 horas sacar la ropa").at).toBe(NOW + 2 * 3_600_000);
    expect(w("in 30 minutes remind me").at).toBe(NOW + 30 * 60_000);
    expect(w("pls remind me in an hour and a half").at).toBe(NOW + 90 * 60_000);
    expect(w("avísame en una hora y media").at).toBe(NOW + 90 * 60_000);
    for (const t of ["la clave del wifi es tortuga123", "mi placa es BCD-123", "el código es 4589", "my car is on level 3", "hola"]) {
      expect(w(t), t).toEqual({ namedDay: false });
    }
    // A date inside a fact is a date, never a time.
    expect(w("el cumpleaños de mi mamá es el 4 de mayo")).toEqual({ date: "2027-05-04", namedDay: true });
  });
});

/**
 * W1 (2026-11-24): "¿qué tengo mañana?" was answered "Tarde de 24 de noviembre" on the S26 (UTC-6). The day words are
 * read in the phone's zone, never in UTC, also at the edge hours: 14:35 (the session) and 23:30 (already the next day
 * in UTC), and in a zone ahead of UTC (still yesterday in UTC).
 */
describe("named days resolve in local time at edge hours (W1)", () => {
  const cr = (local: string) => Date.parse(`${local}-06:00`);
  const cases: Array<[string, number, string, Record<string, string>]> = [
    ["Costa Rica 14:35 Tuesday", cr("2026-11-24T14:35"), "America/Costa_Rica", { "¿qué tengo mañana?": "2026-11-25", "¿qué tengo hoy?": "2026-11-24", "¿qué tengo el lunes?": "2026-11-30", "¿y pasado mañana?": "2026-11-26", "what do I have tomorrow?": "2026-11-25", "anything on Wednesday?": "2026-11-25", "¿qué tengo el martes?": "2026-12-01" }],
    ["Costa Rica 23:30 Tuesday (Wednesday in UTC)", cr("2026-11-24T23:30"), "America/Costa_Rica", { "¿qué tengo mañana?": "2026-11-25", "¿qué tengo hoy?": "2026-11-24", "¿qué tengo el lunes?": "2026-11-30", "¿qué tengo el miércoles?": "2026-11-25", "¿y pasado mañana?": "2026-11-26", "what's on my schedule today?": "2026-11-24" }],
    ["Tokyo 08:30 Tuesday (Monday in UTC)", Date.parse("2026-11-24T08:30+09:00"), "Asia/Tokyo", { "¿qué tengo mañana?": "2026-11-25", "¿qué tengo hoy?": "2026-11-24", "¿qué tengo el lunes?": "2026-11-30", "what do I have on Tuesday?": "2026-12-01", "¿qué tengo el miércoles?": "2026-11-25" }],
  ];
  for (const [name, now, zone, expected] of cases) {
    test(name, () => {
      for (const [text, date] of Object.entries(expected)) expect(extractWhen(text, now, zone), text).toEqual({ date, namedDay: true });
    });
  }

  test("a time with the day stays on the local day (mañana a las 9 from 23:30)", () => {
    expect(extractWhen("recuérdame mañana a las 9 llamar al banco", cr("2026-11-24T23:30"), "America/Costa_Rica")).toMatchObject({ date: "2026-11-25", time: "09:00" });
    expect(extractWhen("recuérdame a las 9 llamar al banco", cr("2026-11-24T23:30"), "America/Costa_Rica")).toMatchObject({ date: "2026-11-25", time: "09:00" });
  });
});
