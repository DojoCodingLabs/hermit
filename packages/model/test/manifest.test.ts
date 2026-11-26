import { describe, expect, test } from "vitest";
import { ed25519 } from "@noble/curves/ed25519.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import { checkManifest, compareVersions, signManifest, SHIPPED_MODEL, type ManifestContext, type ModelManifest } from "../src/manifest.ts";
import { BOTPSY_Q4 } from "../src/profile.ts";

// A key generated for the tests only; the release key never lives in this repository.
const secret = ed25519.utils.randomSecretKey();
const publicKey = bytesToHex(ed25519.getPublicKey(secret));
const otherSecret = ed25519.utils.randomSecretKey();

const next: ModelManifest = {
  schema: 1,
  version: "1.1.0",
  file: {
    id: "botpsy-0.8b-q4_k_m-v1.1",
    url: "https://huggingface.co/qvac/BotPsy-0.8B-GGUFs/resolve/0123456789abcdef0123456789abcdef01234567/botpsy-0.8b-q4_k_m-imat.gguf",
    sha256: "a".repeat(64),
    size: 530_000_000,
    license: "Apache-2.0",
  },
  minAppVersion: "0.0.1",
  revokes: [],
};
const ctx: ManifestContext = { appVersion: "0.0.1", installed: { version: SHIPPED_MODEL.version }, refused: [] };

describe("the shipped model (FR-MODEL-02)", () => {
  test("is the pinned BotPsy file at version 1.0.0", () => {
    expect(SHIPPED_MODEL).toMatchObject({ version: "1.0.0", sha256: BOTPSY_Q4.sha256, size: BOTPSY_Q4.size, fileName: "botpsy-0.8b-q4_k_m-imat.gguf" });
  });
});

describe("versions", () => {
  test("compare numerically, part by part", () => {
    expect(compareVersions("1.10.0", "1.9.9")).toBeGreaterThan(0);
    expect(compareVersions("1.0", "1.0.0")).toBe(0);
    expect(compareVersions("0.0.1", "0.1.0")).toBeLessThan(0);
  });
});

describe("a signed manifest (US-MODEL-04)", () => {
  test("a newer model signed with the pinned key is offered", () => {
    expect(checkManifest(signManifest(next, secret), publicKey, ctx)).toEqual({ kind: "offer", manifest: next, revokesInstalled: false });
  });

  test("no pinned key in the build means no updates at all", () => {
    expect(checkManifest(signManifest(next, secret), undefined, ctx)).toEqual({ kind: "skip", reason: "no_key" });
  });

  test("a tampered manifest is refused: any byte changed after signing breaks the signature", () => {
    const signed = signManifest(next, secret);
    const tampered = { ...signed, payload: signed.payload.replace("a".repeat(64), "b".repeat(64)) };
    expect(checkManifest(tampered, publicKey, ctx)).toEqual({ kind: "skip", reason: "bad_signature" });
  });

  test("a manifest signed by any other key is refused", () => {
    expect(checkManifest(signManifest(next, otherSecret), publicKey, ctx)).toEqual({ kind: "skip", reason: "bad_signature" });
  });

  test("a signature that isn't hex of the right length is refused, never thrown", () => {
    const signed = signManifest(next, secret);
    for (const signature of ["", "zz", signed.signature.slice(2), `${signed.signature}00`]) {
      expect(checkManifest({ ...signed, signature }, publicKey, ctx)).toEqual({ kind: "skip", reason: "bad_signature" });
    }
    expect(checkManifest(signed, "not-a-key", ctx)).toEqual({ kind: "skip", reason: "bad_signature" });
  });

  test("a correctly signed manifest with a bad shape is refused", () => {
    const cases: unknown[] = [
      { ...next, schema: 2 },
      { ...next, version: "latest" },
      { ...next, file: { ...next.file, sha256: "ABC" } },
      { ...next, file: { ...next.file, size: -1 } },
      { ...next, revokes: "1.0.0" },
      { ...next, revokes: [next.version] },
    ];
    for (const m of cases) expect(checkManifest(signManifest(m as ModelManifest, secret), publicKey, ctx), JSON.stringify(m)).toEqual({ kind: "skip", reason: "malformed" });
    expect(checkManifest({ payload: "{not json", signature: bytesToHex(ed25519.sign(new TextEncoder().encode("{not json"), secret)) }, publicKey, ctx)).toEqual({ kind: "skip", reason: "malformed" });
  });

  test("the model URL must still be HTTPS on Hugging Face at a pinned revision (ADR-008)", () => {
    const m = { ...next, file: { ...next.file, url: "https://example.com/model.gguf" } };
    expect(checkManifest(signManifest(m, secret), publicKey, ctx)).toEqual({ kind: "skip", reason: "bad_url" });
  });

  test("a model that needs a newer app waits for the app update", () => {
    expect(checkManifest(signManifest({ ...next, minAppVersion: "0.2.0" }, secret), publicKey, ctx)).toEqual({ kind: "skip", reason: "app_too_old" });
  });

  test("the same version is not an update", () => {
    expect(checkManifest(signManifest({ ...next, version: "1.0.0" }, secret), publicKey, ctx)).toEqual({ kind: "skip", reason: "not_newer" });
  });

  test("never downgrade: an older version is refused unless the manifest revokes the installed one", () => {
    const older = { ...next, version: "0.9.0" };
    expect(checkManifest(signManifest(older, secret), publicKey, ctx)).toEqual({ kind: "skip", reason: "downgrade" });
    const revoking = { ...older, revokes: ["1.0.0"] };
    expect(checkManifest(signManifest(revoking, secret), publicKey, ctx)).toEqual({ kind: "offer", manifest: revoking, revokesInstalled: true });
  });

  test("a newer manifest that revokes the installed model says so", () => {
    const m = { ...next, revokes: ["1.0.0"] };
    expect(checkManifest(signManifest(m, secret), publicKey, ctx)).toMatchObject({ kind: "offer", revokesInstalled: true });
  });

  test("a version that already failed its self-test here is not offered again", () => {
    expect(checkManifest(signManifest(next, secret), publicKey, { ...ctx, refused: ["1.1.0"] })).toEqual({ kind: "skip", reason: "refused" });
  });
});
