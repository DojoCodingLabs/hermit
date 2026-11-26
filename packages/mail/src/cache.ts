import type { MailHeader } from "./provider.ts";

export interface ShownItem extends MailHeader {
  /** The short id the model saw ("m3"). */
  ref: string;
}

/**
 * Messages fetched for the current summary (FR-MAIL-05, ENT-MailCache). It hands the model short ids
 * ("m3") in place of provider ids (a Graph id is about 150 characters), resolves them back for mail_read,
 * and keeps what the last list or search showed for HM-MAIL-02 and HM-MAIL-03. In memory only: it holds
 * headers and previews, never bodies, and is cleared per account on disconnect.
 */
export class MailCache {
  readonly #byRef = new Map<string, MailHeader>();
  readonly #refOf = new Map<string, string>();
  #next = 1;
  #shown: { skill: "mail_list" | "mail_search"; items: ShownItem[] } | undefined;

  constructor(private readonly limit = 200) {}

  /** The short id for a message, the same one if it was handed out before. */
  put(h: MailHeader): string {
    const key = `${h.accountId}\u0000${h.id}`;
    const known = this.#refOf.get(key);
    if (known) {
      this.#byRef.set(known, { ...h });
      return known;
    }
    const ref = `m${this.#next++}`;
    this.#byRef.set(ref, { ...h });
    this.#refOf.set(key, ref);
    while (this.#byRef.size > this.limit) {
      const [oldest, header] = this.#byRef.entries().next().value as [string, MailHeader];
      this.#byRef.delete(oldest);
      this.#refOf.delete(`${header.accountId}\u0000${header.id}`);
    }
    return ref;
  }

  get(ref: string): MailHeader | undefined {
    const h = this.#byRef.get(ref);
    return h && { ...h };
  }

  remember(skill: "mail_list" | "mail_search", items: ShownItem[]): void {
    this.#shown = { skill, items: items.map((i) => ({ ...i })) };
  }

  /** What the last mail_list or mail_search showed, for the summary and results screens. */
  shown(): { skill: "mail_list" | "mail_search"; items: ShownItem[] } | undefined {
    return this.#shown && { skill: this.#shown.skill, items: this.#shown.items.map((i) => ({ ...i })) };
  }

  clearAccount(accountId: string): void {
    for (const [ref, h] of [...this.#byRef]) {
      if (h.accountId !== accountId) continue;
      this.#byRef.delete(ref);
      this.#refOf.delete(`${h.accountId}\u0000${h.id}`);
    }
    if (this.#shown) this.#shown = { ...this.#shown, items: this.#shown.items.filter((i) => i.accountId !== accountId) };
  }

  clear(): void {
    this.#byRef.clear();
    this.#refOf.clear();
    this.#shown = undefined;
  }
}
