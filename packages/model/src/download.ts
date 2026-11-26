import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import type { ModelFile } from "./profile.ts";

/**
 * SL-01 and SL-16: the model download (US-ONB-03, US-ONB-07, FR-MODEL-02). Pure rules and state; the
 * phone supplies the bytes (a resumable HTTPS download) and the device facts. Nothing is trusted until
 * the SHA-256 matches.
 */
export type Network = "wifi" | "cellular" | "none";

export interface DeviceFacts {
  network: Network;
  freeBytes: number;
  allowMobileData: boolean;
}

/** Free space kept after the download so the phone isn't left full (product rule). */
export const STORAGE_MARGIN_BYTES = 500 * 1024 * 1024;

/**
 * What HM-ONB-03 shows. A partial file is kept across a lost connection, a full disk and an app kill
 * (EC-ONB-03, EC-ONB-04) so the download resumes from it; after a failed check it is deleted and the
 * next attempt starts from zero (EC-ONB-02). `downloading.from` tells the adapter which: 0 means
 * delete any partial file and start clean, more than 0 means resume from that many bytes.
 */
export type DownloadState =
  | { kind: "idle" }
  | { kind: "resumable"; received: number; total: number }
  | { kind: "waiting_wifi" }
  | { kind: "offline" }
  | { kind: "low_storage"; needBytes: number; received: number; total: number }
  | { kind: "downloading"; from: number; received: number; total: number }
  | { kind: "interrupted"; received: number; total: number }
  | { kind: "verifying" }
  | { kind: "failed"; reason: "checksum" }
  | { kind: "ready"; sha256: string };

/** A partial file is trusted for resuming only when it is no longer than the model; else start over. */
function usablePartial(file: ModelFile, partialBytes: number): number {
  return partialBytes > 0 && partialBytes <= file.size ? partialBytes : 0;
}

/** Whether a download may start now (resuming from `partialBytes`), and if not, which state explains why. */
export function canStart(file: ModelFile, d: DeviceFacts, partialBytes = 0): DownloadState {
  if (d.network === "none") return { kind: "offline" };
  if (d.network === "cellular" && !d.allowMobileData) return { kind: "waiting_wifi" };
  const from = usablePartial(file, partialBytes);
  const need = file.size - from + STORAGE_MARGIN_BYTES;
  if (d.freeBytes < need) return { kind: "low_storage", needBytes: need, received: from, total: file.size };
  return { kind: "downloading", from, received: from, total: file.size };
}

export type DownloadEvent =
  /** On opening the screen: the length of a partial file left by an earlier run (0 when none). */
  | { type: "found_partial"; partialBytes: number }
  /** Start, resume or retry; `partialBytes` is the partial file's length on disk right now. */
  | { type: "start"; device: DeviceFacts; partialBytes: number }
  | { type: "progress"; received: number }
  | { type: "network_lost" }
  | { type: "storage_full" }
  | { type: "downloaded" }
  | { type: "verified"; sha256: string };

/** The screen's state machine. Only a matching hash reaches `ready`; every other path says what to do next. */
export function reduceDownload(file: ModelFile, state: DownloadState, e: DownloadEvent): DownloadState {
  switch (e.type) {
    case "found_partial": {
      if (state.kind !== "idle") return state;
      const received = usablePartial(file, e.partialBytes);
      return received > 0 ? { kind: "resumable", received, total: file.size } : state;
    }
    case "start": {
      if (state.kind === "downloading" || state.kind === "verifying" || state.kind === "ready") return state;
      // After a failed check the file was deleted: never resume from bytes that failed once.
      const next = canStart(file, e.device, state.kind === "failed" ? 0 : e.partialBytes);
      // Still offline after a drop: keep saying the progress is kept, not a generic offline line.
      if (state.kind === "interrupted" && next.kind === "offline") return state;
      return next;
    }
    case "progress":
      return state.kind === "downloading" ? { ...state, received: Math.min(e.received, state.total) } : state;
    case "network_lost":
      return state.kind === "downloading" ? { kind: "interrupted", received: state.received, total: state.total } : state;
    case "storage_full":
      return state.kind === "downloading"
        ? { kind: "low_storage", needBytes: state.total - state.received + STORAGE_MARGIN_BYTES, received: state.received, total: state.total }
        : state;
    case "downloaded":
      return state.kind === "downloading" ? { kind: "verifying" } : state;
    case "verified":
      if (state.kind !== "verifying") return state;
      return e.sha256.toLowerCase() === file.sha256 ? { kind: "ready", sha256: file.sha256 } : { kind: "failed", reason: "checksum" };
  }
}

/**
 * Why the adapter's download stopped: storage when the error says so or the phone has less room than
 * the rest of the file, otherwise the network. Read with fresh device facts after the error.
 */
export function classifyInterruption(file: ModelFile, x: { message: string | undefined; freeBytes: number; received: number }): "storage_full" | "network_lost" {
  if (x.message && /ENOSPC|no space|not enough space|disk full/i.test(x.message)) return "storage_full";
  return x.freeBytes < file.size - x.received ? "storage_full" : "network_lost";
}

/** States that re-check the phone and resume by themselves when the user comes back (from Settings, or online). */
export function resumesOnReturn(state: DownloadState): boolean {
  return state.kind === "interrupted" || state.kind === "low_storage";
}

export type DownloadAction = "start" | "resume" | "retry_clean" | "allow_mobile" | "storage_settings" | "continue";

/** What HM-ONB-03 renders for a state: a copy key with its values (sizes in bytes) and the buttons, in order. */
export interface DownloadView {
  body: string;
  vars: Record<string, number>;
  actions: Array<{ id: DownloadAction; label: string }>;
}

const LABEL: Record<Exclude<DownloadAction, "start">, string> = {
  resume: "HM-ONB-03.resume",
  retry_clean: "HM-ONB-03.retryClean",
  allow_mobile: "HM-ONB-03.allowMobile",
  storage_settings: "HM-ONB-03.openStorage",
  continue: "common.continue",
};
const act = (id: Exclude<DownloadAction, "start">) => ({ id, label: LABEL[id] });
const startAs = (label: string) => ({ id: "start" as const, label });

export function downloadView(file: ModelFile, state: DownloadState): DownloadView {
  switch (state.kind) {
    case "idle":
      return { body: "HM-ONB-03.body", vars: { size: file.size }, actions: [startAs("HM-ONB-03.start")] };
    case "resumable":
      return { body: "HM-ONB-03.resumable", vars: { percent: percent(state) }, actions: [act("resume")] };
    case "waiting_wifi":
      return { body: "HM-ONB-03.wifiOnly", vars: {}, actions: [act("allow_mobile"), startAs("HM-ONB-03.start")] };
    case "offline":
      return { body: "HM-ONB-03.offline", vars: {}, actions: [startAs("common.retry")] };
    case "low_storage":
      return state.received > 0
        ? { body: "HM-ONB-03.storageFull", vars: { percent: percent(state), size: state.needBytes }, actions: [act("storage_settings"), act("resume")] }
        : { body: "HM-ONB-03.lowStorage", vars: { size: state.needBytes }, actions: [act("storage_settings"), startAs("common.retry")] };
    case "downloading":
      return { body: "HM-ONB-03.progress", vars: { percent: percent(state) }, actions: [] };
    case "interrupted":
      return { body: "HM-ONB-03.networkLost", vars: { percent: percent(state) }, actions: [act("resume")] };
    case "verifying":
      return { body: "HM-ONB-03.verifying", vars: {}, actions: [] };
    case "failed":
      return { body: "HM-ONB-03.checkFailed", vars: {}, actions: [act("retry_clean")] };
    case "ready":
      return { body: "HM-ONB-03.done", vars: {}, actions: [act("continue")] };
  }
}

/** Hash a file read in chunks. The caller deletes the file when this returns a mismatch. */
export async function sha256OfChunks(chunks: AsyncIterable<Uint8Array>): Promise<string> {
  const h = sha256.create();
  for await (const c of chunks) h.update(c);
  return bytesToHex(h.digest());
}

/** The URL must be HTTPS on the pinned host (ADR-008); anything else is refused before any byte moves. */
export function assertPinnedUrl(file: ModelFile): void {
  const u = new URL(file.url);
  if (u.protocol !== "https:" || u.hostname !== "huggingface.co" || !/\/resolve\/[0-9a-f]{40}\//.test(u.pathname)) {
    throw new Error(`Model URL must be HTTPS on huggingface.co at a pinned revision: ${file.url}`);
  }
  if (!/^[0-9a-f]{64}$/.test(file.sha256)) throw new Error("Model sha256 must be 64 hex characters.");
}

/** Percent for the progress bar and the copy that mentions how far the download got. */
export function percent(state: DownloadState): number {
  if (state.kind === "ready") return 100;
  if ("received" in state && state.total > 0) return Math.floor((state.received / state.total) * 100);
  return 0;
}
