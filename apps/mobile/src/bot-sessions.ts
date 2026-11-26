import type { BotReset, Hermit } from "@hermit/runtime";

/**
 * The chat session each bot is on, so leaving a bot's chat and coming back resumes the same one. Screens ask here for the
 * bot they show (Hermit's for the screens that predate bots), never keep the session the app started with.
 */
export interface BotSessions {
  current(botId: string): string | undefined;
  /** Cached, else the bot's kept conversation. */
  open(botId: string): Promise<string>;
  newChat(botId: string): Promise<string>;
  /** An older chat picked from the list, or the fresh one HM-BOT-04's reset made. */
  use(botId: string, sessionId: string): void;
  /**
   * The chat menu's "Clear conversation": the bot's reset, HM-BOT-04's own act, logged as `bot.reset`. The bot's prompt
   * caches go with the conversation (its turn key and its long key: they hold its state on disk). While a turn of the
   * bot runs it is refused, and the chat stays on its session with its caches.
   */
  clear(botId: string): Promise<BotReset>;
  /** After a reset or delete. */
  forget(botId: string): void;
}

/** `caches` deletes a bot's prompt caches (the engine's, ./adapters forgetBotCaches, which logs its failures); the preview has none. */
export function createBotSessions(
  hermit: Pick<Hermit, "resumeSession" | "newChat"> & { bots: Pick<Hermit["bots"], "reset"> },
  caches?: { forget(botId: string): Promise<void> },
): BotSessions {
  const byBot = new Map<string, string>();
  const remember = (botId: string, sessionId: string) => (byBot.set(botId, sessionId), sessionId);
  return {
    current: (botId) => byBot.get(botId),
    open: async (botId) => byBot.get(botId) ?? remember(botId, await hermit.resumeSession(botId)),
    newChat: async (botId) => remember(botId, await hermit.newChat(botId)),
    use: (botId, sessionId) => void byBot.set(botId, sessionId),
    clear: async (botId) => {
      const reset = await hermit.bots.reset(botId);
      if (reset.kind === "done") {
        remember(botId, reset.sessionId);
        // Before the chat goes on: the bot's next turn writes its caches anew, never beside the cleared ones. A delete that
        // fails is the engine's to log; the reset happened, and the next model load sweeps what is left.
        await caches?.forget(botId).catch(() => undefined);
      }
      return reset;
    },
    forget: (botId) => void byBot.delete(botId),
  };
}

/**
 * HM-BOT-02: the session a bot's chat follows when it comes back in front: the one the bot is on now (HM-BOT-04's
 * reset made a fresh one and deleted the rest, or another chat was picked), else the one it shows. So a send never
 * targets a session a reset deleted.
 */
export function followSession(sessions: Pick<BotSessions, "current">, botId: string, shown: string | undefined): string | undefined {
  return sessions.current(botId) ?? shown;
}
