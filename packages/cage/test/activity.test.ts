import { describe, expect, test } from "vitest";
import { nodeSql } from "@hermit/sql-node";
import { chainView, activityRows } from "../src/activity.ts";
import { createAuditLog } from "../src/audit-log.ts";
import { ed25519Signer } from "../src/audit.ts";

const signer = ed25519Signer(new Uint8Array(32).fill(9));

async function logWith(inputs: Array<Parameters<ReturnType<typeof createAuditLog>["append"]>[0]>) {
  const log = createAuditLog(nodeSql(), signer);
  await log.migrate();
  for (const i of inputs) await log.append(i);
  return log;
}
const base = { ts: 1, sessionId: "s" };

describe("activity rows (US-ACT-01)", () => {
  test("one row per call, newest first, with its final state", async () => {
    const log = await logWith([
      { ...base, event: "call_proposed", skill: "remember", argsHash: "a" },
      { ...base, event: "policy_decided", skill: "remember", decision: "allow" },
      { ...base, event: "executed", skill: "remember", outcome: "ok" },
      { ...base, event: "call_proposed", skill: "reply_message", argsHash: "b" },
      { ...base, event: "policy_decided", skill: "reply_message", decision: "ask" },
      { ...base, event: "approval", skill: "reply_message", outcome: "ok" },
      { ...base, event: "executed", skill: "reply_message", outcome: "ok" },
      { ...base, event: "call_proposed", skill: "pay", argsHash: "c" },
      { ...base, event: "policy_decided", skill: "pay", decision: "deny" },
    ]);
    const rows = activityRows(await log.entries());
    expect(rows.map((r) => [r.skill, r.mark])).toEqual([["pay", "blocked"], ["reply_message", "approved"], ["remember", "ran"]]);
    for (const r of rows) expect(r.shortHash).toMatch(/^[0-9a-f]{8}$/);
  });

  test("a denied or expired approval shows as denied; a failed run as failed", async () => {
    const log = await logWith([
      { ...base, event: "call_proposed", skill: "reply_message" },
      { ...base, event: "approval", skill: "reply_message", outcome: "expired" },
      { ...base, event: "call_proposed", skill: "remind" },
      { ...base, event: "executed", skill: "remind", outcome: "error" },
    ]);
    expect(activityRows(await log.entries()).map((r) => r.mark)).toEqual(["failed", "denied"]);
  });

  test("rows carry no content: only seq, time, skill, mark and a short hash", async () => {
    const log = await logWith([{ ...base, event: "call_proposed", skill: "remember", argsHash: "x" }]);
    expect(Object.keys(activityRows(await log.entries())[0]!).sort()).toEqual(["at", "mark", "seq", "shortHash", "skill"]);
  });
});

describe("chain view (US-ACT-02)", () => {
  test("verified, empty, or broken at the entry with the reason", async () => {
    const log = await logWith([{ ...base, event: "call_proposed", skill: "remember" }, { ...base, event: "executed", skill: "remember", outcome: "ok" }]);
    const entries = await log.entries();
    const pk = await signer.publicKey();
    expect(chainView(entries, await log.verify(pk))).toEqual({ kind: "verified", count: 2 });
    expect(chainView([], { ok: true })).toEqual({ kind: "empty" });
    const tampered = entries.map((e, i) => (i === 1 ? { ...e, outcome: "error" as const } : e));
    const { verifyChain } = await import("../src/audit.ts");
    expect(chainView(tampered, verifyChain(tampered, pk))).toEqual({ kind: "broken", atSeq: 2, reason: "entry was modified" });
  });
});

describe("night shift rows (SL-24, US-NIGHT-03)", () => {
  test("each night job is its own row: ran, failed, or skipped with its reason", async () => {
    const log = await logWith([
      { ...base, event: "night_job", skill: "night.agenda", outcome: "ok" },
      { ...base, event: "night_job", skill: "night.mail", outcome: "denied", reason: "paused.hot" },
      { ...base, event: "night_job", skill: "night.messages", outcome: "error" },
    ]);
    const rows = activityRows(await log.entries());
    expect(rows.map((r) => [r.skill, r.mark, r.reason ?? null])).toEqual([
      ["night.messages", "failed", null],
      ["night.mail", "skipped", "paused.hot"],
      ["night.agenda", "ran", null],
    ]);
    const { activityDetail } = await import("../src/activity.ts");
    expect(activityDetail(await log.entries(), 2)).toEqual([expect.objectContaining({ event: "night_job", reason: "paused.hot" })]);
  });
});

describe("vault rows (SL-33)", () => {
  test("each vault action is its own row, carrying only the item hash and the action code", async () => {
    const hash = "a".repeat(64);
    const log = await logWith([
      { ...base, event: "call_proposed", skill: "remember", argsHash: "x" },
      { ...base, event: "vault", skill: "vault", argsHash: hash, outcome: "ok", reason: "vault.added" },
      { ...base, event: "executed", skill: "remember", outcome: "ok" },
      { ...base, event: "vault", skill: "vault", argsHash: hash, outcome: "ok", reason: "vault.revealed" },
    ]);
    const rows = activityRows(await log.entries());
    expect(rows.map((r) => [r.skill, r.mark, r.reason ?? null])).toEqual([
      ["vault", "ran", "vault.revealed"],
      ["vault", "ran", "vault.added"],
      ["remember", "ran", null],
    ]);
    const { activityDetail } = await import("../src/activity.ts");
    expect(activityDetail(await log.entries(), 2)).toEqual([expect.objectContaining({ event: "vault", argsHash: hash, reason: "vault.added" })]);
    // A vault entry ends the call before it: the call's later entries no longer fold into it.
    expect(activityDetail(await log.entries(), 1)).toHaveLength(1);
    expect(await log.verify(await signer.publicKey())).toEqual({ ok: true });
  });
});

describe("connector rows (SL-55, US-CONN-05)", () => {
  test("an install or removal is its own row with the spec hash and the action code, signed into the chain", async () => {
    const hash = "b".repeat(64);
    const log = await logWith([
      { ...base, event: "connector", skill: "connector", argsHash: hash, outcome: "ok", reason: "connector.installed" },
      { ...base, event: "connector", skill: "connector", argsHash: hash, outcome: "ok", reason: "connector.removed" },
    ]);
    expect(activityRows(await log.entries()).map((r) => [r.skill, r.mark, r.reason ?? null])).toEqual([
      ["connector", "ran", "connector.removed"],
      ["connector", "ran", "connector.installed"],
    ]);
    const { activityDetail } = await import("../src/activity.ts");
    expect(activityDetail(await log.entries(), 1)).toEqual([expect.objectContaining({ event: "connector", argsHash: hash, reason: "connector.installed" })]);
    expect(await log.verify(await signer.publicKey())).toEqual({ ok: true });
  });
});

describe("spending rows (SL-40, US-PAY-06)", () => {
  test("a cap change and a saved payee are their own rows with a hash and the action code only", async () => {
    const hash = "d".repeat(64);
    const log = await logWith([
      { ...base, event: "spending", skill: "spending", argsHash: hash, outcome: "ok", reason: "caps.changed" },
      { ...base, event: "spending", skill: "spending", argsHash: hash, outcome: "ok", reason: "payee.saved" },
    ]);
    expect(activityRows(await log.entries()).map((r) => [r.skill, r.mark, r.reason ?? null])).toEqual([
      ["spending", "ran", "payee.saved"],
      ["spending", "ran", "caps.changed"],
    ]);
    expect(await log.verify(await signer.publicKey())).toEqual({ ok: true });
  });
});

describe("wallet rows (SL-38, US-PAY-01, US-PAY-02)", () => {
  test("creating, backing up and restoring are their own rows with the wallet id hash and the action code only", async () => {
    const hash = "c".repeat(64);
    const log = await logWith([
      { ...base, event: "wallet", skill: "wallet", argsHash: hash, outcome: "ok", reason: "wallet.created" },
      { ...base, event: "wallet", skill: "wallet", argsHash: hash, outcome: "ok", reason: "wallet.backed_up" },
    ]);
    expect(activityRows(await log.entries()).map((r) => [r.skill, r.mark, r.reason ?? null])).toEqual([
      ["wallet", "ran", "wallet.backed_up"],
      ["wallet", "ran", "wallet.created"],
    ]);
    const { activityDetail } = await import("../src/activity.ts");
    expect(activityDetail(await log.entries(), 2)).toEqual([expect.objectContaining({ event: "wallet", argsHash: hash, reason: "wallet.backed_up" })]);
    expect(await log.verify(await signer.publicKey())).toEqual({ ok: true });
  });
});

describe("web task rows (SL-53, FR-WEB-08)", () => {
  test("a take over, a stop or a saved recipe is the user's own row with the action code, signed into the chain", async () => {
    const hash = "c".repeat(64);
    const log = await logWith([
      { ...base, event: "web_task", skill: "web_task", argsHash: hash, outcome: "ok", reason: "web.taken_over" },
      { ...base, event: "web_task", skill: "web_task", argsHash: hash, outcome: "ok", reason: "web.stopped" },
    ]);
    expect(activityRows(await log.entries()).map((r) => [r.skill, r.mark, r.reason ?? null])).toEqual([
      ["web_task", "ran", "web.stopped"],
      ["web_task", "ran", "web.taken_over"],
    ]);
    expect(await log.verify(await signer.publicKey())).toEqual({ ok: true });
  });
});
