/**
 * SL-36 (US-FORM-02, FR-VAULT-04): the vault's side of logging in through autofill. App logins are stored by their
 * exact identity (`android://<cert>@<package>`), and the index the autofill service reads holds each item's id hash,
 * name and origins: never the id, a username, a password or a note. Delete everything removes it.
 */
import { describe, expect, test } from "vitest";
import { erasePlan, NATIVE_PREFERENCES } from "../src/erase.ts";
import { loginsFor, normalizeOrigin } from "../src/autofill-origin.ts";
import { loginIndex, parseOrigin, validateItem, vaultItemHash, type VaultEntry } from "../src/vault.ts";

const DIGEST = "8P1sW0EPJcslw7UzRsiXL64w-O50Ed-RBICtay1g24M";
const APP = `android://${DIGEST}@com.example.bank`;

describe("app origins in the vault (SL-36)", () => {
  test("an exact app origin is stored as is: the signing key's SHA-256 digest and the package", () => {
    expect(parseOrigin(APP)).toEqual({ ok: true, origin: APP });
    expect(parseOrigin(`  ${APP}/ `)).toEqual({ ok: true, origin: APP });
    expect(parseOrigin(`ANDROID://${DIGEST}@com.example.bank`)).toEqual({ ok: true, origin: APP });
    const r = parseOrigin(APP);
    expect(r.ok && normalizeOrigin(r.origin)).toBe(APP);
  });

  test("a package alone, a padded or malformed digest, or a path is refused: a package name is not an identity", () => {
    for (const bad of [
      "android://com.example.bank",
      `android://${DIGEST}=@com.example.bank`,
      `android://${DIGEST}==@com.example.bank`,
      `android://${DIGEST.slice(1)}@com.example.bank`,
      `android://${DIGEST}@com`,
      `android://${DIGEST}@com.example.bank/login`,
      `android://${DIGEST}@com.example.bank?x`,
      `androidapp://com.example.bank`,
    ]) {
      expect(parseOrigin(bad), bad).toEqual({ ok: false, problem: "origin_invalid" });
    }
  });

  test("an item may hold a website and its app side by side", () => {
    const v = validateItem({ name: "Bank", username: "ana", secret: "pw", notes: "", origins: ["https://bank.example/login", APP] });
    expect(v.ok && v.origins).toEqual(["https://bank.example", APP]);
  });
});

describe("the login index (SL-36)", () => {
  const entries: VaultEntry[] = [
    { id: "item-1", name: "Bank", origins: ["https://bank.example", APP], createdAt: 1, updatedAt: 2 },
    { id: "item-2", name: "Shop", origins: ["https://shop.example:8443"], createdAt: 1, updatedAt: 2 },
    { id: "item-3", name: "Old", origins: ["not an origin"], createdAt: 1, updatedAt: 2 },
  ];

  test("each item's id hash, name and exact origins; an item with no usable origin is left out", () => {
    expect(loginIndex(entries)).toEqual([
      { ref: vaultItemHash("item-1"), name: "Bank", origins: ["https://bank.example", APP] },
      { ref: vaultItemHash("item-2"), name: "Shop", origins: ["https://shop.example:8443"] },
    ]);
  });

  test("never the item's id, and nothing an entry doesn't have (it has no secrets to leak)", () => {
    const json = JSON.stringify(loginIndex(entries));
    expect(json).not.toContain("item-1");
    for (const e of loginIndex(entries)) expect(Object.keys(e).sort()).toEqual(["name", "origins", "ref"]);
  });

  test("what the service offers from it is exact: a subdomain, a parent and a lookalike get nothing", () => {
    const chrome = { "com.android.chrome": [DIGEST] };
    const ask = (domain: string) => loginsFor({ packageName: "com.android.chrome", certDigests: [DIGEST], web: [{ domain, scheme: "https" }] }, loginIndex(entries), chrome).refs;
    expect(ask("bank.example")).toEqual([vaultItemHash("item-1")]);
    for (const other of ["www.bank.example", "example", "bank.examp1e", "bank.example.evil.net"]) expect(ask(other), other).toEqual([]);
  });

  test("Delete everything removes the index file with the profile index (`hermit_autofill`)", () => {
    expect(NATIVE_PREFERENCES).toContain("hermit_autofill");
    const plan = erasePlan();
    expect(plan.find((s) => s.id === "native_prefs")).toEqual({ id: "native_prefs", kind: "delete_native_prefs", names: [...NATIVE_PREFERENCES] });
  });
});
