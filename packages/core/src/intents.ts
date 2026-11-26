/**
 * Intent skills (FR-APP-01): Hermit builds an Android intent with prefilled fields and hands it to another app.
 * The other app's own screen is where the person sends, calls, saves or confirms; Hermit never completes the action.
 * Pure: the phone adapter only starts the activity the spec describes.
 */

/** Every action an intent skill may start. ACTION_CALL and anything that acts without a screen are not here. */
export const INTENT_ACTIONS = [
  "android.intent.action.VIEW",
  "android.intent.action.SENDTO",
  "android.intent.action.SEND",
  "android.intent.action.DIAL",
  "android.intent.action.SET_ALARM",
  "android.intent.action.INSERT",
] as const;

export type IntentAction = (typeof INTENT_ACTIONS)[number];

export interface IntentSpec {
  action: IntentAction;
  data?: string;
  /** MIME type. */
  type?: string;
  extras?: Record<string, string | boolean | string[]>;
  /** Extras the target app reads as Java ints (the alarm's hour and minutes). */
  intExtras?: Record<string, number>;
  /** Wrap in the system chooser (the share sheet). */
  chooser?: boolean;
}

/** "opened": the other app is on screen. "no_app": nothing on this phone handles it. */
export type IntentOutcome = "opened" | "no_app";

/** Starts the activity a spec describes (the phone adapter). Never sends, calls or saves by itself. */
export interface IntentLauncherPort {
  open(spec: IntentSpec): Promise<IntentOutcome>;
}

export const INTENT_SKILLS = ["open_whatsapp_chat", "compose_sms", "compose_email", "dial", "navigate", "share", "set_alarm", "add_contact"] as const;
export type IntentSkill = (typeof INTENT_SKILLS)[number];

const digits = (s: string) => s.replace(/\D/g, "");
/** "+50688881234" keeps the plus the person wrote; otherwise digits only. */
const canonicalPhone = (s: string) => (s.trim().startsWith("+") ? "+" : "") + digits(s);

/** Phone numbers in the text, as written (7 to 15 digits). Dates, times, codes and amounts are not numbers. */
export function phonesIn(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(/(?<![\p{L}\p{N}+])\+?\d(?:[\s().-]{0,2}\d)+(?![\p{L}\p{N}])/gu)) {
    const raw = m[0];
    if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) continue;
    const n = digits(raw).length;
    if (n < 7 || n > 15) continue;
    out.push(canonicalPhone(raw));
  }
  return out;
}

/** Email addresses in the text, lowercased. */
export function emailsIn(text: string): string[] {
  return [...text.matchAll(/[\p{L}\p{N}._%+-]+@[\p{L}\p{N}.-]+\.[\p{L}]{2,}/gu)].map((m) => m[0].toLowerCase());
}

/**
 * FR-APP-02: the number the model gave, only if the user wrote those exact digits in this turn. Returned as the
 * user wrote it. A country code the model added is a guess, so it doesn't match.
 */
export function phoneFromUser(model: string, userText: string): string | undefined {
  const want = digits(model);
  if (!want) return undefined;
  return phonesIn(userText).find((p) => digits(p) === want);
}

/** FR-APP-02: the address the model gave, only if the user wrote it in this turn. */
export function emailFromUser(model: string, userText: string): string | undefined {
  const want = model.trim().toLowerCase();
  return emailsIn(userText).find((e) => e === want);
}

/** "HH:MM" or "H:MM" on the 24-hour clock. */
export function parseClock(v: unknown): { hour: number; minutes: number } | undefined {
  const m = typeof v === "string" ? /^\s*(\d{1,2}):(\d{2})\s*$/.exec(v) : null;
  if (!m) return undefined;
  const hour = Number(m[1]);
  const minutes = Number(m[2]);
  return hour <= 23 && minutes <= 59 ? { hour, minutes } : undefined;
}

const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
const enc = encodeURIComponent;
const EXTRA = (name: string) => `android.intent.extra.${name}`;

/** Splits "a@x.com, b@y.org" into addresses. */
export function emailList(v: unknown): string[] {
  return str(v).split(/[\s,;]+/).map((e) => e.trim()).filter(Boolean);
}

/** The intent for a skill's (already checked) arguments, or undefined when it can't be built. */
export function buildIntent(skill: string, args: Record<string, unknown>): IntentSpec | undefined {
  switch (skill) {
    case "open_whatsapp_chat": {
      // wa.me takes the international number without the plus; no number opens WhatsApp's own chat picker.
      return { action: "android.intent.action.VIEW", data: `https://wa.me/${digits(str(args.phone))}?text=${enc(str(args.text))}` };
    }
    case "compose_sms": {
      const phone = str(args.phone);
      return { action: "android.intent.action.SENDTO", data: `smsto:${phone ? canonicalPhone(phone) : ""}`, extras: { sms_body: str(args.body) } };
    }
    case "compose_email": {
      const to = emailList(args.to);
      const subject = str(args.subject);
      const body = str(args.body);
      const query = [subject ? `subject=${enc(subject)}` : "", body ? `body=${enc(body)}` : ""].filter(Boolean).join("&");
      const extras: Record<string, string | string[]> = {};
      if (to.length) extras[EXTRA("EMAIL")] = to;
      if (subject) extras[EXTRA("SUBJECT")] = subject;
      if (body) extras[EXTRA("TEXT")] = body;
      return { action: "android.intent.action.SENDTO", data: `mailto:${to.map(enc).join(",").replace(/%40/g, "@")}${query ? `?${query}` : ""}`, extras };
    }
    case "dial": {
      const phone = str(args.phone);
      return phone ? { action: "android.intent.action.DIAL", data: `tel:${canonicalPhone(phone)}` } : { action: "android.intent.action.DIAL" };
    }
    case "navigate": {
      const destination = str(args.destination);
      if (!destination) return undefined;
      return { action: "android.intent.action.VIEW", data: `geo:0,0?q=${enc(destination)}` };
    }
    case "share": {
      const text = str(args.text);
      if (!text) return undefined;
      return { action: "android.intent.action.SEND", type: "text/plain", extras: { [EXTRA("TEXT")]: text }, chooser: true };
    }
    case "set_alarm": {
      const clock = parseClock(args.time);
      if (!clock) return undefined;
      const label = str(args.label);
      return {
        action: "android.intent.action.SET_ALARM",
        // SKIP_UI false: the clock app shows the alarm and the person confirms it.
        extras: { ...(label ? { [EXTRA("alarm.MESSAGE")]: label } : {}), [EXTRA("alarm.SKIP_UI")]: false },
        intExtras: { [EXTRA("alarm.HOUR")]: clock.hour, [EXTRA("alarm.MINUTES")]: clock.minutes },
      };
    }
    case "add_contact": {
      const name = str(args.name);
      if (!name) return undefined;
      const phone = str(args.phone);
      const email = str(args.email);
      return {
        action: "android.intent.action.INSERT",
        // ContactsContract.RawContacts.CONTENT_TYPE; the extras are ContactsContract.Intents.Insert's keys.
        type: "vnd.android.cursor.dir/raw_contact",
        extras: { name, ...(phone ? { phone: canonicalPhone(phone) } : {}), ...(email ? { email: email.toLowerCase() } : {}), finishActivityOnSaveCompleted: true },
      };
    }
    default:
      return undefined;
  }
}
