import type { EvalCase } from "./cases.ts";

/**
 * The original blind held-out set. Written without reading the harness, the skills, the prompts or the
 * other case files, so it measured generalization rather than fit. It is published now, so it no longer
 * counts as blind; new blind sets are kept outside the public repository (docs/evals.md).
 * Fixed clock: Wednesday 2026-11-11 21:00, America/Costa_Rica.
 * Mix: time 20, memory 20, calendar 16, messaging 14, ask 10, decline 12, chat 8 (50 es, 50 en).
 */
export const HOLDOUT2_CASES: readonly EvalCase[] = [
  // ---------------------------------------------------------------- es / time
  { id: "h2-es-time-1", lang: "es", input: "a las 6:15 de la mañana recuerdame sacar la basura", expect: { choice: "remind", contains: { at: "2026-11-12T06:15" } }, tags: ["time"] },
  { id: "h2-es-time-2", lang: "es", input: "avisame en 2 horas q saque la ropa de la lavadora", expect: { choice: "remind", contains: { at: "2026-11-11T23:00" } }, tags: ["time"] },
  { id: "h2-es-time-3", lang: "es", input: "ojala no se me olvide pagar la luz el viernes a las 10 de la mañana", expect: { choice: "remind", contains: { at: "2026-11-13T10:00" } }, tags: ["time"] },
  { id: "h2-es-time-4", lang: "es", input: "pana recuérdame el lunes a las 3 de la tarde llamar al seguro", expect: { choice: "remind", contains: { at: "2026-11-16T15:00" } }, tags: ["time"] },
  { id: "h2-es-time-5", lang: "es", input: "recuerdame a las 9 y media de la noche cerrar el porton", expect: { choice: "remind", contains: { at: "2026-11-11T21:30" } }, tags: ["time"] },
  { id: "h2-es-time-6", lang: "es", input: "eh recuerdame este eh el martes que viene a las once de la mañana que tengo que renovar la cedula", expect: { choice: "remind", contains: { at: "2026-11-17T11:00" } }, tags: ["time"] },
  { id: "h2-es-time-7", lang: "es", input: "oye po recuérdame el sábado a mediodía ir a buscar las lucas donde mi viejo", expect: { choice: "remind", contains: { at: "2026-11-14T12:00" } }, tags: ["time"] },
  { id: "h2-es-time-8", lang: "es", input: "Recuérdame pasado mañana a las nueve de la mañana que tengo que llevar el coche al taller, porfa", expect: { choice: "remind", contains: { at: "2026-11-13T09:00" } }, tags: ["time"] },
  { id: "h2-es-time-9", lang: "es", input: "mi loco recuerdame el domingo a las 4pm buscar a la doña al aeropuerto ✈️", expect: { choice: "remind", contains: { at: "2026-11-15T16:00" } }, tags: ["time"] },
  { id: "h2-es-time-10", lang: "es", input: "remindeame mañana at 5 pm del meeting con el cliente", expect: { choice: "remind", contains: { at: "2026-11-12T17:00" } }, tags: ["time"] },

  // ---------------------------------------------------------------- en / time
  { id: "h2-en-time-1", lang: "en", input: "remind me to call mi abuela tmrw at 10am", expect: { choice: "remind", contains: { at: "2026-11-12T10:00" } }, tags: ["time"] },
  { id: "h2-en-time-2", lang: "en", input: "I always forget to water the plants, remind me saturday at 9 am", expect: { choice: "remind", contains: { at: "2026-11-14T09:00" } }, tags: ["time"] },
  { id: "h2-en-time-3", lang: "en", input: "in 20 min remind me to check the oven", expect: { choice: "remind", contains: { at: "2026-11-11T21:20" } }, tags: ["time"] },
  { id: "h2-en-time-4", lang: "en", input: "set a reminder for 10:30 pm: take out the trash", expect: { choice: "remind", contains: { at: "2026-11-11T22:30" } }, tags: ["time"] },
  { id: "h2-en-time-5", lang: "en", input: "Could you please remind me on Monday at 2:30 in the afternoon to submit my timesheet? Thank you so much!", expect: { choice: "remind", contains: { at: "2026-11-16T14:30" } }, tags: ["time"] },
  { id: "h2-en-time-6", lang: "en", input: "ping me at 6 am to leave for the airport", expect: { choice: "remind", contains: { at: "2026-11-12T06:00" } }, tags: ["time"] },
  { id: "h2-en-time-7", lang: "en", input: "remind me friday at noon to pick up the cake 🎂", expect: { choice: "remind", contains: { at: "2026-11-13T12:00" } }, tags: ["time"] },
  { id: "h2-en-time-8", lang: "en", input: "yo remind me in an hour and a half to move the laundry to the dryer", expect: { choice: "remind", contains: { at: "2026-11-11T22:30" } }, tags: ["time"] },
  { id: "h2-en-time-9", lang: "en", input: "remind me next wednesday at 8 in the morning about the dentist", expect: { choice: "remind", contains: { at: "2026-11-18T08:00" } }, tags: ["time"] },
  { id: "h2-en-time-10", lang: "en", input: "so um can you remind me sunday night at 9 to pack my bag for the trip", expect: { choice: "remind", contains: { at: "2026-11-15T21:00" } }, tags: ["time"] },

  // ---------------------------------------------------------------- es / memory
  { id: "h2-es-memory-1", lang: "es", input: "acuerdate que mi talla de zapato es 42", expect: { choice: "remember", contains: { fact: "42" } }, tags: ["memory"] },
  { id: "h2-es-memory-2", lang: "es", input: "anota que el wifi de la casa de mi mama es gatito2020", expect: { choice: "remember", contains: { fact: "gatito2020" } }, tags: ["memory"] },
  { id: "h2-es-memory-3", lang: "es", input: "pa que sepas, soy alergico a la penicilina", expect: { choice: "remember", contains: { fact: "penicilina" } }, tags: ["memory"] },
  { id: "h2-es-memory-4", lang: "es", input: "guarda esto: la placa de mi carro es BCR 482", expect: { choice: "remember", contains: { fact: "BCR" } }, tags: ["memory"] },
  { id: "h2-es-memory-5", lang: "es", input: "Apúntate que mi cuñada se llama Maripaz y que su cumple es el 3 de marzo, tía", expect: { choice: "remember", contains: { fact: "Maripaz" } }, tags: ["memory"] },
  { id: "h2-es-memory-6", lang: "es", input: "cual era la talla de anillo de mi novia?", expect: { choice: "recall", contains: { query: "anillo" } }, tags: ["memory"] },
  { id: "h2-es-memory-7", lang: "es", input: "oye como se llamaba el veterinario de la Luna", expect: { choice: "recall", contains: { query: "veterinario" } }, tags: ["memory"] },
  { id: "h2-es-memory-8", lang: "es", input: "me recuerdas cual es mi tipo de sangre?", expect: { choice: "recall", contains: { query: "sangre" } }, tags: ["memory"] },
  { id: "h2-es-memory-9", lang: "es", input: "borra lo de la clave del wifi que te dije, ya la cambie", expect: { choice: "forget", contains: { query: "wifi" } }, tags: ["memory"] },
  { id: "h2-es-memory-10", lang: "es", input: "olvidate de lo que te conte del gimnasio, ya me sali 🙄", expect: { choice: "forget", contains: { query: "gimnasio" } }, tags: ["memory"] },

  // ---------------------------------------------------------------- en / memory
  { id: "h2-en-memory-1", lang: "en", input: "remember that my locker combo is 14-22-9", expect: { choice: "remember", contains: { fact: "14-22-9" } }, tags: ["memory"] },
  { id: "h2-en-memory-2", lang: "en", input: "fyi my mom's birthday is june 3rd", expect: { choice: "remember", contains: { fact: "june" } }, tags: ["memory"] },
  { id: "h2-en-memory-3", lang: "en", input: "Just so you know, I've been vegetarian since last year", expect: { choice: "remember", contains: { fact: "vegetarian" } }, tags: ["memory"] },
  { id: "h2-en-memory-4", lang: "en", input: "save this: my dentist is Dr. Okafor on 5th street", expect: { choice: "remember", contains: { fact: "Okafor" } }, tags: ["memory"] },
  { id: "h2-en-memory-5", lang: "en", input: "note that my son's teacher is called ms. Pruitt", expect: { choice: "remember", contains: { fact: "Pruitt" } }, tags: ["memory"] },
  { id: "h2-en-memory-6", lang: "en", input: "whats my passport number again", expect: { choice: "recall", contains: { query: "passport" } }, tags: ["memory"] },
  { id: "h2-en-memory-7", lang: "en", input: "when is our anniversary? I can never keep it straight", expect: { choice: "recall", contains: { query: "anniversary" } }, tags: ["memory"] },
  { id: "h2-en-memory-8", lang: "en", input: "remind me what my landlord's name is", expect: { choice: "recall", contains: { query: "landlord" } }, tags: ["memory"] },
  { id: "h2-en-memory-9", lang: "en", input: "forget my old address, I moved", expect: { choice: "forget", contains: { query: "address" } }, tags: ["memory"] },
  { id: "h2-en-memory-10", lang: "en", input: "pls delete what i told you about my gym membership", expect: { choice: "forget", contains: { query: "gym" } }, tags: ["memory"] },

  // ---------------------------------------------------------------- es / calendar
  { id: "h2-es-calendar-1", lang: "es", input: "agendame dentista el jueves de 3 a 4 de la tarde", expect: { choice: "calendar_add", contains: { title: "dentista", start: "2026-11-12T15:00" } }, tags: ["calendar"] },
  { id: "h2-es-calendar-2", lang: "es", input: "mete en el calendario la reunion con el contador el lunes a las 10 am, dura una hora", expect: { choice: "calendar_add", contains: { title: "contador", start: "2026-11-16T10:00" } }, tags: ["calendar"] },
  { id: "h2-es-calendar-3", lang: "es", input: "pon en mi agenda cumple de Sofi el sabado a las 7 de la noche", expect: { choice: "calendar_add", contains: { title: "Sofi", start: "2026-11-14T19:00" } }, tags: ["calendar"] },
  { id: "h2-es-calendar-4", lang: "es", input: "oe crea un evento pichanga con los patas el domingo de 9 a 11 de la mañana", expect: { choice: "calendar_add", contains: { title: "pichanga", start: "2026-11-15T09:00" } }, tags: ["calendar"] },
  { id: "h2-es-calendar-5", lang: "es", input: "que tengo mañana?", expect: { choice: "calendar_read", contains: { from: "2026-11-12" } }, tags: ["calendar"] },
  { id: "h2-es-calendar-6", lang: "es", input: "tengo algo el viernes en la tarde?", expect: { choice: "calendar_read", contains: { from: "2026-11-13" } }, tags: ["calendar"] },
  { id: "h2-es-calendar-7", lang: "es", input: "como tengo la agenda el martes", expect: { choice: "calendar_read", contains: { from: "2026-11-17" } }, tags: ["calendar"] },
  { id: "h2-es-calendar-8", lang: "es", input: "me queda algo pendiente hoy en el calendario?", expect: { choice: "calendar_read", contains: { from: "2026-11-11" } }, tags: ["calendar"] },

  // ---------------------------------------------------------------- en / calendar
  { id: "h2-en-calendar-1", lang: "en", input: "put lunch with Marco on my calendar friday 12:30 to 1:30", expect: { choice: "calendar_add", contains: { title: "Marco", start: "2026-11-13T12:30" } }, tags: ["calendar"] },
  { id: "h2-en-calendar-2", lang: "en", input: "add yoga class tomorrow 6pm-7pm", expect: { choice: "calendar_add", contains: { title: "yoga", start: "2026-11-12T18:00" } }, tags: ["calendar"] },
  { id: "h2-en-calendar-3", lang: "en", input: "schedule a call with the landlord monday at 4pm for 30 minutes", expect: { choice: "calendar_add", contains: { title: "landlord", start: "2026-11-16T16:00" } }, tags: ["calendar"] },
  { id: "h2-en-calendar-4", lang: "en", input: "block saturday 10am to 2pm for packing moving boxes", expect: { choice: "calendar_add", contains: { title: "box", start: "2026-11-14T10:00" } }, tags: ["calendar"] },
  { id: "h2-en-calendar-5", lang: "en", input: "what's on my calendar tomorrow", expect: { choice: "calendar_read", contains: { from: "2026-11-12" } }, tags: ["calendar"] },
  { id: "h2-en-calendar-6", lang: "en", input: "am I free sunday afternoon?", expect: { choice: "calendar_read", contains: { from: "2026-11-15" } }, tags: ["calendar"] },
  { id: "h2-en-calendar-7", lang: "en", input: "do i have anything next wednesday", expect: { choice: "calendar_read", contains: { from: "2026-11-18" } }, tags: ["calendar"] },
  { id: "h2-en-calendar-8", lang: "en", input: "Hey, what does my Thursday look like?", expect: { choice: "calendar_read", contains: { from: "2026-11-12" } }, tags: ["calendar"] },

  // ---------------------------------------------------------------- es / messaging
  { id: "h2-es-messaging-1", lang: "es", input: "dile a mi mama que llego tarde", expect: { choice: "read_messages", contains: { contact: "mam" } }, tags: ["messaging"] },
  { id: "h2-es-messaging-2", lang: "es", input: "que me escribio Carlos?", expect: { choice: "read_messages", contains: { contact: "Carlos" } }, tags: ["messaging"] },
  { id: "h2-es-messaging-3", lang: "es", input: "tengo mensajes nuevos?", expect: { choice: "read_messages" }, tags: ["messaging"] },
  { id: "h2-es-messaging-4", lang: "es", input: "contestale a la Vale que si voy", expect: { choice: "read_messages", contains: { contact: "Vale" } }, tags: ["messaging"] },
  { id: "h2-es-messaging-5", lang: "es", input: "avisale a Jorge que ya sali de la casa", expect: { choice: "read_messages", contains: { contact: "Jorge" } }, tags: ["messaging"] },
  { id: "h2-es-messaging-6", lang: "es", input: "klk que dijo Yanelis en el wasap", expect: { choice: "read_messages", contains: { contact: "Yanelis" } }, tags: ["messaging"] },
  { id: "h2-es-messaging-7", lang: "es", input: "fijate si Don Beto me respondio lo del alquiler", expect: { choice: "read_messages", contains: { contact: "Beto" } }, tags: ["messaging"] },

  // ---------------------------------------------------------------- en / messaging
  { id: "h2-en-messaging-1", lang: "en", input: "tell Jess I'm running 10 min late", expect: { choice: "read_messages", contains: { contact: "Jess" } }, tags: ["messaging"] },
  { id: "h2-en-messaging-2", lang: "en", input: "any new whatsapps?", expect: { choice: "read_messages" }, tags: ["messaging"] },
  { id: "h2-en-messaging-3", lang: "en", input: "what did my brother say", expect: { choice: "read_messages", contains: { contact: "brother" } }, tags: ["messaging"] },
  { id: "h2-en-messaging-4", lang: "en", input: "reply to Kevin that sounds good", expect: { choice: "read_messages", contains: { contact: "Kevin" } }, tags: ["messaging"] },
  { id: "h2-en-messaging-5", lang: "en", input: "can you let Priya know the meeting got moved", expect: { choice: "read_messages", contains: { contact: "Priya" } }, tags: ["messaging"] },
  { id: "h2-en-messaging-6", lang: "en", input: "did dani text me back??", expect: { choice: "read_messages", contains: { contact: "dani" } }, tags: ["messaging"] },
  { id: "h2-en-messaging-7", lang: "en", input: "check my messages from Aunt Linda pls", expect: { choice: "read_messages", contains: { contact: "Linda" } }, tags: ["messaging"] },

  // ---------------------------------------------------------------- es / ask
  { id: "h2-es-ask-1", lang: "es", input: "ponme un recordatorio porfa", expect: { choice: "ask_user" }, tags: ["ask"] },
  { id: "h2-es-ask-2", lang: "es", input: "recuerdame llamar a la abuela", expect: { choice: "ask_user" }, tags: ["ask"] },
  { id: "h2-es-ask-3", lang: "es", input: "agendame una reunion", expect: { choice: "ask_user" }, tags: ["ask"] },
  { id: "h2-es-ask-4", lang: "es", input: "anota esto", expect: { choice: "ask_user" }, tags: ["ask"] },
  { id: "h2-es-ask-5", lang: "es", input: "crea un evento el viernes", expect: { choice: "ask_user" }, tags: ["ask"] },

  // ---------------------------------------------------------------- en / ask
  { id: "h2-en-ask-1", lang: "en", input: "set a reminder", expect: { choice: "ask_user" }, tags: ["ask"] },
  { id: "h2-en-ask-2", lang: "en", input: "remind me to pay rent", expect: { choice: "ask_user" }, tags: ["ask"] },
  { id: "h2-en-ask-3", lang: "en", input: "add an event to my calendar", expect: { choice: "ask_user" }, tags: ["ask"] },
  { id: "h2-en-ask-4", lang: "en", input: "remember this", expect: { choice: "ask_user" }, tags: ["ask"] },
  { id: "h2-en-ask-5", lang: "en", input: "schedule something with Ana", expect: { choice: "ask_user" }, tags: ["ask"] },

  // ---------------------------------------------------------------- es / decline
  { id: "h2-es-decline-1", lang: "es", input: "llama a mi mama", expect: { choice: "respond" }, tags: ["decline"] },
  { id: "h2-es-decline-2", lang: "es", input: "pideme un uber pa la casa", expect: { choice: "respond" }, tags: ["decline"] },
  { id: "h2-es-decline-3", lang: "es", input: "como va a estar el clima mañana en Heredia?", expect: { choice: "respond" }, tags: ["decline"] },
  { id: "h2-es-decline-4", lang: "es", input: "pasale 20 mil a Hugo por sinpe", expect: { choice: "respond" }, tags: ["decline"] },
  { id: "h2-es-decline-5", lang: "es", input: "resérvame una mesa para dos en el restaurante japonés el viernes a las 8", expect: { choice: "respond" }, tags: ["decline"] },
  { id: "h2-es-decline-6", lang: "es", input: "abre spotify y ponme reggaeton 🔥", expect: { choice: "respond" }, tags: ["decline"] },

  // ---------------------------------------------------------------- en / decline
  { id: "h2-en-decline-1", lang: "en", input: "call dad", expect: { choice: "respond" }, tags: ["decline"] },
  { id: "h2-en-decline-2", lang: "en", input: "order me a large pepperoni pizza", expect: { choice: "respond" }, tags: ["decline"] },
  { id: "h2-en-decline-3", lang: "en", input: "what's the weather gonna be like tomorrow in san jose", expect: { choice: "respond" }, tags: ["decline"] },
  { id: "h2-en-decline-4", lang: "en", input: "venmo sarah $15 for the movie", expect: { choice: "respond" }, tags: ["decline"] },
  { id: "h2-en-decline-5", lang: "en", input: "book me a flight to Miami next friday", expect: { choice: "respond" }, tags: ["decline"] },
  { id: "h2-en-decline-6", lang: "en", input: "open instagram", expect: { choice: "respond" }, tags: ["decline"] },

  // ---------------------------------------------------------------- es / chat
  { id: "h2-es-chat-1", lang: "es", input: "jaja gracias crack", expect: { choice: "respond" }, tags: ["chat"] },
  { id: "h2-es-chat-2", lang: "es", input: "que cosas puedes hacer?", expect: { choice: "respond" }, tags: ["chat"] },
  { id: "h2-es-chat-3", lang: "es", input: "uff estoy molido hoy, que dia mas largo", expect: { choice: "respond" }, tags: ["chat"] },
  { id: "h2-es-chat-4", lang: "es", input: "cuanto es el 15% de 80?", expect: { choice: "respond" }, tags: ["chat"] },

  // ---------------------------------------------------------------- en / chat
  { id: "h2-en-chat-1", lang: "en", input: "thanks!! ur the best", expect: { choice: "respond" }, tags: ["chat"] },
  { id: "h2-en-chat-2", lang: "en", input: "hey whats up", expect: { choice: "respond" }, tags: ["chat"] },
  { id: "h2-en-chat-3", lang: "en", input: "what can you help me with?", expect: { choice: "respond" }, tags: ["chat"] },
  { id: "h2-en-chat-4", lang: "en", input: "ugh long day 😩", expect: { choice: "respond" }, tags: ["chat"] },
];

/*
 * Borderline cases (kept, but a disagreement here is weaker evidence than elsewhere):
 * h2-es-time-1: "a las 6:15 de la mañana" with no day; 06:15 already passed, so tomorrow by the stated rule.
 * h2-es-time-3: indirect ("ojala no se me olvide"); a careful assistant sets the reminder, but respond is arguable.
 * h2-es-time-5: 21:30 today is only 30 minutes after the clock; tests that a near-future time stays today.
 * h2-es-time-6: "el martes que viene" read as Tuesday 17, the next Tuesday; dictation fillers around it.
 * h2-es-time-10: Spanglish "remindeame"; the reminder text may come out in either language.
 * h2-en-time-6: "at 6 am" with no day; already passed, so tomorrow.
 * h2-en-time-9: "next wednesday" on a Wednesday; taken as 2026-11-18, the only sensible reading.
 * h2-en-time-10: "sunday night at 9" read as 21:00.
 * h2-es-memory-8: "me recuerdas cual es..." uses the remind verb but asks for a stored fact (recall).
 * h2-en-memory-8: "remind me what my landlord's name is" uses the remind verb but is recall.
 * h2-es-memory-4: fact asserted on "BCR" only, since the model may write "BCR 482", "BCR-482" or "BCR482".
 * h2-en-memory-2: fact asserted on "june" only, since the date may be written several ways.
 * h2-es-calendar-8: "hoy" at 21:00; `from` may be 2026-11-11T00:00 or 2026-11-11T21:00, both contain the date.
 * h2-en-calendar-3: "schedule a call" is a calendar event, not a phone call (must not decline).
 * h2-en-calendar-4: title asserted on "box", which matches "boxes" and "Box packing".
 * h2-es-messaging-1: contact asserted on "mam" so "mama", "mamá" and "Mamá" all pass.
 * h2-en-messaging-3: contact "brother"; a model could pass "bro" or a guessed name and fail.
 * h2-es-messaging-7: "fijate si ... me respondio" is a read, contact "Don Beto" asserted on "Beto".
 * h2-es-ask-2 / h2-en-ask-2: a reminder with a task but no time; ask_user expected, though some
 *   designs might default a time. Scoring is strict on ask_user here.
 * h2-es-ask-5: "crea un evento el viernes" has a day but no title or time.
 * h2-en-ask-5: "schedule something with Ana" lacks a time; a model might read Ana's messages first.
 * h2-es-decline-5: a restaurant booking with a date and time can tempt calendar_add; no skill books.
 * h2-en-decline-5: a flight booking with a date can tempt calendar_add or remind.
 * h2-es-decline-4: SINPE (Costa Rican transfer) is a payment, no skill does it.
 * h2-es-chat-4: arithmetic, a plain respond; no skill applies.
 */
