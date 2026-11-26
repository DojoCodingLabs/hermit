import type {
  ApprovalOutcome, ApprovalPort, ApprovalRequest, ApprovalSummary, ContactsPort, FoundPerson, ModelPort, Msg, RenderContext, SessionState, SignedApprovalPayload, SkillDef,
  SignedApprovalTerms, StopSignal, TaintSource,
} from "@hermit/core";
import type { AuditInput, PolicyRule, SignedApprovals } from "@hermit/cage";

export interface SkillResult {
  ok: boolean;
  /** Short text handed back to the model. */
  modelText: string;
  /** Overrides the skill's own producesUntrusted for this call. */
  untrusted?: boolean;
  /** What kind of outside text this was, for the session's taint record (default inbound_message). */
  taintKind?: TaintSource["kind"];
  /**
   * A question the skill needs answered before it can act ("which of these two reminders?"). The turn ends
   * with it, word for word: the model was left to ask and sometimes answered instead.
   */
  ask?: string;
  /**
   * The answer, written by code from trusted copy (read_web's cited summary, or why a page couldn't be read). The turn
   * ends with it, word for word, kept marked untrusted when the result is; the model writes nothing after it.
   */
  reply?: string;
  /**
   * A6: a payment the network confirmed, as code's own facts (the amount, the payee's saved name or the merchant's
   * host, the transaction). The chat's receipt card is drawn from this alone, never from `reply`, which for a merchant
   * page can carry the quarantined reader's answer.
   */
  receipt?: PaymentReceipt;
  /**
   * W1: the reply code wrote from what the skill really did or found, in the user's language: a confirmation ("Listo.
   * Te aviso mañana, miércoles 25, a las 9:00: «Tomar agua»."), or a listing that quotes what others wrote. Unlike
   * `reply`, the turn may go on (another request in the same message, a reply after a read); the loop hands it to the
   * model port with the result, which answers with it once nothing more is owed. Only on success.
   */
  answer?: string;
  /**
   * W1: what a read found, as code's own values (instants, names, texts), for code that builds on it (the night
   * shift's briefing). modelText's words are for the model and are never parsed back.
   */
  items?: readonly ReadItem[];
}

/** One thing a read found: an event, a message or a reminder. `who` is a sender; `allDay` events' instants are dates. */
export interface ReadItem {
  at: number;
  end?: number;
  allDay?: boolean;
  who?: string;
  text: string;
  /** A message's conversation id, its chat's title when that isn't the sender (a group), and WhatsApp Business. */
  chat?: string;
  conversation?: string;
  business?: true;
}

/** A6: what the chat's receipt card says, written by the payment code from fixed values, never from page text. */
export interface PaymentReceipt {
  kind: "paid";
  amount: string;
  to: string;
  hash?: string;
}

/**
 * SL-40 (FR-PAY-05): what a money skill's code decided before the sheet. `held`: everything checked and the payment
 * reserved; `lines` go on the sheet, and `release` frees the reservation if the call never runs. `refused`: the turn
 * ends with `reply`, words code wrote (a refusal, or a question when `ask`), never the model's.
 */
export type HoldResult =
  | {
      ok: true;
      lines?: ApprovalSummary["lines"];
      release(): Promise<void>;
      /**
       * SL-41: the signed approval's terms when the call's args can't hold them (an x402 purchase's args are the
       * address the user asked for; the amount, the payee and the origin come from the merchant's 402, parsed and
       * checked by code here). The Keystore signs these instead of `def.approvalTerms(args)`.
       */
      terms?: SignedApprovalTerms;
    }
  | { ok: false; code: string; reply: string; ask?: boolean };

export interface SkillRuntime {
  def: SkillDef;
  /**
   * SL-40: money only. Runs after the cage says ask and before the sheet: code checks the asset, the amount and the
   * recipient against the user's own words, the caps and the balance, and reserves the payment (reserve before
   * approve), so two payments waiting on approval can't both pass a cap. The loop releases a hold whose call never
   * runs; once the call runs, the skill owns it.
   */
  hold?(args: Record<string, unknown>, ctx: { session: SessionState; userText: string; requestId: string; argsHash: string }): Promise<HoldResult>;
  /**
   * Where the call goes when its args don't say (search_web: the provider in settings). Set on the call by the
   * loop for the cage; undefined means nowhere usable, so nothing is approved for it.
   */
  destination?(args: Record<string, unknown>): string | undefined;
  execute(args: Record<string, unknown>, ctx: {
    session: SessionState;
    approvedArgsHash?: string;
    approvedBinding?: string;
    /** The user's own words this turn, never tool output. */
    userText?: string;
    /** What destination() gave once for this call, the one the cage decided on. The skill contacts nothing else. */
    destination?: string;
    /** Numbers and addresses code found by name for this call (PDR-028), shown on the sheet the user approved. */
    found?: readonly FoundPerson[];
    /**
     * SL-37: spend and credential only. The Keystore-signed payload the user approved (already verified) and the
     * hash the log keeps. The executor holds itself to it (the amount and recipient it pays are these).
     */
    signedApproval?: { payload: SignedApprovalPayload; payloadHash: string };
  }): Promise<SkillResult>;
}

/**
 * People by name (PDR-028, Q48, Q49). Code resolves a name from the user's words; the model never sees the contacts.
 * Absent: names are never resolved and every skill behaves as before.
 */
export interface PeopleDeps {
  /** The phone's contacts. Absent on a build without the contacts module: nothing is offered either. */
  contacts?: ContactsPort;
  /** Addresses the user sent mail to (the address book's "sent" origin, SL-49), oldest first. */
  pastRecipients?(): Promise<readonly string[]>;
  /** Copy for the questions Hermit asks (`HM-CHAT-01.people.*`), in the language of the user's words this turn. */
  say(key: string, userText: string, vars?: Record<string, string>): string;
}

/** A tappable answer to a question Hermit asked: `text` is sent as the user's own message. */
export interface Choice {
  label: string;
  text: string;
}

export interface AuditSink {
  append(input: AuditInput): Promise<unknown>;
}

export interface LoopDeps {
  model: ModelPort;
  skills: SkillRuntime[];
  rules: PolicyRule[];
  approvals: ApprovalPort;
  audit: AuditSink;
  /** Trusted data for approval sheets. Pass a function to resolve it fresh for every sheet. */
  render: RenderContext | (() => RenderContext | Promise<RenderContext>);
  now(): number;
  /** IANA zone for reading times in the user's words (SkillDef.normalize). Without it, no normalization. */
  timeZone?: string;
  newId(): string;
  /** Skill calls per user turn (spec: 4). */
  maxSteps?: number;
  /** Repair failures before the turn ends (spec: 3). */
  maxStrikes?: number;
  approvalTimeoutMs?: number;
  /** Reply tokens as they stream (US-CHAT-03). Thinking never reaches here. */
  onToken?(token: string): void;
  /** The model's reasoning as it thinks, for the collapsible panel (Q36). Never shown as the answer. */
  onThinking?(text: string): void;
  /** Each step as it happens, for the mascot state and the "working" row (US-CHAT-08). */
  onEvent?(event: StepEvent): void;
  /**
   * Stops the turn (US-CHAT-06, FR-LOOP-06). Generation is aborted, an open approval closes as denied, and
   * nothing more runs; a skill already executing finishes or fails on its own and is audited as it ended.
   */
  signal?: StopSignal;
  /** Checks the approval proof (HMAC from the biometric-gated key). When set, a failing proof is a deny. */
  verifyApproval?(request: ApprovalRequest, outcome: Extract<ApprovalOutcome, { kind: "approved" }>): boolean;
  /**
   * SL-37 (FR-CAGE-06): the Keystore-signed approvals for spend and credential. Without it those calls are blocked
   * (never asked); with it, only a valid signature by the enrolled key over the exact payload approves them, and the
   * JS proof above is not used for them.
   */
  signedApprovals?: SignedApprovals;
  /** Resolving a person the user named to a number or address (PDR-028). Without it, names are never resolved. */
  people?: PeopleDeps;
}

/**
 * SL-37: approval_key_none (never set up), approval_key_lost (retired by a fingerprint change), no_biometric (the
 * phone has no strong biometric), not_usdt (Hermit pays only in USD₮, PDR-027), approval_terms (the skill can't say
 * what the signature would cover).
 */
export type SignedBlockCode = "approval_key_none" | "approval_key_lost" | "no_biometric" | "not_usdt" | "approval_terms";

export type StepEvent =
  | { kind: "intent"; skill: string }
  /**
   * Q155: the model is writing an answer with no tools in reach (the reply prompt, or a pick that offered none), so the
   * words that stream next can't act. The chat may keep them on screen if the user stops the reply.
   */
  | { kind: "words" }
  | { kind: "picked"; skill: string }
  /** `code` (SL-37): why a money or password call couldn't be asked, so the chat can say it and link the fix. */
  | { kind: "blocked"; skill: string; reason: string; code?: SignedBlockCode }
  | { kind: "approved"; skill: string }
  | { kind: "denied"; skill: string }
  | { kind: "executed"; skill: string; ok: boolean }
  | { kind: "repair_failed"; detail: string };

/**
 * `offer: "contacts"`: a name couldn't be looked up because the contacts permission isn't granted; the chat may offer
 * it (the runtime shows it once, never again).
 */
export type TurnOutcome =
  /** `cut` (Q155): the reply used up its tokens before its own end; the chat says so and offers Seguir. */
  | { kind: "final"; text: string; offer?: "contacts"; receipt?: PaymentReceipt; cut?: true }
  | { kind: "needs_user"; question: string; choices?: Choice[]; offer?: "contacts" }
  | { kind: "error"; code: "max_steps" | "repair_failed" | "model_error" }
  /** The user stopped the turn. `afterAction`: an action that changes something had already finished before the stop. */
  | { kind: "stopped"; afterAction: boolean };

export type TurnResult = TurnOutcome & { events: StepEvent[]; messages: Msg[] };
