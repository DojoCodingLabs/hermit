import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils.js";
import {
  assertPinnedUrl,
  canStart,
  classifyInterruption,
  downloadView,
  percent,
  reduceDownload,
  resumesOnReturn,
  sha256OfChunks,
  STORAGE_MARGIN_BYTES,
  type DeviceFacts,
  type DownloadEvent,
  type DownloadState,
} from "../src/download.ts";
import { BOTPSY_Q4, PROFILES } from "../src/profile.ts";

const wifi: DeviceFacts = { network: "wifi", freeBytes: 10e9, allowMobileData: false };
const offline: DeviceFacts = { ...wifi, network: "none" };
const file = BOTPSY_Q4;
const half = Math.floor(file.size / 2);
const step = (s: DownloadState, e: DownloadEvent) => reduceDownload(file, s, e);
const run = (events: DownloadEvent[], from: DownloadState = { kind: "idle" }) => events.reduce<DownloadState>(step, from);
const start = (device: DeviceFacts = wifi, partialBytes = 0): DownloadEvent => ({ type: "start", device, partialBytes });

describe("when a download may start (US-ONB-03, US-ONB-07)", () => {
  test("Wi-Fi with space starts from zero", () => {
    expect(canStart(file, wifi)).toEqual({ kind: "downloading", from: 0, received: 0, total: file.size });
  });
  test("mobile data waits unless the user allowed it", () => {
    expect(canStart(file, { ...wifi, network: "cellular" }).kind).toBe("waiting_wifi");
    expect(canStart(file, { ...wifi, network: "cellular", allowMobileData: true }).kind).toBe("downloading");
  });
  test("offline says so", () => {
    expect(canStart(file, offline).kind).toBe("offline");
  });
  test("refuses without the size plus a margin, and does not start", () => {
    expect(canStart(file, { ...wifi, freeBytes: file.size + STORAGE_MARGIN_BYTES - 1 })).toEqual({
      kind: "low_storage",
      needBytes: file.size + STORAGE_MARGIN_BYTES,
      received: 0,
      total: file.size,
    });
  });
  test("a kept partial file resumes from its length and only needs the rest plus the margin", () => {
    expect(canStart(file, wifi, half)).toEqual({ kind: "downloading", from: half, received: half, total: file.size });
    const need = file.size - half + STORAGE_MARGIN_BYTES;
    expect(canStart(file, { ...wifi, freeBytes: need }, half).kind).toBe("downloading");
    expect(canStart(file, { ...wifi, freeBytes: need - 1 }, half)).toEqual({ kind: "low_storage", needBytes: need, received: half, total: file.size });
  });
  test("a partial file longer than the model or negative is not trusted: start over from zero", () => {
    expect(canStart(file, wifi, file.size + 1)).toMatchObject({ kind: "downloading", from: 0 });
    expect(canStart(file, wifi, -5)).toMatchObject({ kind: "downloading", from: 0 });
  });
});

describe("the download state machine (FR-MODEL-02)", () => {
  test("only a matching hash reaches ready", () => {
    expect(run([start(), { type: "progress", received: file.size }, { type: "downloaded" }, { type: "verified", sha256: file.sha256.toUpperCase() }])).toEqual({ kind: "ready", sha256: file.sha256 });
  });
  test("verification can't be skipped by events out of order", () => {
    expect(run([{ type: "verified", sha256: file.sha256 }])).toEqual({ kind: "idle" });
    expect(run([{ type: "downloaded" }])).toEqual({ kind: "idle" });
    expect(run([start(), { type: "verified", sha256: file.sha256 }]).kind).toBe("downloading");
  });
  test("progress is clamped and shown as a percent", () => {
    expect(percent(run([start(), { type: "progress", received: file.size * 2 }]))).toBe(100);
    expect(percent(run([start(), { type: "progress", received: Math.floor(file.size / 4) }]))).toBe(25);
  });
  test("progress outside a download is ignored", () => {
    expect(run([{ type: "progress", received: 10 }])).toEqual({ kind: "idle" });
  });
  test("start is ignored while a download, a check or a verified model is in place", () => {
    const downloading = run([start()]);
    expect(step(downloading, start())).toBe(downloading);
    const verifying = run([start(), { type: "downloaded" }]);
    expect(step(verifying, start())).toBe(verifying);
    const ready = run([{ type: "verified", sha256: file.sha256 }], verifying);
    expect(step(ready, start())).toBe(ready);
  });
});

describe("checksum mismatch (EC-ONB-02)", () => {
  const failed = run([start(), { type: "downloaded" }, { type: "verified", sha256: "0".repeat(64) }]);
  test("a wrong hash fails the check and never reaches ready", () => {
    expect(failed).toEqual({ kind: "failed", reason: "checksum" });
  });
  test("retry restarts cleanly from zero, even if a partial length is reported", () => {
    expect(step(failed, start(wifi, half))).toEqual({ kind: "downloading", from: 0, received: 0, total: file.size });
  });
  test("retry still honors the Wi-Fi and storage rules", () => {
    expect(step(failed, start({ ...wifi, network: "cellular" })).kind).toBe("waiting_wifi");
    expect(step(failed, start({ ...wifi, freeBytes: 0 })).kind).toBe("low_storage");
  });
});

describe("network lost mid-download (US-ONB-07)", () => {
  const interrupted = run([start(), { type: "progress", received: half }, { type: "network_lost" }]);
  test("keeps the progress and says it resumes", () => {
    expect(interrupted).toEqual({ kind: "interrupted", received: half, total: file.size });
    expect(percent(interrupted)).toBe(50);
  });
  test("resumes from the kept bytes when the connection is back", () => {
    expect(step(interrupted, start(wifi, half))).toEqual({ kind: "downloading", from: half, received: half, total: file.size });
  });
  test("still offline: stays interrupted with its own message instead of a generic offline", () => {
    expect(step(interrupted, start(offline, half))).toBe(interrupted);
  });
  test("back on mobile data only: waits for Wi-Fi unless allowed", () => {
    expect(step(interrupted, start({ ...wifi, network: "cellular" }, half)).kind).toBe("waiting_wifi");
  });
  test("network loss outside a download is ignored", () => {
    expect(run([{ type: "network_lost" }])).toEqual({ kind: "idle" });
  });
});

describe("storage runs out mid-download (EC-ONB-03)", () => {
  const full = run([start(), { type: "progress", received: half }, { type: "storage_full" }]);
  test("pauses with the space needed for the rest, keeping the progress", () => {
    expect(full).toEqual({ kind: "low_storage", needBytes: file.size - half + STORAGE_MARGIN_BYTES, received: half, total: file.size });
  });
  test("resumes from the kept bytes once space is freed", () => {
    expect(step(full, start(wifi, half))).toEqual({ kind: "downloading", from: half, received: half, total: file.size });
  });
  test("not enough freed yet: still low storage", () => {
    expect(step(full, start({ ...wifi, freeBytes: 1000 }, half)).kind).toBe("low_storage");
  });
  test("storage full outside a download is ignored", () => {
    expect(run([{ type: "storage_full" }])).toEqual({ kind: "idle" });
  });
});

describe("app killed or phone restarted mid-download (EC-ONB-04)", () => {
  test("a partial file found on launch offers to resume from it", () => {
    expect(run([{ type: "found_partial", partialBytes: half }])).toEqual({ kind: "resumable", received: half, total: file.size });
  });
  test("resume continues from the partial file, and the check still runs at the end", () => {
    const s = run([{ type: "found_partial", partialBytes: half }, start(wifi, half), { type: "progress", received: file.size }, { type: "downloaded" }]);
    expect(s).toEqual({ kind: "verifying" });
    expect(step(s, { type: "verified", sha256: "f".repeat(64) })).toEqual({ kind: "failed", reason: "checksum" });
  });
  test("a complete partial file is resumable too (it goes straight to the check)", () => {
    expect(run([{ type: "found_partial", partialBytes: file.size }])).toEqual({ kind: "resumable", received: file.size, total: file.size });
  });
  test("nothing, or an oversized file, on disk: plain start", () => {
    expect(run([{ type: "found_partial", partialBytes: 0 }])).toEqual({ kind: "idle" });
    expect(run([{ type: "found_partial", partialBytes: file.size + 1 }])).toEqual({ kind: "idle" });
  });
  test("only applies before anything else happened", () => {
    const downloading = run([start()]);
    expect(step(downloading, { type: "found_partial", partialBytes: half })).toBe(downloading);
  });
});

describe("what the adapter's error means", () => {
  test("a no-space error is storage", () => {
    for (const message of ["ENOSPC: no space left on device", "write failed: No space left on device", "Not enough space"]) {
      expect(classifyInterruption(file, { message, freeBytes: 10e9, received: 0 }), message).toBe("storage_full");
    }
  });
  test("less free space than the rest of the file is storage, whatever the message", () => {
    expect(classifyInterruption(file, { message: "Download failed", freeBytes: file.size - half - 1, received: half })).toBe("storage_full");
  });
  test("anything else is the network", () => {
    expect(classifyInterruption(file, { message: "Unable to resolve host", freeBytes: 10e9, received: half })).toBe("network_lost");
    expect(classifyInterruption(file, { message: undefined, freeBytes: 10e9, received: 0 })).toBe("network_lost");
  });
});

describe("returning to the screen", () => {
  test("interrupted and low-storage downloads re-check and resume on return (from Settings, or a new connection)", () => {
    expect(resumesOnReturn(run([start(), { type: "network_lost" }]))).toBe(true);
    expect(resumesOnReturn(run([start(), { type: "storage_full" }]))).toBe(true);
    expect(resumesOnReturn(run([start({ ...wifi, freeBytes: 0 })]))).toBe(true);
  });
  test("nothing else starts by itself", () => {
    for (const s of [run([]), run([start()]), run([start(offline)]), run([start({ ...wifi, network: "cellular" })]), run([{ type: "found_partial", partialBytes: half }]), run([start(), { type: "downloaded" }, { type: "verified", sha256: "0".repeat(64) }])]) {
      expect(resumesOnReturn(s), s.kind).toBe(false);
    }
  });
});

describe("what each state says and offers (HM-ONB-03)", () => {
  const load = (name: string): Record<string, string> => JSON.parse(readFileSync(new URL(`../../copy/locales/${name}.json`, import.meta.url), "utf8"));
  const locales = [load("en"), load("es-419")];
  const states: DownloadState[] = [
    { kind: "idle" },
    { kind: "resumable", received: half, total: file.size },
    { kind: "waiting_wifi" },
    { kind: "offline" },
    { kind: "low_storage", needBytes: file.size + STORAGE_MARGIN_BYTES, received: 0, total: file.size },
    { kind: "low_storage", needBytes: file.size - half + STORAGE_MARGIN_BYTES, received: half, total: file.size },
    { kind: "downloading", from: 0, received: half, total: file.size },
    { kind: "interrupted", received: half, total: file.size },
    { kind: "verifying" },
    { kind: "failed", reason: "checksum" },
    { kind: "ready", sha256: file.sha256 },
  ];

  test("every state has copy in both locales, with the placeholders it fills", () => {
    for (const s of states) {
      const v = downloadView(file, s);
      for (const dict of locales) {
        expect(dict[v.body], `${s.kind} body`).toBeTruthy();
        const used = [...dict[v.body]!.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
        expect(used, `${s.kind} placeholders`).toEqual(Object.keys(v.vars).sort());
        for (const a of v.actions) expect(dict[a.label], `${s.kind} ${a.id}`).toBeTruthy();
      }
    }
  });

  test("each failure has its own message and action", () => {
    const view = (s: DownloadState) => downloadView(file, s);
    const ids = (s: DownloadState) => view(s).actions.map((a) => a.id);
    expect(view({ kind: "failed", reason: "checksum" }).body).toBe("HM-ONB-03.checkFailed");
    expect(ids({ kind: "failed", reason: "checksum" })).toEqual(["retry_clean"]);
    expect(view({ kind: "interrupted", received: half, total: file.size }).body).toBe("HM-ONB-03.networkLost");
    expect(ids({ kind: "interrupted", received: half, total: file.size })).toEqual(["resume"]);
    expect(view(states[5]!).body).toBe("HM-ONB-03.storageFull");
    expect(ids(states[5]!)).toEqual(["storage_settings", "resume"]);
    expect(view(states[4]!).body).toBe("HM-ONB-03.lowStorage");
    expect(ids(states[4]!)).toEqual(["storage_settings", "start"]);
    expect(view({ kind: "offline" }).body).toBe("HM-ONB-03.offline");
    expect(ids({ kind: "waiting_wifi" })).toEqual(["allow_mobile", "start"]);
    expect(view({ kind: "resumable", received: half, total: file.size }).body).toBe("HM-ONB-03.resumable");
    expect(ids({ kind: "resumable", received: half, total: file.size })).toEqual(["resume"]);
    expect(ids({ kind: "ready", sha256: file.sha256 })).toEqual(["continue"]);
  });

  test("no actions while bytes move or the check runs", () => {
    expect(downloadView(file, states[6]!).actions).toEqual([]);
    expect(downloadView(file, { kind: "verifying" }).actions).toEqual([]);
  });

  test("sizes travel as bytes for the screen to format", () => {
    expect(downloadView(file, states[5]!).vars).toEqual({ percent: 50, size: file.size - half + STORAGE_MARGIN_BYTES });
    expect(downloadView(file, { kind: "idle" }).vars).toEqual({ size: file.size });
  });
});

describe("checksum and pinning", () => {
  test("hashes chunked input the same as the whole", async () => {
    const data = utf8ToBytes("hermit".repeat(1000));
    async function* chunks() {
      for (let i = 0; i < data.length; i += 777) yield data.slice(i, i + 777);
    }
    expect(await sha256OfChunks(chunks())).toBe(bytesToHex(sha256(data)));
  });
  test("every shipped profile points at a pinned HTTPS file", () => {
    for (const p of PROFILES) expect(() => assertPinnedUrl(p.file)).not.toThrow();
  });
  test("unpinned, non-HTTPS or other hosts are refused", () => {
    for (const url of [
      "http://huggingface.co/qvac/x/resolve/17bb36aa29c58fcde8e321aaaad3f2f7372aa655/f.gguf",
      "https://huggingface.co/qvac/x/resolve/main/f.gguf",
      "https://evil.example/qvac/x/resolve/17bb36aa29c58fcde8e321aaaad3f2f7372aa655/f.gguf",
    ]) expect(() => assertPinnedUrl({ ...file, url })).toThrow();
  });
});
