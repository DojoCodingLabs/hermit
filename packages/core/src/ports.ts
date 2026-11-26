import type { ApprovalSummary, JsonSchema, Msg, SkillId, TaintSource, ToolCall } from "./types.ts";
import type { PhoneCalendar } from "./calendars.ts";
import type { SignedApprovalRequest } from "./approval-key.ts";
import type { LiveElement, Target } from "./web-task.ts";
import type { SignInFacts } from "./web-login.ts";

/** The local model. Implemented by QVAC on the phone and in the eval harness. */
/**
 * Live progress during a pick (Q36): the routed skill as soon as it is known, the model's reasoning for the
 * collapsible "Pensando" panel, and answer tokens as they are written.
 */
export interface PickLive {
  onIntent?(skill: string): void;
  onThinking?(text: string): void;
  onToken?(text: string): void;
  /** Q155: the answer being written now is words only (no tools offered), so nothing it writes can act. */
  onWords?(): void;
}

/**
 * The stop switch of a turn (US-CHAT-06): the part of AbortSignal Hermit uses, so pure packages need no DOM or
 * Node types. Pass an AbortController's signal.
 */
export interface StopSignal {
  readonly aborted: boolean;
  addEventListener(type: "abort", listener: () => void, options?: { once?: boolean }): void;
  removeEventListener(type: "abort", listener: () => void): void;
}

/**
 * Q155: words the model wrote for the user. `cut`: it used up its tokens before its own end, so the chat says so and
 * offers Seguir instead of showing it as finished.
 */
export interface ReplyText {
  text: string;
  cut?: boolean;
}

export interface ModelPort {
  /** `signal` stops the turn (FR-LOOP-06): the engine cancels its run and the call rejects. */
  pick(input: { prefixCacheKey: string; messages: Msg[]; menu: SkillId[]; live?: PickLive; signal?: StopSignal }): Promise<{
    choice: SkillId | "respond" | "ask_user";
    /** The answer text already reached the screen through live.onToken. */
    streamed?: boolean;
    /** ask_user: the question. respond: a finished answer, used as the reply (no second generation). */
    text?: string;
    /** The answer carries text other people wrote (a catch-up list, a quarantined summary): kept marked in the history. */
    untrusted?: boolean;
    /** respond with text (Q155): the answer used up its tokens before its own end. */
    cut?: boolean;
  }>;
  fill(input: { prefixCacheKey: string; messages: Msg[]; skill: SkillId; schema: JsonSchema; signal?: StopSignal }): Promise<{
    rawText: string;
    args: unknown;
  }>;
  /** A plain string is a finished reply; a ReplyText can say it was cut (Q155). */
  respond(input: { prefixCacheKey: string; messages: Msg[]; signal?: StopSignal }, onToken: (token: string) => void): Promise<string | ReplyText>;
  /**
   * Q155, the chat's Seguir: the next part of a reply that stopped short. `messages` is the conversation ending with
   * that reply (the last message, from the assistant). Words only: no tools are offered and nothing it writes is a
   * call, so the cage has nothing to decide. Returns only the new part, ready to append (it starts with its own
   * separator), and `cut` when it stopped short too. Optional: without it the chat offers no Seguir.
   */
  continueReply?(input: { prefixCacheKey: string; messages: Msg[]; signal?: StopSignal }, onToken: (token: string) => void): Promise<ReplyText>;
  /**
   * Read the fixed part of the prompt (system prompt and tools) ahead of the user's first message, so the
   * turn only reads what is new. Optional: a no-op where the runtime can't keep it.
   */
  warm?(input: { prefixCacheKey: string }): Promise<void>;
}

/** SQLite: op-sqlite on the phone, node:sqlite in tests and the eval. */
export interface SqlPort {
  exec(sql: string, params?: unknown[]): Promise<void>;
  query<T>(sql: string, params?: unknown[]): Promise<T[]>;
  transaction<T>(fn: (tx: SqlPort) => Promise<T>): Promise<T>;
}

/** Device signing key for the audit log. */
export interface SignerPort {
  publicKey(): Promise<Uint8Array>;
  sign(message: Uint8Array): Promise<Uint8Array>;
}

export interface ApprovalRequest {
  id: string;
  call: Pick<ToolCall, "id" | "skill" | "argsHash">;
  summary: ApprovalSummary;
  requireBiometric: boolean;
  /** Shown when the session is tainted, e.g. "Suggested after reading a message from Ana". */
  taintWarning?: string;
  /**
   * What kind of content the session read, set with the warning when it is known. The sheet words the warning from
   * it in the user's language ("Suggested after reading messages"); it never shows the id of the skill that read it.
   */
  taintKind?: TaintSource["kind"];
  /**
   * Q149: the user's own message of the turn that asked, verbatim, set by the loop from the turn's input, never from
   * the model or a tool. The sheet quotes it under "You said". Absent when no user turn asked (night shift, web tasks).
   */
  said?: string;
  expiresAt: number;
  /**
   * SL-37 (FR-CAGE-06): set for spend and credential. The sheet must have the Keystore key sign `message` inside the
   * biometric prompt and return the signature; an approval without it (the JS proof path) is a denial.
   */
  signed?: SignedApprovalRequest;
}

export type ApprovalOutcome =
  /** `signature`: the Keystore key's ECDSA P-256 signature (DER, hex) over `signed.message`, when the request had one. */
  | { kind: "approved"; biometric: boolean; argsHash: string; proof?: string; signature?: string }
  | { kind: "denied"; reason?: string }
  | { kind: "expired" };

/** The approval sheet. Times out to "expired", which counts as deny. A stopped turn aborts `signal`: the sheet closes as denied. */
export interface ApprovalPort {
  request(req: ApprovalRequest, signal?: StopSignal): Promise<ApprovalOutcome>;
}

/** Local notifications (exact alarms on the phone, a fake in tests). Returns the platform's notification id. */
export interface NotifierPort {
  schedule(input: { id: string; at: number; title: string }): Promise<string>;
  cancel(notificationId: string): Promise<void>;
}

/** Fires the stored RemoteInput reply action of a WhatsApp notification (FR-MSG-04). */
export interface ReplySenderPort {
  send(replyHandle: string, text: string): Promise<"sent" | "stale">;
}

export interface CalendarEvent {
  title: string;
  start: number;
  end: number;
  calendar?: string;
  /**
   * An all-day event: its days are dates, not instants. Android keeps them at UTC midnight (`allDayDates` reads them
   * so), which read in the phone's zone would start the evening before (W1).
   */
  allDay?: boolean;
}

/** The platform calendar provider (FR-CAL-01). Instants are epoch ms. */
export interface CalendarPort {
  list(from: number, to: number): Promise<CalendarEvent[]>;
  /** `calendarId` is the user's choice (US-CAL-03); the adapter resolves it with `writeTarget`. */
  add(event: CalendarEvent, opts?: { calendarId?: string }): Promise<void>;
  /** The phone's calendars, for HM-CAL-02. */
  calendars(): Promise<PhoneCalendar[]>;
}

/** The kind of secret a connector account holds (FR-CONN-03). */
export type CredentialKind = "oauth2" | "api_key" | "basic";

/**
 * How a credential was obtained (HM-CONN-05): Dojo's client, the user's own client ID, a client the phone
 * registered itself with an MCP server (RFC 7591, SL-51), a relay, or typed in.
 */
export type CredentialSource = "dojo_client" | "own_client" | "dynamic_client" | "own_relay" | "dojo_relay" | "user_entered";

/**
 * What the Connections screen may show about an account (US-CONN-02). Never holds a secret, so it can be
 * listed, rendered and logged.
 */
export interface CredentialMeta {
  id: string;
  connectorId: string;
  kind: CredentialKind;
  source: CredentialSource;
  /** The account as the provider names it ("ana@example.com"), when known. */
  account?: string;
  /** Scopes the provider granted. */
  scopes: string[];
  /** The OAuth client the tokens were issued to: needed to refresh them (PDR-021). */
  clientId?: string;
  createdAt: number;
  lastUsedAt?: number;
  /** When the access token stops working, epoch ms. */
  expiresAt?: number;
}

export type CredentialSecret =
  | { kind: "oauth2"; accessToken: string; refreshToken?: string }
  | { kind: "api_key"; key: string }
  | { kind: "basic"; username: string; password: string };

/**
 * Connector tokens, keys and passwords (FR-CONN-03). On the phone: encrypted under an Android Keystore key.
 * Only the connector runtime calls `reveal`, at send time; secrets never reach the model, a log or a skill result.
 */
export interface CredentialStorePort {
  /** Insert or replace. Rejects a secret whose kind differs from the meta's. */
  save(meta: CredentialMeta, secret: CredentialSecret): Promise<void>;
  list(): Promise<CredentialMeta[]>;
  get(id: string): Promise<CredentialMeta | undefined>;
  reveal(id: string): Promise<CredentialSecret | undefined>;
  /** Records the last use for the Connections screen. False when the id is unknown. */
  markUsed(id: string, at: number): Promise<boolean>;
  /** Deletes the meta and the secret. False when the id is unknown. */
  delete(id: string): Promise<boolean>;
}

/**
 * One HTTPS request for read_web (FR-WEB-01), made by the app adapter. It doesn't follow redirects itself where
 * the platform lets it choose (the caller checks every hop's scheme and domain); where the platform followed
 * anyway, `url` is where the page really came from. A body over `maxBytes` is cut, or refused when its declared
 * size is already over.
 */
export interface WebFetchPort {
  /**
   * SL-41: `payment` is the one request header a caller may add, the x402 retry header (`PAYMENT-SIGNATURE` or
   * `X-PAYMENT`) after the user approved; the adapter sends no other.
   */
  get(url: string, limits: { maxBytes: number; timeoutMs: number; payment?: { name: X402HeaderName; value: string } }): Promise<WebHop>;
}

/** SL-41 (FR-PAY-04): the x402 request header names. */
export type X402HeaderName = "PAYMENT-SIGNATURE" | "X-PAYMENT";

/**
 * SL-41: the x402 response headers a page hop reports, lowercase, and nothing else: the merchant's requirements on a
 * 402 (`payment-required`) and its settlement after a paid retry (`payment-response`, `x-payment-response`).
 */
export const X402_RESPONSE_HEADERS = ["payment-required", "payment-response", "x-payment-response"] as const;

export type WebHop =
  /**
   * `redirected`: the platform followed redirects on its own (`redirect: "manual"` not honored). `url` must then be
   * where the page really came from; the caller refuses it unless that address passes every check a hop must pass.
   */
  | {
      kind: "page"; url: string; status: number; contentType: string; body: string; truncated: boolean; redirected?: boolean;
      /**
       * SL-41: only the X402_RESPONSE_HEADERS present, lowercase. On a 402 the body is read whatever its type (an x402
       * v1 merchant sends its requirements as JSON), within the same byte cap.
       */
      x402?: Record<string, string>;
    }
  | { kind: "redirect"; status: number; location: string }
  /** offline: no network; timeout: over timeoutMs; too_large: declared size over maxBytes; failed: anything else. */
  | { kind: "error"; reason: "offline" | "timeout" | "too_large" | "failed" };

/**
 * SL-53 (FR-WEB-05, US-WEB-07, US-WEB-08): the in-app browser a web task drives, implemented by the app's WebView
 * module (one WebView per task, a per-site profile, an injected script that reads the accessibility tree). Code drives
 * it; the model never does. Every page's words come back as data: names, labels and text are the site's own.
 */
export interface BrowserPort {
  /** Loads the address in the task's page and waits for it to load (or a timeout). */
  open(url: string): Promise<BrowserOutcome>;
  /** The main frame's address now, as the WebView reports it (never as the page says). */
  url(): Promise<string>;
  /** The element by role, name and position, waiting up to `timeoutMs` for it to appear. */
  find(target: Target, timeoutMs: number): Promise<LiveElement | undefined>;
  click(target: Target): Promise<BrowserOutcome>;
  fill(target: Target, value: string): Promise<BrowserOutcome>;
  select(target: Target, option: string): Promise<BrowserOutcome>;
  check(target: Target, on: boolean): Promise<BrowserOutcome>;
  /**
   * The vault's username and password into the page's login form. The values never come back and are never logged.
   * `origin` is the exact origin the login belongs to: the page checks it in the same call that fills, and fills
   * nothing (`off_origin`) unless the main frame's document is on it.
   */
  fillLogin(values: { username: string; password: string; origin: string }): Promise<BrowserOutcome>;
  /** FR-WEB-05: the pruned accessibility tree as text, secret values masked, at most about 3,000 characters. */
  snapshot(): Promise<string>;
  /** The page's elements of one role, in page order, for a one-step repair. */
  candidates(role: string): Promise<LiveElement[]>;
  /**
   * SL-56: what the top frame shows after a sign-in click (a password field, one-time code fields, captcha frames),
   * checked by `asSignInFacts`. Undefined when the page's report can't be read: the runner can't tell, the user checks.
   */
  signInFacts(): Promise<SignInFacts | undefined>;
  /**
   * SL-56b (Q138): a one-time code into the one field the runner chose from `signInFacts` (`field`, its index, and
   * `expect`, what the report said about it). The page checks in the same call, right before typing, that the main
   * frame's document is on `origin` (`off_origin` otherwise) and that the field at that index is still exactly that one
   * (`not_found` otherwise); then it submits the field's own form when that form stays on the origin. The code never
   * comes back and is never logged.
   */
  fillCode(input: { code: string; origin: string; field: number; expect: { autocomplete: string; name: string; label: string } }): Promise<BrowserOutcome>;
}

/**
 * SL-56b (Q138): a one-time code a code source found for a task paused at its code step. It lives in memory only:
 * never the model, the database, the chat or a log (they get a salted hash at most).
 * - `sms`: a text message the user allowed in Android's SMS User Consent dialog (no SMS permission).
 * - `email`: a message in a connected mail account, from `sender` on the site's registrable domain. `verified` is the
 *   receiving provider's own verdict from its topmost Authentication-Results header: DMARC pass for the From domain, or
 *   a DKIM pass with `d=` on the site's registrable domain. Missing: not verified, and the runner refuses it (a From
 *   header alone can be forged).
 * `at` is when the message arrived (epoch ms), so the runner can check it came after the sign-in click.
 */
export type FoundCode =
  /**
   * `text` is the message, kept in memory only so the runner can check it names the site (`smsBoundToOrigin`) and the
   * sheet can show it to the user; never to the model or a log. `sender` when the platform gives one (the SMS User
   * Consent API gives only the text: the system dialog the user allowed showed the message).
   */
  | { via: "sms"; code: string; at: number; text: string; sender?: string }
  | { via: "email"; code: string; at: number; sender: string; verified?: "dmarc" | "dkim" };

/** One code source, armed at the sign-in click; nothing is read until `take`, and only for that task's code step. */
export interface CodeWatch {
  /**
   * Waits for one code until `until` (or the signal). `refused`: the user declined Android's dialog. `ambiguous`: more
   * than one message with a code arrived in the window, so none is taken (never the first or the latest). Undefined:
   * none (no message in time, no mail account, no code in the message). Each watch gives at most one code.
   */
  take(input: { until: number; signal: StopSignal }): Promise<FoundCode | "refused" | "ambiguous" | undefined>;
  /** Stops listening and drops anything held. Safe to call more than once. */
  cancel(): void;
}

/** SL-56b: where a web task's code may come from. `since` is the sign-in click; `origin` the task's exact origin. */
export interface OneTimeCodePort {
  arm(input: { origin: string; since: number }): CodeWatch | undefined;
}

/** `changed`: the page or the element's value changed (FR-WEB-06 counts actions that change nothing). */
export type BrowserOutcome = { ok: true; changed: boolean } | { ok: false; reason: "not_found" | "disabled" | "timeout" | "blocked" | "off_origin" | "failed" };
