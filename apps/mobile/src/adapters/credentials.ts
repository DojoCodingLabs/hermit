// The credential store (FR-CONN-03, SL-54): connector and MCP tokens in Android's Keystore-backed SecureStore, one entry
// per credential plus an index of ids. The meta it returns never carries the secret. Delete everything wipes it all.
import * as SecureStore from "expo-secure-store";
import type { CredentialMeta, CredentialSecret, CredentialStorePort } from "@hermit/core";
import { keychain } from "./secure";

const INDEX = "hermit.cred.index";
const SAFE_ID = /^[A-Za-z0-9_-]{1,64}$/;
const keyOf = (id: string) => {
  if (!SAFE_ID.test(id)) throw new Error("credential id has characters SecureStore can't key");
  return `hermit.cred.${id}`;
};

type Item = { meta: CredentialMeta; secret: CredentialSecret };

async function ids(): Promise<string[]> {
  const raw = await SecureStore.getItemAsync(INDEX);
  try {
    const list = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(list) ? list.filter((x): x is string => typeof x === "string" && SAFE_ID.test(x)) : [];
  } catch {
    return [];
  }
}

async function item(id: string): Promise<Item | undefined> {
  if (!SAFE_ID.test(id)) return undefined;
  const raw = await SecureStore.getItemAsync(keyOf(id));
  try {
    return raw ? (JSON.parse(raw) as Item) : undefined;
  } catch {
    return undefined;
  }
}

export const phoneCredentials: CredentialStorePort = {
  async save(meta, secret) {
    if (meta.kind !== secret.kind) throw new Error(`credential ${meta.id}: a ${secret.kind} secret can't be saved as ${meta.kind}`);
    await SecureStore.setItemAsync(keyOf(meta.id), JSON.stringify({ meta, secret }), keychain());
    const all = await ids();
    if (!all.includes(meta.id)) await SecureStore.setItemAsync(INDEX, JSON.stringify([...all, meta.id]), keychain());
  },
  async list() {
    const out: CredentialMeta[] = [];
    for (const id of await ids()) {
      const i = await item(id);
      if (i) out.push(i.meta);
    }
    return out;
  },
  async get(id) {
    return (await item(id))?.meta;
  },
  async reveal(id) {
    return (await item(id))?.secret;
  },
  async markUsed(id, at) {
    const i = await item(id);
    if (!i) return false;
    await SecureStore.setItemAsync(keyOf(id), JSON.stringify({ ...i, meta: { ...i.meta, lastUsedAt: at } }), keychain());
    return true;
  },
  async delete(id) {
    const existed = (await item(id)) !== undefined;
    if (SAFE_ID.test(id)) await SecureStore.deleteItemAsync(keyOf(id));
    const all = await ids();
    if (all.includes(id)) await SecureStore.setItemAsync(INDEX, JSON.stringify(all.filter((x) => x !== id)), keychain());
    return existed;
  },
};

/** Delete everything (SL-54): every stored credential, then the index. Idempotent: a resumed erase finds nothing left. */
export async function deleteAllCredentials(): Promise<void> {
  for (const id of await ids()) await SecureStore.deleteItemAsync(keyOf(id));
  await SecureStore.deleteItemAsync(INDEX);
}
