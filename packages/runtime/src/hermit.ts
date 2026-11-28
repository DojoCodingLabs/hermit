import { cacheKeyFor, type BotPorts, type BotProposalView, type HermitBotsApi, type RunPriority } from "./bot-api.ts";
import {
  argsHash, calendarChoice, createBotsStore, createEventLog, createHostCounter, createMemory, createMessageStore, createReminders, createSessions, createVaultStore, describeNowForModel, loginIndex, migrate,
  ReminderError, searchProvider, skillId, type SkillId,
  type ApprovalKeyPort, type OneTimeCodePort, type ApprovalOutcome, type ApprovalPort, type CalendarChoice, type CalendarPort, type ContactsPort, type HostCount, type MailRenderContext, type Memory, type MessageStore,
  type IntentLauncherPort, type NotifierPort, type Outcome, type Reminder, type ReplySenderPort, type SearchProvider, type SignerPort, type SqlPort, type StopSignal,
  type FormKind, type LoginIndexEntry, type TranscriptEntry, type WebFetchPort, type ApprovalRequest, type SessionState, type TaintSource,
} from "@hermit/core";
import { activityDetail, activityRows, chainView, createAuditLog, decide, defaultRules, holds, withPay, type ActivityDetail, type ActivityRow, type ChainView } from "@hermit/cage";
import { addReads, calendarSkills, extractReadable, intentSkillRuntimes, memorySkills, messageSkills, readWebSkills, reminderSkills, runTurn, searchWebSkills, STOPPED_NOTE, type AnswerWords, type Choice, type PaymentReceipt, type PeopleDeps, type SkillRuntime, type StepEvent, type WebLanguage, type WebPageRecord } from "@hermit/agent";
import { connectSkill, createBotDef, firstWinSkills, intentSkills, payDef, payMerchantDef, serviceFromUser, webSkills } from "@hermit/skills";
import { createModelPort, endAtBoundary, quarantinedRead, userLanguage, type CompletionEngine, type ModelProfile } from "@hermit/model";
import {
  actOnSuggestion, createBriefings, createNightLock, NightAborted, parseNightSettings, runNightShift, scheduleBriefingNotice, validateNightSettings,
  type ActOutcome, type Briefing, type DeviceState, type NightSettings, type NightSettingsProblem,
} from "@hermit/night";
import { createVault, type Vault, type VaultDeps } from "./vault.ts";
import { createWallet, type Wallet, type WalletDeps } from "./wallet.ts";
import { createPayments, readPayees, type Payments, type PayWorkletPort } from "./pay.ts";
import {
  ConnectorInstalls, MAX_MCP_TOOLS_PER_TURN, McpServers, routeMcpTools,
  type ConnectorSkill, type ConnectorTransport, type InstalledRecord, type McpServerRecord, type McpSkill, type McpTransport,
} from "@hermit/connectors";
import { createRelaySettings, type RelaySettings } from "./relay.ts";
import { HERMIT_BOT_ID, type BotMemory, type CredentialStorePort, type SkillDef } from "@hermit/core";
import { createApprovalKey, type ApprovalKeyService } from "./approval-key.ts";
import { createProfile, type Profile } from "./profile.ts";
import { createFormFill, type FormFill } from "./form-fill.ts";
import { createWebTasks, type WebOffer, type WebTasks } from "./web-tasks.ts";
import { repairWebStep } from "./web-repair.ts";
import { capabilityAnswer, type CapabilityAccess } from "./capabilities.ts";
import { createRunQueue, queuedEngine, type RunQueue } from "./run-queue.ts";
import { botMenu, cageFor, roleFor, type BotTurn } from "./bot-turns.ts";
import { createBotsApi, isModeSetting } from "./bots.ts";
import { createBotProposals, createBotRuntime } from "./bot-proposals.ts";

/**
 * The phone's composition root for the first win. The app supplies adapters for each port;
 * everything else (schema, cage, loop, stores, signed log, local events) is wired here, so the
 * app's job is screens and adapters only. Runs in Node with fakes, which is how it's tested.
 */
export interface HermitPorts {
  sql: SqlPort;
  signer: SignerPort;
  notifier: NotifierPort;
  calendar: CalendarPort;
  replySender: ReplySenderPort;
  engine: CompletionEngine;
  approvals: ApprovalPort;
  now(): number;
  timeZone(): string;
  language(): "es-419" | "en";
  newId(): string;
  /**
   * W1: copy for the answers code writes in the chat (`HM-CHAT-01.done.*`, `.reminders.*`, `.calendar.*`, `.messages.*`,
   * `.can.*`), in the given locale with its placeholders filled (CT-10). With it, the first-win skills confirm and list
   * in code's words and "what can you do?" is answered from the skills on this phone; without it the model words them.
   */
  copy?(language: "es-419" | "en", key: string, vars?: Record<string, string>): string;
  /**
   * W1 review: what Android lets Hermit use right now (notification access for WhatsApp, the calendar permission), read
   * without prompting, so "what can you do?" names only what works on this phone at this moment. Absent: unknown.
   */
  access?(): Promise<{ notifications?: boolean; calendar?: boolean }>;
  /**
   * Opening other apps prefilled (SL-58, FR-APP-01): the intent launcher and the copy for its answers. Without it, the
   * intent skills aren't on the menu. `copy` looks a key up in the given locale and fills its placeholders (CT-10).
   */
  intents?: { launcher: IntentLauncherPort; copy(language: "es-419" | "en", key: string, vars?: Record<string, string>): string };
  /**
   * Web reading and search (SL-22, SL-23): the HTTPS adapter and the copy for their answers. Without it, read_web and
   * search_web aren't on the menu; the search provider comes from the `search.provider` setting.
   * `copy` looks a key up in the given locale and fills its placeholders (CT-10).
   */
  web?: { fetch: WebFetchPort; copy(language: WebLanguage, key: string, vars?: Record<string, string>): string };
  verifyApproval?: Parameters<typeof runTurn>[2]["verifyApproval"];
  /**
   * Mail skills (SL-48), built by the app with `createMailSkills` from @hermit/mail over its transport,
   * credential store and IMAP adapters. Without them the menu has no mail skills.
   */
  mail?: SkillRuntime[];
  /**
   * Trusted mail data for the send, draft and organize sheets (SL-49): `mailRenderContext` from @hermit/mail
   * over the same deps the app gave createMailSkills. Without it those sheets can't be shown, so nothing is sent.
   */
  mailRender?(): Promise<MailRenderContext>;
  /**
   * The night shift's mail hooks (SL-24), over the same deps the app gave createMailSkills: `known` is the
   * address book (only people the user writes to get a reply draft suggestion); `snapshot` and `restore` keep
   * the header behind a short id ("m3") with a suggestion, so the morning sheet finds the email after a restart.
   */
  mailNight?: { known(address: string): boolean; snapshot(ref: string): unknown; restore(snapshot: unknown): string | undefined };
  /**
   * People by name (PDR-028, Q48, Q49): the phone's contacts (READ_CONTACTS), the addresses the user emailed before
   * (`MailAddressBook.sent()` from @hermit/mail) and the copy for the questions. Without it, names are never resolved.
   */
  /**
   * The vault (SL-33, FR-VAULT-01): the Keystore-wrapped key, AES-GCM, the platform's secure random source and
   * whether the app is on screen. Without it there is no vault. Never part of a turn: no skill reads it.
   */
  vault?: Pick<VaultDeps, "key" | "cipher" | "random" | "onScreen" | "onLocked">;
  /**
   * The wallet (SL-38, FR-PAY-01): the Keystore-wrapped wallet key, the record holding the sealed seed, the wallet
   * worklet, the secure random source and whether the app is on screen; and (SL-39) Stable testnet's RPC for the
   * history and the user's saved payees. Without it there is no wallet. Never part of a turn or a night run: no skill
   * reads it, not even the balance (the SL-39 packet allows no read skill).
   */
  wallet?: Pick<WalletDeps, "key" | "record" | "worklet" | "random" | "onScreen" | "chain" | "payees">;
  /**
   * MCP servers the user adds on HM-CONN-03 (SL-54, US-CONN-03): the HTTPS adapter (strict checks in the client, every
   * host counted), the Keystore-backed credential store (the only place tokens live), the platform's random source,
   * and the copy for answers code writes. Without it there are no MCP servers and no MCP tools on the menu.
   */
  mcp?: {
    transport: McpTransport;
    credentials: CredentialStorePort;
    random(bytes: number): Uint8Array;
    clientVersion: string;
    copy(language: "es-419" | "en", key: string): string;
  };
  /**
   * Sign-in relays on HM-CONN-05 (SL-57, US-CONN-09, US-CONN-10): the HTTPS adapter (every host counted, no redirect
   * followed) and Dojo's relay URL from the build config, unset until Q43. Without a transport the relay can still be
   * chosen, just not checked.
   */
  relay?: { transport?: ConnectorTransport; dojoRelayUrl?: string; dojoClientIds?: Partial<Record<string, string>> };
  /**
   * SL-37 (US-CAGE-03, FR-CAGE-06): the Keystore approval key and the platform's secure random source (nonces and
   * enrollment challenges). Without it, every spend and credential call is blocked; with it, only the chat's
   * attended turns can get one approved. The night shift and its suggestions never do.
   */
  approvalKey?: { port: ApprovalKeyPort; randomBytes(n: number): Uint8Array };
  /**
   * The Android autofill service (SL-35): it gets the kinds the profile can fill and which are sensitive, never a
   * value, so it offers a suggestion only where the profile has something. Used with the vault port.
   * SL-36: and the vault's logins by id hash, name and exact origins, never a username or a password, so it offers a
   * login only to the requester whose verified identity equals a stored origin.
   */
  autofill?: {
    setProfileIndex(index: { kinds: FormKind[]; sensitive: FormKind[] }): void | Promise<void>;
    setLoginIndex?(index: LoginIndexEntry[]): void | Promise<void>;
  };
  /**
   * SL-55 (US-CONN-04 to 06, HM-CONN-04): "connect me to X". The HTTPS adapter (every address checked in
   * @hermit/connectors, every host counted), the Keystore-backed credential store (the only place keys live), the
   * platform's random source, the fingerprint an install needs, and the copy for the chat's offer. Without it there is
   * no connect_service skill and no installed connector on the menu.
   */
  connect?: {
    transport: McpTransport;
    credentials: CredentialStorePort;
    random(bytes: number): Uint8Array;
    confirm(): Promise<boolean>;
    copy(language: "es-419" | "en", key: string, vars?: Record<string, string>): string;
  };
  /**
   * SL-40 (US-PAY-05, US-PAY-06): paying a person by asking, within caps. The wallet worklet's payment methods, the
   * fingerprint HM-PAY-05 asks before a cap or payee changes, and the copy for the chat's answers and the sheet's lines.
   * Used with the wallet and approval key ports; without all three, `pay` is not on the menu and stays denied.
   */
  pay?: { worklet: PayWorkletPort; confirm(prompt: string): Promise<boolean>; copy(language: "es-419" | "en", key: string, vars?: Record<string, string>): string };
  people?: {
    contacts?: ContactsPort;
    pastRecipients?(): Promise<readonly string[]>;
    copy(language: "es-419" | "en", key: string, vars?: Record<string, string>): string;
  };
  /**
   * SL-53 (US-WEB-06 to US-WEB-11, HM-WEB-02): web tasks in the in-app browser. `requester` is Hermit's own browser by
   * its verified identity (`android://<cert>@<package>`), who receives a login's values; `onScreen` is true only while
   * Hermit is in the foreground. Without it there are no recipes on the menu and no HM-WEB-02.
   */
  browser?: {
    requester: string;
    onScreen(): boolean;
    /**
     * SL-56b (Q138): where a sign-in's one-time code may come from: the SMS User Consent dialog (`createSmsCodeSource`
     * in the app) and the site's email (`createMailCodeSource` from @hermit/mail). Without them the user types codes.
     */
    codes?: OneTimeCodePort[];
    copy(language: "es-419" | "en", key: string, vars?: Record<string, string>): string;
  };
  /** Multi-bot: the fingerprint prompt for granting mail send, logins or pay, or Don't ask. */
  bots?: BotPorts;
  /**
   * Multi-bot (spec 6.6): the one line every model call of every bot waits in, by priority (the user's turn, a reply the
   * user waits for, handoffs, routines). Tests pass their own; without it Hermit makes one.
   */
  queue?: RunQueue;
}

/** What the chat renders for a finished turn (US-CHAT-01, US-CHAT-04, US-CHAT-05). */
export type TurnView = (
  /** `page`: the answer came from a web page; HM-WEB-01 shows the text it used (Hermit.page). */
  /** `connect` (SL-55): the user asked to connect a service; the chat offers HM-CONN-04 with their words prefilled. */
  /** `webTask` (SL-53): a saved recipe the user's words named; the chat links HM-WEB-02's plan by a one-time offer id. */
  /** `receipt` (A6): a confirmed payment as code's own facts, for the receipt card; `text` stays the reply bubble. */
  /**
   * `mail` (SL-48, SL-49): the turn listed, searched or drafted email; the chat links the screen that shows it from the
   * app's mail data (HM-MAIL-02 the messages a summary used, HM-MAIL-03 search results, HM-MAIL-04 the draft).
   * `cut` (Q155): the reply stopped short of its own end, at its token cap or, with `stopped`, because the user stopped
   * it while it was written. The chat says so under the bubble and offers Seguir (`Hermit.continueReply`).
   * `nothingMore` (Q155 review): Seguir found nothing new to add; the reply is whole as it is, the chat says so in code's
   * words, and Seguir is not offered again.
   * `botProposal` (multi-bot, Task 12): Hermit proposed a bot. The chat draws its card from these typed fields; Create
   * goes through `bots.create` with its offer id, and a tainted one offers only Review (HM-BOT-03).
   */
  | { kind: "reply"; text: string; page?: WebPageRef; offer?: "contacts"; connect?: { request: string; offerId: string }; webTask?: WebOffer; receipt?: PaymentReceipt; mail?: MailScreen; cut?: true; stopped?: true; nothingMore?: true; botProposal?: BotProposalView }
  /** `choices`: tappable answers; a tap sends its `text` as the user's own message (PDR-028). */
  | { kind: "question"; text: string; choices?: Choice[]; offer?: "contacts" }
  /** `afterAction` (stopped only): an action that changes something had finished before the stop. */
  | { kind: "outcome"; outcome: Outcome; afterAction?: true }
) & {
  /** The session has read content written by others (ST-TAINTED): the chat shows it until the session ends. */
  tainted?: boolean;
};

/** The mail screen a turn's answer links to (SL-48, SL-49). */
export type MailScreen = "HM-MAIL-02" | "HM-MAIL-03" | "HM-MAIL-04";
const MAIL_SCREENS: Readonly<Record<string, MailScreen>> = { mail_list: "HM-MAIL-02", mail_search: "HM-MAIL-03", mail_draft: "HM-MAIL-04" };

/** What HM-MAIL-04's Send puts through the cage: `draftCall` from the app's mail service, with its draft's taint. */
export interface MailSendCall {
  skill: "mail_send" | "mail_reply";
  args: Record<string, unknown>;
  taint?: TaintSource["kind"];
}

/** sent: approved and the provider took it. declined: no, expired, or no fingerprint. unavailable: no such send, or a sheet that can't be shown. */
export type MailSendOutcome = "sent" | "declined" | "unavailable" | "blocked" | "failed";

/** A page read this session, as the chat links to it. */
export interface WebPageRef {
  id: string;
  title: string;
  domain: string;
}

/** HM-WEB-01: a page an answer used. In memory only, for this app run: it is other people's text. */
export type WebPage = WebPageRecord & { id: string; at: number };

/**
 * HM-ACT-01's row: the signed log's, metadata only, and on a step a bot's turn ran or a change to a bot, the name that bot
 * has now (multi-bot). The name is read when the row is shown, never stored in the log; a bot that was deleted has none.
 */
export type ActivityRowView = ActivityRow & { botName?: string };

/** Multi-bot (Task 11): `bots` and `modes` for HM-BOT-01 to 04 and Settings, and sessions per bot (HermitBotsApi). */
export interface Hermit extends HermitBotsApi {
  init(): Promise<void>;
  /** A session for a bot (Hermit's when absent); a bot that doesn't exist gets none. */
  startSession(opts?: { attended?: boolean; botId?: string }): Promise<string>;
  /** US-CHAT-07: a bot's chat (Hermit's when absent) picks up its last attended conversation after a restart, or starts one. */
  resumeSession(botId?: string): Promise<string>;
  /** HM-BOT-02's "New chat": a fresh chat with the same bot; its older chats stay. */
  newChat(botId: string): Promise<string>;
  /** What the chat showed in this session (user words and final answers), and whether it read others' content. */
  transcript(sessionId: string): Promise<{ entries: TranscriptEntry[]; tainted: boolean }>;
  /**
   * "Clear conversation": that bot's history goes (Hermit's when absent; notes and the signed log stay); returns the
   * fresh session's id. While a turn of that bot runs, nothing is cleared and the running session's id comes back (F-M14).
   */
  clearConversation(botId?: string): Promise<string>;
  /** HM-MEM-01 and HM-MEM-02 (US-MEM-04). */
  memories: {
    list: Memory["list"];
    get: Memory["get"];
    /** The same delete as the `forget` skill, for one note, signed in the log without its content. */
    delete(sessionId: string, id: number): Promise<boolean>;
  };
  /**
   * `signal` is the stop control (US-CHAT-06): aborting it ends the turn with the `stopped` outcome. A reply written
   * with no tools in reach that already showed words keeps them instead, marked cut and stopped (Q155).
   */
  send(sessionId: string, text: string, live?: { onToken?(t: string): void; onThinking?(t: string): void; onEvent?(e: StepEvent): void; signal?: StopSignal }): Promise<TurnView>;
  /**
   * Q155, the chat's Seguir: the next part of the session's latest reply, when it stopped short. Words only (the model
   * with no tools offered), so nothing runs and the cage has nothing to decide; the part streams through `onToken` and
   * grows the same reply. Only in the chat's own attended sessions and only when the user taps it: it never runs on its
   * own, at night or unattended. `signal` stops it, keeping what was already shown. A part with nothing new ends it:
   * the view says `nothingMore` and the reply is no longer cut. Rejects when there is nothing to continue (the latest
   * turn isn't a cut reply) or the session isn't attended.
   */
  continueReply(sessionId: string, live?: { onToken?(t: string): void; signal?: StopSignal }): Promise<TurnView>;
  /** The notification listener feeds this (live, or the native queue on start). */
  messages: MessageStore;
  activity(): Promise<{ rows: ActivityRowView[]; chain: ChainView }>;
  /** HM-ACT-02 (US-ACT-03): the entries behind one row, or undefined if `seq` starts no row. */
  activityEntry(seq: number): Promise<ActivityDetail[] | undefined>;
  /**
   * US-ACT-04, PDR-012: clears the log, leaving one signed entry that records the clear. The app asks for
   * a fingerprint first. A broken chain is evidence (EC-ACT-02), so the clear is refused and nothing changes.
   */
  clearActivity(): Promise<{ kind: "cleared"; count: number } | { kind: "refused_broken" }>;
  /** HM-VAULT-01 and HM-VAULT-02 (SL-33): present only when the app passed the vault port. */
  vault?: Vault;
  /** HM-PAY-01 to HM-PAY-04 (SL-38, SL-39): present only when the app passed the wallet port. Screen-only. */
  wallet?: Wallet;
  /**
   * HM-CONN-03 (SL-54): add an MCP server by the address the user typed or pasted, review it, toggle its tools,
   * remove it. Screen-only: no skill reaches it, so nothing the model read can add a server.
   */
  mcp?: Pick<McpServers, "begin" | "finishSignIn" | "approve" | "cancel" | "list" | "setTool" | "reapprove" | "remove">;
  /** HM-CONN-05 (SL-57): the user's own relay and Dojo's opt-in relay. Screen-only, like `mcp`. */
  relay: RelaySettings;
  /**
   * HM-MAIL-04's Send (SL-49): a draft's mail_send or mail_reply through the cage like the chat's: an attended session,
   * tainted like the one that wrote the draft, the rules, the sheet built from the arguments and the app's mail data,
   * the fingerprint a send needs, and the signed log. Present only with the mail skills and their render port.
   */
  mailSend?(call: MailSendCall): Promise<MailSendOutcome>;
  /** The approval key screen (SL-37): its state and setting it up again. Present only with the approval key port. */
  approvalKey?: ApprovalKeyService;
  /** HM-PAY-05 (SL-40): spending caps and saved payees. Present only with the wallet, approval key and pay ports. */
  payments?: Omit<Payments, "runtime" | "merchantRuntime">;
  /** HM-FORM-02 (SL-35): the personal profile, inside the vault. Present only with the vault port. */
  profile?: Profile;
  /** HM-FORM-01 (SL-35): filling another app's form from the profile, decided by the cage. Present only with the vault port. */
  forms?: FormFill;
  /**
   * HM-CONN-04 (SL-55): discover, review, key, test call, install with a fingerprint, list, toggle, remove. Screen-only:
   * no skill reaches it, so nothing the model read can install a connector.
   */
  connect?: Pick<ConnectorInstalls, "start" | "setSignIn" | "saveKey" | "testCall" | "install" | "cancel" | "list" | "setOperation" | "remove">;
  /**
   * SL-53: HM-WEB-02 only: the recipes, the chat's one-time offers, tasks in a browser, recording and saving. The model's
   * menu gets the recipes the user's words name (send), never these, so nothing it read can save or start a task.
   */
  web?: Omit<WebTasks, "turnSkills">;
  /**
   * ENT-Setting: small key and value settings (onboarding done, language override, calendar choice). `set` refuses the
   * permission mode: only `modes` writes it, with the typed word and the fingerprint Don't ask needs.
   */
  settings: { get(key: SettingKey): Promise<string | undefined>; set(key: SettingKey, value: string): Promise<void> };
  /** HM-REM-01 (US-REM-03): pending reminders, soonest first, and cancel by a tap. */
  reminders: {
    upcoming(): Promise<Reminder[]>;
    /**
     * The same cancel as the chat's reminder_cancel: through the cage and into the signed log as that skill.
     * "gone" when it already fired or was cancelled elsewhere; "blocked" if the rules refuse it.
     */
    cancel(id: number): Promise<"cancelled" | "gone" | "blocked">;
  };
  /** HM-CAL-02 (US-CAL-03): the phone's writable calendars and the one calendar_add writes to (setting `calendar.id`). */
  calendars: {
    choice(): Promise<CalendarChoice>;
    /** Rejects a calendar that isn't on the phone or is read-only. */
    choose(id: string): Promise<void>;
  };
  /** FR-PRIV-02: the app's fetch wrapper records each outbound host; HM-SET-02 lists them. Hosts only, never paths. */
  hosts: { record(url: string): Promise<void>; list(): Promise<HostCount[]> };
  /** For HM-CHAT-02: the profile in use and the last turn's timing, from the local event log. */
  lastTurn(): Promise<{ profile: string; firstActionMs?: number; totalMs?: number } | undefined>;
  /** HM-WEB-01: a page read in this app run, by the id its answer carries. */
  page(id: string): WebPage | undefined;
  /** HM-NIGHT-01 and HM-NIGHT-02 (SL-24): the night shift and its morning briefing. */
  night: {
    settings(): Promise<NightSettings>;
    /** Saves only a valid choice; returns what's wrong otherwise (nothing changes). */
    saveSettings(s: NightSettings): Promise<NightSettingsProblem[]>;
    /**
     * One wake of the night shift (the scheduler calls it; `manual` is the debug "run now"). Every job runs in
     * an unattended session through the cage; nothing is ever asked. Schedules the morning notice once.
     */
    run(opts: {
      conditions(): DeviceState | Promise<DeviceState>;
      noticeTitle: string;
      manual?: boolean;
      /** SL-26 with Q69: true once "Delete everything" began; the pass stops before its next write. */
      aborted?(): boolean;
    }): Promise<Briefing | undefined>;
    /** The newest briefing. */
    briefing(): Promise<Briefing | undefined>;
    /** A suggestion's "Review": the normal approval sheet, then it runs only if approved (FR-NIGHT-02). */
    act(briefingId: string, suggestionId: string): Promise<ActOutcome>;
  };
}

/** Every setting key is declared here, so screens can't invent ad hoc ones. */
export type SettingKey = "onboarding.done" | "locale.override" | "calendar.id" | "download.allowMobile"
  /**
   * Multi-bot (spec 6.4.1): the permission mode every bot without its own runs in, "ask", "auto" or "dont_ask"; absent
   * means Ask. Read here; written only by `modes.setGlobal` (`settings.set` refuses it).
   */
  | "bots.mode"
  /** SL-37: the approval key's public part, pinned at enrollment (JSON). */
  | "approval.key"
  /** "1" once the user opted in to Dojo's relay on HM-CONN-05; absent means off (PDR-022, US-CONN-10). */
  | "relay.dojo"
  /** SL-57: the user's own relay on HM-CONN-05, an https address on a public host; absent means none (US-CONN-09). */
  | "relay.own"
  /** US-CONN-08: the user's own OAuth client IDs on HM-CONN-05 ({ google, microsoft } as JSON); never a secret. */
  | "signin.clients"
  /** "1" when quiet mode is on (HM-SET-06, US-SET-06); absent or "0" means off. */
  | "appearance.quiet"
  /** HM-SET-07 (US-SET-08): "light" or "dark" pins the scheme; absent or "system" follows the phone. */
  | "appearance.theme"
  /** search_web's provider (HM-SET-02, US-WEB-03): absent means DuckDuckGo, "off", or "searxng:<https address>" (Q58). */
  | "search.provider"
  /** HM-NIGHT-01 (SL-24): the night shift settings as JSON; absent or invalid means off. */
  | "night.settings"
  /** Q69: the night run lock (owner and expiry as JSON), so a headless wake and the app never run at once. */
  | "night.lock"
  /** "1" once the chat offered the contacts permission (PDR-028): it is offered once and never again. */
  | "contacts.offered"
  /**
   * SL-48: the connected mail accounts and which need signing in again (as JSON, from @hermit/mail's
   * StoredMailAccounts); never a token, those live in the credential store.
   */
  | "mail.accounts"
  /** SL-49 (FR-MAIL-04): the address book, addresses and their origin only (as JSON). */
  | "mail.book"
  /** SL-54: the MCP servers the user added (McpServerRecord[] as JSON). No tokens: those live in the credential store. */
  | "mcp.servers"
  /** SL-55: the connectors the user installed on HM-CONN-04 (InstalledRecord[] as JSON). No keys: those live in the credential store. */
  | "connectors.installed"
  /** SL-53: the user's saved web task recipes (Recipe[] as JSON), validated on every load. */
  | "web.recipes"
  /** SL-53 (US-WEB-06): the sites whose sign-in the user chose to keep (exact origins as JSON); every other site is cleared. */
  | "web.keptSites"
  /** SL-56 (HM-WEB-02): the login each site signs in with, exact origin to vault item hash (as JSON); no value. */
  | "web.siteLogins";

const HISTORY_TURNS = 40;
/** The approval sheet stays open as long as the chat's (two minutes). */
const SCREEN_APPROVAL_MS = 120_000;
/** The loop's English taint warning by what was read (the sheet words it from the kind, HM-APPR-01.taintFrom.*). */
const SCREEN_TAINT_WARNING: Readonly<Record<string, string>> = {
  email: "Suggested after reading email", inbound_message: "Suggested after reading messages", web: "Suggested after reading a web page",
  file: "Suggested after reading a file", notification: "Suggested after reading a notification", bot: "Suggested after reading another bot's message",
};
const CANCEL = skillId("reminder_cancel");
const CANCEL_RISK = firstWinSkills.find((s) => s.id === CANCEL)!.risk;
/** Pages kept for HM-WEB-01, newest last. */
const MAX_PAGES = 20;
/** The clear is the user's act from the Activity screen, not part of any chat session. */
const CLEAR_SESSION = "user";

export function createHermit(ports: HermitPorts, profile: ModelProfile): Hermit {
  const { sql } = ports;
  const memory = createMemory(sql);
  const messages = createMessageStore(sql);
  const sessions = createSessions(sql, ports.now);
  const events = createEventLog(sql, ports.now);
  const audit = createAuditLog(sql, ports.signer);
  const hostCounter = createHostCounter(sql, ports.now);
  const reminders = () => createReminders(sql, ports.notifier, { timeZone: ports.timeZone(), now: ports.now });
  const briefings = createBriefings(sql);
  const nightLock = createNightLock(sql);
  const store = createBotsStore(sql, ports.now);
  // Multi-bot (spec 6.6): one model, one line. Every call waits its turn at the priority of the work it belongs to: a
  // reader inside a turn at the turn's, the night's as a routine, a screen's own (connector drafts, a web task's reader
  // and repair) as the user's.
  const queue = ports.queue ?? createRunQueue();
  const engineAt = (priority: RunPriority): CompletionEngine => queuedEngine(ports.engine, queue, priority);

  // The settings table. Its one writer of the permission mode goes to `modes` only; every other caller, the app's screens
  // included, gets `settings`, which refuses it, so nothing holding the settings can turn on Don't ask without the typed
  // word and the fingerprint (controller's ruling on Task 10's review).
  const table: Hermit["settings"] = {
    async get(key) {
      const [row] = await sql.query<{ value: string }>("SELECT value FROM settings WHERE key = ?", [key]);
      return row?.value;
    },
    async set(key, value) {
      await sql.exec("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", [key, value]);
    },
  };
  const settings: Hermit["settings"] = {
    get: table.get,
    async set(key, value) {
      if (isModeSetting(key)) throw new Error("The permission mode changes only through modes.setGlobal or modes.setBot, with their checks.");
      await table.set(key, value);
    },
  };
  // Multi-bot (Task 12): Hermit's bot proposals, in memory by a one-time id, each with the next unused shell. The card's
  // Create and HM-BOT-03 reach them through the bots API, which uses an offer once and keeps a tainted one for the review.
  const proposals = createBotProposals({ newId: ports.newId, nextLook: () => store.nextLook(), now: ports.now, mode: () => botsApi.modes.global() });
  // Multi-bot (Task 11): HM-BOT-01 to 04 and Settings. A reset clears through clearConversation (F-M14); a bot is busy
  // while a turn of it runs; the fingerprint is the app's, its prompt in the app's language.
  const botsApi = createBotsApi({
    store, sessions, memory, settings: table, audit,
    clear: (botId) => api.clearConversation(botId),
    busy: (botId) => running.has(botId),
    setClearing: (botId, active) => {
      if (active) clearing.add(botId);
      else clearing.delete(botId);
    },
    ...(ports.bots ? { confirm: (prompt: string) => ports.bots!.confirm(prompt) } : {}),
    ...(ports.copy ? { say: (key: string) => ports.copy!(ports.language(), key) } : {}),
    proposals,
    newId: ports.newId,
    now: ports.now,
  });
  // SL-57: HM-CONN-05's relay choices, in the same settings table (erased with it).
  const relay = createRelaySettings({
    settings: { get: settings.get, set: settings.set, remove: async (key) => void (await sql.exec("DELETE FROM settings WHERE key = ?", [key])) },
    ...(ports.relay?.transport ? { transport: ports.relay.transport } : {}),
    ...(ports.relay?.dojoRelayUrl ? { dojoRelayUrl: ports.relay.dojoRelayUrl } : {}),
    ...(ports.relay?.dojoClientIds ? { dojoClientIds: ports.relay.dojoClientIds } : {}),
  });
  // SL-37: the approval key screen and the signer the chat's turns verify money and password approvals with.
  const approvalKey: ApprovalKeyService | undefined = ports.approvalKey
    ? createApprovalKey({ port: ports.approvalKey.port, randomBytes: ports.approvalKey.randomBytes, settings, audit, sql, now: ports.now })
    : undefined;
  // calendar_add writes to the calendar chosen on HM-CAL-02; the adapter falls back when none is chosen or it's gone.
  const calendar: CalendarPort = {
    list: (from, to) => ports.calendar.list(from, to),
    calendars: () => ports.calendar.calendars(),
    async add(event) {
      const calendarId = await settings.get("calendar.id");
      return ports.calendar.add(event, calendarId ? { calendarId } : undefined);
    },
  };

  // The answer after another app opens is copy, in the language of the user's words (the setting is the fallback).
  const intents = () => {
    if (!ports.intents) return [];
    const { launcher, copy } = ports.intents;
    return intentSkillRuntimes({
      launcher,
      say: (key, said, vars) => {
        const lang = userLanguage(said);
        return copy(lang === "English" ? "en" : lang === "Spanish (Latin America)" ? "es-419" : ports.language(), key, vars);
      },
    });
  };

  // PDR-028: questions about who the user meant, in the language of their words (the setting is the fallback).
  const people = (): PeopleDeps | undefined => {
    if (!ports.people) return undefined;
    const { contacts, pastRecipients, copy } = ports.people;
    return {
      ...(contacts ? { contacts } : {}),
      ...(pastRecipients ? { pastRecipients } : {}),
      say: (key, said, vars) => {
        const lang = userLanguage(said);
        return copy(lang === "English" ? "en" : lang === "Spanish (Latin America)" ? "es-419" : ports.language(), key, vars);
      },
    };
  };

  // FR-WEB-02: domains approved per session, in memory only (a restart or a new session asks again). Search providers
  // approved for search_web are kept apart: neither list approves what the other is for.
  const approvedDomains = new Map<string, string[]>();
  const approvedSearchProviders = new Map<string, string[]>();
  const pages: WebPage[] = [];
  const webLanguage = (text: string): WebLanguage => {
    const said = userLanguage(text);
    return said === "English" ? "en" : said === "Spanish (Latin America)" ? "es-419" : ports.language();
  };
  const web = (turn: { engine: CompletionEngine; signal?: StopSignal; onPage(p: WebPage): void }) => {
    if (!ports.web) return [];
    const { fetch, copy } = ports.web;
    return readWebSkills({
      fetch,
      t: copy,
      language: webLanguage,
      // FR-WEB-03: its own model call, no skills, only the page and the user's words.
      read: ({ question, text, language }) =>
        quarantinedRead(turn.engine, profile, { question, untrusted: text, source: "read_web", language, kind: "page", ...(turn.signal ? { signal: turn.signal } : {}) }),
      onPage: (record) => {
        const p: WebPage = { ...record, id: ports.newId(), at: ports.now() };
        pages.push(p);
        if (pages.length > MAX_PAGES) pages.shift();
        turn.onPage(p);
      },
    });
  };

  // US-WEB-03: the provider is read once per turn, so the cage, the sheet and the request all see the same one.
  const search = (turn: { engine: CompletionEngine; signal?: StopSignal; provider: SearchProvider | undefined }) => {
    if (!ports.web) return [];
    const { fetch, copy } = ports.web;
    return searchWebSkills({
      fetch,
      t: copy,
      language: webLanguage,
      provider: () => turn.provider,
      // FR-WEB-03: its own model call, no skills, only the results and the user's words.
      read: ({ question, text, language }) =>
        quarantinedRead(turn.engine, profile, { question, untrusted: text, source: "search_web", language, kind: "results", ...(turn.signal ? { signal: turn.signal } : {}) }),
    });
  };

  // SL-55 (HM-CHAT-01): connect_service installs and contacts nothing. It offers HM-CONN-04 for a service the user named
  // in this message; anything else gets a question. The offer is a button the user taps; the screen does the rest.
  const connectOffer = (turn: { onConnect?(request: string): void }): SkillRuntime[] => {
    const port = ports.connect;
    if (!port) return [];
    return [{
      def: connectSkill as SkillDef,
      async execute(args, ctx) {
        const said = ctx.userText ?? "";
        const language = webLanguage(said);
        const service = serviceFromUser(args.service, said);
        if (!service) return { ok: false, modelText: "That service isn't in the user's own words, so nothing was offered.", ask: port.copy(language, "HM-CHAT-01.connect.which") };
        turn.onConnect?.(service);
        return { ok: true, modelText: `Offered the user the screen to connect ${service}. Nothing was installed or contacted.`, reply: port.copy(language, "HM-CHAT-01.connect.offer", { service }) };
      },
    }];
  };

  // W1: the first-win skills' own answers, in the language of the user's words (the setting is the fallback), and every
  // time they show in the phone's zone.
  const answerWords: AnswerWords | undefined = ports.copy
    ? {
        language: (said) => {
          const lang = userLanguage(said);
          return lang === "English" ? "en" : lang === "Spanish (Latin America)" ? "es-419" : ports.language();
        },
        copy: (language, key, vars) => ports.copy!(language, key, vars),
      }
    : undefined;
  const firstWin = () => ({ timeZone: ports.timeZone(), now: ports.now, ...(answerWords ? { words: answerWords } : {}) });

  // Multi-bot (Task 12, spec 6.4 "Creating a bot", 6.8): create_bot creates nothing. It offers a card for the bot the user
  // asked for, drawn by the app from the proposal's typed fields, and the turn ends in code's words in the language of the
  // user's; the user taps Create or Review. With the copy only, since the model never words that answer. Only Hermit holds
  // it (no group), and only the chat's own turns, which show the card, get it.
  const proposalSay = answerWords ? (key: string, said: string) => answerWords.copy(answerWords.language(said), key) : undefined;
  const botProposal = (turn: { onBotProposal?(view: BotProposalView): void }): SkillRuntime[] =>
    proposalSay && turn.onBotProposal ? [createBotRuntime(proposals, proposalSay, turn.onBotProposal)] : [];
  /**
   * Every built-in runtime, for one turn: its readers wait in the queue at `engine`'s priority, and its notes are `notes`
   * (the bot's own and the shared profile; Hermit's for the night shift and its suggestions).
   */
  const skills = (turn: Parameters<typeof web>[0] & { notes: BotMemory; provider: SearchProvider | undefined; onConnect?(request: string): void; onBotProposal?(view: BotProposalView): void }) => [
    ...web(turn),
    ...search(turn),
    ...memorySkills(turn.notes, answerWords ? { words: answerWords } : {}),
    ...reminderSkills(reminders(), { locale: ports.language() === "es-419" ? "es-419" : "en", ...firstWin() }),
    ...calendarSkills(calendar, firstWin()),
    ...messageSkills(messages, ports.replySender, firstWin()),
    ...intents(),
    ...(ports.mail ?? []),
    ...connectOffer(turn),
    ...botProposal(turn),
  ];
  // The mail skills the app wired, in its order (reads from SL-48, writes from SL-49): the menu offers exactly
  // the skills that can run. Web reading only with a web port, intent skills only when the app passes a launcher.
  // SL-40: the chat's pay skill, only with a wallet, the Keystore approval key and the payment ports. The night shift
  // never gets it (it isn't in skills() and its rules keep the spend floor), and the cage denies it there anyway.
  const payments: Payments | undefined = ports.wallet && ports.pay && approvalKey
    ? createPayments({
        sql, audit, now: ports.now, newId: ports.newId, randomBytes: ports.approvalKey!.randomBytes,
        wallet: { key: ports.wallet.key, record: ports.wallet.record, worklet: ports.pay.worklet },
        confirm: ports.pay.confirm,
        say: (key, said, vars) => {
          const lang = userLanguage(said);
          return ports.pay!.copy(lang === "English" ? "en" : lang === "Spanish (Latin America)" ? "es-419" : ports.language(), key, vars);
        },
        sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
        // SL-41: paying a site that asks for x402 needs the web port (the page and its paid retry) and the chain's
        // read-only RPC (authorizationState), or "paid" could never be checked.
        ...(ports.web && ports.wallet.chain ? { merchant: { fetch: ports.web.fetch, chain: ports.wallet.chain } } : {}),
      })
    : undefined;
  const merchantOn = payments !== undefined && ports.web !== undefined && ports.wallet?.chain !== undefined;
  const menu = [
    ...firstWinSkills, ...(ports.web ? webSkills : []), ...(ports.intents ? intentSkills : []), ...(ports.mail ?? []).map((s) => s.def),
    ...(ports.connect ? [connectSkill as SkillDef] : []),
    ...(proposalSay ? [createBotDef as SkillDef] : []),
    ...(payments ? [payDef as SkillDef] : []),
    ...(merchantOn ? [payMerchantDef as SkillDef] : []),
  ];
  // SL-41: the page a purchase paid for goes to the same quarantined reader as read_web's, and shows on HM-WEB-01.
  const merchantTurn = (turn: { engine: CompletionEngine; signal?: StopSignal; onPage(p: WebPage): void }): SkillRuntime[] => {
    if (!payments || !merchantOn || !ports.web) return [];
    const runtime = payments.merchantRuntime({
      t: ports.web.copy,
      language: webLanguage,
      read: ({ question, text, language }) =>
        quarantinedRead(turn.engine, profile, { question, untrusted: text, source: "pay_merchant", language, kind: "page", ...(turn.signal ? { signal: turn.signal } : {}) }),
      onPage: (record) => {
        const p: WebPage = { ...record, id: ports.newId(), at: ports.now() };
        pages.push(p);
        if (pages.length > MAX_PAGES) pages.shift();
        turn.onPage(p);
      },
    });
    return runtime ? [runtime] : [];
  };

  // SL-55: connectors the user installed on HM-CONN-04. Records in the settings table (erased with the tables), keys in
  // the credential store, the spec hash in the signed log. Drafting is a quarantined model call: the doc as data, a
  // JSON grammar, no tools, no memory, no history, no thinking.
  const connectors = ports.connect
    ? new ConnectorInstalls({
        transport: ports.connect.transport,
        credentials: ports.connect.credentials,
        random: ports.connect.random,
        now: ports.now,
        store: {
          async load() {
            const raw = await settings.get("connectors.installed");
            try {
              return raw ? (JSON.parse(raw) as InstalledRecord[]) : [];
            } catch {
              return [];
            }
          },
          save: (records) => settings.set("connectors.installed", JSON.stringify(records)),
        },
        // HM-CONN-04's own calls: the user's, from the screen.
        engine: {
          async complete(req) {
            try {
              const out = await engineAt("user").complete({
                messages: [{ role: "system", content: req.system }, { role: "user", content: req.user }],
                jsonSchema: req.jsonSchema,
                thinking: { enabled: false },
                sampling: profile.sampling,
                maxTokens: req.maxTokens,
              });
              return out.text;
            } catch {
              return undefined;
            }
          },
        },
        pageText: (body, contentType) => extractReadable(body, contentType).text,
        confirm: () => ports.connect!.confirm(),
        // No connector operation may take a built-in's id (they are namespaced `conn_` too; this refuses any clash).
        reservedSkillIds: () => menu.map((s) => s.id as string),
        log: async ({ reason, specHash }) => {
          await audit.append({ ts: ports.now(), sessionId: CLEAR_SESSION, event: "connector", skill: "connector", argsHash: specHash, outcome: "ok", reason });
        },
      })
    : undefined;
  // Multi-bot (spec 6.4): each operation says, from code, which connector it comes from; a bot holds it only through its sources.
  const connectorRuntimes = (turn: ConnectorSkill[]): SkillRuntime[] =>
    turn.map((c) => ({
      def: c.def,
      source: c.connectorId,
      execute: async (args, ctx) => {
        const r = await c.execute(args, {
          session: ctx.session,
          ...(ctx.approvedArgsHash !== undefined ? { approvedArgsHash: ctx.approvedArgsHash } : {}),
          ...(ctx.approvedBinding !== undefined ? { approvedBinding: ctx.approvedBinding } : {}),
        });
        // Someone else's text (FR-CAGE-04): the loop wraps it and the session is tainted.
        return { ...r, taintKind: "web" as const };
      },
    }));

  // SL-54: MCP servers, their records in the settings table (erased with the tables), their tokens in the credential store.
  const mcpServers = ports.mcp
    ? new McpServers({
        transport: ports.mcp.transport,
        credentials: ports.mcp.credentials,
        random: ports.mcp.random,
        clientVersion: ports.mcp.clientVersion,
        now: ports.now,
        store: {
          async load() {
            const raw = await settings.get("mcp.servers");
            try {
              return raw ? (JSON.parse(raw) as McpServerRecord[]) : [];
            } catch {
              return [];
            }
          },
          save: (records) => settings.set("mcp.servers", JSON.stringify(records)),
        },
      })
    : undefined;
  // Multi-bot (spec 6.4): each tool says, from code, which server it comes from; a bot holds it only through its sources.
  const mcpRuntimes = (turn: McpSkill[], opts: { engine: CompletionEngine; language: WebLanguage; signal?: StopSignal }): SkillRuntime[] =>
    turn.map((m) => ({
      def: m.def,
      source: m.serverId,
      execute: async (args, ctx) => {
        const r = await m.execute(args, {
          ...ctx,
          // FR-WEB-03: the tool's free text is read by its own model call with no skills, memory or history.
          read: async ({ question, text }) =>
            (await quarantinedRead(opts.engine, profile, { question, untrusted: text, source: m.def.id, language: opts.language, kind: "tool", ...(opts.signal ? { signal: opts.signal } : {}) }))?.answer,
          say: (key) => ports.mcp!.copy(opts.language, key),
        });
        return { ...r, taintKind: "web" as const };
      },
    }));

  /**
   * One routed list for MCP tools and connector operations, capped at MAX_MCP_TOOLS_PER_TURN in all (Q93's rule), out of
   * what the turn's bot holds (`held`, by each one's server or connector, spec 6.4). The cap applies to the bot's own,
   * never before it, so Hermit's other installs can't push a bot's tools off its menu. Every install is routed, then what
   * the bot holds is kept, then the first few: the same order as before, so Hermit, who holds them all, gets today's list.
   */
  const extraForTurn = async (userText: string, held: (def: SkillDef, source: string) => boolean): Promise<Array<{ mcp?: McpSkill; connector?: ConnectorSkill }>> => {
    // An installed tool or operation never shadows a built-in or another installed one: a clashing id stays off the
    // menu (and runTurn refuses duplicates outright).
    const taken = new Set<string>(menu.map((s) => s.id as string));
    const unique = <T extends { def: SkillDef }>(list: T[]) => list.filter((x) => !taken.has(x.def.id) && (taken.add(x.def.id), true));
    const own = <T extends { def: SkillDef }>(routed: T[], source: (x: T) => string) => routed.filter((x) => held(x.def, source(x))).slice(0, MAX_MCP_TOOLS_PER_TURN);
    const mcp = unique(mcpServers ? own(await mcpServers.skillsForTurn({ userText, cap: Infinity }), (m) => m.serverId) : []);
    const conn = unique(connectors ? own(await connectors.skillsForTurn({ userText, cap: Infinity }), (c) => c.connectorId) : []);
    if (!conn.length) return mcp.map((m) => ({ mcp: m }));
    const hosts = new Map((mcpServers ? await mcpServers.list() : []).map((v) => [v.id, v.host]));
    const installed = new Map((await connectors!.list()).map((v) => [v.id, v]));
    const candidates = [
      ...mcp.map((m) => ({ serverId: m.serverId, host: hosts.get(m.serverId) ?? "", name: m.tool, mcp: m })),
      ...conn.map((c) => {
        const v = installed.get(c.connectorId);
        return { serverId: c.connectorId, host: v?.hosts[0] ?? "", name: c.operation, ...(v?.lastUsedAt !== undefined ? { lastUsedAt: v.lastUsedAt } : {}), connector: c };
      }),
    ];
    return routeMcpTools(userText, candidates, MAX_MCP_TOOLS_PER_TURN).map((x) => ("mcp" in x ? { mcp: x.mcp } : { connector: x.connector }));
  };

  // W1 review: what the phone can use now, for "what can you do?": Android's permissions (the app's access port), the
  // search provider (search.provider isn't "off") and a connected email account. Unknown stays unknown, and is listed.
  const capabilityAccess = async (): Promise<CapabilityAccess> => {
    const os = (await ports.access?.().catch(() => undefined)) ?? {};
    const search = ports.web ? searchProvider(await settings.get("search.provider")) !== undefined : undefined;
    let mailAccount: boolean | undefined;
    if (ports.mail?.length) {
      try {
        mailAccount = ports.mailRender ? (await ports.mailRender()).sender(undefined).ok : false;
      } catch {
        mailAccount = false;
      }
    }
    return {
      ...(os.notifications !== undefined ? { notifications: os.notifications } : {}),
      ...(os.calendar !== undefined ? { calendar: os.calendar } : {}),
      ...(search !== undefined ? { search } : {}),
      ...(mailAccount !== undefined ? { mailAccount } : {}),
    };
  };

  /**
   * Multi-bot (spec 6.6): the values one turn runs with, built for the bot it runs as, every turn: its cage (grants,
   * sources, the mode in effect), its menu and what it can't do, its role, its notes with the shared profile (FR-MEM-06)
   * and what they were read from, and its cache key. Nothing here is shared with another turn.
   */
  const turnFor = async (botId: string): Promise<BotTurn> => {
    const bot = await store.get(botId);
    if (!bot) throw new Error(`No bot ${botId}.`);
    // The mode every bot without its own runs in (spec 6.4.1): the user's choice in Settings, Ask until there is one.
    const cage = cageFor(bot, await botsApi.modes.global());
    const { menu: held, withheld } = botMenu(menu, cage);
    // Security review 00:40: the snapshot never comes without what its notes were read from.
    const notes = await memory.forBot(bot.id).snapshot();
    const role = roleFor(bot);
    return {
      bot, cage, menu: held, withheld, ...(role ? { role } : {}),
      profile: notes.text.split("\n").map((l) => l.replace(/^-\s*/, "").trim()).filter(Boolean),
      profileReads: notes.kinds,
      cacheKey: cacheKeyFor(bot.id),
    };
  };

  /** HM-BOT-02: what a bot can't do, in code's words, by the group of the skill it lacks. Without the copy, the model words it. */
  const withheldAnswer = (turn: BotTurn, skill: SkillId, language: "es-419" | "en"): string | undefined => {
    const group = turn.withheld.find((s) => s.id === skill)?.group;
    if (!group || !ports.copy) return undefined;
    return ports.copy(language, "HM-BOT-02.withheld", { what: ports.copy(language, `HM-BOT-02.what.${group}`) });
  };

  /**
   * The model for one turn: the bot's menu with this turn's installed tools after it, the bot's notes and role in its
   * prompts, and every call in the queue through `engine`. Hermit's has no role and withholds nothing, so its prompts and
   * picks are today's.
   */
  const portFor = (turn: BotTurn, engine: CompletionEngine, extra: readonly SkillDef[] = []) =>
    createModelPort(engine, profile, turn.menu, () => ({
      language: ports.language(),
      now: describeNowForModel(ports.now(), ports.timeZone()),
      // The router reads day words on the phone's clock and zone (W1 review).
      clock: { now: ports.now(), timeZone: ports.timeZone() },
      profile: turn.profile,
      ...(turn.role ? { role: turn.role } : {}),
    }), {
      catchUpSummary: true,
      extraSkills: () => extra,
      ...(turn.withheld.length ? { withheld: { skills: turn.withheld, answer: (skill: SkillId, language: "es-419" | "en") => withheldAnswer(turn, skill, language) } } : {}),
      // W1: "what can you do?" answered from the skills on this bot's menu that the phone can use right now, in code's words.
      ...(ports.copy ? { capabilities: async (language: "es-419" | "en") => capabilityAnswer(turn.menu.map((s) => s.id as string), (key, vars) => ports.copy!(language, key, vars), await capabilityAccess()) } : {}),
    });

  /** Load the model and read the bot's fixed prompt while the user types (best effort, never blocks the session). */
  const warm = (botId: string) => {
    void turnFor(botId).then((turn) => portFor(turn, engineAt("user")).warm?.({ prefixCacheKey: turn.cacheKey })).catch(() => {});
  };

  /**
   * Review Focus 1: the bots with a turn in progress, each with the sessions its turns run in, newest last. The bots API's
   * busy check reads it (remove and reset refuse while a turn of that bot runs). `botOf` knows the bot of every session
   * Hermit handed out or loaded, so a turn is marked the moment it starts, and a clear or reset called right after the
   * send already sees it.
   */
  const running = new Map<string, string[]>();
  const clearing = new Set<string>();
  const botOf = new Map<string, string>();
  class ClearingError extends Error {
    constructor() {
      super("This conversation is being cleared.");
      this.name = "ClearingError";
    }
  }
  const clearingReply = (): string =>
    ports.copy ? ports.copy(ports.language(), "HM-BOT-02.clearing") : "This conversation is being cleared. Write again in a moment.";
  const markRunning = (botId: string, sessionId: string): (() => void) => {
    running.set(botId, [...(running.get(botId) ?? []), sessionId]);
    let ended = false;
    return () => {
      if (ended) return;
      ended = true;
      const left = [...(running.get(botId) ?? [])];
      const at = left.lastIndexOf(sessionId);
      if (at >= 0) left.splice(at, 1);
      if (left.length) running.set(botId, left);
      else running.delete(botId);
    };
  };

  /**
   * One of the chat's own turns (`send`, `continueReply`) in a session: it holds its priority in the queue until it ends,
   * so lower-priority work waits for the whole turn, not just its current call (spec 6.6), and its bot is marked running.
   */
  const inTurn = <T>(sessionId: string, priority: RunPriority, run: (session: SessionState, botId: string) => Promise<T>): Promise<T> => {
    const handedOut = botOf.get(sessionId);
    if (handedOut !== undefined && clearing.has(handedOut)) return Promise.reject(new ClearingError());
    const release = queue.hold(priority);
    let unmark = handedOut !== undefined ? markRunning(handedOut, sessionId) : undefined;
    return (async () => {
      try {
        const session = await sessions.load(sessionId);
        if (!session) throw new Error(`No session ${sessionId}.`);
        const botId = session.botId ?? HERMIT_BOT_ID;
        if (clearing.has(botId)) throw new ClearingError();
        botOf.set(sessionId, botId);
        unmark ??= markRunning(botId, sessionId);
        return await run(session, botId);
      } finally {
        unmark?.();
        release();
      }
    })();
  };

  /** One night pass under the lock `owner` holds; renews it after every job so a long night keeps it. */
  const runNightOnce = async (opts: Parameters<Hermit["night"]["run"]>[0], owner: string): Promise<Briefing | undefined> => {
    const night = parseNightSettings(await settings.get("night.settings"));
    const prior = await briefings.latest();
    const language = ports.language();
    const mail = ports.mailNight;
    let b = await runNightShift(night, {
      // The same skills as the chat; the night shift runs only the reads its jobs name (nightRules). It runs as no bot, so
      // its decisions are today's (F-M13), and its readers wait in the queue as a routine.
      skills: skills({ engine: engineAt("routine"), notes: memory.forBot(HERMIT_BOT_ID), onPage: () => {}, provider: undefined }),
      audit,
      startSession: (id) => sessions.start({ id, attended: false }),
      markTainted: (id, source) => sessions.markTainted(id, source),
      // FR-WEB-03: the quarantined reader, its own call with no skills, memory or history.
      reader: ({ question, untrusted, source }) => quarantinedRead(engineAt("routine"), profile, { question, untrusted, source, language }),
      conditions: opts.conditions,
      now: ports.now,
      timeZone: ports.timeZone(),
      language,
      newId: ports.newId,
      ...(mail ? { knownSender: (a: string) => mail.known(a), snapshot: (_skill: string, args: Record<string, unknown>) => mail.snapshot(String(args.messageId ?? "")) } : {}),
      onProgress: async (x) => {
        await briefings.save(x);
        await nightLock.acquire(owner, ports.now());
      },
      events,
      ...(opts.manual ? { manual: true } : {}),
      ...(opts.aborted ? { aborted: opts.aborted } : {}),
    }, prior);
    const stopIfAborted = () => {
      if (opts.aborted?.()) throw new NightAborted();
    };
    // Nothing to do (switched off, or outside the window with nothing open): the last briefing stays as it was.
    if (!b || b === prior) return b;
    stopIfAborted();
    await briefings.save(b);
    // US-NIGHT-02: announced once, when nothing is left for the night (all done, or the window closed).
    const settled = b.closed || b.jobs.every((j) => j.status !== "pending" && j.status !== "paused");
    if (settled && b.noticeAt === undefined) {
      stopIfAborted();
      await scheduleBriefingNotice(ports.notifier, night, b, { title: opts.noticeTitle, timeZone: ports.timeZone(), now: ports.now() });
      b = { ...b, noticeAt: ports.now() };
      stopIfAborted();
      await briefings.save(b);
    }
    return b;
  };

  /**
   * SL-36: the login index the autofill service reads (each item's id hash, name and exact origins; never a secret),
   * pushed at launch and after every change to the vault's items. Read straight from the table, so it needs no unlock.
   */
  const syncLogins = async () => {
    const push = ports.autofill?.setLoginIndex;
    if (!ports.vault || !push) return;
    await push(loginIndex(await createVaultStore(sql).list()));
  };

  const vaultServices = ((): Pick<Hermit, "vault" | "profile" | "forms"> => {
    if (!ports.vault) return {};
    const deps = { ...ports.vault, sql, audit, now: ports.now, newId: ports.newId };
    const autofill = ports.autofill;
    const profile = createProfile({ ...deps, ...(autofill ? { onIndex: (i: { kinds: FormKind[]; sensitive: FormKind[] }) => autofill.setProfileIndex(i) } : {}) });
    const vault = createVault(deps);
    /** After a change to the items, the login index follows (best effort: the vault's answer stands either way). */
    const thenSync = async <T>(r: T): Promise<T> => {
      await syncLogins().catch(() => {});
      return r;
    };
    return {
      // A vault that starts over drops the profile's sensitive fields with its key: the index follows.
      vault: {
        ...vault,
        async create(prompt) {
          const r = await vault.create(prompt);
          if (r === "created") await profile.sync().catch(() => {});
          return r;
        },
        async reset() {
          await vault.reset();
          await profile.sync().catch(() => {});
          await syncLogins().catch(() => {});
        },
        save: async (input, prompt) => thenSync(await vault.save(input, prompt)),
        remove: async (id) => thenSync(await vault.remove(id)),
        commitImport: async (choices, prompt) => thenSync(await vault.commitImport(choices, prompt)),
      },
      profile,
      // SL-36: a login's approval is the Keystore signature (SL-37); without the approval key, logins are refused.
      forms: createFormFill({ ...deps, ...(approvalKey ? { signed: approvalKey.signedApprovals() } : {}) }),
    };
  })();

  // SL-53: web tasks. The reader and the one-step repair are their own model calls with no skills, memory or history, made
  // from HM-WEB-02 while the user watches: the user's in the queue.
  const webTasks: WebTasks | undefined = ports.browser
    ? createWebTasks({
        sql,
        audit,
        approvals: ports.approvals,
        now: ports.now,
        newId: ports.newId,
        settings,
        copy: (key, vars) => ports.browser!.copy(ports.language(), key, vars),
        requester: ports.browser.requester,
        onScreen: () => ports.browser!.onScreen(),
        ...(ports.browser.codes?.length ? { codes: ports.browser.codes } : {}),
        read: async ({ question, text }) => {
          const r = await quarantinedRead(engineAt("user"), profile, { question, untrusted: text, source: "web_read", language: ports.language(), kind: "page" });
          return r ? { answer: r.answer, quotes: r.quotes } : undefined;
        },
        repair: (input) => repairWebStep(engineAt("user"), profile, input),
        ...(approvalKey ? { signed: approvalKey.signedApprovals() } : {}),
        ...(ports.vault ? { vault: { key: ports.vault.key, cipher: ports.vault.cipher } } : {}),
      })
    : undefined;

  /**
   * HM-MAIL-04's Send (SL-49): the same steps as a chat turn's call, logged the same way (proposed, decided, approval,
   * executed), with nothing a model wrote in reach: the user's own screen built the arguments. A fresh attended session
   * carries the draft's taint, so the sheet warns as it would have in the session that wrote it. Only mail_send and
   * mail_reply, and only from the mail skills the app wired; a send always asks with the fingerprint.
   */
  const mailSend = async (call: MailSendCall): Promise<MailSendOutcome> => {
    const runtime = (ports.mail ?? []).find((s) => s.def.id === call.skill);
    if ((call.skill !== "mail_send" && call.skill !== "mail_reply") || !runtime || !ports.mailRender) return "unavailable";
    const now = ports.now();
    const session: SessionState = { id: `screen-${ports.newId()}`, taint: call.taint ? [{ kind: call.taint, ref: "mail_draft", at: now }] : [], unattended: false };
    const args = { ...call.args };
    const hash = argsHash(args);
    const toolCall = { id: ports.newId(), skill: skillId(call.skill), args, argsHash: hash, repairs: [] };
    const log = (input: Omit<Parameters<typeof audit.append>[0], "ts" | "sessionId" | "skill" | "argsHash">) =>
      audit.append({ ts: ports.now(), sessionId: session.id, skill: call.skill, argsHash: hash, ...input });
    await log({ event: "call_proposed" });
    const decision = decide(toolCall, runtime.def.risk, session, defaultRules());
    await log({ event: "policy_decided", decision: decision.effect });
    if (decision.effect === "deny") return "blocked";
    const summary = runtime.def.describeAction(args, { conversation: () => undefined, mail: await ports.mailRender() });
    if (summary.unresolved) {
      await log({ event: "approval", outcome: "denied" });
      return "unavailable";
    }
    const request: ApprovalRequest = {
      id: toolCall.id,
      call: { id: toolCall.id, skill: toolCall.skill, argsHash: hash },
      summary,
      // A send always needs the fingerprint (FR-CAGE-02), whatever the rule said.
      requireBiometric: true,
      ...(call.taint ? { taintWarning: SCREEN_TAINT_WARNING[call.taint] ?? SCREEN_TAINT_WARNING.inbound_message!, taintKind: call.taint } : {}),
      expiresAt: now + SCREEN_APPROVAL_MS,
    };
    await events.record({ name: "EVT-APPR-01", sessionId: session.id, props: { skill: call.skill, biometric: true, tainted: Boolean(call.taint) } });
    let timer: ReturnType<typeof setTimeout> | undefined;
    const expired = new Promise<ApprovalOutcome>((resolve) => {
      timer = setTimeout(() => resolve({ kind: "expired" }), SCREEN_APPROVAL_MS);
    });
    const outcome = await Promise.race([
      Promise.resolve().then(() => ports.approvals.request(request)).catch((): ApprovalOutcome => ({ kind: "denied", reason: "approval failed" })),
      expired,
    ]).finally(() => clearTimeout(timer));
    await events.record({ name: "EVT-APPR-02", sessionId: session.id, props: { skill: call.skill, outcome: outcome.kind } });
    const approved = outcome.kind === "approved" && outcome.argsHash === hash && outcome.biometric && (ports.verifyApproval ? ports.verifyApproval(request, outcome) : true);
    await log({ event: "approval", outcome: approved ? "ok" : outcome.kind === "expired" ? "expired" : "denied" });
    if (!approved) return "declined";
    let ok: boolean;
    try {
      ok = (await runtime.execute(args, { session, approvedArgsHash: hash, ...(summary.binding ? { approvedBinding: summary.binding } : {}) })).ok;
    } catch {
      ok = false;
    }
    await log({ event: "executed", outcome: ok ? "ok" : "error" });
    return ok ? "sent" : "failed";
  };

  const api: Hermit = {
    messages,
    bots: botsApi.bots,
    modes: botsApi.modes,
    async init() {
      await migrate(sql);
      // The autofill service's index follows the profile, also after an erase or an update (best effort).
      await vaultServices.profile?.sync().catch(() => {});
      await syncLogins().catch(() => {});
    },
    async startSession(opts = {}) {
      const botId = opts.botId ?? HERMIT_BOT_ID;
      if (clearing.has(botId)) throw new ClearingError();
      // Only for a bot that exists (Hermit's row is the migration's own): a session of no bot could never run a turn.
      if (botId !== HERMIT_BOT_ID && !(await store.get(botId))) throw new Error(`No bot ${botId}.`);
      const id = ports.newId();
      await sessions.start({ id, attended: opts.attended ?? true, botId });
      botOf.set(id, botId);
      warm(botId);
      return id;
    },
    async resumeSession(botId = HERMIT_BOT_ID) {
      if (clearing.has(botId)) throw new ClearingError();
      const last = await sessions.latest(botId);
      if (!last) return api.startSession({ botId });
      botOf.set(last, botId);
      warm(botId);
      return last;
    },
    newChat: (botId) => api.startSession({ botId }),
    async transcript(sessionId) {
      const session = await sessions.load(sessionId);
      // A chat opened from its bot's older chats is handed out here: its turns are marked running from their first moment.
      if (session) botOf.set(sessionId, session.botId ?? HERMIT_BOT_ID);
      return { entries: await sessions.transcript(sessionId), tainted: (session?.taint.length ?? 0) > 0 };
    },
    async clearConversation(botId = HERMIT_BOT_ID) {
      // F-M14: while a turn of that bot runs nothing is cleared, so its late writes never land in a chat that is gone.
      const runningIn = running.get(botId)?.at(-1);
      if (runningIn !== undefined) return runningIn;
      clearing.add(botId);
      try {
        await sessions.clear(botId);
      } finally {
        clearing.delete(botId);
      }
      return api.startSession({ botId });
    },
    memories: {
      list: (opts) => memory.list(opts),
      get: (id) => memory.get(id),
      async delete(sessionId, id) {
        // The user's own tap and confirmation stand in for the cage's approval; the log gets the same
        // metadata-only entries a forget call leaves (FR-ACT-02): the skill and a hash, never the fact.
        if (!(await memory.delete(id))) return false;
        const hash = argsHash({ id });
        await audit.append({ ts: ports.now(), sessionId, event: "call_proposed", skill: "forget", argsHash: hash });
        await audit.append({ ts: ports.now(), sessionId, event: "executed", skill: "forget", argsHash: hash, outcome: "ok" });
        return true;
      },
    },
    // The user's own turn, run as the session's bot (spec 6.6): its values are this turn's, built for that bot.
    send: async (sessionId, text, live = {}) => {
      try {
        return await inTurn(sessionId, "user", async (session, botId) => {
      const turn = await turnFor(botId);
      // Security review 00:40: what the prompt's notes were read from, this session has read too, before any model call.
      addReads(session, turn.profileReads);
      const history = await sessions.history(sessionId, HISTORY_TURNS);
      const before = history.length;
      const taintBefore = session.taint.length;
      // Every call of this turn waits in the queue as the user's, its readers' too.
      const engine = engineAt("user");
      // Spec 6.4: the bot uses only what it holds, by a skill's group or, for a connector's or a server's, by its source.
      const held = (def: SkillDef, source?: string) => holds(turn.cage, { group: def.group, source });

      const started = ports.now();
      let firstActionAt: number | undefined;
      const approvalsSeen: Array<{ outcome: ApprovalOutcome["kind"] }> = [];
      const { signal } = live;
      // Once stopped, nothing more reaches the screen (an engine may still flush a token or two).
      const open = () => !signal?.aborted;
      // Q155: the words on screen since the model began an answer with no tools in reach ("words" step), and only
      // then: a stop keeps them as the reply. A preface the pick streamed before a tool call is never kept.
      let wordsOnly = false;
      let onScreen = "";
      const approvals: ApprovalPort = {
        async request(req, stop) {
          await events.record({ name: "EVT-APPR-01", sessionId, props: { skill: req.call.skill, biometric: req.requireBiometric, tainted: Boolean(req.taintWarning) } });
          const out = await (stop ? ports.approvals.request(req, stop) : ports.approvals.request(req));
          approvalsSeen.push({ outcome: out.kind });
          await events.record({ name: "EVT-APPR-02", sessionId, props: { skill: req.call.skill, outcome: out.kind } });
          return out;
        },
      };

      let pageThisTurn: WebPage | undefined;
      let connectThisTurn: { request: string; offerId: string } | undefined;
      // Task 12: the card Hermit's create_bot offered this turn, for the reply's view.
      let proposalThisTurn: BotProposalView | undefined;
      const provider = ports.web ? searchProvider(await settings.get("search.provider")) : undefined;
      const known = approvedDomains.get(sessionId);
      if (known) session.approvedDomains = [...known];
      const knownProviders = approvedSearchProviders.get(sessionId);
      if (knownProviders) session.approvedSearchProviders = [...knownProviders];
      // PDR-028: names are looked up only for a bot that holds the contacts. Its menu holds only what it may use, so a
      // name is never looked up for a skill the cage would deny.
      const peopleDeps = holds(turn.cage, { group: "contacts" }) ? people() : undefined;
      // SL-54 and SL-55: the MCP tools and installed connector operations for this turn, routed together by the user's
      // words and capped together, so the menu stays small whatever is installed; only those the bot holds, capped after.
      const extra = await extraForTurn(text, held);
      const mcpSkills = extra.flatMap((x) => (x.mcp ? [x.mcp] : []));
      const connSkills = extra.flatMap((x) => (x.connector ? [x.connector] : []));
      // SL-53: the saved recipes the user's words name (at most two), each offering HM-WEB-02's plan. Only here, in the
      // chat's own turns: the night shift and its suggestions never get one.
      let webThisTurn: WebOffer | undefined;
      const taken = new Set<string>([...menu, ...extra.map((x) => (x.mcp ?? x.connector)!.def)].map((d) => d.id as string));
      const recipeSkills = webTasks ? (await webTasks.turnSkills(text, (o) => (webThisTurn = o))).filter((r) => !taken.has(r.def.id) && held(r.def)) : [];
      const result = await runTurn({ session, messages: history }, text, {
        model: portFor(turn, engine, [...extra.map((x) => (x.mcp ?? x.connector)!.def), ...recipeSkills.map((r) => r.def)]),
        skills: [
          ...skills({ engine, notes: memory.forBot(botId), ...(signal ? { signal } : {}), onPage: (p) => (pageThisTurn = p), provider, onConnect: (r) => (connectThisTurn = { request: r, offerId: connectors!.offer(r) }), onBotProposal: (v) => (proposalThisTurn = v) }),
          ...mcpRuntimes(mcpSkills, { engine, language: webLanguage(text), ...(signal ? { signal } : {}) }),
          ...connectorRuntimes(connSkills),
          ...recipeSkills,
          ...(payments ? [await payments.runtime()] : []),
          ...merchantTurn({ engine, ...(signal ? { signal } : {}), onPage: (p) => (pageThisTurn = p) }),
        ].filter((r) => held(r.def, r.source)),
        // The bot's grants, sources and mode settle every decision, and its cache key goes with every call (spec 6.4, 6.6).
        bot: turn.cage,
        prefixCacheKey: turn.cacheKey,
        rules: payments ? withPay(defaultRules()) : defaultRules(),
        approvals,
        audit,
        render: async () => {
          const base = await messages.renderContext();
          const withSearch = provider ? { ...base, search: { label: provider.label, base: provider.base, domain: provider.domain } } : base;
          return ports.mailRender ? { ...withSearch, mail: await ports.mailRender() } : withSearch;
        },
        now: ports.now,
        timeZone: ports.timeZone(),
        newId: ports.newId,
        ...(ports.verifyApproval ? { verifyApproval: ports.verifyApproval } : {}),
        // SL-37: only here, in the chat's own turns. The night shift and its morning suggestions get no signer, so a
        // payment or a password can never be approved there.
        ...(approvalKey ? { signedApprovals: approvalKey.signedApprovals() } : {}),
        ...(peopleDeps ? { people: peopleDeps } : {}),
        onToken: (t) => {
          if (!open()) return;
          onScreen += t;
          live.onToken?.(t);
        },
        onThinking: (t) => open() && live.onThinking?.(t),
        onEvent: (e) => {
          if (firstActionAt === undefined && (e.kind === "picked" || e.kind === "repair_failed")) firstActionAt = ports.now();
          // The chat drops a streamed bubble when a skill is picked; a new answer starts from nothing.
          if (e.kind === "picked" || e.kind === "words") onScreen = "";
          if (e.kind === "picked") wordsOnly = false;
          if (e.kind === "words") wordsOnly = true;
          live.onEvent?.(e);
        },
        ...(signal ? { signal } : {}),
      });

      if (session.approvedDomains?.length) approvedDomains.set(sessionId, session.approvedDomains);
      if (session.approvedSearchProviders?.length) approvedSearchProviders.set(sessionId, session.approvedSearchProviders);
      // Persist what this turn added, keeping the untrusted flags (US-CHAT-07, CT-09). The answer the chat
      // shows is marked, so a restart shows it again without the tool calls around it.
      const added = result.messages.slice(before);
      // Q155: stopped while writing words that can't act, with nothing changed: what was on screen stays as the reply,
      // marked stopped (Seguir can go on), in place of the note that nothing was done. It ends the way a cut reply does,
      // at its last whole line, sentence or word: a stop can fall inside a word (review 2026-11-25).
      const kept = result.kind === "stopped" && !result.afterAction && wordsOnly ? endAtBoundary(onScreen.replace(/^\s+/, "")) : "";
      if (kept && added.at(-1)?.content === STOPPED_NOTE) added[added.length - 1] = { role: "assistant", content: kept };
      const shown = result.kind === "final" ? { kind: result.cut ? ("cut" as const) : ("reply" as const), text: result.text }
        : result.kind === "needs_user" ? { kind: "question" as const, text: result.question }
        : kept ? { kind: "stopped" as const, text: kept }
        : undefined;
      let shownAt = -1;
      for (const [i, m] of added.entries()) if (shown && m.role === "assistant" && m.content === shown.text) shownAt = i;
      for (const [i, m] of added.entries()) {
        await sessions.addTurn(sessionId, { role: m.role, text: m.content, untrusted: m.untrusted ?? false, ...(i === shownAt ? { outcome: shown!.kind } : {}) });
      }
      for (const t of session.taint.slice(taintBefore)) await sessions.markTainted(sessionId, t);
      for (const e of result.events) {
        if (e.kind === "blocked") await events.record({ name: "EVT-CAGE-01", sessionId, props: { skill: e.skill } });
      }

      // The contacts permission is offered once, the first time a name couldn't be looked up; never again (no nagging).
      const offer = (result.kind === "final" || result.kind === "needs_user") && result.offer && !(await settings.get("contacts.offered"));
      if (offer) await settings.set("contacts.offered", "1");
      const offered = offer ? { offer: "contacts" as const } : {};
      // SL-48, SL-49: the last mail list, search or draft that ran this turn names the screen the answer links to.
      const mailRan = [...result.events].reverse().find((e): e is Extract<StepEvent, { kind: "executed" }> => e.kind === "executed" && e.ok && Object.hasOwn(MAIL_SCREENS, e.skill));
      const mailLink = mailRan ? { mail: MAIL_SCREENS[mailRan.skill]! } : {};
      const base: TurnView =
        result.kind === "final" ? { kind: "reply", text: result.text, ...(result.receipt ? { receipt: result.receipt } : {}), ...(pageThisTurn ? { page: { id: pageThisTurn.id, title: pageThisTurn.title, domain: pageThisTurn.domain } } : {}), ...(connectThisTurn ? { connect: connectThisTurn } : {}), ...(webThisTurn ? { webTask: webThisTurn } : {}), ...(proposalThisTurn ? { botProposal: proposalThisTurn } : {}), ...mailLink, ...offered, ...(result.cut ? { cut: true as const } : {}) }
        : result.kind === "needs_user" ? { kind: "question", text: result.question, ...(result.choices?.length ? { choices: result.choices } : {}), ...offered }
        : kept ? { kind: "reply", text: kept, cut: true, stopped: true }
        : result.kind === "stopped" ? { kind: "outcome", outcome: "stopped", ...(result.afterAction ? { afterAction: true as const } : {}) }
        : { kind: "outcome", outcome: result.code };
      const view: TurnView = session.taint.length ? { ...base, tainted: true } : base;
      const done = ports.now();
      await events.record({
        name: "EVT-MODEL-01",
        sessionId,
        props: {
          profile: profileIdCode(profile.id),
          outcome: view.kind === "outcome" ? view.outcome : view.kind,
          ...(view.kind === "reply" && view.cut ? { cut: true } : {}),
          totalMs: done - started,
          ...(firstActionAt !== undefined ? { firstActionMs: firstActionAt - started } : {}),
          steps: result.events.filter((e) => e.kind === "executed").length,
          approvals: approvalsSeen.length,
        },
      });
      return view;
    });
      } catch (err) {
        if (err instanceof ClearingError) return { kind: "reply", text: clearingReply() };
        throw err;
      }
    },
    // Seguir, a reply the user is waiting for: it holds that priority, as the session's bot, with the bot's cache key (a
    // long reply's Seguir reads under the bot's own long key).
    continueReply: (sessionId, live = {}) => inTurn(sessionId, "reply", async (session, botId) => {
      // Seguir is the user's tap in the chat: never a night run, a briefing or anything else without them.
      if (session.unattended) throw new Error("Seguir runs only in the chat's own attended sessions.");
      const last = await sessions.lastReply(sessionId);
      const turn = last?.cut ? await turnFor(botId) : undefined;
      const model = turn ? portFor(turn, engineAt("reply")) : undefined;
      if (!last?.cut || !turn || !model?.continueReply) throw new Error("Nothing to continue: the latest turn isn't a reply that stopped short.");
      // Security review 00:40: the reply prompt holds the bot's notes too.
      addReads(session, turn.profileReads);
      const history = await sessions.history(sessionId, HISTORY_TURNS);
      const { signal } = live;
      let shown = "";
      const tainted = session.taint.length > 0 ? { tainted: true as const } : {};
      try {
        // Words only: the model with no tools offered, so nothing it writes is a call and the cage decides nothing.
        const next = await model.continueReply({ prefixCacheKey: turn.cacheKey, messages: history, ...(signal ? { signal } : {}) }, (t) => {
          if (signal?.aborted) return;
          shown += t;
          live.onToken?.(t);
        });
        if (signal?.aborted) throw new Error("Stopped by the user.");
        // Nothing new (only what the reply already says, or nothing usable): the reply is whole as it is. Code says so,
        // and Seguir is not offered again, so it is never a silent end nor an endless tap (review 2026-11-25).
        if (!next.text.trim()) {
          await sessions.extendReply(sessionId, last.id, last.text, "reply");
          return { kind: "reply", text: last.text, nothingMore: true, ...tainted };
        }
        const text = `${last.text}${next.text}`;
        const outcome = next.cut ? "cut" : "reply";
        await sessions.extendReply(sessionId, last.id, text, outcome);
        return { kind: "reply", text, ...(next.cut ? { cut: true as const } : {}), ...tainted };
      } catch {
        // Stopped: what was already shown stays, still short of its end, at its last whole line, sentence or word (a
        // stop can fall inside a word). Anything else changes nothing.
        if (!signal?.aborted) return { kind: "outcome", outcome: "model_error", ...tainted };
        const text = `${last.text}${endAtBoundary(shown)}`.trimEnd();
        await sessions.extendReply(sessionId, last.id, text, "stopped");
        return { kind: "reply", text, cut: true, stopped: true, ...tainted };
      }
    }),
    settings,
    relay,
    ...(ports.mail?.length && ports.mailRender ? { mailSend } : {}),
    reminders: {
      upcoming: () => reminders().pending(),
      async cancel(id) {
        // A tap on HM-REM-01 is a call the user made by hand: a fresh, attended, untainted session, the same
        // skill name and rules as the chat, and the same audit sequence (proposed, decided, executed).
        const session = { id: `screen-${ports.newId()}`, taint: [], unattended: false };
        const args = { id };
        const call = { id: ports.newId(), skill: CANCEL, args, argsHash: argsHash(args), repairs: [] };
        const log = (input: Omit<Parameters<typeof audit.append>[0], "ts" | "sessionId" | "skill" | "argsHash">) =>
          audit.append({ ts: ports.now(), sessionId: session.id, skill: CANCEL, argsHash: call.argsHash, ...input });
        await log({ event: "call_proposed" });
        const decision = decide(call, CANCEL_RISK, session, defaultRules());
        await log({ event: "policy_decided", decision: decision.effect });
        // The tap is the user's own request; a rule that asks or blocks still stops it here (never bypassed).
        if (decision.effect !== "allow") return "blocked";
        try {
          await reminders().cancel(id);
        } catch (err) {
          await log({ event: "executed", outcome: "error" });
          if (err instanceof ReminderError && (err.code === "not_found" || err.code === "bad_transition")) return "gone";
          throw err;
        }
        await log({ event: "executed", outcome: "ok" });
        return "cancelled";
      },
    },
    calendars: {
      async choice() {
        return calendarChoice(await ports.calendar.calendars(), await settings.get("calendar.id"));
      },
      async choose(id) {
        const { options } = calendarChoice(await ports.calendar.calendars());
        if (!options.some((c) => c.id === id)) throw new Error(`Calendar ${id} isn't a writable calendar on this phone.`);
        await settings.set("calendar.id", id);
      },
    },
    hosts: {
      async record(url) {
        await hostCounter.record(url);
      },
      list: () => hostCounter.list(),
    },
    async lastTurn() {
      const [e] = await events.list({ name: "EVT-MODEL-01", limit: 1 });
      if (!e) return undefined;
      const num = (v: unknown) => (typeof v === "number" ? v : undefined);
      const firstActionMs = num(e.props.firstActionMs);
      const totalMs = num(e.props.totalMs);
      return { profile: String(e.props.profile), ...(firstActionMs !== undefined ? { firstActionMs } : {}), ...(totalMs !== undefined ? { totalMs } : {}) };
    },
    page(id) {
      return pages.find((p) => p.id === id);
    },
    async activity() {
      const entries = await audit.entries();
      // Multi-bot: a step a bot's turn ran, or a change to a bot, shows that bot's name; the log holds only its id, so the
      // name is read now.
      const names = new Map((await store.list()).map((b) => [b.id, b.name]));
      const rows = activityRows(entries).map((r): ActivityRowView => {
        const botName = r.bot !== undefined ? names.get(r.bot) : undefined;
        return botName !== undefined ? { ...r, botName } : r;
      });
      return { rows, chain: chainView(entries, await audit.verify(await ports.signer.publicKey())) };
    },
    async activityEntry(seq) {
      return activityDetail(await audit.entries(), seq);
    },
    night: {
      async settings() {
        return parseNightSettings(await settings.get("night.settings"));
      },
      async saveSettings(s) {
        const problems = validateNightSettings(s);
        if (!problems.length) await settings.set("night.settings", JSON.stringify(s));
        return problems;
      },
      async run(opts) {
        // Q69: one run at a time across the headless task, the in-app timer and "run now". Busy means nothing to do.
        if (opts.aborted?.()) return undefined;
        const owner = `run-${ports.newId()}`;
        if (!(await nightLock.acquire(owner, ports.now()))) return undefined;
        try {
          return await runNightOnce(opts, owner);
        } catch (err) {
          // SL-26: the erase began. Nothing more is written; it clears the lock row with everything else.
          if (err instanceof NightAborted) return undefined;
          throw err;
        } finally {
          if (!opts.aborted?.()) await nightLock.release(owner);
        }
      },
      briefing: () => briefings.latest(),
      act(briefingId, suggestionId) {
        const mail = ports.mailNight;
        return actOnSuggestion({
          // The user's "Review" tap on a suggestion: no bot (F-M13, its decision is today's), Hermit's notes, and any
          // reader in the queue as the user's.
          skills: skills({ engine: engineAt("user"), notes: memory.forBot(HERMIT_BOT_ID), onPage: () => {}, provider: undefined }),
          audit,
          approvals: ports.approvals,
          render: async () => {
            const base = await messages.renderContext();
            return ports.mailRender ? { ...base, mail: await ports.mailRender() } : base;
          },
          now: ports.now,
          newId: ports.newId,
          ...(ports.verifyApproval ? { verifyApproval: ports.verifyApproval } : {}),
          ...(mail ? { restore: (_skill: string, args: Record<string, unknown>, snapshot: unknown) => {
            const ref = mail.restore(snapshot);
            return ref ? { ...args, messageId: ref } : undefined;
          } } : {}),
        }, briefings, briefingId, suggestionId);
      },
    },
    async clearActivity() {
      if (!(await audit.verify(await ports.signer.publicKey())).ok) return { kind: "refused_broken" };
      const genesis = await audit.clear({ ts: ports.now(), sessionId: CLEAR_SESSION });
      return { kind: "cleared", count: genesis.clearedCount ?? 0 };
    },
    // SL-33 and SL-35: the vault, the profile inside it and form filling, over the same database and signed log. They
    // add no skill and nothing to the menu, so the model sees nothing of them (FR-VAULT-02).
    ...vaultServices,
    // SL-38: the wallet, for its screens only. It adds no skill, and the night shift never gets it (FR-PAY-01).
    // SL-39 with SL-40: HM-PAY-03 names a known address with the payee the user saved on HM-PAY-05.
    ...(ports.wallet ? { wallet: createWallet({ payees: () => readPayees(sql), ...ports.wallet, audit, now: ports.now, newId: ports.newId }) } : {}),
    ...(payments ? { payments: { caps: payments.caps, setCaps: payments.setCaps, payees: payments.payees, savePayee: payments.savePayee, removePayee: payments.removePayee } } : {}),
    // SL-54: HM-CONN-03 only. The model's menu gets the approved, enabled tools per turn (send), never these.
    ...(mcpServers
      ? {
          mcp: {
            begin: (input) => mcpServers.begin(input),
            finishSignIn: (draftId, callbackUrl) => mcpServers.finishSignIn(draftId, callbackUrl),
            approve: (draftId, choice) => mcpServers.approve(draftId, choice),
            cancel: (draftId) => mcpServers.cancel(draftId),
            list: () => mcpServers.list(),
            setTool: (serverId, name, change) => mcpServers.setTool(serverId, name, change),
            reapprove: (serverId, name) => mcpServers.reapprove(serverId, name),
            remove: (serverId) => mcpServers.remove(serverId),
          } satisfies NonNullable<Hermit["mcp"]>,
        }
      : {}),
    ...(approvalKey ? { approvalKey } : {}),
    // SL-53: HM-WEB-02 only. The model's menu gets the recipes the user's words name (send), never these.
    ...(webTasks
      ? {
          web: {
            recipes: () => webTasks.recipes(),
            claim: (offerId) => webTasks.claim(offerId),
            task: (recipe, browser) => webTasks.task(recipe, browser),
            record: (url) => webTasks.record(url),
            save: (input) => webTasks.save(input),
            saveFix: (recipe) => webTasks.saveFix(recipe),
            remove: (id) => webTasks.remove(id),
            keptSites: () => webTasks.keptSites(),
            keepSignedIn: (origin, keep) => webTasks.keepSignedIn(origin, keep),
            cleared: (origin) => webTasks.cleared(origin),
            loginsFor: (origin) => webTasks.loginsFor(origin),
            chooseLogin: (origin, hash) => webTasks.chooseLogin(origin, hash),
          } satisfies NonNullable<Hermit["web"]>,
        }
      : {}),
    // SL-55: HM-CONN-04 only. The model's menu gets the installed, enabled operations per turn (send), never these.
    ...(connectors
      ? {
          connect: {
            start: (input) => connectors.start(input),
            setSignIn: (draftId, reading) => connectors.setSignIn(draftId, reading),
            saveKey: (draftId, secret) => connectors.saveKey(draftId, secret),
            testCall: (draftId, operation) => connectors.testCall(draftId, operation),
            install: (draftId, choice) => connectors.install(draftId, choice),
            cancel: (draftId) => connectors.cancel(draftId),
            list: () => connectors.list(),
            setOperation: (id, name, enabled) => connectors.setOperation(id, name, enabled),
            remove: (id) => connectors.remove(id),
          } satisfies NonNullable<Hermit["connect"]>,
        }
      : {}),
  };
  return api;
}

/** Event props are codes; profile ids already are. */
const profileIdCode = (id: string) => id.slice(0, 64);
