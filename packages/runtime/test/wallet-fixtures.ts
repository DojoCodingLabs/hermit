/**
 * SL-38: the wallet's test doubles. The worklet stand-in keeps the real one's contract (apps/mobile/worklets/wallet/
 * handler.mjs, tested on its own): the seed is made and kept inside it, sealed with AES-256-GCM under the key it is
 * handed, and only `reveal` gives words back. The addresses are fake but stable per seed.
 */
import { createHash, webcrypto } from "node:crypto";
import { nodeSql } from "@hermit/sql-node";
import { entropyToWords, migrate, wordsToEntropy } from "@hermit/core";
import { createAuditLog, ed25519Signer } from "@hermit/cage";
import { createWallet, type WalletRecordPort, type WalletWorkletPort } from "../src/wallet.ts";
import { fakeKeystore, random } from "./vault-fixtures.ts";

const bytesToHex = (b: Uint8Array) => Buffer.from(b).toString("hex");
const hexToBytes = (h: string) => new Uint8Array(Buffer.from(h, "hex"));
const aad = (id: string) => new TextEncoder().encode(`hermit.wallet.seed.v1\u0000${id}`);
const addressOf = (entropy: Uint8Array) => "0x" + createHash("sha256").update(entropy).digest("hex").slice(0, 40);

async function seal(key: Uint8Array, entropy: Uint8Array, id: string): Promise<string> {
  const iv = webcrypto.getRandomValues(new Uint8Array(12));
  const k = await webcrypto.subtle.importKey("raw", key, "AES-GCM", false, ["encrypt"]);
  const ct = new Uint8Array(await webcrypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: aad(id) }, k, entropy));
  return bytesToHex(iv) + bytesToHex(ct);
}

async function unseal(key: Uint8Array, sealed: string, id: string): Promise<Uint8Array> {
  const b = hexToBytes(sealed);
  const k = await webcrypto.subtle.importKey("raw", key, "AES-GCM", false, ["decrypt"]);
  return new Uint8Array(await webcrypto.subtle.decrypt({ name: "AES-GCM", iv: b.slice(0, 12), additionalData: aad(id) }, k, b.slice(12)));
}

export function fakeWorklet() {
  const s = { calls: [] as string[], keysSeen: [] as Uint8Array[], balance: 0n as bigint, offline: false, fail: undefined as string | undefined, closed: 0 };
  const port: WalletWorkletPort = {
    async create({ id, key, words }) {
      s.calls.push("create");
      s.keysSeen.push(key);
      if (s.fail === "create") throw new Error("worklet_stopped");
      const entropy = webcrypto.getRandomValues(new Uint8Array(words === 12 ? 16 : 32));
      return { sealed: await seal(key, entropy, id), address: addressOf(entropy), path: "m/44'/60'/0'/0/0", chainId: 2201, words };
    },
    async restore({ id, key, words }) {
      s.calls.push("restore");
      s.keysSeen.push(key);
      const entropy = wordsToEntropy(words);
      if (!entropy) throw new Error("bad_phrase");
      return { sealed: await seal(key, entropy, id), address: addressOf(entropy), path: "m/44'/60'/0'/0/0", chainId: 2201, words: words.length as 12 | 24 };
    },
    async reveal({ id, key, sealed }) {
      s.calls.push("reveal");
      s.keysSeen.push(key);
      const entropy = await unseal(key, sealed, id);
      return { words: entropyToWords(entropy), address: addressOf(entropy) };
    },
    async balance() {
      s.calls.push("balance");
      if (s.offline) throw new Error("offline");
      return { usdt0: s.balance };
    },
    async close() {
      s.calls.push("close");
      s.closed++;
    },
  };
  return { port, s };
}

export function memoryRecord() {
  const s = { text: undefined as string | undefined, writes: [] as string[] };
  const port: WalletRecordPort = {
    async read() {
      return s.text;
    },
    async write(text) {
      s.text = text;
      s.writes.push(text);
    },
    async remove() {
      s.text = undefined;
    },
  };
  return { port, s };
}

export async function setupWallet(opts: { onScreen?: () => boolean } = {}) {
  const sql = nodeSql();
  await migrate(sql);
  const audit = createAuditLog(sql, ed25519Signer(new Uint8Array(32).fill(4)));
  const ks = fakeKeystore();
  const worklet = fakeWorklet();
  const record = memoryRecord();
  let now = 1_000;
  let n = 0;
  const wallet = createWallet({ audit, key: ks.port, record: record.port, worklet: worklet.port, random, now: () => now, newId: () => `w${++n}`, onScreen: opts.onScreen ?? (() => true) });
  return { sql, audit, ks, worklet, record, wallet, tick: (ms: number) => (now += ms) };
}

/** The answers a person who wrote the words down would type. */
export const answersFor = (words: readonly string[], positions: readonly number[]) => positions.map((p) => words[p]!);

export { random };
