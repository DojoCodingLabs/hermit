import type { ConnectorTransport, SignInOption } from "@hermit/connectors";
import type { CredentialStorePort, MailRenderContext, OneTimeCodePort, StopSignal, TaintSource } from "@hermit/core";
import { emailOf } from "@hermit/skills";
import type { MailAccount } from "./accounts.ts";
import { MailCache } from "./cache.ts";
import { createMailCodeSource } from "./code-source.ts";
import { connectImap, disconnectMail, finishMailOAuth, startMailOAuth, type ImapConnectInput, type MailConnectResult, type OAuthMailKind, type PendingMailOAuth } from "./connect.ts";
import { draftSendCall, MailDrafts, type MailDraft } from "./drafts.ts";
import { MAIL_HOSTS } from "./hosts.ts";
import type { ImapPort, SmtpPort } from "./imap.ts";
import type { MailHeader, MailProblem, MailProvider, MailResult } from "./provider.ts";
import { mailProviderFor } from "./providers.ts";
import { MAIL_REDIRECT_URIS, readMailRedirect } from "./redirect.ts";
import { createMailSkills, type MailSkill } from "./skills.ts";
import { StoredMailAccounts, StoredMailAddressBook, type MailKv } from "./stored.ts";
import { clip } from "./text.ts";
import { mailAccountsView, mailDisconnectedKey, mailDraftView, mailShownView, type MailAccountsView, type MailDraftView, type MailShownView } from "./views.ts";
import { mailRenderContext } from "./write-skills.ts";

/*
 * The phone's mail (SL-48, SL-49), composed once: the accounts and the address book in the encrypted database, the
 * provider clients over the app's transport (every request counted, provider hosts only) and its Keystore credential
 * store, the cache and the drafts in memory. It hands Hermit what its ports take (`skills` for HermitPorts.mail,
 * `render` for mailRender, `night` for mailNight, `pastRecipients` for people, `codeSource` for the web tasks' codes)
 * and the screens what they show. IMAP accounts join when the app gives it ImapPort and SmtpPort (Q46, Q158).
 */

export interface MailServiceDeps {
  credentials: CredentialStorePort;
  /** HTTPS, implemented by the app over the FR-PRIV-02 fetch wrapper, refusing every host but the providers'. */
  transport: ConnectorTransport;
  /** The encrypted database's settings table (`mail.accounts`, `mail.book`). */
  kv: MailKv;
  now(): number;
  newId(): string;
  timeZone(): string;
  /** The platform's secure random source (PKCE verifier and state). */
  random(bytes: number): Uint8Array;
  sleep(ms: number, signal: StopSignal): Promise<void>;
  /** IMAP and SMTP over the app's TLS sockets (Q46, Q158); absent in a build without them, so IMAP can't be connected. */
  imap?: ImapPort;
  smtp?: SmtpPort;
}

/** HM-MAIL-01's row: the account (never a secret) and whether its provider refused the token (EC-MAIL-04). */
export interface MailAccountRow {
  id: string;
  address: string;
  label?: string;
  provider: MailAccount["provider"];
  serviceKey: MailAccountsView["rows"][number]["serviceKey"];
  signInAgain: boolean;
}

export interface MailAccountsScreen extends Omit<MailAccountsView, "rows"> {
  rows: MailAccountRow[];
}

/** HM-MAIL-03's message view: one email read fresh, all of it other people's words. */
export interface MailOpened {
  ref: string;
  /** The account it arrived on. */
  account: string;
  from: string;
  to: string[];
  cc: string[];
  subject: string;
  at: number;
  text: string;
  /** The text was longer than the screen keeps: only its start is shown. */
  cut: boolean;
}

/** HM-MAIL-04: the draft, whether the user changed it on the phone, and whether the session that wrote it had read others' words. */
export interface MailDraftScreen {
  ref?: string;
  view: MailDraftView;
  edited: boolean;
  tainted: boolean;
}

/** The call HM-MAIL-04's Send puts through the cage, with the taint of the session that wrote the draft. */
export interface MailDraftCall {
  skill: "mail_reply" | "mail_send";
  args: Record<string, unknown>;
  taint?: TaintSource["kind"];
}

export interface MailService {
  /** Loads the accounts and the address book; every other call waits for it, so calling it is optional. */
  load(): Promise<void>;
  /** HermitPorts.mail: the mail skills (reads from SL-48, writes from SL-49), through the cage like any skill. */
  skills: MailSkill[];
  /** HermitPorts.mailRender: trusted mail data for the send, draft and organize sheets. */
  render(): Promise<MailRenderContext>;
  /** HermitPorts.mailNight: the address book for reply suggestions (Q68), and the email behind a short id across a restart. */
  night: { known(address: string): boolean; snapshot(ref: string): unknown; restore(snapshot: unknown): string | undefined };
  /** HermitPorts.people.pastRecipients (PDR-028): the people the user sent mail to, the latest last. */
  pastRecipients(): Promise<readonly string[]>;
  /** A web task's one-time code from the site's email (SL-56b), Gmail accounts only (Q141). */
  codeSource: OneTimeCodePort;

  /** HM-MAIL-01. */
  view(): Promise<MailAccountsScreen>;
  /** Starts a sign-in in the system browser; throws for an option that can't sign in. Replaces any sign-in under way. */
  startSignIn(kind: OAuthMailKind, option: SignInOption): { url: string };
  pendingSignIn(): OAuthMailKind | undefined;
  cancelSignIn(): void;
  /**
   * The redirect came back with `url`. Nothing is sent unless it is exactly the pending sign-in's redirect with its
   * state; a forged one leaves the real sign-in waiting. Any callback with the right state ends the sign-in.
   */
  finishSignIn(url: string): Promise<MailConnectResult>;
  /** HM-MAIL-01's "Other email (IMAP)": whether this build can connect one (Q158). */
  imapAvailable: boolean;
  /**
   * The IMAP form (FR-MAIL-01): the server checks the address and app password first; only then is the account stored,
   * the password in the Keystore-backed credential store only. The same address again replaces its password.
   */
  connectImap(input: ImapConnectInput): Promise<MailConnectResult>;
  /** Deletes the account, its tokens, its cached mail and drafts, revokes where the provider can; the result's copy key. */
  disconnect(accountId: string): Promise<{ key: string } | undefined>;
  /** HM-MAIL-02 (the last mail_list) and HM-MAIL-03 (the last mail_search), from the cache, never from the model. */
  shown(screen: "HM-MAIL-02" | "HM-MAIL-03", locale: string): MailShownView;
  /** HM-MAIL-03's message view, read fresh from the provider. */
  open(ref: string): Promise<{ ok: true; message: MailOpened } | { ok: false; problem: MailProblem | "gone" }>;
  /** HM-MAIL-04: a draft by its ref, or the latest; undefined for a ref that is gone. */
  draft(ref?: string): MailDraftScreen | undefined;
  /** The user's edits, checked: To and Cc must be addresses only. Addresses the user typed join the book as "typed". */
  editDraft(ref: string, edit: { to: string; cc: string; subject: string; body: string }): { ok: true } | { ok: false; field: "to" | "cc" | "draft"; problem: "bad_address" | "gone" };
  /** What Send puts through the cage. */
  draftCall(ref: string): MailDraftCall | undefined;
  /** After a send went out: the phone's copy goes (the provider's Drafts copy stays until the user deletes it there). */
  sentDraft(ref: string): void;
  /** Discard: only the phone's copy goes. */
  discardDraft(ref: string): boolean;
  /** HM-SET-02: the hosts the connected accounts' providers use (FR-PRIV-02), listed even before first use. */
  hosts(): Promise<string[]>;
}

/** HM-MAIL-03's message view caps the text it keeps for the screen. */
const OPEN_CHARS = 20_000;
const SUBJECT_CHARS = 200;
const BODY_CHARS = 4000;

const isHeader = (v: unknown): v is MailHeader => {
  if (typeof v !== "object" || v === null) return false;
  const h = v as Record<string, unknown>;
  return typeof h.id === "string" && h.id.length > 0 && h.id.length <= 512 && typeof h.accountId === "string" && h.accountId.length > 0
    && typeof h.from === "string" && typeof h.subject === "string" && typeof h.preview === "string" && typeof h.unread === "boolean"
    && typeof h.at === "number" && Number.isFinite(h.at);
};

/** A recipients field as typed on HM-MAIL-04: every comma- or semicolon-separated piece must be one address. */
function typedAddresses(value: string): string[] | undefined {
  const out: string[] = [];
  for (const piece of value.split(/[,;]/)) {
    if (!piece.trim()) continue;
    const a = emailOf(piece);
    if (!a) return undefined;
    if (!out.includes(a)) out.push(a);
  }
  return out;
}

export function createMailService(deps: MailServiceDeps): MailService {
  const accounts = new StoredMailAccounts(deps.kv);
  const book = new StoredMailAddressBook(deps.kv);
  const cache = new MailCache();
  // The subject a draft was saved with: an untouched reply draft stays a reply in its thread (draftSendCall).
  const savedSubjects = new Map<string, string>();
  const drafts = new (class extends MailDrafts {
    override add(draft: Omit<MailDraft, "ref">): MailDraft {
      const d = super.add(draft);
      savedSubjects.set(d.ref, d.subject);
      return d;
    }
  })();
  const edited = new Set<string>();
  let loading: Promise<void> | undefined;
  const ready = (): Promise<void> => {
    loading ??= Promise.all([accounts.load(), book.load()]).then(() => {}).catch((err: unknown) => {
      loading = undefined;
      throw err;
    });
    return loading;
  };

  const net = { credentials: deps.credentials, transport: deps.transport, now: deps.now, ...(deps.imap ? { imap: deps.imap } : {}), ...(deps.smtp ? { smtp: deps.smtp } : {}) };
  /** The account's mailbox; a token the provider refuses marks the account until a call with it works again. */
  const providerFor = (a: MailAccount): MailProvider => {
    const p = mailProviderFor(net, a);
    const note = async <T>(run: Promise<MailResult<T>>): Promise<MailResult<T>> => {
      const r = await run;
      if (!r.ok && r.problem === "sign_in_again") await accounts.markSignIn(a.id, true);
      else if (r.ok) await accounts.markSignIn(a.id, false);
      return r;
    };
    return {
      list: (q) => note(p.list(q)),
      search: (q, max) => note(p.search(q, max)),
      read: (id) => note(p.read(id)),
      send: (m) => note(p.send(m)),
      saveDraft: (m) => note(p.saveDraft(m)),
      modify: (ids, change) => note(p.modify(ids, change)),
      ...(p.authResults ? { authResults: (id: string) => note(p.authResults!(id)) } : {}),
    };
  };

  const skillDeps = { accounts, providerFor, cache, timeZone: deps.timeZone, book, drafts, now: deps.now };
  // Every call waits for the stored rows, and a send's recipients reach the database before the turn goes on.
  const skills: MailSkill[] = createMailSkills(skillDeps).map((s) => ({
    def: s.def,
    async execute(args, ctx) {
      await ready();
      try {
        return await s.execute(args, ctx);
      } finally {
        await book.flush();
      }
    },
  }));

  const codeSource = createMailCodeSource({
    // Q141: only Gmail's own verdict on a sender is trusted, so only Gmail inboxes are read for a code.
    accounts: async () => {
      await ready();
      return (await accounts.list()).filter((a) => a.provider === "gmail");
    },
    provider: providerFor,
    now: deps.now,
    sleep: deps.sleep,
  });

  let pending: PendingMailOAuth | undefined;
  const connectDeps = { credentials: deps.credentials, accounts, transport: deps.transport, now: deps.now, newId: deps.newId };

  return {
    load: ready,
    skills,
    async render() {
      await ready();
      return mailRenderContext(skillDeps);
    },
    night: {
      known: (address) => book.has(address),
      snapshot: (ref) => cache.get(ref),
      restore: (snapshot) => (isHeader(snapshot) ? cache.put({ ...snapshot }) : undefined),
    },
    async pastRecipients() {
      await ready();
      return book.sent();
    },
    codeSource,

    async view() {
      await ready();
      const list = await accounts.list();
      const v = mailAccountsView(list);
      return {
        ...v,
        rows: v.rows.map((r) => ({ ...r, provider: list.find((a) => a.id === r.id)!.provider, signInAgain: accounts.needsSignIn(r.id) })),
      };
    },
    startSignIn(kind, option) {
      const { url, pending: next } = startMailOAuth(kind, option, { redirectUri: MAIL_REDIRECT_URIS[kind], random: deps.random(48), now: deps.now() });
      pending = next;
      return { url };
    },
    pendingSignIn: () => pending?.kind,
    imapAvailable: Boolean(deps.imap && deps.smtp),
    async connectImap(input) {
      await ready();
      const r = await connectImap({ ...connectDeps, ...(deps.imap ? { imap: deps.imap } : {}) }, input);
      if (r.ok) await accounts.markSignIn(r.account.id, false);
      return r;
    },
    cancelSignIn() {
      pending = undefined;
    },
    async finishSignIn(url) {
      const p = pending;
      const callback = p ? readMailRedirect(p.kind, url) : undefined;
      // Not this sign-in's redirect, or not its state: nothing is sent and the real sign-in keeps waiting.
      if (!p || !callback || callback.state !== p.state) return { ok: false, problem: "state_mismatch" };
      pending = undefined;
      await ready();
      const r = await finishMailOAuth(connectDeps, p, callback);
      if (r.ok) await accounts.markSignIn(r.account.id, false);
      return r;
    },
    async disconnect(accountId) {
      await ready();
      const account = await accounts.get(accountId);
      if (!account) return undefined;
      const r = await disconnectMail({ ...connectDeps, cache, drafts }, accountId);
      for (const ref of [...savedSubjects.keys()]) {
        if (drafts.get(ref)) continue;
        savedSubjects.delete(ref);
        edited.delete(ref);
      }
      // The last account gone: the address book goes with it.
      if (!(await accounts.list()).length) {
        book.clear();
        await book.flush();
      }
      return { key: mailDisconnectedKey(r.revoked, account.provider) };
    },
    shown: (screen, locale) => mailShownView(cache.shown(), screen, locale, deps.timeZone()),
    async open(ref) {
      await ready();
      const h = cache.get(ref);
      const account = h ? await accounts.get(h.accountId) : undefined;
      if (!h || !account) return { ok: false, problem: "gone" };
      let r: Awaited<ReturnType<MailProvider["read"]>>;
      try {
        r = await providerFor(account).read(h.id);
      } catch {
        r = { ok: false, problem: "unreachable" };
      }
      if (!r.ok) return { ok: false, problem: r.problem };
      const m = r.value;
      return { ok: true, message: { ref, account: account.address, from: m.from, to: m.to, cc: m.cc, subject: m.subject, at: m.at, text: clip(m.text, OPEN_CHARS), cut: m.text.length > OPEN_CHARS } };
    },
    draft(ref) {
      const d = ref ? drafts.get(ref) : drafts.latest();
      if (ref && !d) return undefined;
      return { ...(d ? { ref: d.ref } : {}), view: mailDraftView(d), edited: d ? edited.has(d.ref) : false, tainted: Boolean(d?.taint) };
    },
    editDraft(ref, edit) {
      const d = drafts.get(ref);
      if (!d) return { ok: false, field: "draft", problem: "gone" };
      const to = typedAddresses(edit.to);
      if (!to) return { ok: false, field: "to", problem: "bad_address" };
      const cc = typedAddresses(edit.cc);
      if (!cc) return { ok: false, field: "cc", problem: "bad_address" };
      // Only the addresses the user added here count as typed by them; the rest were already on the draft.
      const added = [...to, ...cc].filter((a) => !d.to.includes(a) && !d.cc.includes(a));
      if (added.length) book.add(added, "typed");
      drafts.update(ref, { to, cc, subject: edit.subject.slice(0, SUBJECT_CHARS), body: edit.body.slice(0, BODY_CHARS) });
      edited.add(ref);
      return { ok: true };
    },
    draftCall(ref) {
      const d = drafts.get(ref);
      if (!d) return undefined;
      const call = draftSendCall(d, savedSubjects.get(ref));
      return { ...call, ...(d.taint ? { taint: d.taint } : {}) };
    },
    sentDraft(ref) {
      drafts.delete(ref);
      edited.delete(ref);
      savedSubjects.delete(ref);
    },
    discardDraft(ref) {
      edited.delete(ref);
      savedSubjects.delete(ref);
      return drafts.delete(ref);
    },
    async hosts() {
      await ready();
      const list = await accounts.list();
      const providers = new Set(list.map((a) => a.provider));
      const servers = list.flatMap((a) => (a.provider === "imap" ? [a.imap?.host, a.smtp?.host] : [])).filter((h): h is string => Boolean(h));
      return [...new Set([...(providers.has("gmail") ? MAIL_HOSTS.gmail : []), ...(providers.has("outlook") ? MAIL_HOSTS.outlook : []), ...servers])];
    },
  };
}
