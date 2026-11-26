import { describe, expect, test } from "vitest";
import { webcrypto } from "node:crypto";
import { nodeSql } from "@hermit/sql-node";
import * as core from "../src/index.ts";
import { migrate } from "../src/schema.ts";
import { erasePlan, NATIVE_PREFERENCES, schemaTables } from "../src/erase.ts";
import { normalizeOrigin } from "../src/autofill-origin.ts";
import {
  CHARSETS, createVaultStore, GENERATOR_DEFAULTS, GENERATOR_LIMITS, generatePassword, itemAad, keyCheck, keyMatches, normalizeGenerator, openSecrets,
  parseOrigin, sealSecrets, uniformIndex, utf8Decode, validateItem, VAULT_CLIPBOARD_CLEAR_MS, VAULT_REVEAL_MS, vaultItemHash,
  type SecureRandom, type VaultCipherPort,
} from "../src/vault.ts";

/** AES-256-GCM over WebCrypto, the same layout as the phone adapter: iv(12) ‖ ciphertext ‖ tag(16). */
const webCipher: VaultCipherPort = {
  async seal(key, plaintext, aad) {
    const iv = webcrypto.getRandomValues(new Uint8Array(12));
    const k = await webcrypto.subtle.importKey("raw", key, "AES-GCM", false, ["encrypt"]);
    const ct = new Uint8Array(await webcrypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: aad }, k, plaintext));
    const out = new Uint8Array(12 + ct.length);
    out.set(iv);
    out.set(ct, 12);
    return out;
  },
  async open(key, sealed, aad) {
    const k = await webcrypto.subtle.importKey("raw", key, "AES-GCM", false, ["decrypt"]);
    return new Uint8Array(await webcrypto.subtle.decrypt({ name: "AES-GCM", iv: sealed.slice(0, 12), additionalData: aad }, k, sealed.slice(12)));
  },
};

const secureRandom: SecureRandom = (n) => webcrypto.getRandomValues(new Uint8Array(n));
const KEY = new Uint8Array(32).fill(7);
const OTHER_KEY = new Uint8Array(32).fill(9);

describe("exact origins (US-VAULT-02, FR-VAULT-04)", () => {
  test.each([
    ["https://example.com", "https://example.com"],
    ["https://Example.COM/login?next=/a#top", "https://example.com"],
    ["  https://example.com:443/  ", "https://example.com"],
    ["https://example.com:8443/x", "https://example.com:8443"],
    ["https://accounts.example.co.uk", "https://accounts.example.co.uk"],
    ["https://example.com.", "https://example.com"],
    ["https://10.0.0.1:8080", "https://10.0.0.1:8080"],
    ["HTTPS://bank.example", "https://bank.example"],
  ])("%s is %s", (raw, origin) => {
    expect(parseOrigin(raw)).toEqual({ ok: true, origin });
  });

  test("http is refused with its own problem (Q84)", () => {
    expect(parseOrigin("http://intranet.example")).toEqual({ ok: false, problem: "origin_not_https" });
  });

  test.each([
    "example.com",
    "ftp://example.com",
    "javascript://example.com",
    "https://user:pass@example.com",
    "https://evil.com@bank.example",
    "https://exаmple.com", // Cyrillic "а": a lookalike hides in a non-ASCII host
    "https://xn--",
    "https://-bad.example",
    "https://example.com:0",
    "https://example.com:65536",
    "https://example.com:abc",
    "https://999.1.1.1",
    "https://1.2.3",
    "https://",
    "https:///path",
    "https://exa mple.com",
    "https://[::1]",
    "",
  ])("%s is refused", (raw) => {
    expect(parseOrigin(raw)).toEqual({ ok: false, problem: "origin_invalid" });
  });

  test("every stored origin is already in autofill's canonical form (SL-20), so SL-35 and SL-36 match it as is", () => {
    const typed = ["https://Example.COM/login", "https://example.com:443", "https://example.com:8443/x", "https://a.b.example.", "https://10.0.0.1:8080", "https://xn--bcher-kva.example"];
    for (const raw of typed) {
      const r = parseOrigin(raw);
      expect(r.ok, raw).toBe(true);
      if (r.ok) expect(normalizeOrigin(r.origin), raw).toBe(r.origin);
    }
  });

  test("a port with a leading zero is refused, as autofill's normalizeOrigin refuses it", () => {
    expect(normalizeOrigin("https://example.com:0443")).toBeUndefined();
    expect(parseOrigin("https://example.com:0443")).toEqual({ ok: false, problem: "origin_invalid" });
  });

  test("a lookalike is a different origin, not the same one", () => {
    const a = parseOrigin("https://bank.example");
    const b = parseOrigin("https://bank.example.evil.com");
    const c = parseOrigin("https://bank.example:444");
    expect(a.ok && b.ok && c.ok).toBe(true);
    if (a.ok && b.ok && c.ok) {
      expect(b.origin).not.toBe(a.origin);
      expect(c.origin).not.toBe(a.origin);
    }
  });
});

describe("validateItem (US-VAULT-02)", () => {
  const base = { name: " Banco ", username: " ana@example.com ", secret: " s3cret ", notes: "", origins: ["https://banco.example/login", "https://BANCO.example", " "] };

  test("trims the name and the username, keeps the secret exactly as typed, reduces and dedupes the origins", () => {
    expect(validateItem(base)).toEqual({
      ok: true,
      name: "Banco",
      origins: ["https://banco.example"],
      secrets: { username: "ana@example.com", secret: " s3cret ", notes: "" },
    });
  });

  test("reports every problem at once", () => {
    const r = validateItem({ name: "  ", username: "", secret: "", notes: "", origins: [] });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.problems.sort()).toEqual(["name_missing", "origins_missing", "secret_missing"]);
  });

  test("an http or invalid origin is reported", () => {
    const r = validateItem({ ...base, origins: ["http://a.example", "nope"] });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.problems.sort()).toEqual(["origin_invalid", "origin_not_https"]);
  });

  test("limits: name length, field length, number of origins", () => {
    const long = validateItem({ ...base, name: "x".repeat(121), notes: "n".repeat(4001) });
    expect(long.ok).toBe(false);
    if (!long.ok) expect(long.problems.sort()).toEqual(["name_too_long", "too_long"]);
    const many = validateItem({ ...base, origins: Array.from({ length: 21 }, (_, i) => `https://a${i}.example`) });
    expect(many.ok).toBe(false);
    if (!many.ok) expect(many.problems).toContain("too_long");
  });
});

describe("sealing (FR-VAULT-01)", () => {
  const secrets = { username: "ana", secret: "contraseña ñ 🔑", notes: "PIN 1234" };

  test("round trip with the right key and id", async () => {
    const sealed = await sealSecrets(webCipher, KEY, "item1", secrets);
    expect(sealed).toMatch(/^[0-9a-f]+$/);
    expect(await openSecrets(webCipher, KEY, "item1", sealed)).toEqual(secrets);
  });

  test("the sealed blob holds no plaintext", async () => {
    const sealed = await sealSecrets(webCipher, KEY, "item1", secrets);
    const hex = (s: string) => Buffer.from(s, "utf8").toString("hex");
    for (const v of ["ana", "PIN 1234", "contrase"]) expect(sealed).not.toContain(hex(v));
  });

  test("two seals of the same secrets differ (a fresh iv each time)", async () => {
    expect(await sealSecrets(webCipher, KEY, "item1", secrets)).not.toBe(await sealSecrets(webCipher, KEY, "item1", secrets));
  });

  test("a blob moved to another item, a wrong key or a flipped byte fails to open", async () => {
    const sealed = await sealSecrets(webCipher, KEY, "item1", secrets);
    await expect(openSecrets(webCipher, KEY, "item2", sealed)).rejects.toThrow();
    await expect(openSecrets(webCipher, OTHER_KEY, "item1", sealed)).rejects.toThrow();
    const flipped = sealed.slice(0, 40) + (sealed[40] === "0" ? "1" : "0") + sealed.slice(41);
    await expect(openSecrets(webCipher, KEY, "item1", flipped)).rejects.toThrow();
  });

  test("the additional data names the item", () => {
    expect(Buffer.from(itemAad("a")).toString()).not.toBe(Buffer.from(itemAad("b")).toString());
  });

  test("the key check proves the key belongs to this vault", async () => {
    const check = await keyCheck(webCipher, KEY);
    expect(await keyMatches(webCipher, KEY, check)).toBe(true);
    expect(await keyMatches(webCipher, OTHER_KEY, check)).toBe(false);
    expect(await keyMatches(webCipher, KEY, "00")).toBe(false);
  });

  test("utf8Decode matches TextDecoder and refuses malformed bytes", () => {
    for (const s of ["", "abc", "ñandú", "日本語", "🔑🦀", "\u0000x"]) expect(utf8Decode(new TextEncoder().encode(s))).toBe(s);
    for (const bad of [[0xff], [0xc0, 0x80], [0xe0, 0x80, 0x80], [0xed, 0xa0, 0x80], [0xc3], [0xf4, 0x90, 0x80, 0x80]]) {
      expect(() => utf8Decode(new Uint8Array(bad))).toThrow();
    }
  });

  test("the log hash is not the id and is stable", () => {
    expect(vaultItemHash("item1")).toMatch(/^[0-9a-f]{64}$/);
    expect(vaultItemHash("item1")).toBe(vaultItemHash("item1"));
    expect(vaultItemHash("item1")).not.toContain("item1");
    expect(vaultItemHash("item1")).not.toBe(vaultItemHash("item2"));
  });
});

describe("vault store (migration 12)", () => {
  async function store() {
    const sql = nodeSql();
    await migrate(sql);
    return { sql, vault: createVaultStore(sql) };
  }

  test("migration 12 creates vault_items and vault_meta, owned by SL-33", async () => {
    const m = core.MIGRATIONS.find((x) => x.id === 12);
    expect(m).toMatchObject({ name: "vault", slice: "SL-33" });
    const { sql } = await store();
    const tables = (await sql.query<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table'")).map((t) => t.name);
    expect(tables).toEqual(expect.arrayContaining(["vault_items", "vault_meta"]));
  });

  test("put, list, entry, sealed, remove", async () => {
    const { vault } = await store();
    await vault.put({ id: "b", name: "banco", origins: ["https://banco.example"], sealed: "aa" }, 1);
    await vault.put({ id: "a", name: "Amazon", origins: ["https://amazon.example"], sealed: "bb" }, 2);
    expect((await vault.list()).map((e) => e.name)).toEqual(["Amazon", "banco"]);
    const entry = await vault.entry("b");
    expect(entry).toEqual({ id: "b", name: "banco", origins: ["https://banco.example"], createdAt: 1, updatedAt: 1 });
    expect(entry).not.toHaveProperty("sealed");
    expect(await vault.sealed("b")).toBe("aa");
    await vault.put({ id: "b", name: "Banco", origins: ["https://banco.example"], sealed: "cc" }, 5);
    expect(await vault.entry("b")).toMatchObject({ name: "Banco", createdAt: 1, updatedAt: 5 });
    expect(await vault.sealed("b")).toBe("cc");
    expect(await vault.remove("b")).toBe(true);
    expect(await vault.remove("b")).toBe(false);
    expect(await vault.entry("b")).toBeUndefined();
  });

  test("putAll (SL-34) writes every item in one transaction: a failure leaves none of them", async () => {
    const { vault } = await store();
    await vault.put({ id: "a", name: "A", origins: ["https://a.example"], sealed: "aa" }, 1);
    await vault.putAll([{ id: "a", name: "A2", origins: ["https://a.example"], sealed: "a2" }, { id: "b", name: "B", origins: ["https://b.example"], sealed: "bb" }], 2);
    expect((await vault.list()).map((e) => [e.id, e.name, e.createdAt, e.updatedAt])).toEqual([["a", "A2", 1, 2], ["b", "B", 2, 2]]);
    const bad = { id: "c", name: "C", origins: ["https://c.example"], sealed: null as unknown as string };
    await expect(vault.putAll([{ id: "d", name: "D", origins: ["https://d.example"], sealed: "dd" }, bad], 3)).rejects.toThrow();
    expect((await vault.list()).map((e) => e.id)).toEqual(["a", "b"]);
  });

  test("the list never carries the sealed blob", async () => {
    const { vault } = await store();
    await vault.put({ id: "a", name: "A", origins: ["https://a.example"], sealed: "deadbeef" }, 1);
    expect(JSON.stringify(await vault.list())).not.toContain("deadbeef");
  });

  test("key check and wipe", async () => {
    const { vault } = await store();
    expect(await vault.keyCheck()).toBeUndefined();
    await vault.setKeyCheck("c1", 1);
    await vault.setKeyCheck("c2", 2);
    expect(await vault.keyCheck()).toBe("c2");
    await vault.put({ id: "a", name: "A", origins: ["https://a.example"], sealed: "x" }, 1);
    await vault.wipe();
    expect(await vault.list()).toEqual([]);
    expect(await vault.keyCheck()).toBeUndefined();
  });

  test("Delete everything picks up the vault tables, and destroys the vault key after the data", () => {
    expect(schemaTables()).toEqual(expect.arrayContaining(["vault_items", "vault_meta"]));
    const order: string[] = erasePlan().map((s) => s.id);
    const at = (id: string) => order.indexOf(id);
    expect(erasePlan().find((s) => s.id === "vault_key")).toEqual({ id: "vault_key", kind: "destroy_vault_key" });
    expect(at("vault_key")).toBeGreaterThan(at("database"));
    expect(at("vault_key")).toBeGreaterThan(at("model_files"));
  });

  test("Delete everything clears the autofill service's native preferences (SL-20 findings), with the data, before the keys", () => {
    expect(NATIVE_PREFERENCES).toContain("hermit_autofill_spike");
    const plan = erasePlan();
    expect(plan.find((s) => s.id === "native_prefs")).toEqual({ id: "native_prefs", kind: "delete_native_prefs", names: [...NATIVE_PREFERENCES] });
    const order: string[] = plan.map((s) => s.id);
    expect(order.indexOf("native_prefs")).toBeGreaterThan(order.indexOf("stop_capture"));
    for (const s of plan) if (s.kind === "delete_secret") expect(order.indexOf("native_prefs")).toBeLessThan(order.indexOf(s.id));
  });

  test("the vault is exported from @hermit/core", () => {
    expect(core.parseOrigin).toBe(parseOrigin);
    expect(core.createVaultStore).toBe(createVaultStore);
  });
});

describe("password generator (US-VAULT-04)", () => {
  test("uniformIndex has no modulo bias: bytes past the last full multiple are thrown away", () => {
    // n = 100: 256 % 100 = 56, so bytes 200..255 must be rejected; 255 would otherwise give 55.
    const bytes = [255, 230, 200, 199];
    const random: SecureRandom = (k) => new Uint8Array(k).map((_, i) => bytes[i] ?? 0);
    expect(uniformIndex(100, random)).toBe(99);
    expect(() => uniformIndex(0, random)).toThrow(RangeError);
    expect(() => uniformIndex(257, random)).toThrow(RangeError);
  });

  test("uniformIndex is close to uniform over many draws", () => {
    const n = 87;
    const counts = new Array<number>(n).fill(0);
    const draws = 87_000;
    for (let i = 0; i < draws; i++) counts[uniformIndex(n, secureRandom)]!++;
    for (const c of counts) expect(Math.abs(c - draws / n)).toBeLessThan(200);
  });

  test("length is clamped from 8 to 64, and turning every class off falls back to lowercase", () => {
    expect(normalizeGenerator({ ...GENERATOR_DEFAULTS, length: 3 }).length).toBe(GENERATOR_LIMITS.min);
    expect(normalizeGenerator({ ...GENERATOR_DEFAULTS, length: 500 }).length).toBe(GENERATOR_LIMITS.max);
    expect(normalizeGenerator({ ...GENERATOR_DEFAULTS, length: Number.NaN }).length).toBe(GENERATOR_DEFAULTS.length);
    expect(normalizeGenerator({ length: 12, lower: false, upper: false, digits: false, symbols: false })).toMatchObject({ lower: true });
  });

  test.each([8, 20, 64])("length %i with every class, at least one of each", (length) => {
    for (let i = 0; i < 50; i++) {
      const p = generatePassword({ ...GENERATOR_DEFAULTS, length }, secureRandom);
      expect(p).toHaveLength(length);
      for (const set of Object.values(CHARSETS)) expect([...p].some((c) => set.includes(c))).toBe(true);
    }
  });

  test("only the chosen classes appear", () => {
    const p = generatePassword({ length: 40, lower: false, upper: false, digits: true, symbols: false }, secureRandom);
    expect(p).toMatch(/^[0-9]{40}$/);
    const q = generatePassword({ length: 40, lower: true, upper: true, digits: false, symbols: false }, secureRandom);
    expect(q).toMatch(/^[a-zA-Z]{40}$/);
  });

  test("uses the random source it is given (the platform's secure one)", () => {
    let calls = 0;
    generatePassword(GENERATOR_DEFAULTS, (n) => (calls++, secureRandom(n)));
    expect(calls).toBeGreaterThan(0);
  });
});

describe("timers (US-VAULT-02, Q82)", () => {
  test("a revealed secret hides after 30 s; the clipboard clears after 30 s", () => {
    expect(VAULT_REVEAL_MS).toBe(30_000);
    expect(VAULT_CLIPBOARD_CLEAR_MS).toBe(30_000);
  });
});
