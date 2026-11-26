import type { EvalCase } from "./cases.ts";

/**
 * The on-phone first-win eval (Q29, FR-MODEL-04): 40 cases, half Spanish, half English. Many are phrased so
 * the intent hints don't fire, so the model's own choice is measured. Checks are on the first action and its
 * key arguments; times are checked by the hour written in the "at" value.
 */
export const FIRST_WIN_CASES: readonly EvalCase[] = [
  // remind
  { id: "es-remind-1", lang: "es", input: "recuérdame llamar a mamá a las 9 de la noche", expect: { choice: "remind", contains: { at: "T21:00" } } },
  { id: "es-remind-2", lang: "es", input: "a las 6 de la tarde tengo que sacar al perro, no me dejes olvidarlo", expect: { choice: "remind", contains: { at: "T18:00" } } },
  { id: "es-remind-3", lang: "es", input: "ponme un aviso mañana a las 8 para la reunión", expect: { choice: "remind", contains: { at: "T08:00" } } },
  { id: "es-remind-4", lang: "es", input: "necesito que me avises a las 7:30 para tomar la pastilla", expect: { choice: "remind", contains: { at: "T07:30" } } },
  { id: "en-remind-1", lang: "en", input: "remind me to buy milk at 5pm", expect: { choice: "remind", contains: { at: "T17:00" } } },
  { id: "en-remind-2", lang: "en", input: "ping me at 10 tonight to send the invoice", expect: { choice: "remind", contains: { at: "T22:00" } } },
  { id: "en-remind-3", lang: "en", input: "I have to call the bank at 9 tomorrow morning, don't let me forget", expect: { choice: "remind", contains: { at: "T09:00" } } },
  { id: "en-remind-4", lang: "en", input: "nudge me at 3pm about the dentist", expect: { choice: "remind", contains: { at: "T15:00" } } },
  // remember
  { id: "es-remember-1", lang: "es", input: "recuerda que mi pasaporte vence en marzo de 2027", expect: { choice: "remember", contains: { fact: "pasaporte" } } },
  { id: "es-remember-2", lang: "es", input: "anota que la clave del wifi es tortuga123", expect: { choice: "remember", contains: { fact: "tortuga123" } } },
  { id: "es-remember-3", lang: "es", input: "guarda esto: mi talla de zapato es 42", expect: { choice: "remember", contains: { fact: "42" } } },
  { id: "en-remember-1", lang: "en", input: "remember that my car is parked on level 3", expect: { choice: "remember", contains: { fact: "level 3" } } },
  { id: "en-remember-2", lang: "en", input: "note that Ana is allergic to peanuts", expect: { choice: "remember", contains: { fact: "peanut" } } },
  { id: "en-remember-3", lang: "en", input: "keep in mind my blood type is O positive", expect: { choice: "remember", contains: { fact: "O" } } },
  // recall
  { id: "es-recall-1", lang: "es", input: "¿cuándo vence mi pasaporte?", expect: { choice: "recall", contains: { query: "pasaporte" } } },
  { id: "es-recall-2", lang: "es", input: "¿cuál era la clave del wifi?", expect: { choice: "recall", contains: { query: "wifi" } } },
  { id: "en-recall-1", lang: "en", input: "what's my shoe size?", expect: { choice: "recall", contains: { query: "shoe" } } },
  { id: "en-recall-2", lang: "en", input: "where did I park?", expect: { choice: "recall" } },
  // forget
  { id: "es-forget-1", lang: "es", input: "olvida lo de la clave del wifi", expect: { choice: "forget", contains: { query: "wifi" } } },
  { id: "en-forget-1", lang: "en", input: "delete what you know about my parking spot", expect: { choice: "forget", contains: { query: "park" } } },
  // calendar
  { id: "es-cal-read-1", lang: "es", input: "¿qué tengo mañana?", expect: { choice: "calendar_read" } },
  { id: "es-cal-read-2", lang: "es", input: "¿estoy libre el viernes en la tarde?", expect: { choice: "calendar_read" } },
  { id: "en-cal-read-1", lang: "en", input: "what's on my schedule tomorrow?", expect: { choice: "calendar_read" } },
  { id: "en-cal-read-2", lang: "en", input: "do I have anything Saturday?", expect: { choice: "calendar_read" } },
  { id: "es-cal-add-1", lang: "es", input: "agenda dentista el viernes de 10 a 11", expect: { choice: "calendar_add", contains: { title: "dentista" } } },
  { id: "en-cal-add-1", lang: "en", input: "put lunch with Carlos on Thursday from 1 to 2pm in my calendar", expect: { choice: "calendar_add", contains: { title: "Carlos" } } },
  // messages
  { id: "es-read-1", lang: "es", input: "¿Ana me escribió?", expect: { choice: "read_messages", contains: { contact: "Ana" } } },
  { id: "es-read-2", lang: "es", input: "¿qué me dijo Pedro en WhatsApp?", expect: { choice: "read_messages", contains: { contact: "Pedro" } } },
  { id: "en-read-1", lang: "en", input: "did my boss text me?", expect: { choice: "read_messages" } },
  { id: "en-read-2", lang: "en", input: "any new messages?", expect: { choice: "read_messages" } },
  // reply: no conversation is known yet, so the right first action is to read messages (or ask)
  { id: "es-reply-1", lang: "es", input: "dile a Ana que voy 10 minutos tarde", expect: { choice: "read_messages" } },
  { id: "en-reply-1", lang: "en", input: "tell Pedro I'll be there at 8", expect: { choice: "read_messages" } },
  // chat and clarification
  { id: "es-chat-1", lang: "es", input: "hola", expect: { choice: "respond" } },
  { id: "es-chat-2", lang: "es", input: "gracias, eso es todo", expect: { choice: "respond" } },
  { id: "en-chat-1", lang: "en", input: "hi there", expect: { choice: "respond" } },
  { id: "en-chat-2", lang: "en", input: "what can you do?", expect: { choice: "respond" } },
  { id: "es-ask-1", lang: "es", input: "pon un recordatorio", expect: { choice: "ask_user" } },
  { id: "en-ask-1", lang: "en", input: "send a message", expect: { choice: "ask_user" } },
  // unsupported: nothing on the menu fits, so no action
  { id: "es-none-1", lang: "es", input: "transfiere 50 dólares a mi hermano", expect: { choice: "respond" } },
  { id: "en-none-1", lang: "en", input: "book me a flight to Madrid", expect: { choice: "respond" } },
];
