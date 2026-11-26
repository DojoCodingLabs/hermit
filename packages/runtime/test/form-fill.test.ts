/**
 * SL-35 (US-FORM-01, US-FORM-03, FR-FORM-01, Q79): the personal profile (HM-FORM-02) and filling another app's form
 * from it (HM-FORM-01), over a fake Keystore: every fill is a cage decision in the signed log, sensitive fields need
 * the vault's fingerprint, nothing fills with nobody on screen, and no profile value reaches the model.
 */
import { describe, expect, test } from "vitest";
import { webcrypto } from "node:crypto";
import { readFileSync } from "node:fs";
import { nodeSql } from "@hermit/sql-node";
import { migrate, type SecureRandom, type VaultCipherPort, type VaultKeyPort, type VaultUnwrap } from "@hermit/core";
import { createAuditLog, ed25519Signer, verifyChain } from "@hermit/cage";
import { profileById, type CompletionEngine, type EngineRequest } from "@hermit/model";
import { createHermit } from "../src/hermit.ts";
import { createVault } from "../src/vault.ts";
import { createProfile } from "../src/profile.ts";
import { createFormFill, FILL_MAX_FIELDS, FILL_TTL_MS, type NativeProfileRequest } from "../src/form-fill.ts";

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
const random: SecureRandom = (n) => webcrypto.getRandomValues(new Uint8Array(n));

function fakeKeystore() {
  let stored: Uint8Array | undefined;
  const s = { prompts: 0, next: "ok" as "ok" | "cancel", invalidated: false, handedOut: [] as Uint8Array[] };
  const port: VaultKeyPort = {
    exists: async () => stored !== undefined,
    async store(key) {
      s.prompts++;
      stored = key.slice();
      return "stored";
    },
    async unwrap(): Promise<VaultUnwrap> {
      s.prompts++;
      if (s.next === "cancel") return (s.next = "ok"), { kind: "cancelled" };
      if (!stored || s.invalidated) return { kind: "lost" };
      const key = stored.slice();
      s.handedOut.push(key);
      return { kind: "key", key };
    },
    async destroy() {
      stored = undefined;
    },
  };
  return { port, s };
}

const CHROME = "8P1sW0EPJcslw7UzRsiXL64w-O50Ed-RBICtay1g24M";
const BANK_KEY = "bankKeyDigest_00000000000000000000000000000";

async function setup(opts: { onScreen?: () => boolean; vault?: boolean } = {}) {
  const sql = nodeSql();
  await migrate(sql);
  const signer = ed25519Signer(new Uint8Array(32).fill(4));
  const audit = createAuditLog(sql, signer);
  const ks = fakeKeystore();
  let now = 1_000;
  let n = 0;
  let onScreen = opts.onScreen ?? (() => true);
  const indexes: unknown[] = [];
  const base = { sql, audit, key: ks.port, cipher, now: () => now, newId: () => `id${++n}`, onScreen: () => onScreen() };
  const vault = createVault({ ...base, random });
  if (opts.vault !== false) await vault.create("p");
  const profile = createProfile({ ...base, onIndex: (i) => void indexes.push(i) });
  const fill = createFormFill(base);
  return {
    sql, audit, signer, ks, vault, profile, fill, indexes,
    tick: (ms: number) => (now += ms),
    setOnScreen: (f: () => boolean) => (onScreen = f),
  };
}

const web = (over: Partial<NativeProfileRequest> = {}): NativeProfileRequest => ({
  id: "n1",
  packageName: "com.android.chrome",
  certDigests: [CHROME],
  web: [{ domain: "shop.example", scheme: "https" }],
  origin: "https://shop.example",
  fields: [{ key: "0", kind: "full_name" }, { key: "1", kind: "email" }, { key: "2", kind: "id_number" }, { key: "3", kind: "phone" }],
  ...over,
});

async function filled(w: Awaited<ReturnType<typeof setup>>) {
  expect(await w.profile.save("given_name", "Ana", false, "p")).toEqual({ kind: "saved" });
  expect(await w.profile.save("family_name", "Mora", false, "p")).toEqual({ kind: "saved" });
  expect(await w.profile.save("email", "ana@example.com", false, "p")).toEqual({ kind: "saved" });
  expect(await w.profile.save("id_number", "1-2345-6789", true, "p")).toEqual({ kind: "saved" });
}

describe("the personal profile (HM-FORM-02, US-FORM-03)", () => {
  test("plain fields save without a fingerprint; a sensitive one is sealed behind the vault's fingerprint", async () => {
    const w = await setup();
    const before = w.ks.s.prompts;
    await w.profile.save("city", "Heredia", false, "p");
    expect(w.ks.s.prompts).toBe(before);
    await w.profile.save("passport_number", "P1234567", true, "p");
    expect(w.ks.s.prompts).toBe(before + 1);
    const rows = JSON.stringify(await w.sql.query("SELECT * FROM profile_fields"));
    expect(rows).toContain("Heredia");
    expect(rows).not.toContain("P1234567");
    expect(await w.profile.list()).toEqual([
      { kind: "city", sensitive: false, locked: false, value: "Heredia" },
      { kind: "passport_number", sensitive: true, locked: true },
    ]);
    for (const k of w.ks.s.handedOut) expect(k.every((b) => b === 0)).toBe(true);
  });

  test("ID numbers are always sensitive, whatever the screen asked", async () => {
    const w = await setup();
    await w.profile.save("tax_id", "RFC123", false, "p");
    expect(await w.profile.list()).toEqual([{ kind: "tax_id", sensitive: true, locked: true }]);
  });

  test("a sensitive field needs a vault; a cancelled fingerprint saves nothing; problems ask for no fingerprint", async () => {
    const none = await setup({ vault: false });
    expect(await none.profile.save("id_number", "1", true, "p")).toEqual({ kind: "no_vault" });
    expect(await none.profile.save("city", "Heredia", false, "p")).toEqual({ kind: "saved" });

    const w = await setup();
    w.ks.s.next = "cancel";
    expect(await w.profile.save("id_number", "1", true, "p")).toEqual({ kind: "cancelled" });
    expect(await w.profile.list()).toEqual([]);
    const prompts = w.ks.s.prompts;
    expect(await w.profile.save("email", "nope", false, "p")).toEqual({ kind: "invalid", problem: "bad_email" });
    expect(await w.profile.save("id_number", " ", true, "p")).toEqual({ kind: "invalid", problem: "empty" });
    expect(w.ks.s.prompts).toBe(prompts);
  });

  test("a vault whose key was lost reports lost and saves nothing sealed", async () => {
    const w = await setup();
    w.ks.s.invalidated = true;
    expect(await w.profile.save("id_number", "1", true, "p")).toEqual({ kind: "lost" });
  });

  test("marking a field sensitive and back moves it between sealed and plain", async () => {
    const w = await setup();
    await w.profile.save("birth_date", "1990-04-01", true, "p");
    expect(await w.profile.list()).toEqual([{ kind: "birth_date", sensitive: true, locked: false }]);
    await w.profile.save("birth_date", "1990-04-01", false, "p");
    expect(await w.profile.list()).toEqual([{ kind: "birth_date", sensitive: false, locked: false, value: "1990-04-01" }]);
  });

  test("every change pushes the kinds-only index for the autofill service, and is signed in the log without content", async () => {
    const w = await setup();
    await filled(w);
    expect(await w.profile.remove("email")).toBe("deleted");
    expect(await w.profile.remove("email")).toBe("gone");
    expect(w.indexes.at(-1)).toEqual({ kinds: ["family_name", "full_name", "given_name", "id_number"], sensitive: ["id_number"] });
    expect(JSON.stringify(w.indexes)).not.toMatch(/Ana|Mora|ana@example|2345/);
    const entries = await w.audit.entries();
    expect(entries.filter((e) => e.skill === "profile").map((e) => e.reason)).toEqual([
      "profile.saved", "profile.saved", "profile.saved", "profile.saved", "profile.deleted",
    ]);
    expect(JSON.stringify(entries)).not.toMatch(/Ana|Mora|ana@example|2345|given_name|id_number/);
  });
});

describe("filling a form (HM-FORM-01, FR-FORM-01)", () => {
  test("the preview names the requester by its verified identity and shows each field, masking the sensitive one", async () => {
    const w = await setup();
    await filled(w);
    const r = await w.fill.prepare(web());
    expect(r).toEqual({
      kind: "preview",
      id: expect.any(String),
      requester: { kind: "web", origin: "https://shop.example", secure: true, browser: "Chrome" },
      lines: [
        { key: "0", kind: "full_name", sensitive: false, value: "Ana Mora" },
        { key: "1", kind: "email", sensitive: false, value: "ana@example.com" },
        { key: "2", kind: "id_number", sensitive: true },
      ],
      skipped: [],
      requireBiometric: true,
      expiresAt: 1_000 + FILL_TTL_MS,
    });
    expect(JSON.stringify(r)).not.toContain("2345");
  });

  test("approving a sensitive fill is the vault's fingerprint; the values come back by field key, and the log records the cage's decision", async () => {
    const w = await setup();
    await filled(w);
    const r = await w.fill.prepare(web());
    if (r.kind !== "preview") throw new Error(r.kind);
    const prompts = w.ks.s.prompts;
    expect(await w.fill.approve(r.id, "p")).toEqual({ kind: "fill", values: { "0": "Ana Mora", "1": "ana@example.com", "2": "1-2345-6789" } });
    expect(w.ks.s.prompts).toBe(prompts + 1);
    await w.fill.delivered(r.id, true);
    const entries = (await w.audit.entries()).filter((e) => e.skill === "fill_form");
    expect(entries.map((e) => [e.event, e.decision ?? null, e.outcome ?? null])).toEqual([
      ["call_proposed", null, null],
      ["policy_decided", "ask", null],
      ["approval", "ask", "ok"],
      ["executed", null, "ok"],
    ]);
    expect(new Set(entries.map((e) => e.argsHash)).size).toBe(1);
    expect(verifyChain(await w.audit.entries(), await w.signer.publicKey())).toEqual({ ok: true });
    expect(JSON.stringify(await w.audit.entries())).not.toMatch(/Ana|Mora|ana@example|2345|shop\.example/);
    for (const k of w.ks.s.handedOut) expect(k.every((b) => b === 0)).toBe(true);
    // One approval, one fill.
    expect(await w.fill.approve(r.id, "p")).toEqual({ kind: "gone" });
  });

  test("a fill of plain fields only is approved with a tap, no fingerprint", async () => {
    const w = await setup();
    await filled(w);
    const r = await w.fill.prepare(web({ fields: [{ key: "0", kind: "given_name" }, { key: "1", kind: "email" }] }));
    if (r.kind !== "preview") throw new Error(r.kind);
    expect(r.requireBiometric).toBe(false);
    const prompts = w.ks.s.prompts;
    expect(await w.fill.approve(r.id, "p")).toEqual({ kind: "fill", values: { "0": "Ana", "1": "ana@example.com" } });
    expect(w.ks.s.prompts).toBe(prompts);
  });

  test("a cancelled fingerprint fills nothing and the preview stays for another try", async () => {
    const w = await setup();
    await filled(w);
    const r = await w.fill.prepare(web());
    if (r.kind !== "preview") throw new Error(r.kind);
    w.ks.s.next = "cancel";
    expect(await w.fill.approve(r.id, "p")).toEqual({ kind: "cancelled" });
    expect(await w.fill.approve(r.id, "p")).toMatchObject({ kind: "fill" });
  });

  test("deny is signed as denied and fills nothing", async () => {
    const w = await setup();
    await filled(w);
    const r = await w.fill.prepare(web());
    if (r.kind !== "preview") throw new Error(r.kind);
    await w.fill.deny(r.id);
    expect(await w.fill.approve(r.id, "p")).toEqual({ kind: "gone" });
    const last = (await w.audit.entries()).filter((e) => e.skill === "fill_form").at(-1);
    expect(last).toMatchObject({ event: "approval", outcome: "denied" });
  });

  test("an app is named by its package and signing key; its label is only what it calls itself", async () => {
    const w = await setup();
    await filled(w);
    const r = await w.fill.prepare(web({
      packageName: "com.bank.app", appLabel: "My Bank", certDigests: [BANK_KEY], web: [], origin: `android://${BANK_KEY}@com.bank.app`,
    }));
    expect(r).toMatchObject({ kind: "preview", requester: { kind: "app", packageName: "com.bank.app", label: "My Bank", key: BANK_KEY } });
  });

  test("an http page gets the plain fields only, and the sheet says which were held back", async () => {
    const w = await setup();
    await filled(w);
    const r = await w.fill.prepare(web({ web: [{ domain: "shop.example", scheme: "http" }], origin: "http://shop.example" }));
    expect(r).toMatchObject({
      kind: "preview",
      requester: { kind: "web", origin: "http://shop.example", secure: false },
      lines: [{ key: "0", kind: "full_name" }, { key: "1", kind: "email" }],
      skipped: [{ key: "2", kind: "id_number", reason: "needs_secure_page" }],
      requireBiometric: false,
    });
  });

  test("every spike guard holds: no certificate, no scheme, an untrusted browser's page, mixed frames, an origin the native side got wrong", async () => {
    const w = await setup();
    await filled(w);
    expect(await w.fill.prepare(web({ certDigests: [] }))).toEqual({ kind: "refused", reason: "no_signing_cert" });
    expect(await w.fill.prepare(web({ web: [{ domain: "shop.example" }] }))).toEqual({ kind: "refused", reason: "no_web_scheme" });
    expect(await w.fill.prepare(web({ web: [{ domain: "a.example", scheme: "https" }, { domain: "b.example", scheme: "https" }] }))).toEqual({ kind: "refused", reason: "mixed_web_origins" });
    // A browser that isn't on the list is the app it is: the page it claims doesn't count.
    expect(await w.fill.prepare(web({ packageName: "com.evil.browser", certDigests: [BANK_KEY] }))).toEqual({ kind: "refused", reason: "origin_changed" });
    expect(await w.fill.prepare(web({ origin: "https://other.example" }))).toEqual({ kind: "refused", reason: "origin_changed" });
    expect(await w.fill.prepare(web({ fields: [{ key: "0", kind: "password" as never }] }))).toEqual({ kind: "refused", reason: "bad_request" });
    expect(await w.fill.prepare(web({ fields: [{ key: "0", kind: "phone" }] }))).toEqual({ kind: "refused", reason: "nothing_to_fill" });
  });

  test("nobody on screen (a night pass): the cage denies, before and after the preview", async () => {
    const w = await setup();
    await filled(w);
    w.setOnScreen(() => false);
    expect(await w.fill.prepare(web())).toEqual({ kind: "refused", reason: "not_on_screen" });
    const last = (await w.audit.entries()).filter((e) => e.skill === "fill_form").at(-1);
    expect(last).toMatchObject({ event: "policy_decided", decision: "deny" });

    w.setOnScreen(() => true);
    const r = await w.fill.prepare(web());
    if (r.kind !== "preview") throw new Error(r.kind);
    w.setOnScreen(() => false);
    expect(await w.fill.approve(r.id, "p")).toEqual({ kind: "not_on_screen" });
  });

  test("a preview expires, and a profile changed since the preview fills nothing", async () => {
    const w = await setup();
    await filled(w);
    const r = await w.fill.prepare(web());
    if (r.kind !== "preview") throw new Error(r.kind);
    w.tick(FILL_TTL_MS + 1);
    expect(await w.fill.approve(r.id, "p")).toEqual({ kind: "expired" });

    const r2 = await w.fill.prepare(web());
    if (r2.kind !== "preview") throw new Error(r2.kind);
    await w.profile.save("email", "otra@example.com", false, "p");
    expect(await w.fill.approve(r2.id, "p")).toEqual({ kind: "changed" });
  });

  test("two approves of one preview (a double tap): only the first can fill, even while its fingerprint is open", async () => {
    const w = await setup();
    await filled(w);
    const r = await w.fill.prepare(web());
    if (r.kind !== "preview") throw new Error(r.kind);
    const [a, b] = await Promise.all([w.fill.approve(r.id, "p"), w.fill.approve(r.id, "p")]);
    expect([a.kind, b.kind].sort()).toEqual(["fill", "gone"]);
    expect((await w.audit.entries()).filter((e) => e.event === "approval" && e.skill === "fill_form")).toHaveLength(1);
  });

  test("previews nobody answered leave the pending map, signed as expired", async () => {
    const w = await setup();
    await filled(w);
    const r = await w.fill.prepare(web());
    if (r.kind !== "preview") throw new Error(r.kind);
    w.tick(FILL_TTL_MS + 1);
    await w.fill.prepare(web({ id: "n2" }));
    expect(await w.fill.approve(r.id, "p")).toEqual({ kind: "gone" });
    const approvals = (await w.audit.entries()).filter((e) => e.event === "approval" && e.skill === "fill_form");
    expect(approvals.map((e) => e.outcome)).toEqual(["expired"]);
  });

  test("a request carries at most FILL_MAX_FIELDS fields (the native service caps the same)", async () => {
    const w = await setup();
    await filled(w);
    const many = (n: number) => Array.from({ length: n }, (_, i) => ({ key: String(i), kind: "email" as const }));
    expect(await w.fill.prepare(web({ fields: many(FILL_MAX_FIELDS) }))).toMatchObject({ kind: "preview" });
    expect(await w.fill.prepare(web({ fields: many(FILL_MAX_FIELDS + 1) }))).toEqual({ kind: "refused", reason: "bad_request" });
    const vectors = JSON.parse(readFileSync(new URL("../../core/test/profile-field-vectors.json", import.meta.url), "utf8")) as { maxFields: number };
    expect(FILL_MAX_FIELDS).toBe(vectors.maxFields);
  });

  test("a vault reset since the preview: the sensitive value is gone, so nothing fills", async () => {
    const w = await setup();
    await filled(w);
    const r = await w.fill.prepare(web());
    if (r.kind !== "preview") throw new Error(r.kind);
    await w.vault.reset();
    expect(await w.fill.approve(r.id, "p")).toEqual({ kind: "changed" });
  });
});

describe("profile values never reach the model", () => {
  test("after saving a profile and filling a form, no prompt holds any of it, and nothing on the menu fills", async () => {
    const sql = nodeSql();
    const requests: EngineRequest[] = [];
    const engine: CompletionEngine = {
      async complete(req) {
        requests.push(req);
        return { text: requests.length % 2 ? '{"choice":"respond"}' : "No tengo esos datos.", toolCalls: [] };
      },
    };
    const ks = fakeKeystore();
    let n = 0;
    const indexes: unknown[] = [];
    const hermit = createHermit(
      {
        sql,
        signer: ed25519Signer(new Uint8Array(32).fill(4)),
        notifier: { schedule: async () => "n", cancel: async () => {} },
        calendar: { list: async () => [], add: async () => {}, calendars: async () => [] },
        replySender: { send: async () => "sent" },
        engine,
        approvals: { request: async (r) => ({ kind: "approved", biometric: true, argsHash: r.call.argsHash }) },
        now: () => Date.UTC(2026, 10, 15),
        timeZone: () => "America/Costa_Rica",
        language: () => "es-419",
        newId: () => `id${++n}`,
        vault: { key: ks.port, cipher, random, onScreen: () => true },
        autofill: { setProfileIndex: (i) => void indexes.push(i) },
      },
      profileById("botpsy-q4-two-stage-nothink")!,
    );
    await hermit.init();
    expect(await hermit.vault!.create("p")).toBe("created");
    const profile = hermit.profile!;
    await profile.save("given_name", "Valentina", false, "p");
    await profile.save("street_address", "Avenida Central 123", false, "p");
    await profile.save("id_number", "9-8765-4321", true, "p");
    const r = await hermit.forms!.prepare(web({ fields: [{ key: "0", kind: "given_name" }, { key: "1", kind: "street_address" }, { key: "2", kind: "id_number" }] }));
    if (r.kind !== "preview") throw new Error(r.kind);
    expect(await hermit.forms!.approve(r.id, "p")).toMatchObject({ kind: "fill" });
    expect(indexes.at(-1)).toEqual({ kinds: ["full_name", "given_name", "id_number", "street_address"], sensitive: ["id_number"] });

    const s = await hermit.startSession();
    await hermit.send(s, "¿cuál es mi cédula y mi dirección?");
    const seen = JSON.stringify(requests);
    for (const v of ["Valentina", "Avenida Central", "8765"]) expect(seen).not.toContain(v);
    expect(seen).not.toMatch(/fill_form|profile_fields/);
  });
});
