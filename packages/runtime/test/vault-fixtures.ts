/** SL-33 and SL-34: the vault's test doubles, shared by the vault and import tests. */
import { webcrypto } from "node:crypto";
import { nodeSql } from "@hermit/sql-node";
import { migrate, type SecureRandom, type VaultCipherPort, type VaultKeyPort, type VaultUnwrap } from "@hermit/core";
import { createAuditLog, ed25519Signer } from "@hermit/cage";
import { createVault } from "../src/vault.ts";

export const cipher: VaultCipherPort = {
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
export const random: SecureRandom = (n) => webcrypto.getRandomValues(new Uint8Array(n));

/** The Keystore in miniature: every unwrap is a "fingerprint" the test can cancel, and new fingerprints invalidate it. */
export function fakeKeystore() {
  let stored: Uint8Array | undefined;
  const s = { prompts: 0, next: "ok" as "ok" | "cancel", invalidated: false, destroyed: 0, handedOut: [] as Uint8Array[] };
  const port: VaultKeyPort = {
    async exists() {
      return stored !== undefined;
    },
    async store(key) {
      s.prompts++;
      if (s.next === "cancel") return (s.next = "ok"), "cancelled";
      stored = key.slice();
      s.invalidated = false;
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
      s.destroyed++;
    },
  };
  return { port, s, swapKey: () => (stored = new Uint8Array(32).fill(1)) };
}

export async function setup(opts: { onScreen?: () => boolean } = {}) {
  const sql = nodeSql();
  await migrate(sql);
  const audit = createAuditLog(sql, ed25519Signer(new Uint8Array(32).fill(4)));
  const ks = fakeKeystore();
  let now = 1_000;
  let n = 0;
  const vault = createVault({ sql, audit, key: ks.port, cipher, random, now: () => now, newId: () => `v${++n}`, onScreen: opts.onScreen ?? (() => true) });
  return { sql, audit, ks, vault, tick: (ms: number) => (now += ms) };
}
