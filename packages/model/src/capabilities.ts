/**
 * W1 (2026-11-24): asked "¿Qué puedes hacer?", BotPsy invented capabilities on the S26 ("Control de dispositivos y
 * aplicaciones", "Recopilación de información personal"). The question is recognized by code, as the whole message, so
 * the answer can come from the skills actually on this phone (the runtime writes it from copy).
 *
 * Whole message only: greetings, Hermit's name and "please" around it are fine; anything more ("¿qué puedes hacer si
 * llueve?", "what can you do about my reminder?") is a request for the model and the router, not this question.
 */
const fold = (t: string) =>
  t.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[¿?¡!.,;:()"“”«»]+/g, " ").replace(/\s+/g, " ").trim();

const LEAD = /^(?:(?:hola|holi|buenas|buenos dias|buenas tardes|buenas noches|oye|oiga|bueno|ok|okay|y|entonces|a ver|hi|hey|hello|yo|so|and|well|good morning|good afternoon|good evening|hermit)\s+)+/;
const TRAIL = /(?:\s+(?:hermit|por favor|porfa|please|exactamente|exactly|aqui|here|hoy|today))+$/;

const ASKS = new RegExp(
  `^(?:${[
    // Spanish (tú and vos)
    String.raw`(?:que|q) (?:mas )?(?:cosas )?(?:puedes|podes|podrias|sabes|eres capaz de) hacer(?: (?:por|para) mi| tu| vos)?`,
    String.raw`(?:en que|como) (?:mas )?(?:me )?(?:puedes|podes|podrias) ayudar(?:me)?`,
    String.raw`(?:para|pa) que (?:me )?sirves`,
    String.raw`que (?:puedo|se puede) hacer contigo`,
    String.raw`que (?:te puedo|puedo) pedir(?:te)?`,
    String.raw`(?:cuales son|que son) tus (?:funciones|capacidades|habilidades)`,
    String.raw`que (?:funciones|capacidades|habilidades) tienes`,
    String.raw`ayuda`,
    // English
    String.raw`what (?:else )?(?:can|could) you do(?: for me)?`,
    String.raw`what (?:else )?are you able to do`,
    String.raw`what (?:else )?are you capable of`,
    String.raw`what (?:kind of |sort of )?(?:things|stuff) can you do(?: for me)?`,
    String.raw`what (?:else )?can you help(?: me)? with`,
    String.raw`how (?:else )?can you help(?: me)?`,
    String.raw`what do you do`,
    String.raw`what are your (?:features|capabilities|skills|abilities)`,
    String.raw`what can i (?:ask you|ask you to do|do with you)`,
    String.raw`help`,
  ].join("|")})$`,
);

/** The user asks what Hermit can do, in Spanish or English, and nothing else. */
export function asksWhatHermitCanDo(text: string): boolean {
  if (text.length > 120) return false;
  const t = fold(text).replace(LEAD, "").replace(TRAIL, "").trim();
  return ASKS.test(t);
}
