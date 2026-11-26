import { describe, expect, test } from "vitest";
import { SHIPPED_MODEL, type InstalledModel, type ModelManifest } from "../src/manifest.ts";
import { STORAGE_MARGIN_BYTES } from "../src/download.ts";
import {
  UPDATE_BATTERY_MIN,
  canUpdateNow,
  recoverUpdate,
  smokePassed,
  stagedModel,
  stepUpdate,
  updateView,
  type UpdateConditions,
  type UpdateEffect,
  type UpdateEvent,
  type UpdateState,
} from "../src/update.ts";

const manifest: ModelManifest = {
  schema: 1,
  version: "1.1.0",
  file: {
    id: "botpsy-v1.1",
    url: "https://huggingface.co/qvac/BotPsy-0.8B-GGUFs/resolve/0123456789abcdef0123456789abcdef01234567/botpsy-0.8b-q4_k_m-imat.gguf",
    sha256: "a".repeat(64),
    size: 530_000_000,
    license: "Apache-2.0",
  },
  minAppVersion: "0.0.1",
  revokes: [],
};
const previous = SHIPPED_MODEL;
const next = stagedModel(manifest);
const good: UpdateConditions = { inTurn: false, network: "wifi", metered: false, batteryPercent: 80, charging: false, freeBytes: 10e9, userAsked: false };

describe("when an update may start (US-MODEL-04)", () => {
  test("idle phone on unmetered Wi-Fi with battery and room: go", () => {
    expect(canUpdateNow(manifest, good)).toEqual({ ok: true });
  });

  test("never during a turn, even when the user asks", () => {
    expect(canUpdateNow(manifest, { ...good, inTurn: true })).toEqual({ ok: false, wait: "turn" });
    expect(canUpdateNow(manifest, { ...good, inTurn: true, userAsked: true })).toEqual({ ok: false, wait: "turn" });
  });

  test("not offline", () => {
    expect(canUpdateNow(manifest, { ...good, network: "none" })).toEqual({ ok: false, wait: "offline" });
  });

  test("not on metered data unless the user asks", () => {
    const cell = { ...good, network: "cellular" as const, metered: true };
    expect(canUpdateNow(manifest, cell)).toEqual({ ok: false, wait: "metered" });
    expect(canUpdateNow(manifest, { ...good, metered: true })).toEqual({ ok: false, wait: "metered" });
    expect(canUpdateNow(manifest, { ...cell, userAsked: true })).toEqual({ ok: true });
  });

  test(`not below ${UPDATE_BATTERY_MIN}% battery unless charging or the user asks`, () => {
    expect(UPDATE_BATTERY_MIN).toBe(30);
    expect(canUpdateNow(manifest, { ...good, batteryPercent: 29 })).toEqual({ ok: false, wait: "battery" });
    expect(canUpdateNow(manifest, { ...good, batteryPercent: 29, charging: true })).toEqual({ ok: true });
    expect(canUpdateNow(manifest, { ...good, batteryPercent: 29, userAsked: true })).toEqual({ ok: true });
    expect(canUpdateNow(manifest, { ...good, batteryPercent: 30 })).toEqual({ ok: true });
    expect(canUpdateNow(manifest, { ...good, batteryPercent: undefined })).toEqual({ ok: true });
  });

  test("room for the new file next to the old one plus the margin, even when the user asks", () => {
    const tight = manifest.file.size + STORAGE_MARGIN_BYTES - 1;
    expect(canUpdateNow(manifest, { ...good, freeBytes: tight, userAsked: true })).toEqual({ ok: false, wait: "storage", needBytes: manifest.file.size + STORAGE_MARGIN_BYTES });
    expect(canUpdateNow(manifest, { ...good, freeBytes: tight }, 10)).toEqual({ ok: true });
  });
});

describe("the smoke prompt", () => {
  test("passes on any visible reply, fails on nothing or only a thinking block", () => {
    expect(smokePassed("Ready.")).toBe(true);
    expect(smokePassed("<think>hmm</think>\nready")).toBe(true);
    expect(smokePassed("")).toBe(false);
    expect(smokePassed("   \n")).toBe(false);
    expect(smokePassed("<think>hmm</think>")).toBe(false);
    expect(smokePassed(undefined)).toBe(false);
  });
});

const offer = (c: UpdateConditions = good): UpdateEvent => ({ type: "offer", manifest, previous, conditions: c });
const run = (events: UpdateEvent[], from: UpdateState = { phase: "idle" }) => {
  let state = from;
  const effects: UpdateEffect[] = [];
  for (const e of events) {
    const r = stepUpdate(state, e);
    state = r.state;
    effects.push(...r.effects);
  }
  return { state, effects };
};

describe("the update steps", () => {
  test("happy path: download to staging, verify size and hash, swap at idle, self-test, then delete the old file", () => {
    const r = run([
      offer(),
      { type: "downloaded" },
      { type: "verified", size: manifest.file.size, sha256: manifest.file.sha256 },
      { type: "swap", inTurn: false },
      { type: "pointer_flipped" },
      { type: "self_test", passed: true },
      { type: "cleaned" },
    ]);
    expect(r.state).toEqual({ phase: "idle", installed: next });
    expect(r.effects).toEqual([
      { kind: "download", fileName: next.fileName, url: manifest.file.url, from: 0 },
      { kind: "verify", fileName: next.fileName },
      { kind: "flip_pointer", to: next },
      { kind: "self_test" },
      { kind: "delete_file", fileName: previous.fileName },
    ]);
  });

  test("an offer the phone can't take now waits, and resumes when conditions allow", () => {
    let s = run([offer({ ...good, metered: true })]).state;
    expect(s).toEqual({ phase: "waiting", manifest, previous, wait: "metered", received: 0 });
    const r = stepUpdate(s, { type: "conditions", conditions: { ...good, metered: true, userAsked: true } });
    s = r.state;
    expect(s.phase).toBe("downloading");
    expect(r.effects).toEqual([{ kind: "download", fileName: next.fileName, url: manifest.file.url, from: 0 }]);
  });

  test("a dropped download keeps its bytes and resumes from them", () => {
    const s = run([offer(), { type: "download_failed", received: 1000 }]).state;
    expect(s).toEqual({ phase: "waiting", manifest, previous, wait: "network", received: 1000 });
    const r = stepUpdate(s, { type: "conditions", conditions: good });
    expect(r.effects).toEqual([{ kind: "download", fileName: next.fileName, url: manifest.file.url, from: 1000 }]);
  });

  test("a wrong size or hash deletes the staged file and never swaps", () => {
    for (const [ev, reason] of [
      [{ type: "verified", size: 1, sha256: manifest.file.sha256 }, "size"],
      [{ type: "verified", size: manifest.file.size, sha256: "b".repeat(64) }, "hash"],
    ] as const) {
      const r = run([offer(), { type: "downloaded" }, ev]);
      expect(r.state).toEqual({ phase: "failed", version: "1.1.0", reason });
      expect(r.effects.at(-1)).toEqual({ kind: "delete_file", fileName: next.fileName });
      expect(r.effects.some((e) => e.kind === "flip_pointer")).toBe(false);
    }
  });

  test("the hash compare ignores case", () => {
    const r = run([offer(), { type: "downloaded" }, { type: "verified", size: manifest.file.size, sha256: manifest.file.sha256.toUpperCase() }]);
    expect(r.state.phase).toBe("staged");
  });

  test("never swap during a turn: the verified file waits staged", () => {
    const r = run([offer(), { type: "downloaded" }, { type: "verified", size: manifest.file.size, sha256: manifest.file.sha256 }, { type: "swap", inTurn: true }]);
    expect(r.state).toEqual({ phase: "staged", manifest, previous });
    expect(r.effects.some((e) => e.kind === "flip_pointer")).toBe(false);
  });

  test("a failed self-test rolls back to the old model, deletes the new one, and refuses that version", () => {
    const r = run([offer(), { type: "downloaded" }, { type: "verified", size: manifest.file.size, sha256: manifest.file.sha256 }, { type: "swap", inTurn: false }, { type: "pointer_flipped" }, { type: "self_test", passed: false }]);
    expect(r.state).toEqual({ phase: "rolled_back", version: "1.1.0", reason: "self_test", previous, next });
    expect(r.effects.slice(-2)).toEqual([
      { kind: "flip_pointer", to: previous },
      { kind: "delete_file", fileName: next.fileName },
    ]);
  });

  test("events that don't fit the phase change nothing", () => {
    expect(stepUpdate({ phase: "idle" }, { type: "self_test", passed: true })).toEqual({ state: { phase: "idle" }, effects: [] });
    expect(stepUpdate({ phase: "idle" }, { type: "pointer_flipped" }).effects).toEqual([]);
  });

  test("no new offer while one is in flight", () => {
    const s = run([offer()]).state;
    expect(stepUpdate(s, offer())).toEqual({ state: s, effects: [] });
  });
});

/** The phone's files as the update sees them: the active pointer and which model files exist. */
interface Disk {
  pointer: InstalledModel | undefined;
  files: Set<string>;
  journal: UpdateState;
}

/**
 * Drives the steps the way the app adapter does: persist the state first, then apply its effects. `crashAfter`
 * stops after that many effects (the app killed), and `selfTest` decides how the new model behaves.
 */
function drive(disk: Disk, first: { state: UpdateState; effects: UpdateEffect[] }, opts: { crashAfter?: number; selfTest?: boolean; stagedHash?: string } = {}) {
  let budget = opts.crashAfter ?? Infinity;
  let cur = first;
  for (;;) {
    disk.journal = cur.state;
    let event: UpdateEvent | undefined;
    for (const e of cur.effects) {
      if (budget-- <= 0) return "crashed" as const;
      switch (e.kind) {
        case "download":
          disk.files.add(e.fileName);
          event = { type: "downloaded" };
          break;
        case "verify":
          event = { type: "verified", size: manifest.file.size, sha256: opts.stagedHash ?? manifest.file.sha256 };
          break;
        case "flip_pointer":
          disk.pointer = e.to;
          event = { type: "pointer_flipped" };
          break;
        case "self_test":
          event = { type: "self_test", passed: opts.selfTest ?? true };
          break;
        case "delete_file":
          disk.files.delete(e.fileName);
          event = { type: "cleaned" };
          break;
      }
    }
    if (cur.state.phase === "staged") {
      // The adapter asks to swap once no turn is running; a kill can land here too.
      if (budget-- <= 0) return "crashed" as const;
      event = { type: "swap", inTurn: false };
    }
    if (!event) return "settled" as const;
    cur = stepUpdate(cur.state, event);
  }
}

const freshDisk = (): Disk => ({ pointer: undefined, files: new Set([previous.fileName]), journal: { phase: "idle" } });
const loadable = (d: Disk) => (d.pointer ?? previous).fileName;

describe("crash recovery (the app killed at any point of an update)", () => {
  const TOTAL_EFFECTS = 6; // download, verify, swap at idle, flip, self-test, delete

  test("without a crash the update lands and only the new file remains", () => {
    const d = freshDisk();
    expect(drive(d, stepUpdate(d.journal, offer()))).toBe("settled");
    expect(d.pointer).toEqual(next);
    expect([...d.files]).toEqual([next.fileName]);
  });

  for (let k = 0; k <= TOTAL_EFFECTS; k++) {
    test(`killed after ${k} effect(s): the model that loads always exists, and recovery finishes or rolls back`, () => {
      const d = freshDisk();
      expect(drive(d, stepUpdate(d.journal, offer()), { crashAfter: k })).toBe(k < TOTAL_EFFECTS ? "crashed" : "settled");
      // At every crash point the file the engine would load is on disk.
      expect(d.files.has(loadable(d))).toBe(true);
      const recovered = recoverUpdate(d.journal, { pointerSha256: d.pointer?.sha256 });
      drive(d, recovered.state.phase === "waiting" ? stepUpdate(recovered.state, { type: "conditions", conditions: good }) : recovered);
      expect(d.files.has(loadable(d))).toBe(true);
      expect(d.journal.phase === "idle" || d.journal.phase === "rolled_back").toBe(true);
      if (d.journal.phase === "rolled_back") {
        // Killed while the new model was on trial: it may be what crashed the app, so the old one comes back.
        expect(d.journal.reason).toBe("crash");
        expect(d.pointer).toEqual(previous);
        expect(d.files.has(next.fileName)).toBe(false);
      } else {
        expect(d.pointer).toEqual(next);
        expect(d.files.has(previous.fileName)).toBe(false);
      }
    });
  }

  test("killed between the pointer flip and the self-test: rolled back, the old file was never deleted", () => {
    const d = freshDisk();
    drive(d, stepUpdate(d.journal, offer()), { crashAfter: 4 });
    expect(d.journal.phase).toBe("trial");
    expect(d.pointer).toEqual(next);
    expect(d.files.has(previous.fileName)).toBe(true);
    const r = recoverUpdate(d.journal, { pointerSha256: d.pointer?.sha256 });
    expect(r).toEqual({ state: { phase: "rolled_back", version: "1.1.0", reason: "crash", previous, next }, effects: [{ kind: "flip_pointer", to: previous }, { kind: "delete_file", fileName: next.fileName }] });
  });

  test("killed with the swap journaled but the pointer not flipped: verify again before swapping", () => {
    const journal: UpdateState = { phase: "swapping", manifest, previous };
    expect(recoverUpdate(journal, { pointerSha256: undefined })).toEqual({ state: { phase: "verifying", manifest, previous }, effects: [{ kind: "verify", fileName: next.fileName }] });
    expect(recoverUpdate(journal, { pointerSha256: previous.sha256 }).state.phase).toBe("verifying");
  });

  test("killed with the swap journaled and the pointer flipped: run the self-test", () => {
    expect(recoverUpdate({ phase: "swapping", manifest, previous }, { pointerSha256: next.sha256 })).toEqual({ state: { phase: "trial", manifest, previous }, effects: [{ kind: "self_test" }] });
  });

  test("a staged file is hashed again after a restart before it can be swapped in", () => {
    expect(recoverUpdate({ phase: "staged", manifest, previous }, {})).toEqual({ state: { phase: "verifying", manifest, previous }, effects: [{ kind: "verify", fileName: next.fileName }] });
  });

  test("a staged file changed on disk while the app was closed is caught by that second check", () => {
    const d = freshDisk();
    drive(d, stepUpdate(d.journal, offer()), { crashAfter: 2 });
    expect(d.journal.phase).toBe("staged");
    drive(d, recoverUpdate(d.journal, {}), { stagedHash: "c".repeat(64) });
    expect(d.journal).toEqual({ phase: "failed", version: "1.1.0", reason: "hash" });
    expect(d.pointer).toBeUndefined();
    expect([...d.files]).toEqual([previous.fileName]);
  });

  test("a download in progress resumes as waiting, from the bytes on disk", () => {
    expect(recoverUpdate({ phase: "downloading", manifest, previous, from: 0 }, { stagedBytes: 4096 })).toEqual({ state: { phase: "waiting", manifest, previous, wait: "network", received: 4096 }, effects: [] });
  });

  test("a rollback cut short finishes: the pointer goes back and the new file goes", () => {
    const journal: UpdateState = { phase: "rolled_back", version: "1.1.0", reason: "self_test", previous, next };
    expect(recoverUpdate(journal, { pointerSha256: next.sha256 }).effects).toEqual([{ kind: "flip_pointer", to: previous }, { kind: "delete_file", fileName: next.fileName }]);
    expect(recoverUpdate(journal, { pointerSha256: previous.sha256 }).effects).toEqual([{ kind: "delete_file", fileName: next.fileName }]);
  });

  test("a commit cut short deletes the old file again", () => {
    expect(recoverUpdate({ phase: "committing", installed: next, previous }, { pointerSha256: next.sha256 }).effects).toEqual([{ kind: "delete_file", fileName: previous.fileName }]);
  });

  test("nothing journaled: nothing happens (the shipped model with no update)", () => {
    expect(recoverUpdate({ phase: "idle" }, {})).toEqual({ state: { phase: "idle" }, effects: [] });
  });
});

describe("HM-CHAT-02 update line", () => {
  test("each phase has a line; nothing to say when idle", () => {
    expect(updateView({ phase: "idle" })).toBeUndefined();
    expect(updateView({ phase: "waiting", manifest, previous, wait: "metered", received: 0 })).toEqual({ key: "HM-CHAT-02.update.waiting_metered", vars: { version: "1.1.0" }, action: "update_now" });
    expect(updateView({ phase: "waiting", manifest, previous, wait: "battery", received: 0 })).toEqual({ key: "HM-CHAT-02.update.waiting_battery", vars: { version: "1.1.0" }, action: "update_now" });
    expect(updateView({ phase: "waiting", manifest, previous, wait: "turn", received: 0 })?.action).toBeUndefined();
    expect(updateView({ phase: "downloading", manifest, previous, from: 0 })?.key).toBe("HM-CHAT-02.update.downloading");
    expect(updateView({ phase: "staged", manifest, previous })?.key).toBe("HM-CHAT-02.update.staged");
    expect(updateView({ phase: "rolled_back", version: "1.1.0", reason: "self_test", previous, next })).toEqual({ key: "HM-CHAT-02.update.rolled_back", vars: { version: "1.1.0" } });
    expect(updateView({ phase: "failed", version: "1.1.0", reason: "hash" })).toEqual({ key: "HM-CHAT-02.update.failed", vars: { version: "1.1.0" } });
  });
});
