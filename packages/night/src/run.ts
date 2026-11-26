import { argsHash, formatLocalTime, skillId, type SessionState, type SkillId, type TaintSource } from "@hermit/core";
import { decide, type AuditInput, type PolicyRule } from "@hermit/cage";
import { wrapUntrusted, type AuditSink, type SkillResult, type SkillRuntime } from "@hermit/agent";
import { catchUpItems, mailCountLine, mailReply } from "@hermit/model";
import { emailOf } from "@hermit/skills";
import type { Briefing, BriefingItem, BriefingSection, JobReport, Refusal, Suggestion } from "./briefing.ts";
import { blockers, type DeviceState, type PauseReason } from "./conditions.ts";
import { nightRules } from "./rules.ts";
import { briefingDate, inWindow, JOB_NEEDS_NETWORK, type NightJobId, type NightSettings } from "./settings.ts";

export interface NightReaderInput {
  /** A fixed question written by code, in the user's language. */
  question: string;
  /** Other people's text, still inside its <untrusted> wrapper. */
  untrusted: string;
  source: string;
  language: "es-419" | "en";
}

/** The quarantined reader (FR-WEB-03): its own model call, no skills, no memory, no history. */
export type NightReader = (input: NightReaderInput) => Promise<{ answer: string; quotes: string[] } | undefined>;

export interface NightDeps {
  /** The same skill runtimes as the chat. The night shift runs only reads; everything else is proposed. */
  skills: readonly SkillRuntime[];
  audit: AuditSink;
  /** Starts an unattended session (FR-NIGHT-01: one per job). */
  startSession(id: string): Promise<SessionState>;
  /** Persists the taint (FR-CAGE-04). */
  markTainted?(sessionId: string, source: TaintSource): Promise<unknown>;
  reader?: NightReader;
  /** The phone now: charging, battery, heat, screen, network. Read before every job and between its steps. */
  conditions(): DeviceState | Promise<DeviceState>;
  now(): number;
  timeZone: string;
  language: "es-419" | "en";
  newId(): string;
  /** Addresses the user has written to (FR-MAIL-04 address book). Only these get a reply draft suggestion. */
  knownSender?(address: string): boolean;
  /** What the app needs to find a suggestion's target after a restart (the mail header behind a short id). */
  snapshot?(skill: string, args: Record<string, unknown>): unknown;
  /** Called after each job, so a kill mid-night keeps what was done. */
  onProgress?(b: Briefing): Promise<void>;
  /** EVT-NIGHT-01: a job ran, failed, paused or was skipped (codes only). */
  events?: { record(e: { name: "EVT-NIGHT-01"; sessionId?: string; props: Record<string, string> }): Promise<void> };
  /** The debug "run now" on HM-NIGHT-01: ignores the window and the screen check, never heat, battery or the charger. */
  manual?: boolean;
  /**
   * SL-26 with Q69: true once "Delete everything" began. Checked before every job, between steps and before
   * every write; the pass then stops with NightAborted and writes nothing more.
   */
  aborted?(): boolean;
}

/** The erase began during a night pass: it stopped before its next write. */
export class NightAborted extends Error {
  constructor() {
    super("The night shift stopped: everything is being deleted.");
    this.name = "NightAborted";
  }
}

const stopIfAborted = (deps: Pick<NightDeps, "aborted">) => {
  if (deps.aborted?.()) throw new NightAborted();
};

/** Every write the night shift makes goes through here, so none happens once the erase began. */
function guardWrites(deps: NightDeps): NightDeps {
  if (!deps.aborted) return deps;
  const check = () => stopIfAborted(deps);
  const { markTainted, onProgress, events } = deps;
  return {
    ...deps,
    audit: { append: async (e) => (check(), deps.audit.append(e)) },
    startSession: async (id) => (check(), deps.startSession(id)),
    ...(markTainted ? { markTainted: async (id: string, source: TaintSource) => (check(), markTainted(id, source)) } : {}),
    ...(onProgress ? { onProgress: async (b: Briefing) => (check(), onProgress(b)) } : {}),
    ...(events ? { events: { record: async (e: Parameters<NonNullable<NightDeps["events"]>["record"]>[0]) => (check(), events.record(e)) } } : {}),
  };
}

export type StepResult =
  | { kind: "ran"; result: SkillResult; untrusted: boolean; text: string }
  | { kind: "queued"; suggestion: Suggestion }
  | { kind: "refused"; refusal: Refusal }
  | { kind: "failed" };

export interface StepContext {
  deps: NightDeps;
  rules: PolicyRule[];
  session: SessionState;
  job: NightJobId;
}

/**
 * One night step through the cage (US-CAGE-02, FR-NIGHT-02). Every step is proposed and decided in the signed
 * log, in the job's unattended session. A read the rules allow runs. Nothing else ever runs at night, even a
 * local write the rules would allow: in "propose" mode, a step a person would be asked about by day is
 * stored as a suggestion for the morning, and one that would be refused even then is a refusal.
 */
export async function nightStep(
  ctx: StepContext,
  skill: SkillId,
  args: Record<string, unknown>,
  mode: "run" | "propose" = "run",
  extra: { kind?: Suggestion["kind"]; vars?: Record<string, string> } = {},
): Promise<StepResult> {
  const { deps, session, rules, job } = ctx;
  const hash = argsHash(args);
  const log = (input: Omit<AuditInput, "ts" | "sessionId" | "skill" | "argsHash">) =>
    deps.audit.append({ ts: deps.now(), sessionId: session.id, skill, argsHash: hash, ...input });
  const refused = (): StepResult => ({ kind: "refused", refusal: { job, skill, at: deps.now() } });
  await log({ event: "call_proposed" });
  const runtime = deps.skills.find((s) => s.def.id === skill);
  if (!runtime) {
    await log({ event: "policy_decided", decision: "deny" });
    return refused();
  }
  const { def } = runtime;
  const call = { id: deps.newId(), skill, args, argsHash: hash, repairs: [] };
  const decision = decide(call, def.risk, session, rules);
  const reads = def.risk === "read" || def.risk === "network";
  const effect = mode === "run" && reads && decision.effect === "allow" ? "allow" : "deny";
  await log({ event: "policy_decided", decision: effect });

  if (effect === "allow") {
    let result: SkillResult;
    try {
      result = await runtime.execute(args, { session });
    } catch {
      result = { ok: false, modelText: `${def.id} couldn't finish.`, untrusted: false };
    }
    await log({ event: "executed", outcome: result.ok ? "ok" : "error" });
    if (!result.ok) return { kind: "failed" };
    const untrusted = result.untrusted ?? def.producesUntrusted;
    if (untrusted) {
      const source: TaintSource = { kind: result.taintKind ?? "inbound_message", ref: def.id, at: deps.now() };
      await deps.markTainted?.(session.id, source);
      if (!session.taint.includes(source)) session.taint.push(source);
      await deps.audit.append({ ts: deps.now(), sessionId: session.id, event: "taint_added", skill });
    }
    return { kind: "ran", result, untrusted, text: untrusted ? wrapUntrusted(result.modelText, def.id, deps.newId()) : result.modelText };
  }

  // Would a person be asked by day? Then it waits for the morning; otherwise it is refused outright.
  const byDay = decide(call, def.risk, { ...session, unattended: false }, rules);
  if (mode !== "propose" || byDay.effect === "deny") return refused();
  const lastTaint = session.taint.at(-1);
  const snapshot = deps.snapshot?.(skill, args);
  return {
    kind: "queued",
    suggestion: {
      id: deps.newId(),
      job,
      kind: extra.kind ?? "other",
      skill,
      args,
      argsHash: hash,
      tainted: session.taint.length > 0,
      ...(lastTaint ? { taintKind: lastTaint.kind } : {}),
      vars: extra.vars ?? {},
      ...(snapshot !== undefined ? { snapshot } : {}),
      status: "pending",
      createdAt: deps.now(),
    },
  };
}

type JobOutcome =
  | { status: "ran"; section: BriefingSection; suggestions: Suggestion[]; refusals: Refusal[] }
  | { status: "failed"; refusals: Refusal[] }
  | { status: "paused"; reason: PauseReason };

class Paused extends Error {
  constructor(readonly reason: PauseReason) {
    super(reason);
  }
}

const QUESTIONS = {
  messages: { "es-419": "¿Qué me escribieron durante la noche que sea importante?", en: "What did people write to me overnight that matters?" },
  mail: { "es-419": "¿Qué correo importante llegó durante la noche?", en: "What important email came in overnight?" },
} as const;

/** Most suggestions one night proposes from email: a briefing is a short read. */
const MAX_REPLY_SUGGESTIONS = 3;
const MAX_ITEMS = 8;

const lines = (text: string) => text.split("\n").map((l) => l.trim());
const displayName = (from: string) => from.replace(/<[^>]*>/, "").replace(/"/g, "").trim() || from.replace(/[<>]/g, "").trim();

/** Runs the read steps of one job; every step is followed by a guard check, so heat stops it between steps. */
async function runJob(job: NightJobId, ctx: StepContext, date: string, guard: () => Promise<PauseReason | undefined>): Promise<JobOutcome> {
  const { deps } = ctx;
  const checked = async () => {
    stopIfAborted(deps);
    const reason = await guard();
    if (reason) throw new Paused(reason);
  };
  const read = async (skill: string, args: Record<string, unknown>) => {
    const r = await nightStep(ctx, skillId(skill), args);
    await checked();
    return r;
  };
  const summarize = async (untrusted: string, source: string, question: string) => {
    if (!deps.reader) return undefined;
    const out = await deps.reader({ question, untrusted, source, language: deps.language }).catch(() => undefined);
    await checked();
    return out;
  };
  try {
    switch (job) {
      case "agenda": {
        const next = new Date(Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10)) + 1)).toISOString().slice(0, 10);
        const r = await read("calendar_read", { from: `${date}T00:00:00`, to: `${next}T00:00:00` });
        if (r.kind !== "ran") return { status: "failed", refusals: r.kind === "refused" ? [r.refusal] : [] };
        // W1: the skill's own records, not its words for the model (those are local text now, never parsed back). An
        // all-day event has no time of day to show.
        const items: BriefingItem[] = (r.result.items ?? []).map((e) => (e.allDay ? { text: e.text } : { at: e.at, text: e.text }));
        return { status: "ran", section: { job, untrusted: r.untrusted, quotes: [], items, count: items.length }, suggestions: [], refusals: [] };
      }
      case "reminders": {
        const r = await read("reminders_list", {});
        if (r.kind !== "ran") return { status: "failed", refusals: r.kind === "refused" ? [r.refusal] : [] };
        // W1: the reminders' own instants, said in the app's language and the phone's zone (the model's lines are English).
        const items: BriefingItem[] = (r.result.items ?? []).map((x) => ({ when: formatLocalTime(x.at, deps.language, deps.timeZone), text: x.text }));
        return { status: "ran", section: { job, untrusted: r.untrusted, quotes: [], items: items.slice(0, MAX_ITEMS), count: items.length }, suggestions: [], refusals: [] };
      }
      case "messages": {
        const r = await read("read_messages", {});
        if (r.kind !== "ran") return { status: "failed", refusals: r.kind === "refused" ? [r.refusal] : [] };
        // W1: from the skill's own records, newest first (the model's lines carry local words, never parsed back).
        const items: BriefingItem[] = [...(r.result.items ?? [])].reverse().map((m) => ({ at: m.at, ...(m.who ? { who: m.who } : {}), text: m.text }));
        if (!items.length) return { status: "ran", section: { job, untrusted: r.untrusted, quotes: [], items: [], count: 0 }, suggestions: [], refusals: [] };
        const summary = await summarize(r.text, "read_messages", QUESTIONS.messages[deps.language]);
        // W1 review: the list from the read's own records, never parsed back out of its words for the model (a colon in a
        // name, or the WhatsApp Business label, cut it in the wrong place).
        const fallback = catchUpItems(
          (r.result.items ?? []).map((m) => ({ chat: m.chat ?? m.who ?? "", who: m.who ?? "", text: m.text, at: m.at, ...(m.conversation ? { conversation: m.conversation } : {}), ...(m.business ? { business: true } : {}) })),
          deps.language,
        );
        return {
          status: "ran",
          section: { job, untrusted: true, ...(summary ? { summary: summary.answer } : fallback ? { summary: fallback } : {}), quotes: summary?.quotes ?? [], items: items.slice(0, MAX_ITEMS), count: items.length },
          suggestions: [],
          refusals: [],
        };
      }
      case "mail": {
        const r = await read("mail_list", { unreadOnly: true, max: 20 });
        if (r.kind !== "ran") return { status: "failed", refusals: r.kind === "refused" ? [r.refusal] : [] };
        const found: Array<BriefingItem & { ref: string; address?: string }> = [];
        for (const l of lines(r.result.modelText)) {
          if (!/^messageId: m\d+ \| /.test(l)) continue;
          const fields = l.split(" | ");
          const from = fields.find((f) => f.startsWith("From: "))?.slice(6) ?? "";
          const subject = fields.find((f) => f.startsWith("Subject: "))?.slice(9) ?? "";
          const address = emailOf(from);
          found.push({ ref: fields[0]!.slice("messageId: ".length), who: displayName(from), text: subject, ...(address ? { address } : {}) });
        }
        const items = found.map(({ who, text }) => ({ ...(who ? { who } : {}), text }));
        if (!r.untrusted || !found.length) return { status: "ran", section: { job, untrusted: r.untrusted, quotes: [], items, count: items.length }, suggestions: [], refusals: [] };
        const summary = await summarize(r.text, "mail_list", QUESTIONS.mail[deps.language]);
        const count = mailCountLine(r.text, deps.language);
        const text = summary ? (count ? `${count} ${summary.answer}` : summary.answer) : (count ?? mailReply(r.text, deps.language));
        // US-MAIL-07: a reply to someone the user writes to waits in the briefing as a draft, never sent at night.
        // The proposal is code's, its shape fixed (the sender of that email, an empty draft), so nothing the
        // email says can choose a recipient, a skill or a word of it; a stranger's email gets no suggestion.
        const suggestions: Suggestion[] = [];
        const refusals: Refusal[] = [];
        for (const m of found) {
          if (suggestions.length >= MAX_REPLY_SUGGESTIONS) break;
          if (!m.address || !deps.knownSender?.(m.address)) continue;
          const step = await nightStep(ctx, skillId("mail_draft"), { messageId: m.ref, body: "" }, "propose", { kind: "reply_draft", vars: { who: m.who ?? m.address, subject: m.text } });
          if (step.kind === "queued") suggestions.push(step.suggestion);
          if (step.kind === "refused") refusals.push(step.refusal);
        }
        return {
          status: "ran",
          section: { job, untrusted: true, ...(text ? { summary: text } : {}), quotes: summary?.quotes ?? [], items: items.slice(0, MAX_ITEMS), count: items.length },
          suggestions,
          refusals,
        };
      }
    }
  } catch (err) {
    if (err instanceof Paused) return { status: "paused", reason: err.reason };
    throw err;
  }
}

/**
 * One wake of the night shift (US-NIGHT-01, FR-NIGHT-01). Inside the window, runs the jobs not yet done, each in
 * its own unattended session, checking the guards before each job and after each step. A guard that trips
 * ends the run cleanly: the job in progress keeps nothing, it and the rest are paused with the reason, and a
 * later wake resumes them (pass the briefing back as `prior`). Wi-Fi only holds back the jobs that need it.
 * Outside the window, an open briefing is closed: what is still paused or pending is skipped, with its reason.
 * Every job's outcome is signed in the log (US-NIGHT-03). Returns undefined when there is nothing to do.
 * An erase that begins (`deps.aborted`) stops it with NightAborted before its next write.
 */
export async function runNightShift(settings: NightSettings, unguarded: NightDeps, prior?: Briefing): Promise<Briefing | undefined> {
  if (!settings.enabled) return prior;
  stopIfAborted(unguarded);
  const deps = guardWrites(unguarded);
  const now = deps.now();
  const open = prior && !prior.closed ? prior : undefined;
  if (!deps.manual && !inWindow(now, deps.timeZone, settings.window)) return open ? close(open, deps) : prior;

  const date = briefingDate(now, deps.timeZone, settings.window);
  const same = open?.date === date ? open : undefined;
  const reports: JobReport[] = settings.jobs.map((job) => same?.jobs.find((j) => j.job === job) ?? { job, status: "pending" });
  let b: Briefing = {
    id: same?.id ?? deps.newId(),
    date,
    createdAt: same?.createdAt ?? now,
    updatedAt: now,
    jobs: reports,
    sections: same?.sections ?? [],
    suggestions: same?.suggestions ?? [],
    refusals: same?.refusals ?? [],
    closed: false,
    ...(same?.noticeAt !== undefined ? { noticeAt: same.noticeAt } : {}),
  };
  const rules = nightRules(settings.jobs);
  const guard = (job: NightJobId) => async () => blockers(await deps.conditions(), { needsNetwork: JOB_NEEDS_NETWORK[job], ...(deps.manual ? { manual: true } : {}) })[0];
  const set = async (job: NightJobId, report: Omit<JobReport, "job">, sessionId?: string) => {
    b = { ...b, jobs: b.jobs.map((j) => (j.job === job ? { job, ...report } : j)), updatedAt: deps.now() };
    const outcome = report.status === "ran" ? "ok" : report.status === "failed" ? "error" : "denied";
    await deps.audit.append({
      ts: deps.now(), sessionId: sessionId ?? `night-${b.id}`, event: "night_job", skill: `night.${job}`, outcome,
      ...(report.reason ? { reason: `${report.status}.${report.reason}` } : {}),
    });
    await deps.events?.record({ name: "EVT-NIGHT-01", ...(sessionId ? { sessionId } : {}), props: { job, status: report.status, ...(report.reason ? { reason: report.reason } : {}) } });
  };

  let stop: PauseReason | undefined;
  for (const job of settings.jobs) {
    stopIfAborted(deps);
    const report = b.jobs.find((j) => j.job === job)!;
    if (report.status === "ran" || report.status === "failed" || report.status === "skipped") continue;
    if (stop) {
      await set(job, { status: "paused", reason: stop, at: deps.now() });
      continue;
    }
    const before = await guard(job)();
    if (before) {
      await set(job, { status: "paused", reason: before, at: deps.now() });
      if (before !== "no_wifi") stop = before;
      continue;
    }
    const session = await deps.startSession(`night-${deps.newId()}`);
    const out = await runJob(job, { deps, rules, session, job }, date, guard(job));
    if (out.status === "ran") {
      b = {
        ...b,
        sections: [...b.sections.filter((s) => s.job !== job), out.section].sort((x, y) => settings.jobs.indexOf(x.job) - settings.jobs.indexOf(y.job)),
        suggestions: [...b.suggestions, ...out.suggestions],
        refusals: [...b.refusals, ...out.refusals],
      };
      await set(job, { status: "ran", at: deps.now() }, session.id);
    } else if (out.status === "failed") {
      b = { ...b, refusals: [...b.refusals, ...out.refusals] };
      await set(job, { status: "failed", at: deps.now() }, session.id);
    } else {
      await set(job, { status: "paused", reason: out.reason, at: deps.now() }, session.id);
      if (out.reason !== "no_wifi") stop = out.reason;
    }
    await deps.onProgress?.(b);
  }
  // A run that ended without a guard tripping clears the stop of an earlier wake.
  b = { ...b, stop };
  if (!stop) delete b.stop;
  await deps.onProgress?.(b);
  return b;
}

/** The window closed: whatever is still pending or paused is skipped, with its last reason, and signed. */
async function close(b: Briefing, deps: NightDeps): Promise<Briefing> {
  const jobs: JobReport[] = [];
  for (const j of b.jobs) {
    if (j.status !== "pending" && j.status !== "paused") {
      jobs.push(j);
      continue;
    }
    const reason = j.reason ?? "outside_window";
    jobs.push({ job: j.job, status: "skipped", reason, at: deps.now() });
    await deps.audit.append({ ts: deps.now(), sessionId: `night-${b.id}`, event: "night_job", skill: `night.${j.job}`, outcome: "denied", reason: `skipped.${reason}` });
    await deps.events?.record({ name: "EVT-NIGHT-01", props: { job: j.job, status: "skipped", reason } });
  }
  const closed: Briefing = { ...b, jobs, closed: true, updatedAt: deps.now() };
  await deps.onProgress?.(closed);
  return closed;
}
