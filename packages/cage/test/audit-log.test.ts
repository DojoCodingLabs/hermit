import { describe, expect, test } from "vitest";
import { nodeSql } from "@hermit/sql-node";
import { createAuditLog } from "../src/audit-log.ts";
import { ed25519Signer } from "../src/audit.ts";

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
