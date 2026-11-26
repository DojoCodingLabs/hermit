import {
  argsHash, checkSignIn, classifyClick, CODE_WINDOW_MS, codeFieldIndex, MAX_FAILED_IN_A_ROW, originOf, recipeUrl, sameApprovedElement, sha256Hex, stepRisk, validateRecipe,
  type ApprovalPort, type ApprovalRequest, type ApprovalSummary, type BrowserOutcome, type BrowserPort, type LiveElement, type ProfileKind, type Recipe,
  type RecipeStep, type Risk, type SessionState, type SignedApprovalRequest, type SignInCheck, type SignInFacts, type SkillId, type Target, type ToolCall,
  type FoundCode, type OneTimeCodePort,
} from "@hermit/core";
import {
  decide, FILL_FORM, FILL_LOGIN, SIGNED_APPROVAL_MAX_TTL_MS, WEB_CODE, WEB_PAY, WEB_READ, WEB_REPAIR, WEB_SIGNIN, WEB_STEP, WEB_SUBMIT, WEB_TASK, webTaskRules,
  type AuditInput, type SignedApprovalExpected, type SignedApprovals,
} from "@hermit/cage";
import { dropCode, firstCode, refuseCode, type ArmedCodes } from "./web-code.ts";

/**
 * SL-53 (US-WEB-06 to US-WEB-09, US-WEB-11; FR-WEB-06 to FR-WEB-10): the web task runner. It replays a recipe in the
 * in-app browser with code, never the model, one step at a time, and turns every step into a call the cage decides in
 * the task's own session (never the chat's, but carrying its taint):
 *
 * - Start (`web_task`): the plan on HM-WEB-02 shows the site and every value; the Start tap is the approval.
 * - A step that commits nothing (`web_step`) runs only on the recipe's exact origin.
 * - A committing click is classified on the live element (FR-WEB-07) and asks on HM-APPR-01 with the site, the button
 *   and the values the form would send (`web_submit`); after the approval the element must still be what the sheet
 *   showed (FR-WEB-09), or the action is cancelled.
 * - A pay click (`web_pay`) is never Hermit's in V1 (Q121): the task pauses and the user pays with their own taps.
 * - A login (`fill_login`) is the vault's login for the page's exact origin (FR-VAULT-04), a Keystore-signed
 *   approval (SL-36, SL-37); the sign-in click right after it is covered by that approval. SL-56: when the site has
 *   several logins, it is the one the user chose for that origin (never one the page names), and never another one if
 *   that one is gone; after the sign-in click the page is checked: a password field still there fails the task, a
 *   one-time code or a captcha pauses it for the user on the live page (Hermit never types or solves one), and with
 *   nobody on screen nothing signs in.
 * - SL-56b (Q138): after Hermit's own sign-in click, a one-time code may come from the SMS the user allows in Android's
 *   dialog or from the site's email in a connected account (`web_code`): armed at the click, read only while the task
 *   is paused at its code step, from a message after the click and within five minutes, an email only from the site's
 *   registrable domain with the provider's DMARC or DKIM pass, and never when two codes arrived. The code is shown on
 *   a Keystore-signed `credential` sheet with the exact origin and where it came from, typed only into the page's one
 *   code field on the exact origin (checked in the same page call), never retried, and dropped after the fill. It
 *   never reaches the model, a log, the database or the chat. With no code, a denial or a declined dialog, the user
 *   types it on the page (`verify_yourself`). A captcha is still always the user's.
 * - A profile value (`fill_form`) asks like any form fill (SL-35); a sensitive one is never typed by a task.
 * - Reading the result (`web_read`) hands the page's text to the quarantined reader (FR-WEB-03) and taints the task.
 * - A failed step that commits nothing may call the model once (`web_repair`): it picks one of the page's elements of
 *   that role. That taints the task (the model read the page), so every later step asks, and a password is refused.
 *
 * Bounds (FR-WEB-06): 15 steps (the recipe's validation), stop after 3 failed or no-change actions in a row, stop as
 * soon as the page is on another origin. Take over and stop work at any moment (FR-WEB-08) and are logged.
 */

export const WEB_FIND_TIMEOUT_MS = 8_000;
export const WEB_APPROVAL_TTL_MS = 120_000;

export interface WebTaskDeps {
  browser: BrowserPort;
  approvals: ApprovalPort;
  audit: { append(input: AuditInput): Promise<unknown> };
  now(): number;
  newId(): string;
  /** Copy in the user's language, for the sheet's labels and the steps in words. */
  say(key: string, vars?: Record<string, string>): string;
  /** FR-WEB-03: the quarantined reader, its own model call with no skills. Undefined: no read steps can run. */
  read?(input: { question: string; text: string }): Promise<{ answer: string; quotes: string[] } | undefined>;
  /** One failed step's candidates (the page's names) to the model; the index it picks, or undefined. */
  repair?(input: { step: string; candidates: string[] }): Promise<number | undefined>;
  /** SL-37: Keystore-signed approvals. Without them a login or a sign-in can't be approved (the user signs in). */
  signed?: SignedApprovals;
  /** SL-33: the vault's logins by exact origin, and opening one (its own fingerprint). Never a value in a list. */
  logins?: {
    list(origin: string): Promise<Array<{ id: string; hash: string; name: string }>>;
    open(id: string, origin: string, prompt: string): Promise<{ username: string; secret: string } | undefined>;
    /** SL-56: the item hash the user chose for this exact origin on HM-WEB-02, if they chose one. */
    chosen?(origin: string): Promise<string | undefined>;
  };
  /** SL-35: a plain profile value, or undefined when it is missing or sensitive (never typed by a task). */
  profile?: { value(kind: ProfileKind): Promise<string | undefined> };
  /** Who receives a login's values: Hermit's in-app browser, `android://<cert>@<package>`. */
  requester: string;
  /** True only while Hermit is on screen: a task never runs unattended. */
  onScreen(): boolean;
  /** SL-56b: where a sign-in's one-time code may come from (the SMS consent dialog, the site's email). */
  codes?: OneTimeCodePort[];
  /** How long the other code sources keep looking after the first code (CODE_SETTLE_MS; tests shorten it). */
  codeSettleMs?: number;
}

export type PauseReason =
  /** The user tapped Take over. */
  | "take_over"
  /** A pay click (Q121): the user pays themselves. */
  | "pay_yourself"
  /** No vault login for this exact origin, more than one, a tainted task, or a refused signature. */
  | "sign_in_yourself"
  /** A value Hermit can't type (a sensitive profile field, or a denied one). */
  | "type_yourself"
  /** A step Hermit couldn't do (the element is gone and couldn't be repaired). */
  | "do_step"
  /** SL-56: the site asks for a one-time code or a captcha after the sign-in; the user does it on the page. */
  | "verify_yourself"
  /** SL-56: the page after the sign-in can't be read; the user checks they are signed in. */
  | "check_sign_in"
  /** SL-56b: the site asks for a code and Hermit waits for it by SMS or email; the user may type it themselves. */
  | "code_wait";

/** `signin_failed` (SL-56): the site still shows its password field after the sign-in. */
export type FailReason = "denied" | "changed" | "left_site" | "stuck" | "blocked" | "failed" | "signin_failed";

export interface StepWords {
  key: string;
  vars: Record<string, string>;
}

export type WebTaskState =
  | { kind: "ready" }
  | { kind: "running"; step: number; total: number; doing: StepWords }
  | { kind: "paused"; step: number; total: number; reason: PauseReason; doing: StepWords }
  | { kind: "finished"; end: WebTaskEnd };

export type WebTaskEnd =
  | { kind: "done"; answer?: { text: string; quotes: string[]; untrusted: true }; repaired: number }
  | { kind: "failed"; reason: FailReason; step: number }
  | { kind: "stopped" }
  | { kind: "refused"; reason: "missing_value" | "invalid" | "blocked" | "busy" };

export interface WebTaskPlan {
  site: string;
  origin: string;
  steps: StepWords[];
  /** Required parameters with no value yet. */
  missing: string[];
}

export interface WebTask {
  readonly id: string;
  plan(values: Record<string, string>): WebTaskPlan;
  /** Runs the task to its end. `values` are what the plan shows, as the user confirmed them. */
  start(values: Record<string, string>): Promise<WebTaskEnd>;
  takeOver(): void;
  resume(): void;
  stop(): void;
  state(): WebTaskState;
  subscribe(fn: (s: WebTaskState) => void): () => void;
  /** After a run with repaired steps: the recipe with the new targets, one version up, for the user to save or not. */
  repairedRecipe(): Recipe | undefined;
}

const hostOfOrigin = (origin: string) => origin.replace(/^https?:\/\//, "");

/** How a step reads in words, for the plan and the live line. Values come from the recipe and the user, never a page. */
export function stepWords(recipe: Recipe, step: RecipeStep, values: Record<string, string>): StepWords {
  const site = hostOfOrigin(recipe.origin);
  const valueOf = (v: Extract<RecipeStep, { op: "fill" }>["value"]) =>
    "param" in v ? values[v.param] ?? "" : "literal" in v ? v.literal : `profile:${v.profile}`;
  switch (step.op) {
    case "open":
      return { key: "HM-WEB-02.step.open", vars: { site, path: step.path } };
    case "fill":
    case "select": {
      // A value not set yet (the plan before the user picks one) reads as the choice to make, never as an empty quote.
      const value = valueOf(step.value);
      const key = step.op === "fill" ? "fill" : "select";
      return value.trim()
        ? { key: `HM-WEB-02.step.${key}`, vars: { field: step.target.name, value } }
        : { key: `HM-WEB-02.step.${key}Unset`, vars: { field: step.target.name } };
    }
    case "check":
      return { key: step.on ? "HM-WEB-02.step.check" : "HM-WEB-02.step.uncheck", vars: { field: step.target.name } };
    case "click": {
      const key = step.commit === "spend" ? "pay" : step.commit === "credential" ? "signin" : step.commit === "remote_write" ? "submit" : "click";
      return { key: `HM-WEB-02.step.${key}`, vars: { name: step.target.name } };
    }
    case "wait":
      return { key: "HM-WEB-02.step.wait", vars: { name: step.target.name } };
    case "read":
      return { key: "HM-WEB-02.step.read", vars: { question: step.question } };
    case "login":
      return { key: "HM-WEB-02.step.login", vars: { site } };
  }
}

class Stopped extends Error {}

export function createWebTask(deps: WebTaskDeps, input: { recipe: Recipe; sessionId: string }): WebTask {
  const id = deps.newId();
  const recipe = input.recipe;
  const total = recipe.steps.length;
  // The task's own session: the Start tap is the user's act on a plan they checked, so it starts untainted (like a fill).
  const session: SessionState = { id: `web:${id}`, taint: [], unattended: false };
  const listeners = new Set<(s: WebTaskState) => void>();
  let current: WebTaskState = { kind: "ready" };
  let started = false;
  let stopped = false;
  let pauseWanted = false;
  let waiters: Array<() => void> = [];
  const abort = new AbortController();
  const repairs = new Map<number, Target>();

  const emit = (s: WebTaskState) => {
    current = s;
    for (const fn of [...listeners]) fn(s);
  };
  const site = hostOfOrigin(recipe.origin);
  const taskHash = sha256Hex(`web_task:${id}`);
  const userAct = (reason: string) =>
    deps.audit.append({ ts: deps.now(), sessionId: session.id, event: "web_task", skill: "web_task", argsHash: taskHash, outcome: "ok", reason });

  /** Waits while paused; throws Stopped once the user stopped. */
  async function checkpoint(step: number, doing: StepWords, reason?: PauseReason) {
    if (stopped) throw new Stopped();
    if (reason) pauseWanted = true;
    if (!pauseWanted) return;
    emit({ kind: "paused", step, total, reason: reason ?? "take_over", doing });
    while (pauseWanted && !stopped) await new Promise<void>((r) => waiters.push(r));
    if (stopped) throw new Stopped();
  }

  type Logged = Omit<AuditInput, "ts" | "sessionId" | "skill" | "argsHash">;
  const logFor = (call: ToolCall) => (entry: Logged) => deps.audit.append({ ts: deps.now(), sessionId: session.id, skill: call.skill, argsHash: call.argsHash, ...entry });
  const callOf = (skill: SkillId, args: Record<string, unknown>): ToolCall => ({ id: deps.newId(), skill, args, argsHash: argsHash(args), repairs: [] });

  const taintWarning = () => (session.taint.length ? deps.say("HM-WEB-02.sheet.tainted", { site }) : undefined);

  /**
   * One call through the cage: proposed, decided, and when it asks, the sheet (or `askedBy` for an approval given
   * elsewhere: the plan's Start tap, the login a sign-in follows). Returns whether it may run and its logger.
   */
  async function gate(skill: SkillId, risk: Risk, args: Record<string, unknown>, summary: ApprovalSummary, opts: {
    askedBy?: string;
    signedTerms?: SignedApprovalExpected["terms"];
  } = {}): Promise<{ ok: true; log: (e: Logged) => Promise<unknown>; call: ToolCall } | { ok: false; why: "denied" | "blocked" | "key"; log: (e: Logged) => Promise<unknown> }> {
    const call = callOf(skill, args);
    const log = logFor(call);
    await log({ event: "call_proposed" });
    session.unattended = !deps.onScreen();
    const decision = decide(call, risk, session, webTaskRules());
    await log({ event: "policy_decided", decision: decision.effect });
    if (decision.effect === "deny") return { ok: false, why: "blocked", log };
    if (decision.effect === "allow") return { ok: true, log, call };
    if (opts.askedBy) {
      await log({ event: "approval", decision: "ask", outcome: "ok", reason: opts.askedBy });
      return { ok: true, log, call };
    }
    const expiresAt = deps.now() + (decision.signedApproval ? Math.min(WEB_APPROVAL_TTL_MS, SIGNED_APPROVAL_MAX_TTL_MS) : WEB_APPROVAL_TTL_MS);
    let signed: { request: SignedApprovalRequest; expected: SignedApprovalExpected } | undefined;
    if (decision.signedApproval) {
      const expected: SignedApprovalExpected = { risk: risk as "credential", skill, requestId: call.id, argsHash: call.argsHash, terms: opts.signedTerms ?? {} };
      const prepared = deps.signed
        ? await deps.signed.prepare({ ...expected, expiresAt }).catch(() => ({ ok: false as const, reason: "key_lost" as const }))
        : { ok: false as const, reason: "key_none" as const };
      if (!prepared.ok) {
        await log({ event: "approval", decision: "ask", outcome: "denied", reason: `signed.${prepared.reason}` });
        return { ok: false, why: "key", log };
      }
      signed = { request: prepared.request, expected };
    }
    const warning = taintWarning();
    const request: ApprovalRequest = {
      id: call.id,
      call: { id: call.id, skill: call.skill, argsHash: call.argsHash },
      summary,
      requireBiometric: decision.requireBiometric,
      ...(warning ? { taintWarning: warning } : {}),
      expiresAt,
      ...(signed ? { signed: signed.request } : {}),
    };
    const outcome = await deps.approvals.request(request, abort.signal);
    if (stopped) {
      await log({ event: "approval", decision: "ask", outcome: "denied" });
      throw new Stopped();
    }
    const bound = outcome.kind === "approved" && outcome.argsHash === call.argsHash && (!decision.requireBiometric || outcome.biometric);
    let checked: Awaited<ReturnType<SignedApprovals["verify"]>> | undefined;
    if (signed && bound && outcome.kind === "approved") {
      checked = await deps.signed!.verify(signed.request, outcome.signature, signed.expected).catch(() => ({ ok: false as const, reason: "key_lost" as const }));
    }
    const approved = bound && (!signed || checked?.ok === true);
    await log({
      event: "approval",
      decision: "ask",
      outcome: approved ? "ok" : outcome.kind === "expired" ? "expired" : "denied",
      ...(checked?.ok && outcome.kind === "approved" && outcome.signature ? { payloadHash: checked.payloadHash, approvalSig: outcome.signature } : {}),
      ...(checked && !checked.ok ? { reason: `signed.${checked.reason}` } : {}),
    });
    return approved ? { ok: true, log, call } : { ok: false, why: "denied", log };
  }

  const lines = (...extra: ApprovalSummary["lines"]): ApprovalSummary["lines"] => [{ label: deps.say("HM-WEB-02.sheet.site"), value: site }, ...extra];

  async function onOrigin(): Promise<string | undefined> {
    const origin = originOf(await deps.browser.url());
    return origin === recipe.origin ? origin : undefined;
  }

  async function addTaint(log: (e: Logged) => Promise<unknown>) {
    session.taint.push({ kind: "web", ref: recipe.origin, at: deps.now() });
    await log({ event: "taint_added" });
  }

  /** The model picks one of the page's elements of this role for a failed step that commits nothing. */
  async function repairTarget(index: number, step: Extract<RecipeStep, { target: Target }>, words: StepWords): Promise<Target | undefined> {
    if (!deps.repair || (step.op === "click" && step.commit)) return undefined;
    const candidates = (await deps.browser.candidates(step.target.role)).filter((c) => !c.disabled);
    if (!candidates.length) return undefined;
    const g = await gate(WEB_REPAIR, "read", { origin: recipe.origin, step: index, role: step.target.role }, { title: "", lines: [] });
    if (!g.ok) return undefined;
    await addTaint(g.log);
    const pick = await deps.repair({ step: deps.say(words.key, words.vars), candidates: candidates.map((c) => c.name) }).catch(() => undefined);
    const chosen = pick !== undefined && Number.isInteger(pick) ? candidates[pick] : undefined;
    // A repair never commits: a committing candidate is refused, and the user does the step.
    if (!chosen || (step.op === "click" && classifyClick(chosen))) {
      await g.log({ event: "executed", outcome: "error", reason: "web.repair_refused" });
      return undefined;
    }
    await g.log({ event: "executed", outcome: "ok" });
    const target = { role: chosen.role, name: chosen.name, nth: chosen.nth };
    repairs.set(index, target);
    return target;
  }

  /** Finds the step's element, repairing the target once if it is gone. */
  async function locate(index: number, step: Extract<RecipeStep, { target: Target }>, words: StepWords): Promise<{ target: Target; element: LiveElement } | undefined> {
    const found = await deps.browser.find(step.target, WEB_FIND_TIMEOUT_MS);
    if (found) return { target: step.target, element: found };
    const target = await repairTarget(index, step, words);
    if (!target) return undefined;
    const again = await deps.browser.find(target, WEB_FIND_TIMEOUT_MS);
    return again ? { target, element: again } : undefined;
  }

  /** SL-56b: whether the cage would let a code be typed now (never with nobody on screen, never in a tainted task). */
  function codeAllowed(): boolean {
    session.unattended = !deps.onScreen();
    const probe = callOf(WEB_CODE, { origin: recipe.origin, taskOrigin: recipe.origin });
    return decide(probe, "credential", session, webTaskRules()).effect !== "deny";
  }

  /** SL-56b: arms the code sources right before Hermit's own sign-in click. Nothing is read until the code step. */
  function armCodes(): ArmedCodes | undefined {
    if (!deps.codes?.length || !codeAllowed()) return undefined;
    const since = deps.now();
    const watches = deps.codes.flatMap((src) => {
      try {
        const w = src.arm({ origin: recipe.origin, since });
        return w ? [w] : [];
      } catch {
        return [];
      }
    });
    return watches.length ? { since, watches } : undefined;
  }

  const cancelCodes = (armed: ArmedCodes | undefined) => {
    for (const w of armed?.watches ?? []) {
      try {
        w.cancel();
      } catch {
        // A source that can't stop has nothing left to give: the watch is dropped either way.
      }
    }
  };

  /**
   * SL-56b: the code step. The task pauses (`code_wait`) while the sources look; the user may type the code on the page
   * and tap Resume instead (`user`). A code is shown on a signed `credential` sheet and typed into the one code field;
   * `fallback` means the user types it (`verify_yourself`). Every refusal is logged by its reason, never the code.
   */
  async function typeCode(step: number, doing: StepWords, facts: SignInFacts, armed: ArmedCodes, log: (e: Logged) => Promise<unknown>):
    Promise<"typed" | "user" | "fallback" | WebTaskEnd> {
    const fallback = async (reason: string) => {
      await log({ event: "executed", outcome: "error", reason: `web.code_${reason}` });
      return "fallback" as const;
    };
    const field = codeFieldIndex(facts);
    if (field === undefined) return fallback("no_field");
    if (!codeAllowed()) return fallback("blocked");
    const until = armed.since + CODE_WINDOW_MS;

    // Paused at the code step: only now does any source read a message.
    const ctl = new AbortController();
    const onStop = () => ctl.abort();
    abort.signal.addEventListener("abort", onStop);
    let wake!: () => void;
    const byUser = new Promise<"user">((r) => (wake = () => r("user")));
    pauseWanted = true;
    waiters.push(wake);
    emit({ kind: "paused", step, total, reason: "code_wait", doing });
    let found: FoundCode | undefined;
    try {
      const got = await Promise.race([byUser, firstCode(armed.watches, until, ctl.signal, deps.codeSettleMs).then((r) => ({ r }))]);
      waiters = waiters.filter((w) => w !== wake);
      ctl.abort();
      cancelCodes(armed);
      if (stopped) throw new Stopped();
      if (got === "user") {
        await log({ event: "executed", outcome: "ok", reason: "web.code_by_user" });
        return "user";
      }
      pauseWanted = false;
      if (got.r === "refused") return await fallback("refused");
      if (got.r === "ambiguous") return await fallback("ambiguous");
      if (got.r === undefined) return await fallback("none");
      found = got.r;
      const refusal = refuseCode(found, armed, recipe.origin);
      if (refusal) return await fallback(refusal);
      if (!(await onOrigin())) {
        await log({ event: "executed", outcome: "error", reason: "web.left_site" });
        return { kind: "failed", reason: "left_site", step };
      }
      emit({ kind: "running", step, total, doing });

      // The sheet shows the exact origin, where the code came from and the code itself, so the user can compare. The
      // args carry a salted hash of the code, so the log's args hash can't be matched against the few million codes.
      const salt = deps.newId();
      const args = {
        origin: recipe.origin, taskOrigin: recipe.origin, requester: deps.requester, field, via: found.via,
        ...(found.via === "email" ? { sender: found.sender, verified: found.verified } : {}),
        code: sha256Hex(`web_code|${salt}|${found.code}`),
      };
      // An SMS: its sender when the platform gives one, and the message itself, for the user's eyes only.
      const from = found.via === "sms"
        ? [
            { label: deps.say("HM-WEB-02.sheet.codeFrom"), value: found.sender ?? deps.say("HM-WEB-02.sheet.fromSms") },
            { label: deps.say("HM-WEB-02.sheet.message"), value: found.text.slice(0, 400) },
          ]
        : [
            { label: deps.say("HM-WEB-02.sheet.codeFrom"), value: found.sender },
            { label: deps.say("HM-WEB-02.sheet.senderCheck"), value: deps.say(`HM-WEB-02.sheet.verified.${found.verified!}`) },
          ];
      const g = await gate(WEB_CODE, "credential", args, {
        title: deps.say("HM-WEB-02.code.title", { site }),
        lines: [{ label: deps.say("HM-WEB-02.sheet.typedInto"), value: recipe.origin }, ...from, { label: deps.say("HM-WEB-02.sheet.code"), value: found.code }],
      }, { signedTerms: { origin: recipe.origin, requester: deps.requester } });
      if (!g.ok) return "fallback";
      if (!deps.onScreen()) return await fallback("blocked");
      if (!(await onOrigin())) {
        await g.log({ event: "executed", outcome: "error", reason: "web.left_site" });
        return { kind: "failed", reason: "left_site", step };
      }
      const f = facts.fields[field]!;
      // The page checks the origin, the top frame and that the field is still this one in the same call that types.
      const o = await deps.browser.fillCode({ code: found.code, origin: recipe.origin, field, expect: { autocomplete: f.autocomplete, name: f.name, label: f.label } });
      dropCode(found);
      const stayed = await onOrigin();
      if ((!o.ok && o.reason === "off_origin") || !stayed) {
        await g.log({ event: "executed", outcome: "error", reason: "web.left_site" });
        return { kind: "failed", reason: "left_site", step };
      }
      await g.log({ event: "executed", outcome: o.ok ? "ok" : "error", ...(o.ok ? {} : { reason: `web.code_${o.reason}` }) });
      return o.ok ? "typed" : "fallback";
    } finally {
      dropCode(found);
      abort.signal.removeEventListener("abort", onStop);
    }
  }

  /**
   * SL-56: the page after a sign-in (Hermit's covered click, or the user's own). Undefined when signed in; otherwise
   * how the task ends. A code or a captcha pauses for the user, then the page is read again; a page that can't be read
   * pauses once for the user to check, and their Resume is the answer. Nothing waits with nobody on screen. SL-56b:
   * after Hermit's own click, a code may first be taken from the armed sources, once; a wrong one is never retried.
   */
  async function confirmSignIn(step: number, doing: StepWords, log: (e: Logged) => Promise<unknown>, byUser: boolean, armed?: ArmedCodes): Promise<WebTaskEnd | undefined> {
    let looked = byUser;
    let paused = false;
    let codeTried = false;
    try {
      for (;;) {
        const facts = await deps.browser.signInFacts().catch(() => undefined);
        const check: SignInCheck | "unknown" = facts ? checkSignIn(facts) : "unknown";
        if (check === "signed_in" || (check === "unknown" && looked)) {
          if (paused) await log({ event: "executed", outcome: "ok", reason: "web.signed_in" });
          return undefined;
        }
        if (check === "rejected") {
          await log({ event: "executed", outcome: "error", reason: "web.signin_rejected" });
          return { kind: "failed", reason: "signin_failed", step };
        }
        await log({ event: "executed", outcome: "error", reason: `web.signin_${check}` });
        if (!deps.onScreen()) return { kind: "failed", reason: "blocked", step };
        if (check === "code" && armed && facts && !codeTried) {
          codeTried = true;
          const r = await typeCode(step, doing, facts, armed, log);
          if (typeof r === "object") return r;
          if (r !== "fallback") {
            paused = true;
            looked = r === "user";
            if (!(await onOrigin())) {
              await log({ event: "executed", outcome: "error", reason: "web.left_site" });
              return { kind: "failed", reason: "left_site", step };
            }
            continue;
          }
          if (!deps.onScreen()) return { kind: "failed", reason: "blocked", step };
        }
        paused = true;
        await checkpoint(step, doing, check === "unknown" ? "check_sign_in" : "verify_yourself");
        looked = true;
        if (!(await onOrigin())) {
          await log({ event: "executed", outcome: "error", reason: "web.left_site" });
          return { kind: "failed", reason: "left_site", step };
        }
      }
    } finally {
      cancelCodes(armed);
    }
  }

  return {
    id,
    plan(values) {
      return {
        site,
        origin: recipe.origin,
        steps: recipe.steps.map((s) => stepWords(recipe, s, values)),
        missing: recipe.params.filter((p) => p.required && !values[p.name]?.trim()).map((p) => p.name),
      };
    },
    state: () => current,
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    repairedRecipe() {
      if (!repairs.size) return undefined;
      const steps = recipe.steps.map((s, i) => {
        const t = repairs.get(i);
        return t && "target" in s ? { ...s, target: t } : s;
      });
      return { ...recipe, steps, version: recipe.version + 1, updatedAt: deps.now() };
    },
    takeOver() {
      if (stopped || pauseWanted || current.kind === "finished") return;
      pauseWanted = true;
      void userAct("web.taken_over");
    },
    resume() {
      if (!pauseWanted || stopped) return;
      pauseWanted = false;
      void userAct("web.resumed");
      const w = waiters;
      waiters = [];
      for (const r of w) r();
    },
    stop() {
      if (stopped || current.kind === "finished") return;
      stopped = true;
      abort.abort();
      void userAct("web.stopped");
      const w = waiters;
      waiters = [];
      for (const r of w) r();
    },

    async start(values) {
      if (started) return { kind: "refused", reason: "busy" };
      started = true;
      const finish = (end: WebTaskEnd): WebTaskEnd => {
        emit({ kind: "finished", end });
        return end;
      };
      if (!validateRecipe(recipe).ok) return finish({ kind: "refused", reason: "invalid" });
      const clean: Record<string, string> = {};
      for (const p of recipe.params) {
        const v = values[p.name]?.trim();
        if (v) clean[p.name] = v;
      }
      if (recipe.params.some((p) => p.required && !clean[p.name])) return finish({ kind: "refused", reason: "missing_value" });

      // The Start tap on the plan, which showed the site and every value, is the approval for opening the site.
      const startUrl = recipeUrl(recipe, (recipe.steps[0] as Extract<RecipeStep, { op: "open" }>).path);
      const opened = await gate(WEB_TASK, "network", { url: startUrl, recipe: recipe.id, version: recipe.version, values: clean }, { title: recipe.name, lines: lines() }, { askedBy: "plan.start" });
      if (!opened.ok) return finish({ kind: "refused", reason: "blocked" });

      let failedInARow = 0;
      let answer: { text: string; quotes: string[]; untrusted: true } | undefined;
      let loginCovers = false;
      /** SL-56: the user signed in on the page themselves, so the recipe's own sign-in click is theirs, already done. */
      let userSignedIn = false;
      /** Counts an action's outcome; true when the task must stop (FR-WEB-06). */
      const count = (o: BrowserOutcome) => {
        failedInARow = o.ok && o.changed ? 0 : failedInARow + 1;
        return failedInARow >= MAX_FAILED_IN_A_ROW;
      };

      try {
        for (const [i, step] of recipe.steps.entries()) {
          const doing = stepWords(recipe, step, clean);
          await checkpoint(i, doing);
          emit({ kind: "running", step: i, total, doing });
          const coveredByLogin = loginCovers;
          loginCovers = false;
          const signedInByUser = userSignedIn;
          userSignedIn = false;

          if (i > 0 && !(await onOrigin())) {
            await opened.log({ event: "executed", outcome: "error", reason: "web.left_site" });
            return finish({ kind: "failed", reason: "left_site", step: i });
          }

          if (step.op === "open") {
            const url = recipeUrl(recipe, step.path);
            const g = await gate(WEB_STEP, "network", { op: "open", url, origin: recipe.origin, taskOrigin: recipe.origin }, { title: recipe.name, lines: lines({ label: deps.say("HM-WEB-02.sheet.step"), value: deps.say(doing.key, doing.vars) }) });
            if (!g.ok) return finish({ kind: "failed", reason: g.why === "denied" ? "denied" : "blocked", step: i });
            const o = await deps.browser.open(url);
            await g.log({ event: "executed", outcome: o.ok ? "ok" : "error" });
            if (!(await onOrigin())) return finish({ kind: "failed", reason: "left_site", step: i });
            if (count(o)) return finish({ kind: "failed", reason: "stuck", step: i });
            continue;
          }

          if (step.op === "read") {
            const g = await gate(WEB_READ, "read", { origin: recipe.origin, step: i }, { title: "", lines: [] });
            if (!g.ok || !deps.read) return finish({ kind: "failed", reason: "blocked", step: i });
            const text = await deps.browser.snapshot();
            // The page's words reached a model: the task is tainted from here on (FR-CAGE-04).
            await addTaint(g.log);
            const got = await deps.read({ question: step.question, text }).catch(() => undefined);
            await g.log({ event: "executed", outcome: got ? "ok" : "error" });
            if (got) answer = { text: got.answer, quotes: got.quotes, untrusted: true };
            continue;
          }

          if (step.op === "login") {
            const origin = recipe.origin;
            // Nobody on screen (a night run, or the user left): never a login, and nobody to sign in by hand either.
            if (!deps.onScreen()) {
              await opened.log({ event: "executed", outcome: "error", reason: "web.signin_unattended" });
              return finish({ kind: "failed", reason: "blocked", step: i });
            }
            /** The user signs in on the page; then the page is checked like Hermit's own sign-in. */
            const byHand = async (): Promise<WebTaskEnd | undefined> => {
              await checkpoint(i, doing, "sign_in_yourself");
              if (!(await onOrigin())) return { kind: "failed", reason: "left_site", step: i };
              const end = await confirmSignIn(i, doing, opened.log, true);
              if (!end) userSignedIn = true;
              return end;
            };
            const items = deps.logins ? await deps.logins.list(origin) : [];
            // The item the user chose for this exact origin; with no choice, the only one. Never a fallback.
            const chosen = deps.logins?.chosen ? await deps.logins.chosen(origin) : undefined;
            const item = chosen !== undefined ? items.find((x) => x.hash === chosen) : items.length === 1 ? items[0] : undefined;
            if (!item) {
              const end = await byHand();
              if (end) return finish(end);
              continue;
            }
            const args = { item: item.hash, origin, requester: deps.requester, fields: ["username", "password"] };
            const g = await gate(FILL_LOGIN, "credential", args, { title: recipe.name, lines: lines({ label: deps.say("HM-WEB-02.sheet.login"), value: item.name }) }, {
              signedTerms: { origin, item: item.hash, requester: deps.requester },
            });
            if (!g.ok) {
              if (session.unattended) return finish({ kind: "failed", reason: "blocked", step: i });
              const end = await byHand();
              if (end) return finish(end);
              continue;
            }
            const secrets = await deps.logins!.open(item.id, origin, deps.say("HM-WEB-02.loginPrompt", { site })).catch(() => undefined);
            if (!secrets || !(await onOrigin())) {
              await g.log({ event: "executed", outcome: "error", reason: secrets ? "web.left_site" : "vault.cancelled" });
              const end = await byHand();
              if (end) return finish(end);
              continue;
            }
            // The page checks the origin in the same call that fills (a navigation after the check above fills
            // nothing), and the address is read again right after: any mismatch stops the task.
            const o = await deps.browser.fillLogin({ username: secrets.username, password: secrets.secret, origin });
            const stayed = await onOrigin();
            if ((!o.ok && o.reason === "off_origin") || !stayed) {
              await g.log({ event: "executed", outcome: "error", reason: "web.left_site" });
              return finish({ kind: "failed", reason: "left_site", step: i });
            }
            await g.log({ event: "executed", outcome: o.ok ? "ok" : "error" });
            loginCovers = o.ok;
            if (count(o)) return finish({ kind: "failed", reason: "stuck", step: i });
            continue;
          }

          // SL-56: the user already signed in on the page, so the recipe's sign-in click is not Hermit's to do.
          if (signedInByUser && step.op === "click" && step.commit === "credential") continue;

          // Steps on an element.
          const found = await locate(i, step, doing);
          if (!found) {
            failedInARow += 1;
            if (failedInARow >= MAX_FAILED_IN_A_ROW) return finish({ kind: "failed", reason: "stuck", step: i });
            if (step.op !== "wait") await checkpoint(i, doing, "do_step");
            continue;
          }
          const { target, element } = found;
          if (step.op === "wait") {
            failedInARow = 0;
            continue;
          }

          if (step.op === "fill" || step.op === "select") {
            let value: string | undefined;
            let g: Awaited<ReturnType<typeof gate>>;
            if ("profile" in step.value) {
              const kind = step.value.profile;
              value = deps.profile ? await deps.profile.value(kind) : undefined;
              if (value === undefined) {
                await checkpoint(i, doing, "type_yourself");
                continue;
              }
              // A profile value leaves Hermit for the site: the profile's own approval, with the field and the value.
              g = await gate(FILL_FORM, "send", { requester: recipe.origin, fields: [{ key: target.name, kind }], sensitive: false }, {
                title: recipe.name, lines: lines({ label: target.name, value }),
              });
              if (!g.ok) {
                await checkpoint(i, doing, "type_yourself");
                continue;
              }
            } else {
              value = "param" in step.value ? clean[step.value.param] : step.value.literal;
              if (value === undefined) continue; // An optional value the user left empty: nothing to type.
              g = await gate(WEB_STEP, "network", { op: step.op, target, origin: recipe.origin, taskOrigin: recipe.origin, value }, {
                title: recipe.name, lines: lines({ label: target.name, value }),
              });
              if (!g.ok) return finish({ kind: "failed", reason: g.why === "denied" ? "denied" : "blocked", step: i });
            }
            const o = step.op === "fill" ? await deps.browser.fill(target, value) : await deps.browser.select(target, value);
            await g.log({ event: "executed", outcome: o.ok ? "ok" : "error" });
            if (count(o)) return finish({ kind: "failed", reason: "stuck", step: i });
            continue;
          }

          if (step.op === "check") {
            const g = await gate(WEB_STEP, "network", { op: "check", target, on: step.on, origin: recipe.origin, taskOrigin: recipe.origin }, {
              title: recipe.name, lines: lines({ label: deps.say("HM-WEB-02.sheet.step"), value: deps.say(doing.key, doing.vars) }),
            });
            if (!g.ok) return finish({ kind: "failed", reason: g.why === "denied" ? "denied" : "blocked", step: i });
            const o = await deps.browser.check(target, step.on);
            await g.log({ event: "executed", outcome: o.ok ? "ok" : "error" });
            if (count(o)) return finish({ kind: "failed", reason: "stuck", step: i });
            continue;
          }

          // A click: classified on the live element, the stricter of that and what the recipe recorded.
          const risk = stepRisk(step.op === "click" ? { ...step, target } : step, element);
          const origin = recipe.origin;
          const button = { label: deps.say("HM-WEB-02.sheet.button"), value: element.name };
          const sent = (element.form?.fields ?? []).map((f) => ({ label: f.label, value: f.secret ? "••••" : f.value }));
          const amounts = element.nearby && /\d/.test(element.nearby) ? [{ label: deps.say("HM-WEB-02.sheet.nearby"), value: element.nearby.slice(0, 120) }] : [];

          // A form that sends to another site is refused before anything asks: Android doesn't let the browser hold a
          // form POST to the origin, and the values would be gone before the page landed elsewhere. The action is the
          // effective one (a submit button's formaction wins over the form's), and so is the target: a response that
          // opens in another window is out of the task's sight, so it is refused the same way.
          const action = element.form?.action;
          if (action && originOf(action) !== origin) {
            await opened.log({ event: "executed", outcome: "error", reason: "web.form_off_site" });
            return finish({ kind: "failed", reason: "left_site", step: i });
          }
          const formTarget = (element.form?.target ?? "").trim().toLowerCase();
          if (element.form && formTarget !== "" && formTarget !== "_self") {
            await opened.log({ event: "executed", outcome: "error", reason: "web.form_new_window" });
            return finish({ kind: "failed", reason: "left_site", step: i });
          }

          if (risk === "spend") {
            const g = await gate(WEB_PAY, "spend", { origin, target }, { title: recipe.name, lines: lines(button) });
            if (g.ok) throw new Error("web_pay is never allowed in V1");
            await checkpoint(i, doing, "pay_yourself");
            continue;
          }

          let g: Awaited<ReturnType<typeof gate>>;
          if (risk === "credential") {
            g = await gate(WEB_SIGNIN, "credential", { origin, target }, { title: recipe.name, lines: lines(button) }, {
              ...(coveredByLogin ? { askedBy: "login.covered" } : {}),
              signedTerms: { origin, requester: deps.requester },
            });
            if (!g.ok) {
              await checkpoint(i, doing, "sign_in_yourself");
              continue;
            }
          } else if (risk === "remote_write") {
            g = await gate(WEB_SUBMIT, "remote_write", { origin, target, fields: sent }, { title: recipe.name, lines: lines(button, ...sent, ...amounts) });
            if (!g.ok) return finish({ kind: "failed", reason: g.why === "denied" ? "denied" : "blocked", step: i });
          } else {
            g = await gate(WEB_STEP, "network", { op: "click", target, origin, taskOrigin: origin }, {
              title: recipe.name, lines: lines({ label: deps.say("HM-WEB-02.sheet.step"), value: deps.say("HM-WEB-02.step.click", { name: element.name }) }),
            });
            if (!g.ok) return finish({ kind: "failed", reason: g.why === "denied" ? "denied" : "blocked", step: i });
          }

          // FR-WEB-09: after an approval, the element must still be what the sheet showed.
          if (risk) {
            const now = await deps.browser.find(target, WEB_FIND_TIMEOUT_MS);
            const nowOrigin = originOf(await deps.browser.url());
            if (!now || !nowOrigin || !sameApprovedElement({ element, origin }, { element: now, origin: nowOrigin })) {
              await g.log({ event: "executed", outcome: "error", reason: "web.changed" });
              return finish({ kind: "failed", reason: "changed", step: i });
            }
          }
          // SL-56b: the code sources are armed right before Hermit's own sign-in click, so no earlier message counts.
          const armed = risk === "credential" ? armCodes() : undefined;
          let o: BrowserOutcome;
          try {
            o = await deps.browser.click(target);
          } catch (err) {
            cancelCodes(armed);
            throw err;
          }
          await g.log({ event: "executed", outcome: o.ok ? "ok" : "error" });
          const early: WebTaskEnd | undefined = !(await onOrigin())
            ? { kind: "failed", reason: "left_site", step: i }
            : count(o) ? { kind: "failed", reason: "stuck", step: i } : undefined;
          if (early || !(risk === "credential" && o.ok)) cancelCodes(armed);
          if (early) return finish(early);
          // SL-56: a sign-in is done only when the page says so; a refusal never reads as done.
          if (risk === "credential" && o.ok) {
            const end = await confirmSignIn(i, doing, g.log, false, armed);
            if (end) return finish(end);
          }
        }
        await opened.log({ event: "executed", outcome: "ok" });
        return finish({ kind: "done", ...(answer ? { answer } : {}), repaired: repairs.size });
      } catch (err) {
        if (err instanceof Stopped) return finish({ kind: "stopped" });
        await opened.log({ event: "executed", outcome: "error", reason: "web.failed" }).catch(() => {});
        return finish({ kind: "failed", reason: "failed", step: current.kind === "running" ? current.step : -1 });
      }
    },
  };
}
