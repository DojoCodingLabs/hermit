import {
  checkRecoveryPhrase, CREATE_WORD_COUNT, HISTORY, historyWindows, money, parseQuantity, parseTransferLogs, parseWalletRecord, serializeWalletRecord,
  transferLogFilters, transferRef, WALLET_KEY_BYTES, WALLET_NETWORK, walletIdHash, wordCheckMatches, wordCheckPositions,
  type ChainTransfer, type Money, type PhraseCheck, type ReadMethod, type SecureRandom, type WalletKeyPort, type WalletRecord,
} from "@hermit/core";
import type { AuditLog } from "@hermit/cage";

/**
 * SL-38 (US-PAY-01, US-PAY-02, FR-PAY-01): the wallet service HM-PAY-01 and HM-PAY-02 call. Like the vault, it is never
 * a skill and never on the model's menu, and the night shift never gets it: nothing here reaches a prompt.
 *
 * - The seed lives in the wallet worklet (`WalletWorkletPort`, Tether WDK in Bare). The worklet makes it from its
 *   CSPRNG, seals it under the wallet key and returns the sealed blob and the address. This service stores those in one
 *   record (`WalletRecordPort`, a SecureStore entry; never the database) and never sees the seed.
 * - The wallet key is a random 32-byte key wrapped by an Android Keystore key that needs a strong biometric for every
 *   use (`WalletKeyPort`, the vault's pattern under its own service). It is unwrapped for one worklet call and zeroed.
 * - The words are shown once, for the backup, behind a fresh fingerprint, while Hermit is on screen; the user then
 *   types three of them. After that they are never shown again. Restore checks the words (BIP-39, English) before any
 *   fingerprint and shows the derived address and its balance before anything is committed.
 * - One wallet per device; Stable testnet and USD₮ only.
 * - Every action is signed in the log as a `wallet` entry with the hash of the wallet id and an action code only.
 */

/** What the worklet says about a wallet it sealed (checked again by @hermit/payments' client on the phone). */
export interface SealedWallet {
  sealed: string;
  address: string;
  path: string;
  chainId: number;
  words: 12 | 24;
}

/** The wallet worklet, behind the app's adapter. Every method may throw (the worklet stopped, a refusal, offline). */
export interface WalletWorkletPort {
  create(req: { id: string; key: Uint8Array; words: 12 | 24 }): Promise<SealedWallet>;
  restore(req: { id: string; key: Uint8Array; words: readonly string[] }): Promise<SealedWallet>;
  /** The backup screen only. */
  reveal(req: { id: string; key: Uint8Array; sealed: string }): Promise<{ words: string[]; address: string }>;
  /** USD₮0 base units for a public address, over Stable testnet's RPC; no key. */
  balance(address: string): Promise<{ usdt0: bigint }>;
  /** Drops anything the worklet holds open. */
  close(): Promise<void>;
}

/**
 * SL-39 (FR-PAY-02): Stable testnet's RPC for the history, read-only. The type allows only `eth_blockNumber` and
 * `eth_getLogs`, and the app's adapter (countedFetch, so the host shows on HM-SET-02) refuses anything else again.
 */
export interface WalletChainPort {
  call(method: ReadMethod, params: readonly unknown[]): Promise<unknown>;
}

/** A saved payee (ENT-Contact, SL-40): the user's own name for an address. */
export interface WalletPayee {
  address: string;
  name: string;
}

/** The one wallet record (`WALLET_RECORD_KEY`): read, replaced whole, removed. */
export interface WalletRecordPort {
  read(): Promise<string | undefined>;
  write(text: string): Promise<void>;
  remove(): Promise<void>;
}

export interface WalletDeps {
  audit: AuditLog;
  key: WalletKeyPort;
  record: WalletRecordPort;
  worklet: WalletWorkletPort;
  random: SecureRandom;
  now(): number;
  /** A wallet id: letters, digits and dashes (a UUID on the phone). */
  newId(): string;
  /** True only while the app is in the foreground and its screen is showing. */
  onScreen(): boolean;
  /** SL-39: the RPC the history reads; without it the history is unavailable. */
  chain?: WalletChainPort;
  /** SL-39: the user's saved payees, so a known address shows its name and isn't "unknown sender". */
  payees?(): Promise<readonly WalletPayee[]>;
}

/** "lost": the wallet key was invalidated (new fingerprints) or is gone; only the words bring the wallet back. */
export type WalletStatus = "none" | "needs_backup" | "ready" | "lost";

export type WalletSummary = { kind: "none" } | { kind: "wallet"; status: Exclude<WalletStatus, "none">; address: string; words: 12 | 24; source: "created" | "restored" };

type Refusal = { kind: "cancelled" } | { kind: "unavailable" } | { kind: "not_on_screen" } | { kind: "failed" };
export type WalletCreate = { kind: "created"; address: string } | { kind: "exists" } | Refusal;
export type WalletReveal = { kind: "words"; words: string[]; positions: number[] } | { kind: "none" } | { kind: "backed_up" } | { kind: "lost" } | Refusal;
export type WalletRestore = { kind: "preview"; address: string; balance?: Money } | { kind: "invalid"; check: Exclude<PhraseCheck, { ok: true }> } | { kind: "exists" } | Refusal;
export type WalletBalance = { kind: "balance"; usdt: Money } | { kind: "none" } | { kind: "unavailable" };

/** Where a history page stopped; the next page continues below `toBlock` and never below `floor`. */
export interface HistoryCursor {
  toBlock: bigint;
  floor: bigint;
}

/** One transfer on HM-PAY-03. Nothing in it is text from the chain: hex checked by pattern, numbers and Money. */
export interface WalletTransfer extends ChainTransfer {
  /** The user's own name for the other address, from their saved payees. */
  contact?: string;
  /** Incoming from an address the user hasn't saved: the screen labels it "unknown sender". */
  unknownSender: boolean;
  /** The signed-log entry when Hermit made this transfer (Q128). */
  logSeq?: number;
}

export type WalletHistory =
  | { kind: "page"; items: WalletTransfer[]; from: bigint; to: bigint; atFloor: boolean; next?: HistoryCursor }
  | { kind: "none" }
  | { kind: "unavailable" };

export type WalletAction = "created" | "revealed" | "backed_up" | "restored" | "started_over";

export interface Wallet {
  status(): Promise<WalletStatus>;
  summary(): Promise<WalletSummary>;
  /** HM-PAY-01: the USD₮ balance of the wallet's address. No fingerprint: the address is public. */
  balance(): Promise<WalletBalance>;
  /**
   * HM-PAY-03 (US-PAY-03): one page of USD₮ transfers, newest first, from the RPC's Transfer logs for the public
   * address (Q127). No fingerprint and no seed. Without a cursor, the newest page; then `next` until `atFloor`.
   */
  history(cursor?: HistoryCursor): Promise<WalletHistory>;
  /** US-PAY-01: a new wallet; the fingerprint is the one that wraps the new wallet key. */
  create(prompt: string): Promise<WalletCreate>;
  /** US-PAY-01: the words, once, behind a fresh fingerprint, and the three positions to confirm. */
  reveal(prompt: string): Promise<WalletReveal>;
  /** The three typed words, in the order of `positions`. A mismatch drops the check: reveal again. */
  confirmBackup(answers: readonly string[]): Promise<"confirmed" | "mismatch" | "nothing_pending">;
  /** The pure check the restore screen shows as the user types. */
  checkPhrase(text: string): PhraseCheck;
  /** US-PAY-02: checks, then (one fingerprint) derives and seals; nothing is kept until `commitRestore`. */
  restore(text: string, prompt: string): Promise<WalletRestore>;
  commitRestore(): Promise<"restored" | "nothing_pending">;
  /** "Not my wallet": drops the preview and destroys the wallet key it made. */
  cancelRestore(): Promise<void>;
  /** A lost wallet only: deletes the record and destroys the key, so a new one can be made. */
  startOver(): Promise<"done" | "not_lost">;
  /** The app lock, leaving the screens: drops a pending word check or restore and closes the worklet. */
  lock(): void;
}

/** Wallet actions are the user's own, from the wallet screens, not part of any chat session. */
const WALLET_SESSION = "user";

export function createWallet(deps: WalletDeps): Wallet {
  let lost = false;
  /** The three expected words while a check is pending; never the whole phrase. */
  let check: { id: string; positions: number[]; expected: string[] } | undefined;
  let pendingRestore: WalletRecord | undefined;

  /**
   * The stored record. A record that is there but can't be read is `corrupt`, never "none": treating it as absent
   * would let create overwrite the only copy of a sealed seed (security review).
   */
  const load = async (): Promise<{ kind: "none" } | { kind: "ok"; rec: WalletRecord } | { kind: "corrupt" }> => {
    const text = await deps.record.read();
    if (text === undefined) return { kind: "none" };
    const rec = parseWalletRecord(text);
    return rec ? { kind: "ok", rec } : { kind: "corrupt" };
  };
  const read = async (): Promise<WalletRecord | undefined> => {
    const r = await load();
    return r.kind === "ok" ? r.rec : undefined;
  };

  const log = (action: WalletAction, id: string) =>
    deps.audit.append({ ts: deps.now(), sessionId: WALLET_SESSION, event: "wallet", skill: "wallet", outcome: "ok", reason: `wallet.${action}`, argsHash: walletIdHash(id) });

  async function status(): Promise<WalletStatus> {
    const r = await load();
    if (r.kind === "none") return "none";
    if (r.kind === "corrupt") return "lost";
    const rec = r.rec;
    if (lost || !(await deps.key.exists())) return "lost";
    return rec.backedUpAt === undefined ? "needs_backup" : "ready";
  }

  /** A fresh wallet key, wrapped behind the fingerprint, handed to `f` and zeroed whatever happens. */
  async function withNewKey<T>(prompt: string, f: (key: Uint8Array) => Promise<T>): Promise<T | { kind: "cancelled" } | { kind: "unavailable" }> {
    const key = deps.random(WALLET_KEY_BYTES);
    try {
      if (key.length !== WALLET_KEY_BYTES) throw new Error("The random source returned the wrong length.");
      const stored = await deps.key.store(key, prompt);
      if (stored !== "stored") return { kind: stored };
      return await f(key);
    } finally {
      key.fill(0);
    }
  }

  /** The worklet's answer must be for Stable testnet's one path (it is checked on the IPC side too). */
  const onNetwork = (s: SealedWallet) => s.chainId === WALLET_NETWORK.chainId && s.path === WALLET_NETWORK.path && /^0x[0-9a-fA-F]{40}$/.test(s.address);

  async function readBalance(address: string): Promise<Money | undefined> {
    try {
      return money((await deps.worklet.balance(address)).usdt0, WALLET_NETWORK.asset, WALLET_NETWORK.network);
    } catch {
      return undefined;
    }
  }

  async function readHistory(address: string, cursor: HistoryCursor | undefined): Promise<WalletHistory> {
    const chain = deps.chain;
    if (!chain) return { kind: "unavailable" };
    let toBlock: bigint;
    let floor: bigint;
    if (cursor) {
      if (typeof cursor.toBlock !== "bigint" || typeof cursor.floor !== "bigint" || cursor.floor < 0n || cursor.toBlock < cursor.floor) return { kind: "unavailable" };
      ({ toBlock, floor } = cursor);
    } else {
      toBlock = parseQuantity(await chain.call("eth_blockNumber", []));
      floor = toBlock + 1n > HISTORY.lookbackBlocks ? toBlock + 1n - HISTORY.lookbackBlocks : 0n;
    }
    const items: ChainTransfer[] = [];
    const seen = new Set<string>();
    let from = toBlock + 1n;
    for (const w of historyWindows(toBlock, floor, HISTORY.pageWindows)) {
      const [incoming, outgoing] = await Promise.all(transferLogFilters(address, w.from, w.to).map((f) => chain.call("eth_getLogs", [f])));
      if (!Array.isArray(incoming) || !Array.isArray(outgoing)) throw new TypeError("The RPC's logs are not a list.");
      for (const t of parseTransferLogs([...incoming, ...outgoing], address, w).transfers) {
        const key = `${t.txHash}:${t.logIndex}`;
        if (!seen.has(key)) {
          seen.add(key);
          items.push(t);
        }
      }
      from = w.from;
      if (items.length >= HISTORY.pageTarget) break;
    }
    const names = new Map<string, string>();
    for (const p of (await deps.payees?.()) ?? []) if (/^0x[0-9a-fA-F]{40}$/.test(p.address)) names.set(p.address.toLowerCase(), p.name);
    // Q128: the entry that records a transfer Hermit made carries `transferRef(txHash)` as its argsHash.
    const logs = new Map<string, number>();
    for (const e of await deps.audit.entries()) if (e.argsHash && !logs.has(e.argsHash)) logs.set(e.argsHash, e.seq);
    const shown = items.map((t): WalletTransfer => {
      const contact = t.direction === "self" ? undefined : names.get(t.counterparty.toLowerCase());
      const logSeq = logs.get(transferRef(t.txHash));
      return { ...t, ...(contact !== undefined ? { contact } : {}), unknownSender: t.direction === "in" && contact === undefined, ...(logSeq !== undefined ? { logSeq } : {}) };
    });
    const atFloor = from <= floor;
    return { kind: "page", items: shown, from, to: toBlock, atFloor, ...(atFloor ? {} : { next: { toBlock: from - 1n, floor } }) };
  }

  const dropRestore = async () => {
    if (!pendingRestore) return;
    pendingRestore = undefined;
    await deps.key.destroy().catch(() => {});
  };

  return {
    status,
    async summary() {
      const rec = await read();
      if (!rec) return { kind: "none" };
      const s = await status();
      return { kind: "wallet", status: s === "none" ? "lost" : s, address: rec.address, words: rec.words, source: rec.source };
    },
    async balance() {
      const rec = await read();
      if (!rec) return { kind: "none" };
      const usdt = await readBalance(rec.address);
      return usdt ? { kind: "balance", usdt } : { kind: "unavailable" };
    },
    async history(cursor) {
      const rec = await read();
      if (!rec) return { kind: "none" };
      try {
        return await readHistory(rec.address, cursor);
      } catch {
        return { kind: "unavailable" };
      }
    },
    async create(prompt) {
      if (!deps.onScreen()) return { kind: "not_on_screen" };
      if ((await load()).kind !== "none") return { kind: "exists" };
      const id = deps.newId();
      const r = await withNewKey(prompt, async (key) => {
        try {
          const made = await deps.worklet.create({ id, key, words: CREATE_WORD_COUNT });
          return onNetwork(made) && made.words === CREATE_WORD_COUNT ? made : undefined;
        } catch {
          return undefined;
        }
      });
      if (r === undefined) return { kind: "failed" };
      if ("kind" in r) return r;
      const rec: WalletRecord = { v: 1, id, address: r.address, path: WALLET_NETWORK.path, chainId: WALLET_NETWORK.chainId, sealed: r.sealed, words: r.words, source: "created", createdAt: deps.now() };
      if (!parseWalletRecord(serializeWalletRecord(rec))) return { kind: "failed" };
      await deps.record.write(serializeWalletRecord(rec));
      lost = false;
      await log("created", id);
      return { kind: "created", address: r.address };
    },
    async reveal(prompt) {
      check = undefined;
      if (!deps.onScreen()) return { kind: "not_on_screen" };
      const rec = await read();
      if (!rec) return { kind: "none" };
      if (rec.backedUpAt !== undefined) return { kind: "backed_up" };
      if ((await status()) === "lost") return { kind: "lost" };
      const got = await deps.key.unwrap(prompt);
      if (got.kind === "cancelled") return { kind: "cancelled" };
      if (got.kind === "lost") {
        lost = true;
        return { kind: "lost" };
      }
      let shown: { words: string[]; address: string } | undefined;
      try {
        shown = await deps.worklet.reveal({ id: rec.id, key: got.key, sealed: rec.sealed });
      } catch {
        shown = undefined;
      } finally {
        got.key.fill(0);
      }
      // The words must be a valid phrase for this wallet's address, or nothing is shown (a wrong backup loses money).
      const valid = shown && shown.address.toLowerCase() === rec.address.toLowerCase() ? checkRecoveryPhrase(shown.words.join(" ")) : undefined;
      if (!valid?.ok || valid.words.length !== rec.words) return { kind: "failed" };
      // A fingerprint prompt can take a while: the screen must still be showing when the words are handed over.
      if (!deps.onScreen()) return { kind: "not_on_screen" };
      const positions = wordCheckPositions(valid.words.length, deps.random);
      check = { id: rec.id, positions, expected: positions.map((p) => valid.words[p]!) };
      await log("revealed", rec.id);
      return { kind: "words", words: valid.words, positions };
    },
    async confirmBackup(answers) {
      const pending = check;
      check = undefined;
      if (!pending) return "nothing_pending";
      const sparse: string[] = [];
      pending.positions.forEach((p, i) => (sparse[p] = pending.expected[i]!));
      if (!wordCheckMatches(sparse, pending.positions, answers)) return "mismatch";
      const rec = await read();
      if (!rec || rec.id !== pending.id) return "nothing_pending";
      await deps.record.write(serializeWalletRecord({ ...rec, backedUpAt: deps.now() }));
      await log("backed_up", rec.id);
      return "confirmed";
    },
    checkPhrase: checkRecoveryPhrase,
    async restore(text, prompt) {
      await dropRestore();
      if (!deps.onScreen()) return { kind: "not_on_screen" };
      const phrase = checkRecoveryPhrase(text);
      if (!phrase.ok) return { kind: "invalid", check: phrase };
      if ((await read()) && (await status()) !== "lost") return { kind: "exists" };
      const id = deps.newId();
      const r = await withNewKey(prompt, async (key) => {
        try {
          const made = await deps.worklet.restore({ id, key, words: phrase.words });
          return onNetwork(made) && made.words === phrase.words.length ? made : undefined;
        } catch {
          return undefined;
        }
      });
      if (r === undefined) {
        await deps.key.destroy().catch(() => {});
        return { kind: "failed" };
      }
      if ("kind" in r) return r;
      pendingRestore = { v: 1, id, address: r.address, path: WALLET_NETWORK.path, chainId: WALLET_NETWORK.chainId, sealed: r.sealed, words: r.words, source: "restored", createdAt: deps.now() };
      const balance = await readBalance(r.address);
      return balance ? { kind: "preview", address: r.address, balance } : { kind: "preview", address: r.address };
    },
    async commitRestore() {
      const rec = pendingRestore;
      pendingRestore = undefined;
      if (!rec) return "nothing_pending";
      // The user typed the words, so the backup is already done.
      await deps.record.write(serializeWalletRecord({ ...rec, backedUpAt: deps.now() }));
      lost = false;
      check = undefined;
      await log("restored", rec.id);
      return "restored";
    },
    cancelRestore: dropRestore,
    async startOver() {
      const rec = await read();
      if (!rec || (await status()) !== "lost") return "not_lost";
      await deps.record.remove();
      await deps.key.destroy();
      lost = false;
      check = undefined;
      await log("started_over", rec.id);
      return "done";
    },
    lock() {
      check = undefined;
      void dropRestore();
      void deps.worklet.close().catch(() => {});
    },
  };
}
