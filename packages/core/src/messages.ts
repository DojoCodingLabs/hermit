import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils.js";
import { looksLikeOneTimeCode } from "./one-time-code.ts";
import type { SqlPort } from "./ports.ts";
import type { RenderContext } from "./types.ts";

/**
 * FR-MSG-01 to FR-MSG-04: messages captured from WhatsApp notifications.
 * The native listener produces `CapturedNotification`s (live, or from its queue when JS was not running);
 * this store dedupes them, keeps one row per conversation and hands the reply handle back for sending.
 * Everything in here was written by other people: callers wrap it as untrusted (CT-09).
 */
export type MessagingApp = "whatsapp" | "whatsapp_business";

export const APP_PACKAGES: Readonly<Record<string, MessagingApp>> = {
  "com.whatsapp": "whatsapp",
  "com.whatsapp.w4b": "whatsapp_business",
};

export interface CapturedNotification {
  packageName: string;
  /** Stable per chat (the notification's shortcut or conversation id). */
  conversationKey: string;
  /** The chat's display name: a contact or a group title. */
  title: string;
  sender: string;
  text: string;
  postedAt: number;
  /** The Android notification key; with postedAt it identifies a re-post of the same message. */
  notificationKey: string;
  /** Opaque handle to the live RemoteInput reply action, if the notification has one. */
  replyHandle?: string;
}

export interface StoredMessage {
  conversationId: string;
  conversation: string;
  app: MessagingApp;
  sender: string;
  /** Empty when `hidden` is set. */
  text: string;
  at: number;
  /** The message looked like a one-time code, so Hermit never kept its text (US-MSG-07). */
  hidden?: "one_time_code";
}

export const MAX_MESSAGE_TEXT = 4000;
/**
 * Stored in place of a hidden message's text (SQLite cuts strings at NUL, so the tag is wrapped in invisible
 * separators instead). A real message equal to it would also show as hidden, which is the safe side.
 */
const HIDDEN_CODE = "⁣one_time_code⁣";

export interface MessageStore {
  /** Returns false for apps outside the allow-list and for duplicates. */
  ingest(n: CapturedNotification): Promise<boolean>;
  /** Drains the native queue in one transaction. Returns how many were new. */
  ingestMany(ns: CapturedNotification[]): Promise<number>;
  recent(opts?: { from?: string; limit?: number }): Promise<StoredMessage[]>;
  conversations(): Promise<Array<{ id: string; title: string; app: MessagingApp; lastAt: number; canReply: boolean }>>;
  replyHandle(conversationId: string): Promise<string | undefined>;
  /** The notification was dismissed or replaced: the reply action is gone (FR-MSG-04). */
  dropReplyHandle(conversationId: string): Promise<void>;
  /** Trusted data for approval sheets (CT-06): the recipient comes from here, never from the model. */
  renderContext(): Promise<RenderContext>;
}

/** Conversation ids are derived, not chosen: same app and key always give the same id. */
export function conversationId(app: MessagingApp, key: string): string {
  return `wa:${bytesToHex(sha256(utf8ToBytes(`${app}\u0000${key}`))).slice(0, 16)}`;
}

const fold = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
/** App names as the person sees them; the same everywhere, so they are not translated. */
export const APP_LABEL: Readonly<Record<MessagingApp, string>> = { whatsapp: "WhatsApp", whatsapp_business: "WhatsApp Business" };

export function createMessageStore(sql: SqlPort): MessageStore {
  async function insert(tx: SqlPort, n: CapturedNotification): Promise<boolean> {
    const app = APP_PACKAGES[n.packageName];
    if (!app) return false;
    const id = conversationId(app, n.conversationKey);
    const hidden = looksLikeOneTimeCode(n.text);
    // The native key ends in a hash of the text, and a 6-digit code is easy to recover from its hash, so a
    // hidden message keeps only the notification part of the key (re-posts still dedupe on it plus the time).
    const key = hidden ? `${n.notificationKey.split("#")[0]}#one_time_code` : n.notificationKey;
    const dup = await tx.query("SELECT 1 FROM messages WHERE notification_key = ? AND at = ?", [key, n.postedAt]);
    if (dup.length) return false;
    await tx.exec(
      `INSERT INTO conversations (id, app, title, key, reply_handle, last_at) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET title = excluded.title,
         reply_handle = COALESCE(excluded.reply_handle, conversations.reply_handle),
         last_at = MAX(conversations.last_at, excluded.last_at)`,
      [id, app, n.title.slice(0, 200), n.conversationKey, n.replyHandle ?? null, n.postedAt],
    );
    await tx.exec("INSERT INTO messages (conversation_id, sender, text, at, notification_key) VALUES (?, ?, ?, ?, ?)", [
      id, n.sender.slice(0, 200), hidden ? HIDDEN_CODE : n.text.slice(0, MAX_MESSAGE_TEXT), n.postedAt, key,
    ]);
    return true;
  }

  const store: MessageStore = {
    ingest: (n) => sql.transaction((tx) => insert(tx, n)),
    ingestMany: (ns) =>
      sql.transaction(async (tx) => {
        let added = 0;
        for (const n of [...ns].sort((a, b) => a.postedAt - b.postedAt)) if (await insert(tx, n)) added++;
        return added;
      }),
    async recent(opts = {}) {
      const rows = await sql.query<{ conversation_id: string; title: string; app: MessagingApp; sender: string; text: string; at: number }>(
        `SELECT m.conversation_id, c.title, c.app, m.sender, m.text, m.at FROM messages m
         JOIN conversations c ON c.id = m.conversation_id ORDER BY m.at DESC LIMIT 500`,
      );
      const who = opts.from?.trim() ? fold(opts.from) : undefined;
      return rows
        .filter((r) => !who || fold(r.sender).includes(who) || fold(r.title).includes(who))
        .slice(0, Math.min(opts.limit ?? 20, 50))
        .map((r) => {
          const base = { conversationId: r.conversation_id, conversation: r.title, app: r.app, sender: r.sender, at: r.at };
          // Rows stored before the detector existed are checked again on the way out.
          return r.text === HIDDEN_CODE || looksLikeOneTimeCode(r.text)
            ? { ...base, text: "", hidden: "one_time_code" as const }
            : { ...base, text: r.text };
        });
    },
    async conversations() {
      const rows = await sql.query<{ id: string; title: string; app: MessagingApp; last_at: number; reply_handle: string | null }>(
        "SELECT id, title, app, last_at, reply_handle FROM conversations ORDER BY last_at DESC",
      );
      return rows.map((r) => ({ id: r.id, title: r.title, app: r.app, lastAt: r.last_at, canReply: r.reply_handle !== null }));
    },
    async replyHandle(id) {
      const [row] = await sql.query<{ reply_handle: string | null }>("SELECT reply_handle FROM conversations WHERE id = ?", [id]);
      return row?.reply_handle ?? undefined;
    },
    async dropReplyHandle(id) {
      await sql.exec("UPDATE conversations SET reply_handle = NULL WHERE id = ?", [id]);
    },
    async renderContext() {
      const rows = await sql.query<{ id: string; title: string; app: MessagingApp }>("SELECT id, title, app FROM conversations");
      const byId = new Map(rows.map((r) => [r.id, { name: r.title, address: APP_LABEL[r.app] }]));
      return { conversation: (id: string) => byId.get(id) };
    },
  };
  return store;
}
