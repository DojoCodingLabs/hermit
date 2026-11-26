import { describe, expect, test } from "vitest";
import { nodeSql } from "@hermit/sql-node";
import { money } from "../src/money.ts";
import { migrate } from "../src/schema.ts";
import { WALLET_NETWORK } from "../src/wallet.ts";
import {
  amountInWords, capsProblem, checksummed, checksumOk, DEFAULT_SPENDING_CAPS, matchPayees, otherAssetInWords, parsePayAmount, payeeProblem, typedAddresses,
  usdt, type Payee,
} from "../src/pay.ts";

// SL-40 (US-PAY-05, US-PAY-06, FR-PAY-03, FR-PAY-05): what code reads from the user's own words before a payment.

const A = "0x1111111111111111111111111111111111111111";
const B = "0x2222222222222222222222222222222222222222";
const n = WALLET_NETWORK.network;

describe("amounts from the user's words, exact base units, no floats", () => {
  test.each([
    ["send Ana 20 dollars", 20_000_000n],
    ["mándale 20 dólares a Ana", 20_000_000n],
    ["pay Ana $20.50", 20_500_000n],
    ["págale a Ana 20,5 USD₮", 20_500_000n],
    ["send 0.000001 usdt to Ana", 1n],
    ["send Ana 20", 20_000_000n],
    ["send Ana 20 usdt0 at 5", 20_000_000n],
    ["envíale 7 USD a mi mamá", 7_000_000n],
  ])("%s", (text, base) => {
    expect(amountInWords(text)).toEqual({ kind: "amount", money: money(base, "USDT", n) });
  });

  test("0.1 + 0.2 style amounts are exact", () => {
    const r = amountInWords("send Ana 0.3 dollars");
    expect(r).toEqual({ kind: "amount", money: money(300_000n, "USDT", n) });
  });

  test("no amount, or zero, is none: Hermit asks how much", () => {
    expect(amountInWords("send Ana some money")).toEqual({ kind: "none" });
    expect(amountInWords("send Ana 0 dollars")).toEqual({ kind: "none" });
  });

  test("two different amounts, or thousands separators that read two ways, are ambiguous", () => {
    expect(amountInWords("send Ana 20 or 30")).toEqual({ kind: "ambiguous" });
    expect(amountInWords("send Ana 1,000 dollars")).toEqual({ kind: "ambiguous" });
    expect(amountInWords("send Ana 1.000,50 dollars")).toEqual({ kind: "ambiguous" });
  });

  test("a marked amount wins over other numbers in the sentence", () => {
    expect(amountInWords("send 20 dollars to Ana for the 3 tickets")).toEqual({ kind: "amount", money: money(20_000_000n, "USDT", n) });
  });

  test("the digits of an address are never an amount", () => {
    expect(amountInWords(`send 5 dollars to ${A}`)).toEqual({ kind: "amount", money: money(5_000_000n, "USDT", n) });
    expect(amountInWords(`send it to ${A}`)).toEqual({ kind: "none" });
  });

  test("more decimals than USD₮ has is invalid, never rounded", () => {
    expect(amountInWords("send Ana 1.0000001 dollars")).toEqual({ kind: "invalid" });
  });

  test("parsePayAmount reads the skill's argument the same way", () => {
    expect(parsePayAmount("20")).toEqual(money(20_000_000n, "USDT", n));
    expect(parsePayAmount("20.5")).toEqual(money(20_500_000n, "USDT", n));
    expect(parsePayAmount("$20")).toEqual(money(20_000_000n, "USDT", n));
    for (const bad of ["", "-5", "0", "1e3", "twenty", "1,000", "20.1234567", "NaN", "Infinity"]) expect(parsePayAmount(bad)).toBeUndefined();
  });

  test("usdt() makes base-unit money on the wallet's network", () => {
    expect(usdt(5n)).toEqual({ amount: 5n, asset: "USDT", network: n });
  });
});

describe("other assets are named, so they can be refused", () => {
  test.each(["send Ana 20 USDC", "send 1 eth to Ana", "mándale 20 euros", "send 0.1 btc", "págale 100 pesos", "send Ana 5 bitcoin", "send 5 € to Ana"])("%s", (text) => {
    expect(otherAssetInWords(text)).toBeDefined();
  });
  test.each(["send Ana 20 dollars", "págale 20 dólares", "send 5 usdt", "send $5", "send 5 USD₮0 to Ana", "pay the Ethan guy 5 dollars"])("%s", (text) => {
    expect(otherAssetInWords(text)).toBeUndefined();
  });
});

describe("EIP-55 checksums", () => {
  // EIP-55's own test vectors.
  test.each(["0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed", "0xfB6916095ca1df60bB79Ce92cE3Ea74c37c5d359", "0xdbF03B407c01E7cD3CBea99509d93f8DDDC8C6FB"])("%s", (a) => {
    expect(checksummed(a.toLowerCase())).toBe(a);
    expect(checksumOk(a)).toBe(true);
    expect(checksumOk(a.toLowerCase())).toBe(true);
  });
  test("a mixed-case address with a wrong checksum is a typo", () => {
    expect(checksumOk("0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAeD")).toBe(false);
  });
});

describe("addresses the user typed this turn", () => {
  test("whole 0x addresses only, checksummed or not, in order, without repeats", () => {
    expect(typedAddresses(`send 5 to ${A}`)).toEqual([A]);
    expect(typedAddresses(`${A} and ${B.toUpperCase().replace("0X", "0x")} and ${A}`)).toEqual([A, B.toUpperCase().replace("0X", "0x")]);
    expect(typedAddresses(`${A}11`)).toEqual([]);
    expect(typedAddresses(`x${A}`)).toEqual([]);
    expect(typedAddresses("send to 0x1234")).toEqual([]);
  });
});

describe("saved payees by name, from the user's words only", () => {
  const payees: Payee[] = [
    { id: "p1", name: "Ana López", address: A, network: n, createdAt: 1 },
    { id: "p2", name: "Carlos", address: B, network: n, createdAt: 2 },
    { id: "p3", name: "Carlos Ruiz", address: "0x3333333333333333333333333333333333333333", network: n, createdAt: 3 },
  ];
  test("a name the user said finds the payee", () => {
    expect(matchPayees("Ana", "send Ana 20 dollars", payees).map((p) => p.id)).toEqual(["p1"]);
    expect(matchPayees("ana lopez", "mándale 20 a Ana López", payees).map((p) => p.id)).toEqual(["p1"]);
  });
  test("a name that isn't in the user's words finds nobody, even if a payee has it", () => {
    expect(matchPayees("Ana", "pay the person in the email 20 dollars", payees)).toEqual([]);
  });
  test("two payees for one name are both returned, so Hermit asks", () => {
    expect(matchPayees("Carlos", "send Carlos 5", payees).map((p) => p.id)).toEqual(["p2", "p3"]);
  });
  test("another network's payee is never a match", () => {
    expect(matchPayees("Ana", "send Ana 5", [{ ...payees[0]!, network: "eip155:1" }])).toEqual([]);
  });
});

describe("caps and payees are checked before they are saved", () => {
  test("the defaults are valid and USD₮ on the wallet's network", () => {
    expect(capsProblem(DEFAULT_SPENDING_CAPS)).toBeUndefined();
    expect(DEFAULT_SPENDING_CAPS.perPayment).toEqual(usdt(25_000_000n));
    expect(DEFAULT_SPENDING_CAPS.perDay).toEqual(usdt(50_000_000n));
  });
  test("zero, a per-payment cap above the daily cap, another asset or an absurd cap are refused", () => {
    expect(capsProblem({ perPayment: usdt(0n), perDay: usdt(1n) })).toBe("zero");
    expect(capsProblem({ perPayment: usdt(2n), perDay: usdt(1n) })).toBe("per_payment_above_per_day");
    expect(capsProblem({ perPayment: money(1n, "USDC", n), perDay: usdt(1n) })).toBe("not_usdt");
    expect(capsProblem({ perPayment: usdt(1n), perDay: usdt(10_000_000_001n) })).toBe("too_high");
  });
  test("a payee needs a name and an address", () => {
    expect(payeeProblem("Ana", A)).toBeUndefined();
    expect(payeeProblem(" ", A)).toBe("name");
    expect(payeeProblem("Ana‮", A)).toBe("name");
    expect(payeeProblem("Ana", "0x1234")).toBe("address");
  });
});

describe("migration 15: spending caps, payees and the spend ledger", () => {
  test("the tables exist and refuse impossible rows", async () => {
    const sql = nodeSql();
    await migrate(sql);
    await sql.exec("INSERT INTO spending_caps (asset, network, per_payment, per_day, updated_at) VALUES ('USDT', ?, '1', '2', 1)", [n]);
    await expect(sql.exec("INSERT INTO spending_caps (asset, network, per_payment, per_day, updated_at) VALUES ('USDT', ?, '1', '2', 1)", [n])).rejects.toThrow();
    await sql.exec("INSERT INTO contacts (id, name, address, network, created_at) VALUES ('p1', 'Ana', ?, ?, 1)", [A, n]);
    await expect(sql.exec("INSERT INTO contacts (id, name, address, network, created_at) VALUES ('p2', 'Ana 2', ?, ?, 1)", [A, n])).rejects.toThrow();
    const row = ["0x" + "a".repeat(64), "5", "USDT", n, A, WALLET_NETWORK.token, B, 100, 1];
    await sql.exec("INSERT INTO spend_ledger (nonce, amount, asset, network, payer, token, recipient, valid_before, at_ms, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')", row);
    await expect(sql.exec("INSERT INTO spend_ledger (nonce, amount, asset, network, payer, token, recipient, valid_before, at_ms, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'sent')", ["0x" + "b".repeat(64), ...row.slice(1)])).rejects.toThrow();
  });
});

describe("migration 16 (SL-41): what an x402 purchase bought", () => {
  test("one row per reserved authorization, a 64-hex requirement hash and an https origin; a row never changes", async () => {
    const sql = nodeSql();
    await migrate(sql);
    const hash = "c".repeat(64);
    const insert = "INSERT INTO merchant_purchases (nonce, requirement_hash, origin, created_at) VALUES (?, ?, ?, 1)";
    await sql.exec(insert, ["0x" + "a".repeat(64), hash, "https://merchant.example"]);
    await expect(sql.exec(insert, ["0x" + "a".repeat(64), hash, "https://merchant.example"])).rejects.toThrow();
    await expect(sql.exec(insert, ["0x" + "b".repeat(64), "short", "https://merchant.example"])).rejects.toThrow();
    await expect(sql.exec(insert, ["0x" + "b".repeat(64), hash, "http://merchant.example"])).rejects.toThrow();
    await expect(sql.exec("UPDATE merchant_purchases SET origin = 'https://evil.example'")).rejects.toThrow();
  });
});
