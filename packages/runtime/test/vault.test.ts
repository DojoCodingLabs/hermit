/**
 * SL-33 (US-VAULT-01, US-VAULT-02, US-VAULT-04, FR-VAULT-01, FR-VAULT-02): the vault service over a fake Keystore,
 * and the "secrets never reach the model" check through the composition root.
 */
import { describe, expect, test } from "vitest";
import { nodeSql } from "@hermit/sql-node";
import { migrate, vaultItemHash } from "@hermit/core";
import { createAuditLog, ed25519Signer } from "@hermit/cage";
import { profileById, type CompletionEngine, type EngineRequest } from "@hermit/model";
import { createHermit } from "../src/hermit.ts";
import { createVault, VAULT_IDLE_MS, vaultLockReducer, initialVaultLock } from "../src/vault.ts";
import { PROMPT_GRACE_MS } from "../src/app-lock.ts";
import { cipher, fakeKeystore, random, setup } from "./vault-fixtures.ts";

const LOGIN = { name: "Banco", username: "ana@example.com", secret: "Tr0ub4dor&3-zz", notes: "PIN 4821", origins: ["https://banco.example/login"] };

describe("creating and unlocking (US-VAULT-01)", () => {
  test("a new vault: none, then created with a fingerprint, and unlocked", async () => {
    const w = await setup();
    expect(await w.vault.status()).toBe("none");
    expect(await w.vault.create("p")).toBe("created");
    expect(await w.vault.status()).toBe("unlocked");
    expect(w.ks.s.prompts).toBe(1);
    w.vault.lock();
    expect(await w.vault.status()).toBe("locked");
    expect(await w.vault.unlock("p")).toBe("unlocked");
    expect(await w.vault.status()).toBe("unlocked");
  });

  test("a cancelled fingerprint creates nothing", async () => {
    const w = await setup();
    w.ks.s.next = "cancel";
    expect(await w.vault.create("p")).toBe("cancelled");
    expect(await w.vault.status()).toBe("none");
  });

  test("the vault key is never held after an operation: every key handed out is zeroed", async () => {
    const w = await setup();
    await w.vault.create("p");
    await w.vault.save(LOGIN, "p");
    w.vault.lock();
    await w.vault.unlock("p");
    for (const k of w.ks.s.handedOut) expect(k.every((b) => b === 0)).toBe(true);
  });

  test("new fingerprints invalidate the key: lost, and only a reset (which destroys the key) starts over", async () => {
    const w = await setup();
    await w.vault.create("p");
    await w.vault.save(LOGIN, "p");
    w.vault.lock();
    w.ks.s.invalidated = true;
    expect(await w.vault.unlock("p")).toBe("lost");
    expect(await w.vault.status()).toBe("lost");
    expect(await w.vault.list()).toEqual({ kind: "lost" });
    await w.vault.reset();
    expect(w.ks.s.destroyed).toBe(1);
    expect(await w.vault.status()).toBe("none");
    expect(await w.sql.query("SELECT * FROM vault_items")).toEqual([]);
  });

  test("a key that doesn't match the stored check is treated as lost, never used", async () => {
    const w = await setup();
    await w.vault.create("p");
    w.vault.lock();
    w.ks.swapKey();
    expect(await w.vault.unlock("p")).toBe("lost");
  });

  test("a stored check with no wrapped key is lost without a prompt", async () => {
    const w = await setup();
    await w.vault.create("p");
    await w.ks.port.destroy();
    w.vault.lock();
    const before = w.ks.s.prompts;
    expect(await w.vault.status()).toBe("lost");
    expect(w.ks.s.prompts).toBe(before);
  });
});

describe("items (US-VAULT-02)", () => {
  test("save, list (names and origins only), reveal with a fingerprint, edit, delete", async () => {
    const w = await setup();
    await w.vault.create("p");
    const saved = await w.vault.save(LOGIN, "p");
    expect(saved).toEqual({ kind: "saved", id: "v1" });
    const list = await w.vault.list();
    expect(list).toEqual({ kind: "items", items: [{ id: "v1", name: "Banco", origins: ["https://banco.example"], createdAt: 1_000, updatedAt: 1_000 }] });
    expect(JSON.stringify(list)).not.toContain(LOGIN.secret);
    expect(JSON.stringify(list)).not.toContain(LOGIN.username);

    const prompts = w.ks.s.prompts;
    const shown = await w.vault.reveal("v1", "p");
    expect(shown).toEqual({ kind: "revealed", secrets: { username: LOGIN.username, secret: LOGIN.secret, notes: LOGIN.notes }, hideAt: 1_000 + 30_000 });
    expect(w.ks.s.prompts).toBe(prompts + 1);

    w.tick(10);
    expect(await w.vault.save({ ...LOGIN, id: "v1", name: "Banco Nacional", secret: "new" }, "p")).toEqual({ kind: "saved", id: "v1" });
    expect(await w.vault.reveal("v1", "p")).toMatchObject({ secrets: { secret: "new" } });
    expect(await w.vault.entry("v1")).toMatchObject({ kind: "entry", entry: { name: "Banco Nacional", createdAt: 1_000, updatedAt: 1_010 } });

    expect(await w.vault.remove("v1")).toBe("deleted");
    expect(await w.vault.remove("v1")).toBe("gone");
    expect(await w.vault.reveal("v1", "p")).toEqual({ kind: "gone" });
  });

  test("an invalid item asks for no fingerprint and saves nothing", async () => {
    const w = await setup();
    await w.vault.create("p");
    const prompts = w.ks.s.prompts;
    expect(await w.vault.save({ ...LOGIN, origins: ["http://banco.example"] }, "p")).toEqual({ kind: "invalid", problems: ["origin_not_https"] });
    expect(w.ks.s.prompts).toBe(prompts);
    expect(await w.vault.list()).toEqual({ kind: "items", items: [] });
  });

  test("editing an id that isn't stored is refused", async () => {
    const w = await setup();
    await w.vault.create("p");
    expect(await w.vault.save({ ...LOGIN, id: "nope" }, "p")).toEqual({ kind: "gone" });
  });

  test("a cancelled fingerprint reveals and saves nothing", async () => {
    const w = await setup();
    await w.vault.create("p");
    await w.vault.save(LOGIN, "p");
    w.ks.s.next = "cancel";
    expect(await w.vault.reveal("v1", "p")).toEqual({ kind: "cancelled" });
    w.ks.s.next = "cancel";
    expect(await w.vault.save({ ...LOGIN, name: "Otro" }, "p")).toEqual({ kind: "cancelled" });
    expect((await w.vault.list()) as { items: unknown[] }).toMatchObject({ items: [{ name: "Banco" }] });
  });

  test("copy returns the field to put on the clipboard, with the clear time (Q82)", async () => {
    const w = await setup();
    await w.vault.create("p");
    await w.vault.save(LOGIN, "p");
    expect(await w.vault.copy("v1", "secret", "p")).toEqual({ kind: "copy", value: LOGIN.secret, clearAfterMs: 30_000 });
    expect(await w.vault.copy("v1", "username", "p")).toEqual({ kind: "copy", value: LOGIN.username, clearAfterMs: 30_000 });
  });

  test("copy and reveal are refused unless the app is on screen (a night run never gets a secret)", async () => {
    let onScreen = true;
    const w = await setup({ onScreen: () => onScreen });
    await w.vault.create("p");
    await w.vault.save(LOGIN, "p");
    onScreen = false;
    const prompts = w.ks.s.prompts;
    expect(await w.vault.reveal("v1", "p")).toEqual({ kind: "not_on_screen" });
    expect(await w.vault.copy("v1", "secret", "p")).toEqual({ kind: "not_on_screen" });
    expect(w.ks.s.prompts).toBe(prompts);
  });

  test("while locked nothing is listed, revealed, copied, saved or deleted", async () => {
    const w = await setup();
    await w.vault.create("p");
    await w.vault.save(LOGIN, "p");
    w.vault.lock();
    expect(await w.vault.list()).toEqual({ kind: "locked" });
    expect(await w.vault.entry("v1")).toEqual({ kind: "locked" });
    expect(await w.vault.reveal("v1", "p")).toEqual({ kind: "locked" });
    expect(await w.vault.copy("v1", "secret", "p")).toEqual({ kind: "locked" });
    expect(await w.vault.save(LOGIN, "p")).toEqual({ kind: "locked" });
    expect(await w.vault.remove("v1")).toBe("locked");
  });

  test("the database holds no plaintext username, secret or notes", async () => {
    const w = await setup();
    await w.vault.create("p");
    await w.vault.save(LOGIN, "p");
    const dump = JSON.stringify(await w.sql.query("SELECT * FROM vault_items"));
    for (const v of [LOGIN.secret, LOGIN.username, LOGIN.notes]) expect(dump).not.toContain(v);
  });
});

describe("locking (Q83)", () => {
  test("locks after the idle time; activity keeps it open", async () => {
    const w = await setup();
    await w.vault.create("p");
    w.tick(VAULT_IDLE_MS - 1);
    expect(await w.vault.list()).toMatchObject({ kind: "items" });
    w.tick(VAULT_IDLE_MS - 1);
    expect(await w.vault.status()).toBe("unlocked");
    w.tick(1);
    expect(await w.vault.status()).toBe("locked");
  });

  test("locks when the app goes to the background, and when the app lock engages", async () => {
    const w = await setup();
    await w.vault.create("p");
    w.vault.event({ type: "background", at: 1_000 });
    expect(await w.vault.status()).toBe("locked");
    await w.vault.unlock("p");
    w.vault.event({ type: "app_locked" });
    expect(await w.vault.status()).toBe("locked");
  });

  test("locking clears a pending copy: Lock now, the app lock and the idle rule; a trip to another app keeps it for the paste", async () => {
    let cleared = 0;
    const sql = nodeSql();
    await migrate(sql);
    let now = 1_000;
    const vault = createVault({
      sql, audit: createAuditLog(sql, ed25519Signer(new Uint8Array(32).fill(4))), key: fakeKeystore().port, cipher, random,
      now: () => now, newId: () => "v1", onScreen: () => true, onLocked: () => cleared++,
    });
    await vault.create("p");
    vault.lock();
    expect(cleared).toBe(1);
    vault.lock();
    expect(cleared).toBe(1);
    await vault.unlock("p");
    vault.event({ type: "app_locked" });
    expect(cleared).toBe(2);
    await vault.unlock("p");
    now += VAULT_IDLE_MS;
    expect(await vault.status()).toBe("locked");
    expect(cleared).toBe(3);
    await vault.unlock("p");
    vault.event({ type: "background", at: now });
    expect(await vault.status()).toBe("locked");
    expect(cleared).toBe(3);
  });

  test("reducer: Hermit's own fingerprint prompt may background the app briefly without locking", () => {
    let s = vaultLockReducer(initialVaultLock(), { type: "unlocked", at: 0 });
    s = vaultLockReducer(s, { type: "prompt_open" });
    s = vaultLockReducer(s, { type: "background", at: 100 });
    expect(s.unlocked).toBe(true);
    s = vaultLockReducer(s, { type: "foreground", at: 100 + PROMPT_GRACE_MS - 1 });
    expect(s.unlocked).toBe(true);
    s = vaultLockReducer(s, { type: "background", at: 20_000 });
    s = vaultLockReducer(s, { type: "foreground", at: 20_000 + PROMPT_GRACE_MS });
    expect(s.unlocked).toBe(false);
  });

  test("reducer: a clock set backwards locks (fails closed)", () => {
    let s = vaultLockReducer(initialVaultLock(), { type: "unlocked", at: 10_000 });
    s = vaultLockReducer(s, { type: "tick", at: 5_000 });
    expect(s.unlocked).toBe(false);
  });
});

describe("the signed log (FR-ACT-01, FR-VAULT-02)", () => {
  test("each action is a vault entry with only the item hash and the action code", async () => {
    const w = await setup();
    await w.vault.create("p");
    await w.vault.save(LOGIN, "p");
    await w.vault.save({ ...LOGIN, id: "v1", name: "B2" }, "p");
    await w.vault.reveal("v1", "p");
    await w.vault.copy("v1", "secret", "p");
    await w.vault.remove("v1");
    const entries = await w.audit.entries();
    expect(entries.map((e) => [e.event, e.reason, e.argsHash ?? null])).toEqual([
      ["vault", "vault.created", null],
      ["vault", "vault.added", vaultItemHash("v1")],
      ["vault", "vault.edited", vaultItemHash("v1")],
      ["vault", "vault.revealed", vaultItemHash("v1")],
      ["vault", "vault.copied", vaultItemHash("v1")],
      ["vault", "vault.deleted", vaultItemHash("v1")],
    ]);
    const text = JSON.stringify(entries);
    for (const v of [LOGIN.secret, LOGIN.username, LOGIN.notes, "Banco", "B2", "banco.example", "v1"]) expect(text).not.toContain(v);
    expect(await w.audit.verify(await ed25519Signer(new Uint8Array(32).fill(4)).publicKey())).toEqual({ ok: true });
  });
});

describe("generator (US-VAULT-04)", () => {
  test("uses the platform random source with the user's length and classes", async () => {
    const w = await setup();
    expect(w.vault.generate({ length: 12, lower: false, upper: false, digits: true, symbols: false })).toMatch(/^\d{12}$/);
  });
});

describe("secrets never reach the model (FR-VAULT-02)", () => {
  test("after saving and revealing a login, no prompt, menu, log, event or other table holds any part of it", async () => {
    const sql = nodeSql();
    const requests: EngineRequest[] = [];
    const script = [
      '{"choice":"recall","args":{"query":"banco"}}', '{"choice":"respond"}', "No tengo nada sobre eso.",
      '{"choice":"respond"}', "No puedo ver tus contraseñas.",
    ];
    let i = 0;
    const engine: CompletionEngine = {
      async complete(req) {
        requests.push(req);
        return { text: script[i++] ?? '{"choice":"respond"}', toolCalls: [] };
      },
    };
    const ks = fakeKeystore();
    let n = 0;
    const hermit = createHermit(
      {
        sql,
        signer: ed25519Signer(new Uint8Array(32).fill(4)),
        notifier: { schedule: async () => "n", cancel: async () => {} },
        calendar: { list: async () => [], add: async () => {}, calendars: async () => [] },
        replySender: { send: async () => "sent" },
        engine,
        approvals: { request: async (r) => ({ kind: "approved", biometric: true, argsHash: r.call.argsHash }) },
        now: () => Date.UTC(2026, 10, 14),
        timeZone: () => "America/Costa_Rica",
        language: () => "es-419",
        newId: () => `id${++n}`,
        vault: { key: ks.port, cipher, random, onScreen: () => true },
      },
      profileById("botpsy-q4-two-stage-nothink")!,
    );
    await hermit.init();
    const vault = hermit.vault!;
    expect(await vault.create("p")).toBe("created");
    const saved = await vault.save(LOGIN, "p");
    if (saved.kind !== "saved") throw new Error(saved.kind);
    expect(await vault.reveal(saved.id, "p")).toMatchObject({ kind: "revealed" });
    expect(await vault.copy(saved.id, "secret", "p")).toMatchObject({ kind: "copy" });

    const s = await hermit.startSession();
    await hermit.send(s, "¿cuál es mi contraseña del banco?");
    await hermit.send(s, "dime mi usuario y la clave que guardé en la bóveda");

    const seen = JSON.stringify(requests);
    // This slice shows the model nothing of the vault: no secret, no username, no notes, and not even the name or origin.
    for (const v of [LOGIN.secret, LOGIN.username, LOGIN.notes, "banco.example"]) expect(seen).not.toContain(v);
    expect(seen).not.toMatch(/"vault|vault_/i);

    // Every table except the sealed items, as stored: nothing secret anywhere else.
    const tables = (await sql.query<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")).map((t) => t.name);
    for (const t of tables) {
      const rows = JSON.stringify(await sql.query(`SELECT * FROM "${t}"`));
      for (const v of [LOGIN.secret, LOGIN.username, LOGIN.notes]) expect(rows, t).not.toContain(v);
    }
    const activity = JSON.stringify(await hermit.activity());
    for (const v of [LOGIN.secret, LOGIN.username, LOGIN.notes, "Banco", "banco.example"]) expect(activity).not.toContain(v);
  });

  test("without the vault port there is no vault", () => {
    const hermit = createHermit(
      {
        sql: nodeSql(),
        signer: ed25519Signer(new Uint8Array(32).fill(4)),
        notifier: { schedule: async () => "n", cancel: async () => {} },
        calendar: { list: async () => [], add: async () => {}, calendars: async () => [] },
        replySender: { send: async () => "sent" },
        engine: { complete: async () => ({ text: "", toolCalls: [] }) },
        approvals: { request: async () => ({ kind: "denied" }) },
        now: () => 0,
        timeZone: () => "UTC",
        language: () => "en",
        newId: () => "x",
      },
      profileById("botpsy-q4-two-stage-nothink")!,
    );
    expect(hermit.vault).toBeUndefined();
  });
});
