import { emailOf } from "@hermit/skills";

/**
 * Where a known address came from (SL-49 review). Only the user's own actions count:
 * - sent: the user approved a send, reply or forward to it, and the provider accepted it.
 * - typed: the user entered it themselves in the app (the draft screen, an address field), never chat text a
 *   model read back, and never a header of a message someone else sent.
 */
export type MailAddressOrigin = "sent" | "typed";

/**
 * Addresses the user has written to (FR-MAIL-04). The send sheet flags any recipient not in it as new.
 * Addresses seen only in incoming mail (a sender, a To or a Cc) are never added: an attacker who writes once,
 * or Cc's an address, must not become "known" and silence the warning. The app keeps it in the encrypted
 * database (loaded before a turn); it holds addresses and their origin only, never names or text.
 */
export interface MailAddressBook {
  has(address: string): boolean;
  origin(address: string): MailAddressOrigin | undefined;
  /** Takes raw values ("Ana <a@x.com>"); anything that isn't an address is ignored. */
  add(values: readonly string[], origin: MailAddressOrigin): void;
  /** Forget everything (all accounts disconnected). */
  clear(): void;
  /**
   * The addresses the user sent mail to (origin "sent"), the latest send last: the only ones a name the user says may
   * resolve to (Q48, PDR-028), and the suggestions Hermit shows when it asks for an address. Never "typed" ones.
   */
  sent(): string[];
}

export class MemoryMailAddressBook implements MailAddressBook {
  readonly #known = new Map<string, MailAddressOrigin>();

  has(address: string): boolean {
    return this.#known.has(address.trim().toLowerCase());
  }

  origin(address: string): MailAddressOrigin | undefined {
    return this.#known.get(address.trim().toLowerCase());
  }

  add(values: readonly string[], origin: MailAddressOrigin): void {
    for (const v of values) {
      const a = emailOf(v);
      if (!a) continue;
      // A send is the stronger evidence: typed then sent is "sent"; sent stays sent. Each send moves the address
      // last, so sent() runs from the oldest send to the latest.
      if (origin === "sent") {
        this.#known.delete(a);
        this.#known.set(a, "sent");
      } else if (this.#known.get(a) !== "sent") this.#known.set(a, origin);
    }
  }

  sent(): string[] {
    return [...this.#known].filter(([, o]) => o === "sent").map(([a]) => a);
  }

  clear(): void {
    this.#known.clear();
  }

  entries(): Array<{ address: string; origin: MailAddressOrigin }> {
    return [...this.#known].map(([address, origin]) => ({ address, origin }));
  }

  addresses(): string[] {
    return [...this.#known.keys()];
  }
}
