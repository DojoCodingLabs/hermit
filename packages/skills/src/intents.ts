import { emailFromUser, emailList, emailsIn, extractWhen, phoneFromUser, phonesIn, skillId, splitClauses, type JsonSchema, type NormalizeContext, type SkillDef, type SummaryLabelId } from "@hermit/core";
import { foundLines, personArg } from "./found.ts";
import { valueOr } from "./values.ts";

/**
 * Intent skills (FR-APP-01, US-APP-01 to US-APP-04): open another app with the fields prefilled. The person sends,
 * calls, saves or confirms there; Hermit never completes the action. Risk local_write, so they run without a sheet
 * in a clean session and ask once the session has read other people's text.
 */

type Args = Record<string, unknown>;
type Normalized = { args: Args; notes: string[] };

const obj = (properties: Record<string, JsonSchema>, required: string[]): JsonSchema => ({ type: "object", properties, required, additionalProperties: false });
const str = (description: string, extra: JsonSchema = {}): JsonSchema => ({ type: "string", description, ...extra });
const s = (v: unknown) => (typeof v === "string" ? v.trim() : "");

// No pattern on numbers: a name written into the field must not cost a repair strike. Code checks them instead.
const PHONE = str("Phone number exactly as the user said it in this message; leave out if they gave none", { maxLength: 40 });
const EMAIL = str("Email address exactly as the user wrote it in this message; leave out if they gave none", { maxLength: 200 });

/** FR-APP-02 for a phone field: keep only digits the user wrote this turn; fill it when they wrote exactly one. */
function userPhone(args: Args, ctx: NormalizeContext): Normalized {
  const given = s(args.phone);
  if (given) {
    const mine = phoneFromUser(given, ctx.userText);
    if (mine === given) return { args, notes: [] };
    if (mine) return { args: { ...args, phone: mine }, notes: [`phone: ${given} -> ${mine} (as the user wrote it)`] };
    const rest = { ...args };
    delete rest.phone;
    return { args: rest, notes: [`phone: dropped "${given}", not in the user's words`] };
  }
  const said = phonesIn(ctx.userText);
  return said.length === 1 ? { args: { ...args, phone: said[0] }, notes: [`phone: ${said[0]} from the user's words`] } : { args, notes: [] };
}

/** FR-APP-02 for an email field: keep only addresses the user wrote this turn; fill from the words when empty. */
function userEmails(field: "to" | "email", args: Args, ctx: NormalizeContext, many: boolean): Normalized {
  const given = emailList(args[field]);
  const kept = given.map((e) => emailFromUser(e, ctx.userText)).filter((e): e is string => e !== undefined);
  const said = emailsIn(ctx.userText);
  const use = given.length ? kept : many ? said : said.length === 1 ? said : [];
  const value = (many ? use : use.slice(0, 1)).join(", ");
  if (value === s(args[field])) return { args, notes: [] };
  const rest = { ...args };
  delete rest[field];
  const dropped = given.filter((e) => !kept.includes(e.toLowerCase()));
  const notes = [...(dropped.length ? [`${field}: dropped ${dropped.join(", ")}, not in the user's words`] : []), ...(value ? [`${field}: ${value} from the user's words`] : [])];
  return { args: value ? { ...rest, [field]: value } : rest, notes };
}

/** "text Carlos on WhatsApp that I'm on my way" -> "I'm on my way": the user's own message, when they gave one. */
const INSTRUCTION = /^\s*(?:(?:por favor|porfa|please|pls)[,\s]+)?(?:text|message|send|write|tell|sms|whatsapp|email|e-mail|m[aá]nd[aá](?:le)?|env[ií][aá](?:le)?|escr[ií]b[eí](?:le)?|d[ií]le|dec[ií]le|av[ií]sale)(?![\p{L}])/iu;
const SAYING = /(?<![\p{L}])(?:que|that|diciendo(?:\s+que)?|saying)\s+([\s\S]+)$/iu;

function userMessage(field: "text" | "body", args: Args, ctx: NormalizeContext): Normalized {
  const clause = splitClauses(ctx.userText).find((c) => INSTRUCTION.test(c));
  const m = clause ? SAYING.exec(clause) : null;
  const said = m?.[1]?.trim().replace(/[.!]+$/, "");
  if (!said || said.length < 2) return { args, notes: [] };
  const text = said.charAt(0).toUpperCase() + said.slice(1);
  return text === args[field] ? { args, notes: [] } : { args: { ...args, [field]: text }, notes: [`${field}: the message as the user said it`] };
}

const chain = (...steps: Array<(a: Args, c: NormalizeContext) => Normalized>) => (args: Args, ctx: NormalizeContext): Normalized =>
  steps.reduce<Normalized>((acc, step) => {
    const r = step(acc.args, ctx);
    return { args: r.args, notes: [...acc.notes, ...r.notes] };
  }, { args, notes: [] });

const DESTINATION = /(?:naveg[aá](?:r)?\s+(?:hasta\s+|hacia\s+)?(?:a\s+la|al|a)|ll[eé]vame\s+(?:a\s+la|al|a)|c[oó]mo\s+llego\s+(?:a\s+la|al|a)|indicaciones\s+(?:para\s+llegar\s+)?(?:a\s+la|al|a|para|hacia)|ruta\s+(?:a\s+la|al|a|hacia)|navigate\s+to|directions\s+to|take\s+me\s+to|how\s+do\s+i\s+get\s+to|get\s+me\s+to)\s+(.+?)[.!?]*$/iu;

function userDestination(args: Args, ctx: NormalizeContext): Normalized {
  const said = DESTINATION.exec(ctx.userText)?.[1]?.trim();
  if (!said || said === args.destination) return { args, notes: [] };
  return { args: { ...args, destination: said }, notes: ["destination: the user's own words"] };
}

function userAlarmTime(args: Args, ctx: NormalizeContext): Normalized {
  const time = extractWhen(ctx.userText, ctx.now, ctx.timeZone).time;
  if (!time || time === args.time) return { args, notes: [] };
  return { args: { ...args, time }, notes: [`time: ${String(args.time)} -> ${time} (from the user's words)`] };
}

const line = (label: string, labelKey: SummaryLabelId, v: unknown) => (s(v) ? [{ label, labelKey, value: s(v) }] : []);

export const intentSkills: readonly SkillDef<Args>[] = [
  {
    id: skillId("open_whatsapp_chat"), version: 1, risk: "local_write", producesUntrusted: false,
    menuLine: "Open WhatsApp on a new chat with a message ready; the user taps Send there (\"text Carlos on WhatsApp that...\", \"mándale un WhatsApp al 8888 1234 que...\"). For chats read_messages returned, use reply_message.",
    args: obj({ phone: PHONE, person: personArg("phone"), text: str("The message itself, in the language the user would use with that person", { maxLength: 1000 }) }, ["text"]),
    recipient: { field: "phone", kind: "phone" },
    normalize: chain(userPhone, (a, c) => userMessage("text", a, c)),
    describeAction: (a, ctx) => ({ title: "Open WhatsApp with this message?", lines: [{ label: "To", labelKey: "to", ...valueOr(a.phone, "You pick the chat in WhatsApp", "pickChatWhatsapp") }, ...foundLines(ctx, "phone", [s(a.phone)]), { label: "Message", labelKey: "message", value: s(a.text) }] }),
  },
  {
    id: skillId("compose_sms"), version: 1, risk: "local_write", producesUntrusted: false,
    menuLine: "Open the SMS app with a text message written, for the user to review and send (\"send an SMS to...\", \"mándale un mensaje de texto a...\"). Not for WhatsApp.",
    args: obj({ phone: PHONE, person: personArg("phone"), body: str("The message itself", { maxLength: 1000 }) }, ["body"]),
    recipient: { field: "phone", kind: "phone" },
    normalize: chain(userPhone, (a, c) => userMessage("body", a, c)),
    describeAction: (a, ctx) => ({ title: "Open your messages app with this text?", lines: [{ label: "To", labelKey: "to", ...valueOr(a.phone, "You pick the person in the app", "pickPersonApp") }, ...foundLines(ctx, "phone", [s(a.phone)]), { label: "Message", labelKey: "message", value: s(a.body) }] }),
  },
  {
    id: skillId("compose_email"), version: 1, risk: "local_write", producesUntrusted: false,
    menuLine: "Open the email app with an email written (recipients, subject, body) for the user to review and send (\"email Ana the notes\", \"escríbele un correo a...\").",
    args: obj({
      to: str("Email addresses the user wrote in this message, comma separated; leave out if none", { maxLength: 400 }),
      person: personArg("email"),
      subject: str("Short subject", { maxLength: 200 }),
      body: str("The email text", { maxLength: 4000 }),
    }, ["body"]),
    recipient: { field: "to", kind: "email" },
    normalize: (a, c) => userEmails("to", a, c, true),
    describeAction: (a, ctx) => ({ title: "Open your email app with this email?", lines: [{ label: "To", labelKey: "to", ...valueOr(a.to, "You add who it goes to in the app", "addRecipientApp") }, ...foundLines(ctx, "to", emailList(a.to)), ...line("Subject", "subject", a.subject), { label: "Message", labelKey: "message", value: s(a.body) }] }),
  },
  {
    id: skillId("dial"), version: 1, risk: "local_write", producesUntrusted: false,
    menuLine: "Open the phone dialer with a number ready; the user taps call there, Hermit never calls (\"call Mom\", \"llama al 8888 1234\", \"márcale a...\").",
    args: obj({ phone: PHONE, person: personArg("phone") }, []),
    recipient: { field: "phone", kind: "phone" },
    normalize: userPhone,
    describeAction: (a, ctx) => ({ title: "Open the dialer?", lines: [{ label: "Number", labelKey: "number", ...valueOr(a.phone, "You pick who to call in the dialer", "pickNumberDialer") }, ...foundLines(ctx, "phone", [s(a.phone)])] }),
  },
  {
    id: skillId("navigate"), version: 1, risk: "local_write", producesUntrusted: false,
    menuLine: "Open the maps app on a destination to get directions (\"navigate to the dentist\", \"llévame al aeropuerto\", \"¿cómo llego a...?\").",
    args: obj({ destination: str("The place or address, in the user's words", { maxLength: 200 }) }, ["destination"]),
    normalize: userDestination,
    describeAction: (a) => ({ title: "Open maps?", lines: [{ label: "Destination", labelKey: "destination", value: s(a.destination) }] }),
  },
  {
    id: skillId("share"), version: 1, risk: "local_write", producesUntrusted: false,
    menuLine: "Open the share sheet with a text or link so the user picks the app to share it with (\"share this link\", \"compártelo\").",
    args: obj({ text: str("The text or link to share", { maxLength: 2000 }) }, ["text"]),
    describeAction: (a) => ({ title: "Share this?", lines: [{ label: "Text", labelKey: "text", value: s(a.text) }] }),
  },
  {
    id: skillId("set_alarm"), version: 1, risk: "local_write", producesUntrusted: false,
    menuLine: "Set an alarm in the clock app for a time in the next 24 hours; the user confirms there (\"wake me at 6\", \"pon una alarma a las 5:30\"). For a reminder message or a later day, use remind.",
    args: obj({ time: str("Alarm time as HH:MM on the 24-hour clock"), label: str("Short label, if the user gave one", { maxLength: 80 }) }, ["time"]),
    normalize: userAlarmTime,
    describeAction: (a) => ({ title: "Set this alarm?", lines: [{ label: "Time", labelKey: "time", value: s(a.time) }, ...line("Label", "label", a.label)] }),
  },
  {
    id: skillId("add_contact"), version: 1, risk: "local_write", producesUntrusted: false,
    menuLine: "Open the contacts app with a new contact filled in; the user saves it there (\"save this number as Ana's work\", \"guarda el 8888 1234 como Pedro\").",
    args: obj({ name: str("The contact's name as the user said it", { maxLength: 80 }), phone: PHONE, email: EMAIL }, ["name"]),
    normalize: chain(userPhone, (a, c) => userEmails("email", a, c, false)),
    describeAction: (a) => ({ title: "Add this contact?", lines: [{ label: "Name", labelKey: "name", value: s(a.name) }, ...line("Phone", "phone", a.phone), ...line("Email", "email", a.email)] }),
  },
];

const byId = new Map(intentSkills.map((sk) => [sk.id as string, sk]));

export function intentSkillById(id: string): SkillDef<Args> | undefined {
  return byId.get(id);
}
