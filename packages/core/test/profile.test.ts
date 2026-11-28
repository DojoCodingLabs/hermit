/**
 * SL-35 (US-FORM-01, US-FORM-03, FR-FORM-01): the personal profile's pure parts. The form field vectors are shared
 * with FieldKindTest.kt in apps/mobile/modules/hermit-autofill, so the Kotlin service and this rule cannot drift.
 */
import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { webcrypto } from "node:crypto";
import { nodeSql } from "@hermit/sql-node";
import {
  ALWAYS_SENSITIVE, classifyField, clearTables, createProfileStore, erasePlan, NATIVE_PREFERENCES, schemaTables, createVaultStore, fieldTokens, HINT_KINDS, migrate, MIGRATIONS, openProfileValue, planFill, PROFILE_KINDS,
  PROFILE_LIMITS, profileIndex, sealProfileValue, validateProfileValue, WORD_RULES,
  type FieldDescriptor, type FormKind, type VaultCipherPort,
} from "../src/index.ts";

interface Vectors {
  hintKinds: Record<string, string>;
  wordRules: Array<{ kind: string; any: string[]; all: string[][] }>;
  cases: Array<{ name: string; field: FieldDescriptor; expect: FormKind | "password" | null }>;
}
const vectors = JSON.parse(readFileSync(new URL("./profile-field-vectors.json", import.meta.url), "utf8")) as Vectors;

const cipher: VaultCipherPort = {
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

describe("form field kinds (shared vectors with the Kotlin service)", () => {
  test("the shipped tables equal the vectors' tables", () => {
    expect(HINT_KINDS).toEqual(vectors.hintKinds);
    expect(WORD_RULES).toEqual(vectors.wordRules);
  });

  for (const c of vectors.cases) {
    test(c.name, () => {
      expect(classifyField(c.field) ?? null).toBe(c.expect);
    });
  }

  test("tokens split camelCase, digits, punctuation and accents, whole words only", () => {
    expect(fieldTokens(["billingAddress2", "Número de cédula", undefined, "E-mail"])).toEqual(["billing", "address", "2", "numero", "de", "cedula", "e", "mail"]);
  });

  test("every kind a field can get is a profile kind, full_name or password", () => {
    const kinds = new Set<string>([...PROFILE_KINDS, "full_name", "password", "skip"]);
    for (const k of Object.values(HINT_KINDS)) expect(kinds.has(k), k).toBe(true);
    for (const r of WORD_RULES) expect(kinds.has(r.kind), r.kind).toBe(true);
  });
});

describe("profile values (US-FORM-03)", () => {
  test("ID numbers are always sensitive", () => {
    expect([...ALWAYS_SENSITIVE].sort()).toEqual(["id_number", "passport_number", "tax_id"]);
  });

  test("values are trimmed and checked", () => {
    expect(validateProfileValue("given_name", "  Ana  ")).toEqual({ ok: true, value: "Ana" });
    expect(validateProfileValue("given_name", "   ")).toEqual({ ok: false, problem: "empty" });
    expect(validateProfileValue("city", "x".repeat(PROFILE_LIMITS.value + 1))).toEqual({ ok: false, problem: "too_long" });
    expect(validateProfileValue("email", "ana.example.com")).toEqual({ ok: false, problem: "bad_email" });
    expect(validateProfileValue("email", "ana@example.com")).toEqual({ ok: true, value: "ana@example.com" });
    expect(validateProfileValue("street_address", "Calle 1\u0000")).toEqual({ ok: false, problem: "control_chars" });
    expect(validateProfileValue("street_address", "Calle 1\nCasa 2")).toEqual({ ok: false, problem: "control_chars" });
  });

  test("a sealed value opens only with its key and for its own kind", async () => {
    const key = webcrypto.getRandomValues(new Uint8Array(32));
    const sealed = await sealProfileValue(cipher, key, "id_number", "1-2345-6789");
    // The sealed value is hex: check the decoded bytes, not the hex text.
    const sealedBytes = Buffer.from(sealed, "hex");
    expect(sealedBytes.includes(Buffer.from("1-2345-6789", "utf8"))).toBe(false);
    expect(await openProfileValue(cipher, key, "id_number", sealed)).toBe("1-2345-6789");
    await expect(openProfileValue(cipher, key, "passport_number", sealed)).rejects.toThrow();
    await expect(openProfileValue(cipher, new Uint8Array(32), "id_number", sealed)).rejects.toThrow();
  });
});

describe("the profile store (migration 14)", () => {
  test("migration 14 is the profile, after the vault and the approval nonces", () => {
    expect(MIGRATIONS.find((m) => m.id === 14)?.name).toBe("profile");
    expect(MIGRATIONS.find((m) => m.id === 14)?.slice).toBe("SL-35");
  });

  test("plain and sealed rows, one per kind; the database refuses a sensitive row with a plain value", async () => {
    const sql = nodeSql();
    await migrate(sql);
    const store = createProfileStore(sql);
    await store.put({ kind: "given_name", sensitive: false, value: "Ana" }, 1);
    await store.put({ kind: "id_number", sensitive: true, sealed: "abcd" }, 2);
    await store.put({ kind: "given_name", sensitive: false, value: "Ana María" }, 3);
    expect(await store.list()).toEqual([
      { kind: "given_name", sensitive: false, value: "Ana María", updatedAt: 3 },
      { kind: "id_number", sensitive: true, sealed: "abcd", updatedAt: 2 },
    ]);
    await expect(sql.exec("INSERT INTO profile_fields (kind, sensitive, value, sealed, updated_at) VALUES ('tax_id', 1, 'x', NULL, 1)")).rejects.toThrow();
    await expect(sql.exec("INSERT INTO profile_fields (kind, sensitive, value, sealed, updated_at) VALUES ('nope', 0, 'x', NULL, 1)")).rejects.toThrow();
    expect(await store.remove("given_name")).toBe(true);
    expect(await store.remove("given_name")).toBe(false);
    expect((await store.list()).map((r) => r.kind)).toEqual(["id_number"]);
  });

  test("a vault that starts over takes the sealed profile values with it (they were sealed with the old key)", async () => {
    const sql = nodeSql();
    await migrate(sql);
    const store = createProfileStore(sql);
    await store.put({ kind: "city", sensitive: false, value: "Heredia" }, 1);
    await store.put({ kind: "passport_number", sensitive: true, sealed: "ff" }, 1);
    await createVaultStore(sql).wipe();
    expect((await store.list()).map((r) => r.kind)).toEqual(["city"]);
  });
});

describe("planning a fill (FR-FORM-01)", () => {
  const profile = [
    { kind: "given_name" as const, sensitive: false },
    { kind: "family_name" as const, sensitive: false },
    { kind: "email" as const, sensitive: false },
    { kind: "id_number" as const, sensitive: true },
    { kind: "birth_date" as const, sensitive: true },
  ];
  const fields = [
    { key: "0", kind: "full_name" as const },
    { key: "1", kind: "email" as const },
    { key: "2", kind: "id_number" as const },
    { key: "3", kind: "phone" as const },
    { key: "1", kind: "email" as const },
  ];

  test("a verified https page gets every field the profile has; a full name is built from the given and family names", () => {
    expect(planFill({ origin: "https://shop.example", fields, profile })).toEqual({
      fields: [
        { key: "0", kind: "full_name", sensitive: false, sources: ["given_name", "family_name"] },
        { key: "1", kind: "email", sensitive: false, sources: ["email"] },
        { key: "2", kind: "id_number", sensitive: true, sources: ["id_number"] },
      ],
      skipped: [],
    });
  });

  test("an app verified by its signing key is treated like an https page", () => {
    const origin = "android://8P1sW0EPJcslw7UzRsiXL64w-O50Ed-RBICtay1g24M@com.bank.app";
    expect(planFill({ origin, fields, profile }).fields.map((f) => f.key)).toEqual(["0", "1", "2"]);
  });

  test("an http page never gets a sensitive field", () => {
    expect(planFill({ origin: "http://shop.example", fields, profile })).toEqual({
      fields: [
        { key: "0", kind: "full_name", sensitive: false, sources: ["given_name", "family_name"] },
        { key: "1", kind: "email", sensitive: false, sources: ["email"] },
      ],
      skipped: [{ key: "2", kind: "id_number", reason: "needs_secure_page" }],
    });
  });

  test("anything that isn't an exact origin gets nothing", () => {
    for (const origin of ["", "https://shop.example/path", "shop.example", "android://com.bank.app", "javascript:alert(1)"]) {
      expect(planFill({ origin, fields, profile }), origin).toEqual({ fields: [], skipped: [] });
    }
  });

  test("a full name with only one part uses that part; with neither it is not offered", () => {
    expect(planFill({ origin: "https://a.example", fields: [{ key: "0", kind: "full_name" }], profile: [{ kind: "family_name", sensitive: false }] }).fields)
      .toEqual([{ key: "0", kind: "full_name", sensitive: false, sources: ["family_name"] }]);
    expect(planFill({ origin: "https://a.example", fields: [{ key: "0", kind: "full_name" }], profile: [{ kind: "email", sensitive: false }] }).fields).toEqual([]);
  });

  test("the index the autofill service reads holds kinds only, never a value", () => {
    expect(profileIndex(profile)).toEqual({
      kinds: ["birth_date", "email", "family_name", "full_name", "given_name", "id_number"],
      sensitive: ["birth_date", "id_number"],
    });
    expect(profileIndex([{ kind: "given_name", sensitive: true }])).toEqual({ kinds: ["full_name", "given_name"], sensitive: ["full_name", "given_name"] });
  });
});

describe("Delete everything wipes the profile and the autofill preferences (SL-26)", () => {
  test("the profile table is cleared with the others, and both autofill preference files are deleted before the keys", async () => {
    expect(schemaTables()).toContain("profile_fields");
    // hermit_autofill: the profile index (kinds only) the service reads; hermit_autofill_spike: debug diagnostics.
    expect([...NATIVE_PREFERENCES].sort()).toEqual(["hermit_autofill", "hermit_autofill_spike"]);
    const plan = erasePlan();
    expect(plan.find((s) => s.id === "native_prefs")).toEqual({ id: "native_prefs", kind: "delete_native_prefs", names: [...NATIVE_PREFERENCES] });
    const order: string[] = plan.map((s) => s.id);
    for (const s of plan) if (s.kind === "delete_secret") expect(order.indexOf("native_prefs")).toBeLessThan(order.indexOf(s.id));

    const sql = nodeSql();
    await migrate(sql);
    await createProfileStore(sql).put({ kind: "given_name", sensitive: false, value: "Ana" }, 1);
    const tables = plan.find((s) => s.kind === "clear_tables");
    if (tables?.kind !== "clear_tables") throw new Error("no clear_tables step");
    await clearTables(sql, tables.tables);
    expect(await sql.query("SELECT * FROM profile_fields")).toEqual([]);
  });
});
