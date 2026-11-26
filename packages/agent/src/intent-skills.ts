import { buildIntent, emailFromUser, emailList, phoneFromUser, type IntentLauncherPort } from "@hermit/core";
import { intentSkills } from "@hermit/skills";
import type { SkillResult, SkillRuntime } from "./types.ts";

export interface IntentSkillDeps {
  launcher: IntentLauncherPort;
  /** Copy for the code-written answer (`HM-CHAT-01.opened.*`), in the language of the user's words this turn. */
  say(key: string, userText: string, vars?: Record<string, string>): string;
}

const K = (name: string) => `HM-CHAT-01.opened.${name}`;
const s = (v: unknown) => (typeof v === "string" ? v.trim() : "");
const digits = (v: string) => v.replace(/\D/g, "");

/** What the model reads after the other app opened: it must never report the action as done. */
const OPENED: Record<string, string> = {
  open_whatsapp_chat: "WhatsApp is open with the message ready. Nothing was sent: the user taps Send in WhatsApp.",
  compose_sms: "The messages app is open with the text ready. Nothing was sent: the user sends it there.",
  compose_email: "The email app is open with the email ready. Nothing was sent: the user sends it there.",
  dial: "The dialer is open. No call was placed: the user taps call there.",
  navigate: "The maps app is open on the destination. Nothing was sent.",
  share: "The share sheet is open. Nothing was sent: the user picks where to share it.",
  set_alarm: "The clock app is open with the alarm. Nothing was sent: the user confirms the alarm there.",
  add_contact: "The contacts app is open with the new contact. Nothing was sent: the user saves it there.",
};

/**
 * FR-APP-01: each intent skill builds an intent and hands it to the launcher; the other app's own screen is where the
 * person acts. FR-APP-02 is checked again here, after the normalizer: a phone number or email address the user didn't
 * write this turn opens nothing. The turn ends with a code-written answer, so the model can't claim it was sent.
 */
export function intentSkillRuntimes(deps: IntentSkillDeps): SkillRuntime[] {
  return intentSkills.map((def) => ({
    def,
    async execute(args, ctx): Promise<SkillResult> {
      const said = ctx.userText ?? "";
      const phone = s(args.phone);
      const emails = [...emailList(args.to), ...emailList(args.email)];
      // PDR-028: or one code found by name this turn, which the user saw on the sheet and approved.
      const found = ctx.found ?? [];
      const foundPhone = phone ? found.find((f) => f.kind === "phone" && f.field === "phone" && digits(f.value) === digits(phone))?.value : undefined;
      const foundEmail = (e: string) => found.some((f) => f.kind === "email" && f.value === e.trim().toLowerCase());
      if ((phone && !phoneFromUser(phone, said) && !foundPhone) || emails.some((e) => !emailFromUser(e, said) && !foundEmail(e))) {
        return { ok: false, modelText: "That number or address isn't in the user's own words, so nothing was opened.", reply: deps.say(K("not_yours"), said) };
      }
      // The intent carries the user's own form of the number (or the contact's), never the model's (a "+" or country
      // code the model added would change which number is dialed).
      const userPhone = phone ? (phoneFromUser(phone, said) ?? foundPhone) : undefined;
      const spec = buildIntent(def.id, userPhone ? { ...args, phone: userPhone } : args);
      if (!spec) {
        return { ok: false, modelText: def.id === "set_alarm" ? "The alarm time must be HH:MM on the 24-hour clock. Nothing was opened." : "Something needed is missing. Nothing was opened." };
      }
      if ((await deps.launcher.open(spec)) === "no_app") {
        return { ok: false, modelText: "No app on this phone can do that. Nothing was opened.", reply: deps.say(K("no_app"), said) };
      }
      return { ok: true, modelText: OPENED[def.id] ?? "The app is open. Nothing was sent.", reply: answer(def.id, args, said) };
    },
  }));

  function answer(id: string, args: Record<string, unknown>, said: string): string {
    const phone = s(args.phone);
    switch (id) {
      case "open_whatsapp_chat": {
        if (!phone) return deps.say(K("open_whatsapp_chat_pick"), said);
        const opened = deps.say(K("open_whatsapp_chat"), said);
        // wa.me needs the country code; a local number may be refused by WhatsApp.
        return phone.startsWith("+") ? opened : `${opened}\n\n${deps.say(K("country_code"), said)}`;
      }
      case "dial":
        return deps.say(K(phone ? "dial" : "dial_pick"), said);
      case "navigate":
        return deps.say(K("navigate"), said, { destination: s(args.destination) });
      case "set_alarm":
        return deps.say(K("set_alarm"), said, { time: s(args.time) });
      case "add_contact":
        return deps.say(K("add_contact"), said, { name: s(args.name) });
      default:
        return deps.say(K(id), said);
    }
  }
}
