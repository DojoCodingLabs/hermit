import { describe, expect, test } from "vitest";
import { normalizePayMerchant, payMerchantDef } from "../src/pay-merchant.ts";

// SL-41 (US-PAY-07, FR-PAY-04): paying a site that asks for x402. The model picks `pay_merchant`; its one argument, the
// address, comes from the user's own words. What is paid (amount, payee, network) is read by code from the site's 402
// in the hold, never from the model.

const norm = (args: Record<string, unknown>, userText: string, earlier?: string[]) =>
  normalizePayMerchant(args, { userText, now: 0, timeZone: "UTC", ...(earlier ? { earlier } : {}) }).args;

describe("the pay_merchant menu entry", () => {
  test("a spend with one argument, the address; its menuLine fits", () => {
    expect(payMerchantDef.id).toBe("pay_merchant");
    expect(payMerchantDef.risk).toBe("spend");
    expect(payMerchantDef.producesUntrusted).toBe(false);
    expect(payMerchantDef.menuLine.length).toBeLessThanOrEqual(300);
    expect(payMerchantDef.args.required).toEqual(["url"]);
    expect(payMerchantDef.args.additionalProperties).toBe(false);
    expect(Object.keys(payMerchantDef.args.properties as object)).toEqual(["url"]);
  });
});

describe("the address comes from the user's words", () => {
  test("the one link in this message, made https", () => {
    expect(norm({ url: "https://merchant.example/x" }, "pay for https://merchant.example/report")).toEqual({ url: "https://merchant.example/report" });
    expect(norm({ url: "" }, "paga merchant.example/report? no, www.merchant.example/report")).toEqual({ url: "https://www.merchant.example/report" });
    expect(norm({}, "pay for http://merchant.example/report")).toEqual({ url: "https://merchant.example/report" });
  });

  test("the model's pick stands only when it is one of the user's links", () => {
    const two = "pay for https://a.example/1 or https://b.example/2";
    expect(norm({ url: "https://b.example/2" }, two)).toEqual({ url: "https://b.example/2" });
    expect(norm({ url: "https://evil.example/pay" }, two)).toEqual({ url: "" });
  });

  test("a link the user never wrote is dropped (a page, a message or the model can't choose who gets paid)", () => {
    expect(norm({ url: "https://evil.example/pay" }, "pay for it")).toEqual({ url: "" });
  });

  test("'pay for it' after the 402: the link from the user's latest earlier message that had one", () => {
    expect(norm({ url: "https://evil.example/" }, "yes, pay for it", ["thanks", "read https://merchant.example/report", "https://old.example/"]))
      .toEqual({ url: "https://merchant.example/report" });
  });
});

describe("the sheet's own lines", () => {
  test("the site and the page the user asked for; the price and payee come from the hold", () => {
    const s = payMerchantDef.describeAction({ url: "https://www.merchant.example/report?id=1" }, { conversation: () => undefined });
    expect(s.title).toBe("Pay this site?");
    expect(s.lines).toEqual([
      { label: "Site", value: "www.merchant.example", flag: "pay_site" },
      { label: "Page", value: "https://www.merchant.example/report?id=1", flag: "pay_page" },
    ]);
    expect(s.unresolved).toBeUndefined();
    expect(s.binding).toBe("https://www.merchant.example/report?id=1");
  });

  test("no https address: the sheet is never shown", () => {
    for (const url of ["", "http://merchant.example/", "https://127.0.0.1/", "https://localhost/x"]) {
      expect(payMerchantDef.describeAction({ url }, { conversation: () => undefined }).unresolved, url).toBeTruthy();
    }
  });

  test("its signed terms come only from the hold: on their own the args can't be signed", () => {
    expect(() => payMerchantDef.approvalTerms!({ url: "https://merchant.example/x" })).toThrow();
  });
});
