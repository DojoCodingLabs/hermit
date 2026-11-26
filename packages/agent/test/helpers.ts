import type { ApprovalOutcome, ApprovalPort, ApprovalRequest, ModelPort, SessionState, SkillId } from "@hermit/core";
import { defaultRules, type AuditInput } from "@hermit/cage";
import { firstWinSkills } from "@hermit/skills";
import type { LoopDeps, SkillRuntime } from "../src/types.ts";

export type Step = { pick: string; args?: unknown; rawText?: string; text?: string };

/** Answers pick/fill/respond from a script; each pick consumes the next step. */
export function scriptedModel(steps: Step[]): ModelPort & { picks: number } {
  let i = 0;
  const current = () => steps[Math.max(0, i - 1)]!;
  return {
    picks: 0,
    async pick() {
      const step = steps[i++] ?? { pick: "respond", text: "(script ended)" };
      this.picks++;
      return { choice: step.pick as SkillId | "respond" | "ask_user", ...(step.text ? { text: step.text } : {}) };
    },
    async fill() {
      const s = current();
      return { rawText: s.rawText ?? JSON.stringify(s.args ?? {}), args: s.args ?? {} };
    },
    async respond(_input, onToken) {
      const text = current().text ?? "";
      onToken(text);
      return text;
    },
  };
}

export function recordingApprovals(decide: (r: ApprovalRequest) => ApprovalOutcome | Promise<ApprovalOutcome>): ApprovalPort & { requests: ApprovalRequest[] } {
  const requests: ApprovalRequest[] = [];
  return { requests, request: async (r) => { requests.push(r); return decide(r); } };
}

export const approveAll = (r: ApprovalRequest): ApprovalOutcome => ({ kind: "approved", biometric: true, argsHash: r.call.argsHash });

export function fakeSkills(overrides: Partial<Record<string, SkillRuntime["execute"]>> = {}) {
  const executed: Array<{ skill: string; args: Record<string, unknown> }> = [];
  const runtimes: SkillRuntime[] = firstWinSkills.map((def) => ({
    def,
    execute: async (args, ctx) => {
      executed.push({ skill: def.id, args });
      const o = overrides[def.id];
      return o ? o(args, ctx) : { ok: true, modelText: `${def.id} ok` };
    },
  }));
  return { runtimes, executed };
}

export function harness(steps: Step[], opts: { approve?: Parameters<typeof recordingApprovals>[0]; overrides?: Parameters<typeof fakeSkills>[0]; approvalTimeoutMs?: number } = {}) {
  const model = scriptedModel(steps);
  const approvals = recordingApprovals(opts.approve ?? approveAll);
  const audit: AuditInput[] = [];
  const skills = fakeSkills(opts.overrides);
  let n = 0;
  const deps: LoopDeps = {
    model,
    skills: skills.runtimes,
    rules: defaultRules(),
    approvals,
    audit: { append: async (e) => { audit.push(e); } },
    render: { conversation: (id) => (id === "c1" ? { name: "Ana", address: "+506 8888 0000" } : undefined) },
    now: () => 1_000,
    newId: () => `id${++n}`,
    ...(opts.approvalTimeoutMs ? { approvalTimeoutMs: opts.approvalTimeoutMs } : {}),
  };
  const session: SessionState = { id: "s1", taint: [], unattended: false };
  return { deps, model, approvals, audit, executed: skills.executed, state: { session, messages: [] as never[] } };
}
