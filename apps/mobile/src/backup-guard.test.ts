/// <reference types="node" />
// #126 (non-negotiable 1): on iOS, Hermit's files and Keychain items stay out of iCloud and computer backups.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { backupTargets, deviceOnly, gatedNeedsMove, IOS_SECURE_STORE_SERVICES, isThisDeviceOnly, keychainWritesWithoutOptions, migrationSummary } from "./backup-guard.ts";

const WHEN_UNLOCKED_THIS_DEVICE_ONLY = 6;

test("on iOS every SecureStore write gets a ThisDeviceOnly accessibility, and keeps its other options", () => {
  assert.deepEqual(deviceOnly("ios", WHEN_UNLOCKED_THIS_DEVICE_ONLY), { keychainAccessible: 6 });
  assert.deepEqual(deviceOnly("ios", WHEN_UNLOCKED_THIS_DEVICE_ONLY, { requireAuthentication: true, authenticationPrompt: "p", keychainService: "s" }), {
    requireAuthentication: true, authenticationPrompt: "p", keychainService: "s", keychainAccessible: 6,
  });
});

test("on Android the options are left exactly as they were", () => {
  assert.equal(deviceOnly("android", WHEN_UNLOCKED_THIS_DEVICE_ONLY), undefined);
  const gated = { requireAuthentication: true, authenticationPrompt: "p" };
  const out = deviceOnly("android", WHEN_UNLOCKED_THIS_DEVICE_ONLY, gated);
  assert.deepEqual(out, gated);
  assert.equal("keychainAccessible" in (out ?? {}), false);
});

test("only the ThisDeviceOnly protection classes count as kept on this phone", () => {
  for (const kept of ["aku", "cku", "dku", "akpu"]) assert.equal(isThisDeviceOnly(kept), true, kept);
  for (const moves of ["ak", "ck", "dk"]) assert.equal(isThisDeviceOnly(moves), false, moves);
  assert.equal(isThisDeviceOnly(null), false);
  assert.equal(isThisDeviceOnly("unknown"), false);
});

test("a gated item moves after its authenticated read only when it is known to migrate with backups", () => {
  assert.equal(gatedNeedsMove("ak"), true);
  assert.equal(gatedNeedsMove("ck"), true);
  assert.equal(gatedNeedsMove("aku"), false);
  assert.equal(gatedNeedsMove("akpu"), false);
  // Absent, or iOS wouldn't say without a prompt: leave it alone rather than delete what can't be checked.
  assert.equal(gatedNeedsMove(null), false);
  assert.equal(gatedNeedsMove("unknown"), false);
});

test("the launch migration rewrites the plain SecureStore services, never the biometric-gated one", () => {
  assert.deepEqual([...IOS_SECURE_STORE_SERVICES], ["app:no-auth", "app"]);
  assert.equal(IOS_SECURE_STORE_SERVICES.some((s) => s.endsWith(":auth")), false);
});

test("the backup targets are the documents folder, the model and QVAC folders, and the database with its siblings", () => {
  const docs = "file:///var/mobile/Containers/Data/Application/ABC/Documents/";
  const db = "/var/mobile/Containers/Data/Application/ABC/Library/hermit.db";
  assert.deepEqual(backupTargets(docs, db), [
    "/var/mobile/Containers/Data/Application/ABC/Documents",
    "/var/mobile/Containers/Data/Application/ABC/Documents/models",
    "/var/mobile/Containers/Data/Application/ABC/Documents/.qvac",
    "/var/mobile/Containers/Data/Application/ABC/Library/hermit.db",
    "/var/mobile/Containers/Data/Application/ABC/Library/hermit.db-wal",
    "/var/mobile/Containers/Data/Application/ABC/Library/hermit.db-shm",
    "/var/mobile/Containers/Data/Application/ABC/Library/hermit.db-journal",
  ]);
  // Before the database opens there is no path for it yet; file URLs with escapes come back as plain paths.
  assert.deepEqual(backupTargets("file:///a%20b/Documents"), ["/a b/Documents", "/a b/Documents/models", "/a b/Documents/.qvac"]);
});

test("the migration summary names failures and items that are still not ThisDeviceOnly", () => {
  const s = migrationSummary([
    { service: "app:no-auth", key: "hermit.db.key.v1", before: "ak", after: "aku", ok: true },
    { service: "app:no-auth", key: "hermit.audit.seed.v1", before: "aku", after: "aku", ok: true },
    { service: "app:no-auth", key: "hermit.cred.x", before: "ak", after: "ak", ok: false },
  ]);
  assert.deepEqual(s, { moved: ["hermit.db.key.v1"], kept: ["hermit.audit.seed.v1"], failed: ["hermit.cred.x"] });
  assert.deepEqual(migrationSummary([{ service: "app", key: "k", before: "ak", after: "ak", ok: true }]).failed, ["k"]);
});

test("the scanner flags a SecureStore write without the device-only options", () => {
  const src = [
    `await SecureStore.setItemAsync(KEY, "1");`,
    `await SecureStore.setItemAsync(KEY, v, keychain());`,
    `await SecureStore.setItemAsync(entry.key, hex(key), keychain({ ...OPTIONS, requireAuthentication: true }));`,
    `write: (text) => SecureStore.setItemAsync(WALLET_RECORD_KEY, text),`,
    `await SecureStore.setItemAsync(key, value, keychainAsBefore({ requireAuthentication: true }));`,
    `await SecureStore.setItemAsync(key, value, { ...mykeychain() });`,
  ].join("\n");
  assert.deepEqual(keychainWritesWithoutOptions(src), [1, 4, 6]);
});

test("every SecureStore write in the app goes through keychain()", () => {
  const dir = new URL("./adapters/", import.meta.url).pathname;
  const found = readdirSync(dir)
    .filter((f) => f.endsWith(".ts"))
    .flatMap((f) => keychainWritesWithoutOptions(readFileSync(join(dir, f), "utf8")).map((line) => `adapters/${f}:${line}`));
  assert.deepEqual(found, []);
});
