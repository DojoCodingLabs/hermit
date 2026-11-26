import { outcomeCopyKey, type Outcome, type TranscriptEntry } from "@hermit/core";
import type { Choice, PaymentReceipt, StepEvent } from "@hermit/agent";
import type { MailScreen, TurnView, WebPageRef } from "./hermit.ts";
import type { BotProposalView } from "./bot-api.ts";
import type { WebOffer } from "./web-tasks.ts";
import type { LockState } from "./app-lock.ts";
import { spokenReply } from "./reply-blocks.ts";

/**
 * HM-CHAT-01's state as a pure reducer (US-CHAT-01, 03, 04, 05, 08). The screen renders `items` and
 * the mascot; the mascot always sits next to text that says the same thing (never the only signal).
 */
export type MascotState = "idle" | "thinking" | "working" | "asking" | "done" | "error" | "blocked" | "offline";

export type ChatItem =
  | { kind: "user"; id: string; text: string }
  /** `page`: the answer came from a web page; the bubble links to HM-WEB-01. */
  /** `webTask` (SL-53): the bubble links HM-WEB-02 with the plan for a saved recipe, by its one-time offer id. */
  /**
   * `work` (C5): the turn's skill calls and how long it took, for the folded "Worked for 9 s · 2 steps" line.
   * `receipt` (A6): a payment the network confirmed, as the payment code's own facts; the screen draws the receipt card
   * from it alone, and the reply text (which can quote a merchant page) stays a plain, tainted bubble under it.
   * `receiptOnly`: the reply is only the payment code's own words, which the card already says; no bubble is drawn.
   * `card` (Q144): the reply is the hold's own words for a payment a cap refused before any sheet: a coral card.
   */
  /** `mail` (SL-48, SL-49): the bubble links the mail screen the turn's list, search or draft fills (HM-MAIL-02 to 04). */
  /**
   * Q155: `cut`, the reply stopped short (at its cap, or with `stopped` because the user stopped it): a quiet line says
   * so under the bubble, and the latest one offers Seguir. `continuing`: Seguir is writing into it now.
   * `continueFailed`: the last Seguir failed and the reply is as it was. `nothingMore`: the last Seguir found nothing new,
   * so the reply is whole and a quiet line says so (never a silent end); like a failed Seguir's, the note goes once the
   * user writes again.
   */
  | { kind: "assistant"; id: string; text: string; streaming: boolean; thinking?: string; page?: WebPageRef; connect?: { request: string; offerId: string }; webTask?: WebOffer; work?: TurnWork; receipt?: PaymentReceipt; receiptOnly?: true; card?: "refused"; mail?: MailScreen; cut?: true; stopped?: true; continuing?: true; continueFailed?: true; nothingMore?: true; botProposal?: BotProposalView }
  /** `choices`: tappable answers for the latest question only (PDR-028); a tap sends its text as the user's words. */
  | { kind: "question"; id: string; text: string; thinking?: string; choices?: Choice[]; work?: TurnWork }
  /** The one-time offer to allow the contacts permission (PDR-028), with its Allow button. */
  | { kind: "offer"; id: string; offer: "contacts" }
  | { kind: "outcome"; id: string; outcome: Outcome }
  /** A quiet row under a step: a copy key plus variables, never raw text from the model. */
  | { kind: "system"; id: string; copyKey: string; vars?: Record<string, string> };

/** The skills a finished turn called, in order, and its length in whole seconds. */
export interface TurnWork {
  seconds: number;
  skills: string[];
}

/** The pay skills, and the cap refusals their hold returns before any sheet (Q144: a coral card in the chat). */
const PAY_SKILLS = new Set(["pay", "pay_merchant"]);
const CAP_REFUSALS = new Set(["over_per_payment", "over_per_day", "merchant_over_per_payment"]);

export interface ChatState {
  items: ChatItem[];
  mascot: MascotState;
  busy: boolean;
  /** The session read content written by others (ST-TAINTED); shown until the session ends. */
  tainted?: boolean;
  /** While a turn runs (Q36): what Hermit is doing now (a copy key), its reasoning so far, and when it began. */
  live?: { statusKey: string; thinking: string; startedAt: number };
  /** The user pressed stop and the turn is winding down (US-CHAT-06). */
  stopping?: boolean;
  /** The id of the item a turn just finished with, for TalkBack (US-SET-07); a restored history has none. */
  finishedId?: string;
  /** The running turn's skill calls (C5), each done once it settled; folded into the reply when the turn ends. */
  steps?: Array<{ skill: string; done: boolean }>;
  /** A cap refused a payment this turn: the reply (the hold's own words) becomes a coral card. */
  card?: "refused";
  /** Q155: Seguir is writing the next part of this reply, whose words were `before`. */
  continuing?: { id: string; before: string };
  /** Q155: where the newly finished part of `finishedId` starts (after Seguir), so TalkBack reads only what is new. */
  finishedFrom?: number;
}

export type ChatAction =
  | { type: "send"; id: string; text: string; at?: number }
  | { type: "token"; text: string }
  | { type: "thinking"; text: string }
  | { type: "step"; event: StepEvent }
  | { type: "approval_open" }
  /** The model is loading (first turn after launch, EC-CHAT-01) or finished loading. */
  | { type: "model"; loading: boolean }
  /** The stop control was pressed; the runtime aborts the turn and `finished` follows. */
  | { type: "stop" }
  /** `at`: when the turn ended, for the folded summary's seconds. */
  | { type: "finished"; id: string; view: TurnView; at?: number }
  | { type: "settle" }
  /** The kept conversation after a restart, or an empty one after "Clear conversation" (US-CHAT-07). */
  | { type: "restore"; entries: TranscriptEntry[]; tainted: boolean }
  /** Q155: the user tapped Seguir on a cut reply; its next part streams in as tokens, then `continued` ends it. */
  | { type: "continue"; id: string; at?: number }
  /** Q155: Seguir ended: the whole reply from the runtime, or an outcome when it failed (the reply is put back). */
  | { type: "continued"; id: string; view: TurnView; at?: number };

export const initialChat: ChatState = { items: [], mascot: "idle", busy: false };

/** The control beside the input (US-CHAT-06): stop replaces send while a turn runs. */
export function inputControl(state: ChatState): "send" | "stop" | "stopping" {
  if (!state.busy) return "send";
  return state.stopping ? "stopping" : "stop";
}

/**
 * Q155: the reply Seguir can continue now, by id: the latest answer, when it stopped short and nothing runs. Once the
 * user writes again it is history, and a card or a receipt is code's own words, never cut.
 */
export function continuable(state: ChatState): string | undefined {
  if (state.busy) return undefined;
  for (let i = state.items.length - 1; i >= 0; i--) {
    const it = state.items[i]!;
    if (it.kind === "user" || it.kind === "question") return undefined;
    if (it.kind === "assistant") return it.cut && !it.card && !it.receipt ? it.id : undefined;
  }
  return undefined;
}

type Reply = Extract<ChatItem, { kind: "assistant" }>;

/** A reply without Seguir's working marks and notes, and with its cut marks as `view` says (absent: as they were). */
function settled(i: Reply, view?: { cut?: true; stopped?: true; nothingMore?: true }): Reply {
  const out: Reply = { ...i };
  delete out.continuing;
  delete out.continueFailed;
  delete out.nothingMore;
  if (view) {
    delete out.cut;
    delete out.stopped;
    if (view.cut) out.cut = true;
    if (view.stopped) out.stopped = true;
    if (view.nothingMore) out.nothingMore = true;
  }
  return out;
}

export function chatReducer(state: ChatState, action: ChatAction): ChatState {
  switch (action.type) {
    case "send":
      if (state.busy) return state; // input is disabled while a turn runs
      return {
        // Earlier choices are retired: only the latest question can be answered with a tap. Seguir's notes (it failed, or
        // it found nothing more) go.
        items: [...state.items.map((i) => (i.kind === "question" && i.choices ? { kind: "question" as const, id: i.id, text: i.text, ...(i.thinking ? { thinking: i.thinking } : {}) } : i.kind === "assistant" && (i.continueFailed || i.nothingMore) ? settled(i) : i)), { kind: "user", id: action.id, text: action.text }],
        mascot: "thinking",
        busy: true,
        live: { statusKey: "HM-CHAT-01.doing.intent", thinking: "", startedAt: action.at ?? 0 },
        ...(state.tainted ? { tainted: true } : {}),
      };
    case "thinking":
      return state.busy && state.live ? { ...state, live: { ...state.live, thinking: state.live.thinking + action.text } } : state;
    case "token": {
      // After a stop nothing more is written into the chat.
      if (!state.busy || state.stopping) return state;
      // Q155: Seguir writes into the reply it continues, never a new bubble.
      const going = state.continuing;
      if (going) {
        return { ...state, items: state.items.map((i) => (i.kind === "assistant" && i.id === going.id ? { ...i, text: i.text + action.text } : i)) };
      }
      const last = state.items.at(-1);
      const items: ChatItem[] =
        last?.kind === "assistant" && last.streaming
          ? [...state.items.slice(0, -1), { ...last, text: last.text + action.text }]
          : [...state.items, { kind: "assistant", id: "streaming", text: action.text, streaming: true }];
      return { ...state, items, mascot: "thinking", ...(state.live ? { live: { ...state.live, statusKey: "HM-CHAT-01.writing" } } : {}) };
    }
    case "step":
      return state.busy && !state.stopping ? step(state, action.event) : state;
    case "approval_open":
      return state.stopping ? state : { ...state, mascot: "asking" };
    case "stop":
      if (!state.busy || state.stopping) return state;
      return { ...state, stopping: true, ...(state.live ? { live: { ...state.live, statusKey: "HM-CHAT-01.stopping" } } : {}) };
    case "finished": {
      const items = state.items.filter((i) => !(i.kind === "assistant" && i.streaming));
      const v = action.view;
      // The reasoning stays with the answer, behind "how it thought" (Q36).
      const thinking = state.live?.thinking.trim() ? { thinking: state.live.thinking.trim() } : {};
      const stopped = (v.kind === "outcome" && v.outcome === "stopped") || (v.kind === "reply" && v.stopped === true);
      const item: ChatItem =
        v.kind === "reply" ? { kind: "assistant", id: action.id, text: v.text, streaming: false, ...thinking, ...(v.page ? { page: v.page } : {}), ...(v.connect ? { connect: v.connect } : {}), ...(v.webTask ? { webTask: v.webTask } : {}), ...(v.mail ? { mail: v.mail } : {}), ...(v.botProposal ? { botProposal: v.botProposal } : {}), ...(v.cut ? { cut: true as const } : {}), ...(v.stopped ? { stopped: true as const } : {}) }
        : v.kind === "question" ? { kind: "question", id: action.id, text: v.text, ...thinking, ...(v.choices?.length ? { choices: v.choices } : {}) }
        // "Stopped. Nothing was done." would be false once an action had finished: say what happened instead.
        : stopped && v.afterAction ? { kind: "system", id: action.id, copyKey: "HM-CHAT-01.stoppedAfterAction" }
        : { kind: "outcome", id: action.id, outcome: v.outcome };
      // The user chose to stop: the mascot rests rather than showing an error. A send that needed the
      // internet while offline is not a fault (ST-OFFLINE): it gets its own pose. A cut reply isn't done: it rests.
      const mascot: MascotState = stopped || (v.kind === "reply" && v.cut) ? "idle" : v.kind === "outcome" ? (v.outcome === "offline" ? "offline" : "error") : v.kind === "question" ? "asking" : "done";
      const offer: ChatItem[] = (v.kind === "reply" || v.kind === "question") && v.offer ? [{ kind: "offer", id: `${action.id}-offer`, offer: v.offer }] : [];
      const skills = (state.steps ?? []).map((st) => st.skill);
      const started = state.live?.startedAt;
      const work: TurnWork | undefined = skills.length && started && action.at !== undefined ? { seconds: Math.max(0, Math.round((action.at - started) / 1000)), skills } : undefined;
      // A refusal card only for a reply the hold wrote (a refused turn read nothing); never for tainted text.
      const card = v.kind === "reply" && !v.tainted ? state.card : undefined;
      // The loop ends a payment turn with the skill's own reply, word for word. When that is all the reply is (no page
      // answer, nothing tainted, no source or offer beside it) the card already says it: the bubble is not drawn.
      const codeOnly = v.kind === "reply" && v.receipt && !v.tainted && !v.page && !v.connect && !v.webTask;
      const receipt = v.kind === "reply" && v.receipt ? { receipt: v.receipt, ...(codeOnly ? { receiptOnly: true as const } : {}) } : {};
      const shown: ChatItem = item.kind === "assistant" || item.kind === "question" ? { ...item, ...(work ? { work } : {}), ...(item.kind === "assistant" ? receipt : {}), ...(card && item.kind === "assistant" ? { card } : {}) } : item;
      return { items: [...items, shown, ...offer], mascot: card === "refused" ? "blocked" : mascot, busy: false, finishedId: item.id, ...(state.tainted || v.tainted ? { tainted: true } : {}) };
    }
    case "model":
      if (!state.busy || !state.live) return state;
      return { ...state, live: { ...state.live, statusKey: action.loading ? "HM-CHAT-01.loadingModel" : state.live.statusKey === "HM-CHAT-01.loadingModel" ? "HM-CHAT-01.doing.intent" : state.live.statusKey } };
    case "settle":
      return state.busy ? state : { ...state, mascot: "idle" };
    case "restore": {
      if (state.busy) return state;
      const items = action.entries.map((e, i): ChatItem => {
        const id = `r${i}`;
        return e.kind === "user" ? { kind: "user", id, text: e.text }
          : e.kind === "question" ? { kind: "question", id, text: e.text }
          : { kind: "assistant", id, text: e.text, streaming: false, ...(e.cut ? { cut: true as const } : {}), ...(e.stopped ? { stopped: true as const } : {}) };
      });
      return { ...initialChat, items, ...(action.tainted ? { tainted: true } : {}) };
    }
    case "continue": {
      if (continuable(state) !== action.id) return state;
      const reply = state.items.find((i): i is Reply => i.kind === "assistant" && i.id === action.id)!;
      return {
        items: state.items.map((i) => (i === reply ? { ...settled(i), continuing: true as const } : i)),
        mascot: "thinking",
        busy: true,
        live: { statusKey: "HM-CHAT-01.cut.continuing", thinking: "", startedAt: action.at ?? 0 },
        continuing: { id: reply.id, before: reply.text },
        ...(state.tainted ? { tainted: true } : {}),
      };
    }
    case "continued": {
      const going = state.continuing;
      if (!going || going.id !== action.id) return state;
      const v = action.view;
      // A failure puts the reply back as it was before Seguir, still short of its end, with a note that it failed.
      const items = state.items.map((i) => {
        if (i.kind !== "assistant" || i.id !== going.id) return i;
        return v.kind === "reply" ? { ...settled(i, v), text: v.text } : { ...settled(i), text: going.before, continueFailed: true as const };
      });
      const mascot: MascotState = v.kind !== "reply" ? "error" : v.cut ? "idle" : "done";
      return { items, mascot, busy: false, finishedId: going.id, ...(v.kind === "reply" ? { finishedFrom: going.before.length } : {}), ...(state.tainted || v.tainted ? { tainted: true } : {}) };
    }
  }
}

/**
 * US-SET-07: what TalkBack reads when a turn ends. The streaming bubble is not a live region, so the reply is
 * announced once, whole, when it is complete; outcomes and system rows are read by their copy key. Q155: a reply that
 * stopped short is followed by its cut line (`also`, a copy key), so it is never silent by ear either; after Seguir
 * only the new part is read (the id names the part, so it is announced once).
 */
export function turnAnnouncement(state: ChatState): { id: string; text: string; also?: string[] } | { id: string; copyKey: string } | undefined {
  if (state.busy || !state.finishedId) return undefined;
  const item = state.items.find((i) => i.id === state.finishedId);
  if (!item) return undefined;
  switch (item.kind) {
    case "assistant": {
      if (item.continueFailed) return { id: `${item.id}:failed`, copyKey: "HM-CHAT-01.cut.failed" };
      if (item.nothingMore) return { id: `${item.id}:nothing`, copyKey: "HM-CHAT-01.cut.nothingMore" };
      const from = state.finishedFrom ?? 0;
      // Q155: the structure as sentences (no list signs read out); a long one reads its opening and says the rest is
      // in the chat, where each heading, step and item is its own stop to swipe through.
      const spoken = spokenReply(item.text.slice(from));
      const long = spoken.length > LONG_SPOKEN;
      const also = [...(long ? ["HM-CHAT-01.long.spoken"] : []), ...(item.cut ? [item.stopped ? "HM-CHAT-01.cut.spokenStopped" : "HM-CHAT-01.cut.spoken"] : [])];
      return { id: from ? `${item.id}:${from}` : item.id, text: long ? opening(spoken) : spoken, ...(also.length ? { also } : {}) };
    }
    case "question":
      return { id: item.id, text: item.text };
    case "outcome":
      return { id: item.id, copyKey: outcomeCopyKey(item.outcome) };
    case "system":
      return { id: item.id, copyKey: item.copyKey };
    case "user":
      return undefined;
  }
}

/**
 * What TalkBack actually speaks for a finished turn. While the app lock is engaged (US-SET-09) a locked phone must
 * not read private replies aloud: it says only a neutral line, for every kind of ending. Unlocked, the reply itself.
 */
/** Q155: past this many characters a reply is read by its opening, then "the whole reply is in the chat". */
const LONG_SPOKEN = 500;

/** The opening of a long spoken reply: about 300 characters, ending at a sentence when one ends after 80. */
function opening(spoken: string): string {
  const head = spoken.slice(0, 300);
  const end = Math.max(head.lastIndexOf(". "), head.lastIndexOf("? "), head.lastIndexOf("! "));
  return end > 80 ? head.slice(0, end + 1) : `${head.trimEnd()}…`;
}

export function spokenAnnouncement(
  a: NonNullable<ReturnType<typeof turnAnnouncement>>,
  lock: Pick<LockState, "locked" | "enabled" | "hiddenAt">,
): { text: string; also?: string[] } | { copyKey: string } {
  // Fail closed: with the lock on, a reply that finishes while Hermit is off screen (inside the grace, not locked
  // yet) is neutral too, since the phone may already be locked or in someone else's hands.
  if (lock.locked || (lock.enabled && lock.hiddenAt !== undefined)) return { copyKey: "HM-CHAT-01.replyReady" };
  return "text" in a ? { text: a.text, ...(a.also ? { also: a.also } : {}) } : { copyKey: a.copyKey };
}

function step(state: ChatState, e: StepEvent): ChatState {
  const row = (copyKey: string, vars?: Record<string, string>): ChatItem => ({ kind: "system", id: `sys${state.items.length}`, copyKey, ...(vars ? { vars } : {}) });
  const status = (statusKey: string): Pick<ChatState, "live"> => (state.live ? { live: { ...state.live, statusKey } } : {});
  // Every step so far is done once a call settles (ran, refused, denied) or another begins.
  const settled = () => (state.steps ?? []).map((st) => (st.done ? st : { ...st, done: true }));
  switch (e.kind) {
    case "intent":
      return { ...state, ...status(`HM-CHAT-01.doing.${e.skill}`) };
    case "picked":
      // A preface streamed before a tool call is dropped: nothing model-written stays beside an approval sheet.
      return { ...state, items: state.items.filter((i) => !(i.kind === "assistant" && i.streaming)), mascot: "working", ...status(`HM-CHAT-01.doing.${e.skill}`), steps: [...settled(), { skill: e.skill, done: false }] };
    case "approved":
      return { ...state, mascot: "working" };
    case "blocked":
      // Q144: a cap refused a payment before any sheet; the turn's reply (the hold's own words) becomes a coral card.
      if (!e.code && PAY_SKILLS.has(e.skill) && CAP_REFUSALS.has(e.reason)) return { ...state, mascot: "blocked", steps: settled(), card: "refused" };
      // SL-37: a money or password call that couldn't be asked says why in copy (the key rows link its screen).
      return { ...state, mascot: "blocked", steps: settled(), items: [...state.items, e.code ? row(`HM-APPR-01.signed.${e.code}`) : row("common.outcome.blocked", { reason: e.reason })] };
    case "denied":
      // "Not sent." is wrong for a page: a denied fetch opened nothing.
      return { ...state, mascot: "thinking", steps: settled(), items: [...state.items, row(e.skill === "read_web" ? "HM-APPR-01.deniedFetch" : e.skill === "search_web" ? "HM-APPR-01.deniedSearch" : "HM-APPR-01.denied")] };
    case "executed":
      return { ...state, mascot: "thinking", ...status("HM-CHAT-01.writing"), steps: settled(), items: e.ok && e.skill === "remember" ? [...state.items, row("HM-CHAT-01.saved")] : state.items };
    case "repair_failed":
      return { ...state, mascot: "thinking" };
    case "words":
      // Q155: the runtime's own note that the answer being written can't act; nothing changes on screen.
      return state;
  }
}
