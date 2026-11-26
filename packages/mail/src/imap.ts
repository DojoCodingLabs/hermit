import { Secret } from "@hermit/connectors";
import type { CredentialStorePort } from "@hermit/core";
import { systemLabel } from "@hermit/skills";
import type { ImapServer, MailAccount, SmtpServer } from "./accounts.ts";
import { buildMime } from "./mime.ts";
import type { MailChange, MailHeader, MailMessage, MailProvider, MailQuery, MailResult, OutgoingMail } from "./provider.ts";
import { clip, htmlToText, plainText } from "./text.ts";

/** IMAP SEARCH keys Hermit uses (RFC 9051 section 6.4.4), typed so the adapter never parses a model string. */
export type ImapCriterion = { key: "ALL" } | { key: "UNSEEN" } | { key: "FROM" | "TEXT"; value: string };

export interface ImapLogin {
  username: string;
  /** The app password, revealed only by the adapter at login. */
  password: Secret;
}

/** A message as the adapter decoded it (MIME, encoded words and charsets are the adapter's job). */
export interface ImapFetched {
  uid: string;
  from: string;
  to: string[];
  cc: string[];
  subject: string;
  at: number;
  seen: boolean;
  /** The text/plain part, when there is one. */
  text?: string;
  /** The text/html part, used when there is no plain text. */
  html?: string;
  /** Message-ID and References, so a reply joins the thread (SL-49). */
  messageId?: string;
  references?: string;
}

/** Thrown by the adapter when the server refuses the login. */
export class ImapAuthError extends Error {
  constructor(message = "IMAP login refused") {
    super(message);
    this.name = "ImapAuthError";
  }
}

/**
 * IMAP over implicit TLS, implemented by the app (raw sockets are not HTTP, so this is not the connector
 * transport). The adapter verifies the server certificate, never downgrades to plain text, sends each
 * criterion as a quoted string or literal, and reads only; it never sets flags (BODY.PEEK).
 */
export interface ImapPort {
  verify(server: ImapServer, login: ImapLogin): Promise<"ok" | "auth_failed" | "unreachable">;
  /** Newest first, at most `limit`, with the text part (or its start) for the preview. */
  search(server: ImapServer, login: ImapLogin, request: { mailbox: "INBOX"; criteria: ImapCriterion[]; limit: number }): Promise<ImapFetched[]>;
  fetch(server: ImapServer, login: ImapLogin, mailbox: "INBOX", uid: string): Promise<ImapFetched | undefined>;
  /** SL-49: stores a finished message (built by buildMime) in the Drafts mailbox (the special-use \Drafts one). */
  append?(server: ImapServer, login: ImapLogin, mailbox: "Drafts", message: string): Promise<void>;
  /**
   * SL-49: archive (MOVE to the special-use \Archive mailbox), mark read (STORE +FLAGS \Seen), or label (COPY
   * to a mailbox with that name, created if missing). Returns how many messages changed. A label never goes
   * into a mailbox with a special-use attribute (\Trash, \Junk, \All, \Archive, \Drafts, \Sent, \Flagged):
   * the provider refuses system names first, and the adapter refuses such a mailbox on servers that name it
   * differently.
   */
  modify?(server: ImapServer, login: ImapLogin, mailbox: "INBOX", uids: string[], change: MailChange): Promise<number>;
}

/**
 * SMTP submission, implemented by the app (SL-49): implicit TLS on 465, or STARTTLS required on 587, the
 * certificate verified, AUTH with the app password. The message is sent as given (buildMime); the envelope
 * recipients are exactly To and Cc. Throws SmtpAuthError when the login is refused.
 */
export interface SmtpPort {
  send(server: SmtpServer, login: ImapLogin, envelope: { from: string; to: string[] }, message: string): Promise<void>;
}

export class SmtpAuthError extends Error {
  constructor(message = "SMTP login refused") {
    super(message);
    this.name = "SmtpAuthError";
  }
}

/** Control characters (CR and LF above all) are removed, so a value can never end the command it is in. */
const imapValue = (v: string) => [...v].filter((c) => c.charCodeAt(0) >= 0x20 && c.charCodeAt(0) !== 0x7f).join("").replace(/\s+/g, " ").trim().slice(0, 200);

/** SEARCH criteria from the request: every word is its own TEXT key, so all must appear (like Gmail). */
export function imapCriteria(q: MailQuery & { unreadOnly?: boolean }): ImapCriterion[] {
  const out: ImapCriterion[] = [];
  if (q.unreadOnly) out.push({ key: "UNSEEN" });
  const from = imapValue(q.from ?? "");
  if (from) out.push({ key: "FROM", value: from });
  for (const w of imapValue(q.words ?? "").split(" ").filter(Boolean).slice(0, 8)) out.push({ key: "TEXT", value: w });
  return out.length ? out : [{ key: "ALL" }];
}

const UID = /^[0-9]{1,10}$/;

const isAuthError = (err: unknown) => err instanceof ImapAuthError || err instanceof SmtpAuthError || ["ImapAuthError", "SmtpAuthError"].includes((err as Error)?.name);

export function createImapProvider(deps: { credentials: CredentialStorePort; imap?: ImapPort; smtp?: SmtpPort; now(): number }, account: MailAccount): MailProvider {
  const login = async (): Promise<ImapLogin | undefined> => {
    const secret = await deps.credentials.reveal(account.credentialId);
    return secret?.kind === "basic" ? { username: secret.username, password: new Secret(secret.password) } : undefined;
  };
  const attempt = async <T>(op: (l: ImapLogin) => Promise<T>, ready: boolean, port: unknown): Promise<MailResult<T>> => {
    const l = await login();
    if (!l || !ready) return { ok: false, problem: "not_connected" };
    if (!port) return { ok: false, problem: "unreachable" };
    try {
      return { ok: true, value: await op(l) };
    } catch (err) {
      return { ok: false, problem: isAuthError(err) ? "sign_in_again" : "unreachable" };
    } finally {
      await deps.credentials.markUsed(account.credentialId, deps.now());
    }
  };
  const run = <T>(op: (port: ImapPort, server: ImapServer, l: ImapLogin) => Promise<T>): Promise<MailResult<T>> =>
    attempt((l) => op(deps.imap!, account.imap!, l), Boolean(account.imap), deps.imap);
  const submit = async (mail: OutgoingMail): Promise<MailResult<void>> => {
    // A reply carries the original's Message-ID when the server gives it; without it the reply still goes.
    let thread: ImapFetched | undefined;
    if (mail.inReplyTo !== undefined) {
      if (!UID.test(mail.inReplyTo)) return { ok: false, problem: "not_found" };
      const r = await run((p, s, l) => p.fetch(s, l, "INBOX", mail.inReplyTo!));
      if (r.ok) thread = r.value;
    }
    const message = buildMime({ ...mail, at: deps.now(), ...(thread?.messageId ? { inReplyTo: thread.messageId } : {}), ...(thread?.references ? { references: thread.references } : {}) });
    return attempt((l) => deps.smtp!.send(account.smtp!, l, { from: mail.from, to: [...mail.to, ...mail.cc] }, message), Boolean(account.smtp), deps.smtp);
  };
  const body = (m: ImapFetched) => (m.text !== undefined ? plainText(m.text) : m.html !== undefined ? htmlToText(m.html) : "");
  const toHeader = (m: ImapFetched): MailHeader => ({
    id: m.uid, accountId: account.id, from: m.from, subject: m.subject, at: m.at, preview: clip(body(m).replace(/\s+/g, " "), 300), unread: !m.seen,
  });
  const many = async (criteria: ImapCriterion[], limit: number): Promise<MailResult<MailHeader[]>> => {
    const r = await run((p, s, l) => p.search(s, l, { mailbox: "INBOX", criteria, limit }));
    return r.ok ? { ok: true, value: r.value.filter((m) => UID.test(m.uid)).slice(0, limit).map(toHeader) } : r;
  };
  return {
    list: ({ unreadOnly, max }) => many(imapCriteria({ unreadOnly }), max),
    search: (q, max) => many(imapCriteria(q), max),
    async read(uid) {
      if (!UID.test(uid)) return { ok: false, problem: "not_found" };
      const r = await run((p, s, l) => p.fetch(s, l, "INBOX", uid));
      if (!r.ok) return r;
      if (!r.value) return { ok: false, problem: "not_found" };
      const message: MailMessage = { ...toHeader(r.value), to: r.value.to, cc: r.value.cc, text: body(r.value) };
      return { ok: true, value: message };
    },
    send: submit,
    async saveDraft(mail) {
      if (!deps.imap?.append) return { ok: false, problem: "provider_error" };
      const message = buildMime({ ...mail, at: deps.now() });
      return run((p, s, l) => p.append!(s, l, "Drafts", message));
    },
    async modify(uids, change) {
      // A label is a COPY into a mailbox by that name: Trash, Junk, [Gmail]/Trash or INBOX would delete, junk
      // or move mail. Those names are refused here; the adapter also refuses any special-use mailbox.
      if (change.kind === "label" && systemLabel(change.label)) return { ok: false, problem: "reserved_label" };
      const valid = uids.filter((u) => UID.test(u));
      if (!valid.length) return { ok: true, value: 0 };
      if (deps.imap && !deps.imap.modify) return { ok: false, problem: "provider_error" };
      return run((p, s, l) => p.modify!(s, l, "INBOX", valid, change));
    },
  };
}
