import {
  argsHash, coerceArgs, findUrls, parseArgs, parseWebUrl, readKind, repairSkillName, validateArgs,
  type ApprovalOutcome, type FoundPerson, type Msg, type PermissionMode, type ReplyText, type SessionState, type SignedApprovalPayload, type SignedApprovalRequest,
  type SkillDef, type SkillGroup, type SkillId, type SignedApprovalTerms, type StopSignal, type TaintSource,
} from "@hermit/core";
import { decide, SIGNED_APPROVAL_MAX_TTL_MS, type SignedApprovalExpected, type SignedApprovals } from "@hermit/cage";
import { redactFound, resolvePeople, type PeopleOutcome } from "./people.ts";
import type { HoldResult, LoopDeps, SignedBlockCode, SkillResult, SkillRuntime, StepEvent, TurnOutcome, TurnResult } from "./types.ts";
import { wrapUntrusted } from "./untrusted.ts";
import { decodeEntities } from "./web-extract.ts";

/** The taint warning's source in words, by what was read (the audit log keeps which skill read it). */
const TAINT_WORDS: Record<TaintSource["kind"], string> = {
  inbound_message: "messages",
  email: "email",
  web: "a web page",
  file: "a file",
  notification: "a notification",
  bot: "another bot's message",
};

/** What the chat and the model are told when a money or password call can't be asked (SL-37). Words only, no payload. */
const SIGNED_BLOCKS: Record<"key_none" | "key_lost" | "no_biometric" | "not_usdt" | "approval_terms", { code: SignedBlockCode; reason: string }> = {
  key_none: { code: "approval_key_none", reason: "Payments and passwords need your approval key, and it isn't set up yet." },
  key_lost: { code: "approval_key_lost", reason: "Your approval key stopped working because the phone's fingerprints changed. Set it up again first." },
  no_biometric: { code: "no_biometric", reason: "Payments and passwords need a fingerprint, and this phone has none set up." },
  not_usdt: { code: "not_usdt", reason: "Hermit only pays in USD₮." },
  approval_terms: { code: "approval_terms", reason: "Hermit can't show exactly what this would approve." },
};

/** The payload the Keystore key will sign for this call, or why there can't be one. */
async function prepareSigned(
  deps: LoopDeps,
  def: SkillDef,
  args: Record<string, unknown>,
  call: { id: string; argsHash: string },
  expiresAt: number,
  heldTerms?: SignedApprovalTerms,
): Promise<{ ok: true; signed: { request: SignedApprovalRequest; expected: SignedApprovalExpected } } | { ok: false; reason: string }> {
  if (!deps.signedApprovals) return { ok: false, reason: "key_none" };
  if ((def.risk !== "spend" && def.risk !== "credential") || !def.approvalTerms) return { ok: false, reason: "approval_terms" };
  let terms;
  try {
    terms = heldTerms ?? def.approvalTerms(args);
  } catch {
    return { ok: false, reason: "approval_terms" };
  }
  const expected: SignedApprovalExpected = { risk: def.risk, skill: def.id, requestId: call.id, argsHash: call.argsHash, terms };
  const prepared = await deps.signedApprovals.prepare({ ...expected, expiresAt }).catch(() => ({ ok: false as const, reason: "key_lost" as const }));
  return prepared.ok ? { ok: true, signed: { request: prepared.request, expected } } : { ok: false, reason: prepared.reason };
}

/** The prompt cache key of a turn with no bot (`LoopDeps.prefixCacheKey`). */
const PREFIX_KEY = "hermit-v1";

/** At most this much of what a turn read from others reaches the cage: the newest 64 KB. A link before it asks. */
const READ_TEXT_MAX = 64 * 1024;

/**
 * Groups whose results are others' words: messages and mail. Notes, reminders and events are left out because the
 * model writes them itself (remember, remind, calendar_add), and so is any group not named here. In wave 1 a web read
 * gives nothing either: read_web and search_web hand the model the quarantined reader's summary (and search_web the
 * model's own query), and a web task's recipe skills give code's text. Wave 2 may add the links code takes from the
 * raw page, as data, never the summary.
 */
const OTHERS_WORDS: readonly SkillGroup[] = ["messages_read", "mail_read"];

/** The skill reads others' words: its group says so, or, with no group, it comes from a connector or an MCP server. */
const readsOthers = (runtime: SkillRuntime) => (runtime.def.group !== undefined ? OTHERS_WORDS.includes(runtime.def.group) : runtime.source !== undefined);

/** Every string in a call's arguments, however deep: the values, in order, and with `keys` the keys too. */
function stringsIn(v: unknown, keys = false): string[] {
  if (typeof v === "string") return [v];
  if (Array.isArray(v)) return v.flatMap((x) => stringsIn(x, keys));
  if (v && typeof v === "object") return Object.entries(v).flatMap(([k, x]) => [...(keys ? [k] : []), ...stringsIn(x, keys)]);
  return [];
}

/** Percent-escapes of ASCII characters and HTML entities decoded, in up to 3 rounds, until nothing changes. */
function decoded(text: string): string {
  let t = text;
  for (let round = 0; round < 3; round++) {
    const next = decodeEntities(t.replace(/%([0-7][0-9a-f])/gi, (_, hex: string) => String.fromCharCode(parseInt(hex, 16))));
    if (next === t) break;
    t = next;
  }
  return t;
}

/**
 * The hosts of the addresses in a text, as written and decoded: each in lower case, without its port or a leading
 * "www.", the trailing punctuation dropped (findUrls). However a page, a provider or a server writes an address back,
 * its host comes out the same.
 */
function hostsIn(text: string): string[] {
  const out: string[] = [];
  for (const t of [text, decoded(text)]) {
    for (const u of findUrls(t)) {
      const host = parseWebUrl(u, { upgrade: true })?.domain;
      if (host) out.push(host);
    }
  }
  return out;
}

/**
 * The addresses written in these texts, as the cage matches them (urlInText): found as written, read as https. Never
 * decoded: an address the model writes in another spelling than the one it read is the model's own choice of spelling.
 */
function addressesWritten(...texts: string[]): Set<string> {
  return new Set(texts.flatMap((t) => findUrls(t).flatMap((u) => parseWebUrl(u, { upgrade: true })?.url ?? [])));
}

/**
 * The hosts of the addresses the model made up in its calls' arguments, kept for the live session: the sessions store
 * keeps one object per session, so an echo in a later turn is caught too, and the record goes with the session.
 */
const MADE_UP = new WeakMap<SessionState, Set<string>>();

/**
 * What a turn read from others, for Auto's links (spec 6.4.1, `decide`'s `readText`): the untrusted results of the
 * skills that read others' words (only the part others wrote, when the skill says which), the newest 64 KB of them.
 * A word holding an address on a host where the model made one up in this session is left out, whatever its path or
 * encoding: a read that says back what it was asked (mail_search heads its listing with the query) would hand the
 * model's own address back to it as something read. An argument that is, whole, an address the model copied from the
 * user's words or from what the turn read when it supplied it is not made up, so following a link marks no host.
 */
function readFromOthers(session: SessionState, userText: string) {
  let text = "";
  let madeUp = MADE_UP.get(session);
  if (!madeUp) MADE_UP.set(session, (madeUp = new Set()));
  const hosts = madeUp;
  const own = (words: string) => hosts.size > 0 && hostsIn(words).some((h) => hosts.has(h));
  return {
    text: () => text,
    /**
     * Before a call runs: the hosts of the addresses it made up, in its arguments each one alone and all of them joined
     * either way round (an address split across two arguments). An argument counts as copied only when, trimmed, it is
     * one address exactly as a fetch would use it (parseWebUrl, as the cage reads the call) and that address is written
     * in the user's words or in what the turn read: `https://ex.com/known"SECRET` is not `https://ex.com/known`, and
     * anything more marks the host of every address in it.
     */
    calling(args: Record<string, unknown>) {
      const copied = addressesWritten(userText, text);
      const values = stringsIn(args);
      for (const s of [...stringsIn(args, true), values.join(""), [...values].reverse().join("")]) {
        const whole = parseWebUrl(s)?.url;
        if (whole !== undefined && copied.has(whole)) continue;
        for (const h of hostsIn(s)) hosts.add(h);
      }
    },
    /** After a skill that reads others' words: what the model was given, or the part of it others wrote. */
    read(result: string) {
      const kept = own(result) ? result.split(/\s+/).filter((word) => !own(word)).join(" ") : result;
      text = (text ? `${text}\n${kept}` : kept).slice(-READ_TEXT_MAX);
    },
  };
}

/** What the model sees in the history after the user stops a turn, so it never resumes the abandoned request. */
export const STOPPED_NOTE = "(Stopped by the user. Nothing more was done for that request.)";

class TurnStopped extends Error {}

/** Settles with `p`, or rejects with TurnStopped the moment the turn is stopped (an engine may not honor the signal). */
function untilStopped<T>(p: Promise<T>, signal: StopSignal | undefined): Promise<T> {
  if (!signal) return p;
  if (signal.aborted) return Promise.reject(new TurnStopped());
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(new TurnStopped());
    signal.addEventListener("abort", onAbort, { once: true });
    p.then(
      (v) => {
        signal.removeEventListener("abort", onAbort);
        resolve(v);
      },
      (e: unknown) => {
        signal.removeEventListener("abort", onAbort);
        reject(e);
      },
    );
  });
}

async function withTimeout(p: Promise<ApprovalOutcome>, ms: number): Promise<ApprovalOutcome> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expired = new Promise<ApprovalOutcome>((resolve) => {
    timer = setTimeout(() => resolve({ kind: "expired" }), ms);
  });
  try {
    return await Promise.race([p, expired]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * One user turn: pick → fill → repair → cage → (approve) → execute → audit, repeated
 * until the model responds, asks the user, or a limit is hit. The model's choice is
 * only ever a request; nothing runs unless the cage and, when asked, the user agree.
 */
export async function runTurn(
  state: { session: SessionState; messages: Msg[] },
  userText: string,
  deps: LoopDeps,
): Promise<TurnResult> {
  const maxSteps = deps.maxSteps ?? 4;
  const maxStrikes = deps.maxStrikes ?? 3;
  const timeoutMs = deps.approvalTimeoutMs ?? 120_000;
  const prefixCacheKey = deps.prefixCacheKey ?? PREFIX_KEY;
  const { session } = state;
  const fromOthers = readFromOthers(session, userText);
  const messages = state.messages;
  const events: StepEvent[] = [];
  const emit = (e: StepEvent) => {
    events.push(e);
    deps.onEvent?.(e);
  };
  // Every id names exactly one skill: a second one (an installed connector or MCP tool named like a built-in) would
  // silently replace it in this map, so the turn refuses to start instead (SL-55 review).
  const byId = new Map<string, LoopDeps["skills"][number]>();
  for (const s of deps.skills) {
    if (byId.has(s.def.id)) throw new Error(`duplicate skill id ${s.def.id}`);
    byId.set(s.def.id, s);
  }
  const menu = deps.skills.map((s) => s.def.id);
  // Multi-bot ("the signed log records bot ids"): every entry of a bot's turn names the bot; a turn with no bot (the night
  // shift, the screens' own acts) names none, as before.
  const audit = (input: Omit<Parameters<LoopDeps["audit"]["append"]>[0], "ts" | "sessionId" | "bot">) =>
    deps.audit.append({ ts: deps.now(), sessionId: session.id, ...input, ...(deps.bot ? { bot: deps.bot.botId } : {}) });
  // A name couldn't be looked up because the contacts permission is off (PDR-028): the chat may offer it.
  let offer = false;
  const done = (r: TurnOutcome): TurnResult => ({ ...r, ...(offer && (r.kind === "final" || r.kind === "needs_user") ? { offer: "contacts" as const } : {}), events, messages });
  const { signal } = deps;
  const isStopped = () => signal?.aborted === true;
  const withSignal = signal ? { signal } : {};
  // An action that changes something finished this turn: a stop can't say "nothing was done".
  let afterAction = false;
  const halt = (): TurnResult => {
    messages.push({ role: "assistant", content: STOPPED_NOTE });
    return done({ kind: "stopped", afterAction });
  };

  messages.push({ role: "user", content: userText });
  /**
   * The reply prompt's words: nothing in reach can act, which the chat hears first (Q155). A plain string is a finished
   * reply; a ReplyText may say it was cut.
   */
  const words = async (history: Msg[]): Promise<ReplyText> => {
    emit({ kind: "words" });
    const r = await untilStopped(deps.model.respond({ prefixCacheKey, messages: history, ...withSignal }, (t) => deps.onToken?.(t)), signal);
    return typeof r === "string" ? { text: r } : r;
  };
  let skillCalls = 0;
  const doneThisTurn = new Set<string>();
  let strikes = 0;
  // The last action that changes something failed and nothing succeeded after it (honesty guard below).
  let writeFailed = false;

  for (;;) {
    if (isStopped()) return halt();
    let picked;
    try {
      picked = await untilStopped(deps.model.pick({
        prefixCacheKey,
        messages,
        menu,
        live: { onIntent: (skill) => emit({ kind: "intent", skill }), onThinking: (t) => deps.onThinking?.(t), onToken: (t) => deps.onToken?.(t), onWords: () => emit({ kind: "words" }) },
        ...withSignal,
      }), signal);
    } catch {
      return isStopped() ? halt() : done({ kind: "error", code: "model_error" });
    }

    if (picked.choice === "respond") {
      let reply: ReplyText;
      try {
        // A finished answer from the pick (written with thinking and the full context) is the reply;
        // otherwise the reply prompt writes one.
        reply = picked.text !== undefined ? { text: picked.text, ...(picked.cut ? { cut: true } : {}) } : await words(messages);
        if (picked.text && !picked.streamed) deps.onToken?.(picked.text);
      } catch {
        return isStopped() ? halt() : done({ kind: "error", code: "model_error" });
      }
      let { text } = reply;
      // A failed action is never reported as done: a cancel found no match and the model said "has been
      // cancelled" (trajectory eval). Code can't judge every answer, but it can catch a claim of success.
      const guarded = writeFailed && claimsSuccess(text);
      if (guarded) text = couldNot(userText);
      // An answer built from others' words (FR-WEB-03) stays marked untrusted in the history.
      messages.push(picked.untrusted ? { role: "assistant", content: text, untrusted: true } : { role: "assistant", content: text });
      // Q155: a reply that used up its tokens says so; the guard's own sentence is always whole.
      return done({ kind: "final", text, ...(reply.cut && !guarded ? { cut: true as const } : {}) });
    }
    if (picked.choice === "ask_user") {
      const question = picked.text ?? "";
      messages.push({ role: "assistant", content: question });
      return done({ kind: "needs_user", question });
    }

    const strike = (detail: string) => {
      strikes++;
      emit({ kind: "repair_failed", detail });
      messages.push({ role: "tool", content: `Error: ${detail}. Pick from the menu and fill every required field.` });
      return strikes >= maxStrikes;
    };

    const name = repairSkillName(picked.choice, menu);
    const runtime = name && byId.get(name.name);
    if (!runtime) {
      if (strike(`"${picked.choice}" is not on the menu`)) return done({ kind: "error", code: "repair_failed" });
      continue;
    }
    if (skillCalls >= maxSteps) return done({ kind: "error", code: "max_steps" });

    const { def } = runtime;
    let args: Record<string, unknown>;
    try {
      const filled = await untilStopped(deps.model.fill({ prefixCacheKey, messages, skill: def.id as SkillId, schema: def.args, ...withSignal }), signal);
      args = coerceArgs(parseArgs(filled.rawText).value, def.args).args;
    } catch (err) {
      if (isStopped()) return halt();
      if (strike(`arguments for ${def.id} were not valid JSON (${(err as Error).message})`)) return done({ kind: "error", code: "repair_failed" });
      continue;
    }
    const errors = validateArgs(args, def.args);
    if (errors.length) {
      if (strike(`arguments for ${def.id}: ${errors.join("; ")}`)) return done({ kind: "error", code: "repair_failed" });
      continue;
    }
    // Times and dates the user's own words pin down are read by code, not trusted to the model.
    const filled = args;
    const repairs: string[] = [];
    if (def.normalize && deps.timeZone) {
      const earlier = messages.slice(0, -1).filter((m) => m.role === "user" && !m.content.startsWith("Result:") && m.content !== userText).map((m) => m.content).reverse();
      const n = def.normalize(args, { userText, now: deps.now(), timeZone: deps.timeZone, earlier });
      // A correction must still satisfy the schema (review finding 7); otherwise the model's args stand.
      if (validateArgs(n.args, def.args).length === 0) {
        args = n.args;
        repairs.push(...n.notes);
      }
    }
    // A person the user named becomes a number or address by code, before the cage, so the sheet shows it and the
    // approval binds it (PDR-028). Nobody or several matching ends the turn with a question.
    let found: FoundPerson[] = [];
    if (def.recipient && deps.people) {
      let r: PeopleOutcome;
      try {
        r = await untilStopped(resolvePeople(def, filled, args, userText, deps.people), signal);
      } catch {
        if (isStopped()) return halt();
        r = { kind: "go", args, found: [], notes: ["person: the lookup failed, so nobody was looked up"], offer: false };
      }
      repairs.push(...r.notes);
      if (r.offer) offer = true;
      if (r.kind === "ask") {
        messages.push({ role: "assistant", content: r.question });
        return done({ kind: "needs_user", question: r.question, ...(r.choices.length ? { choices: r.choices } : {}) });
      }
      if (validateArgs(r.args, def.args).length === 0) {
        args = r.args;
        found = r.found;
      }
    }

    // A call identical to one already done this turn is not run again: small models tend to repeat a
    // successful action. The turn moves straight to the reply.
    const repeatHash = argsHash(args);
    if (doneThisTurn.has(`${def.id}:${repeatHash}`)) {
      messages.push({ role: "tool", content: `Already done: ${def.id}. Now answer the user.` });
      let reply: ReplyText;
      try {
        reply = await words(messages);
      } catch {
        return isStopped() ? halt() : done({ kind: "error", code: "model_error" });
      }
      messages.push({ role: "assistant", content: reply.text });
      return done({ kind: "final", text: reply.text, ...(reply.cut ? { cut: true as const } : {}) });
    }
    if (isStopped()) return halt();

    skillCalls++;
    emit({ kind: "picked", skill: def.id });
    // The destination is read once: the cage decides on it and the skill is handed the same value to hold itself to.
    let call = {
      id: deps.newId(), skill: def.id, args, argsHash: argsHash(args), repairs,
      ...(runtime.destination ? { destination: runtime.destination(args) ?? "" } : {}),
    };
    messages.push({ role: "assistant", content: redactFound(JSON.stringify({ skill: def.id, args }), found) });
    await audit({ event: "call_proposed", skill: def.id, argsHash: call.argsHash });

    // Multi-bot (spec 6.4, 6.4.1): the bot's grants, sources and mode, what code knows about the skill (its tier and group,
    // the runtime's source) and what this turn read from others. With no bot, the cage decides exactly as before.
    const decision = decide(call, def.risk, session, deps.rules, {
      userText, readText: fromOthers.text(), foundByName: found.length > 0, bot: deps.bot, skill: { tier: def.tier, group: def.group, source: runtime.source },
    });
    // The cage allowed only a narrower call (a tainted search runs on the user's matched words): that is what runs,
    // and what the audit and any approval are bound to from here on.
    if (decision.args) {
      args = decision.args;
      call = { ...call, args, argsHash: argsHash(args) };
    }
    await audit({ event: "policy_decided", skill: def.id, argsHash: call.argsHash, decision: decision.effect });

    // An action that changes something and doesn't run (blocked, unresolved, declined) is a failure for the
    // honesty guard: the model said "listo, enviado" after a declined send (SL-49).
    const didNotRun = () => {
      if (def.risk !== "read" && def.risk !== "network") writeFailed = true;
    };
    if (decision.effect === "deny") {
      didNotRun();
      emit({ kind: "blocked", skill: def.id, reason: decision.reason });
      messages.push({ role: "tool", content: `Blocked: ${decision.reason}` });
      continue;
    }

    let approvedArgsHash: string | undefined;
    let approvedBinding: string | undefined;
    // The mode that stood in for the sheet: the skill is held to what was decided, but remembers no approval of it.
    let approvedByMode: PermissionMode | undefined;
    let approvedSigned: { payload: SignedApprovalPayload; payloadHash: string } | undefined;
    // SL-40: a money skill's reservation, freed on every way out that doesn't reach execute.
    let held: (() => Promise<void>) | undefined;
    let heldTerms: SignedApprovalTerms | undefined;
    const releaseHold = async () => {
      const r = held;
      held = undefined;
      await r?.().catch(() => {});
    };
    /** The exact action in code's words, for the sheet or for a step a mode runs; never the model's words. */
    const summarize = async () => {
      const render = typeof deps.render === "function" ? await deps.render() : deps.render;
      return def.describeAction(args, found.length ? { ...render, found } : render);
    };
    /** A summary that can't show who or what the action reaches: it is never put in front of the user, nor run by a mode. */
    const unresolved = async (reason: string) => {
      await releaseHold();
      didNotRun();
      await audit({ event: "approval", skill: def.id, argsHash: call.argsHash, outcome: "denied" });
      emit({ kind: "blocked", skill: def.id, reason });
      messages.push({ role: "tool", content: `Blocked: ${reason}` });
    };
    /** A stop that came in before the step ran: nothing runs. */
    const stoppedBeforeRun = async () => {
      await releaseHold();
      messages.push({ role: "tool", content: "Stopped by the user. Nothing was done." });
      return halt();
    };
    if (decision.effect === "ask") {
      const lastTaint = session.taint.at(-1);
      const summary = await summarize();
      // SL-40 (FR-PAY-05): before the sheet, code checks the payment against the user's words, the caps and the balance
      // and reserves it. A refusal or a question ends the turn in code's own words; nothing is asked or signed.
      if (runtime.hold) {
        let h: HoldResult;
        try {
          h = await runtime.hold(args, { session, userText, requestId: call.id, argsHash: call.argsHash });
        } catch {
          h = { ok: false, code: "hold_failed", reply: "" };
        }
        if (!h.ok) {
          didNotRun();
          await audit({ event: "approval", skill: def.id, argsHash: call.argsHash, outcome: "denied", reason: `hold.${h.code}` });
          emit({ kind: "blocked", skill: def.id, reason: h.code });
          messages.push({ role: "tool", content: `Blocked: ${h.code}. Nothing was sent.` });
          if (!h.reply) continue;
          messages.push({ role: "assistant", content: h.reply });
          return done(h.ask ? { kind: "needs_user", question: h.reply } : { kind: "final", text: h.reply });
        }
        held = h.release;
        heldTerms = h.terms;
        if (h.lines?.length) summary.lines = [...summary.lines, ...h.lines];
      }
      // A sheet that can't show who or what the action reaches is never put in front of the user.
      if (summary.unresolved) {
        await unresolved(summary.unresolved);
        continue;
      }
      // SL-37 (FR-CAGE-06): money and passwords need the Keystore key to sign the exact payload. It is built before
      // the sheet opens; anything that stops it (no key, a lost key, not USD₮) is a block, never a sheet.
      let signed: { request: SignedApprovalRequest; expected: SignedApprovalExpected } | undefined;
      const expiresAt = deps.now() + (decision.signedApproval ? Math.min(timeoutMs, SIGNED_APPROVAL_MAX_TTL_MS) : timeoutMs);
      if (decision.signedApproval) {
        const prepared = await prepareSigned(deps, def, args, call, expiresAt, heldTerms);
        if (!prepared.ok) {
          await releaseHold();
          didNotRun();
          await audit({ event: "approval", skill: def.id, argsHash: call.argsHash, outcome: "denied", reason: `signed.${prepared.reason}` });
          const blocked = SIGNED_BLOCKS[prepared.reason in SIGNED_BLOCKS ? (prepared.reason as keyof typeof SIGNED_BLOCKS) : "approval_terms"];
          emit({ kind: "blocked", skill: def.id, reason: blocked.reason, code: blocked.code });
          messages.push({ role: "tool", content: `Blocked: ${blocked.reason}` });
          continue;
        }
        signed = prepared.signed;
      }
      const request = {
        id: call.id,
        call: { id: call.id, skill: call.skill, argsHash: call.argsHash },
        summary,
        requireBiometric: decision.requireBiometric,
        // The source in words (the sheet words it again in the user's language from taintKind), never a skill id.
        ...(lastTaint ? { taintWarning: `Suggested after reading ${TAINT_WORDS[lastTaint.kind] ?? TAINT_WORDS.inbound_message}`, taintKind: lastTaint.kind } : {}),
        // Q149: why it is asked, in the user's own words: this turn's input as typed, never the model's or a tool's.
        said: userText,
        expiresAt,
        ...(signed ? { signed: signed.request } : {}),
      };
      // A crashed or rejected approval sheet is a no, never an error that skips the audit.
      const asked = Promise.resolve()
        .then(() => (signal ? deps.approvals.request(request, signal) : deps.approvals.request(request)))
        .catch((): ApprovalOutcome => ({ kind: "denied", reason: "approval failed" }));
      // Stopping the turn closes the sheet as denied (FR-LOOP-06); the sheet itself hears it through the signal.
      const outcome = await untilStopped(withTimeout(asked, timeoutMs), signal).catch((): ApprovalOutcome => ({ kind: "denied", reason: "stopped" }));
      if (isStopped()) {
        // Stopped while the sheet was open, or just as it was approved: either way nothing runs.
        await releaseHold();
        await audit({ event: "approval", skill: def.id, argsHash: call.argsHash, outcome: "denied" });
        emit({ kind: "denied", skill: def.id });
        messages.push({ role: "tool", content: "Stopped by the user. Nothing was sent." });
        return halt();
      }
      // Approval binds to the exact arguments, the required biometric, and (when wired) a valid proof. Money and
      // passwords take only the Keystore signature over the exact payload, checked against the enrolled key, once.
      const bound = outcome.kind === "approved" && outcome.argsHash === call.argsHash && (!decision.requireBiometric || outcome.biometric);
      let checked: Awaited<ReturnType<SignedApprovals["verify"]>> | undefined;
      if (signed && bound && outcome.kind === "approved") checked = await deps.signedApprovals!.verify(signed.request, outcome.signature, signed.expected);
      const approved = bound && outcome.kind === "approved" && (signed ? checked?.ok === true : deps.verifyApproval ? deps.verifyApproval(request, outcome) : true);
      await audit({
        event: "approval", skill: def.id, argsHash: call.argsHash,
        outcome: approved ? "ok" : outcome.kind === "expired" ? "expired" : "denied",
        ...(checked?.ok && outcome.kind === "approved" && outcome.signature ? { payloadHash: checked.payloadHash, approvalSig: outcome.signature } : {}),
        ...(checked && !checked.ok ? { reason: `signed.${checked.reason}` } : {}),
      });
      if (approved && checked?.ok && signed) approvedSigned = { payload: signed.request.payload, payloadHash: checked.payloadHash };
      if (!approved) {
        await releaseHold();
        didNotRun();
        emit({ kind: "denied", skill: def.id });
        messages.push({ role: "tool", content: "Not approved. Nothing was sent." });
        continue;
      }
      emit({ kind: "approved", skill: def.id });
      approvedArgsHash = call.argsHash;
      approvedBinding = summary.binding;
    } else if (decision.effect === "allow" && decision.byMode) {
      // Multi-bot (spec 6.4.1): the bot's mode let this step run without a sheet, so it is bound like an approval: code's
      // summary is built, and one that can't be resolved blocks it as it would block the sheet; the approval is logged
      // with the mode as its reason, so Activity can say the step ran rather than that someone approved it; the skill
      // runs with what was approved, the arguments' hash and the binding code resolved.
      const summary = await summarize();
      if (summary.unresolved) {
        await unresolved(summary.unresolved);
        continue;
      }
      // A stop that came in during the render wins before the step is logged as let through.
      if (isStopped()) return stoppedBeforeRun();
      await audit({ event: "approval", skill: def.id, argsHash: call.argsHash, outcome: "ok", reason: `mode.${decision.byMode}` });
      emit({ kind: "approved", skill: def.id, byMode: decision.byMode });
      approvedArgsHash = call.argsHash;
      approvedBinding = summary.binding;
      approvedByMode = decision.byMode;
    }

    // Last point before a side effect: a stop that came in during the cage or the render wins.
    if (isStopped()) return stoppedBeforeRun();
    // The skill owns its reservation from here: it settles it, keeps it pending, or frees it.
    held = undefined;
    // The addresses this call runs with are the model's own: a read that says one back hasn't read it from anyone.
    fromOthers.calling(args);
    // From here the skill runs to its end, success or failure, even if the turn is stopped meanwhile
    // (atomic, FR-LOOP-06); the stop takes effect at the top of the next step.
    let result: SkillResult;
    try {
      result = await runtime.execute(args, {
        session,
        userText,
        ...(call.destination !== undefined ? { destination: call.destination } : {}),
        ...(approvedArgsHash ? { approvedArgsHash } : {}),
        ...(approvedBinding ? { approvedBinding } : {}),
        ...(approvedByMode ? { byMode: approvedByMode } : {}),
        ...(approvedSigned ? { signedApproval: approvedSigned } : {}),
        ...(found.length ? { found } : {}),
      });
    } catch {
      result = { ok: false, modelText: `That failed: ${def.id} couldn't finish. Tell the user plainly.`, untrusted: false };
    }
    emit({ kind: "executed", skill: def.id, ok: result.ok });
    // A fetch reads; only an action that changes something counts for the honesty guard and the stop message.
    const changes = def.risk !== "read" && def.risk !== "network";
    if (changes) writeFailed = !result.ok;
    if (changes && result.ok) afterAction = true;
    if (result.ok) doneThisTurn.add(`${def.id}:${call.argsHash}`);
    await audit({ event: "executed", skill: def.id, argsHash: call.argsHash, outcome: result.ok ? "ok" : "error" });
    // The private-data split (spec 6.4.1): what this session has read, each kind once. A read that failed counts too: it
    // may have read something before it did.
    const kind = readKind(def.group, runtime.source);
    if (kind && !session.reads?.includes(kind)) session.reads = [...(session.reads ?? []), kind];

    const untrusted = result.untrusted ?? def.producesUntrusted;
    // W1: the skill's own answer rides with its result; the model port answers with it once nothing more is owed.
    const answered = result.ok && result.answer ? { answer: result.answer } : {};
    if (untrusted) {
      session.taint.push({ kind: result.taintKind ?? "inbound_message", ref: def.id, at: deps.now() });
      await audit({ event: "taint_added", skill: def.id });
      const seen = redactFound(result.modelText, found);
      if (readsOthers(runtime)) fromOthers.read(result.othersText === undefined ? seen : redactFound(result.othersText, found));
      messages.push({ role: "tool", content: wrapUntrusted(seen, def.id, deps.newId()), untrusted: true, ...answered });
    } else {
      messages.push({ role: "tool", content: redactFound(result.modelText, found), ...answered });
    }
    if (result.reply !== undefined) {
      messages.push(untrusted ? { role: "assistant", content: result.reply, untrusted: true } : { role: "assistant", content: result.reply });
      // A6: a payment's receipt travels apart from the reply (code's facts only), for the chat's receipt card.
      return done({ kind: "final", text: result.reply, ...(result.ok && result.receipt ? { receipt: result.receipt } : {}) });
    }
    if (result.ask) {
      messages.push({ role: "assistant", content: result.ask });
      return done({ kind: "needs_user", question: result.ask });
    }
  }
}

const SUCCESS = /(ha sido|fue|fueron|qued[oó]|est[aá]) (cancelad|guardad|cread|agendad|enviad|reenviad|archivad|marcad|etiquetad|respondid|configurad|borrad|eliminad|programad|anotad|pagad|transferid)|^\s*(listo|hecho|done|sent|paid|forwarded|archived|replied)\b|\b(cancel[eé]|guard[eé]|cre[eé]|agend[eé]|envi[eé]|reenvi[eé]|archiv[eé]|marqu[eé]|etiquet[eé]|respond[ií]|contest[eé]|borr[eé]|elimin[eé]|program[eé]|anot[eé]|pagu[eé]|transfer[ií])(?![a-záéíóúñ])|(has|have) been (cancel|set|saved|sent|paid|transferred|created|deleted|added|scheduled|removed|forwarded|archived|replied|labeled|labelled|marked)|\bi('ve| have) (cancel|set|saved|sent|paid|transferred|created|deleted|added|scheduled|removed|forwarded|archived|replied|labeled|labelled|marked)/i;
const NEGATED = /\bno (pude|se pudo|encontr|logr)|\b(couldn'?t|could not|wasn'?t|was not|didn'?t|did not|unable)\b/i;

/** An answer that says the action happened. */
export function claimsSuccess(text: string): boolean {
  return SUCCESS.test(text) && !NEGATED.test(text);
}

/** The honest answer when a claimed action did not happen, in the language of the user's words. */
function couldNot(userText: string): string {
  const spanish = /[áéíóúñ¿¡]|\b(que|el|la|los|las|de|mi|por|para|recu[eé]rdame|cancela)\b/i.test(userText);
  return spanish ? "No pude hacerlo. ¿Me lo dices de otra forma?" : "I couldn't do that. Could you say it another way?";
}
