import { describe, expect, test } from "vitest";
import { usdt, WALLET_NETWORK, type Payee } from "@hermit/core";
import { normalizePay, payDef, payMoney } from "../src/pay.ts";

// SL-40 (US-PAY-05, FR-PAY-03): the model fills `pay`; code fixes its arguments from the user's own words this turn and
// the payees the user saved. The recipient never comes from the model's paraphrase, a message or a tool result.

const A = "0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed";
const B = "0xfB6916095ca1df60bB79Ce92cE3Ea74c37c5d359";
const n = WALLET_NETWORK.network;
const payees: Payee[] = [
  { id: "p1", name: "Ana López", address: A.toLowerCase(), network: n, createdAt: 1 },
  { id: "p2", name: "Carlos", address: B, network: n, createdAt: 2 },
  { id: "p3", name: "Carlos Ruiz", address: "0xdbF03B407c01E7cD3CBea99509d93f8DDDC8C6FB", network: n, createdAt: 3 },
];
const norm = (args: Record<string, unknown>, userText: string) => normalizePay(payees)(args, { userText, now: 0, timeZone: "UTC" }).args;

describe("the pay skill's menu entry", () => {
  test("it is a spend, takes an amount and a person or an address, and its menuLine fits", () => {
    expect(payDef.risk).toBe("spend");
    expect(payDef.producesUntrusted).toBe(false);
    expect(payDef.menuLine.length).toBeLessThanOrEqual(300);
    expect(payDef.args.required).toEqual(["amount"]);
    expect(payDef.args.additionalProperties).toBe(false);
  });
});

describe("normalizing from the user's words", () => {
  test("a saved payee the user named becomes the payee's address; the amount is the user's, exactly", () => {
    expect(norm({ person: "Ana", amount: "20.00" }, "send Ana 20 dollars")).toEqual({ person: "Ana", to: A, amount: "20" });
  });

  test("the model's own amount never stands: the user's words win", () => {
    expect(norm({ person: "Ana", amount: "200" }, "send Ana 20 dollars").amount).toBe("20");
  });

  test("a name in the `to` field is read as the name", () => {
    expect(norm({ to: "Ana", amount: "20" }, "mándale 20 dólares a Ana")).toMatchObject({ to: A, person: "Ana" });
  });

  test("an address the user typed this turn is used, checksummed, whatever the model wrote", () => {
    expect(norm({ to: B, amount: "5" }, `pay ${A.toLowerCase()} 5 usdt`)).toEqual({ to: A, amount: "5" });
  });

  test("an address the model wrote that the user didn't type is dropped (from an email, a page or the model)", () => {
    const out = norm({ to: B, amount: "5" }, "pay the address in that email 5 dollars");
    expect(out.to).toBe("");
  });

  test("a name that isn't in the user's words is never looked up, even if it is a saved payee", () => {
    expect(norm({ person: "Ana", amount: "5" }, "pay the person who wrote to me 5 dollars").to).toBe("");
  });

  test("two payees with the name: empty, so Hermit asks which", () => {
    expect(norm({ person: "Carlos", amount: "5" }, "send Carlos 5 dollars")).toMatchObject({ to: "", person: "Carlos" });
  });

  test("two typed addresses, or a typed address with a wrong checksum: empty", () => {
    expect(norm({ amount: "5" }, `send 5 to ${A} or ${B}`).to).toBe("");
    expect(norm({ amount: "5" }, "send 5 to 0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAeD").to).toBe("");
  });

  test("no amount, or two, in the words: empty", () => {
    expect(norm({ person: "Ana", amount: "20" }, "send Ana some money").amount).toBe("");
    expect(norm({ person: "Ana", amount: "20" }, "send Ana 20 or 30").amount).toBe("");
  });

  test("another asset the user named is kept so it can be refused; a model's asset is dropped otherwise", () => {
    expect(norm({ person: "Ana", amount: "20" }, "send Ana 20 euros").asset).toBe("EUROS");
    expect(norm({ person: "Ana", amount: "20", asset: "USDC" }, "send Ana 20 dollars").asset).toBeUndefined();
  });
});

describe("the sheet and the signed terms come from the exact arguments", () => {
  test("amount in USD₮, the full checksummed address, the network", () => {
    const sum = payDef.describeAction({ to: A, amount: "20.5" }, { conversation: () => undefined });
    expect(sum.lines).toEqual([
      { label: "Amount", value: "20.5 USD₮", flag: "pay_amount" },
      { label: "To", value: A, flag: "pay_to" },
      { label: "Network", value: "Stable testnet", flag: "pay_network" },
    ]);
    expect(sum.unresolved).toBeUndefined();
    expect(sum.binding).toBe(`${A}|USDT|20500000`);
  });

  test("the smallest amount shows all six decimals, never rounded to zero", () => {
    expect(payDef.describeAction({ to: A, amount: "0.000001" }, { conversation: () => undefined }).lines[0]!.value).toBe("0.000001 USD₮");
  });

  test("no amount or no address can't be shown, so it is unresolved", () => {
    expect(payDef.describeAction({ to: "", amount: "20" }, { conversation: () => undefined }).unresolved).toBeDefined();
    expect(payDef.describeAction({ to: A, amount: "" }, { conversation: () => undefined }).unresolved).toBeDefined();
  });

  test("the Keystore signs the amount in base units and the checksummed recipient", () => {
    expect(payDef.approvalTerms!({ to: A.toLowerCase(), amount: "20" })).toEqual({ amount: usdt(20_000_000n), recipient: A });
  });

  test("another asset reaches the signed terms as itself, so the cage refuses it", () => {
    expect(payMoney({ amount: "20", asset: "EUROS" })).toEqual({ amount: 20_000_000n, asset: "EUROS", network: n });
    expect(payDef.approvalTerms!({ to: A, amount: "20", asset: "USDC" }).amount!.asset).toBe("USDC");
    expect(payMoney({ amount: "20", asset: "usd₮" })).toEqual(usdt(20_000_000n));
  });

  test("no terms without an amount and an address", () => {
    expect(() => payDef.approvalTerms!({ to: "", amount: "20" })).toThrow();
  });
});
