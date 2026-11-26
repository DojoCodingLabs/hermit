import type { ModelPort, SkillId } from "@hermit/core";

type Script = Record<string, { choice: string; args?: Record<string, unknown> }>;

/** Answers from a script keyed by the user's message; anything unscripted gets a plain reply. */
export class FakeModel implements ModelPort {
  private readonly script: Script;

  constructor(script: Script) {
    this.script = script;
  }

  private lookup(messages: { content: string }[]) {
    return this.script[messages.at(-1)?.content ?? ""];
  }

  async pick({ messages }: Parameters<ModelPort["pick"]>[0]) {
    return { choice: (this.lookup(messages)?.choice ?? "respond") as SkillId | "respond" };
  }

  async fill({ messages }: Parameters<ModelPort["fill"]>[0]) {
    const args = this.lookup(messages)?.args ?? {};
    return { rawText: JSON.stringify(args), args };
  }

  async respond() {
    return "";
  }
}
