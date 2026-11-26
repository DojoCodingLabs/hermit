import { expect, test } from "vitest";
import type { ApprovalRequest, Msg, SessionState } from "@hermit/core";
import { defaultRules } from "@hermit/cage";
import { firstWinSkills } from "@hermit/skills";
import { runTurn, type SkillRuntime } from "@hermit/agent";
import type { CompletionEngine } from "../src/engine.ts";
import { createModelPort } from "../src/port.ts";
import { profileById } from "../src/profile.ts";

test("the real loop runs a two-stage turn through the model port", async () => {
  const outputs = ['{"choice":"remember","args":{"fact":"Pasaporte vence en marzo"}}', '{"choice":"respond"}', "Guardado."];
  let i = 0;
  const engine: CompletionEngine = { complete: async () => ({ text: outputs[i++] ?? "", toolCalls: [] }) };
  const executed: unknown[] = [];
  const skills: SkillRuntime[] = firstWinSkills.map((def) => ({ def, execute: async (args) => (executed.push([def.id, args]), { ok: true, modelText: "Saved." }) }));
  const session: SessionState = { id: "s", taint: [], unattended: false };
  const requests: ApprovalRequest[] = [];
  const r = await runTurn({ session, messages: [] as Msg[] }, "recuerda que mi pasaporte vence en marzo", {
    model: createModelPort(engine, profileById("botpsy-q4-two-stage-nothink")!, firstWinSkills, () => ({ language: "es-419", now: "2026-11-11T18:00:00-06:00 (Wednesday)", profile: [] })),
    skills,
    rules: defaultRules(),
    approvals: { request: async (req) => (requests.push(req), { kind: "denied" }) },
    audit: { append: async () => {} },
    render: { conversation: () => undefined },
    now: () => 0,
    newId: () => "id",
  });
  expect(executed).toEqual([["remember", { fact: "Pasaporte vence en marzo" }]]);
  expect(r).toMatchObject({ kind: "final", text: "Guardado." });
  expect(requests).toEqual([]);
});
