import { describe, expect, test } from "vitest";
import { appendEntry, ed25519Signer, GENESIS_HASH, verifyChain, type AuditEntry } from "../src/audit.ts";

const seed = new Uint8Array(32).fill(7);
const signer = ed25519Signer(seed);
const base = { ts: 1_700_000_000_000, sessionId: "s1" };

async function chain(n: number): Promise<AuditEntry[]> {
  const out: AuditEntry[] = [];
  for (let i = 0; i < n; i++) {
    out.push(await appendEntry(out.at(-1) ?? null, { ...base, ts: base.ts + i, event: "executed", skill: `skill_${i}`, outcome: "ok" }, signer));
  }
  return out;
}

describe("audit chain", () => {
  test("appendEntry links to previous hash", async () => {
    const [a, b] = await chain(2);
    expect(a!.seq).toBe(1);
    expect(a!.prevHash).toBe(GENESIS_HASH);
    expect(b!.seq).toBe(2);
    expect(b!.prevHash).toBe(a!.hash);
  });

  test("verifyChain accepts a valid chain", async () => {
    expect(verifyChain(await chain(3), await signer.publicKey())).toEqual({ ok: true });
  });

  test("verifyChain detects edit", async () => {
    const c = await chain(3);
    c[1] = { ...c[1]!, skill: "reply_message" };
    expect(verifyChain(c, await signer.publicKey())).toMatchObject({ ok: false, badSeq: 2 });
  });

  test("verifyChain detects reorder", async () => {
    const c = await chain(3);
    expect(verifyChain([c[0]!, c[2]!, c[1]!], await signer.publicKey()).ok).toBe(false);
  });

  test("verifyChain detects deletion", async () => {
    const c = await chain(3);
    expect(verifyChain([c[0]!, c[2]!], await signer.publicKey())).toMatchObject({ ok: false, badSeq: 2 });
  });

  test("verifyChain rejects wrong key", async () => {
    const other = await ed25519Signer(new Uint8Array(32).fill(9)).publicKey();
    expect(verifyChain(await chain(2), other)).toMatchObject({ ok: false, badSeq: 1 });
  });
});

describe("audit chain robustness", () => {
  test("entry reloaded with null optional fields still verifies", async () => {
    const e = await appendEntry(null, { ...base, event: "taint_added" }, signer);
    const reloaded = { ...e, skill: null, argsHash: null, decision: null, outcome: null } as unknown as AuditEntry;
    expect(verifyChain([reloaded], await signer.publicKey())).toEqual({ ok: true });
  });

  test("verifyChain reports a malformed signature instead of throwing", async () => {
    const c = await chain(2);
    c[1] = { ...c[1]!, sig: "zz" };
    expect(verifyChain(c, await signer.publicKey())).toMatchObject({ ok: false, badSeq: 2 });
  });
});
