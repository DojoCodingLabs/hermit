import {
  argsHash, BotError, MAX_BOTS, needsFingerprint, PERMISSION_MODES, RESERVED_GROUPS,
  type Bot, type BotsStore, type Memory, type PermissionMode, type Sessions, type SkillGroup,
} from "@hermit/core";
import type { AuditSink } from "@hermit/agent";
import {
  typedWordOk,
  type BotChange, type BotPatch, type BotPorts, type BotProposalView, type BotRefusal, type HermitBots, type HermitModes, type RosterRow,
} from "./bot-api.ts";
import type { Hermit, SettingKey } from "./hermit.ts";

/**
 * Multi-bot (Task 11): what HM-BOT-01 to 04 and Settings call. Every change is the user's own act from a screen: checked
 * here (Hermit stays Hermit, a running bot isn't deleted or reset under its turn, the fingerprint and the typed word where
 * they are due) and logged by the bot's id and an action code, never a name, a role or a note.
 */

/** Hermit's offers of a new bot (bot-proposals.ts). Each lasts a while: once it expires, `peek` and `claim` find none. */
export interface BotProposals {
  offer(p: { name: string; role: string; grants: SkillGroup[]; sites: string[]; tainted: boolean }): Promise<BotProposalView>;
  /** One use: the offer, gone from then on. */
  claim(offerId: string): BotProposalView | undefined;
  peek(offerId: string): BotProposalView | undefined;
}

export interface BotsApiDeps {
  store: BotsStore;
  sessions: Sessions;
  memory: Memory;
  /** Where the global mode lives. The one writer of the mode setting: the settings the app gets refuse it (isModeSetting). */
  settings: Hermit["settings"];
  audit: AuditSink;
  /** Hermit's clearConversation (F-M14): the bot's chats go and a fresh one starts. */
  clear(botId: string): Promise<string>;
  /** A turn of that bot is running (Review Focus 1). */
  busy(botId: string): boolean;
  /** Marks a bot as clearing while its chats or row are being deleted (#108). */
  setClearing?(botId: string, active: boolean): void;
  /** The fingerprint. Without it, every change that needs one is declined. */
  confirm?: BotPorts["confirm"];
  /** A copy key in the app's language, for the fingerprint's prompt; English without it. */
  say?(key: string): string;
  /** Hermit's offers (Task 12). Without them no offer exists: `proposal` finds none and an `offerId` is gone. */
  proposals?: BotProposals;
  newId(): string;
  now(): number;
}

/** The global mode (spec 6.4.1): "ask", "auto" or "dont_ask"; absent means Ask. */
export const MODE_SETTING = "bots.mode" satisfies SettingKey;

/** A setting only `modes` writes: the global mode, or a per-bot mode key should one ever live in settings. */
export function isModeSetting(key: string): boolean {
  return key === MODE_SETTING || key.startsWith(`${MODE_SETTING}.`);
}

/** What the fingerprint confirms: a group that needs it newly held, or Don't ask coming into effect. */
export type FingerprintReason = "grant" | "dont_ask";
const PROMPT_KEYS: Readonly<Record<FingerprintReason, string>> = {
  grant: "HM-BOT-04.fingerprintPrompt.grant",
  dont_ask: "HM-BOT-04.fingerprintPrompt.dontAsk",
};
const PROMPTS: Readonly<Record<FingerprintReason, string>> = {
  grant: "Confirm it's you to give this bot these permissions",
  dont_ask: "Confirm it's you to turn on Don't ask",
};

type BotReason =
  | "bot.created" | "bot.updated" | "bot.granted" | "bot.duplicated" | "bot.pinned" | "bot.hidden" | "bot.reset" | "bot.deleted"
  | "bot.note_shared" | `mode.${PermissionMode}` | "mode.inherit";

/** The global mode is the user's act in Settings, about no bot: logged under the id the screens' own acts use. */
const USER_ACT = "user";

/** Case and accents ignored: "José" finds "jose", "VIAJ" finds "Viajes". */
const fold = (text: string) => text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

/** A copy's name: its first 38 characters and " 2", so it stays within the 40 a name may have. */
const copyName = (name: string) => `${[...name].slice(0, 38).join("").trimEnd()} 2`;

/** Hermit first, then pinned bots by pin order, then the rest by their newest activity. */
function rosterOrder(a: RosterRow, b: RosterRow): number {
  if (a.bot.primary !== b.bot.primary) return a.bot.primary ? -1 : 1;
  const pinA = a.bot.pinOrder ?? Infinity;
  const pinB = b.bot.pinOrder ?? Infinity;
  if (pinA !== pinB) return pinA - pinB;
  return b.lastAt - a.lastAt;
}

function checkMode(mode: PermissionMode): void {
  if (!PERMISSION_MODES.includes(mode)) throw new Error(`${String(mode)} isn't a permission mode.`);
}

const refused = (reason: BotRefusal): BotChange => ({ kind: "refused", reason });
const done = (bot: Bot): BotChange => ({ kind: "done", bot });

/** The store's refusals are the API's (the same codes); anything else is a real failure. */
function storeRefusal(err: unknown): BotChange {
  if (err instanceof BotError) return refused(err.code);
  throw err;
}

const sameJson = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/**
 * The coordinator's ruling on Task 12's concern 3: a group no screen shows (RESERVED_GROUPS, vault_logins in wave 1) is
 * never granted, whoever asks, so the user never grants what they can't see.
 */
const reserved = (grants: readonly SkillGroup[]) => grants.some((g) => RESERVED_GROUPS.includes(g));

export function createBotsApi(deps: BotsApiDeps): { bots: HermitBots; modes: HermitModes } {
  const { store } = deps;
  /** Offers a create is using right now: a second create from the same offer finds it gone. */
  const using = new Set<string>();

  /**
   * One row per change, by the id of the bot it changed, also as the entry's `bot` (inside the signed hash), so HM-ACT-01
   * names the bot as it does its turns' steps (Task 18). The global mode is about no bot: logged under "user", no `bot`.
   */
  const log = (botId: string, reason: BotReason) =>
    deps.audit.append({ ts: deps.now(), event: "bot", skill: "bot", sessionId: botId, outcome: "ok", reason, ...(botId === USER_ACT ? {} : { bot: botId }) });

  const globalMode = async (): Promise<PermissionMode> => {
    const set = await deps.settings.get(MODE_SETTING);
    return PERMISSION_MODES.find((m) => m === set) ?? "ask";
  };

  /**
   * The fingerprint's one rule (needsFingerprint) on the modes given, and before it the typed word when the mode becomes
   * Don't ask: a wrong word never asks for the fingerprint. The fingerprint is asked once; no port, a no or a failed
   * prompt declines. setGlobal gives the global mode before and after; setBot and a new bot (newBotGate) give the bot's
   * own mode, never the global one it inherits.
   */
  const gate = async (
    next: { grants: readonly SkillGroup[]; mode: PermissionMode },
    before: { grants: readonly SkillGroup[]; mode: PermissionMode } | undefined,
    typed: string | undefined,
  ): Promise<"word_mismatch" | "fingerprint_declined" | undefined> => {
    const dontAsk = next.mode === "dont_ask" && before?.mode !== "dont_ask";
    if (dontAsk && !typedWordOk(typed ?? "")) return "word_mismatch";
    if (!needsFingerprint(next, before)) return undefined;
    const why: FingerprintReason = dontAsk ? "dont_ask" : "grant";
    const prompt = deps.say?.(PROMPT_KEYS[why]) ?? PROMPTS[why];
    let yes = false;
    try {
      yes = (await deps.confirm?.(prompt)) === true;
    } catch {
      // A prompt that failed is a no.
    }
    return yes ? undefined : "fingerprint_declined";
  };

  /**
   * A new bot, made or duplicated (the coordinator's ruling on Task 11's concern 1): its grants are all new, and only its
   * own mode counts. With none, it inherits the global mode, which took the word and the fingerprint when it was set: its
   * mode in effect is the global one before and after, so the mode brings nothing to confirm.
   */
  const newBotGate = async (grants: readonly SkillGroup[], own: PermissionMode | null, typed: string | undefined) => {
    if (own !== null) return gate({ grants, mode: own }, undefined, typed);
    const global = await globalMode();
    return gate({ grants, mode: global }, { grants: [], mode: global }, undefined);
  };

  /** About 50 bots at most, Hermit counted; checked before any fingerprint, and again by the store as it writes. */
  const full = async () => (await store.list()).length >= MAX_BOTS;

  /** Bots whose name, or the title of one of their chats, holds the folded query. */
  const matching = async (bots: Bot[], query: string): Promise<Bot[]> => {
    const out: Bot[] = [];
    for (const bot of bots) {
      if (fold(bot.name).includes(query) || (await deps.sessions.chats(bot.id)).some((c) => c.title !== undefined && fold(c.title).includes(query))) out.push(bot);
    }
    return out;
  };

  const bots: HermitBots = {
    async roster(opts = {}) {
      const all = await store.list();
      const latest = new Map((await store.activity()).map((a) => [a.botId, a]));
      const global = await globalMode();
      const query = fold(opts.query?.trim() ?? "");
      const listed = query ? await matching(all, query) : all;
      // F-M26: a bot with no turn yet counts from when it was made.
      const rows = listed
        .map((bot): RosterRow => {
          const seen = latest.get(bot.id);
          return { bot, mode: bot.mode ?? global, lastAt: seen?.lastAt ?? bot.createdAt, ...(seen?.preview ? { preview: seen.preview } : {}) };
        })
        .sort(rosterOrder);
      return { rows: rows.filter((r) => !r.bot.hidden), hidden: rows.filter((r) => r.bot.hidden) };
    },

    get: (id) => store.get(id),

    chats: (botId) => deps.sessions.chats(botId),

    proposal: (offerId) => deps.proposals?.peek(offerId),

    async create(input, opts = {}) {
      const own = input.mode ?? null;
      if (own !== null) checkMode(own);
      if (reserved(input.grants)) return refused("reserved_group");
      const { offerId } = opts;
      if (offerId !== undefined) {
        const offer = deps.proposals?.peek(offerId);
        if (!offer || using.has(offerId)) return refused("offer_gone");
        // Review Focus 2: a card drafted after Hermit read others' text is created only from the review screen.
        if (offer.tainted && !opts.reviewed) return refused("needs_review");
        using.add(offerId);
      }
      try {
        if (await full()) return refused("too_many_bots");
        const stop = await newBotGate(input.grants, own, opts.typed);
        if (stop) return refused(stop);
        // The coordinator's ruling on Task 12: an offer can expire while the fingerprint's prompt is open. Then no bot.
        if (offerId !== undefined && !deps.proposals?.peek(offerId)) return refused("offer_gone");
        let bot: Bot;
        try {
          bot = await store.create({ id: deps.newId(), name: input.name, role: input.role, ...(input.look ? { look: input.look } : {}), grants: input.grants, sources: input.sources, mode: own });
        } catch (err) {
          return storeRefusal(err);
        }
        // The offer is used up only now, so a refused create (a declined fingerprint, a name too long) can try again. An
        // offer gone by now (it expired while the bot was written) makes no bot either: the bot is removed, unlogged.
        if (offerId !== undefined && !deps.proposals?.claim(offerId)) {
          await store.remove(bot.id);
          return refused("offer_gone");
        }
        await log(bot.id, "bot.created");
        if (bot.mode !== null) await log(bot.id, `mode.${bot.mode}`);
        return done(bot);
      } finally {
        if (offerId !== undefined) using.delete(offerId);
      }
    },

    async update(id, patch) {
      // Ruling on Task 10's review: a bot's mode has its own call and its own checks (modes.setBot), never a patch.
      if ("mode" in patch) throw new Error("A bot's mode changes only through modes.setBot, with its checks.");
      const bot = await store.get(id);
      if (!bot) return refused("not_found");
      const fields: BotPatch = {
        ...(patch.name !== undefined ? { name: patch.name } : {}),
        ...(patch.role !== undefined ? { role: patch.role } : {}),
        ...(patch.look !== undefined ? { look: patch.look } : {}),
        ...(patch.grants !== undefined ? { grants: patch.grants } : {}),
        ...(patch.sources !== undefined ? { sources: patch.sources } : {}),
      };
      const changes = Object.keys(fields).length > 0;
      // F-M16(b): Hermit isn't edited in wave 1. Its grants are every group in code and its role is ignored; its look is
      // the crab, never redrawn; its sources bound nothing, since it holds everything.
      if (bot.primary) return changes ? refused("primary") : done(bot);
      if (!changes) return done(bot);
      if (fields.grants && reserved(fields.grants)) return refused("reserved_group");
      if (fields.grants) {
        const mode = bot.mode ?? (await globalMode());
        const stop = await gate({ grants: fields.grants, mode }, { grants: bot.grants, mode }, undefined);
        if (stop) return refused(stop);
      }
      let after: Bot;
      try {
        after = await store.update(id, fields);
      } catch (err) {
        return storeRefusal(err);
      }
      if (!sameJson([after.name, after.role, after.look, after.sources], [bot.name, bot.role, bot.look, bot.sources])) await log(id, "bot.updated");
      if (!sameJson(after.grants, bot.grants)) await log(id, "bot.granted");
      return done(after);
    },

    async duplicate(id) {
      const from = await store.get(id);
      if (!from) return refused("not_found");
      if (from.primary) return refused("primary");
      if (await full()) return refused("too_many_bots");
      // The coordinator's ruling on concern 1: a copy never takes the original's own mode. It has none, so it inherits the
      // global mode and needs no typed word; what it holds asks for the fingerprint as creating it would.
      const stop = await newBotGate(from.grants, null, undefined);
      if (stop) return refused(stop);
      let bot: Bot;
      try {
        // No look: the store gives it the next unused one (nextLook) as it writes. No chats, no notes, no mode of its own.
        bot = await store.create({ id: deps.newId(), name: copyName(from.name), role: from.role, grants: from.grants, sources: from.sources, mode: null });
      } catch (err) {
        return storeRefusal(err);
      }
      await log(bot.id, "bot.duplicated");
      return done(bot);
    },

    async pin(id, pinned) {
      const bot = await store.get(id);
      if (!bot) return refused("not_found");
      // Hermit is always first, starred: never pinned.
      if (bot.primary) return refused("primary");
      if ((bot.pinOrder !== null) === pinned) return done(bot);
      let after: Bot;
      try {
        after = await store.pin(id, pinned);
      } catch (err) {
        return storeRefusal(err);
      }
      await log(id, "bot.pinned");
      return done(after);
    },

    async hide(id, hidden) {
      const bot = await store.get(id);
      if (!bot) return refused("not_found");
      if (bot.primary) return refused("primary");
      if (bot.hidden === hidden) return done(bot);
      let after: Bot;
      try {
        after = await store.setHidden(id, hidden);
      } catch (err) {
        return storeRefusal(err);
      }
      await log(id, "bot.hidden");
      return done(after);
    },

    async reset(id) {
      if (!(await store.get(id))) return { kind: "refused", reason: "not_found" };
      // Review Focus 1: the running turn's late writes would land in a chat that is gone. Nothing waits between this check
      // and clearConversation's own (F-M14).
      if (deps.busy(id)) return { kind: "refused", reason: "busy" };
      const sessionId = await deps.clear(id);
      await log(id, "bot.reset");
      return { kind: "done", sessionId };
    },

    async remove(id) {
      const bot = await store.get(id);
      if (!bot) return refused("not_found");
      if (bot.primary) return refused("primary");
      // Review Focus 1: never under a running turn, whose late writes would leave chats or notes for a bot that is gone.
      if (deps.busy(id)) return refused("busy");
      deps.setClearing?.(id, true);
      try {
        try {
          await store.remove(id);
        } catch (err) {
          return storeRefusal(err);
        }
        // The store deleted its chats, notes, grants and sources; this also drops its sessions kept in memory.
        await deps.sessions.clear(id);
        await log(id, "bot.deleted");
        return done(bot);
      } finally {
        deps.setClearing?.(id, false);
      }
    },

    async notes(id, opts = {}) {
      if (!(await store.get(id))) return { notes: [] };
      return deps.memory.forBot(id).list(opts);
    },

    async shareNote(id, noteId) {
      if (!(await store.get(id)) || !(await deps.memory.forBot(id).share(noteId))) return false;
      // The bot's id and a code, never the note (Task 18): which note it was stays out of the log.
      await log(id, "bot.note_shared");
      return true;
    },

    async deleteNote(id, noteId) {
      if (!(await store.get(id)) || !(await deps.memory.forBot(id).delete(noteId))) return false;
      // The same trace as HM-MEM-01's delete (FR-ACT-02): the forget skill and a hash, never the fact; and, like a share,
      // the bot whose note it was, so HM-ACT-01 names it (Task 18).
      const hash = argsHash({ id: noteId });
      await deps.audit.append({ ts: deps.now(), sessionId: id, event: "call_proposed", skill: "forget", argsHash: hash, bot: id });
      await deps.audit.append({ ts: deps.now(), sessionId: id, event: "executed", skill: "forget", argsHash: hash, outcome: "ok", bot: id });
      return true;
    },
  };

  const modes: HermitModes = {
    global: globalMode,

    async of(botId) {
      return (await store.get(botId))?.mode ?? (await globalMode());
    },

    async setGlobal(mode, proof) {
      checkMode(mode);
      const before = await globalMode();
      if (mode === before) return "set";
      const stop = await gate({ grants: [], mode }, { grants: [], mode: before }, proof?.typed);
      if (stop) return stop;
      await deps.settings.set(MODE_SETTING, mode);
      await log(USER_ACT, `mode.${mode}`);
      return "set";
    },

    async setBot(botId, mode, proof) {
      if (mode !== null) checkMode(mode);
      const bot = await store.get(botId);
      if (!bot) return "not_found";
      if (bot.mode === mode) return "set";
      // The coordinator's ruling (Task 11 fix round 1): only the bot's own mode counts, never the global it inherits. A Don't
      // ask of its own takes the word and the fingerprint unless it already has one, also under a global Don't ask, since
      // it outlives the global going down. A lower mode needs nothing, and so does going back to the global, which took
      // both when it was set to Don't ask. No grant changes here, and a bot with no mode of its own had nothing before.
      if (mode !== null) {
        const stop = await gate({ grants: [], mode }, bot.mode !== null ? { grants: [], mode: bot.mode } : undefined, proof?.typed);
        if (stop) return stop;
      }
      await store.update(botId, { mode });
      await log(botId, mode === null ? "mode.inherit" : `mode.${mode}`);
      return "set";
    },
  };

  return { bots, modes };
}
