import type { EvalCase } from "./cases.ts";

// Held-out set, written blind to the harness and its prompts. Use it only to check generalization;
// never tune prompts, normalizers or routers against it.
// Fixed clock: Wednesday 2026-11-11, 21:00, America/Costa_Rica.
// Thu 12, Fri 13, Sat 14, Sun 15, Mon 16, Tue 17, next Wed 18.

const c = (id: string, lang: "es" | "en", input: string, expect: EvalCase["expect"], family: string): EvalCase => ({
  id,
  lang,
  input,
  expect,
  tags: [family],
});

export const HOLDOUT_CASES: readonly EvalCase[] = [
  // time: remind, Spanish
  c("ho-es-time-1", "es", "recuerdame manana a las 7 de la mañana sacar la basura", { choice: "remind", contains: { text: "basura", at: "2026-11-12T07:00" } }, "time"),
  c("ho-es-time-2", "es", "porfa avisame en una hora que apague el horno", { choice: "remind", contains: { text: "horno", at: "2026-11-11T22:00" } }, "time"),
  c("ho-es-time-3", "es", "se me va a olvidar llamar a mi mamá el domingo en la mañana a las 10, recuérdamelo", { choice: "remind", contains: { text: "mam", at: "2026-11-15T10:00" } }, "time"),
  c("ho-es-time-4", "es", "Recordame a las nueve y media de la noche tomar la pastilla", { choice: "remind", contains: { text: "pastilla", at: "2026-11-11T21:30" } }, "time"),
  c("ho-es-time-5", "es", "ahorita en 20 minutos recuérdame sacar la ropa de la lavadora", { choice: "remind", contains: { text: "ropa", at: "2026-11-11T21:20" } }, "time"),
  c("ho-es-time-6", "es", "el viernes a las 3 de la tarde avisame que tengo que pagar el alquiler", { choice: "remind", contains: { text: "alquiler", at: "2026-11-13T15:00" } }, "time"),
  c("ho-es-time-7", "es", "pasado mañana a las 8:15 am recuérdame llevar el carro al taller", { choice: "remind", contains: { text: "taller", at: "2026-11-13T08:15" } }, "time"),
  c("ho-es-time-8", "es", "che, acordate de avisarme el lunes a las 18 hs que compre el regalo de Sofi", { choice: "remind", contains: { text: "regalo", at: "2026-11-16T18:00" } }, "time"),
  c("ho-es-time-9", "es", "Mañana al mediodía recuérdame renovar el marchamo", { choice: "remind", contains: { text: "marchamo", at: "2026-11-12T12:00" } }, "time"),

  // time: remind, English
  c("ho-en-time-1", "en", "remind me at 9:45pm to take the chicken out of the freezer", { choice: "remind", contains: { text: "chicken", at: "2026-11-11T21:45" } }, "time"),
  c("ho-en-time-2", "en", "pls remind me in an hour and a half to call dad back", { choice: "remind", contains: { text: "dad", at: "2026-11-11T22:30" } }, "time"),
  c("ho-en-time-3", "en", "half past 8 tomorrow morning, remind me to send the invoice", { choice: "remind", contains: { text: "invoice", at: "2026-11-12T08:30" } }, "time"),
  c("ho-en-time-4", "en", "I keep forgetting to water the plants. can you ping me saturday at 9am?", { choice: "remind", contains: { text: "plants", at: "2026-11-14T09:00" } }, "time"),
  c("ho-en-time-5", "en", "the day after tomorrow at 10am remind me about the dentist", { choice: "remind", contains: { text: "dentist", at: "2026-11-13T10:00" } }, "time"),
  c("ho-en-time-6", "en", "set a reminder for 6:30 tomorrow evening: pick up the dry cleaning", { choice: "remind", contains: { text: "dry cleaning", at: "2026-11-12T18:30" } }, "time"),
  c("ho-en-time-7", "en", "nudge me at 23:00 to lock the back door", { choice: "remind", contains: { text: "door", at: "2026-11-11T23:00" } }, "time"),
  c("ho-en-time-8", "en", "on tuesday at noon remind me to renew my passport", { choice: "remind", contains: { text: "passport", at: "2026-11-17T12:00" } }, "time"),
  c("ho-en-time-9", "en", "remind me in 10 minutes to text Jess", { choice: "remind", contains: { text: "jess", at: "2026-11-11T21:10" } }, "time"),

  // memory, Spanish
  c("ho-es-memory-1", "es", "acordate que calzo 42", { choice: "remember", contains: { fact: "42" } }, "memory"),
  c("ho-es-memory-2", "es", "anotá que el código del portón es 4471", { choice: "remember", contains: { fact: "4471" } }, "memory"),
  c("ho-es-memory-3", "es", "guardame que el cumple de mi suegra es el 3 de marzo", { choice: "remember", contains: { fact: "suegra" } }, "memory"),
  c("ho-es-memory-4", "es", "cual era la clave del wifi de la casa?", { choice: "recall", contains: { query: "wifi" } }, "memory"),
  c("ho-es-memory-5", "es", "dónde dejé el pasaporte?", { choice: "recall", contains: { query: "pasaporte" } }, "memory"),
  c("ho-es-memory-6", "es", "¿qué número de cédula tiene mi hijo?", { choice: "recall", contains: { query: "hijo" } }, "memory"),
  c("ho-es-memory-7", "es", "borrá lo que te dije del portón", { choice: "forget", contains: { query: "port" } }, "memory"),
  c("ho-es-memory-8", "es", "oye y cuánto calza Mateo?", { choice: "recall", contains: { query: "mateo" } }, "memory"),
  c("ho-es-memory-9", "es", "el carro quedó parqueado en el nivel 3 del mall, no se me vaya a olvidar", { choice: "remember", contains: { fact: "nivel 3" } }, "memory"),

  // memory, English
  c("ho-en-memory-1", "en", "remember that my blood type is O negative", { choice: "remember", contains: { fact: "o negative" } }, "memory"),
  c("ho-en-memory-2", "en", "fyi the spare key is under the blue flowerpot, keep that somewhere", { choice: "remember", contains: { fact: "flowerpot" } }, "memory"),
  c("ho-en-memory-3", "en", "whats my frequent flyer number again", { choice: "recall", contains: { query: "frequent flyer" } }, "memory"),
  c("ho-en-memory-4", "en", "when is Priya's birthday?", { choice: "recall", contains: { query: "priya" } }, "memory"),
  c("ho-en-memory-5", "en", "forget my old gym locker combo", { choice: "forget", contains: { query: "locker" } }, "memory"),
  c("ho-en-memory-6", "en", "where did i put the car title", { choice: "recall", contains: { query: "title" } }, "memory"),
  c("ho-en-memory-7", "en", "gimme my insurance policy number", { choice: "recall", contains: { query: "insurance" } }, "memory"),
  c("ho-en-memory-8", "en", "my landlord's name is Mr. Okafor, save that", { choice: "remember", contains: { fact: "okafor" } }, "memory"),
  c("ho-en-memory-9", "en", "delete the note with my ex's address", { choice: "forget", contains: { query: "address" } }, "memory"),

  // calendar, Spanish
  c("ho-es-calendar-1", "es", "qué tengo mañana?", { choice: "calendar_read", contains: { from: "2026-11-12" } }, "calendar"),
  c("ho-es-calendar-2", "es", "tengo algo el sábado?", { choice: "calendar_read", contains: { from: "2026-11-14" } }, "calendar"),
  c("ho-es-calendar-3", "es", "agendá reunión con el contador el viernes de 3 a 4:30", { choice: "calendar_add", contains: { title: "contador", start: "2026-11-13T15:00" } }, "calendar"),
  c("ho-es-calendar-4", "es", "méteme en el calendario cena con los Rojas el sábado a las 7 de la noche", { choice: "calendar_add", contains: { title: "rojas", start: "2026-11-14T19:00" } }, "calendar"),
  c("ho-es-calendar-5", "es", "cómo tengo la agenda la otra semana?", { choice: "calendar_read" }, "calendar"),
  c("ho-es-calendar-6", "es", "pon en mi calendario dentista el martes a las 9:30 am", { choice: "calendar_add", contains: { title: "dentista", start: "2026-11-17T09:30" } }, "calendar"),
  c("ho-es-calendar-7", "es", "estoy libre el lunes en la tarde?", { choice: "calendar_read", contains: { from: "2026-11-16" } }, "calendar"),

  // calendar, English
  c("ho-en-calendar-1", "en", "what's on my calendar for friday", { choice: "calendar_read", contains: { from: "2026-11-13" } }, "calendar"),
  c("ho-en-calendar-2", "en", "anything left tonight?", { choice: "calendar_read", contains: { from: "2026-11-11" } }, "calendar"),
  c("ho-en-calendar-3", "en", "add yoga thursday 6-7am", { choice: "calendar_add", contains: { title: "yoga", start: "2026-11-12T06:00" } }, "calendar"),
  c("ho-en-calendar-4", "en", "block 2 to 3pm on monday for the quarterly review", { choice: "calendar_add", contains: { title: "quarterly", start: "2026-11-16T14:00" } }, "calendar"),
  c("ho-en-calendar-5", "en", "put lunch w/ Marco on my cal, sunday 12:30", { choice: "calendar_add", contains: { title: "marco", start: "2026-11-15T12:30" } }, "calendar"),
  c("ho-en-calendar-6", "en", "am I busy next wednesday?", { choice: "calendar_read", contains: { from: "2026-11-18" } }, "calendar"),
  c("ho-en-calendar-7", "en", "schedule a call with the bank tomorrow from 10 to 10:30", { choice: "calendar_add", contains: { title: "bank", start: "2026-11-12T10:00" } }, "calendar"),

  // messaging, Spanish
  c("ho-es-messaging-1", "es", "qué me escribió mi hermana?", { choice: "read_messages", contains: { contact: "hermana" } }, "messaging"),
  c("ho-es-messaging-2", "es", "léeme los mensajes de whatsapp", { choice: "read_messages" }, "messaging"),
  c("ho-es-messaging-3", "es", "respóndele a Don Carlos que mañana le paso la plata", { choice: "read_messages", contains: { contact: "carlos" } }, "messaging"),
  c("ho-es-messaging-4", "es", "decile a la Vale que llego tarde", { choice: "read_messages", contains: { contact: "vale" } }, "messaging"),
  c("ho-es-messaging-5", "es", "tengo mensajes nuevos?", { choice: "read_messages" }, "messaging"),
  c("ho-es-messaging-6", "es", "pásame lo último que mandaron en el grupo de la oficina", { choice: "read_messages", contains: { contact: "oficina" } }, "messaging"),

  // messaging, English
  c("ho-en-messaging-1", "en", "any new texts from Mike?", { choice: "read_messages", contains: { contact: "mike" } }, "messaging"),
  c("ho-en-messaging-2", "en", "tell Jordan I'm running 10 min late", { choice: "read_messages", contains: { contact: "jordan" } }, "messaging"),
  c("ho-en-messaging-3", "en", "read me my whatsapps", { choice: "read_messages" }, "messaging"),
  c("ho-en-messaging-4", "en", "reply to mom saying i'll call her tomorrow", { choice: "read_messages", contains: { contact: "mom" } }, "messaging"),
  c("ho-en-messaging-5", "en", "did Hannah answer me yet?", { choice: "read_messages", contains: { contact: "hannah" } }, "messaging"),
  c("ho-en-messaging-6", "en", "let Raj know the meeting moved to 4", { choice: "read_messages", contains: { contact: "raj" } }, "messaging"),

  // ask: a skill fits but the essentials are missing
  c("ho-es-ask-1", "es", "recuérdame algo", { choice: "ask_user" }, "ask"),
  c("ho-es-ask-2", "es", "avisame mañana porfa", { choice: "ask_user" }, "ask"),
  c("ho-es-ask-3", "es", "agrega un evento", { choice: "ask_user" }, "ask"),
  c("ho-es-ask-4", "es", "guarda un dato", { choice: "ask_user" }, "ask"),
  c("ho-es-ask-5", "es", "recordame a las 5", { choice: "ask_user" }, "ask"),
  c("ho-en-ask-1", "en", "remind me", { choice: "ask_user" }, "ask"),
  c("ho-en-ask-2", "en", "add something to my calendar for friday", { choice: "ask_user" }, "ask"),
  c("ho-en-ask-3", "en", "save something for me", { choice: "ask_user" }, "ask"),
  c("ho-en-ask-4", "en", "set a reminder for tomorrow", { choice: "ask_user" }, "ask"),
  c("ho-en-ask-5", "en", "create a calendar event pls", { choice: "ask_user" }, "ask"),

  // decline: no skill can do it, answer in words
  c("ho-es-decline-1", "es", "pedime un uber al aeropuerto", { choice: "respond" }, "decline"),
  c("ho-es-decline-2", "es", "llamá a mi mamá", { choice: "respond" }, "decline"),
  c("ho-es-decline-3", "es", "a cuánto está el dólar hoy?", { choice: "respond" }, "decline"),
  c("ho-es-decline-4", "es", "reservame mesa para dos en el Sikwa el sábado", { choice: "respond" }, "decline"),
  c("ho-es-decline-5", "es", "va a llover mañana en San José?", { choice: "respond" }, "decline"),
  c("ho-en-decline-1", "en", "order me a large pepperoni pizza", { choice: "respond" }, "decline"),
  c("ho-en-decline-2", "en", "pay my electric bill", { choice: "respond" }, "decline"),
  c("ho-en-decline-3", "en", "what's the weather gonna be like tomorrow", { choice: "respond" }, "decline"),
  c("ho-en-decline-4", "en", "book me a flight to Miami for next friday", { choice: "respond" }, "decline"),
  c("ho-en-decline-5", "en", "who won the world cup in 2022?", { choice: "respond" }, "decline"),

  // chat
  c("ho-es-chat-1", "es", "gracias, sos un crack", { choice: "respond" }, "chat"),
  c("ho-es-chat-2", "es", "jaja qué buena onda", { choice: "respond" }, "chat"),
  c("ho-es-chat-3", "es", "buenas noches hermit", { choice: "respond" }, "chat"),
  c("ho-es-chat-4", "es", "estoy cansadísimo hoy", { choice: "respond" }, "chat"),
  c("ho-en-chat-1", "en", "thanks!!", { choice: "respond" }, "chat"),
  c("ho-en-chat-2", "en", "hey what can you do?", { choice: "respond" }, "chat"),
  c("ho-en-chat-3", "en", "lol ok", { choice: "respond" }, "chat"),
  c("ho-en-chat-4", "en", "good morning!", { choice: "respond" }, "chat"),
];

/*
Borderline cases (kept, but a reasonable assistant could argue another choice):

- ho-es-time-6: "pagar el alquiler" mentions paying, but the request is a reminder, so remind (not decline).
- ho-en-time-9: "text Jess" mentions messaging, but the request is a reminder in 10 minutes, so remind.
- ho-es-memory-5 / ho-en-memory-6: "where did I leave/put X" is a recall of a saved fact; a model may chat instead.
- ho-es-memory-9: stated as "no se me vaya a olvidar" (indirect); remember is expected, remind is a plausible miss.
- ho-es-calendar-5: "la otra semana" is next week; only the choice is asserted because the range start (Sun 15 or Mon 16) varies.
- ho-es-calendar-7 / ho-en-calendar-2: availability questions; only `from` is asserted.
- ho-en-calendar-7: "schedule a call" is a calendar event, not a phone call, so calendar_add (not decline).
- ho-es-messaging-6: a group, not a person, as the contact filter; asserted "oficina".
- ho-es-ask-2: "avisame mañana" gives a day but no what and no hour, so ask_user.
- ho-es-ask-4 / ho-en-ask-3: "guarda un dato" / "save something" with no content; ask_user.
- ho-es-ask-5: "a las 5" with no what (and am/pm unclear), so ask_user.
- ho-en-ask-2: has a day (friday) but no title or time, so ask_user.
- ho-es-decline-2: "llamá a mi mamá" is a phone call, no skill; respond (not read_messages).
- ho-en-calendar-6 / ho-en-time-8: "next wednesday" read as 2026-11-18 (the coming Wednesday); "on tuesday" as 2026-11-17.
*/
