import { describe, expect, test } from "vitest";
import { addMoney, compareMoney, formatMoney, money, MoneyError, parseMoney, subMoney } from "../src/money.ts";

const usdt = (n: bigint) => money(n, "USDT", "ethereum");

describe("money (CT-01)", () => {
  test("parses typed amounts into base units without floats", () => {
    expect(parseMoney("20", "USDT", "ethereum").amount).toBe(20_000_000n);
    expect(parseMoney("0.1", "USDT", "ethereum").amount).toBe(100_000n);
    expect(parseMoney("19.999999", "USDT", "ethereum").amount).toBe(19_999_999n);
  });

  test("refuses more decimals than the asset has", () => {
    expect(() => parseMoney("1.0000001", "USDT", "ethereum")).toThrow(MoneyError);
  });

  test("refuses text that is not an amount", () => {
    for (const bad of ["", "-1", "1e3", "1,5", "abc"]) expect(() => parseMoney(bad, "USDT", "ethereum")).toThrow(MoneyError);
  });

  test("adds and compares only the same asset on the same network", () => {
    expect(addMoney(usdt(1n), usdt(2n)).amount).toBe(3n);
    expect(compareMoney(usdt(5n), usdt(2n))).toBe(1);
    expect(() => addMoney(usdt(1n), money(1n, "USDT", "tron"))).toThrow(/Cannot combine/);
    expect(() => addMoney(usdt(1n), money(1n, "USDC", "ethereum"))).toThrow(/Cannot combine/);
  });

  test("never goes negative", () => {
    expect(() => subMoney(usdt(1n), usdt(2n))).toThrow(MoneyError);
  });

  test("formats in the user's locale for display only", () => {
    expect(formatMoney(usdt(1_234_500_000n), "en")).toBe("1,234.5 USD₮");
    expect(formatMoney(usdt(1_234_500_000n), "es-419")).toMatch(/^1[,.\u00a0]?234[.,]5 USD₮$/);
    expect(formatMoney(usdt(20_000_000n), "en")).toBe("20 USD₮");
  });

  test("a list pads to a minimum of decimals, so 20 and 12.5 line up, and still keeps every digit asked for", () => {
    expect(formatMoney(usdt(20_000_000n), "en", 6, 2)).toBe("20.00 USD₮");
    expect(formatMoney(usdt(12_500_000n), "en", 6, 2)).toBe("12.50 USD₮");
    expect(formatMoney(usdt(4_990_000n), "en", 6, 2)).toBe("4.99 USD₮");
    expect(formatMoney(usdt(1n), "en", 6, 2)).toBe("0.000001 USD₮");
    expect(formatMoney(usdt(1_234_500_000n), "en", 2, 2)).toBe("1,234.50 USD₮");
  });
});
