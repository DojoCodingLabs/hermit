export type MailProviderKind = "gmail" | "outlook" | "imap";

/** IMAP over implicit TLS (FR-MAIL-01). */
export interface ImapServer {
  host: string;
  port: number;
}

/** SMTP for sending (SL-49): implicit TLS on 465, or STARTTLS required on 587. */
export interface SmtpServer {
  host: string;
  port: number;
  security: "tls" | "starttls";
}

/**
 * A connected mail account (HM-MAIL-01). Never holds a secret: tokens and app passwords live in the
 * credential store under `credentialId` (FR-CONN-03).
 */
export interface MailAccount {
  id: string;
  provider: MailProviderKind;
  address: string;
  /** A name the user gave it ("work", "personal"), so they can say which account (US-MAIL-08). */
  label?: string;
  credentialId: string;
  createdAt: number;
  imap?: ImapServer;
  smtp?: SmtpServer;
}

/** Where the app keeps the account list (the encrypted database on the phone). */
export interface MailAccountStore {
  list(): Promise<MailAccount[]>;
  get(id: string): Promise<MailAccount | undefined>;
  /** Insert or replace by id. */
  save(account: MailAccount): Promise<void>;
  delete(id: string): Promise<boolean>;
}

const copy = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

export class MemoryMailAccountStore implements MailAccountStore {
  readonly #items = new Map<string, MailAccount>();

  async list(): Promise<MailAccount[]> {
    return [...this.#items.values()].map(copy);
  }

  async get(id: string): Promise<MailAccount | undefined> {
    const a = this.#items.get(id);
    return a && copy(a);
  }

  async save(account: MailAccount): Promise<void> {
    this.#items.set(account.id, copy(account));
  }

  async delete(id: string): Promise<boolean> {
    return this.#items.delete(id);
  }
}

/** The credential store's connector id per mail provider (the Connections screen lists them, US-CONN-02). */
export const MAIL_CONNECTOR_IDS: Readonly<Record<MailProviderKind, string>> = { gmail: "gmail", outlook: "outlook_mail", imap: "imap_mail" };

export const MAIL_SERVICE_NAMES: Readonly<Record<MailProviderKind, string>> = { gmail: "Gmail", outlook: "Outlook", imap: "Email (IMAP)" };

const fold = (t: string) => t.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim();

/** How an account reads in a list for the model and the user: the address, and its label if it has one. */
export const accountName = (a: MailAccount) => (a.label ? `${a.address} (${a.label})` : a.address);

/**
 * The accounts a request means (US-MAIL-08): every account when none is named; otherwise the one whose
 * address, label or provider matches what the model passed from the user's words.
 */
export function resolveAccounts(accounts: readonly MailAccount[], wanted: unknown): { ok: true; accounts: MailAccount[] } | { ok: false; modelText: string } {
  if (!accounts.length) return { ok: false, modelText: "No email account is connected. Tell the user to connect one in Email accounts." };
  const w = typeof wanted === "string" ? fold(wanted) : "";
  if (!w) return { ok: true, accounts: [...accounts] };
  const tiers: Array<(a: MailAccount) => boolean> = [
    (a) => fold(a.address) === w,
    (a) => a.label !== undefined && fold(a.label) === w,
    (a) => a.provider === w || fold(MAIL_SERVICE_NAMES[a.provider]) === w,
    (a) => fold(a.address).includes(w) || (a.label !== undefined && fold(a.label).includes(w)),
  ];
  for (const match of tiers) {
    const hit = accounts.filter(match);
    if (hit.length) return { ok: true, accounts: hit };
  }
  return { ok: false, modelText: `No connected email account matches "${String(wanted).slice(0, 100)}". Connected: ${accounts.map(accountName).join(", ")}.` };
}
