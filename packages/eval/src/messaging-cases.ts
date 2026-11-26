import type { EvalCase } from "./cases.ts";

// Messaging eval set. No conversation has been read at the start of any case, so every request to
// reply, tell, answer or message someone expects read_messages first (reply_message needs a
// conversationId it cannot have yet). Questions about what someone said also expect read_messages.
// Near misses belong to other skills: remind and calendar ("time"), remember, recall and forget
// ("memory"), ask_user for a bare "send a message" ("ask"), and respond for calls and payments ("decline").
// contact asserts are lowercase substrings chosen to survive accent and title variations.

const msg = (id: string, lang: "es" | "en", input: string, contact?: string): EvalCase => ({
  id,
  lang,
  input,
  expect: contact ? { choice: "read_messages", contains: { contact } } : { choice: "read_messages" },
  tags: ["messaging"],
});

const near = (id: string, lang: "es" | "en", input: string, choice: string, family: string): EvalCase => ({
  id,
  lang,
  input,
  expect: { choice },
  tags: [family],
});

export const MESSAGING_CASES: readonly EvalCase[] = [
  // Spanish: read and reply requests
  msg("mx-es-1", "es", "dile a mi mamá que ya llegué", "mam"),
  msg("mx-es-2", "es", "fijate si Hugo contestó", "hugo"),
  msg("mx-es-3", "es", "¿qué dijo la Vale?", "vale"),
  msg("mx-es-4", "es", "revisa el grupo de la familia", "famil"),
  msg("mx-es-5", "es", "che, mirá si mi jefa me escribió algo", "jefa"),
  msg("mx-es-6", "es", "contestale a Don Carlos que mañana le paso la plata", "carlos"),
  msg("mx-es-7", "es", "oye checa mis mensajes porfa"),
  msg("mx-es-8", "es", "parce, ¿me escribió el Pipe?", "pipe"),
  msg("mx-es-9", "es", "weón, ¿la Cata me respondió o no?", "cata"),
  msg("mx-es-10", "es", "tío, mira a ver qué me ha puesto Javi por el whatsapp", "javi"),
  msg("mx-es-11", "es", "mandale un wasap a la Dra. Morales diciendo que llego tarde", "morales"),
  msg("mx-es-12", "es", "dile al Ing. Ramírez que el informe ya está listo", "ram"),
  msg("mx-es-13", "es", "q dijo mi hermano", "herman"),
  msg("mx-es-14", "es", "hay mensajes nuevos?"),
  msg("mx-es-15", "es", "avisale a Sofi que ya voy saliendo", "sofi"),
  msg("mx-es-16", "es", "respondele al profe Gutiérrez que no puedo ir a la tutoria", "guti"),
  msg("mx-es-17", "es", "mi abuela me mandó algo? no he visto el cel", "abuel"),
  msg("mx-es-18", "es", "chequea si el Tony me texteó back", "tony"),

  // Spanish: near misses that belong to other skills
  near("mx-es-19", "es", "recuérdame escribirle a Ana a las 5", "remind", "time"),
  near("mx-es-20", "es", "acordate que el número de la Vale es 3001234567", "remember", "memory"),
  near("mx-es-21", "es", "llama a mi mamá", "respond", "decline"),
  near("mx-es-22", "es", "mandá un mensaje", "ask_user", "ask"),
  near("mx-es-23", "es", "¿cuándo era el cumple de Don Carlos que te dije?", "recall", "memory"),
  near("mx-es-24", "es", "agéndame almuerzo con mi jefa el viernes a la 1", "calendar_add", "time"),
  near("mx-es-25", "es", "págale a Hugo los 50 mil por Nequi", "respond", "decline"),

  // English: read and reply requests
  msg("mx-en-1", "en", "text Carlos I'm outside", "carlos"),
  msg("mx-en-2", "en", "can you see if my sister answered", "sister"),
  msg("mx-en-3", "en", "what did mom say?", "mom"),
  msg("mx-en-4", "en", "any new messages?"),
  msg("mx-en-5", "en", "tell my boss I'm running 10 min late", "boss"),
  msg("mx-en-6", "en", "let Dr. Patel know I need to move my appointment", "patel"),
  msg("mx-en-7", "en", "reply to Mike saying sounds good", "mike"),
  msg("mx-en-8", "en", "did anyone write in the family group chat", "family"),
  msg("mx-en-9", "en", "whats jess been sayin lol", "jess"),
  msg("mx-en-10", "en", "check if my bro Danny hit me back", "danny"),
  msg("mx-en-11", "en", "answer Mrs. Thompson and say the kids are ready", "thompson"),
  msg("mx-en-12", "en", "send grandma a message that we're on our way", "grandma"),
  msg("mx-en-13", "en", "hey can u check my whatsapp"),
  msg("mx-en-14", "en", "tell my tía Rosa I'll call her later", "rosa"),
  msg("mx-en-15", "en", "message the soccer team group that practice is cancelled", "soccer"),
  msg("mx-en-16", "en", "has Coach Rivera replied yet?", "rivera"),
  msg("mx-en-17", "en", "read me what Uncle Joe sent", "joe"),
  msg("mx-en-18", "en", "msg priya: running late, save me a seat", "priya"),

  // English: near misses that belong to other skills
  near("mx-en-19", "en", "remind me to text Ana at 5", "remind", "time"),
  near("mx-en-20", "en", "remember that Ana's number is 555 0134", "remember", "memory"),
  near("mx-en-21", "en", "call my mom", "respond", "decline"),
  near("mx-en-22", "en", "send a message", "ask_user", "ask"),
  near("mx-en-23", "en", "forget Carlos's address", "forget", "memory"),
  near("mx-en-24", "en", "do I have lunch with Jess tomorrow? check my calendar", "calendar_read", "time"),
  near("mx-en-25", "en", "Venmo Mike $20 for the pizza", "respond", "decline"),
];
