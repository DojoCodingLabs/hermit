/**
 * SL-37 (US-CAGE-03, FR-CAGE-06): the approval key screen's rules and the enrollment, over a fake Keystore that
 * signs with a software P-256 key, and the money path through the composition root.
 */
import { describe, expect, test } from "vitest";
import { webcrypto } from "node:crypto";
import { nodeSql } from "@hermit/sql-node";
import { migrate, type ApprovalKeyLevel, type ApprovalKeyPort, type ApprovalKeyState } from "@hermit/core";
import { createAuditLog, ed25519Signer } from "@hermit/cage";
import { softwareApprovalKey } from "@hermit/cage/testing";
import { profileById } from "@hermit/model";
import { approvalKeyView, createApprovalKey } from "../src/approval-key.ts";
import { createHermit } from "../src/hermit.ts";

const random = (n: number) => webcrypto.getRandomValues(new Uint8Array(n));

/** The native module in miniature: enroll makes a new key (or fails), a fingerprint change retires it. */
function fakeKeystore() {
  let seed = 10;
  let key: ReturnType<typeof softwareApprovalKey> | undefined;
  const s = { next: "ok" as "ok" | "cancelled" | "no_secure_hardware" | "forge", retired: false, noBiometric: false, destroyed: 0, level: "strongbox" as ApprovalKeyLevel };
  const port: ApprovalKeyPort = {
    async state(): Promise<ApprovalKeyState> {
      if (s.noBiometric) return { state: "no_biometric" };
      if (!key) return { state: "none" };
      if (s.retired) return { state: "lost" };
      return { state: "ready", publicKey: key.spki, level: s.level };
    },
    async enroll(message) {
      key = undefined;
      if (s.next === "cancelled" || s.next === "no_secure_hardware") {
        const code = s.next;
        s.next = "ok";
        throw Object.assign(new Error(code), { code });
      }
      key = softwareApprovalKey(seed++);
      s.retired = false;
      // "forge": a key that returns a signature not made over the challenge (a broken or hostile native side).
      const signature = s.next === "forge" ? softwareApprovalKey(99).sign(message) : key.sign(message);
      s.next = "ok";
      return { publicKey: key.spki, level: s.level, signature };
    },
    async destroy() {
      key = undefined;
      s.destroyed++;
    },
  };
  return { port, s, key: () => key };
}

async function setup() {
  const sql = nodeSql();
  await migrate(sql);
  const signer = ed25519Signer(new Uint8Array(32).fill(4));
  const audit = createAuditLog(sql, signer);
  const ks = fakeKeystore();
  const store = new Map<string, string>();
  const settings = { get: async (k: string) => store.get(k), set: async (k: string, v: string) => void store.set(k, v) };
  const service = createApprovalKey({ port: ks.port, settings, audit, sql, randomBytes: random, now: () => 5_000 });
  return { ks, service, audit, store, sql };
}

const prompt = "en" as const;

describe("approvalKeyView (the approval key screen)", () => {
  const pin = { publicKey: "aa", level: "tee" as const, enrolledAt: 1 };
  test("each Keystore state with or without an enrolled key", () => {
    expect(approvalKeyView(undefined, undefined)).toEqual({ kind: "unavailable" });
    expect(approvalKeyView({ state: "no_biometric" }, pin)).toEqual({ kind: "no_biometric" });
    expect(approvalKeyView({ state: "none" }, undefined)).toEqual({ kind: "not_set_up" });
    expect(approvalKeyView({ state: "none" }, pin)).toEqual({ kind: "lost" });
    expect(approvalKeyView({ state: "lost" }, pin)).toEqual({ kind: "lost" });
    expect(approvalKeyView({ state: "lost" }, undefined)).toEqual({ kind: "not_set_up" });
    expect(approvalKeyView({ state: "ready", publicKey: "aa", level: "tee" }, pin)).toEqual({ kind: "ready", level: "tee" });
    expect(approvalKeyView({ state: "ready", publicKey: "bb", level: "tee" }, pin)).toEqual({ kind: "lost" });
    expect(approvalKeyView({ state: "ready", publicKey: "aa", level: "tee" }, undefined)).toEqual({ kind: "not_set_up" });
  });
});

describe("createApprovalKey", () => {
  test("enrolling proves the new key, pins its public part and logs a code only", async () => {
    const { service, store, audit, ks } = await setup();
    expect(await service.view()).toEqual({ kind: "not_set_up" });
    expect(await service.enroll(prompt)).toEqual({ ok: true, view: { kind: "ready", level: "strongbox" } });
    expect(JSON.parse(store.get("approval.key")!)).toEqual({ publicKey: ks.key()!.spki, level: "strongbox", enrolledAt: 5_000 });
    expect(await service.view()).toEqual({ kind: "ready", level: "strongbox" });
    const last = (await audit.entries()).at(-1)!;
    expect(last).toMatchObject({ event: "approval_key", reason: "approval_key.enrolled" });
    expect(JSON.stringify(last)).not.toContain(ks.key()!.spki);
  });

  test("a new fingerprint retires the key: the screen says lost, and setting it up again needs a fresh fingerprint", async () => {
    const { service, ks, store } = await setup();
    await service.enroll(prompt);
    const before = store.get("approval.key");
    ks.s.retired = true;
    expect(await service.view()).toEqual({ kind: "lost" });
    expect(await service.enroll(prompt)).toMatchObject({ ok: true });
    expect(store.get("approval.key")).not.toBe(before);
    expect(await service.view()).toEqual({ kind: "ready", level: "strongbox" });
  });

  test("a cancelled fingerprint changes nothing it can keep; no secure hardware says so", async () => {
    const { service, ks } = await setup();
    ks.s.next = "cancelled";
    expect(await service.enroll(prompt)).toEqual({ ok: false, reason: "cancelled" });
    expect(await service.view()).toEqual({ kind: "not_set_up" });
    ks.s.next = "no_secure_hardware";
    expect(await service.enroll(prompt)).toEqual({ ok: false, reason: "no_secure_hardware" });
  });

  test("an iPhone's Secure Enclave key is pinned with its level and reads back as ready", async () => {
    const { service, store, ks } = await setup();
    ks.s.level = "secure_enclave";
    expect(await service.enroll(prompt)).toEqual({ ok: true, view: { kind: "ready", level: "secure_enclave" } });
    expect(JSON.parse(store.get("approval.key")!)).toEqual({ publicKey: ks.key()!.spki, level: "secure_enclave", enrolledAt: 5_000 });
    expect(await service.view()).toEqual({ kind: "ready", level: "secure_enclave" });
    // A level nobody makes is not a pin: the screen asks to set the key up, never trusts it.
    store.set("approval.key", JSON.stringify({ publicKey: ks.key()!.spki, level: "software", enrolledAt: 5_000 }));
    expect(await service.view()).toEqual({ kind: "not_set_up" });
  });

  test("an enrollment whose signature isn't the new key's over the challenge is refused and the key destroyed", async () => {
    const { service, ks, store } = await setup();
    ks.s.next = "forge";
    expect(await service.enroll(prompt)).toEqual({ ok: false, reason: "failed" });
    expect(store.has("approval.key")).toBe(false);
    expect(ks.s.destroyed).toBe(1);
  });

  test("no strong biometric on the phone: the screen says so and nothing is enrolled", async () => {
    const { service, ks } = await setup();
    ks.s.noBiometric = true;
    expect(await service.view()).toEqual({ kind: "no_biometric" });
  });

  test("the signed approvals it hands the loop trust only the enrolled key", async () => {
    const { service, ks } = await setup();
    await service.enroll(prompt);
    const signed = service.signedApprovals();
    const ask = { risk: "spend" as const, skill: "pay", requestId: "r1", argsHash: "c".repeat(64), terms: { amount: { amount: 1_000_000n, asset: "USDT", network: "stable-testnet" }, recipient: "0x1" }, expiresAt: 5_000 + 60_000 };
    const prepared = await signed.prepare(ask);
    if (!prepared.ok) throw new Error(prepared.reason);
    expect(prepared.request.payload.nonce).toMatch(/^[0-9a-f]{64}$/);
    expect(await signed.verify(prepared.request, ks.key()!.sign(prepared.request.message), ask)).toMatchObject({ ok: true });
    ks.s.retired = true;
    expect(await signed.prepare({ ...ask, requestId: "r2" })).toEqual({ ok: false, reason: "key_lost" });
  });
});

describe("through the composition root", () => {
  test("the app's approval key port gives the screen its service; without it there is none", async () => {
    const ks = fakeKeystore();
    const base = {
      sql: nodeSql(),
      signer: ed25519Signer(new Uint8Array(32).fill(4)),
      notifier: { schedule: async () => "n", cancel: async () => {} },
      calendar: { list: async () => [], add: async () => {}, calendars: async () => [] },
      replySender: { send: async () => "sent" as const },
      engine: { complete: async () => ({ text: '{"choice":"respond"}', toolCalls: [] }) },
      approvals: { request: async () => ({ kind: "denied" as const }) },
      now: () => 1_000,
      timeZone: () => "America/Costa_Rica",
      language: () => "en" as const,
      newId: () => "id",
    };
    const profile = profileById("botpsy-q4-two-stage-nothink")!;
    expect(createHermit(base, profile).approvalKey).toBeUndefined();
    const hermit = createHermit({ ...base, approvalKey: { port: ks.port, randomBytes: random } }, profile);
    await hermit.init();
    expect(await hermit.approvalKey!.view()).toEqual({ kind: "not_set_up" });
    expect(await hermit.approvalKey!.enroll("es-419")).toMatchObject({ ok: true });
    expect(JSON.parse((await hermit.settings.get("approval.key"))!)).toMatchObject({ publicKey: ks.key()!.spki });
    expect((await hermit.activity()).chain).toMatchObject({ kind: "verified" });
  });
});
