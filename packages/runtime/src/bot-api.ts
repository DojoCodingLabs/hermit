import type { Bot, BotLook, BotSources, ChatSummary, MemoryCursor, MemoryPage, PermissionMode, SkillGroup } from "@hermit/core";

/** Multi-bot contracts (wave 1): what the app calls on the runtime. `Hermit` itself extends HermitBotsApi. */

/** Queue priority: the user's own turn, then a reply the user waits for, then handoffs, then routines. */
export type RunPriority = "user" | "reply" | "handoff" | "routine";
export const RUN_PRIORITIES: readonly RunPriority[] = ["user", "reply", "handoff", "routine"];

/** One prompt-cache key per bot. */
export const cacheKeyFor = (botId: string) => `hermit-v1:${botId}`;

/** Don't ask takes this typed word: "entiendo" or "i understand", trimmed, any case, a trailing . or ! ignored. */
export function typedWordOk(typed: string): boolean {
  const word = typed.trim().toLowerCase().replace(/[.!]+$/, "").trim();
  return word === "entiendo" || word === "i understand";
}

export interface NewBot { name: string; role: string; look?: BotLook; grants: SkillGroup[]; sources: BotSources; mode: PermissionMode | null }
export type BotPatch = Partial<Pick<NewBot, "name" | "role" | "look" | "grants" | "sources">>;
export interface RosterRow { bot: Bot; mode: PermissionMode; lastAt: number; preview?: { who: "user" | "bot"; text: string } }
export interface Roster { rows: RosterRow[]; hidden: RosterRow[] }
export interface BotProposalView {
  offerId: string; name: string; role: string; look: BotLook; grants: SkillGroup[]; sources: BotSources;
  tainted: boolean; needsFingerprint: boolean;
  /** The mode the new bot will run in: a proposal never sets its own, so it inherits the global one as it is at the offer. */
  mode: PermissionMode;
}

export const BOT_REFUSALS = [
  "not_found", "primary", "busy", "too_many_bots", "too_many_pins", "name_empty", "name_too_long",
  "role_too_long", "bad_site", "reserved_group", "fingerprint_declined", "word_mismatch", "offer_gone", "needs_review",
] as const;
export type BotRefusal = (typeof BOT_REFUSALS)[number];
export type BotChange = { kind: "done"; bot: Bot } | { kind: "refused"; reason: BotRefusal };
export type BotReset = { kind: "done"; sessionId: string } | { kind: "refused"; reason: "busy" | "not_found" };

export interface HermitBots {
  roster(opts?: { query?: string }): Promise<Roster>;
  get(id: string): Promise<Bot | undefined>;
  chats(botId: string): Promise<ChatSummary[]>;
  proposal(offerId: string): BotProposalView | undefined;
  create(input: NewBot, opts?: { offerId?: string; reviewed?: boolean; typed?: string }): Promise<BotChange>;
  update(id: string, patch: BotPatch): Promise<BotChange>;
  duplicate(id: string): Promise<BotChange>;
  pin(id: string, pinned: boolean): Promise<BotChange>;
  hide(id: string, hidden: boolean): Promise<BotChange>;
  reset(id: string): Promise<BotReset>;
  remove(id: string): Promise<BotChange>;
  notes(id: string, opts?: { query?: string; after?: MemoryCursor }): Promise<MemoryPage>;
  shareNote(id: string, noteId: number): Promise<boolean>;
  deleteNote(id: string, noteId: number): Promise<boolean>;
}

export type ModeChange = "set" | "word_mismatch" | "fingerprint_declined" | "not_found";
export interface HermitModes {
  global(): Promise<PermissionMode>;
  /** Its own, else the global. */
  of(botId: string): Promise<PermissionMode>;
  setGlobal(mode: PermissionMode, proof?: { typed: string }): Promise<ModeChange>;
  setBot(botId: string, mode: PermissionMode | null, proof?: { typed: string }): Promise<ModeChange>;
}

export interface HermitBotsApi {
  bots: HermitBots;
  modes: HermitModes;
  startSession(opts?: { attended?: boolean; botId?: string }): Promise<string>;
  /** Hermit's when absent. */
  resumeSession(botId?: string): Promise<string>;
  newChat(botId: string): Promise<string>;
  clearConversation(botId?: string): Promise<string>;
}

/** The fingerprint. */
export interface BotPorts { confirm(prompt: string): Promise<boolean> }
