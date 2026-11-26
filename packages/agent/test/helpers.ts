import type { ApprovalOutcome, ApprovalPort, ApprovalRequest, ModelPort, SessionState, SkillDef, SkillId } from "@hermit/core";
import { defaultRules, type AuditInput, type BotCage } from "@hermit/cage";
import { firstWinSkills } from "@hermit/skills";
import type { LoopDeps, SkillRuntime } from "../src/types.ts";

export type Step = { pick: string; args?: unknown; rawText?: string; text?: string };

/** One model call as the loop made it: the port's method and the prompt cache key it carried. */
export type ModelCall = { method: "pick" | "fill" | "respond"; prefixCacheKey: string };

/** Answers pick/fill/respond from a script; each pick consumes the next step. `calls` records every call, in order. */
export function scriptedModel(steps: Step[]): ModelPort & { picks: number; calls: ModelCall[] } {
  let i = 0;
  const current = () => steps[Math.max(0, i - 1)]!;
  const calls: ModelCall[] = [];
  return {
    picks: 0,
    calls,
    async pick({ prefixCacheKey }) {
      calls.push({ method: "pick", prefixCacheKey });
      const step = steps[i++] ?? { pick: "respond", text: "(script ended)" };
      this.picks++;
      return { choice: step.pick as SkillId | "respond" | "ask_user", ...(step.text ? { text: step.text } : {}) };
    },
    async fill({ prefixCacheKey }) {
      calls.push({ method: "fill", prefixCacheKey });
      const s = current();
      return { rawText: s.rawText ?? JSON.stringify(s.args ?? {}), args: s.args ?? {} };
    },
    async respond({ prefixCacheKey }, onToken) {
      calls.push({ method: "respond", prefixCacheKey });
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

/**
 * Recording fakes for `defs` (the first-win menu by default): every run is kept in `executed`, and `overrides` answer
 * for a skill. `sources` gives a skill's runtime its `source` (a connector or MCP server id), by skill id.
 */
export function fakeSkills(
  overrides: Partial<Record<string, SkillRuntime["execute"]>> = {},
  opts: { defs?: readonly SkillDef[]; sources?: Readonly<Record<string, string>> } = {},
) {
  const executed: Array<{ skill: string; args: Record<string, unknown> }> = [];
  const runtimes: SkillRuntime[] = (opts.defs ?? firstWinSkills).map((def) => {
    const source = opts.sources?.[def.id];
    return {
      def,
      ...(source !== undefined ? { source } : {}),
      execute: async (args, ctx) => {
        executed.push({ skill: def.id, args });
        const o = overrides[def.id];
        return o ? o(args, ctx) : { ok: true, modelText: `${def.id} ok` };
      },
    };
  });
  return { runtimes, executed };
}

export function harness(
  steps: Step[],
  opts: {
    approve?: Parameters<typeof recordingApprovals>[0];
    overrides?: Parameters<typeof fakeSkills>[0];
    approvalTimeoutMs?: number;
    /** The bot the turn runs for (multi-bot); absent, the turn is today's. */
    bot?: BotCage;
    /** The turn's prompt cache key; absent, the loop's default. */
    prefixCacheKey?: string;
    /** The menu, the first-win skills when absent; `sources` as in fakeSkills. */
    defs?: readonly SkillDef[];
    sources?: Readonly<Record<string, string>>;
  } = {},
) {
  const model = scriptedModel(steps);
  const approvals = recordingApprovals(opts.approve ?? approveAll);
  const audit: AuditInput[] = [];
  const skills = fakeSkills(opts.overrides, opts);
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
    ...(opts.bot ? { bot: opts.bot } : {}),
    ...(opts.prefixCacheKey ? { prefixCacheKey: opts.prefixCacheKey } : {}),
  };
  const session: SessionState = { id: "s1", taint: [], unattended: false };
  return { deps, model, approvals, audit, executed: skills.executed, state: { session, messages: [] as never[] } };
}
