import { HERMIT_BOT_ID } from "@hermit/core/bots";
import { cacheKeyFor } from "@hermit/runtime/bot-api";

/**
 * Multi-bot (spec 6.6, "the builder caps how many caches stay on disk"): the prompt caches QVAC keeps, one folder per
 * key. An active bot has two keys, its turns' (`hermit-v1:<bot>:<profile>`) and its long answers'
 * (`hermit-v1:<bot>:long:<profile>`, packages/model/src/port.ts), and each holds its conversation (Q35). The six most
 * recently used stay, and Hermit's turn key with them when it is older (the coordinator's rulings for Task 18): at every
 * request and at every load, so a reload for other cores or after a model update reads none of them again. Each key
 * keeps one file. The engine adapter runs these functions on QVAC's folder; the tests, on one in memory.
 */
export const MAX_NAMED_CACHES = 6;

/** QVAC's name for a request's cache key: letters, digits, "_" and "-" only. */
export const engineCacheKey = (key: string): string => key.replace(/[^A-Za-z0-9_-]/g, "-");

/** Hermit's turn key as the engine names it, for the profile the model loaded with. */
export const hermitTurnKey = (profileId: string): string => engineCacheKey(`${cacheKeyFor(HERMIT_BOT_ID)}:${profileId}`);

/** Of `order` (least recently used first), the `max` most recent and every `keep` key stay; the others are evicted. */
function keepRecent(order: readonly string[], max: number, keep: readonly string[]): { order: string[]; evict: string[] } {
  const recent = order.slice(Math.max(0, order.length - max));
  const evict = order.filter((k) => !recent.includes(k) && !keep.includes(k));
  return { order: order.filter((k) => !evict.includes(k)), evict };
}

/**
 * A request is about to use `key`. `order` is the keys on disk, most recently used last. Returns the new order and the
 * keys whose caches to delete: those outside the `max` most recently used, never one in `keep` and never `key` itself.
 */
export function touchCacheKey(order: readonly string[], key: string, max = MAX_NAMED_CACHES, keep: readonly string[] = []): { order: string[]; evict: string[] } {
  return keepRecent([...order.filter((k) => k !== key), key], Math.max(1, max), keep);
}

/** QVAC's automatic caches (`kvCache: true`) are folders named by 16 hex characters; QVAC reclaims those itself. */
const AUTOMATIC = /^[a-f0-9]{16}$/;

/**
 * The keys this app writes: `hermit-v1:<bot>:…`, the bot being Hermit or a UUID (the runtime makes bot ids with
 * randomUUID). Every other named key is one this app no longer writes: the pre-multi-bot `hermit-v1:<profile>` and
 * `hermit-v1:long:<profile>`, the older `hermit-long:<profile>`, the dev eval screen's `eval:` and `probe:`.
 */
const APP_KEY = new RegExp(`^hermit-v1-(${HERMIT_BOT_ID}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})-`);

/** The bot a key of this app belongs to; undefined for any other key. */
export const botOfKey = (key: string): string | undefined => APP_KEY.exec(key)?.[1];

/** A named key this app no longer writes. Before bots there was one chat, Hermit's: such a key holds Hermit's. */
const leftover = (key: string) => !AUTOMATIC.test(key) && botOfKey(key) === undefined;

/**
 * A bot's caches among the keys on disk, for a reset, the chat's clear or a delete: its turns' and its long answers', for
 * any profile. Hermit's also take every key this app no longer writes, since those held its chat before bots.
 */
export function botCacheKeys(keys: readonly string[], botId: string): string[] {
  const prefix = `${engineCacheKey(cacheKeyFor(botId))}-`;
  return keys.filter((k) => k.startsWith(prefix) || (botId === HERMIT_BOT_ID && leftover(k)));
}

/** One file QVAC wrote: `<key>/<model folder>/<prompt hash>.bin`. The model folder's name hashes the load (its threads). */
export interface CacheFile { key: string; model: string; path: string; modifiedAt: number }

/** What the cache folder holds: its folders, one per key, and the files under the named ones. */
export interface CacheListing { keys: string[]; files: CacheFile[] }

/**
 * Every bot there is, with when its oldest chat began, or undefined when it has none: a reset deletes a bot's chats and
 * starts one, so that is its last reset's time. A cache file older than it can hold no chat the bot still has.
 */
export type CacheOwners = ReadonlyMap<string, number | undefined>;

/** What the cache functions do, for their failure lines. */
export type CacheAction = "list" | "load" | "write" | "evict" | "reset" | "delete";

/** QVAC's cache folder as these functions use it: the engine adapter's, or a test's in memory. */
export interface CacheDisk {
  /** Throws when the folder can't be read. */
  list(): CacheListing;
  /** QVAC's delete for a key, or for one model folder in it; QVAC forgets its own record of them too. */
  removeKey(key: string, model?: string): Promise<void>;
  /** One file: an older prompt's, beside the newest in the same model folder. */
  removeFile(path: string): Promise<void>;
  /** A failure, for the dev log line (cacheFailureLine). The user's act goes on. */
  failed(action: CacheAction, err: unknown): void;
}

/** A key's newest file, the one it keeps. */
const newestFile = (files: readonly CacheFile[]): CacheFile | undefined => files.reduce<CacheFile | undefined>((a, f) => (!a || f.modifiedAt > a.modifiedAt ? f : a), undefined);

/** Runs one delete; a failure is logged and the rest go on. True when it went. */
async function attempt(disk: CacheDisk, action: CacheAction, remove: () => Promise<void>): Promise<boolean> {
  try {
    await remove();
    return true;
  } catch (err) {
    disk.failed(action, err);
    return false;
  }
}

/**
 * Deletes `gone` among a key's files `all`: a whole model folder through QVAC when none of its files stays (QVAC then
 * forgets its own record of them), else file by file (an older prompt's file beside the one kept).
 */
async function removeFiles(disk: CacheDisk, action: CacheAction, key: string, all: readonly CacheFile[], gone: readonly CacheFile[]): Promise<void> {
  for (const model of new Set(gone.map((f) => f.model))) {
    const folder = all.filter((f) => f.model === model);
    if (folder.every((f) => gone.includes(f))) await attempt(disk, action, () => disk.removeKey(key, model));
    else for (const f of folder.filter((x) => gone.includes(x))) await attempt(disk, action, () => disk.removeFile(f.path));
  }
}

/**
 * A load (the app's start, a reload for the cores Android allows, a model update, the dev eval screen's own engine):
 * - QVAC's automatic caches are left to QVAC; the keys this app no longer writes go;
 * - with `owners` (the app's engine; never the eval screen's or a model update's self-test), the sweep: a bot's caches go
 *   when it no longer exists, and so do its files written before its last reset (a reset's own delete may have failed);
 * - each kept key keeps one file, its newest, Hermit's pinned key included;
 * - the six most recently written stay, and `keep` (Hermit's turn key) beside them; the rest go.
 * Returns the order the engine starts from, least recently written first; nothing when the folder can't be read.
 */
export async function loadCaches(disk: CacheDisk, opts: { max?: number; keep?: readonly string[]; owners?: CacheOwners } = {}): Promise<string[]> {
  let listing: CacheListing;
  try {
    listing = disk.list();
  } catch (err) {
    disk.failed("list", err);
    return [];
  }
  const { owners } = opts;
  const kept: Array<{ key: string; at: number }> = [];
  for (const key of listing.keys) {
    if (AUTOMATIC.test(key)) continue;
    const bot = botOfKey(key);
    const all = listing.files.filter((f) => f.key === key);
    // The sweep: undefined when the bot is gone or has no chat left, so none of its files can be kept.
    const since = bot !== undefined && owners ? owners.get(bot) : -Infinity;
    const live = since === undefined ? [] : all.filter((f) => f.modifiedAt >= since);
    const newest = newestFile(live);
    if (bot === undefined || !newest) {
      await attempt(disk, "load", () => disk.removeKey(key));
      continue;
    }
    await removeFiles(disk, "load", key, all, all.filter((f) => f !== newest));
    kept.push({ key, at: newest.modifiedAt });
  }
  const byWrite = kept.sort((a, b) => a.at - b.at || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0)).map((k) => k.key);
  const capped = keepRecent(byWrite, opts.max ?? MAX_NAMED_CACHES, opts.keep ?? []);
  for (const key of capped.evict) await attempt(disk, "load", () => disk.removeKey(key));
  return capped.order;
}

/** After a request wrote `key`: the key keeps one file, its newest (an earlier load's prompt or thread plan goes). */
export async function afterWrite(disk: CacheDisk, key: string): Promise<void> {
  let listing: CacheListing;
  try {
    listing = disk.list();
  } catch (err) {
    disk.failed("list", err);
    return;
  }
  const all = listing.files.filter((f) => f.key === key);
  const newest = newestFile(all);
  await removeFiles(disk, "write", key, all, all.filter((f) => f !== newest));
}

/** The keys a request's touch evicted (touchCacheKey). */
export async function evictKeys(disk: CacheDisk, keys: readonly string[]): Promise<void> {
  for (const key of keys) await attempt(disk, "evict", () => disk.removeKey(key));
}

/**
 * A bot's prompt caches, deleted when its conversation goes (a reset, the chat's clear, a delete): they hold that
 * conversation's state on disk (Q35). Returns the keys deleted. A failure is logged and the next load's sweep tries again.
 */
export async function forgetBotCachesOn(disk: CacheDisk, botId: string, why: "reset" | "delete"): Promise<string[]> {
  let listing: CacheListing;
  try {
    listing = disk.list();
  } catch (err) {
    disk.failed("list", err);
    return [];
  }
  const gone: string[] = [];
  for (const key of botCacheKeys(listing.keys, botId)) if (await attempt(disk, why, () => disk.removeKey(key))) gone.push(key);
  return gone;
}

/** The sweep's owners (CacheOwners) from the runtime's bots and their chats. */
export async function cacheOwnersOf(botIds: readonly string[], chatsOf: (botId: string) => Promise<ReadonlyArray<{ startedAt: number }>>): Promise<CacheOwners> {
  const owners = new Map<string, number | undefined>();
  for (const id of botIds) {
    const chats = await chatsOf(id);
    owners.set(id, chats.length ? Math.min(...chats.map((c) => c.startedAt)) : undefined);
  }
  return owners;
}

/**
 * The log line the phone runbook reads after a request with a key (every build): how many named keys the engine holds
 * (at most the six recent ones and Hermit's turn key), how many files they have (one each) and the size of QVAC's whole
 * cache folder. Never a key, a bot id or anything the caches hold.
 */
export function cacheSizeLine(keys: number, files: number, bytes: number): string {
  return `[hermit:S1] prompt caches: ${keys} named keys, ${files} files, ${(bytes / 1e6).toFixed(1)} MB on disk`;
}

/** A failure of the cache functions, on the same dev log: the act and the error's kind, never its words (they name paths). */
export function cacheFailureLine(action: CacheAction, err: unknown): string {
  return `[hermit:S1] prompt cache: ${action} failed (${err instanceof Error ? err.name : typeof err})`;
}
