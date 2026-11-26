import { describe, expect, test } from "vitest";
import { nodeSql } from "@hermit/sql-node";
import { canonicalJson, migrate, sha256Hex } from "@hermit/core";
import { activityDetail, activityRows, chainView } from "../src/activity.ts";
import { createAuditLog } from "../src/audit-log.ts";
import { appendEntry, ed25519Signer, GENESIS_HASH, verifyChain } from "../src/audit.ts";

const signer = ed25519Signer(new Uint8Array(32).fill(5));
const base = { ts: 10, sessionId: "s" };

async function filledLog(n: number) {
  const sql = nodeSql();
  const log = createAuditLog(sql, signer);
  await log.migrate();
  for (let i = 0; i < n; i++) {
    await log.append({ ...base, event: "call_proposed", skill: "remember", argsHash: `a${i}` });
    await log.append({ ...base, event: "executed", skill: "remember", argsHash: `a${i}`, outcome: "ok" });
  }
  return { sql, log };
}

describe("a logged clear (US-ACT-04, FR-ACT-04, PDR-012)", () => {
  test("clearing starts a new chain whose genesis records log_cleared, the previous head hash and the count", async () => {
    const { log } = await filledLog(2);
    const before = await log.entries();
    const head = before.at(-1)!;
    const genesis = await log.clear({ ts: 99, sessionId: "user" });
    const after = await log.entries();
    expect(after).toHaveLength(1);
    expect(after[0]).toEqual(genesis);
    expect(genesis).toMatchObject({ seq: 1, event: "log_cleared", prevHash: head.hash, clearedCount: 4, ts: 99 });
    expect(await log.verify(await signer.publicKey())).toEqual({ ok: true });
  });

  test("the chain keeps growing after the clear and still verifies", async () => {
    const { log } = await filledLog(1);
    await log.clear({ ts: 99, sessionId: "user" });
    const next = await log.append({ ...base, event: "call_proposed", skill: "recall" });
    expect(next.seq).toBe(2);
    expect(await log.verify(await signer.publicKey())).toEqual({ ok: true });
  });

  test("clearing an empty log still leaves one logged entry, linked to the genesis hash", async () => {
    const { log } = await filledLog(0);
    const genesis = await log.clear({ ts: 1, sessionId: "user" });
    expect(genesis).toMatchObject({ seq: 1, prevHash: GENESIS_HASH, clearedCount: 0 });
    expect(await log.verify(await signer.publicKey())).toEqual({ ok: true });
  });

  test("a second clear records the first clear's entry as the previous head", async () => {
    const { log } = await filledLog(1);
    const first = await log.clear({ ts: 2, sessionId: "user" });
    const second = await log.clear({ ts: 3, sessionId: "user" });
    expect(second).toMatchObject({ prevHash: first.hash, clearedCount: 1 });
  });

  test("the count is signed: editing it breaks the chain", async () => {
    const { sql, log } = await filledLog(2);
    await log.clear({ ts: 2, sessionId: "user" });
    await sql.exec("DROP TRIGGER IF EXISTS audit_no_update");
    await sql.exec("UPDATE audit SET cleared_count = 0 WHERE seq = 1");
    expect(await log.verify(await signer.publicKey())).toMatchObject({ ok: false, badSeq: 1, reason: "entry was modified" });
  });

  test("only a log_cleared genesis may point past the zero hash", async () => {
    const forged = await appendEntry(null, { ...base, event: "executed", skill: "remember", outcome: "ok" }, signer);
    const moved = { ...forged, prevHash: "f".repeat(64) };
    expect(verifyChain([moved], await signer.publicKey())).toMatchObject({ ok: false, badSeq: 1, reason: "broken link to previous entry" });
  });

  test("a log_cleared entry in the middle of a chain must link like any other", async () => {
    const one = await appendEntry(null, { ...base, event: "executed", skill: "remember", outcome: "ok" }, signer);
    const two = await appendEntry(one, { ...base, event: "log_cleared", clearedCount: 3 }, signer);
    expect(verifyChain([one, two], await signer.publicKey())).toEqual({ ok: true });
    expect(verifyChain([one, { ...two, prevHash: "e".repeat(64) }], await signer.publicKey())).toMatchObject({ ok: false, badSeq: 2 });
  });

  test("entries without a count hash exactly as before (old logs stay verified)", async () => {
    const e = await appendEntry(null, { ...base, event: "executed", skill: "remember", outcome: "ok" }, signer);
    // The SL-08 tuple: [seq, ts, sessionId, event, skill, argsHash, decision, outcome], nothing appended.
    expect(e.hash).toBe(sha256Hex(GENESIS_HASH + canonicalJson([1, 10, "s", "executed", "remember", null, null, "ok"])));
    expect(e).not.toHaveProperty("clearedCount");
  });

  test("the schema migration adds the count column to the audit table", async () => {
    const sql = nodeSql();
    await migrate(sql);
    const log = createAuditLog(sql, signer);
    await log.append({ ...base, event: "executed", skill: "remember", outcome: "ok" });
    const genesis = await log.clear({ ts: 5, sessionId: "user" });
    expect((await log.entries())[0]).toEqual(genesis);
  });

  test("the cleared entry shows as one activity row with its count", async () => {
    const { log } = await filledLog(2);
    await log.clear({ ts: 7, sessionId: "user" });
    await log.append({ ...base, event: "call_proposed", skill: "recall" });
    const entries = await log.entries();
    expect(activityRows(entries).map((r) => [r.seq, r.mark, r.clearedCount])).toEqual([[2, "proposed", undefined], [1, "cleared", 4]]);
    expect(chainView(entries, await log.verify(await signer.publicKey()))).toEqual({ kind: "verified", count: 2 });
  });
});

describe("entry details (US-ACT-03, HM-ACT-02)", () => {
  test("a row opens every entry of its call, oldest first, with the full hashes and signature", async () => {
    const sql = nodeSql();
    const log = createAuditLog(sql, signer);
    await log.migrate();
    for (const i of [
      { ...base, event: "call_proposed", skill: "reply_message", argsHash: "h1" },
      { ...base, event: "policy_decided", skill: "reply_message", argsHash: "h1", decision: "ask" },
      { ...base, event: "approval", skill: "reply_message", argsHash: "h1", outcome: "ok" },
      { ...base, event: "executed", skill: "reply_message", argsHash: "h1", outcome: "ok" },
      { ...base, event: "call_proposed", skill: "remember", argsHash: "h2" },
    ] as const) await log.append(i);
    const entries = await log.entries();
    const detail = activityDetail(entries, 1)!;
    expect(detail.map((d) => [d.seq, d.event, d.decision, d.outcome])).toEqual([
      [1, "call_proposed", undefined, undefined],
      [2, "policy_decided", "ask", undefined],
      [3, "approval", undefined, "ok"],
      [4, "executed", undefined, "ok"],
    ]);
    expect(detail[0]).toMatchObject({ skill: "reply_message", argsHash: "h1", at: 10, hash: entries[0]!.hash, sig: entries[0]!.sig, prevHash: GENESIS_HASH });
    expect(detail[0]!.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(detail[0]!.sig).toMatch(/^[0-9a-f]{128}$/);
    expect(activityDetail(entries, 5)!.map((d) => d.seq)).toEqual([5]);
  });

  test("details hold metadata and hashes only, never content (FR-ACT-02)", async () => {
    const { log } = await filledLog(1);
    const [d] = activityDetail(await log.entries(), 1)!;
    expect(Object.keys(d!).sort()).toEqual(["argsHash", "at", "event", "hash", "prevHash", "seq", "sig", "skill"]);
  });

  test("a cleared entry opens with its count and the previous head hash", async () => {
    const { log } = await filledLog(1);
    const g = await log.clear({ ts: 3, sessionId: "user" });
    expect(activityDetail(await log.entries(), 1)).toEqual([{ seq: 1, at: 3, event: "log_cleared", prevHash: g.prevHash, hash: g.hash, sig: g.sig, clearedCount: 2 }]);
  });

  test("an unknown or non-row sequence opens nothing", async () => {
    const { log } = await filledLog(1);
    const entries = await log.entries();
    expect(activityDetail(entries, 2)).toBeUndefined();
    expect(activityDetail(entries, 42)).toBeUndefined();
  });
});
