import { beforeEach, describe, expect, test } from "vitest";
import { nodeSql } from "@hermit/sql-node";
import { migrate } from "../src/schema.ts";
import { conversationId, createMessageStore, type CapturedNotification, type MessageStore } from "../src/messages.ts";

let store: MessageStore;
beforeEach(async () => {
  const sql = nodeSql();
  await migrate(sql);
  store = createMessageStore(sql);
});

const note = (over: Partial<CapturedNotification> = {}): CapturedNotification => ({
  packageName: "com.whatsapp",
  conversationKey: "chat-1",
  title: "Ana",
  sender: "Ana",
  text: "¿Dónde estás?",
  postedAt: 1000,
  notificationKey: "0|com.whatsapp|1|chat-1",
  replyHandle: "h1",
  ...over,
});

describe("captured messages (FR-MSG-01 to FR-MSG-04)", () => {
  test("stores a message and its conversation", async () => {
    expect(await store.ingest(note())).toBe(true);
    const [m] = await store.recent();
    expect(m).toMatchObject({ conversation: "Ana", sender: "Ana", text: "¿Dónde estás?", app: "whatsapp" });
    expect(m!.conversationId).toBe(conversationId("whatsapp", "chat-1"));
  });

  test("ignores apps outside the allow-list", async () => {
    expect(await store.ingest(note({ packageName: "org.telegram.messenger" }))).toBe(false);
    expect(await store.recent()).toEqual([]);
  });

  test("drops re-posted duplicates (FR-MSG-02)", async () => {
    await store.ingest(note());
    expect(await store.ingest(note())).toBe(false);
    expect(await store.recent()).toHaveLength(1);
  });

  test("drains the native queue in order, once", async () => {
    const queue = [note({ postedAt: 3000, text: "c", notificationKey: "k3" }), note({ postedAt: 2000, text: "b", notificationKey: "k2" }), note({ postedAt: 3000, text: "c", notificationKey: "k3" })];
    expect(await store.ingestMany(queue)).toBe(2);
    expect((await store.recent()).map((m) => m.text)).toEqual(["c", "b"]);
  });

  test("filters by sender or chat, ignoring accents and case", async () => {
    await store.ingest(note({ sender: "José", title: "José", conversationKey: "c2", notificationKey: "k2" }));
    await store.ingest(note());
    expect((await store.recent({ from: "jose" })).map((m) => m.sender)).toEqual(["José"]);
  });

  test("the recipient on the approval sheet comes from captured data (CT-06)", async () => {
    await store.ingest(note());
    const ctx = await store.renderContext();
    expect(ctx.conversation(conversationId("whatsapp", "chat-1"))).toEqual({ name: "Ana", address: "WhatsApp" });
    expect(ctx.conversation("wa:made-up-by-model")).toBeUndefined();
  });

  test("a dismissed notification leaves the conversation unable to reply (stale)", async () => {
    await store.ingest(note());
    const id = conversationId("whatsapp", "chat-1");
    expect(await store.replyHandle(id)).toBe("h1");
    await store.dropReplyHandle(id);
    expect(await store.replyHandle(id)).toBeUndefined();
    expect((await store.conversations())[0]!.canReply).toBe(false);
  });

  test("a new notification refreshes the reply handle; one without a handle keeps the old one", async () => {
    await store.ingest(note());
    await store.ingest(note({ postedAt: 2000, notificationKey: "k2", replyHandle: "h2" }));
    await store.ingest(note({ postedAt: 3000, notificationKey: "k3", replyHandle: undefined }));
    expect(await store.replyHandle(conversationId("whatsapp", "chat-1"))).toBe("h2");
  });
});

describe("WhatsApp Business (US-MSG-06)", () => {
  const biz = (over: Partial<CapturedNotification> = {}) =>
    note({ packageName: "com.whatsapp.w4b", notificationKey: "0|com.whatsapp.w4b|1|chat-1", replyHandle: "hb", ...over });

  test("is captured and keeps its own source", async () => {
    expect(await store.ingest(biz())).toBe(true);
    const [m] = await store.recent();
    expect(m).toMatchObject({ app: "whatsapp_business", sender: "Ana" });
    expect((await store.conversations())[0]).toMatchObject({ app: "whatsapp_business", canReply: true });
  });

  test("the same chat key in both apps stays two conversations, each with its own reply handle", async () => {
    await store.ingest(note());
    await store.ingest(biz());
    const convs = await store.conversations();
    expect(convs.map((c) => c.app).sort()).toEqual(["whatsapp", "whatsapp_business"]);
    expect(await store.replyHandle(conversationId("whatsapp", "chat-1"))).toBe("h1");
    expect(await store.replyHandle(conversationId("whatsapp_business", "chat-1"))).toBe("hb");
  });

  test("the approval sheet names the app the reply goes out through (CT-06)", async () => {
    await store.ingest(biz());
    const ctx = await store.renderContext();
    expect(ctx.conversation(conversationId("whatsapp_business", "chat-1"))).toEqual({ name: "Ana", address: "WhatsApp Business" });
  });
});

describe("one-time codes (US-MSG-07, ASM-13)", () => {
  test("a message that looks like a code is stored hidden: the code never reaches the database", async () => {
    const sql = nodeSql();
    await migrate(sql);
    const s = createMessageStore(sql);
    await s.ingest(note({ text: "Tu código de verificación es 482913", sender: "Banco", title: "Banco" }));
    const [m] = await s.recent();
    expect(m).toMatchObject({ sender: "Banco", text: "", hidden: "one_time_code" });
    const rows = await sql.query<{ text: string }>("SELECT text FROM messages");
    expect(JSON.stringify(rows)).not.toContain("482913");
  });

  test("a hidden message drops the text hash from its key and still dedupes re-posts", async () => {
    const sql = nodeSql();
    await migrate(sql);
    const s = createMessageStore(sql);
    const code = note({ text: "Your code is 482913", notificationKey: "0|com.whatsapp|1|chat-1#-1407220531" });
    expect(await s.ingest(code)).toBe(true);
    expect(await s.ingest(code)).toBe(false);
    const rows = await sql.query<{ notification_key: string }>("SELECT notification_key FROM messages");
    expect(rows).toEqual([{ notification_key: "0|com.whatsapp|1|chat-1#one_time_code" }]);
  });

  test("ordinary messages are not marked", async () => {
    await store.ingest(note());
    const [m] = await store.recent();
    expect(m!.hidden).toBeUndefined();
    expect(m!.text).toBe("¿Dónde estás?");
  });
});
