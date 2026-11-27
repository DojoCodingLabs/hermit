import { heldGroups, MAX_BOT_NAME_CHARS, RESERVED_GROUPS, SKILL_GROUPS, type Bot, type SkillGroup } from "./bots.ts";
import { quoteSafe } from "./quote.ts";

/** A2A 1.0 schema version emitted for in-process bot cards (spec 6.3). */
export const AGENT_CARD_VERSION = "1.0";
export const MAX_CARD_DESCRIPTION_CHARS = 200;

export interface AgentCapabilities {
  streaming: boolean;
  pushNotifications: boolean;
}

export interface AgentSkill {
  id: SkillGroup;
  name: string;
  description: string;
  tags: readonly string[];
  examples: readonly [string, string];
}

/**
 * Code-generated A2A 1.0 Agent Card for an in-process Hermit bot (spec 6.3).
 * Network-binding fields (`supportedInterfaces`, `securitySchemes`, `securityRequirements`,
 * and JWS `signatures`) are intentionally omitted for the V1 in-process bus and belong to EP-21 (V2).
 */
export interface AgentCard {
  name: string;
  description: string;
  version: string;
  capabilities: AgentCapabilities;
  skills: AgentSkill[];
}

const neutralize = (t: string): string => t.replace(/<\/?untrusted/gi, "‹untrusted");

const SKILL_CATALOG: Readonly<Record<SkillGroup, Omit<AgentSkill, "id">>> = {
  calendar: {
    name: "Calendar",
    description: "Read upcoming events and add or adjust calendar entries.",
    tags: ["calendar", "schedule", "events"],
    examples: ["¿Qué tengo mañana en el calendario?", "What is on my calendar tomorrow?"],
  },
  reminders: {
    name: "Reminders",
    description: "Create, list, and cancel local timed reminders.",
    tags: ["reminders", "timers", "alerts"],
    examples: ["Recuérdame llamar a Ana Prueba a las 6", "Remind me to call Ana Prueba at 6"],
  },
  notes: {
    name: "Notes",
    description: "Save, recall, and forget local encrypted memory notes.",
    tags: ["notes", "memory", "facts"],
    examples: ["Recuerda que la receta de sopa usa cilantro", "Remember that the soup recipe uses cilantro"],
  },
  messages_read: {
    name: "Read messages",
    description: "Read recent messages and threads on the phone.",
    tags: ["messages", "inbox", "read"],
    examples: ["¿Me escribió Ana Prueba hoy?", "Did Ana Prueba message me today?"],
  },
  messages_reply: {
    name: "Reply to messages",
    description: "Draft and send replies to existing message conversations.",
    tags: ["messages", "reply", "send"],
    examples: ["Respóndele a Ana Prueba que voy en camino", "Reply to Ana Prueba saying I am on my way"],
  },
  mail_read: {
    name: "Read email",
    description: "List and read email messages from connected accounts.",
    tags: ["mail", "inbox", "read"],
    examples: ["¿Tengo correos nuevos de example.com?", "Do I have new emails from example.com?"],
  },
  mail_send: {
    name: "Send email",
    description: "Compose, send, or update email messages and drafts.",
    tags: ["mail", "send", "compose"],
    examples: ["Envía un correo a ana@example.com sobre el viaje", "Send an email to ana@example.com about the trip"],
  },
  web_read: {
    name: "Read web",
    description: "Search the web and read pages through the quarantined reader.",
    tags: ["web", "search", "fetch"],
    examples: ["Resume https://recetas.example/sopa", "Summarize https://recipes.example/soup"],
  },
  web_tasks: {
    name: "Web tasks",
    description: "Run structured multi-step web recipes on permitted sites.",
    tags: ["web", "tasks", "automation"],
    examples: ["Revisa el estado en https://viajes.example", "Check the status on https://travel.example"],
  },
  contacts: {
    name: "Contacts",
    description: "Look up saved contact details on the phone.",
    tags: ["contacts", "people", "lookup"],
    examples: ["Busca el número de Ana Prueba", "Look up Ana Prueba's phone number"],
  },
  apps: {
    name: "Open apps",
    description: "Launch other apps on the phone with prefilled intents.",
    tags: ["apps", "intents", "launch"],
    examples: ["Abre el mapa para ir a la estación", "Open the map to go to the station"],
  },
  vault_logins: {
    name: "Vault logins",
    description: "Use saved site credentials after fingerprint approval.",
    tags: ["vault", "logins", "credentials"],
    examples: ["Inicia sesión en https://example.com", "Sign in to https://example.com"],
  },
  wallet_pay: {
    name: "Testnet wallet",
    description: "Check balances and prepare testnet payments with fingerprint approval.",
    tags: ["wallet", "payments", "testnet"],
    examples: ["¿Cuánto saldo tengo en la wallet?", "What is my wallet balance?"],
  },
};

/** Generates a deterministic A2A 1.0 Agent Card from a bot's stored fields and grants. */
export function agentCard(bot: Pick<Bot, "name" | "role" | "primary" | "grants">): AgentCard {
  const held = heldGroups(bot);
  const skills: AgentSkill[] = SKILL_GROUPS.filter((g) => !RESERVED_GROUPS.includes(g) && held.includes(g)).map(
    (id) => {
      const spec = SKILL_CATALOG[id];
      return { id, name: spec.name, description: spec.description, tags: [...spec.tags], examples: [...spec.examples] };
    },
  );
  return {
    name: neutralize(quoteSafe(bot.name, MAX_BOT_NAME_CHARS)),
    description: neutralize(quoteSafe(bot.role, MAX_CARD_DESCRIPTION_CHARS)),
    version: AGENT_CARD_VERSION,
    capabilities: { streaming: false, pushNotifications: true },
    skills,
  };
}
