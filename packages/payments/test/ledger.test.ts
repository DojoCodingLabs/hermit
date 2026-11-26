import { describe, expect, test } from "vitest";
import { AUTHORIZATION_STATE_SELECTOR, money, rpcBody } from "@hermit/core";
import {
  authorizationStateCall,
  latestBlockCall,
  memoryLedger,
  readAuthorizationState,
  readBlock,
  resolvePending,
  spentInWindow,
  VALID_AFTER_SKEW_SECONDS,
  VOID_MARGIN_SECONDS,
  type SpendRecord,
} from "../src/index.ts";

const NET = "eip155:2201";
const H = 3_600_000;
const rec = (over: Partial<SpendRecord>): SpendRecord => ({
  amount: money(10_000n, "USDT", NET),
  payer: "0x78B2D7f9Fd3EA955fB3A782ac419bE52de22efF3",
  token: "0x78Cf24370174180738C5B8E352B6D14c83a6c9A9",
  nonce: "0x" + "ab".repeat(32),
  validBefore: 1_800_000_300,
  atMs: 1_800_000_000_000,
  status: "pending",
  ...over,
});

describe("spentInWindow: every signed authorization counts until proven unused (fail closed)", () => {
  const now = 1_800_000_000_000 + H;

  test("settled and pending both count; void does not", () => {
    const total = spentInWindow([rec({ status: "settled" }), rec({ status: "pending" }), rec({ status: "void" })], now, "USDT", NET);
    expect(total).toEqual(money(20_000n, "USDT", NET));
  });

  test("a pending authorization past its validBefore still counts until someone checks the chain", () => {
    const total = spentInWindow([rec({ status: "pending", validBefore: 1 })], now, "USDT", NET);
    expect(total.amount).toBe(10_000n);
  });

  test("only the last 24 hours count, and only the same asset and network", () => {
    const old = rec({ status: "settled", atMs: now - 25 * H });
    const other = rec({ status: "settled", amount: money(5n, "USDT", "eip155:9745") });
    expect(spentInWindow([old, other], now, "USDT", NET).amount).toBe(0n);
  });
});

describe("resolvePending: authorizationState(payer, nonce) decides", () => {
  test("used on chain means settled, whenever it is checked", () => {
    expect(resolvePending(rec({}), true, 1_800_000_010).status).toBe("settled");
  });

  test("unused before validBefore stays pending: the merchant can still settle it", () => {
    expect(resolvePending(rec({}), false, 1_800_000_299).status).toBe("pending");
  });

  test("the void margin is at least the skew the authorization tolerates", () => {
    expect(VOID_MARGIN_SECONDS).toBeGreaterThanOrEqual(VALID_AFTER_SKEW_SECONDS);
  });

  test("unused but within the clock-skew margin past validBefore stays pending", () => {
    expect(resolvePending(rec({}), false, 1_800_000_300).status).toBe("pending");
    expect(resolvePending(rec({}), false, 1_800_000_300 + VOID_MARGIN_SECONDS - 1).status).toBe("pending");
  });

  test("unused once validBefore plus the margin has passed by chain time is void and frees the cap", () => {
    expect(resolvePending(rec({}), false, 1_800_000_300 + VOID_MARGIN_SECONDS).status).toBe("void");
  });

  test("settled and void records never change", () => {
    expect(resolvePending(rec({ status: "settled" }), false, 2_000_000_000).status).toBe("settled");
    expect(resolvePending(rec({ status: "void" }), true, 2_000_000_000).status).toBe("void");
  });
});

describe("chain time from the block the state is read at", () => {
  test("asks for the latest block header without transactions", () => {
    expect(latestBlockCall()).toEqual({ method: "eth_getBlockByNumber", params: ["latest", false] });
  });

  test("reads the block number tag and the timestamp in seconds", () => {
    expect(readBlock({ number: "0x1f", timestamp: "0x6b3c2a10", hash: "0x00" })).toEqual({ number: "0x1f", timestamp: 0x6b3c2a10 });
  });

  test("refuses anything that is not a block header", () => {
    expect(() => readBlock(null)).toThrow();
    expect(() => readBlock({ number: "31", timestamp: "0x1" })).toThrow();
  });
});

describe("memoryLedger (reference LedgerPort)", () => {
  const net = NET;
  const cap = { perPayment: money(50_000n, "USDT", net), perDay: money(15_000n, "USDT", net) };
  const now = 1_800_000_000_000;

  test("reserve checks the cap against what is already reserved and inserts pending", async () => {
    const l = memoryLedger();
    expect(await l.reserve(rec({ nonce: "0x" + "01".repeat(32) }), cap, now)).toEqual({ ok: true });
    expect(await l.reserve(rec({ nonce: "0x" + "02".repeat(32) }), cap, now)).toEqual({ ok: false, reason: "over_per_day" });
    expect(l.records()).toMatchObject([{ status: "pending" }]);
  });

  test("concurrent reserves are serialized: only what fits gets in", async () => {
    const l = memoryLedger();
    const results = await Promise.all([1, 2, 3].map((i) => l.reserve(rec({ nonce: "0x" + String(i).padStart(2, "0").repeat(32) }), cap, now)));
    expect(results.filter((r) => r.ok)).toHaveLength(1);
  });

  test("a voided reservation frees the cap; settled and void never change again", async () => {
    const l = memoryLedger();
    const n = "0x" + "03".repeat(32);
    await l.reserve(rec({ nonce: n }), cap, now);
    await l.update(n, "void");
    await l.update(n, "settled");
    expect(l.records()[0]!.status).toBe("void");
    expect(await l.reserve(rec({ nonce: "0x" + "04".repeat(32) }), cap, now)).toEqual({ ok: true });
  });

  test("a nonce cannot be reserved twice", async () => {
    const l = memoryLedger();
    await l.reserve(rec({}), cap, now);
    await expect(l.reserve(rec({}), cap, now)).rejects.toThrow(/Nonce already reserved/);
  });
});

describe("authorizationState eth_call", () => {
  test("encodes authorizationState(address,bytes32) for the token", () => {
    const call = authorizationStateCall(rec({}));
    expect(call.to).toBe("0x78Cf24370174180738C5B8E352B6D14c83a6c9A9");
    // keccak256("authorizationState(address,bytes32)") starts with e94a0102.
    expect(call.data).toBe("0xe94a0102" + "00".repeat(12) + "78b2d7f9fd3ea955fb3a782ac419be52de22eff3" + "ab".repeat(32));
  });

  test("SL-41: the call is exactly the one eth_call the wallet's RPC sends", () => {
    const call = authorizationStateCall(rec({}));
    expect(call.data.startsWith(AUTHORIZATION_STATE_SELECTOR)).toBe(true);
    expect(() => rpcBody(1, "eth_call", [call, readBlock({ number: "0x10", timestamp: "0x1" }).number])).not.toThrow();
  });

  test("decodes a bool word and refuses anything else", () => {
    expect(readAuthorizationState("0x" + "0".repeat(63) + "1")).toBe(true);
    expect(readAuthorizationState("0x" + "0".repeat(64))).toBe(false);
    expect(() => readAuthorizationState("0x")).toThrow();
  });
});
