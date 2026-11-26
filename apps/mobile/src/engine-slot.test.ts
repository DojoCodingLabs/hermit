import assert from "node:assert/strict";
import { test } from "node:test";
import { engineSlot } from "./engine-slot.ts";

type Plan = { threads: number };

/** Engines that log their loads and closes, with the cores "allowed now" set by the test. */
function harness(first = 5) {
  const log: string[] = [];
  const loading: boolean[] = [];
  let ids = 0;
  let allowedThreads = first;
  let failNext = false;
  const slot = engineSlot<{ id: number; plan: Plan; close(): Promise<void> }, Plan>({
    plan: async () => ({ threads: allowedThreads }),
    recheck: (loaded) => (loaded.threads === allowedThreads ? undefined : { threads: allowedThreads }),
    load: async (plan) => {
      await Promise.resolve();
      if (failNext) {
        failNext = false;
        log.push(`load failed ${plan.threads}`);
        throw new Error("no memory");
      }
      const id = ++ids;
      log.push(`load ${id} with ${plan.threads}`);
      return { id, plan, close: async () => void log.push(`close ${id}`) };
    },
    onLoading: (l) => loading.push(l),
  });
  return {
    slot,
    log,
    loading,
    allow: (threads: number) => void (allowedThreads = threads),
    failNextLoad: () => void (failNext = true),
  };
}

/** One completion on the slot, the way the app's engine runs it. */
async function complete(slot: ReturnType<typeof harness>["slot"], safePoint: boolean): Promise<number> {
  const { engine, release } = await slot.use(safePoint);
  try {
    return engine.id;
  } finally {
    release();
  }
}

test("the first completion loads with the cores allowed now; the next ones reuse that engine", async () => {
  const h = harness(5);
  assert.equal(await complete(h.slot, true), 1);
  assert.equal(await complete(h.slot, false), 1);
  assert.equal(await complete(h.slot, true), 1);
  assert.deepEqual(h.log, ["load 1 with 5"]);
  assert.deepEqual(h.slot.loaded(), { threads: 5 });
});

test("at a safe point a smaller set reloads: the old engine closes before the new one loads", async () => {
  const h = harness(5);
  await complete(h.slot, true);
  h.allow(3); // the app went to the background (S26: 0-1,4-5)
  assert.equal(await complete(h.slot, true), 2);
  assert.deepEqual(h.log, ["load 1 with 5", "close 1", "load 2 with 3"]);
  // Back on screen: the plan for that set again, at the next safe point.
  h.allow(5);
  assert.equal(await complete(h.slot, true), 3);
  assert.deepEqual(h.log.slice(3), ["close 2", "load 3 with 5"]);
});

test("never mid-turn: a completion that isn't at a safe point keeps the engine, the next safe point reloads", async () => {
  const h = harness(5);
  await complete(h.slot, true);
  h.allow(3);
  assert.equal(await complete(h.slot, false), 1);
  assert.equal(await complete(h.slot, false), 1);
  assert.deepEqual(h.log, ["load 1 with 5"]);
  assert.equal(await complete(h.slot, true), 2);
});

test("a completion still running on the engine holds the reload back, so nothing is closed under it", async () => {
  const h = harness(5);
  const running = await h.slot.use(true);
  h.allow(3);
  // A safe point by the clock, but the engine is in use: no reload, the same engine.
  const second = await h.slot.use(true);
  assert.equal(second.engine.id, running.engine.id);
  second.release();
  running.release();
  // Releasing twice changes nothing.
  running.release();
  assert.deepEqual(h.log, ["load 1 with 5"]);
  assert.equal(await complete(h.slot, true), 2);
  assert.deepEqual(h.log, ["load 1 with 5", "close 1", "load 2 with 3"]);
});

test("completions that start together during a reload all get the new engine", async () => {
  const h = harness(5);
  await complete(h.slot, true);
  h.allow(3);
  const [a, b] = await Promise.all([complete(h.slot, true), complete(h.slot, false)]);
  assert.deepEqual([a, b], [2, 2]);
  assert.deepEqual(h.log, ["load 1 with 5", "close 1", "load 2 with 3"]);
});

test("loading is reported for the first load and for a reload", async () => {
  const h = harness(5);
  await complete(h.slot, true);
  h.allow(3);
  await complete(h.slot, true);
  assert.deepEqual(h.loading, [true, false, true, false]);
});

test("a failed load is forgotten, so the next completion loads again", async () => {
  const h = harness(5);
  h.failNextLoad();
  await assert.rejects(complete(h.slot, true), /no memory/);
  assert.equal(h.slot.loaded(), undefined);
  assert.equal(await complete(h.slot, false), 1);
  assert.deepEqual(h.log, ["load failed 5", "load 1 with 5"]);
  assert.deepEqual(h.loading, [true, false, true, false]);
});

test("a recheck that fails keeps the engine as it is", async () => {
  let calls = 0;
  const slot = engineSlot<{ id: number; close(): Promise<void> }, Plan>({
    plan: async () => ({ threads: 5 }),
    recheck: () => {
      calls++;
      throw new Error("no /proc");
    },
    load: async () => ({ id: 1, close: async () => {} }),
  });
  const first = await slot.use(true);
  first.release();
  const second = await slot.use(true);
  second.release();
  assert.equal(second.engine.id, 1);
  assert.equal(calls, 1);
});

test("close unloads the engine (the erase, a model update); the next completion loads again", async () => {
  const h = harness(5);
  await complete(h.slot, true);
  await h.slot.close();
  assert.equal(h.slot.loaded(), undefined);
  await h.slot.close(); // nothing loaded: nothing to do
  assert.equal(await complete(h.slot, false), 2);
  assert.deepEqual(h.log, ["load 1 with 5", "close 1", "load 2 with 5"]);
});

test("close during a load waits for it, then unloads", async () => {
  const h = harness(5);
  const first = h.slot.use(true);
  const closed = h.slot.close();
  const { release } = await first;
  release();
  await closed;
  assert.deepEqual(h.log, ["load 1 with 5", "close 1"]);
});
