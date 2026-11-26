import { describe, expect, test } from "vitest";
import { nodeSql } from "@hermit/sql-node";
import { createAuditLog } from "../src/audit-log.ts";
import { appendEntry, ed25519Signer, verifyChain } from "../src/audit.ts";

const signer = ed25519Signer(new Uint8Array(32).fill(3));
const input = (i: number, skill?: string) => ({ ts: 1000 + i, sessionId: "s1", event: "executed" as const, ...(skill ? { skill } : {}), outcome: "ok" as const });

describe("AuditLog", () => {
  test("appended entries persist and verify after reload", async () => {
    const db = nodeSql();
    const log = createAuditLog(db, signer);
    await log.migrate();
    await log.append(input(1, "remember"));
    await log.append(input(2)); // no skill: stored as NULL
    await log.append(input(3, "remind"));
    const reloaded = createAuditLog(db, signer);
    const entries = await reloaded.entries();
    expect(entries.map((e) => e.seq)).toEqual([1, 2, 3]);
    expect(entries[1]!.skill).toBeUndefined();
    expect(await reloaded.verify(await signer.publicKey())).toEqual({ ok: true });
  });

  test("append continues the chain across instances", async () => {
    const db = nodeSql();
    const a = createAuditLog(db, signer);
    await a.migrate();
    const first = await a.append(input(1, "remember"));
    const second = await createAuditLog(db, signer).append(input(2, "recall"));
    expect(second.seq).toBe(2);
    expect(second.prevHash).toBe(first.hash);
  });

  test("tampering in the table is detected", async () => {
    const db = nodeSql();
    const log = createAuditLog(db, signer);
    await log.migrate();
    for (let i = 1; i <= 3; i++) await log.append(input(i, "remember"));
    await db.exec("UPDATE audit SET skill = 'reply_message' WHERE seq = 2");
    expect(await log.verify(await signer.publicKey())).toMatchObject({ ok: false, badSeq: 2 });
  });
});

describe("night shift entries (SL-24, US-NIGHT-03)", () => {
  test("a night job's outcome and reason code are signed, survive a reload and can't be edited", async () => {
    const db = nodeSql();
    const log = createAuditLog(db, signer);
    await log.migrate();
    await log.append(input(1, "remember"));
    await log.append({ ts: 2000, sessionId: "night-1", event: "night_job", skill: "night.mail", outcome: "denied", reason: "paused.hot" });
    const entries = await createAuditLog(db, signer).entries();
    expect(entries[1]).toMatchObject({ event: "night_job", skill: "night.mail", outcome: "denied", reason: "paused.hot" });
    expect(entries[0]!.reason).toBeUndefined();
    expect(await log.verify(await signer.publicKey())).toEqual({ ok: true });
    await db.exec("UPDATE audit SET reason = 'paused.cool' WHERE seq = 2");
    expect(await log.verify(await signer.publicKey())).toMatchObject({ ok: false, badSeq: 2 });
  });
});

describe("Keystore-signed approvals (SL-37, US-CAGE-03)", () => {
  test("the approval entry keeps the payload hash and the hardware signature, signed into the chain", async () => {
    const db = nodeSql();
    const log = createAuditLog(db, signer);
    await log.migrate();
    await log.append(input(1, "remember"));
    const payloadHash = "e".repeat(64);
    const approvalSig = "3045022100" + "ab".repeat(32) + "0220" + "cd".repeat(32);
    await log.append({ ts: 2000, sessionId: "s1", event: "approval", skill: "pay", argsHash: "c".repeat(64), outcome: "ok", payloadHash, approvalSig });
    const entries = await createAuditLog(db, signer).entries();
    expect(entries[1]).toMatchObject({ event: "approval", payloadHash, approvalSig });
    expect(entries[0]!.payloadHash).toBeUndefined();
    expect(entries[0]!.approvalSig).toBeUndefined();
    expect(await log.verify(await signer.publicKey())).toEqual({ ok: true });
    await db.exec("UPDATE audit SET approval_sig = 'ff' WHERE seq = 2");
    expect(await log.verify(await signer.publicKey())).toMatchObject({ ok: false, badSeq: 2 });
  });

  test("the payload hash can't be edited either", async () => {
    const db = nodeSql();
    const log = createAuditLog(db, signer);
    await log.migrate();
    await log.append({ ts: 2000, sessionId: "s1", event: "approval", skill: "pay", outcome: "ok", payloadHash: "e".repeat(64), approvalSig: "30" });
    await db.exec(`UPDATE audit SET payload_hash = '${"f".repeat(64)}' WHERE seq = 1`);
    expect(await log.verify(await signer.publicKey())).toMatchObject({ ok: false, badSeq: 1 });
  });

  test("an approval key event records only its code", async () => {
    const db = nodeSql();
    const log = createAuditLog(db, signer);
    await log.migrate();
    await log.append({ ts: 1, sessionId: "user", event: "approval_key", reason: "approval_key.enrolled" });
    expect((await log.entries())[0]).toMatchObject({ event: "approval_key", reason: "approval_key.enrolled" });
  });
});

// Multi-bot: "the signed log records bot ids". An entry of a bot's turn names its bot, signed into the chain; entries
// written before bots name none and verify exactly as they did.
describe("the bot an entry belongs to (multi-bot)", () => {
  const before = ed25519Signer(new Uint8Array(32).fill(7));
  /** Two entries written by the code before bots (2026-11-25, seed 7): their hashes and signatures must keep verifying. */
  const OLD = [
    {
      seq: 1, ts: 1_700_000_000_000, sessionId: "s1", event: "call_proposed" as const, skill: "read_web", argsHash: "a".repeat(64), prevHash: "0".repeat(64),
      hash: "ed116e0b3f146a79f9fc75e59aa0e27e525bec554e632fc19fe6b4cd6845ba4e",
      sig: "ccde19345aa6d2f295408fbfeeff35cd581c40d1198717d5e7923f81f098f7ae612c0a97845be224a4f50c56de0c449ce60ecd7900a32e43380eeda626f53b00",
    },
    {
      seq: 2, ts: 1_700_000_000_001, sessionId: "s1", event: "executed" as const, skill: "read_web", argsHash: "a".repeat(64), outcome: "ok" as const, reason: "mode.auto",
      prevHash: "ed116e0b3f146a79f9fc75e59aa0e27e525bec554e632fc19fe6b4cd6845ba4e",
      hash: "2f03bd18cc6ec54b8a4a0c6ea94898f0dc3f03222289dbc2d1ddd0ce29c9168d",
      sig: "1e2c65480cdf50a827b4e79850047f485862a78ad19687061160b24ec8bf218b67d82f91794af53c9c449dd8d6c3ee07e3509ec78b1ef9a1615e8c8573822303",
    },
  ];

  test("entries written before bots still verify, and the chain goes on after them with bot ids", async () => {
    const pk = await before.publicKey();
    expect(verifyChain(OLD, pk)).toEqual({ ok: true });
    const next = await appendEntry(OLD[1]!, { ts: 1_700_000_000_002, sessionId: "s2", event: "call_proposed", skill: "remember", argsHash: "b".repeat(64), bot: "b1" }, before);
    expect(next.bot).toBe("b1");
    expect(verifyChain([...OLD, next], pk)).toEqual({ ok: true });
  });

  test("the bot is signed into its entry: changing it, dropping it or adding one breaks the chain", async () => {
    const pk = await before.publicKey();
    const next = await appendEntry(OLD[1]!, { ts: 1_700_000_000_002, sessionId: "s2", event: "call_proposed", skill: "remember", bot: "b1" }, before);
    const without = { ...next };
    delete without.bot;
    expect(verifyChain([...OLD, { ...next, bot: "b2" }], pk)).toMatchObject({ ok: false, badSeq: 3 });
    expect(verifyChain([...OLD, without], pk)).toMatchObject({ ok: false, badSeq: 3 });
    expect(verifyChain([OLD[0]!, { ...OLD[1]!, bot: "b1" }, next], pk)).toMatchObject({ ok: false, badSeq: 2 });
  });

  test("a table from before bots takes the bot column; its old rows verify, new rows keep their bot and can't be edited", async () => {
    const db = nodeSql();
    // The audit table as it was before bots: no bot column, rows the old code wrote.
    await db.exec(`CREATE TABLE audit (
      seq INTEGER PRIMARY KEY, ts INTEGER NOT NULL, session_id TEXT NOT NULL, event TEXT NOT NULL, skill TEXT, args_hash TEXT, decision TEXT,
      outcome TEXT, prev_hash TEXT NOT NULL, hash TEXT NOT NULL, sig TEXT NOT NULL, cleared_count INTEGER, reason TEXT, payload_hash TEXT, approval_sig TEXT)`);
    for (const e of OLD) {
      await db.exec("INSERT INTO audit (seq, ts, session_id, event, skill, args_hash, outcome, reason, prev_hash, hash, sig) VALUES (?,?,?,?,?,?,?,?,?,?,?)", [
        e.seq, e.ts, e.sessionId, e.event, e.skill, e.argsHash, "outcome" in e ? e.outcome : null, "reason" in e ? e.reason : null, e.prevHash, e.hash, e.sig,
      ]);
    }
    const log = createAuditLog(db, before);
    await log.migrate();
    await log.append({ ts: 1_700_000_000_002, sessionId: "s2", event: "call_proposed", skill: "remember", bot: "b1" });
    const entries = await createAuditLog(db, before).entries();
    expect(entries.map((e) => e.bot)).toEqual([undefined, undefined, "b1"]);
    expect(await log.verify(await before.publicKey())).toEqual({ ok: true });
    await db.exec("UPDATE audit SET bot_id = 'b2' WHERE seq = 3");
    expect(await log.verify(await before.publicKey())).toMatchObject({ ok: false, badSeq: 3 });
  });
});
