import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { createBotSessions, followSession } from "./bot-sessions.ts";
import { forgetBotCachesOn, type CacheDisk } from "./cache-keys.ts";

function fakeHermit() {
  let n = 0;
  const h = {
    resumeCalls: 0,
    resets: [] as string[],
    /** What the chat sent, by session; a session a reset deleted refuses, as the runtime does ("No session"). */
    sent: [] as Array<[string, string]>,
    gone: new Set<string>(),
    send: async (sessionId: string, text: string) => {
      if (h.gone.has(sessionId)) throw new Error(`No session ${sessionId}.`);
      h.sent.push([sessionId, text]);
    },
    /** A bot whose turn still runs: its reset is refused, as the runtime does (Review Focus 1). */
    busy: new Set<string>(),
    opened: [] as string[],
    resumeSession: async (botId?: string) => {
      h.resumeCalls++;
      const id = `s-${botId}-${++n}`;
      h.opened.push(id);
      return id;
    },
    newChat: async (botId: string) => {
      const id = `s-${botId}-${++n}`;
      h.opened.push(id);
      return id;
    },
    bots: {
      reset: async (botId: string) => {
        h.resets.push(botId);
        if (h.busy.has(botId)) return { kind: "refused" as const, reason: "busy" as const };
        // A reset deletes every session of the bot (packages/core sessions.clear) and starts one.
        for (const id of h.opened) if (id.startsWith(`s-${botId}-`)) h.gone.add(id);
        return { kind: "done" as const, sessionId: `s-${botId}-${++n}` };
      },
    },
  };
  return h;
}

test("each bot keeps its own session, opened once", async () => {
  const h = fakeHermit();
  const s = createBotSessions(h);
  assert.equal(await s.open("b1"), "s-b1-1");
  assert.equal(await s.open("b1"), "s-b1-1");
  assert.equal(await s.open("hermit"), "s-hermit-2");
  assert.equal(h.resumeCalls, 2);
});

test("a new chat or a clear replaces only that bot's session", async () => {
  const h = fakeHermit();
  const s = createBotSessions(h);
  await s.open("b1");
  await s.open("hermit");
  await s.newChat("b1");
  assert.equal(s.current("b1"), "s-b1-3");
  await s.clear("b1");
  assert.equal(s.current("b1"), "s-b1-4");
  assert.equal(s.current("hermit"), "s-hermit-2");
});

test("use picks an older chat, and forget drops the cached session", async () => {
  const h = fakeHermit();
  const s = createBotSessions(h);
  await s.open("b1");
  s.use("b1", "old-chat");
  assert.equal(await s.open("b1"), "old-chat");
  s.forget("b1");
  assert.equal(s.current("b1"), undefined);
  assert.equal(await s.open("b1"), "s-b1-2");
});

test("the chat menu's clear is the bot's reset, the act Activity logs as bot.reset; a refused one keeps the chat", async () => {
  const h = fakeHermit();
  const s = createBotSessions(h);
  await s.open("hermit");
  assert.deepEqual(await s.clear("hermit"), { kind: "done", sessionId: "s-hermit-2" });
  assert.equal(s.current("hermit"), "s-hermit-2");
  h.busy.add("b1");
  await s.open("b1");
  assert.deepEqual(await s.clear("b1"), { kind: "refused", reason: "busy" });
  assert.equal(s.current("b1"), "s-b1-3");
  assert.deepEqual(h.resets, ["hermit", "b1"]);
});

test("screens follow the session each bot is on now, never the one from startup (ruling 2)", async () => {
  const h = fakeHermit();
  const s = createBotSessions(h);
  const startup = await s.open("hermit");
  // HM-BOT-04's reset hands its new session over; the chat's clear and a new chat replace it too.
  s.use("hermit", "after-reset");
  assert.equal(await s.open("hermit"), "after-reset");
  await s.clear("hermit");
  assert.notEqual(await s.open("hermit"), startup);
  // The context hands out no startup session id at all: every screen asks for the bot it shows.
  const app = new URL("./app/", import.meta.url).pathname;
  const sources = [
    ...readdirSync(app).filter((f) => f.endsWith(".tsx")).map((f) => [f, readFileSync(join(app, f), "utf8")] as const),
    ["hermit-context.tsx", readFileSync(new URL("./hermit-context.tsx", import.meta.url), "utf8")] as const,
  ];
  for (const [file, src] of sources) assert.doesNotMatch(src, /status\.sessionId|sessionId: string; sessions/, file);
});

test("a reset deletes that bot's prompt caches, its turn key and its long key; Hermit's clear too; a refused one none", async () => {
  // The coordinator's privacy ruling: the cache files hold the cleared conversation's state on disk.
  const P = "botpsy-q4-native-think256";
  const B1 = "3f2a9c1e-0b7d-4e55-9a10-2c4d6e8f0a01";
  const B2 = "7c1d2e3f-4a5b-4c6d-8e9f-0a1b2c3d4e02";
  const keys = new Set([`hermit-v1-hermit-${P}`, `hermit-v1-hermit-long-${P}`, `hermit-v1-${P}`, `hermit-v1-${B1}-${P}`, `hermit-v1-${B1}-long-${P}`, `hermit-v1-${B2}-${P}`]);
  const disk: CacheDisk = {
    list: () => ({ keys: [...keys], files: [] }),
    removeKey: async (key) => void keys.delete(key),
    removeFile: async () => {},
    failed: () => {},
  };
  const h = fakeHermit();
  const s = createBotSessions(h, { forget: async (botId) => void (await forgetBotCachesOn(disk, botId, "reset")) });
  await s.open("hermit");
  // The chat menu's clear for Hermit: its keys go, and so does the key from before bots, which held its chat.
  assert.equal((await s.clear("hermit")).kind, "done");
  assert.deepEqual([...keys].sort(), [`hermit-v1-${B1}-${P}`, `hermit-v1-${B1}-long-${P}`, `hermit-v1-${B2}-${P}`].sort());
  // HM-BOT-04's reset of another bot: its two keys go, another bot's stay.
  assert.equal((await s.clear(B1)).kind, "done");
  assert.deepEqual([...keys], [`hermit-v1-${B2}-${P}`]);
  // While its turn still runs nothing is cleared, so its cache stays too.
  h.busy.add(B2);
  assert.equal((await s.clear(B2)).kind, "refused");
  assert.deepEqual([...keys], [`hermit-v1-${B2}-${P}`]);
  // The app's sessions are made with the engine's cache delete, as a reset's.
  assert.match(readFileSync(new URL("./hermit-context.tsx", import.meta.url), "utf8"), /forget: \(botId\) => forgetBotCaches\(botId, "reset"\)/);
});

test("a cache delete that fails never fails the reset: the conversation is gone and the chat goes on in the new session", async () => {
  const h = fakeHermit();
  const s = createBotSessions(h, { forget: async () => { throw new Error("QVAC kept the cache."); } });
  await s.open("b1");
  const reset = await s.clear("b1");
  assert.equal(reset.kind, "done");
  assert.equal(s.current("b1"), reset.kind === "done" ? reset.sessionId : undefined);
});

test("after HM-BOT-04's reset, the bot's chat follows its new session when it comes back in front, so a send lands there", async () => {
  const h = fakeHermit();
  const s = createBotSessions(h);
  // The chat opens on the bot's session and stays mounted under HM-BOT-04.
  const shown = await s.open("b1");
  await h.send(shown, "hola");
  // Reset from the bot's settings: the chat's session is deleted.
  assert.equal((await s.clear("b1")).kind, "done");
  await assert.rejects(h.send(shown, "¿sigues ahí?"), /No session/);
  // Back in front, the chat follows the session the bot is on now, and its send lands there.
  const now = followSession(s, "b1", shown);
  assert.notEqual(now, shown);
  await h.send(now!, "¿sigues ahí?");
  assert.deepEqual(h.sent, [[shown, "hola"], [now, "¿sigues ahí?"]]);
  // A bot the chat never saw moved keeps what the chat shows.
  assert.equal(followSession(s, "b9", "s-b9-1"), "s-b9-1");
  // The chat reads it each time it comes back in front.
  assert.match(readFileSync(new URL("./app/chat.tsx", import.meta.url), "utf8"), /followSession\(sessions, botId, /);
});
