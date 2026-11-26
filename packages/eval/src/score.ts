import { canonicalJson, type ModelPort, type SkillId } from "@hermit/core";
import { firstWinSkills, skillById } from "@hermit/skills";
import type { EvalCase } from "./cases.ts";

export interface Got { choice: string; args?: unknown }
export interface CaseResult { id: string; pass: boolean; reason?: string; got: Got; ms: number }

/** Choice must match; every expected arg must match exactly; extra args are fine. */
export function scoreCase(c: EvalCase, got: Got): { pass: boolean; reason?: string } {
  // "respond" means no tool: the user sees words either way, so a question back is fine (a declined
  // request often ends "can I help with something else?"). ask_user stays strict.
  if (c.expect.choice === "respond" && got.choice === "ask_user") return { pass: true };
  if (got.choice !== c.expect.choice) return { pass: false, reason: `choice: expected ${c.expect.choice}, got ${got.choice}` };
  const args = (got.args ?? {}) as Record<string, unknown>;
  for (const [k, v] of Object.entries(c.expect.args ?? {})) {
    if (!(k in args) || canonicalJson(args[k]) !== canonicalJson(v)) {
      return { pass: false, reason: `arg ${k}: expected ${JSON.stringify(v)}, got ${JSON.stringify(args[k])}` };
    }
  }
  for (const [k, sub] of Object.entries(c.expect.contains ?? {})) {
    const v = args[k];
    if (typeof v !== "string" || !v.toLowerCase().includes(sub.toLowerCase())) {
      return { pass: false, reason: `arg ${k}: expected to contain ${JSON.stringify(sub)}, got ${JSON.stringify(v)}` };
    }
  }
  return { pass: true };
}

/** Runs each case through pick, then fill for skill choices, exactly like the agent loop. */
/** With `clock`, skills' deterministic normalization runs after fill, exactly as the loop does. */
export async function runEval(cases: EvalCase[], model: ModelPort, clock?: { now: number; timeZone: string }): Promise<{ passed: number; total: number; results: CaseResult[] }> {
  const menu = firstWinSkills.map((s) => s.id);
  const results: CaseResult[] = [];
  for (const c of cases) {
    const started = Date.now();
    const messages = [{ role: "user" as const, content: c.input }];
    const picked = await model.pick({ prefixCacheKey: "eval", messages, menu });
    let got: Got = { choice: picked.choice };
    const skill = skillById(picked.choice);
    if (skill) {
      const filled = await model.fill({ prefixCacheKey: "eval", messages, skill: picked.choice as SkillId, schema: skill.args });
      let args = filled.args;
      if (clock && skill.normalize && args && typeof args === "object") args = skill.normalize(args as Record<string, unknown>, { userText: c.input, ...clock }).args;
      got = { choice: picked.choice, args };
    }
    results.push({ id: c.id, ...scoreCase(c, got), got, ms: Date.now() - started });
  }
  return { passed: results.filter((r) => r.pass).length, total: results.length, results };
}
