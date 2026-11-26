import { extractWhen, localParts, splitClauses, type SkillDef } from "@hermit/core";

/**
 * Deterministic routing for unambiguous phrases. It only removes options, so it can't make the agent do
 * anything the full menu wouldn't allow; the cage is unchanged.
 * - narrow: the hint's skills replace the menu for the whole turn (a small model wandered from remind to
 *   forget after a failure on the S26).
 * - force: the phrase is precise enough that a tool must be called (tool_choice "required"). On 124 cases
 *   BotPsy answered "I need more information" in about 15 where a tool plainly fit (harness-diagnosis.md).
 *   Reminders and events are forced only when the words carry a time, so "recuérdame algo" can still ask.
 */
/** Whole-phrase match with Unicode-aware boundaries (\b treats accented letters as non-letters). */
const phrase = (alternatives: string) => new RegExp(`(?<![\\p{L}\\p{N}])(?:${alternatives})(?![\\p{L}\\p{N}])`, "iu");
/**
 * The phone's clock and zone for words like "el viernes" (W1 review): read in UTC on the real clock, "despiértame el
 * viernes a las 7" said at 20:00 on a Thursday in Costa Rica (already Friday in UTC) was a week away, so a reminder.
 * Without one (tests, tools), the real clock in UTC, as before.
 */
export interface RouteClock {
  now: number;
  timeZone: string;
}
const read = (text: string, clock: RouteClock | undefined) => extractWhen(text, clock?.now ?? Date.now(), clock?.timeZone ?? "UTC");
/** The local date after the clock's, "YYYY-MM-DD". */
const tomorrow = (clock: RouteClock | undefined) => {
  const p = localParts(clock?.now ?? Date.now(), clock?.timeZone ?? "UTC");
  return new Date(Date.UTC(p.y, p.m - 1, p.d + 1, 12)).toISOString().slice(0, 10);
};
const hasTime = (text: string, clock?: RouteClock) => {
  const w = read(text, clock);
  return w.time !== undefined || w.at !== undefined;
};

interface Hint {
  pattern: { test(text: string, clock?: RouteClock): boolean };
  skills: readonly string[];
  force: boolean | ((text: string, clock?: RouteClock) => boolean);
  /** The hint applies only when this skill is offered (intent skills, SL-58): without it, routing is as before. */
  needs?: string;
}

// SL-58 intent skills. Sending words are imperative requests, never questions ("¿me escribió Ana un correo?").
const SEND = /(?<![\p{L}])(?:m[aá]nd[aá]?(?:le|les|me)?|env[ií][aá](?:le|les|me)?|escr[ií]b[eí](?:le|les|me)?|text|message|send|write|tell|d[ií]le|dec[ií]le|av[ií]sa(?:le|les)?)(?![\p{L}])/iu;
const WHATSAPP = /(?<![\p{L}])(?:whatsapp|wasap|wsp|guasap)(?![\p{L}])/iu;
const QUESTION = /[?¿]/;
const sending = (extra: RegExp) => ({ test: (t: string) => !QUESTION.test(t) && SEND.test(t) && extra.test(t) });
const PHONE_NUMBER = /\+?\d(?:[\s().-]{0,2}\d){6,}/;
const imperative = (verbs: string) => new RegExp(`^\\s*(?:(?:please|pls|can you|could you|porfa|por favor)[,\\s]+)?(?:${verbs})(?![\\p{L}])`, "iu");

const ALARM = phrase(String.raw`wake me( up)?|despi[eé]rta(me)?|despertame|(pon|ponme|poneme|p[oó]n|set|crea|programa|configura)(\s+\S+){0,2}\s+(una\s+|an?\s+)?(alarma|alarm)|alarma (para|a) las|alarm (for|at)`);

const INTENT_HINTS:{ alarm: Hint; contact: Hint; apps: readonly Hint[] } = {
  // US-APP-04, before "remind": an alarm in the clock app, not a reminder notification.
  // A day after tomorrow goes to a reminder: the clock app's alarm only knows the next time that clock time comes.
  alarm: {
    pattern: {
      test: (t, clock) => {
        if (!ALARM.test(t)) return false;
        const w = read(t, clock);
        return !(w.namedDay && w.date && w.date > tomorrow(clock));
      },
    },
    skills: ["set_alarm"], force: hasTime, needs: "set_alarm",
  },
  // US-APP-04, before "remember": "save this number as..." is a contact, not a fact.
  contact: {
    pattern: phrase(String.raw`(guard[aá]|agreg[aá]|añad[eí]|save|add)(\s+\S+){0,2}?\s+(n[uú]mero|number|contacto|contact)|(a|to)\s+(mis\s+|my\s+)?(contactos|contacts)|nuevo contacto|new contact|(guard[aá]|save)\s+(el\s+)?\+?\d[\d\s-]{6,}\s+(como|as)`),
    skills: ["add_contact"], force: true, needs: "add_contact",
  },
  apps: [
    { pattern: sending(/(?<![\p{L}])(?:sms|mensaje de texto|text message)(?![\p{L}])/iu), skills: ["compose_sms"], force: true, needs: "compose_sms" },
    { pattern: { test: (t) => imperative("e-?mail").test(t) || sending(/(?<![\p{L}])(?:correo|e-?mail|mail|imeil)(?![\p{L}])/iu).test(t) }, skills: ["compose_email"], force: true, needs: "compose_email" },
    // US-APP-01: a number the user gave goes straight to a new WhatsApp chat; a name may be a chat read_messages knows.
    { pattern: { test: (t) => sending(WHATSAPP).test(t) && PHONE_NUMBER.test(t) }, skills: ["open_whatsapp_chat"], force: true, needs: "open_whatsapp_chat" },
    { pattern: sending(WHATSAPP), skills: ["read_messages", "reply_message", "open_whatsapp_chat"], force: true, needs: "open_whatsapp_chat" },
    { pattern: imperative("call|dial|phone|ll[aá]ma(?:me|le)?|ll[aá]male|m[aá]rca(?:le)?|marc[aá](?:le)?"), skills: ["dial"], force: true, needs: "dial" },
    { pattern: phrase(String.raw`naveg[aá](r)? (a|al|hasta|hacia)|ll[eé]vame (a|al)|c[oó]mo llego (a|al)|indicaciones (a|al|para|hacia)|ruta (a|al|hacia)|navigate to|directions to|take me to|how do i get to|get me to`), skills: ["navigate"], force: true, needs: "navigate" },
    { pattern: imperative("share|comp[aá]rte(?:lo|la|me)?|compart[ií](?:lo|la)?|compartir"), skills: ["share"], force: true, needs: "share" },
  ],
};

const SEARCH_VERB = String.raw`busca(r|me)?|b[uú]scame|busc[aá]|investiga(r|me)?|averigua(r|me)?|search|look up|google|googlea(r|me)?`;
const SEARCH_ASKED = phrase(
  String.raw`(${SEARCH_VERB})(\s+\S+){0,10}?\s+(en|on|in) (internet|la web|la red|google|l[ií]nea|the web|the internet)|search (the web|online|the internet|google)|googlea(r|me)?|(search|look up|look)(\s+\S+){0,10}?\s+online|web search|b[uú]squeda (web|en internet)`,
);
const CURRENT_FACTS = phrase(
  String.raw`clima|el tiempo (en|de|para|ma[nñ]ana|hoy)|weather|va a llover|llover[aá]|will it rain|forecast|pron[oó]stico|noticias de hoy|[uú]ltimas noticias|latest news|news today|headlines|titulares|qui[eé]n gan[oó]|who won|resultado del partido|marcador del|score of|precio del (d[oó]lar|euro|bitcoin)|a cu[aá]nto est[aá] el (d[oó]lar|euro)|tipo de cambio|exchange rate|cotizaci[oó]n`,
);

// Multi-bot (Task 12): asking Hermit for a new bot. A creation or request verb with "a bot" as its object, a word or two
// apart at most, anywhere in a sentence: "Hermit, créame un bot que lea mis mensajes", "Quiero crear un bot…", "¿Me
// haces un bot…?", "Help me make a bot that…", "I want to make a bot that checks the weather". First, so what the bot is
// for (messages, mail, the weather) doesn't route to that skill instead. Only once create_bot is offered, and only
// Hermit's menu has it. It asks for none:
// - in a request whose words are its content, earlier in the same sentence ("recuérdame mañana crear un bot", "anota:
//   quiero un bot", "tell Ana I'll make a bot"): that request routes as before;
// - for a bot that exists or is only named: "bot" is a whole word after "un, una, otro, nuevo" or "a, an, another, new"
//   ("¿qué bots tengo?", "el bot de Telegram me escribió", "my bots", "robot", "el chatbot de mi banco").
const BOT_VERB_ES = String.raw`cr[eé][aá](?:me)?|crear(?:me)?|me\s+cre[aá]s|me\s+cre[eé]s|h[aá]z(?:me)?|hac[eé]me|hacé|hacer(?:me)?|me\s+hac[eé]s|me\s+hag[aá]s|[aá]rm[aá](?:me)?|armar(?:me)?|me\s+arm[aá]s|me\s+arm[eé]s|p[oó]nme|poneme|ponerme|me\s+pon[eé]s|me\s+pong[aá]s|agreg[aá](?:me)?|agr[eé]game|agregar(?:me)?|me\s+agreg[aá]s|me\s+agregu[eé]s|añad[eí](?:me)?|añ[aá]deme|añadir(?:me)?|me\s+añad[eí]s|me\s+añad[aá]s|quiero|quisiera|necesito|me\s+gustar[ií]a`;
/** What may stand between the verb and its object: "créame por favor un bot", "quiero tener un bot". */
const BOT_FILL_ES = String.raw`(?:\s+(?:me|te|nos|ya|porfa|por\s+favor|ahora|tambi[eé]n|tener|para\s+m[ií])){0,2}`;
const BOT_OBJECT_ES = String.raw`(?:(?:un|una|otro|otra)(?:\s+(?:nuevo|nueva|buen|peque[nñ]o|segundo))?|nuevo|nueva)\s+bot`;
const BOT_VERB_EN = String.raw`make|create|build|set\s+up|add|want|need|i['’]d\s+(?:like|love)|i\s+would\s+(?:like|love)`;
const BOT_FILL_EN = String.raw`(?:\s+(?:me|us|please|just|quickly|also|to\s+have|for\s+me)){0,2}`;
/** "a bot", "a travel bot", "a new recipe bot", "another bot", "new bot"; never a phrase about bots ("a list of bot names"). */
const BOT_OBJECT_EN = String.raw`(?:(?:a|an|another)(?:\s+(?!(?:of|for|about|with|and|or|to|the|my|your|our|their|this|that)(?![\p{L}\p{N}]))[\p{L}\p{N}'’-]+){0,2}|new)\s+bot`;
const ASK_FOR_BOT = new RegExp(
  String.raw`(?<![\p{L}\p{N}])(?:(?:${BOT_VERB_ES})${BOT_FILL_ES}\s+${BOT_OBJECT_ES}|(?:${BOT_VERB_EN})${BOT_FILL_EN}\s+${BOT_OBJECT_EN})(?![\p{L}\p{N}])`,
  "giu",
);
/** Requests whose words are their content: reminders, notes, messages and events. A bot named after one in its sentence is that content. */
const CONTENT_LEAD = phrase(
  String.raw`recu[eé]rdame|rec[oó]rdame|acu[eé]rdame|acord[aá]me|av[ií]same|recordatorios?|anota|anot[aá]|ap[uú]nta|apunt[aá]|toma\s+nota|recuerda\s+que|acu[eé]rdate|guarda\s+(?:que|esto)|dile|dec[ií]le|d[ií]gale|m[aá]ndale|env[ií]ale|escr[ií]bele|resp[oó]ndele|cont[eé]stale|ag[eé]nda(?:me|lo|la)|agendá|p[oó]n(?:me|lo|la)?\s+(?:\S+\s+){0,4}?(?:en|a|al)\s+(?:mi|el)\s+(?:calendario|agenda)` +
    String.raw`|remind\s+me|ping\s+me|nudge\s+me|don['’]?t\s+let\s+me\s+forget|reminders?|note\s+(?:that|down)|write\s+down|remember\s+(?:that|to)|keep\s+in\s+mind|(?:tell|text|message|send|e-?mail)\s+(?!(?:me|us)(?![\p{L}\p{N}]))[\p{L}\p{N}]+|reply\s+to|(?:put|add)\s+(?:it\s+|this\s+|that\s+)?(?:on|to|in)\s+my\s+calendar|schedule\s+(?:a|an)`,
);
/** A message that opens with a new bot and what it's for: "nuevo bot: recetas", "new bot for my grocery lists". */
const NEW_BOT_OPENER = new RegExp(
  String.raw`^\s*[¿¡]?\s*(?:(?:hermit|hola|hey|oye|ok|okay|please|porfa|por\s+favor)[,!\s]+)*(?:(?:un|una|a)\s+)?(?:nuevo|nueva|new)\s+bot(?:\s*:|\s+(?:para|que|de|for|that|to|which)(?![\p{L}\p{N}]))`,
  "iu",
);
const MAKE_BOT = {
  test(text: string): boolean {
    for (const m of text.matchAll(ASK_FOR_BOT)) {
      // The words before it in its sentence: there, a reminder, a note or a message makes it that request's content.
      const lead = text.slice(0, m.index ?? 0).split(/[.!?;¿¡]/u).pop() ?? "";
      if (!CONTENT_LEAD.test(lead)) return true;
    }
    return NEW_BOT_OPENER.test(text);
  },
};

// SL-55 (US-CONN-04): a request to connect a service, at the start of the message. First, so a docs link in it is the
// service to connect, not a page to read. Only once connect_service is offered.
const CONNECT = imperative(String.raw`connect(?:\s+(?:me|hermit|us))?\s+(?:to|with)|hook\s+(?:me\s+|hermit\s+)?up\s+(?:to|with)|link\s+(?:me|hermit)\s+(?:to|with)|con[eé]ct(?:a|ate|ame|ar|arme)(?:\s+hermit)?\s+(?:a|al|con)|vincul(?:a|ate|ar)(?:\s+hermit)?\s+(?:a|al|con)|enlaz(?:a|ar)(?:\s+hermit)?\s+(?:a|al|con)`);

// SL-40 (US-PAY-05): "send Ana 20 dollars", "págale 5 USD₮ a 0x...": a paying verb with money or an address, not a
// question. Only once `pay` is offered; the cage and code check everything else.
const PAY_VERB = /(?<![\p{L}])(?:send|pay|transfer|paga|p[aá]g(?:a|ale|ales|ame)|env[ií]a(?:le|les)?|m[aá]nda(?:le|les)?|transfi[eé]re(?:le|les)?|p[aá]sa(?:le|les)?)(?![\p{L}])/iu;
const MONEY = /\$\s?\d|\d(?:[.,]\d+)?\s?(?:usd₮0?|usdt0?|usd|d[oó]lar(?:es)?|dollars?|bucks)(?![\p{L}])|0x[0-9a-fA-F]{40}/iu;
const PAY_ASKED = { test: (t: string) => !QUESTION.test(t) && PAY_VERB.test(t) && MONEY.test(t) && !/(?<![\p{L}])(?:e-?mail|correo|mail|mensaje|message|text|whatsapp|sms)(?![\p{L}])/iu.test(t) };

// SL-41 (US-PAY-07): "pay for https://...", "compra el acceso a https://...", and right after read_web met a 402,
// "pay for it" or "sí, págala" (the normalizer takes the link from the user's earlier message). Before `pay`, so a
// price next to a link buys the page instead of sending money to a person. Only once `pay_merchant` is offered.
const PAY_PAGE_VERB = /(?<![\p{L}])(?:pay(?:\s+for)?|buy|purchase|paga(?:r|la|lo)?|p[aá]g(?:ale|ala|alo|ame)|compra(?:r|la|lo|me)?|c[oó]mpra(?:la|lo|me))(?![\p{L}])/iu;
const LINK = /(?:https?:\/\/|(?<![\p{L}\p{N}.@])www\.)[^\s/]+\.[^\s]+/iu;
const PAY_FOR_IT = phrase(String.raw`pay for (it|this|that|the page|access)|pay to (see|read|open) it|paga(r)? (por )?(eso|esa p[aá]gina|la p[aá]gina|el acceso)|p[aá]gala|paga para verla|s[ií],? paga(la)?`);
const PAY_PAGE = { test: (t: string) => !QUESTION.test(t) && ((PAY_PAGE_VERB.test(t) && LINK.test(t)) || PAY_FOR_IT.test(t)) };

/**
 * The words that make a message a command to reply or send ("dile que...", "tell Ana...", "reply to Ana..."). One list
 * for the reply hint and for the port's check that a status question is not a command. "a reply to my message" and "an
 * answer from Ana" name a reply, they don't ask for one; "last msg from" and "any msg from" read one. A reply or an
 * answer sent, written, posted or drafted to someone is asked for: "send a reply to Ana", "post the answer to Ana". Only
 * with "to": "did Ana send a reply?" stays a question.
 */
export const REPLY_COMMAND_WORDS = String.raw`dile a|dile que|d[ií]gale a|dec[ií]le|resp[oó]ndele|respondele|contesta(le)?|cont[eé]stale|contestale|av[ií]sale a|escr[ií]bele a|m[aá]ndale (un mensaje )?a \w+ (que|diciendo)|tell (?!me\b|us\b)\w+|text (?!me\b|us\b|messages?\b|back\b)\w+ \S+|let (?!me\b|us\b)\S+( \S+)? know|(?<!(?:a|an|any|the)\s)answer (?!me\b|us\b)\S+|send (?!me\b|us\b)\S+( \S+)? an? (message|text|msg)|(?<!(?:last|any|the)\s)msg \S+|m[aá]ndale (un )?(wasap|whatsapp|mensaje|msj) a \S+|(?<!(?:a|an|any|the)\s)reply to|(?:send|write|post|draft) (?:a|an|the) (?:reply|answer) to|write back|text (?!me\b|us\b)\w+ (back|that)|text my \w+ back|message (?!me\b|us\b)(the |my )?\S+( \S+){0,2} (that|saying)`;

const HINTS: readonly Hint[] = [
  { pattern: MAKE_BOT, skills: ["create_bot"], force: true, needs: "create_bot" },
  { pattern: CONNECT, skills: ["connect_service"], force: true, needs: "connect_service" },
  { pattern: PAY_PAGE, skills: ["pay_merchant"], force: true, needs: "pay_merchant" },
  { pattern: PAY_ASKED, skills: ["pay"], force: true, needs: "pay" },
  // US-REM-03, before "remind": "recordatorio" alone would otherwise create one.
  { pattern: phrase(String.raw`(cancel[aá]?(r)?|quit[aá](r)?|borr[aá](r)?|elimin[aá](r)?|delete|remove|cancel)(\s+\S+){0,3}\s+(recordatorio|reminder|aviso|alarma)s?|ya no me (recuerdes|avises)|no me (recuerdes|avises) (lo|eso)|don'?t remind me|stop reminding me`), skills: ["reminder_cancel"], force: true },
  { pattern: phrase(String.raw`qu[eé] recordatorios|mis recordatorios|recordatorios (tengo|pendientes)|(what|which|any) reminders|my reminders|list (my )?reminders|reminders do i have`), skills: ["reminders_list"], force: true },
  // "recordame cuál es mi placa" / "remind me what my number is": a question about a saved fact, not an alert.
  { pattern: phrase(String.raw`(recu[eé]rdame|rec[oó]rdame|remind me) (what|which|where|when|who|cu[aá]l|qu[eé]|d[oó]nde|cu[aá]ndo|c[oó]mo|qui[eé]n)`), skills: ["recall"], force: true },
  INTENT_HINTS.alarm,
  { pattern: phrase(String.raw`recu[eé]rdame|rec[oó]rdame|av[ií]same|acu[eé]rdame|remind me|set an? (reminder|alarm)|alarma|recordatorio|ping me|nudge me|wake me up|no me dejes olvidar(lo|la)?|se me va a olvidar|que no se me (pase|olvide)|no se me (vaya a )?olvide|ojal[aá] no se me olvide|no (te )?olvides|don'?t let me forget|don'?t forget to|do not forget to|i always forget to|i keep forgetting to`), skills: ["remind"], force: hasTime },
  INTENT_HINTS.contact,
  { pattern: phrase(String.raw`recuerda que|acu[eé]rdate (de )?que|acord[aá]te (de )?que|acord[aá]te|anota que|toma nota|guarda esto|remember that|don'?t forget that|note that|keep in mind|save this`), skills: ["remember"], force: true },
  { pattern: phrase(String.raw`(?<!no (te )?)olvida|olvidate|borra lo|borr[aá] (lo|la nota|el dato|mi)|elimina(r|l[aá])? (lo|la nota|el dato|mi)|(?<!(don'?t|do not|never) )forget|erase what|delete what you know|delete (the|my) (note|fact|saved)|delete the (thing|stuff|part|bit) about|borr[aá] lo de|remove (the|my) (note|saved)`), skills: ["forget"], force: true },
  // Mail writes (SL-49), before the mail reads and the WhatsApp reply: "responde el correo de Luis" is mail.
  // The reads ride along so the model can find the message first. Only offered once mail is wired.
  { pattern: phrase(String.raw`reenv[ií]a\p{L}*|reenviar\p{L}*|forward(s|ed|ing)?`), skills: ["mail_forward", "mail_search", "mail_list", "mail_read"], force: true },
  {
    pattern: phrase(String.raw`(responde|resp[oó]ndele|respond[eé]|contesta|cont[eé]stale|contest[aá]|reply to|answer|respond to)(\s+\S+){0,4}\s+(correos?|e-?mails?|mails?)|(reply|respond)( to)? (that|this|the|his|her) (e-?mail|mail)`),
    skills: ["mail_reply", "mail_search", "mail_list", "mail_read"],
    force: true,
  },
  { pattern: phrase(String.raw`borrador(es)?|drafts?|redacta(r|me)?(\s+\S+){0,2}\s+(un |el )?(correo|e-?mail|mail)`), skills: ["mail_draft", "mail_search", "mail_list", "mail_read"], force: true },
  {
    pattern: phrase(String.raw`arch[ií]va(r|los|las|lo|la|me)?|archive|archiving|m[aá]rca(los|las|lo|la)? como le[ií]d\p{L}*|mark (\S+ ){0,3}(as )?read|etiquet\p{L}*|label (them|these|those|it|the|my)`),
    skills: ["mail_modify", "mail_list", "mail_search"],
    force: true,
  },
  { pattern: phrase(String.raw`(manda|m[aá]ndale|env[ií]a|env[ií]ale|escr[ií]bele|escribe|send|write)(\s+\S+){0,3}\s+(un |an? )?(correo|e-?mail|mail)|e-?mail \S+@\S+`), skills: ["mail_send"], force: true },
  // Mail (SL-48), before "qué tengo": "¿qué tengo en mi correo?" is the inbox. Only offered once mail is wired.
  { pattern: phrase(String.raw`(busca|b[uú]scame|buscar|encuentra|encu[eé]ntrame|find|search|look for)(\s+\S+){0,5}\s+(correos?|e-?mails?|mails?|inbox|bandeja)|search my (e-?mails?|mail|inbox)`), skills: ["mail_search"], force: true },
  {
    pattern: phrase(String.raw`(algo|qu[eé]) (importante|nuevo|urgente)( hay)? en (mi|el) (correo|e-?mail|mail|bandeja|inbox)|anything (important|new|urgent) in my (e-?mails?|inbox|mail)|(correos?|e-?mails?|mails?) (nuevos?|sin leer|no le[ií]dos?|importantes?)|(new|unread|important) (e-?mails?|mails?)|(revisa|rev[ií]same|chequea|checa|mira|lee|l[eé]eme|resume|res[uú]meme|resumen de)(\s+\S+)? (mi|mis|el|los) (correos?|e-?mails?|mails?|bandeja|inbox)|(check|read|summari[sz]e|go through) my (e-?mails?|mail|inbox)|(what'?s|anything) in my (inbox|e-?mail|mail)|qu[eé] (hay|tengo) en mi (correo|bandeja|e-?mail)|tengo (correos?|e-?mails?)`),
    skills: ["mail_list"],
    force: true,
  },
  // Reading questions first: "what's on my calendar" must not match calendar_add's "on my calendar".
  { pattern: phrase(String.raw`qu[eé] tengo|tengo algo|c[oó]mo tengo|what('?s| is) on my (calendar|schedule|agenda)|what do i have|anything on my|am i (busy|free)|estoy (libre|ocupad[oa])|qu[eé] hay en mi (agenda|calendario)`), skills: ["calendar_read"], force: true },
  {
    pattern: phrase(String.raw`ag[eé]ndame|ag[eé]ndale|agend[aá](r|me)?\s+(un|una|el|la|almuerzo|cena|cita|reuni[oó]n|llamada)\s|(pon|ponme|poneme|anota|agrega|agregá|añade|mete|m[eé]teme|metele|m[eé]tele)(\s+\S+){0,6}\s+(en|a|al)\s+(mi\s+|el\s+)?(calendario|agenda)|en mi (calendario|agenda)|agenda(r)?\s+(un|una)\s+\S+|(to|in|on) my calendar|schedule (a|an|my)\s+\S+(\s+\S+){0,4}\s+(on|at|for|tomorrow|today)|block\s+\S+(\s+\S+)?\s+(on|for|from|tomorrow)`),
    skills: ["calendar_add"],
    force: hasTime,
  },
  ...INTENT_HINTS.apps,
  { pattern: phrase(REPLY_COMMAND_WORDS), skills: ["reply_message", "read_messages"], force: true },
  { pattern: phrase(String.raw`qu[eé] me perd[ií]|what did i miss|ponme al d[ií]a|catch me up|qu[eé] hay de nuevo|resum(en|eme|ir|e|[ií])( de)? (mis|los) (mensajes|chats)|summari[sz]e my (messages|chats)|me escribi[oó]|me escribieron|me dijo|q dijo|me mand[oó] algo|me contest[oó]|(see|check) if (my )?\S+ (answered|replied|wrote|texted)|revis[aá] (el grupo|mis mensajes|el chat|los mensajes)|fij[aá]te si \S+ (contest[oó]|respondi[oó]|escribi[oó])|what \w+ (said|wrote|texted)|if \w+ (wrote|texted|replied|answered)|texted me|text me\??$|did \w+ (write|text)|(último|ultimo|last) mensaje|mensajes de|messages from|\w+'s messages|new (messages|whatsapps?)|mensajes nuevos`), skills: ["read_messages"], force: true },
  // US-WEB-01: a link in the user's words is a page to read. After reminders, memory and replies ("recuérdame leer
  // https://...", "dile a Ana que lea https://..." stay those), before the loose mail, message and recall hints.
  { pattern: /(?:https?:\/\/|(?<![\p{L}\p{N}.@])www\.)[^\s/]+\.[^\s]+/iu, skills: ["read_web"], force: true },
  // US-WEB-03: the user asks to search the web, in so many words: a search must run. After the link (a link is a page
  // to read) and after mail search ("busca el correo de Luis" is the inbox). Only once search_web is offered.
  { pattern: SEARCH_ASKED, skills: ["search_web"], force: true, needs: "search_web" },
  // Current facts the model can't know (weather, today's news, results, prices): search is offered, unforced, so the
  // model still decides. Without search_web on the menu these stay out of scope.
  { pattern: CURRENT_FACTS, skills: ["search_web"], force: false, needs: "search_web" },
  // Any other mention of the user's mailbox: the mail skills, unforced. Not "mi correo" or "my email" alone:
  // "¿cuál es mi correo?" asks for a saved address and stays with recall.
  { pattern: phrase(String.raw`mis correos|my e-?mails|my mail|my inbox|gmail|outlook|bandeja de entrada|e-?mails? (from|de)`), skills: ["mail_list", "mail_search", "mail_read"], force: false },
  { pattern: phrase(String.raw`mensajes?|whatsapps?|messages?`), skills: ["read_messages"], force: false },
  { pattern: phrase(String.raw`mi agenda|mi calendario|my calendar|my schedule|agenda de`), skills: ["calendar_read"], force: false },
  
  {
    // Questions about the user's own life: never answered from the model's knowledge.
    pattern: /¿[^?]*(?<![\p{L}])(mi|mis|era|ten[ií]a|soy)(?![\p{L}])[^?]*\?|^(?![^.!?]*(?<![\p{L}])(capital|presidente?|president|poblaci[oó]n|population|idioma|language|moneda|currency|clima|weather|traduc|translat)(?![\p{L}]))\s*¿?\s*(cu[aá]l|cu[aá]ndo|d[oó]nde|qu[eé]|c[oó]mo|qui[eé]n|cu[aá]nto|what|when|where|how|which|who)(?![\p{L}])[^.!?]*(?<![\p{L}])(mi|mis|nuestr[oa]s?|my|our)(?![\p{L}])|(?<![\p{L}])(what'?s|what is|what was|what are|whats) (my|the \w+ (code|password|number|size))|where did i|when('s| is) my|what am i|(gimme|give me|tell me|send me) my|(d[aá]me|p[aá]same|decime|dime) mi(?![\p{L}])/iu,
    skills: ["recall"],
    force: true,
  },
];

export interface Route<T> {
  skills: readonly T[];
  /** Call one of these skills (tool_choice "required"). */
  force: boolean;
  /** Nothing on the menu does this (calls, purchases, payments, bookings, weather): answer in words only. */
  outOfScope?: boolean;
}

/**
 * Requests no skill can do. Checked only after every skill hint, so "recuérdame llamar a mamá" is still a
 * reminder. A model without restraint training (Qwen3.5-0.8B base) called a tool on 11 of 12 such requests.
 */
const OUT_OF_SCOPE = phrase(String.raw`ll[aá]m[aá](me|le)? a|marc[aá](le)? a|call (my|me|mom|dad|\w+ now)|c[oó]mpra(me)?|compr[aá]|buy|order( me)?|p[ií]de(me)?|ped[ií](me)?|paga(r)? (mi|la|el)|pay (my|the)|transf[ie]ere|transfer[ií]|send \$|env[ií]a(le)? (plata|dinero)|reserva(me)?|book (me|a|an)|va a llover|clima|weather|will it rain|uber|taxi`);

export function routeIntent<T extends Pick<SkillDef, "id">>(userText: string, offered: readonly T[], clock?: RouteClock): Route<T> {
  for (const h of HINTS) {
    if (h.needs && !offered.some((s) => s.id === h.needs)) continue;
    if (!h.pattern.test(userText, clock)) continue;
    const narrowed = offered.filter((s) => h.skills.includes(s.id as string));
    if (!narrowed.length) continue;
    return { skills: narrowed, force: typeof h.force === "function" ? h.force(userText, clock) : h.force };
  }
  return OUT_OF_SCOPE.test(userText) ? { skills: offered, force: false, outOfScope: true } : { skills: offered, force: false };
}

/**
 * Several requests in one message ("recuérdame mañana a las 9 llamar al banco y anota que mi cuenta es 1234"):
 * split at conjunctions that start a new request, route each clause. Clauses that route to the same skills
 * merge. One clause (the common case) is just routeIntent.
 */

export function planIntents<T extends Pick<SkillDef, "id">>(userText: string, offered: readonly T[], clock?: RouteClock): Array<Route<T>> {
  const clauses = splitClauses(userText);
  const plan: Array<Route<T>> = [];
  for (const c of clauses) {
    const r = routeIntent(c, offered, clock);
    if (r.skills.length === offered.length) continue; // no hint in this clause
    const key = r.skills.map((s) => s.id).join(",");
    if (!plan.some((p) => p.skills.map((s) => s.id).join(",") === key)) plan.push(r);
  }
  return plan;
}

export function narrowMenu<T extends Pick<SkillDef, "id">>(userText: string, offered: readonly T[], clock?: RouteClock): readonly T[] {
  return routeIntent(userText, offered, clock).skills;
}
