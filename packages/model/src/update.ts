import { STORAGE_MARGIN_BYTES, type Network } from "./download.ts";
import type { InstalledModel, ModelManifest } from "./manifest.ts";

/**
 * SL-43: safe model updates (US-MODEL-04). Pure steps; the app adapter persists each state as a journal
 * before it applies the state's effects, so a kill at any point is recovered by recoverUpdate on the next
 * launch. The old model stays on disk and loadable until the new one passed its self-test; the pointer
 * that names the active model flips atomically (write then rename) and flips back on any failure.
 */

/** Below this battery percent an update waits for the charger unless the user asks (Q105). */
export const UPDATE_BATTERY_MIN = 30;

export interface UpdateConditions {
  /** A chat turn is running (the model is busy). */
  inTurn: boolean;
  network: Network;
  /** Cellular, or a Wi-Fi Android marks as metered. */
  metered: boolean;
  batteryPercent?: number;
  charging: boolean;
  freeBytes: number;
  /** The user tapped "Update now": metered data and low battery no longer hold it back. */
  userAsked: boolean;
}

export type UpdateWait = "turn" | "offline" | "metered" | "battery" | "storage" | "network";

export function canUpdateNow(m: ModelManifest, c: UpdateConditions, partialBytes = 0): { ok: true } | { ok: false; wait: UpdateWait; needBytes?: number } {
  if (c.inTurn) return { ok: false, wait: "turn" };
  if (c.network === "none") return { ok: false, wait: "offline" };
  if (c.metered && !c.userAsked) return { ok: false, wait: "metered" };
  if (c.batteryPercent !== undefined && c.batteryPercent < UPDATE_BATTERY_MIN && !c.charging && !c.userAsked) return { ok: false, wait: "battery" };
  // The old model stays on disk until the new one passes, so the whole new file plus the margin must fit.
  const need = m.file.size - Math.min(partialBytes, m.file.size) + STORAGE_MARGIN_BYTES;
  if (c.freeBytes < need) return { ok: false, wait: "storage", needBytes: need };
  return { ok: true };
}

/** Where the new version is staged, next to the old file, and the name it keeps once active. */
export function stagedModel(m: ModelManifest): InstalledModel {
  return { version: m.version, fileName: `v${m.version}-${m.file.url.split("/").pop()}`, sha256: m.file.sha256, size: m.file.size };
}

/** The short self-test prompt, and whether its reply shows the new model loaded and answers. */
export const SMOKE_PROMPT = "Reply with one word: ready";
export function smokePassed(reply: string | undefined): boolean {
  if (!reply) return false;
  return reply.replace(/<think>[\s\S]*?<\/think>/g, "").trim().length > 0;
}

export type UpdateState =
  | { phase: "idle"; installed?: InstalledModel }
  | { phase: "waiting"; manifest: ModelManifest; previous: InstalledModel; wait: UpdateWait; received: number }
  | { phase: "downloading"; manifest: ModelManifest; previous: InstalledModel; from: number }
  | { phase: "verifying"; manifest: ModelManifest; previous: InstalledModel }
  /** Verified and waiting for a moment with no turn running. */
  | { phase: "staged"; manifest: ModelManifest; previous: InstalledModel }
  /** Journaled before the pointer flips. */
  | { phase: "swapping"; manifest: ModelManifest; previous: InstalledModel }
  /** The pointer names the new model; the old file is still there; the self-test decides. */
  | { phase: "trial"; manifest: ModelManifest; previous: InstalledModel }
  | { phase: "committing"; installed: InstalledModel; previous: InstalledModel }
  | { phase: "rolled_back"; version: string; reason: "self_test" | "crash"; previous: InstalledModel; next: InstalledModel }
  | { phase: "failed"; version: string; reason: "size" | "hash" };

export type UpdateEvent =
  | { type: "offer"; manifest: ModelManifest; previous: InstalledModel; conditions: UpdateConditions }
  | { type: "conditions"; conditions: UpdateConditions }
  | { type: "download_failed"; received: number }
  | { type: "downloaded" }
  | { type: "verified"; size: number; sha256: string }
  | { type: "swap"; inTurn: boolean }
  | { type: "pointer_flipped" }
  | { type: "self_test"; passed: boolean }
  | { type: "cleaned" };

export type UpdateEffect =
  | { kind: "download"; fileName: string; url: string; from: number }
  | { kind: "verify"; fileName: string }
  | { kind: "flip_pointer"; to: InstalledModel }
  | { kind: "self_test" }
  | { kind: "delete_file"; fileName: string };

export interface UpdateStep {
  state: UpdateState;
  effects: UpdateEffect[];
}

const stay = (state: UpdateState): UpdateStep => ({ state, effects: [] });

function begin(manifest: ModelManifest, previous: InstalledModel, c: UpdateConditions, received: number): UpdateStep {
  const gate = canUpdateNow(manifest, c, received);
  if (!gate.ok) return stay({ phase: "waiting", manifest, previous, wait: gate.wait, received });
  const from = Math.min(received, manifest.file.size);
  return { state: { phase: "downloading", manifest, previous, from }, effects: [{ kind: "download", fileName: stagedModel(manifest).fileName, url: manifest.file.url, from }] };
}

function rollBack(version: string, reason: "self_test" | "crash", previous: InstalledModel, next: InstalledModel, pointerOnNext = true): UpdateStep {
  return {
    state: { phase: "rolled_back", version, reason, previous, next },
    effects: [...(pointerOnNext ? [{ kind: "flip_pointer" as const, to: previous }] : []), { kind: "delete_file", fileName: next.fileName }],
  };
}

export function stepUpdate(s: UpdateState, e: UpdateEvent): UpdateStep {
  switch (e.type) {
    case "offer":
      // One update at a time: a new offer only from a resting phase.
      if (s.phase !== "idle" && s.phase !== "failed" && s.phase !== "rolled_back") return stay(s);
      return begin(e.manifest, e.previous, e.conditions, 0);
    case "conditions":
      return s.phase === "waiting" ? begin(s.manifest, s.previous, e.conditions, s.received) : stay(s);
    case "download_failed":
      return s.phase === "downloading" ? stay({ phase: "waiting", manifest: s.manifest, previous: s.previous, wait: "network", received: e.received }) : stay(s);
    case "downloaded":
      return s.phase === "downloading"
        ? { state: { phase: "verifying", manifest: s.manifest, previous: s.previous }, effects: [{ kind: "verify", fileName: stagedModel(s.manifest).fileName }] }
        : stay(s);
    case "verified": {
      if (s.phase !== "verifying") return stay(s);
      const fileName = stagedModel(s.manifest).fileName;
      const reason = e.size !== s.manifest.file.size ? "size" : e.sha256.toLowerCase() !== s.manifest.file.sha256 ? "hash" : undefined;
      if (reason) return { state: { phase: "failed", version: s.manifest.version, reason }, effects: [{ kind: "delete_file", fileName }] };
      return stay({ phase: "staged", manifest: s.manifest, previous: s.previous });
    }
    case "swap":
      if (s.phase !== "staged" || e.inTurn) return stay(s);
      return { state: { phase: "swapping", manifest: s.manifest, previous: s.previous }, effects: [{ kind: "flip_pointer", to: stagedModel(s.manifest) }] };
    case "pointer_flipped":
      return s.phase === "swapping" ? { state: { phase: "trial", manifest: s.manifest, previous: s.previous }, effects: [{ kind: "self_test" }] } : stay(s);
    case "self_test": {
      if (s.phase !== "trial") return stay(s);
      const next = stagedModel(s.manifest);
      if (!e.passed) return rollBack(s.manifest.version, "self_test", s.previous, next);
      return { state: { phase: "committing", installed: next, previous: s.previous }, effects: [{ kind: "delete_file", fileName: s.previous.fileName }] };
    }
    case "cleaned":
      return s.phase === "committing" ? stay({ phase: "idle", installed: s.installed }) : stay(s);
  }
}

/** What the phone's disk says after a restart: the active pointer's hash and the staged file's length. */
export interface DiskView {
  pointerSha256?: string;
  stagedBytes?: number;
}

/**
 * On launch, from the journal and the disk. Anything mid-download waits for conditions again; a verified or
 * half-swapped file is hashed again before it can be swapped in; a kill while the new model was on trial
 * counts as its failure (it may be what crashed the app), so the old model comes back.
 */
export function recoverUpdate(journal: UpdateState, disk: DiskView): UpdateStep {
  switch (journal.phase) {
    case "idle":
    case "failed":
      return stay(journal);
    case "waiting":
    case "downloading": {
      const received = disk.stagedBytes ?? (journal.phase === "waiting" ? journal.received : 0);
      return stay({ phase: "waiting", manifest: journal.manifest, previous: journal.previous, wait: "network", received });
    }
    case "verifying":
    case "staged":
      return { state: { phase: "verifying", manifest: journal.manifest, previous: journal.previous }, effects: [{ kind: "verify", fileName: stagedModel(journal.manifest).fileName }] };
    case "swapping": {
      const next = stagedModel(journal.manifest);
      if (disk.pointerSha256 === next.sha256) return { state: { phase: "trial", manifest: journal.manifest, previous: journal.previous }, effects: [{ kind: "self_test" }] };
      return { state: { phase: "verifying", manifest: journal.manifest, previous: journal.previous }, effects: [{ kind: "verify", fileName: next.fileName }] };
    }
    case "trial":
      return rollBack(journal.manifest.version, "crash", journal.previous, stagedModel(journal.manifest));
    case "committing":
      return { state: journal, effects: [{ kind: "delete_file", fileName: journal.previous.fileName }] };
    case "rolled_back":
      return { state: journal, effects: rollBack(journal.version, journal.reason, journal.previous, journal.next, disk.pointerSha256 !== journal.previous.sha256).effects };
  }
}

/** The line HM-CHAT-02 shows about an update, if any, and the button it offers. */
export function updateView(s: UpdateState): { key: string; vars: Record<string, string>; action?: "update_now" } | undefined {
  switch (s.phase) {
    case "idle":
      return undefined;
    case "waiting": {
      const wait = s.wait === "network" ? "offline" : s.wait;
      return { key: `HM-CHAT-02.update.waiting_${wait}`, vars: { version: s.manifest.version }, ...(wait === "metered" || wait === "battery" ? { action: "update_now" as const } : {}) };
    }
    case "downloading":
      return { key: "HM-CHAT-02.update.downloading", vars: { version: s.manifest.version } };
    case "verifying":
    case "staged":
    case "swapping":
    case "trial":
      return { key: `HM-CHAT-02.update.${s.phase}`, vars: { version: s.manifest.version } };
    case "committing":
      return { key: "HM-CHAT-02.update.committing", vars: { version: s.installed.version } };
    case "rolled_back":
    case "failed":
      return { key: `HM-CHAT-02.update.${s.phase}`, vars: { version: s.version } };
  }
}
