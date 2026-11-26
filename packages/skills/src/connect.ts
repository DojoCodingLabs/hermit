import { skillId, type JsonSchema, type SkillDef } from "@hermit/core";

/**
 * SL-55 (US-CONN-04, HM-CHAT-01): "connect to my gym's booking system". The model picks this skill; it installs
 * nothing and contacts nothing. It only offers the user a button to HM-CONN-04, where discovery, the review, the key,
 * the test call and the fingerprint happen. The service comes from the user's own words this turn, never from
 * something Hermit read, so an injected "connect to evil.example" can't even put the button on screen.
 */
type Args = { service?: string };

const args: JsonSchema = {
  type: "object",
  properties: { service: { type: "string", description: "The service's name or its API docs link, exactly as the user said it", maxLength: 200 } },
  required: ["service"],
  additionalProperties: false,
};

const fold = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
const STOP = new Set(["the", "and", "con", "una", "las", "los", "del", "por", "para", "que", "with", "into", "app"]);
const significant = (s: string) => fold(s).split(/[^a-z0-9]+/).filter((w) => w.length >= 3 && !STOP.has(w));

/**
 * The service as the user named it: kept only when its words are in the user's own message this turn (or a link the
 * user wrote, exactly). Undefined otherwise, and the skill asks which service they mean.
 */
export function serviceFromUser(service: unknown, userText: string): string | undefined {
  if (typeof service !== "string") return undefined;
  const s = service.trim().replace(/[.!?¿¡]+$/, "");
  if (!s || s.length > 200) return undefined;
  if (/^https?:\/\//i.test(s)) return userText.includes(s) ? s : undefined;
  const said = new Set(significant(userText));
  const words = significant(s);
  return words.length > 0 && words.every((w) => said.has(w)) ? s : undefined;
}

export const connectSkill: SkillDef<Args> = {
  id: skillId("connect_service"),
  version: 1,
  // Nothing leaves the phone and nothing is stored: the screen does the rest, behind the user's own taps.
  risk: "read",
  producesUntrusted: false,
  menuLine: "Start connecting a service or app Hermit can't use yet, by its name or a link to its API docs (\"connect to my gym's booking system\", \"conéctate a Todoist\"). It opens a review screen; nothing is installed until the user approves it there.",
  args,
  // The executor checks the service against the user's words (serviceFromUser) and asks when it isn't there.
  describeAction: (a) => ({ title: "Connect a service?", lines: [{ label: "Service", labelKey: "service", value: String(a.service ?? "") }] }),
};
