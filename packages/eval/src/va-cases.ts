import type { EvalCase } from "./cases.ts";
import { FIRST_WIN_CASES } from "./first-win-cases.ts";

/**
 * The Virtual Assistant eval set, by capability family (Q31: the parity gate is per family). The first-win
 * 40 plus cases written to separate harness versions: 40 cases can't tell 53% from 70% (harness-literature.md).
 * The clock is fixed by the runner: Wednesday 2026-11-11, 21:00 local. Tomorrow is Thursday 2026-11-12,
 * Friday is 2026-11-13, Saturday 2026-11-14, Monday 2026-11-16.
 * Family is the first tag; checks stay on the first action and its key arguments.
 */
type Family = "time" | "memory" | "calendar" | "messaging" | "ask" | "decline" | "chat";
const c = (id: string, family: Family, lang: "es" | "en", input: string, expect: EvalCase["expect"]): EvalCase => ({ id, lang, input, expect, tags: [family] });

const MORE: readonly EvalCase[] = [
  // time: reminders with every way people say a time
  c("es-time-1", "time", "es", "recuérdame mañana a las 7 de la mañana sacar la basura", { choice: "remind", contains: { at: "2026-11-12T07:00" } }),
  c("es-time-2", "time", "es", "avísame a las 11 de la noche que apague el horno", { choice: "remind", contains: { at: "T23:00" } }),
  c("es-time-3", "time", "es", "recuérdame el viernes a las 5 de la tarde pagar la luz", { choice: "remind", contains: { at: "2026-11-13T17:00" } }),
  c("es-time-4", "time", "es", "a las 10 y media de la noche recuérdame llamar a Luis", { choice: "remind", contains: { at: "T22:30" } }),
  c("es-time-5", "time", "es", "mañana al mediodía recuérdame comprar pan", { choice: "remind", contains: { at: "2026-11-12T12:00" } }),
  c("es-time-6", "time", "es", "recuérdame el lunes a las 9 la reunión con el contador", { choice: "remind", contains: { at: "2026-11-16T09:00" } }),
  c("es-time-7", "time", "es", "no me dejes olvidar mañana a las 3 de la tarde la cita del médico", { choice: "remind", contains: { at: "2026-11-12T15:00" } }),
  c("es-time-8", "time", "es", "avísame mañana a las 6:45 para el bus", { choice: "remind", contains: { at: "2026-11-12T06:45" } }),
  c("es-time-9", "time", "es", "recuérdame a las 9:15 de la noche tomar la medicina", { choice: "remind", contains: { at: "T21:15" } }),
  c("es-time-10", "time", "es", "el sábado a las 8 de la mañana recuérdame regar las plantas", { choice: "remind", contains: { at: "2026-11-14T08:00" } }),
  c("en-time-1", "time", "en", "remind me tomorrow at 7am to take out the trash", { choice: "remind", contains: { at: "2026-11-12T07:00" } }),
  c("en-time-2", "time", "en", "remind me at 11pm to turn off the oven", { choice: "remind", contains: { at: "T23:00" } }),
  c("en-time-3", "time", "en", "remind me Friday at 5pm to pay the electric bill", { choice: "remind", contains: { at: "2026-11-13T17:00" } }),
  c("en-time-4", "time", "en", "at 10:30 tonight remind me to call Luis", { choice: "remind", contains: { at: "T22:30" } }),
  c("en-time-5", "time", "en", "remind me tomorrow at noon to buy bread", { choice: "remind", contains: { at: "2026-11-12T12:00" } }),
  c("en-time-6", "time", "en", "remind me Monday at 9 about the meeting with the accountant", { choice: "remind", contains: { at: "2026-11-16T09:00" } }),
  c("en-time-7", "time", "en", "don't let me forget the doctor's appointment tomorrow at 3pm", { choice: "remind", contains: { at: "2026-11-12T15:00" } }),
  c("en-time-8", "time", "en", "wake me up tomorrow at 6:45 for the bus", { choice: "remind", contains: { at: "2026-11-12T06:45" } }),
  c("en-time-9", "time", "en", "remind me at 9:15pm to take my medicine", { choice: "remind", contains: { at: "T21:15" } }),
  c("en-time-10", "time", "en", "on Saturday at 8am remind me to water the plants", { choice: "remind", contains: { at: "2026-11-14T08:00" } }),

  // memory: remember
  c("es-mem-1", "memory", "es", "recuerda que el cumpleaños de mi mamá es el 4 de mayo", { choice: "remember", contains: { fact: "4 de mayo" } }),
  c("es-mem-2", "memory", "es", "anota que mi placa es BCD-123", { choice: "remember", contains: { fact: "BCD-123" } }),
  c("es-mem-3", "memory", "es", "toma nota: el código de la puerta es 4589", { choice: "remember", contains: { fact: "4589" } }),
  c("es-mem-4", "memory", "es", "acuérdate de que soy alérgico a la penicilina", { choice: "remember", contains: { fact: "penicilina" } }),
  c("en-mem-1", "memory", "en", "remember that my mom's birthday is May 4", { choice: "remember", contains: { fact: "May 4" } }),
  c("en-mem-2", "memory", "en", "save this: my license plate is BCD-123", { choice: "remember", contains: { fact: "BCD-123" } }),
  c("en-mem-3", "memory", "en", "the gate code is 4589, remember it", { choice: "remember", contains: { fact: "4589" } }),
  c("en-mem-4", "memory", "en", "I'm allergic to penicillin, keep that in mind", { choice: "remember", contains: { fact: "penicillin" } }),
  // memory: recall
  c("es-mem-5", "memory", "es", "¿cuándo es el cumpleaños de mi mamá?", { choice: "recall", contains: { query: "cumple" } }),
  c("es-mem-6", "memory", "es", "¿cuál es mi placa?", { choice: "recall", contains: { query: "placa" } }),
  c("es-mem-7", "memory", "es", "¿qué código tenía la puerta?", { choice: "recall", contains: { query: "puerta" } }),
  c("es-mem-8", "memory", "es", "¿a qué soy alérgico?", { choice: "recall", contains: { query: "alérg" } }),
  c("en-mem-5", "memory", "en", "when is my mom's birthday?", { choice: "recall", contains: { query: "birthday" } }),
  c("en-mem-6", "memory", "en", "what's my license plate?", { choice: "recall", contains: { query: "plate" } }),
  c("en-mem-7", "memory", "en", "what was the gate code again?", { choice: "recall", contains: { query: "code" } }),
  c("en-mem-8", "memory", "en", "what am I allergic to?", { choice: "recall", contains: { query: "allerg" } }),
  // memory: forget
  c("es-mem-9", "memory", "es", "borra lo del código de la puerta", { choice: "forget", contains: { query: "puerta" } }),
  c("es-mem-10", "memory", "es", "olvida mi placa", { choice: "forget", contains: { query: "placa" } }),
  c("en-mem-9", "memory", "en", "forget the gate code", { choice: "forget", contains: { query: "code" } }),
  c("en-mem-10", "memory", "en", "erase what I told you about my license plate", { choice: "forget", contains: { query: "plate" } }),

  // calendar
  c("es-cal-1", "calendar", "es", "¿qué tengo el lunes?", { choice: "calendar_read", contains: { from: "2026-11-16" } }),
  c("es-cal-2", "calendar", "es", "¿tengo algo hoy en la noche?", { choice: "calendar_read", contains: { from: "2026-11-11" } }),
  c("es-cal-3", "calendar", "es", "muéstrame mi agenda de mañana", { choice: "calendar_read", contains: { from: "2026-11-12" } }),
  c("es-cal-4", "calendar", "es", "pon en mi calendario almuerzo con Sofía mañana de 12 a 1", { choice: "calendar_add", contains: { title: "Sofía", start: "2026-11-12T12:00" } }),
  c("es-cal-5", "calendar", "es", "agenda una llamada con el banco el viernes a las 9", { choice: "calendar_add", contains: { title: "banco", start: "2026-11-13T09:00" } }),
  c("es-cal-6", "calendar", "es", "anota en la agenda: gimnasio el sábado de 7 a 8 de la mañana", { choice: "calendar_add", contains: { title: "gimnasio", start: "2026-11-14T07:00" } }),
  c("en-cal-1", "calendar", "en", "what do I have on Monday?", { choice: "calendar_read", contains: { from: "2026-11-16" } }),
  c("en-cal-2", "calendar", "en", "anything on my calendar tonight?", { choice: "calendar_read", contains: { from: "2026-11-11" } }),
  c("en-cal-3", "calendar", "en", "show me tomorrow's agenda", { choice: "calendar_read", contains: { from: "2026-11-12" } }),
  c("en-cal-4", "calendar", "en", "add lunch with Sofia tomorrow from 12 to 1 to my calendar", { choice: "calendar_add", contains: { title: "Sofia", start: "2026-11-12T12:00" } }),
  c("en-cal-5", "calendar", "en", "schedule a call with the bank on Friday at 9am", { choice: "calendar_add", contains: { title: "bank", start: "2026-11-13T09:00" } }),
  c("en-cal-6", "calendar", "en", "block gym on Saturday from 7 to 8am", { choice: "calendar_add", contains: { title: "gym", start: "2026-11-14T07:00" } }),

  // messaging: reading, and replies that must start by reading (no conversation known yet)
  c("es-msg-1", "messaging", "es", "¿qué dice el último mensaje de mi hermana?", { choice: "read_messages" }),
  c("es-msg-2", "messaging", "es", "léeme los mensajes de Carla", { choice: "read_messages", contains: { contact: "Carla" } }),
  c("es-msg-3", "messaging", "es", "¿tengo mensajes nuevos?", { choice: "read_messages" }),
  c("es-msg-4", "messaging", "es", "respóndele a Carla que sí voy", { choice: "read_messages" }),
  c("es-msg-5", "messaging", "es", "contéstale a mi jefe que llego en 15 minutos", { choice: "read_messages" }),
  c("en-msg-1", "messaging", "en", "what did my sister's last message say?", { choice: "read_messages" }),
  c("en-msg-2", "messaging", "en", "read me Carla's messages", { choice: "read_messages", contains: { contact: "Carla" } }),
  c("en-msg-3", "messaging", "en", "do I have new WhatsApps?", { choice: "read_messages" }),
  c("en-msg-4", "messaging", "en", "reply to Carla that I'm coming", { choice: "read_messages" }),
  c("en-msg-5", "messaging", "en", "text my boss back that I'll be there in 15", { choice: "read_messages" }),

  // ask: something needed is missing
  c("es-ask-2", "ask", "es", "recuérdame algo mañana", { choice: "ask_user" }),
  c("es-ask-3", "ask", "es", "agenda una reunión", { choice: "ask_user" }),
  c("es-ask-4", "ask", "es", "avísame más tarde", { choice: "ask_user" }),
  c("es-ask-5", "ask", "es", "mándale un mensaje", { choice: "ask_user" }),
  c("en-ask-2", "ask", "en", "remind me about something tomorrow", { choice: "ask_user" }),
  c("en-ask-3", "ask", "en", "set up a meeting", { choice: "ask_user" }),
  c("en-ask-4", "ask", "en", "remind me later", { choice: "ask_user" }),
  c("en-ask-5", "ask", "en", "message him", { choice: "ask_user" }),

  // decline: nothing on the menu does this, so no tool call (an answer or a question back both pass)
  c("es-dec-1", "decline", "es", "cómprame unos audífonos en Amazon", { choice: "respond" }),
  c("es-dec-2", "decline", "es", "pide un Uber a mi casa", { choice: "respond" }),
  c("es-dec-3", "decline", "es", "paga mi tarjeta de crédito", { choice: "respond" }),
  c("es-dec-4", "decline", "es", "llama a mi mamá", { choice: "respond" }),
  c("en-dec-1", "decline", "en", "buy me headphones on Amazon", { choice: "respond" }),
  c("en-dec-2", "decline", "en", "order an Uber home", { choice: "respond" }),
  c("en-dec-3", "decline", "en", "pay my credit card", { choice: "respond" }),
  c("en-dec-4", "decline", "en", "call my mom", { choice: "respond" }),

  // chat: plain conversation, no tool
  c("es-chat-3", "chat", "es", "buenos días", { choice: "respond" }),
  c("es-chat-4", "chat", "es", "¿cómo te llamas?", { choice: "respond" }),
  c("es-chat-5", "chat", "es", "cuéntame un chiste corto", { choice: "respond" }),
  c("en-chat-3", "chat", "en", "good morning", { choice: "respond" }),
  c("en-chat-4", "chat", "en", "what's your name?", { choice: "respond" }),
  c("en-chat-5", "chat", "en", "tell me a short joke", { choice: "respond" }),
];

const FIRST_WIN_FAMILY: Record<string, Family> = {
  remind: "time", remember: "memory", recall: "memory", forget: "memory",
  "cal-read": "calendar", "cal-add": "calendar", read: "messaging", reply: "messaging",
  chat: "chat", ask: "ask", none: "decline",
};

/** Every case with its family as the first tag. */
export const VA_CASES: readonly EvalCase[] = [
  ...FIRST_WIN_CASES.map((fc) => {
    const key = fc.id.replace(/^(es|en)-/, "").replace(/-\d+$/, "");
    return { ...fc, tags: [FIRST_WIN_FAMILY[key] ?? "chat", ...(fc.tags ?? [])] };
  }),
  ...MORE,
];

export function familyOf(ec: EvalCase): string {
  return ec.tags?.[0] ?? "other";
}
