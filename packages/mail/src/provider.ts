import type { ConnectorTransport } from "@hermit/connectors";
import type { CredentialStorePort } from "@hermit/core";

/** One message in a list: headers and a short text preview. Every text field is someone else's words. */
export interface MailHeader {
  /** The provider's own id; the model never sees it (it gets a short id from MailCache). */
  id: string;
  accountId: string;
  from: string;
  subject: string;
  /** Received, epoch ms. */
  at: number;
  preview: string;
  unread: boolean;
}

export interface MailMessage extends MailHeader {
  to: string[];
  cc: string[];
  /** The body as plain text. */
  text: string;
}

export interface MailQuery {
  /** Words that must appear in the message. */
  words?: string;
  from?: string;
}

/** reserved_label: a label named like a system label or folder (TRASH, Junk Email), refused by every provider. */
export type MailProblem = "not_connected" | "sign_in_again" | "unreachable" | "provider_error" | "not_found" | "reserved_label";

export type MailResult<T> = { ok: true; value: T } | { ok: false; problem: MailProblem };

/**
 * An email to send or save as a draft (SL-49), exactly as the approval sheet showed it. Addresses are bare
 * (emailOf); the text is plain.
 */
export interface OutgoingMail {
  from: string;
  to: string[];
  cc: string[];
  subject: string;
  text: string;
  /** The provider id of the message this answers, so it lands in the same thread. */
  inReplyTo?: string;
}

/** What mail_modify does to each message (FR-MAIL-03). */
export type MailChange = { kind: "archive" } | { kind: "mark_read" } | { kind: "label"; label: string };

/** One account's mailbox, read on demand (FR-MAIL-05). Gmail and Graph over HTTPS, others over IMAP and SMTP. */
export interface MailProvider {
  /** The inbox, newest first. */
  list(query: { unreadOnly: boolean; max: number }): Promise<MailResult<MailHeader[]>>;
  /** The provider's own search (Gmail query, Graph $search, IMAP SEARCH). */
  search(query: MailQuery, max: number): Promise<MailResult<MailHeader[]>>;
  read(id: string): Promise<MailResult<MailMessage>>;
  /** Sends one email; only after the user approved it (`send` risk). */
  send(mail: OutgoingMail): Promise<MailResult<void>>;
  /** Saves a draft in the account's Drafts (`remote_write`). */
  saveDraft(mail: OutgoingMail): Promise<MailResult<void>>;
  /** Archives, labels or marks read; returns how many messages changed. */
  modify(ids: string[], change: MailChange): Promise<MailResult<number>>;
  /**
   * SL-56b: one message's Authentication-Results headers, topmost first, as the provider stored them (`mailAuthVerdict`
   * reads them). Absent on IMAP: Hermit knows no IMAP server's verdict, so no IMAP email gives a web task its code.
   */
  authResults?(id: string): Promise<MailResult<string[]>>;
}

export interface MailNetDeps {
  credentials: CredentialStorePort;
  /** HTTPS, implemented by the app over the FR-PRIV-02 fetch wrapper. */
  transport: ConnectorTransport;
  now(): number;
}
