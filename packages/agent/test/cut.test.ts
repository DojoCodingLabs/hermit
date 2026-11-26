import { describe, expect, test } from "vitest";
import type { ModelPort } from "@hermit/core";
import { runTurn } from "../src/loop.ts";
import type { StepEvent } from "../src/types.ts";
import { harness } from "./helpers.ts";

// Q155: a reply that used up its tokens ends the turn marked cut, so the chat says so instead of showing it finished.
describe("a cut reply ends the turn marked cut", () => {
  test("an answer from the pick that ran out of tokens is a final, cut reply; the history keeps its words", async () => {
    const h = harness([]);
    const model: ModelPort = { ...h.model, pick: async () => ({ choice: "respond", text: "Ingredientes:\n- 1 taza de arroz", cut: true }) };
    const r = await runTurn(h.state, "dame una receta", { ...h.deps, model });
    expect(r).toMatchObject({ kind: "final", text: "Ingredientes:\n- 1 taza de arroz", cut: true });
    expect(r.messages.at(-1)).toEqual({ role: "assistant", content: "Ingredientes:\n- 1 taza de arroz" });
  });

  test("the reply prompt's words carry the cut too; a plain string is a finished reply", async () => {
    const h = harness([{ pick: "respond" }]);
    const cut: ModelPort = { ...h.model, pick: h.model.pick.bind(h.model), respond: async (_i, onToken) => (onToken("Mañana tienes dentista."), { text: "Mañana tienes dentista.", cut: true }) };
    expect(await runTurn(h.state, "¿qué tengo mañana?", { ...h.deps, model: cut })).toMatchObject({ kind: "final", text: "Mañana tienes dentista.", cut: true });
    const h2 = harness([{ pick: "respond", text: undefined }]);
    const plain: ModelPort = { ...h2.model, pick: h2.model.pick.bind(h2.model), respond: async () => "Mañana tienes dentista." };
    const r = await runTurn(h2.state, "¿qué tengo mañana?", { ...h2.deps, model: plain });
    expect(r).toMatchObject({ kind: "final", text: "Mañana tienes dentista." });
    expect("cut" in r).toBe(false);
  });

  test("words the honesty guard replaces are not cut: the guard's own sentence is whole", async () => {
    const h = harness([{ pick: "remember", args: { fact: "x" } }], { overrides: { remember: async () => ({ ok: false, modelText: "failed" }) } });
    let picks = 0;
    const model: ModelPort = {
      ...h.model,
      fill: h.model.fill.bind(h.model),
      pick: async (input) => (picks++ === 0 ? h.model.pick(input) : { choice: "respond", text: "Listo, lo guardé y además te", cut: true }),
    };
    const r = await runTurn(h.state, "recuerda que x", { ...h.deps, model });
    expect(r).toMatchObject({ kind: "final" });
    expect("cut" in r).toBe(false);
  });
});

// Q155: the chat keeps what was already on screen when the user stops a reply, but only for words that can't act: the
// loop says when the model is writing an answer with no tools in reach.
describe("words-only writing is announced", () => {
  test("the reply prompt is words only: the step says so before any token", async () => {
    const h = harness([{ pick: "respond" }]);
    const seen: string[] = [];
    const model: ModelPort = { ...h.model, pick: h.model.pick.bind(h.model), respond: async (_i, onToken) => (seen.push("token"), onToken("Hola."), "Hola.") };
    const events: StepEvent[] = [];
    await runTurn(h.state, "hola", { ...h.deps, model, onEvent: (e) => (events.push(e), seen.push(e.kind)) });
    expect(seen).toEqual(["words", "token"]);
  });

  test("a pick that answers with no tools offered says so through live.onWords", async () => {
    const h = harness([]);
    const model: ModelPort = {
      ...h.model,
      pick: async ({ live }) => {
        live?.onWords?.();
        live?.onToken?.("No puedo comprar desde aquí.");
        return { choice: "respond", text: "No puedo comprar desde aquí.", streamed: true };
      },
    };
    const events: StepEvent[] = [];
    await runTurn(h.state, "cómprame un boleto", { ...h.deps, model, onEvent: (e) => events.push(e) });
    expect(events.map((e) => e.kind)).toEqual(["words"]);
  });
});
