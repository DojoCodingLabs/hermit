import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  afterWrite, botCacheKeys, botOfKey, cacheFailureLine, cacheOwnersOf, cacheSizeLine, engineCacheKey, forgetBotCachesOn, hermitTurnKey, loadCaches,
  MAX_NAMED_CACHES, touchCacheKey, type CacheDisk, type CacheFile,
} from "./cache-keys.ts";

/** The engine's sanitized keys (`hermit-v1:<bot>:<profile>` and `hermit-v1:<bot>:long:<profile>`), as QVAC names them. */
const PROFILE = "botpsy-q4-native-think256";
const key = (bot: string) => `hermit-v1-${bot}-${PROFILE}`;
const long = (bot: string) => `hermit-v1-${bot}-long-${PROFILE}`;
const HERMIT = hermitTurnKey(PROFILE);

/** Touches each key in turn from an empty disk, the way the engine does for each request. */
function touchAll(keys: string[], keep: readonly string[] = []) {
  let s = { order: [] as string[], evict: [] as string[] };
  for (const k of keys) s = touchCacheKey(s.order, k, MAX_NAMED_CACHES, keep);
  return s;
}

test("at most six caches stay on disk, least recently used out first", () => {
  assert.equal(MAX_NAMED_CACHES, 6);
  let s = touchAll(["b1", "b2", "b3", "b4", "b5", "b6"].map(key));
  assert.deepEqual(s.evict, []);
  s = touchCacheKey(s.order, key("b1"));
  assert.deepEqual(s, { order: [key("b2"), key("b3"), key("b4"), key("b5"), key("b6"), key("b1")], evict: [] });
  s = touchCacheKey(s.order, key("b7"));
  assert.deepEqual(s, { order: [key("b3"), key("b4"), key("b5"), key("b6"), key("b1"), key("b7")], evict: [key("b2")] });
});

// Fix round 1 (the coordinator's load ruling): the six most recently used stay, and Hermit's turn key with them when it
// is older, at every request and at every load alike.
test("Hermit's turn key is never evicted: it stays beside the six most recently used when it is older than them", () => {
  assert.equal(HERMIT, key("hermit"));
  let s = touchAll([HERMIT, key("b1"), key("b2"), key("b3"), key("b4"), key("b5")], [HERMIT]);
  s = touchCacheKey(s.order, key("b6"), MAX_NAMED_CACHES, [HERMIT]);
  assert.deepEqual(s, { order: [HERMIT, key("b1"), key("b2"), key("b3"), key("b4"), key("b5"), key("b6")], evict: [] });
  s = touchCacheKey(s.order, key("b7"), MAX_NAMED_CACHES, [HERMIT]);
  assert.deepEqual(s, { order: [HERMIT, key("b2"), key("b3"), key("b4"), key("b5"), key("b6"), key("b7")], evict: [key("b1")] });
  // Without the pin, the same order would have dropped Hermit's first.
  assert.deepEqual(touchCacheKey([HERMIT, key("b2"), key("b3"), key("b4"), key("b5"), key("b6")], key("b7")).evict, [HERMIT]);
});

test("a bot's long-answer key is a cache of its own: two keys per active bot, and Hermit's long key can go", () => {
  let s = touchAll([HERMIT, long("hermit"), key("b1"), long("b1"), key("b2"), long("b2")], [HERMIT]);
  assert.deepEqual(s.evict, []);
  s = touchCacheKey(s.order, key("b3"), MAX_NAMED_CACHES, [HERMIT]);
  assert.deepEqual(s.evict, []);
  s = touchCacheKey(s.order, long("b3"), MAX_NAMED_CACHES, [HERMIT]);
  assert.deepEqual(s.evict, [long("hermit")]);
  assert.deepEqual(s.order, [HERMIT, key("b1"), long("b1"), key("b2"), long("b2"), key("b3"), long("b3")]);
});

test("a key already on disk moves last and evicts nothing; a smaller cap evicts as many as it must", () => {
  assert.deepEqual(touchCacheKey([key("b1"), key("b2")], key("b1")), { order: [key("b2"), key("b1")], evict: [] });
  assert.deepEqual(touchCacheKey([key("b1"), key("b2"), key("b3")], key("b4"), 2), { order: [key("b3"), key("b4")], evict: [key("b1"), key("b2")] });
  // The key a request uses now is never the one evicted, pinned or not.
  assert.deepEqual(touchCacheKey([HERMIT], key("b1"), 1, [HERMIT]), { order: [HERMIT, key("b1")], evict: [] });
});

test("the engine's keys: QVAC takes letters, digits, '_' and '-' only", () => {
  assert.equal(engineCacheKey(`hermit-v1:b1:${PROFILE}`), key("b1"));
  assert.equal(engineCacheKey(`hermit-v1:b1:long:${PROFILE}`), long("b1"));
  assert.equal(engineCacheKey("hermit-v1:3f2a9c1e-0b7d-4e55-9a10-2c4d6e8f0a1b:x.y"), "hermit-v1-3f2a9c1e-0b7d-4e55-9a10-2c4d6e8f0a1b-x-y");
});

test("the phone runbook's line: how many named keys and files, and their size on disk, never a key", () => {
  assert.equal(cacheSizeLine(4, 4, 312_400_000), "[hermit:S1] prompt caches: 4 named keys, 4 files, 312.4 MB on disk");
  // Six recent ones and Hermit's turn key beside them: seven is in the rule, so the line names no cap to exceed.
  assert.equal(cacheSizeLine(7, 7, 0), "[hermit:S1] prompt caches: 7 named keys, 7 files, 0.0 MB on disk");
  assert.doesNotMatch(cacheSizeLine(6, 6, 1), /hermit-v1/);
});

// --- Loads, writes and deletes, on a cache folder in memory -------------------------------------------------------

/** Bot ids are UUIDs (the runtime's randomUUID); Hermit's is "hermit". */
const B1 = "3f2a9c1e-0b7d-4e55-9a10-2c4d6e8f0a01";
const B2 = "7c1d2e3f-4a5b-4c6d-8e9f-0a1b2c3d4e02";
const B3 = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c03";
const HERMIT_LONG = long("hermit");

/** One file QVAC wrote: `<key>/<model folder>/<prompt hash>.bin`. */
const file = (k: string, model: string, hash: string, at: number): CacheFile => ({ key: k, model, path: `${k}/${model}/${hash}.bin`, modifiedAt: at });

/** QVAC's cache folder in memory: the engine's disk port, with failures it can be told to make. */
function fakeDisk(initial: CacheFile[] = []) {
  const files = new Map(initial.map((f) => [f.path, f] as const));
  const folders = new Set(initial.map((f) => f.key));
  const d = {
    failures: [] as string[],
    unreadable: false,
    failDeletes: false,
    write(k: string, model: string, hash: string, at: number) {
      folders.add(k);
      const f = file(k, model, hash, at);
      files.set(f.path, f);
    },
    keys: () => [...folders],
    filesOf: (k: string) => [...files.values()].filter((f) => f.key === k),
    list() {
      if (d.unreadable) throw new Error("EACCES: permission denied, scandir /data/user/0/hermit/files/.qvac/kv-cache");
      return { keys: [...folders], files: [...files.values()] };
    },
    async removeKey(k: string, model?: string) {
      if (d.failDeletes) throw Object.assign(new Error(`could not delete ${k}`), { name: "DeleteCacheFailedError" });
      for (const [path, f] of files) if (f.key === k && (model === undefined || f.model === model)) files.delete(path);
      if (model === undefined) folders.delete(k);
    },
    async removeFile(path: string) {
      if (d.failDeletes) throw Object.assign(new Error(`could not delete ${path}`), { name: "Error" });
      files.delete(path);
    },
    failed(action: string, err: unknown) {
      d.failures.push(`${action}: ${err instanceof Error ? err.name : String(err)}`);
    },
  } satisfies CacheDisk & Record<string, unknown>;
  return d;
}

/** Each key written once, a minute apart, oldest first, in model folder m5. */
const written = (keys: string[]) => keys.map((k, i) => file(k, "m5", `h${i}`, 1_000_000 + i * 60_000));

test("a load keeps what is on disk within the cap: three caches stay, in the order they were written", async () => {
  const disk = fakeDisk(written([key(B1), HERMIT, long(B1)]).reverse());
  assert.deepEqual(await loadCaches(disk, { keep: [HERMIT] }), [key(B1), HERMIT, long(B1)]);
  assert.deepEqual(disk.keys().sort(), [HERMIT, key(B1), long(B1)].sort());
});

test("a load with eight keeps the six newest, and Hermit's turn key too when it is among the older ones", async () => {
  const bots = Array.from({ length: 7 }, (_, i) => `${B1.slice(0, -2)}${String(i + 10)}`);
  const eight = [key(bots[0]!), HERMIT, ...bots.slice(1).map(key)];
  const disk = fakeDisk(written(eight));
  assert.deepEqual(await loadCaches(disk, { keep: [HERMIT] }), [HERMIT, ...bots.slice(1).map(key)]);
  assert.ok(!disk.keys().includes(key(bots[0]!)));
  // Among the six newest, Hermit's is one of them: the two oldest go.
  const newer = fakeDisk(written([key(bots[0]!), key(bots[1]!), HERMIT, ...bots.slice(2).map(key)]));
  await loadCaches(newer, { keep: [HERMIT] });
  assert.deepEqual(eight.length - newer.keys().length, 2);
  assert.ok(!newer.keys().includes(key(bots[0]!)) && !newer.keys().includes(key(bots[1]!)));
});

test("a load drops the keys this app no longer writes: the pre-multi-bot hermit-v1-<profile> and its long key, hermit-long, the eval screen's", async () => {
  const old = [`hermit-v1-${PROFILE}`, `hermit-v1-long-${PROFILE}`, `hermit-long-${PROFILE}`, `eval-${PROFILE}`, `probe-${PROFILE}`];
  for (const k of old) assert.equal(botOfKey(k), undefined, k);
  assert.equal(botOfKey(HERMIT), "hermit");
  assert.equal(botOfKey(long(B1)), B1);
  const disk = fakeDisk(written([...old, HERMIT, key(B1)]));
  assert.deepEqual(await loadCaches(disk, { keep: [HERMIT] }), [HERMIT, key(B1)]);
  assert.deepEqual(disk.keys().sort(), [HERMIT, key(B1)].sort());
});

test("opening the dev eval screen no longer wipes the chat's caches: its load keeps them, and drops only keys this app no longer writes", async () => {
  // The chat's caches, then the eval engine loads its own profile (another Hermit turn key) and finds them on disk.
  const chat = [HERMIT, HERMIT_LONG, key(B1)];
  const evalProfile = "botpsy-q4-two-stage-nothink";
  const disk = fakeDisk(written([`eval-${evalProfile}`, ...chat, `probe-${evalProfile}`]));
  assert.deepEqual(await loadCaches(disk, { keep: [hermitTurnKey(evalProfile)] }), chat);
  assert.deepEqual(disk.keys().sort(), [...chat].sort());
});

test("a load leaves QVAC's automatic caches to QVAC", async () => {
  const disk = fakeDisk([file("0123456789abcdef", "m5", "a", 1), ...written([HERMIT])]);
  assert.deepEqual(await loadCaches(disk, { keep: [HERMIT] }), [HERMIT]);
  assert.ok(disk.keys().includes("0123456789abcdef"));
});

test("three reloads of the same keys leave one file per key, Hermit's pinned key included", async () => {
  const disk = fakeDisk();
  const inUse = [HERMIT, HERMIT_LONG, key(B1), long(B1)];
  let clock = 1_000_000;
  // On screen, in the background, on screen again: each load gets its own model folder (the thread plan is in QVAC's id),
  // and its first request with a key writes a file for today's prompt beside what an earlier load left.
  for (const [reload, model] of [[1, "m5"], [2, "m3"], [3, "m5"]] as const) {
    await loadCaches(disk, { keep: [HERMIT] });
    for (const k of inUse) {
      disk.write(k, model, `prompt${reload}`, (clock += 1_000));
      await afterWrite(disk, k);
    }
  }
  for (const k of inUse) assert.deepEqual(disk.filesOf(k).map((f) => f.path), [`${k}/m5/prompt3.bin`], k);
  // A load alone prunes too: files left beside each other by an older build go down to the newest.
  const old = fakeDisk([file(HERMIT, "m5", "a", 10), file(HERMIT, "m3", "b", 30), file(HERMIT, "m5", "c", 20), file(key(B1), "m5", "d", 5), file(key(B1), "m5", "e", 6)]);
  await loadCaches(old, { keep: [HERMIT] });
  assert.deepEqual(old.filesOf(HERMIT).map((f) => f.path), [`${HERMIT}/m3/b.bin`]);
  assert.deepEqual(old.filesOf(key(B1)).map((f) => f.path), [`${key(B1)}/m5/e.bin`]);
});

test("a load sweeps what a reset or a delete left: a gone bot's caches, and a reset bot's files written before its reset", async () => {
  const disk = fakeDisk([
    file(key(B1), "m5", "a", 1_000), // B1 was reset at 2,000: written before, so it goes
    file(long(B1), "m5", "b", 2_500), // written after the reset: it stays
    file(key(B2), "m5", "c", 1_500), // B2 was deleted: it goes
    file(HERMIT, "m5", "d", 900), // Hermit's clear at 1,000: its pinned key goes too
    file(HERMIT_LONG, "m5", "e", 3_000), // after Hermit's clear: it stays
    file(key(B3), "m5", "f", 4_000), // B3 has no chat left: nothing of it can be kept
  ]);
  const owners = new Map<string, number | undefined>([["hermit", 1_000], [B1, 2_000], [B3, undefined]]);
  assert.deepEqual(await loadCaches(disk, { keep: [HERMIT], owners }), [long(B1), HERMIT_LONG]);
  assert.deepEqual(disk.keys().sort(), [HERMIT_LONG, long(B1)].sort());
  // An engine with no one to ask (the dev eval screen, a model update's self-test) sweeps nothing, and keeps the cap.
  const unknown = fakeDisk([file(key(B2), "m5", "c", 1_500)]);
  assert.deepEqual(await loadCaches(unknown, { keep: [HERMIT] }), [key(B2)]);
});

test("the sweep's owners: every bot there is, with when its oldest chat began, which a reset makes the reset's time", async () => {
  const chats: Record<string, Array<{ startedAt: number }>> = { hermit: [{ startedAt: 5 }], [B1]: [{ startedAt: 50 }, { startedAt: 20 }], [B2]: [] };
  const owners = await cacheOwnersOf(["hermit", B1, B2], async (id) => chats[id] ?? []);
  assert.deepEqual([...owners], [["hermit", 5], [B1, 20], [B2, undefined]]);
});

test("a cache folder that can't be read or a delete that fails is logged, and never fails the user's act", async () => {
  const disk = fakeDisk(written([HERMIT, key(B1), long(B1)]));
  disk.unreadable = true;
  assert.deepEqual(await loadCaches(disk, { keep: [HERMIT] }), []);
  assert.deepEqual(await forgetBotCachesOn(disk, B1, "reset"), []);
  disk.unreadable = false;
  disk.failDeletes = true;
  assert.deepEqual(await forgetBotCachesOn(disk, B1, "delete"), []);
  assert.deepEqual(disk.failures, ["list: Error", "list: Error", "delete: DeleteCacheFailedError", "delete: DeleteCacheFailedError"]);
  // Nothing was deleted, so the next load's sweep still finds them.
  assert.deepEqual(disk.keys().sort(), [HERMIT, key(B1), long(B1)].sort());
});

test("the failure line names the act and the error's kind, never a key, a path or the error's words", () => {
  const err = Object.assign(new Error(`could not delete ${key(B1)} at /data/user/0/.qvac/kv-cache`), { name: "DeleteCacheFailedError" });
  assert.equal(cacheFailureLine("reset", err), "[hermit:S1] prompt cache: reset failed (DeleteCacheFailedError)");
  assert.equal(cacheFailureLine("list", "boom"), "[hermit:S1] prompt cache: list failed (string)");
  assert.doesNotMatch(cacheFailureLine("load", err), /hermit-v1|kv-cache|could not/);
});

test("a reset or a delete takes the bot's own keys; Hermit's also takes the keys from before bots, which held its chat", async () => {
  // A bot's keys end at its id's dash: they never take another bot's whose id starts the same.
  const loose = [key("b1"), long("b1"), key("b10"), long("b10")];
  assert.deepEqual(botCacheKeys(loose, "b1"), [key("b1"), long("b1")]);
  assert.deepEqual(botCacheKeys(loose, "b10"), [key("b10"), long("b10")]);
  const before = [`hermit-v1-${PROFILE}`, `hermit-v1-long-${PROFILE}`, `hermit-long-${PROFILE}`];
  const keys = [HERMIT, HERMIT_LONG, ...before, key(B1), long(B1), "0123456789abcdef"];
  assert.deepEqual(botCacheKeys(keys, "hermit"), [HERMIT, HERMIT_LONG, ...before]);
  assert.deepEqual(botCacheKeys(keys, B1), [key(B1), long(B1)]);
  const disk = fakeDisk(written([HERMIT, HERMIT_LONG, `hermit-v1-${PROFILE}`, key(B1)]));
  assert.deepEqual((await forgetBotCachesOn(disk, "hermit", "reset")).sort(), [HERMIT, HERMIT_LONG, `hermit-v1-${PROFILE}`].sort());
  assert.deepEqual(disk.keys(), [key(B1)]);
});

test("the engine never wipes every cache when it loads or closes: it reads what is on disk and keeps the recent ones", () => {
  const engine = readFileSync(new URL("./adapters/qvac-engine.ts", import.meta.url), "utf8");
  assert.doesNotMatch(engine, /deleteCache\(\{\s*all:/);
  assert.match(engine, /loadCaches\(/);
  assert.match(engine, /afterWrite\(/);
  assert.doesNotMatch(engine, /dropNamed/);
});

test("erase everything leaves no named cache: its step deletes QVAC's whole cache folder and fails if QVAC keeps any", () => {
  // QVAC's `all: true` removes the cache root itself (named and automatic caches) and makes it again, empty.
  const erase = readFileSync(new URL("./adapters/erase.ts", import.meta.url), "utf8");
  const step = /case "delete_kv_caches":([\s\S]*?)return;/.exec(erase)?.[1] ?? "";
  assert.match(step, /if \(!\(await deleteCache\(\{ all: true \}\)\)\.success\) throw new Error/);
});
