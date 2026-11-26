/**
 * SL-39 (US-PAY-03, FR-PAY-02, CT-01): HM-PAY-03's history through the wallet service, over a fake RPC that answers
 * like Stable testnet's (eth_blockNumber, eth_getLogs with the 10,000-block span). Reading needs the public address
 * only: no fingerprint, no worklet call that touches the seed.
 */
import { describe, expect, test } from "vitest";
import { addressTopic, HISTORY, parseQuantity, parseWalletRecord, toQuantity, TRANSFER_TOPIC, transferRef, WALLET_NETWORK, type LogFilter } from "@hermit/core";
import { createWallet, type WalletChainPort } from "../src/wallet.ts";
import { setupWallet } from "./wallet-fixtures.ts";

const OTHER = "0x93354845030274cd4bf1686abd60ab28ec52e1a7";
const FRIEND = "0x1111111111111111111111111111111111111111";
const HEAD = 2_000_000n;

interface FakeLog {
  from: string;
  to: string;
  amount: bigint;
  block: bigint;
  tx: string;
  token?: string;
}

function fakeChain(logs: FakeLog[] = []) {
  const s = { calls: [] as { method: string; params: unknown[] }[], offline: false, head: HEAD };
  const word = (n: bigint) => "0x" + n.toString(16).padStart(64, "0");
  const chain: WalletChainPort = {
    async call(method, params) {
      s.calls.push({ method, params: [...params] });
      if (s.offline) throw new Error("offline");
      if (method === "eth_blockNumber") return toQuantity(s.head);
      const f = params[0] as LogFilter;
      const from = parseQuantity(f.fromBlock);
      const to = parseQuantity(f.toBlock);
      if (to - from > 10_000n) throw new Error("maximum [from, to] blocks distance: 10000");
      return logs
        .filter((l) => (l.token ?? WALLET_NETWORK.token).toLowerCase() === f.address.toLowerCase() && l.block >= from && l.block <= to)
        .filter((l) => (f.topics[1] ? addressTopic(l.from) === f.topics[1] : true) && (f.topics[2] ? addressTopic(l.to) === f.topics[2] : true))
        .map((l, i) => ({
          address: (l.token ?? WALLET_NETWORK.token).toLowerCase(),
          topics: [TRANSFER_TOPIC, addressTopic(l.from), addressTopic(l.to)],
          data: word(l.amount),
          blockNumber: toQuantity(l.block),
          blockTimestamp: toQuantity(1_790_000_000n + l.block),
          transactionHash: l.tx,
          logIndex: toQuantity(BigInt(i)),
          removed: false,
        }));
    },
  };
  return { chain, s };
}

const tx = (n: number) => "0x" + n.toString(16).padStart(64, "0");

async function walletWith(logs: FakeLog[], opts: { payees?: { address: string; name: string }[] } = {}) {
  const base = await setupWallet();
  const fc = fakeChain(logs);
  const wallet = createWallet({
    audit: base.audit,
    key: base.ks.port,
    record: base.record.port,
    worklet: base.worklet.port,
    random: (n) => new Uint8Array(n).fill(9),
    now: () => 5_000,
    newId: () => "w1",
    onScreen: () => true,
    chain: fc.chain,
    ...(opts.payees ? { payees: async () => opts.payees! } : {}),
  });
  await wallet.create("p");
  const address = parseWalletRecord(base.record.s.text!)!.address;
  return { ...base, wallet, chain: fc, address };
}

describe("history (HM-PAY-03)", () => {
  test("no wallet: none, and nothing is asked of the RPC", async () => {
    const base = await setupWallet();
    const fc = fakeChain();
    const wallet = createWallet({ audit: base.audit, key: base.ks.port, record: base.record.port, worklet: base.worklet.port, random: () => new Uint8Array(32), now: () => 1, newId: () => "w", onScreen: () => true, chain: fc.chain });
    expect(await wallet.history()).toEqual({ kind: "none" });
    expect(fc.s.calls).toEqual([]);
  });

  test("read with the public address only: no fingerprint, no key, no worklet call; only the two read methods", async () => {
    const w = await walletWith([]);
    const prompts = w.ks.s.prompts;
    const workletCalls = w.worklet.s.calls.length;
    const page = await w.wallet.history();
    expect(page.kind).toBe("page");
    expect(w.ks.s.prompts).toBe(prompts);
    expect(w.worklet.s.calls.length).toBe(workletCalls);
    expect(new Set(w.chain.s.calls.map((c) => c.method))).toEqual(new Set(["eth_blockNumber", "eth_getLogs"]));
    // Every filter is USD₮0's Transfer with the wallet's address as sender or recipient, in a span the RPC accepts.
    for (const c of w.chain.s.calls.filter((c) => c.method === "eth_getLogs")) {
      const f = c.params[0] as LogFilter;
      expect(f.address).toBe(WALLET_NETWORK.token);
      expect(f.topics[0]).toBe(TRANSFER_TOPIC);
      expect([f.topics[1], f.topics[2]]).toContain(addressTopic(w.address));
      expect(parseQuantity(f.toBlock) - parseQuantity(f.fromBlock) + 1n).toBeLessThanOrEqual(HISTORY.windowBlocks);
    }
  });

  test("incoming, outgoing and to itself, newest first, exact USD₮ base units; unknown senders are marked", async () => {
    const page = await historyWithLogs((me) => [
      { from: OTHER, to: me, amount: 2_500_000n, block: HEAD - 10n, tx: tx(1) },
      { from: me, to: FRIEND, amount: 1n, block: HEAD - 5n, tx: tx(2) },
      { from: me, to: me, amount: 7n, block: HEAD - 1n, tx: tx(3) },
    ]);
    if (page.kind !== "page") throw new Error(page.kind);
    expect(page.items.map((t) => [t.direction, t.amount.amount, t.amount.asset, t.amount.network, t.unknownSender])).toEqual([
      ["self", 7n, "USDT", "eip155:2201", false],
      ["out", 1n, "USDT", "eip155:2201", false],
      ["in", 2_500_000n, "USDT", "eip155:2201", true],
    ]);
    expect(page.items[2]!.at).toBe(Number(1_790_000_000n + HEAD - 10n) * 1000);
  });

  test("a saved contact's name comes from the user's own contacts, and the sender is no longer unknown", async () => {
    const page = await historyWithLogs((me) => [{ from: FRIEND, to: me, amount: 5n, block: HEAD, tx: tx(9) }], { payees: [{ address: FRIEND.toUpperCase().replace("0X", "0x"), name: "Ana" }] });
    if (page.kind !== "page") throw new Error(page.kind);
    expect(page.items[0]).toMatchObject({ direction: "in", contact: "Ana", unknownSender: false });
  });

  test("another token's transfers never show, whatever it calls itself", async () => {
    const page = await historyWithLogs((me) => [
      { from: OTHER, to: me, amount: 10n ** 30n, block: HEAD, tx: tx(4), token: "0x2222222222222222222222222222222222222222" },
      { from: OTHER, to: me, amount: 3n, block: HEAD - 2n, tx: tx(5) },
    ]);
    if (page.kind !== "page") throw new Error(page.kind);
    expect(page.items.map((t) => t.amount.amount)).toEqual([3n]);
  });

  test("bounded and paginated: a page reads a few windows, Load older continues, and the lookback has a floor", async () => {
    const page = await historyWithLogs((me) => [
      { from: OTHER, to: me, amount: 1n, block: HEAD - 1n, tx: tx(6) },
      { from: OTHER, to: me, amount: 2n, block: HEAD - HISTORY.windowBlocks * BigInt(HISTORY.pageWindows) - 3n, tx: tx(7) },
    ]);
    if (page.kind !== "page") throw new Error(page.kind);
    expect(page.items.map((t) => t.amount.amount)).toEqual([1n]);
    expect(page.to).toBe(HEAD);
    expect(page.from).toBe(HEAD - HISTORY.windowBlocks * BigInt(HISTORY.pageWindows) + 1n);
    expect(page.atFloor).toBe(false);
    expect(page.next).toEqual({ toBlock: page.from - 1n, floor: HEAD - HISTORY.lookbackBlocks + 1n });

    const older = await lastWallet!.wallet.history(page.next);
    if (older.kind !== "page") throw new Error(older.kind);
    expect(older.items.map((t) => t.amount.amount)).toEqual([2n]);
    // One eth_blockNumber for the first page only; two filters per window.
    const calls = lastWallet!.chain.s.calls;
    expect(calls.filter((c) => c.method === "eth_blockNumber")).toHaveLength(1);
    expect(calls.filter((c) => c.method === "eth_getLogs")).toHaveLength(HISTORY.pageWindows * 2 * 2);

    let cursor = older.next;
    let pages = 2;
    while (cursor) {
      const p = await lastWallet!.wallet.history(cursor);
      if (p.kind !== "page") throw new Error(p.kind);
      cursor = p.next;
      pages++;
      if (!cursor) {
        expect(p.atFloor).toBe(true);
        expect(p.from).toBe(HEAD - HISTORY.lookbackBlocks + 1n);
      }
    }
    expect(pages).toBe(Number(HISTORY.lookbackBlocks / HISTORY.windowBlocks) / HISTORY.pageWindows);
  });

  test("a page stops early once it holds enough transfers", async () => {
    const page = await historyWithLogs((me) => Array.from({ length: HISTORY.pageTarget + 5 }, (_, i) => ({ from: OTHER, to: me, amount: 1n, block: HEAD - BigInt(i), tx: tx(100 + i) })));
    if (page.kind !== "page") throw new Error(page.kind);
    expect(page.items).toHaveLength(HISTORY.pageTarget + 5);
    expect(lastWallet!.chain.s.calls.filter((c) => c.method === "eth_getLogs")).toHaveLength(2);
    expect(page.next).toBeDefined();
  });

  test("a chain younger than the lookback starts at block 0", async () => {
    const page = await historyWithLogs(() => [], {}, 25_000n);
    if (page.kind !== "page") throw new Error(page.kind);
    expect(page.atFloor).toBe(true);
    expect(page.from).toBe(0n);
    expect(page.next).toBeUndefined();
  });

  test("offline, an RPC error or an answer that isn't a list: unavailable, never an empty history", async () => {
    const w = await walletWith([]);
    w.chain.s.offline = true;
    expect(await w.wallet.history()).toEqual({ kind: "unavailable" });
    const bad = await setupWallet();
    const wallet = createWallet({
      audit: bad.audit, key: bad.ks.port, record: bad.record.port, worklet: bad.worklet.port, random: () => new Uint8Array(32).fill(1), now: () => 1, newId: () => "w", onScreen: () => true,
      chain: { call: async (m) => (m === "eth_blockNumber" ? "0x100" : { result: [] }) },
    });
    await wallet.create("p");
    expect(await wallet.history()).toEqual({ kind: "unavailable" });
  });

  test("a cursor that doesn't make sense is refused", async () => {
    const w = await walletWith([]);
    expect(await w.wallet.history({ toBlock: -1n, floor: 0n })).toEqual({ kind: "unavailable" });
    expect(await w.wallet.history({ toBlock: 10n, floor: 20n })).toEqual({ kind: "unavailable" });
  });

  test("without an RPC port (a build without it), the history is unavailable", async () => {
    const w = await setupWallet();
    await w.wallet.create("p");
    expect(await w.wallet.history()).toEqual({ kind: "unavailable" });
  });

  test("a transfer Hermit made links to its signed-log entry (Q128); others don't", async () => {
    const page = await historyWithLogs((me) => [
      { from: me, to: FRIEND, amount: 4n, block: HEAD, tx: tx(42) },
      { from: OTHER, to: me, amount: 5n, block: HEAD - 1n, tx: tx(43) },
    ], {}, HEAD, async (audit) => {
      await audit.append({ ts: 1, sessionId: "s", event: "executed", skill: "pay", outcome: "ok", argsHash: transferRef(tx(42)) });
    });
    if (page.kind !== "page") throw new Error(page.kind);
    const seqs = (await lastWallet!.audit.entries()).filter((e) => e.event === "executed").map((e) => e.seq);
    expect(page.items[0]!.logSeq).toBe(seqs[0]);
    expect(page.items[1]!.logSeq).toBeUndefined();
  });
});

// --- helpers: a wallet whose chain holds logs addressed to the wallet's own (random) address ---------------------------

let lastWallet: Awaited<ReturnType<typeof walletWith>> | undefined;

async function historyWithLogs(
  make: (me: string) => FakeLog[],
  opts: { payees?: { address: string; name: string }[] } = {},
  head = HEAD,
  seed?: (audit: Awaited<ReturnType<typeof setupWallet>>["audit"]) => Promise<void>,
) {
  const logs: FakeLog[] = [];
  const w = await walletWith(logs, opts);
  w.chain.s.head = head;
  logs.push(...make(w.address));
  if (seed) await seed(w.audit);
  lastWallet = w;
  return w.wallet.history();
}
