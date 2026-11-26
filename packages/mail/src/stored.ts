import type { SqlPort } from "@hermit/core";
import { emailOf } from "@hermit/skills";
import type { MailAccount, MailAccountStore } from "./accounts.ts";
import { MemoryMailAddressBook, type MailAddressOrigin } from "./book.ts";

/*
 * Mail's own rows in the phone's encrypted database (the app passes the settings table as a key-value store, like the
 * MCP servers and connectors keep theirs, so "Delete everything" clears them with the rest). Neither holds a secret:
 * tokens live only in the Keystore-backed credential store under each account's `credentialId` (FR-CONN-03).
 * - `mail.accounts`: the connected accounts and which of them need signing in again (EC-MAIL-04);
 * - `mail.book`: the address book (FR-MAIL-04), addresses and their origin only.
 * What is read back is checked field by field; a row that fails is dropped (fail closed).
 */

export type MailKvKey = "mail.accounts" | "mail.book";

export interface MailKv {
  get(key: MailKvKey): Promise<string | undefined>;
  set(key: MailKvKey, value: string): Promise<void>;
  remove(key: MailKvKey): Promise<void>;
}

/**
 * The key-value store over the encrypted database's settings table (the schema's `settings (key, value)`), the same rows
 * the runtime's settings use: "Delete everything" clears them with the tables. Use it once the schema is migrated.
 */
export function settingsMailKv(sql: SqlPort): MailKv {
  return {
    async get(key) {
      const [row] = await sql.query<{ value: string }>("SELECT value FROM settings WHERE key = ?", [key]);
      return row?.value;
    },
    async set(key, value) {
      await sql.exec("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", [key, value]);
    },
    async remove(key) {
      await sql.exec("DELETE FROM settings WHERE key = ?", [key]);
    },
  };
}

const SAFE_ID = /^[A-Za-z0-9_-]{1,64}$/;
const HOST = /^[a-z0-9.-]{1,253}$/;
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const copy = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

/** One stored account, or undefined when any field is missing or wrong. */
export function readStoredAccount(v: unknown): MailAccount | undefined {
  if (!isObj(v)) return undefined;
  const { id, provider, address, credentialId, createdAt, label, imap, smtp } = v;
  if (typeof id !== "string" || !SAFE_ID.test(id) || typeof credentialId !== "string" || !SAFE_ID.test(credentialId)) return undefined;
  if (provider !== "gmail" && provider !== "outlook" && provider !== "imap") return undefined;
  const bare = typeof address === "string" ? emailOf(address) : undefined;
  if (!bare || typeof createdAt !== "number" || !Number.isFinite(createdAt)) return undefined;
  const out: MailAccount = { id, provider, address: bare, credentialId, createdAt };
  if (typeof label === "string" && label.trim()) out.label = label.trim().slice(0, 40);
  if (provider === "imap") {
    if (!isObj(imap) || !isObj(smtp) || typeof imap.host !== "string" || !HOST.test(imap.host) || imap.port !== 993) return undefined;
    if (typeof smtp.host !== "string" || !HOST.test(smtp.host) || (smtp.port !== 465 && smtp.port !== 587)) return undefined;
    out.imap = { host: imap.host, port: 993 };
    out.smtp = { host: smtp.host, port: smtp.port, security: smtp.port === 465 ? "tls" : "starttls" };
  }
  return out;
}

/** Writes go one at a time, each the whole current snapshot, so a failed one is repaired by the next. */
class Writes {
  #chain: Promise<void> = Promise.resolve();
  /** Queues a write; the returned promise rejects if this write fails, the queue carries on. */
  run(write: () => Promise<void>): Promise<void> {
    const next = this.#chain.then(write);
    this.#chain = next.catch(() => {});
    return next;
  }
  /** Waits for every write queued so far (failures included). */
  idle(): Promise<void> {
    return this.#chain;
  }
}

/** The connected accounts (HM-MAIL-01), loaded once from the database and written back on every change. */
export class StoredMailAccounts implements MailAccountStore {
  readonly #kv: MailKv;
  readonly #items = new Map<string, MailAccount>();
  readonly #signInAgain = new Set<string>();
  readonly #writes = new Writes();
  #loaded: Promise<void> | undefined;

  constructor(kv: MailKv) {
    this.#kv = kv;
  }

  /** Reads the stored rows once; a failed read (the table isn't there yet) is tried again on the next call. */
  load(): Promise<void> {
    this.#loaded ??= (async () => {
      const raw = await this.#kv.get("mail.accounts");
      let parsed: unknown;
      try {
        parsed = raw ? (JSON.parse(raw) as unknown) : {};
      } catch {
        parsed = {};
      }
      const rows = isObj(parsed) && Array.isArray(parsed.accounts) ? parsed.accounts : [];
      for (const row of rows) {
        const a = readStoredAccount(row);
        if (a && !this.#items.has(a.id)) this.#items.set(a.id, a);
      }
      const again = isObj(parsed) && Array.isArray(parsed.signInAgain) ? parsed.signInAgain : [];
      for (const id of again) if (typeof id === "string" && this.#items.has(id)) this.#signInAgain.add(id);
    })().catch((err: unknown) => {
      this.#loaded = undefined;
      throw err;
    });
    return this.#loaded;
  }

  #persist(): Promise<void> {
    const snapshot = JSON.stringify({ accounts: [...this.#items.values()], signInAgain: [...this.#signInAgain] });
    return this.#writes.run(() => this.#kv.set("mail.accounts", snapshot));
  }

  async list(): Promise<MailAccount[]> {
    await this.load();
    return [...this.#items.values()].map(copy);
  }

  async get(id: string): Promise<MailAccount | undefined> {
    await this.load();
    const a = this.#items.get(id);
    return a && copy(a);
  }

  async save(account: MailAccount): Promise<void> {
    await this.load();
    const checked = readStoredAccount(account);
    if (!checked) throw new Error("that mail account can't be stored");
    this.#items.set(checked.id, checked);
    await this.#persist();
  }

  async delete(id: string): Promise<boolean> {
    await this.load();
    const had = this.#items.delete(id);
    this.#signInAgain.delete(id);
    if (had) await this.#persist();
    return had;
  }

  /** EC-MAIL-04: the provider refused this account's token; HM-MAIL-01 shows "Sign in again" until a call works. */
  needsSignIn(id: string): boolean {
    return this.#signInAgain.has(id);
  }

  async markSignIn(id: string, needed: boolean): Promise<void> {
    await this.load();
    if (!this.#items.has(id) || this.#signInAgain.has(id) === needed) return;
    if (needed) this.#signInAgain.add(id);
    else this.#signInAgain.delete(id);
    await this.#persist();
  }
}

/**
 * The address book (FR-MAIL-04, PDR-028) kept in the database. `add` and `clear` stay synchronous like the in-memory
 * book; each change queues a write of the whole book, and `flush` waits for it (the service flushes after every skill
 * call, so a send's recipients are stored before the turn goes on).
 */
export class StoredMailAddressBook extends MemoryMailAddressBook {
  readonly #kv: MailKv;
  readonly #writes = new Writes();
  #loaded: Promise<void> | undefined;

  constructor(kv: MailKv) {
    super();
    this.#kv = kv;
  }

  load(): Promise<void> {
    this.#loaded ??= (async () => {
      const raw = await this.#kv.get("mail.book");
      let rows: unknown;
      try {
        rows = raw ? (JSON.parse(raw) as unknown) : [];
      } catch {
        rows = [];
      }
      // Stored oldest first, so adding them in order keeps sent() running from the oldest send to the latest.
      for (const row of Array.isArray(rows) ? rows : []) {
        if (!isObj(row) || typeof row.address !== "string" || (row.origin !== "sent" && row.origin !== "typed")) continue;
        super.add([row.address], row.origin as MailAddressOrigin);
      }
    })().catch((err: unknown) => {
      this.#loaded = undefined;
      throw err;
    });
    return this.#loaded;
  }

  #persist(): void {
    const snapshot = JSON.stringify(this.entries());
    void this.#writes.run(() => this.#kv.set("mail.book", snapshot)).catch(() => {});
  }

  override add(values: readonly string[], origin: MailAddressOrigin): void {
    super.add(values, origin);
    this.#persist();
  }

  override clear(): void {
    super.clear();
    this.#persist();
  }

  /** Waits for every change so far to reach the database. */
  flush(): Promise<void> {
    return this.#writes.idle();
  }
}
