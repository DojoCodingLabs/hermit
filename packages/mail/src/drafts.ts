import type { TaintSource } from "@hermit/core";

/**
 * Drafts Hermit wrote and saved to the provider (US-MAIL-04), kept on the phone for HM-MAIL-04 so the user can
 * edit and send them. In memory: a draft also lives in the account's own Drafts folder, so nothing is lost
 * when the app restarts.
 */
export interface MailDraft {
  /** "d1", "d2": the id the draft screen and the chat use. */
  ref: string;
  accountId: string;
  /** The sending account's address. */
  from: string;
  to: string[];
  cc: string[];
  subject: string;
  body: string;
  /** For a reply draft: the short id of the message it answers, and that message's sender. */
  replyTo?: { ref: string; to: string };
  savedAt: number;
  /**
   * What the session that wrote it had read (the last taint), when it had: sending it later from HM-MAIL-04 shows the
   * same "suggested after reading" warning, since the model may have written the text after reading others' words.
   */
  taint?: TaintSource["kind"];
}

export class MailDrafts {
  readonly #items = new Map<string, MailDraft>();
  #next = 1;

  add(draft: Omit<MailDraft, "ref">): MailDraft {
    const d = { ...draft, ref: `d${this.#next++}`, to: [...draft.to], cc: [...draft.cc] };
    this.#items.set(d.ref, d);
    return { ...d };
  }

  get(ref: string): MailDraft | undefined {
    const d = this.#items.get(ref);
    return d && { ...d, to: [...d.to], cc: [...d.cc] };
  }

  /** The user's edits on HM-MAIL-04. */
  update(ref: string, edit: Partial<Pick<MailDraft, "to" | "cc" | "subject" | "body">>): MailDraft | undefined {
    const d = this.#items.get(ref);
    if (!d) return undefined;
    const next = { ...d, ...edit };
    this.#items.set(ref, next);
    return this.get(ref);
  }

  delete(ref: string): boolean {
    return this.#items.delete(ref);
  }

  latest(): MailDraft | undefined {
    const last = [...this.#items.values()].at(-1);
    return last && this.get(last.ref);
  }

  clearAccount(accountId: string): void {
    for (const [ref, d] of [...this.#items]) if (d.accountId === accountId) this.#items.delete(ref);
  }
}

/**
 * The skill call the draft screen's Send button puts through the cage (it asks like any send). A reply draft
 * whose recipient, copy and subject the user left as they were stays a reply in its thread; anything else
 * is sent as a new email with exactly the fields on screen.
 */
export function draftSendCall(d: MailDraft, replySubject?: string): { skill: "mail_reply" | "mail_send"; args: Record<string, unknown> } {
  const untouchedReply = d.replyTo && d.to.length === 1 && d.to[0] === d.replyTo.to && !d.cc.length && (replySubject === undefined || replySubject === d.subject);
  if (untouchedReply) return { skill: "mail_reply", args: { messageId: d.replyTo!.ref, body: d.body } };
  return {
    skill: "mail_send",
    args: { to: d.to.join(", "), ...(d.cc.length ? { cc: d.cc.join(", ") } : {}), subject: d.subject, body: d.body, account: d.from },
  };
}
