import { describe, expect, test } from "vitest";
import type { ModelPort } from "@hermit/core";
import { runTurn } from "../src/loop.ts";
import { harness } from "./helpers.ts";

const reply = { conversationId: "c1", text: "Running 10 minutes late" };
const tick = () => new Promise((r) => setTimeout(r, 0));

/** A model whose pick never finishes on its own: generation that only an abort ends. */
function hangingPick(base: ModelPort, seen: { signals: unknown[] }): ModelPort {
  return {
    ...base,
    pick: (input) => {
      seen.signals.push(input.signal);
      return new Promise(() => {});
    },
  };
}

describe("stop a turn (US-CHAT-06, FR-LOOP-06)", () => {
  test("stopping mid-generation ends the turn as stopped, with nothing run or audited", async () => {
    const h = harness([]);
    const seen = { signals: [] as unknown[] };
    const stop = new AbortController();
    const turn = runTurn(h.state, "Tell Ana I'm late", { ...h.deps, model: hangingPick(h.model, seen), signal: stop.signal });
    await tick();
    stop.abort();
    const r = await turn;
    expect(r.kind).toBe("stopped");
    expect(r).toMatchObject({ afterAction: false });
    expect(h.executed).toEqual([]);
    expect(h.audit).toEqual([]);
    // The model call got the signal, so the engine can cancel its run.
    expect(seen.signals[0]).toBe(stop.signal);
  });

  test("an already stopped turn never calls the model", async () => {
    const h = harness([{ pick: "remember", args: { fact: "x" } }]);
    const stop = new AbortController();
    stop.abort();
    const r = await runTurn(h.state, "remember x", { ...h.deps, signal: stop.signal });
    expect(r.kind).toBe("stopped");
    expect(h.model.picks).toBe(0);
    expect(h.executed).toEqual([]);
  });

  test("stopping with the approval sheet open closes it as denied and sends nothing", async () => {
    const stop = new AbortController();
    const signals: unknown[] = [];
    const h = harness([{ pick: "reply_message", args: reply }, { pick: "respond", text: "Sent." }], {
      // The sheet waits for the user; it closes only when the turn is stopped.
      approve: () => new Promise(() => {}),
    });
    const approvals = { request: (req: Parameters<typeof h.approvals.request>[0], signal?: AbortSignal) => (signals.push(signal), h.approvals.request(req)) };
    const turn = runTurn(h.state, "Tell Ana I'm late", { ...h.deps, approvals, signal: stop.signal });
    await tick();
    expect(h.approvals.requests).toHaveLength(1);
    stop.abort();
    const r = await turn;
    expect(r.kind).toBe("stopped");
    expect(h.executed).toEqual([]);
    expect(signals[0]).toBe(stop.signal);
    expect(r.events).toContainEqual({ kind: "denied", skill: "reply_message" });
    expect(h.audit.map((e) => [e.event, e.outcome])).toContainEqual(["approval", "denied"]);
    expect(h.audit.map((e) => e.event)).not.toContain("executed");
    // The model sees the call was not sent, then that the user stopped the turn.
    expect(r.messages.some((m) => m.role === "tool" && /Nothing was sent/.test(m.content))).toBe(true);
    expect(h.model.picks).toBe(1);
  });

  test("an approval that lands after the stop is not executed", async () => {
    const stop = new AbortController();
    const h = harness([{ pick: "reply_message", args: reply }], {
      approve: (r) => {
        stop.abort();
        return { kind: "approved", biometric: true, argsHash: r.call.argsHash };
      },
    });
    const r = await runTurn(h.state, "Tell Ana I'm late", { ...h.deps, signal: stop.signal });
    expect(r.kind).toBe("stopped");
    expect(h.executed).toEqual([]);
    expect(h.audit.map((e) => e.event)).not.toContain("executed");
  });

  test("a skill already running finishes atomically and is audited; the turn then stops", async () => {
    const stop = new AbortController();
    let finish!: () => void;
    const h = harness([{ pick: "remember", args: { fact: "Passport expires in March" } }, { pick: "respond", text: "Saved." }], {
      overrides: {
        remember: () => new Promise((resolve) => { finish = () => resolve({ ok: true, modelText: "saved" }); }),
      },
    });
    const turn = runTurn(h.state, "Remember my passport expires in March", { ...h.deps, signal: stop.signal });
    await tick();
    expect(h.executed.map((e) => e.skill)).toEqual(["remember"]);
    stop.abort();
    finish();
    const r = await turn;
    expect(r).toMatchObject({ kind: "stopped", afterAction: true });
    expect(h.audit.filter((e) => e.event === "executed")).toEqual([expect.objectContaining({ skill: "remember", outcome: "ok" })]);
    // No second step after the stop.
    expect(h.model.picks).toBe(1);
  });

  test("stopping while the reply is written drops the reply", async () => {
    const stop = new AbortController();
    const h = harness([{ pick: "respond" }]);
    const model: ModelPort = { ...h.model, pick: h.model.pick.bind(h.model), respond: () => new Promise(() => {}) };
    const turn = runTurn(h.state, "hola", { ...h.deps, model, signal: stop.signal });
    await tick();
    stop.abort();
    const r = await turn;
    expect(r.kind).toBe("stopped");
    expect(r.messages.filter((m) => m.role === "assistant").map((m) => m.content)).toEqual([expect.stringMatching(/stopped/i)]);
  });
});

describe("untrusted answers (FR-WEB-03)", () => {
  test("an answer the model port marks untrusted is kept untrusted in the history", async () => {
    const h = harness([]);
    const model: ModelPort = { ...h.model, pick: async () => ({ choice: "respond", text: "Ana asks about dinner.", untrusted: true }) };
    const r = await runTurn(h.state, "¿qué me perdí?", { ...h.deps, model });
    expect(r).toMatchObject({ kind: "final", text: "Ana asks about dinner." });
    expect(r.messages.at(-1)).toEqual({ role: "assistant", content: "Ana asks about dinner.", untrusted: true });
  });
});
