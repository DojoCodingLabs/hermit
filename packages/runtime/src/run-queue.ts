import type { StopSignal } from "@hermit/core";
import type { CompletionEngine } from "@hermit/model";
import { RUN_PRIORITIES, type RunPriority } from "./bot-api.ts";

/** One line for every model call of every bot: the phone runs one small model. */
export interface RunQueue {
  run<T>(priority: RunPriority, job: () => Promise<T>, signal?: StopSignal): Promise<T>;
  waiting(): Record<RunPriority, number>;
  busy(): boolean;
  /**
   * Marks a turn of this priority active until the returned release is called (idempotent). While a
   * hold of a higher priority is active, jobs of lower priority do not start; a running job always
   * finishes (the safe point). Holds of equal or lower priority block nothing.
   */
  hold(priority: RunPriority): () => void;
}

const STOPPED = "Stopped by the user.";

interface Waiter { start(): void; }

/**
 * One job runs at a time and is never interrupted. When it ends, the waiting job of the highest
 * priority starts, oldest first. A job must not call `run` from inside itself (it would wait for
 * itself); model calls never nest.
 */
export function createRunQueue(): RunQueue {
  const lines = Object.fromEntries(RUN_PRIORITIES.map((p) => [p, [] as Waiter[]])) as Record<RunPriority, Waiter[]>;
  let busy = false;
  const holds = Object.fromEntries(RUN_PRIORITIES.map((p) => [p, 0])) as Record<RunPriority, number>;

  const drain = () => {
    if (busy) return;
    for (const p of RUN_PRIORITIES) {
      // A lower priority waits while a higher-priority turn is held; the line stops here.
      const next = lines[p].shift();
      if (next) { busy = true; next.start(); return; }
      if (holds[p] > 0) return;
    }
  };

  return {
    run<T>(priority: RunPriority, job: () => Promise<T>, signal?: StopSignal): Promise<T> {
      if (signal?.aborted) return Promise.reject(new Error(STOPPED));
      return new Promise<T>((resolve, reject) => {
        const onAbort = () => {
          const i = lines[priority].indexOf(waiter);
          if (i < 0) return;
          lines[priority].splice(i, 1);
          reject(new Error(STOPPED));
        };
        const waiter: Waiter = {
          start() {
            signal?.removeEventListener("abort", onAbort);
            let running: Promise<T>;
            try { running = job(); } catch (e) { running = Promise.reject(e); }
            // Free the slot before settling, so a caller that awakes sees `busy()` false.
            running.then(
              (v) => { busy = false; resolve(v); drain(); },
              (e) => { busy = false; reject(e); drain(); },
            );
          },
        };
        lines[priority].push(waiter);
        signal?.addEventListener("abort", onAbort, { once: true });
        drain();
      });
    },
    waiting: () => Object.fromEntries(RUN_PRIORITIES.map((p) => [p, lines[p].length])) as Record<RunPriority, number>,
    busy: () => busy,
    hold(priority) {
      holds[priority]++;
      let released = false;
      return () => {
        if (released) return;
        released = true;
        holds[priority]--;
        drain();
      };
    },
  };
}

/** An engine whose every completion waits its turn in the queue at the given priority. */
export function queuedEngine(engine: CompletionEngine, queue: RunQueue, priority: RunPriority): CompletionEngine {
  return { complete: (req) => queue.run(priority, () => engine.complete(req), req.signal) };
}
