/**
 * SL-36 (US-FORM-02, FR-CAGE-02, FR-VAULT-04): logging in to a site or an app with a vault login, through the same
 * flow as SL-35's form fill (HM-FORM-01's request, the pending map with its atomic claim, the timeouts). A login is
 * offered only to the requester whose verified identity equals the item's stored origin exactly; the cage asks for a
 * `credential` every time with a Keystore signature over the exact payload (the item's id hash, the origin and the
 * requester); the values leave only after that signature verifies and the vault's own fingerprint opens the item.
 * Nothing fills with nobody on screen, and no username or password reaches the signed log, the model or the index.
 */
import { describe, expect, test } from "vitest";
import { nodeSql } from "@hermit/sql-node";
import { loginIndex, migrate, vaultItemHash, type ApprovalKeyState, type LoginIndexEntry } from "@hermit/core";
import { createAuditLog, createSignedApprovals, ed25519Signer, memoryNonceStore, verifyChain } from "@hermit/cage";
import { softwareApprovalKey } from "@hermit/cage/testing";
import { profileById, type CompletionEngine, type EngineRequest } from "@hermit/model";
import { createHermit } from "../src/hermit.ts";
import { createVault } from "../src/vault.ts";
import { createFormFill, FILL_TTL_MS, type NativeLoginRequest } from "../src/form-fill.ts";
import { cipher, fakeKeystore, random } from "./vault-fixtures.ts";

const CHROME = "8P1sW0EPJcslw7UzRsiXL64w-O50Ed-RBICtay1g24M";
const BANK_KEY = "bankKeyDigest_00000000000000000000000000000";
const EVIL_KEY = "evilKeyDigest_00000000000000000000000000000";
const BANK_APP = `android://${BANK_KEY}@com.example.bank`;
const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");

async function setup(opts: { onScreen?: () => boolean; approvalKey?: "ready" | "none" | "lost" } = {}) {
  const sql = nodeSql();
  await migrate(sql);
  const signer = ed25519Signer(new Uint8Array(32).fill(4));
  const audit = createAuditLog(sql, signer);
  const ks = fakeKeystore();
  let now = 1_000;
  let n = 0;
  let onScreen = opts.onScreen ?? (() => true);
  const key = softwareApprovalKey(3);
  const keyState = { current: (opts.approvalKey ?? "ready") as "ready" | "none" | "lost" };
  const signed = createSignedApprovals({
    key: { state: async (): Promise<ApprovalKeyState> => (keyState.current === "ready" ? { state: "ready", publicKey: key.spki, level: "strongbox" } : { state: keyState.current }) },
    enrolledKey: async () => (keyState.current === "none" ? undefined : key.spki),
    nonces: memoryNonceStore(),
    randomNonce: () => hex(random(32)),
    now: () => now,
  });
  const base = { sql, audit, key: ks.port, cipher, now: () => now, newId: () => `id${++n}`, onScreen: () => onScreen() };
  const vault = createVault({ ...base, random });
  expect(await vault.create("p")).toBe("created");
  const saved = await vault.save({ name: "Bank (Ana)", username: "ana@bank.example", secret: "s3cret-Pa55", notes: "PIN 4321", origins: ["https://bank.example", BANK_APP] }, "p");
  if (saved.kind !== "saved") throw new Error(saved.kind);
  const other = await vault.save({ name: "Shop", username: "ana", secret: "shop-pw", notes: "", origins: ["https://shop.example"] }, "p");
  if (other.kind !== "saved") throw new Error(other.kind);
  const fill = createFormFill({ ...base, signed });
  return {
    sql, audit, signer, ks, vault, fill, key, keyState, item: saved.id, ref: vaultItemHash(saved.id), shopRef: vaultItemHash(other.id),
    tick: (ms: number) => (now += ms),
    setOnScreen: (f: () => boolean) => (onScreen = f),
  };
}

type World = Awaited<ReturnType<typeof setup>>;

const webLogin = (w: World, over: Partial<NativeLoginRequest> = {}): NativeLoginRequest => ({
  kind: "login",
  id: "n1",
  item: w.ref,
  packageName: "com.android.chrome",
  certDigests: [CHROME],
  web: [{ domain: "bank.example", scheme: "https" }],
  origin: "https://bank.example",
  fields: [{ key: "0", kind: "username" }, { key: "1", kind: "password" }],
  ...over,
});

const appLogin = (w: World, over: Partial<NativeLoginRequest> = {}): NativeLoginRequest =>
  webLogin(w, { packageName: "com.example.bank", certDigests: [BANK_KEY], web: [], origin: BANK_APP, ...over });

async function preview(w: World, req: NativeLoginRequest) {
  const r = await w.fill.prepare(req);
  if (r.kind !== "login") throw new Error(r.kind === "refused" ? r.reason : r.kind);
  return r;
}

const auditRows = (w: World) => w.audit.entries();

describe("which requester gets a login (FR-VAULT-04)", () => {
  test("a trusted browser on the exact https origin: the login's preview names the item and the site, never a value", async () => {
    const w = await setup();
    const r = await preview(w, webLogin(w));
    expect(r.requester).toEqual({ kind: "web", origin: "https://bank.example", secure: true, browser: "Chrome" });
    expect(r.name).toBe("Bank (Ana)");
    expect(r.fields).toEqual(["username", "password"]);
    expect(JSON.stringify(r)).not.toMatch(/ana@bank|s3cret|4321/);
  });

  test("the app itself, by its signing key and package: `android://<cert>@<package>`", async () => {
    const w = await setup();
    const r = await preview(w, appLogin(w));
    expect(r.requester).toEqual({ kind: "app", packageName: "com.example.bank", key: BANK_KEY });
    expect(r.signed.payload).toMatchObject({ origin: BANK_APP, requester: BANK_APP });
  });

  test("a subdomain, a parent, a lookalike, another port or http gets nothing", async () => {
    const w = await setup();
    for (const [domain, scheme] of [["www.bank.example", "https"], ["example", "https"], ["bank.examp1e", "https"], ["bank.example.evil.net", "https"], ["bank.example", "http"]] as const) {
      const origin = `${scheme}://${domain}`;
      expect(await w.fill.prepare(webLogin(w, { web: [{ domain, scheme }], origin })), origin).toEqual({ kind: "refused", reason: "no_login" });
    }
  });

  test("a sideloaded copy of the app (same package, another key) gets nothing", async () => {
    const w = await setup();
    const origin = `android://${EVIL_KEY}@com.example.bank`;
    expect(await w.fill.prepare(appLogin(w, { certDigests: [EVIL_KEY], origin }))).toEqual({ kind: "refused", reason: "no_login" });
  });

  test("an app that isn't a trusted browser showing the site is the app, and gets nothing", async () => {
    const w = await setup();
    const req = webLogin(w, { packageName: "com.evil.viewer", certDigests: [EVIL_KEY], origin: `android://${EVIL_KEY}@com.evil.viewer` });
    expect(await w.fill.prepare(req)).toEqual({ kind: "refused", reason: "no_login" });
  });

  test("another item's login is never released to this site, whatever the native side claims", async () => {
    const w = await setup();
    expect(await w.fill.prepare(webLogin(w, { item: w.shopRef }))).toEqual({ kind: "refused", reason: "no_login" });
    expect(await w.fill.prepare(webLogin(w, { item: "f".repeat(64) }))).toEqual({ kind: "refused", reason: "no_login" });
  });

  test("the native side's origin is checked, not believed", async () => {
    const w = await setup();
    expect(await w.fill.prepare(webLogin(w, { origin: "https://shop.example" }))).toEqual({ kind: "refused", reason: "origin_changed" });
  });

  test("a malformed request (no fields, a profile kind, a ref that isn't a hash) is refused", async () => {
    const w = await setup();
    for (const bad of [
      webLogin(w, { fields: [] }),
      webLogin(w, { fields: [{ key: "0", kind: "email" as never }] }),
      webLogin(w, { item: "item-1" }),
      webLogin(w, { fields: [{ key: "0", kind: "password" }, { key: "0", kind: "username" }] }),
    ]) {
      expect(await w.fill.prepare(bad)).toEqual({ kind: "refused", reason: "bad_request" });
    }
  });
});

describe("the cage decides a login as a credential, signed over the exact payload (FR-CAGE-02, FR-CAGE-06)", () => {
  test("approve: the Keystore signature verifies, the vault's fingerprint opens the item, and only then the values exist", async () => {
    const w = await setup();
    const r = await preview(w, webLogin(w));
    expect(r.signed.payload).toMatchObject({
      risk: "credential", skill: "fill_login", origin: "https://bank.example", item: w.ref, requester: `android://${CHROME}@com.android.chrome`,
    });
    const before = w.ks.s.prompts;
    const got = await w.fill.approve(r.id, "p", w.key.sign(r.signed.message));
    expect(got).toEqual({ kind: "fill", values: { "0": "ana@bank.example", "1": "s3cret-Pa55" } });
    expect(w.ks.s.prompts).toBe(before + 1);
    for (const k of w.ks.s.handedOut) expect(k.every((b) => b === 0)).toBe(true);
    await w.fill.delivered(r.id, true);
    const rows = await auditRows(w);
    expect(rows.filter((e) => e.skill === "fill_login").map((e) => [e.event, e.decision ?? null, e.outcome ?? null])).toEqual([
      ["call_proposed", null, null],
      ["policy_decided", "ask", null],
      ["approval", "ask", "ok"],
      ["executed", null, "ok"],
    ]);
    expect(rows.find((e) => e.event === "approval")?.payloadHash).toMatch(/^[0-9a-f]{64}$/);
    expect(verifyChain(await w.audit.entries(), await w.signer.publicKey())).toEqual({ ok: true });
  });

  test("no values without a valid signature: none, another key's, or one over another payload", async () => {
    const w = await setup();
    const other = softwareApprovalKey(77);
    for (const sig of [undefined, other.sign((await preview(w, webLogin(w))).signed.message)]) {
      const r = await preview(w, webLogin(w));
      const before = w.ks.s.prompts;
      expect(await w.fill.approve(r.id, "p", sig)).toMatchObject({ kind: "not_signed" });
      expect(w.ks.s.prompts).toBe(before);
    }
    const a = await preview(w, webLogin(w));
    const b = await preview(w, webLogin(w));
    expect(await w.fill.approve(b.id, "p", w.key.sign(a.signed.message))).toMatchObject({ kind: "not_signed" });
  });

  test("a signature can't be used twice: the claim is atomic, and a replayed signature is refused", async () => {
    const w = await setup();
    const r = await preview(w, webLogin(w));
    const sig = w.key.sign(r.signed.message);
    const [one, two] = await Promise.all([w.fill.approve(r.id, "p", sig), w.fill.approve(r.id, "p", sig)]);
    expect([one.kind, two.kind].sort()).toEqual(["fill", "gone"]);
  });

  test("no approval key, or a lost one: refused before the sheet, nothing asked", async () => {
    for (const state of ["none", "lost"] as const) {
      const w = await setup({ approvalKey: state });
      expect(await w.fill.prepare(webLogin(w))).toEqual({ kind: "refused", reason: state === "none" ? "key_none" : "key_lost" });
    }
  });

  test("the key retired between the preview and the fingerprint: not signed, nothing filled", async () => {
    const w = await setup();
    const r = await preview(w, webLogin(w));
    w.keyState.current = "lost";
    expect(await w.fill.approve(r.id, "p", w.key.sign(r.signed.message))).toEqual({ kind: "not_signed", reason: "key_lost" });
  });

  test("nobody on screen (a night pass): denied at the cage, never asked, never filled", async () => {
    const w = await setup({ onScreen: () => false });
    expect(await w.fill.prepare(webLogin(w))).toEqual({ kind: "refused", reason: "not_on_screen" });
    const rows = await auditRows(w);
    expect(rows.find((e) => e.event === "policy_decided")).toMatchObject({ decision: "deny", skill: "fill_login" });
  });

  test("off screen by the time of approving: nothing spent, the preview stays", async () => {
    const w = await setup();
    const r = await preview(w, webLogin(w));
    w.setOnScreen(() => false);
    const sig = w.key.sign(r.signed.message);
    expect(await w.fill.approve(r.id, "p", sig)).toEqual({ kind: "not_on_screen" });
    w.setOnScreen(() => true);
    expect(await w.fill.approve(r.id, "p", sig)).toMatchObject({ kind: "fill" });
  });

  test("off screen after the vault's fingerprint: the values are dropped", async () => {
    const w = await setup();
    const r = await preview(w, webLogin(w));
    let calls = 0;
    w.setOnScreen(() => ++calls < 2);
    expect(await w.fill.approve(r.id, "p", w.key.sign(r.signed.message))).toEqual({ kind: "not_on_screen" });
  });

  test("the vault's fingerprint cancelled: nothing filled, and a fresh payload to sign for another try", async () => {
    const w = await setup();
    const r = await preview(w, webLogin(w));
    w.ks.s.next = "cancel";
    const got = await w.fill.approve(r.id, "p", w.key.sign(r.signed.message));
    if (got.kind !== "cancelled" || !got.signed) throw new Error(got.kind);
    expect(got.signed.payload.nonce).not.toBe(r.signed.payload.nonce);
    // The first signature was spent; only the new payload's signature works.
    expect(await w.fill.approve(r.id, "p", w.key.sign(got.signed.message))).toMatchObject({ kind: "fill" });
  });

  test("expired after two minutes: signed as expired, nothing filled", async () => {
    const w = await setup();
    const r = await preview(w, webLogin(w));
    const sig = w.key.sign(r.signed.message);
    w.tick(FILL_TTL_MS + 1);
    expect(await w.fill.approve(r.id, "p", sig)).toEqual({ kind: "expired" });
  });

  test("the login changed or lost this origin since the preview: what was shown is not what would fill", async () => {
    const w = await setup();
    const r = await preview(w, webLogin(w));
    w.tick(10);
    await w.vault.save({ id: w.item, name: "Bank (Ana)", username: "ana@bank.example", secret: "new-pw", notes: "", origins: ["https://bank.example"] }, "p");
    expect(await w.fill.approve(r.id, "p", w.key.sign(r.signed.message))).toEqual({ kind: "changed" });
  });

  test("deny: signed as denied, and the preview is gone", async () => {
    const w = await setup();
    const r = await preview(w, webLogin(w));
    await w.fill.deny(r.id);
    expect(await w.fill.approve(r.id, "p", w.key.sign(r.signed.message))).toEqual({ kind: "gone" });
    expect((await auditRows(w)).some((e) => e.skill === "fill_login" && e.event === "approval" && e.outcome === "denied")).toBe(true);
  });

  test("only the requested fields fill: a username-only step gets the username", async () => {
    const w = await setup();
    const r = await preview(w, webLogin(w, { fields: [{ key: "4", kind: "username" }] }));
    expect(await w.fill.approve(r.id, "p", w.key.sign(r.signed.message))).toEqual({ kind: "fill", values: { "4": "ana@bank.example" } });
  });
});

describe("secrets stay out of the log, the database and the index", () => {
  test("the signed log keeps hashes and codes, never the username, the password, the notes, the name or the item id", async () => {
    const w = await setup();
    const r = await preview(w, webLogin(w));
    await w.fill.approve(r.id, "p", w.key.sign(r.signed.message));
    await w.fill.delivered(r.id, true);
    const log = JSON.stringify([await auditRows(w), await w.sql.query("SELECT * FROM audit")]);
    for (const v of ["ana@bank.example", "s3cret-Pa55", "PIN 4321", "Bank (Ana)", w.item]) expect(log).not.toContain(v);
    const db = JSON.stringify(await w.sql.query("SELECT * FROM vault_items"));
    for (const v of ["ana@bank.example", "s3cret-Pa55"]) expect(db).not.toContain(v);
  });
});

describe("through the composition root", () => {
  test("the login index follows the vault; logins never reach the model; Delete everything's index is empty", async () => {
    const sql = nodeSql();
    const requests: EngineRequest[] = [];
    const engine: CompletionEngine = {
      async complete(req) {
        requests.push(req);
        return { text: requests.length % 2 ? '{"choice":"respond"}' : "No tengo esa contraseña.", toolCalls: [] };
      },
    };
    const ks = fakeKeystore();
    let n = 0;
    const indexes: LoginIndexEntry[][] = [];
    const key = softwareApprovalKey(5);
    const hermit = createHermit(
      {
        sql,
        signer: ed25519Signer(new Uint8Array(32).fill(4)),
        notifier: { schedule: async () => "n", cancel: async () => {} },
        calendar: { list: async () => [], add: async () => {}, calendars: async () => [] },
        replySender: { send: async () => "sent" },
        engine,
        approvals: { request: async (r) => ({ kind: "approved", biometric: true, argsHash: r.call.argsHash }) },
        now: () => Date.UTC(2026, 10, 17),
        timeZone: () => "America/Costa_Rica",
        language: () => "es-419",
        newId: () => `id${++n}`,
        vault: { key: ks.port, cipher, random, onScreen: () => true },
        autofill: { setProfileIndex: () => {}, setLoginIndex: (i) => void indexes.push(i) },
        approvalKey: {
          port: {
            state: async () => ({ state: "ready", publicKey: key.spki, level: "strongbox" }),
            enroll: async (message) => ({ publicKey: key.spki, level: "strongbox", signature: key.sign(message) }),
            destroy: async () => {},
          },
          randomBytes: random,
        },
      },
      profileById("botpsy-q4-two-stage-nothink")!,
    );
    await hermit.init();
    expect(indexes.at(-1)).toEqual([]);
    expect(await hermit.vault!.create("p")).toBe("created");
    await hermit.vault!.unlock("p");
    const saved = await hermit.vault!.save({ name: "Banco", username: "valentina", secret: "Clave-Secreta-9", notes: "", origins: ["https://banco.example"] }, "p");
    if (saved.kind !== "saved") throw new Error(saved.kind);
    expect(indexes.at(-1)).toEqual(loginIndex([{ id: saved.id, name: "Banco", origins: ["https://banco.example"], createdAt: 0, updatedAt: 0 }]));
    expect(JSON.stringify(indexes)).not.toMatch(/valentina|Clave-Secreta/);

    expect((await hermit.approvalKey!.enroll("es-419")).ok).toBe(true);
    const req: NativeLoginRequest = {
      kind: "login", id: "n1", item: vaultItemHash(saved.id), packageName: "com.android.chrome", certDigests: [CHROME],
      web: [{ domain: "banco.example", scheme: "https" }], origin: "https://banco.example", fields: [{ key: "0", kind: "password" }],
    };
    const r = await hermit.forms!.prepare(req);
    if (r.kind !== "login") throw new Error(r.kind === "refused" ? r.reason : r.kind);
    expect(await hermit.forms!.approve(r.id, "p", key.sign(r.signed.message))).toEqual({ kind: "fill", values: { "0": "Clave-Secreta-9" } });

    const s = await hermit.startSession();
    await hermit.send(s, "¿cuál es mi contraseña del banco?");
    const seen = JSON.stringify(requests);
    for (const v of ["valentina", "Clave-Secreta-9"]) expect(seen).not.toContain(v);
    expect(seen).not.toMatch(/fill_login|vault_items/);

    expect(await hermit.vault!.remove(saved.id)).toBe("deleted");
    expect(indexes.at(-1)).toEqual([]);
  });
});
