import { ed25519 } from "@noble/curves/ed25519.js";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils.js";
import { assertPinnedUrl } from "./download.ts";
import { BOTPSY_Q4, type ModelFile } from "./profile.ts";

/**
 * SL-43: the signed model manifest (US-MODEL-04). A model update is accepted only from a manifest signed with
 * the Ed25519 key pinned in the app build; the signature covers the payload's exact bytes, so nothing is
 * canonicalized and any changed byte refuses it. The build ships no key and no manifest source today, so
 * updates are off and the pinned model of FR-MODEL-02 is the only one (Q104).
 */
export interface ModelManifest {
  schema: 1;
  /** Dotted numbers, e.g. "1.1.0". */
  version: string;
  file: ModelFile;
  /** The oldest app that can run this model (its profile, template and runtime). */
  minAppVersion: string;
  /** Versions withdrawn: an installed revoked version may be replaced by an older one (the only downgrade). */
  revokes: string[];
}

export interface SignedManifest {
  /** The manifest JSON exactly as signed. */
  payload: string;
  /** Hex Ed25519 signature over the payload's UTF-8 bytes. */
  signature: string;
}

/** The model on disk and the version it counts as. */
export interface InstalledModel {
  version: string;
  fileName: string;
  sha256: string;
  size: number;
}

/** The model this build pins (FR-MODEL-02), as the update machine counts it. */
export const SHIPPED_MODEL: InstalledModel = {
  version: "1.0.0",
  fileName: BOTPSY_Q4.url.split("/").pop()!,
  sha256: BOTPSY_Q4.sha256,
  size: BOTPSY_Q4.size,
};

const VERSION = /^\d+(\.\d+){0,3}$/;

export function compareVersions(a: string, b: string): number {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d) return d;
  }
  return 0;
}

export interface ManifestContext {
  appVersion: string;
  installed: { version: string };
  /** Versions that failed their self-test on this phone and were rolled back. */
  refused: readonly string[];
}

export type ManifestSkip = "no_key" | "bad_signature" | "malformed" | "bad_url" | "app_too_old" | "not_newer" | "downgrade" | "refused";
export type ManifestVerdict = { kind: "offer"; manifest: ModelManifest; revokesInstalled: boolean } | { kind: "skip"; reason: ManifestSkip };

const encode = (s: string) => new TextEncoder().encode(s);

function verifySignature(m: SignedManifest, publicKeyHex: string): boolean {
  try {
    if (!/^[0-9a-f]{128}$/i.test(m.signature) || !/^[0-9a-f]{64}$/i.test(publicKeyHex)) return false;
    return ed25519.verify(hexToBytes(m.signature), encode(m.payload), hexToBytes(publicKeyHex));
  } catch {
    return false;
  }
}

function parse(payload: string): ModelManifest | undefined {
  let m: unknown;
  try {
    m = JSON.parse(payload);
  } catch {
    return undefined;
  }
  if (!m || typeof m !== "object") return undefined;
  const o = m as Record<string, unknown>;
  const f = o.file as Record<string, unknown> | undefined;
  const ok =
    o.schema === 1 &&
    typeof o.version === "string" && VERSION.test(o.version) &&
    typeof o.minAppVersion === "string" && VERSION.test(o.minAppVersion) &&
    Array.isArray(o.revokes) && o.revokes.every((v) => typeof v === "string" && VERSION.test(v)) &&
    !o.revokes.includes(o.version) &&
    !!f && typeof f === "object" &&
    typeof f.id === "string" && f.id.length > 0 &&
    typeof f.url === "string" &&
    typeof f.sha256 === "string" && /^[0-9a-f]{64}$/.test(f.sha256) &&
    typeof f.size === "number" && Number.isSafeInteger(f.size) && f.size > 0 &&
    typeof f.license === "string";
  return ok ? (m as ModelManifest) : undefined;
}

/** Signature first, then shape, then the rules; never throws. */
export function checkManifest(signed: SignedManifest, publicKeyHex: string | undefined, ctx: ManifestContext): ManifestVerdict {
  const skip = (reason: ManifestSkip): ManifestVerdict => ({ kind: "skip", reason });
  if (!publicKeyHex) return skip("no_key");
  if (!verifySignature(signed, publicKeyHex)) return skip("bad_signature");
  const m = parse(signed.payload);
  if (!m) return skip("malformed");
  try {
    assertPinnedUrl(m.file);
  } catch {
    return skip("bad_url");
  }
  if (compareVersions(m.minAppVersion, ctx.appVersion) > 0) return skip("app_too_old");
  if (ctx.refused.includes(m.version)) return skip("refused");
  const revokesInstalled = m.revokes.includes(ctx.installed.version);
  const cmp = compareVersions(m.version, ctx.installed.version);
  if (cmp === 0) return skip("not_newer");
  if (cmp < 0 && !revokesInstalled) return skip("downgrade");
  return { kind: "offer", manifest: m, revokesInstalled };
}

/** Release tooling and tests: signs a manifest. The release key is kept off the repository and off the phone. */
export function signManifest(m: ModelManifest, secretKey: Uint8Array): SignedManifest {
  const payload = JSON.stringify(m);
  return { payload, signature: bytesToHex(ed25519.sign(encode(payload), secretKey)) };
}
