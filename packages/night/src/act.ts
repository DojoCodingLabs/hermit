import { argsHash, skillId, type ApprovalOutcome, type ApprovalPort, type ApprovalRequest, type RenderContext, type SessionState } from "@hermit/core";
import { decide, defaultRules, type AuditInput, type PolicyRule } from "@hermit/cage";
import type { AuditSink, SkillResult, SkillRuntime } from "@hermit/agent";
import type { Briefings } from "./briefing.ts";

export interface ActDeps {
  skills: readonly SkillRuntime[];
  audit: AuditSink;
  approvals: ApprovalPort;
  /** Trusted data for the sheet, fresh for this sheet (the same as the chat's). */
  render(): Promise<RenderContext> | RenderContext;
  now(): number;
  newId(): string;
  /** The day's rules; the chat's defaults when absent. */
  rules?: PolicyRule[];
  /** How long the sheet stays open (the chat's two minutes when absent). */
  approvalTimeoutMs?: number;
  /** Checks the approval proof, as the chat does (HMAC from the biometric-gated key). */
  verifyApproval?(request: ApprovalRequest, outcome: Extract<ApprovalOutcome, { kind: "approved" }>): boolean;
  /** Finds the suggestion's target again after a restart, from its snapshot; returns the arguments to use. */
  restore?(skill: string, args: Record<string, unknown>, snapshot: unknown): Record<string, unknown> | undefined;
}

/**
 * done: approved and it ran. declined: the user said no, the sheet expired, or the approval didn't match.
 * unavailable: the sheet can't show who or what it reaches anymore. refused: the stored suggestion was
 * altered, or the rules block it now. gone: not pending (already handled) or not found. failed: it ran and failed.
 */
export type ActOutcome = "done" | "declined" | "unavailable" | "refused" | "gone" | "failed";

const TAINT_WARNING: Record<string, string> = {
  email: "Suggested overnight after reading email",
  inbound_message: "Suggested overnight after reading messages",
  web: "Suggested overnight after reading a web page",
};

/**
 * FR-NIGHT-02, US-NIGHT-02: a suggestion runs only from the briefing, through the normal approval: an attended
 * session (tainted when the night was), the cage, the sheet built from trusted data, approval bound to the
 * exact arguments and the fingerprint a send needs, and the signed log. A suggestion is never run without a
 * sheet, even if the rules would allow it, and its stored arguments must still match their hash.
 */
export async function actOnSuggestion(deps: ActDeps, briefings: Briefings, briefingId: string, suggestionId: string): Promise<ActOutcome> {
  const b = await briefings.get(briefingId);
  const s = b?.suggestions.find((x) => x.id === suggestionId);
  if (!b || !s || s.status !== "pending") return "gone";
  if (argsHash(s.args) !== s.argsHash) return "refused";
  const runtime = deps.skills.find((r) => r.def.id === s.skill);
  const mark = async (status: Parameters<Briefings["setSuggestion"]>[2]) => void (await briefings.setSuggestion(briefingId, suggestionId, status));
  if (!runtime) {
    await mark("unavailable");
    return "unavailable";
  }
  const args = s.snapshot !== undefined && deps.restore ? (deps.restore(s.skill, s.args, s.snapshot) ?? s.args) : s.args;
  const now = deps.now();
  const session: SessionState = {
    id: `briefing-${deps.newId()}`,
    taint: s.tainted ? [{ kind: s.taintKind ?? "inbound_message", ref: `night.${s.job}`, at: s.createdAt }] : [],
    unattended: false,
  };
  const hash = argsHash(args);
  const call = { id: deps.newId(), skill: skillId(s.skill), args, argsHash: hash, repairs: [] };
  const log = (input: Omit<AuditInput, "ts" | "sessionId" | "skill" | "argsHash">) =>
    deps.audit.append({ ts: deps.now(), sessionId: session.id, skill: s.skill, argsHash: hash, ...input });
  await log({ event: "call_proposed" });
  const decision = decide(call, runtime.def.risk, session, deps.rules ?? defaultRules());
  await log({ event: "policy_decided", decision: decision.effect });
  if (decision.effect === "deny") return "refused";

  const summary = runtime.def.describeAction(args, await deps.render());
  if (summary.unresolved) {
    await log({ event: "approval", outcome: "denied" });
    await mark("unavailable");
    return "unavailable";
  }
  const timeout = deps.approvalTimeoutMs ?? 120_000;
  const warning = s.tainted ? (TAINT_WARNING[s.taintKind ?? "inbound_message"] ?? TAINT_WARNING.inbound_message) : undefined;
  const request: ApprovalRequest = {
    id: call.id,
    call: { id: call.id, skill: call.skill, argsHash: hash },
    summary,
    // A send always needs the fingerprint, whatever the rule said (FR-CAGE-02).
    requireBiometric: decision.requireBiometric || runtime.def.risk === "send",
    ...(warning ? { taintWarning: warning, taintKind: s.taintKind ?? "inbound_message" } : {}),
    expiresAt: now + timeout,
  };
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expired = new Promise<ApprovalOutcome>((resolve) => {
    timer = setTimeout(() => resolve({ kind: "expired" }), timeout);
  });
  const outcome = await Promise.race([
    Promise.resolve().then(() => deps.approvals.request(request)).catch((): ApprovalOutcome => ({ kind: "denied", reason: "approval failed" })),
    expired,
  ]).finally(() => clearTimeout(timer));
  const approved =
    outcome.kind === "approved" &&
    outcome.argsHash === hash &&
    (!request.requireBiometric || outcome.biometric) &&
    (deps.verifyApproval ? deps.verifyApproval(request, outcome) : true);
  await log({ event: "approval", outcome: approved ? "ok" : outcome.kind === "expired" ? "expired" : "denied" });
  if (!approved) {
    await mark("declined");
    return "declined";
  }
  let result: SkillResult;
  try {
    result = await runtime.execute(args, { session, approvedArgsHash: hash, ...(summary.binding ? { approvedBinding: summary.binding } : {}) });
  } catch {
    result = { ok: false, modelText: "failed", untrusted: false };
  }
  await log({ event: "executed", outcome: result.ok ? "ok" : "error" });
  await mark(result.ok ? "done" : "failed");
  return result.ok ? "done" : "failed";
}
