/**
 * The question Hermit asks when a skill fits but its essential part is missing. Fixed text, because a 0.8B
 * model's improvised questions were verbose lists in English or nonsense when rewritten ("¿Qué necesitas
 * que hable?"). One short question that names what's missing, in the user's language.
 */
const QUESTIONS: Record<string, { "es-419": string; en: string }> = {
  remind: { "es-419": "¿Qué te recuerdo y a qué hora?", en: "What should I remind you about, and when?" },
  remember: { "es-419": "¿Qué quieres que recuerde?", en: "What should I remember?" },
  recall: { "es-419": "¿Qué quieres que busque?", en: "What should I look up?" },
  forget: { "es-419": "¿Qué quieres que olvide?", en: "What should I forget?" },
  calendar_read: { "es-419": "¿Qué día reviso?", en: "Which day should I check?" },
  calendar_add: { "es-419": "¿Qué evento agendo, y qué día y a qué hora?", en: "What's the event, and what day and time?" },
  read_messages: { "es-419": "¿De quién quieres ver los mensajes?", en: "Whose messages should I check?" },
  reply_message: { "es-419": "¿A quién le escribo y qué le digo?", en: "Who should I write to, and what should I say?" },
};

export function askFor(skill: string, language: "es-419" | "en"): string | undefined {
  return QUESTIONS[skill]?.[language];
}
