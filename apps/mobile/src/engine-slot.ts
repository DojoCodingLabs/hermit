// The loaded model and when it loads again (device-adaptive runtime). Pure: tested under Node with node --test.
// llama.cpp reads its threads and core mask at load only, so following the cores Android allows the app (the S26: 0-5
// on screen, 0-1,4-5 in the background) takes a reload, about 2 s on the S26 plus the prompt cache. It happens only
// at a safe point: a completion that starts a turn, with nothing running on the engine. Never between a turn's steps.

export interface EngineSlot<E, P> {
  /**
   * The engine for one completion; call `release` when the completion ends. Loads it on first use with the plan for
   * the cores allowed now. At a safe point with nothing running on it, it loads again first when `recheck` asks.
   */
  use(safePoint: boolean): Promise<{ engine: E; release(): void }>;
  /** The plan the engine loaded with; undefined until it has loaded. */
  loaded(): P | undefined;
  /** Unloads now, after a load in progress (the erase, a model update); the next use loads again. */
  close(): Promise<void>;
}

interface Load<E, P> {
  ready: Promise<E>;
  plan?: P;
  done: boolean;
  /** Completions running on this engine. */
  users: number;
}

export function engineSlot<E extends { close(): Promise<void> }, P>(o: {
  /** The plan for a first load, from the cores allowed right now. */
  plan(): Promise<P>;
  /** At a safe point: another plan when the cores allowed now call for it, else undefined. */
  recheck(loaded: P): P | undefined;
  load(plan: P): Promise<E>;
  /** EC-CHAT-01: the chat says when a turn waits for the model to load. */
  onLoading?(loading: boolean): void;
}): EngineSlot<E, P> {
  let current: Load<E, P> | undefined;

  const start = (plan: () => Promise<P>, after: Promise<unknown>): Load<E, P> => {
    o.onLoading?.(true);
    const next: Load<E, P> = { done: false, users: 0, ready: undefined as unknown as Promise<E> };
    next.ready = after.then(plan).then((p) => {
      next.plan = p;
      return o.load(p);
    });
    // A failed load is forgotten, so the next completion tries again.
    next.ready.then(
      () => {
        next.done = true;
        o.onLoading?.(false);
      },
      () => {
        o.onLoading?.(false);
        if (current === next) current = undefined;
      },
    );
    return next;
  };

  return {
    // Everything before the await runs at once, so two completions starting together always see the same engine.
    async use(safePoint) {
      if (!current) {
        current = start(o.plan, Promise.resolve());
      } else if (safePoint && current.done && current.users === 0) {
        let plan: P | undefined;
        try {
          plan = o.recheck(current.plan as P);
        } catch {
          plan = undefined; // the cores couldn't be read: the engine stays as it is
        }
        if (plan !== undefined) {
          // The old engine closes before the new one loads: two models at once would need twice the memory.
          const old = current;
          current = start(async () => plan, old.ready.then((e) => e.close()).catch(() => undefined));
        }
      }
      const held = current;
      held.users++;
      let released = false;
      const release = () => {
        if (released) return;
        released = true;
        held.users--;
      };
      try {
        return { engine: await held.ready, release };
      } catch (err) {
        release();
        throw err;
      }
    },
    loaded: () => (current?.done ? current.plan : undefined),
    async close() {
      const held = current;
      current = undefined;
      if (!held) return;
      const engine = await held.ready.catch(() => undefined);
      await engine?.close();
    },
  };
}
