import type { TaintSource } from "@hermit/core";

/**
 * Wraps text other people wrote so the model treats it as data. Anything inside that
 * looks like a marker is defanged first, so the content can't close the wrapper early.
 */
export function wrapUntrusted(text: string, source: string, id: string): string {
  const safe = text.replace(/<(\/?)untrusted/gi, "‹$1untrusted");
  // "seal", not "id": next to a conversation id, BotPsy copied the wrapper's id into reply_message.
  return `<untrusted source="${source}" seal="${id}">\n${safe}\n</untrusted seal="${id}">`;
}

export interface BotInputOptions {
  botId: string;
  text: string;
  seal: string;
  at: number;
}

export interface BotInput {
  text: string;
  taint: TaintSource;
}

/**
 * Wraps another bot's message as untrusted data and returns the matching taint record (spec 6.4).
 * Another bot's words never count as the user's own words.
 */
export function botInput({ botId, text, seal, at }: BotInputOptions): BotInput {
  // The XML source attribute uses safeId so special characters can't break out of the wrapper,
  // while taint.ref intentionally keeps the raw botId to match the stored bot record.
  const safeId = botId.replace(/["<>\\\r\n]/g, "");
  return {
    text: wrapUntrusted(text, `bot:${safeId}`, seal),
    taint: { kind: "bot", ref: botId, at },
  };
}
