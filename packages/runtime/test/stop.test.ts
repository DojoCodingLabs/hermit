/**
 * SL-15: stopping a turn through the composition root and the approval bridge, and the chat's stop control.
 */
import { describe, expect, test } from "vitest";
import { nodeSql } from "@hermit/sql-node";
import { conversationId, createEventLog, createSessions, type ApprovalPort, type ApprovalRequest } from "@hermit/core";
import { ed25519Signer } from "@hermit/cage";
import { profileById, type CompletionEngine, type EngineRequest } from "@hermit/model";
import { createHermit } from "../src/hermit.ts";
import { createApprovalBridge } from "../src/approval-bridge.ts";
import { chatReducer, initialChat, inputControl, type ChatAction, type ChatState } from "../src/chat-state.ts";

const PROFILE = profileById("botpsy-q4-two-stage-nothink")!;
const NOW = Date.UTC(2026, 10, 12, 0, 0);
const tick = () => new Promise((r) => setTimeout(r, 0));

/** An engine that answers from a script; a `null` entry hangs until the request's signal aborts. */
function setup(script: Array<string | null>, approvals: ApprovalPort) {
  const sql = nodeSql();
  const requests: EngineRequest[] = [];
  let i = 0;
  const engine: CompletionEngine = {
    complete(req) {
      requests.push(req);
      const text = script[i++];
      if (text === null) {
        return new Promise((_, reject) => req.signal?.addEventListener("abort", () => reject(new Error("cancelled")), { once: true }));
      }
      return Promise.resolve({ text: text ?? '{"choice":"respond"}', toolCalls: [] });
    },
  };
  const sent: string[] = [];
  let n = 0;
  const hermit = createHermit(
    {
      sql,
      signer: ed25519Signer(new Uint8Array(32).fill(4)),
      notifier: { schedule: async () => "n", cancel: async () => {} },
      calendar: { list: async () => [], add: async () => {}, calendars: async () => [] },
      replySender: { send: async (_h, text) => (sent.push(text), "sent") },
      engine,
      approvals,
      now: () => NOW,
      timeZone: () => "America/Costa_Rica",
      language: () => "es-419",
      newId: () => `id${++n}`,
    },
    PROFILE,
  );
  return { hermit, sql, requests, sent };
}

describe("stop a turn through the runtime (US-CHAT-06)", () => {
  test("stopping mid-generation cancels the engine run and ends with the stopped outcome", async () => {
    const w = setup([null], { request: async () => ({ kind: "denied" }) });
    await w.hermit.init();
    const s = await w.hermit.startSession();
    const stop = new AbortController();
    const tokens: string[] = [];
    const turn = w.hermit.send(s, "recuerda que mi pasaporte vence en marzo", { signal: stop.signal, onToken: (t) => tokens.push(t) });
    await tick();
    expect(w.requests.at(-1)!.signal).toBe(stop.signal);
    stop.abort();
    expect(await turn).toEqual({ kind: "outcome", outcome: "stopped" });
    const { rows } = await w.hermit.activity();
    expect(rows).toEqual([]);
    // The stop is in the history, so the next turn doesn't pick the request back up.
    const history = await createSessions(w.sql, () => NOW).history(s, 10);
    expect(history.map((m) => m.role)).toEqual(["user", "assistant"]);
    const [e] = await createEventLog(w.sql, () => NOW).list({ name: "EVT-MODEL-01", limit: 1 });
    expect(e!.props.outcome).toBe("stopped");
  });

  test("stopping with the sheet open closes it as denied and sends nothing", async () => {
    const bridge = createApprovalBridge(() => NOW, () => undefined);
    const ana = conversationId("whatsapp", "ana");
    const w = setup([`{"choice":"reply_message","args":{"conversationId":"${ana}","text":"Voy tarde"}}`, '{"choice":"respond"}', "Enviado."], bridge.port);
    await w.hermit.init();
    await w.hermit.messages.ingest({ packageName: "com.whatsapp", conversationKey: "ana", title: "Ana", sender: "Ana", text: "¿Vienes?", postedAt: NOW - 1000, notificationKey: "k1", replyHandle: "h" });
    const s = await w.hermit.startSession();
    const shown: Array<ApprovalRequest | undefined> = [];
    bridge.subscribe((r) => shown.push(r));
    const stop = new AbortController();
    const turn = w.hermit.send(s, "dile a Ana que voy tarde", { signal: stop.signal });
    for (let i = 0; i < 20 && !bridge.current(); i++) await tick();
    expect(bridge.current()).toBeDefined();
    stop.abort();
    expect(await turn).toEqual({ kind: "outcome", outcome: "stopped" });
    // The sheet is gone and a late approve does nothing.
    expect(bridge.current()).toBeUndefined();
    expect(shown.at(-1)).toBeUndefined();
    bridge.approve(shown[0]!.id, { biometric: true });
    expect(w.sent).toEqual([]);
    const { rows } = await w.hermit.activity();
    expect(rows.map((r) => [r.skill, r.mark])).toEqual([["reply_message", "denied"]]);
  });

  test("a stop after a finished action says so, instead of claiming nothing was done", async () => {
    const stop = new AbortController();
    const w = setup(['{"choice":"remember","args":{"fact":"Mi pasaporte vence en marzo"}}', null], { request: async () => ({ kind: "denied" }) });
    await w.hermit.init();
    const s = await w.hermit.startSession();
    const turn = w.hermit.send(s, "recuerda que mi pasaporte vence en marzo", { signal: stop.signal });
    for (let i = 0; i < 20 && w.requests.length < 2; i++) await tick();
    stop.abort();
    expect(await turn).toEqual({ kind: "outcome", outcome: "stopped", afterAction: true });
  });
});

describe("the approval bridge and a stopped turn", () => {
  test("an aborted signal resolves the open request as denied", async () => {
    const b = createApprovalBridge(() => 0, () => undefined);
    const stop = new AbortController();
    const req = { id: "r1", call: { id: "r1", skill: "reply_message", argsHash: "h" }, summary: { title: "t", lines: [] }, requireBiometric: true, expiresAt: 1 } as unknown as ApprovalRequest;
    const out = b.port.request(req, stop.signal);
    expect(b.current()?.id).toBe("r1");
    stop.abort();
    expect(await out).toEqual({ kind: "denied", reason: "stopped" });
    expect(b.current()).toBeUndefined();
  });

  test("a request made after the stop is denied at once", async () => {
    const b = createApprovalBridge(() => 0, () => undefined);
    const stop = new AbortController();
    stop.abort();
    const req = { id: "r2", call: { id: "r2", skill: "reply_message", argsHash: "h" }, summary: { title: "t", lines: [] }, requireBiometric: true, expiresAt: 1 } as unknown as ApprovalRequest;
    expect(await b.port.request(req, stop.signal)).toEqual({ kind: "denied", reason: "stopped" });
    expect(b.current()).toBeUndefined();
  });
});

describe("the stop control (HM-CHAT-01, US-CHAT-06)", () => {
  const run = (actions: ChatAction[], from: ChatState = initialChat) => actions.reduce(chatReducer, from);

  test("stop replaces send while a turn runs, then send comes back", () => {
    expect(inputControl(initialChat)).toBe("send");
    const running = run([{ type: "send", id: "u1", text: "hola", at: 1 }]);
    expect(inputControl(running)).toBe("stop");
    const stopping = chatReducer(running, { type: "stop" });
    expect(inputControl(stopping)).toBe("stopping");
    expect(stopping.live?.statusKey).toBe("HM-CHAT-01.stopping");
    // A second press does nothing new.
    expect(chatReducer(stopping, { type: "stop" })).toBe(stopping);
    const done = chatReducer(stopping, { type: "finished", id: "a1", view: { kind: "outcome", outcome: "stopped" } });
    expect(inputControl(done)).toBe("send");
    expect(done.stopping).toBeUndefined();
  });

  test("stop does nothing when no turn runs", () => {
    expect(chatReducer(initialChat, { type: "stop" })).toBe(initialChat);
  });

  test("tokens that arrive after the stop are not shown", () => {
    const s = run([{ type: "send", id: "u1", text: "hola" }, { type: "token", text: "Hol" }, { type: "stop" }, { type: "token", text: "a" }]);
    expect(s.items.at(-1)).toMatchObject({ kind: "assistant", text: "Hol" });
  });

  test("a stopped turn drops the half-written reply, shows the stopped outcome, and the mascot rests", () => {
    const s = run([{ type: "send", id: "u1", text: "hola" }, { type: "token", text: "Hol" }, { type: "stop" }, { type: "finished", id: "a1", view: { kind: "outcome", outcome: "stopped" } }]);
    expect(s.items).toEqual([{ kind: "user", id: "u1", text: "hola" }, { kind: "outcome", id: "a1", outcome: "stopped" }]);
    expect(s.mascot).toBe("idle");
  });

  test("a stop after an action ran says what happened, from a copy key", () => {
    const s = run([{ type: "send", id: "u1", text: "x" }, { type: "stop" }, { type: "finished", id: "a1", view: { kind: "outcome", outcome: "stopped", afterAction: true } }]);
    expect(s.items.at(-1)).toEqual({ kind: "system", id: "a1", copyKey: "HM-CHAT-01.stoppedAfterAction" });
  });
});
