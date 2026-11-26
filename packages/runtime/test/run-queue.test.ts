import { beforeEach, expect, test, vi } from "vitest";
import type { EngineRequest } from "@hermit/model";
import { createRunQueue, queuedEngine, type RunQueue } from "../src/run-queue.ts";

let q: RunQueue;
beforeEach(() => { q = createRunQueue(); });
const tick = () => new Promise((r) => setTimeout(r, 0));
function deferred<T = void>() { let resolve!: (v: T) => void; const promise = new Promise<T>((r) => { resolve = r; }); return { promise, resolve }; }
const req = (cacheKey: string): EngineRequest => ({ messages: [], thinking: { enabled: false }, sampling: { temperature: 0, topP: 1, topK: 1 }, maxTokens: 8, cacheKey });

test("one model call at a time", async () => {
  let running = 0, most = 0;
  const job = async () => { running++; most = Math.max(most, running); await tick(); running--; };
  await Promise.all([q.run("user", job), q.run("routine", job), q.run("reply", job)]);
  expect(most).toBe(1);
});
test("the user's turn goes first, never interrupting the running call", async () => {
  const started: string[] = [];
  const first = deferred();
  const r1 = q.run("routine", async () => { started.push("r1"); await first.promise; });
  const rest = [q.run("routine", async () => void started.push("r2")), q.run("handoff", async () => void started.push("h1")),
    q.run("reply", async () => void started.push("p1")), q.run("user", async () => void started.push("u1"))];
  await tick();
  expect(started).toEqual(["r1"]);
  first.resolve(); await Promise.all([r1, ...rest]);
  expect(started).toEqual(["r1", "u1", "p1", "h1", "r2"]);
});
test("the same priority keeps arrival order", async () => {
  const started: string[] = [];
  await Promise.all(["u1", "u2", "u3"].map((id) => q.run("user", async () => void started.push(id))));
  expect(started).toEqual(["u1", "u2", "u3"]);
});
test("a stopped job leaves the line without running", async () => {
  const hold = deferred();
  const stop = new AbortController();
  const blocked = q.run("user", () => hold.promise);
  const job = vi.fn(async () => "ran");
  const gone = q.run("routine", job, stop.signal);
  stop.abort();
  await expect(gone).rejects.toThrow("Stopped by the user.");
  expect(q.waiting().routine).toBe(0);
  hold.resolve(); await blocked; await tick();
  expect(job).not.toHaveBeenCalled();
});
test("a job whose signal is already aborted never enters the line", async () => {
  const stop = new AbortController(); stop.abort();
  const job = vi.fn(async () => "ran");
  await expect(q.run("user", job, stop.signal)).rejects.toThrow("Stopped by the user.");
  expect(job).not.toHaveBeenCalled();
  expect(q.busy()).toBe(false);
});
test("a failed job frees the slot", async () => {
  await expect(q.run("user", async () => { throw new Error("engine"); })).rejects.toThrow("engine");
  expect(await q.run("routine", async () => "ran")).toBe("ran");
  expect(q.busy()).toBe(false);
});
test("queuedEngine sends every completion through the queue at its priority", async () => {
  const order: string[] = [];
  const slow = deferred();
  const engine = { complete: vi.fn(async (r: EngineRequest) => { order.push(r.cacheKey!); if (r.cacheKey === "a") await slow.promise; return { text: "", toolCalls: [] }; }) };
  const night = queuedEngine(engine, q, "routine"), chat = queuedEngine(engine, q, "user");
  const a = night.complete(req("a")); const b = night.complete(req("b")); const c = chat.complete(req("c"));
  slow.resolve(); await Promise.all([a, b, c]);
  expect(order).toEqual(["a", "c", "b"]);
});
test("queuedEngine: a call stopped while it waits never reaches the engine", async () => {
  const hold = deferred();
  const stop = new AbortController();
  const engine = { complete: vi.fn(async () => ({ text: "", toolCalls: [] })) };
  const blocked = q.run("user", () => hold.promise);
  const gone = queuedEngine(engine, q, "routine").complete({ ...req("x"), signal: stop.signal });
  stop.abort();
  await expect(gone).rejects.toThrow("Stopped by the user.");
  hold.resolve(); await blocked; await tick();
  expect(engine.complete).not.toHaveBeenCalled();
});
test("priority holds per turn: a user turn that starts mid-routine keeps the line until it ends", async () => {
  const order: string[] = [];
  const r1gate = deferred();
  const releaseR = q.hold("routine");
  const step = async (id: string, gate?: Promise<void>) => { order.push(id); await gate; await tick(); };
  const routine = (async () => {
    await q.run("routine", () => step("R1", r1gate.promise));
    await q.run("routine", () => step("R2"));
    await q.run("routine", () => step("R3"));
    releaseR();
  })();
  await tick();
  const releaseU = q.hold("user");
  const user = (async () => {
    for (const id of ["U1", "U2", "U3"]) { await q.run("user", () => step(id)); await tick(); }
    releaseU();
  })();
  await tick();
  r1gate.resolve();
  await Promise.all([routine, user]);
  expect(order).toEqual(["R1", "U1", "U2", "U3", "R2", "R3"]);
});
test("releasing the user hold lets the routine continue", async () => {
  const release = q.hold("user");
  const ran = vi.fn(async () => "ran");
  const p = q.run("routine", ran);
  await tick();
  expect(ran).not.toHaveBeenCalled();
  release(); release();
  expect(await p).toBe("ran");
});
test("a hold of equal priority doesn't block", async () => {
  q.hold("routine");
  expect(await q.run("routine", async () => "ran")).toBe("ran");
});
