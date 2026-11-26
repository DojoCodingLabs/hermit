import { describe, expect, test } from "vitest";
import { codeShapeOk, extractOneTimeCode } from "../src/one-time-code.ts";
import { codeSenderMatches, registrableDomain, smsBoundToOrigin, webOtpLine } from "../src/site-domain.ts";
import { codeFieldIndex, CODE_WINDOW_MS, type SignInFacts } from "../src/web-login.ts";

// SL-56b (Q138): Hermit reads the code from the SMS or email and types it after an approval. These are the pure
// pieces: the code out of a message by code (never the message into the model), the site's registrable domain an
// email sender must be on, and the one field the code may go into.

describe("the code out of one message, by code (fails closed)", () => {
  test.each([
    ["Your verification code is 739104. It expires in 10 minutes.", "739104"],
    ["G-482913 is your Google verification code.", "482913"],
    ["Tu código de WhatsApp: 482-913. No compartas este código con nadie.", "482913"],
    ["Use 88 21 74 to log in. Never share this passcode.", "882174"],
    ["Your security code is AB7K2Q", "AB7K2Q"],
    ["Código de verificación\n\n553201\n\nVence en 10 minutos. © 2026 Tienda S.A., San José 10101", "553201"],
    ["482913", "482913"],
    ["Your code is ４８２９１３", "482913"],
  ])("%s", (text, code) => {
    expect(extractOneTimeCode(text)).toBe(code);
  });

  test.each([
    ["two different codes", "Your code is 482913. Your old code 112233 no longer works."],
    ["no word that announces a code", "Order 482913 shipped on 2026-11-17"],
    ["a code next to a phone number", "Your code is 482913, or call 800-555-0199"],
    ["mixed case words are not codes", "Your code is Covid19ok"],
    ["nothing", ""],
    ["too long", "Your code is 12345678901"],
  ])("no code: %s", (_label, text) => {
    expect(extractOneTimeCode(text)).toBeUndefined();
  });

  test("the code a runner accepts: 4 to 10 upper-case letters and digits, at least one digit", () => {
    expect(codeShapeOk("482913")).toBe(true);
    expect(codeShapeOk("AB7K2Q")).toBe(true);
    for (const bad of ["", "123", "ABCDEF", "48 2913", "48291<", "12345678901", "ab7k2q"]) expect(codeShapeOk(bad), bad).toBe(false);
  });
});

describe("the site's registrable domain, for an email sender", () => {
  test.each([
    ["shop.example.com", "example.com"],
    ["accounts.example.com", "example.com"],
    ["example.com", "example.com"],
    ["www.banco.co.cr", "banco.co.cr"],
    ["tienda.com.mx", "tienda.com.mx"],
    ["login.service.gov.uk", "service.gov.uk"],
    ["shop.example.com.", "example.com"],
    ["myshop.github.io", "myshop.github.io"],
    ["a.b.vercel.app", "b.vercel.app"],
  ])("%s is %s", (host, domain) => {
    expect(registrableDomain(host)).toBe(domain);
  });

  test.each(["com", "co.cr", "github.io", "192.168.1.10", "[::1]", "", "exa mple.com"])("no registrable domain: %s", (host) => {
    expect(registrableDomain(host)).toBeUndefined();
  });

  test("a sender counts only on the site's registrable domain, and never on a free mail service", () => {
    const site = "https://shop.example.com";
    expect(codeSenderMatches("Example <no-reply@example.com>", site)).toBe(true);
    expect(codeSenderMatches("no-reply@mail.example.com", site)).toBe(true);
    expect(codeSenderMatches("NO-REPLY@EXAMPLE.COM", site)).toBe(true);
    for (const s of ["no-reply@example.com.evil.io", "no-reply@examp1e.com", "no-reply@evilexample.com", "example.com@evil.io", "Example.com <x@evil.io>", "", "not an address"]) {
      expect(codeSenderMatches(s, site), s).toBe(false);
    }
    // Anyone can have an address there: a site on a free mail service never gets a code from mail.
    expect(codeSenderMatches("someone@yahoo.com", "https://login.yahoo.com")).toBe(false);
    expect(codeSenderMatches("someone@outlook.com", "https://outlook.com")).toBe(false);
    expect(codeSenderMatches("someone@gmail.com", "https://mail.gmail.com")).toBe(false);
    // An origin that isn't https, or a bare IP address, is no site for this.
    expect(codeSenderMatches("x@example.com", "http://shop.example.com")).toBe(false);
    expect(codeSenderMatches("x@10.0.0.1", "https://10.0.0.1")).toBe(false);
  });
});

describe("an SMS is bound to the site (security review, Q140)", () => {
  const site = "https://shop.example.com";
  test.each([
    ["a WebOTP line for the exact host", "482913 is your code.\n\n@shop.example.com #482913"],
    ["the registrable domain", "example.com: your code is 482913"],
    ["a host on the site", "Code for shop.example.com: 482913"],
    ["upper case", "EXAMPLE.COM: 482913 is your code"],
  ])("bound: %s", (_label, text) => {
    expect(smsBoundToOrigin(text, "482913", site)).toBe(true);
  });

  test.each([
    ["no site named", "Your code is 482913"],
    ["another site", "Your Evil code is 482913"],
    ["a lookalike", "Your code for example.com.evil.io is 482913"],
    ["a label inside a word", "Your examples code is 482913"],
    ["the brand label alone (no domain): the user types it", "Your Example code is 482913"],
    ["a WebOTP line for another host, whatever else it says", "Your Example code is 482913\n@evil.example #482913"],
    ["a WebOTP line for the registrable domain only (not the exact host)", "Your code\n@example.com #482913"],
    ["a WebOTP line whose code differs", "Example code 482913\n@shop.example.com #111111"],
    ["a WebOTP line for an embedded site", "Example 482913\n@shop.example.com #482913 @widget.other.example"],
  ])("not bound: %s", (_label, text) => {
    expect(smsBoundToOrigin(text, "482913", site)).toBe(false);
  });

  test("the WebOTP code is the one taken when the line is there", () => {
    expect(webOtpLine("Use 99 to pay.\n@shop.example.com #482913")).toEqual({ host: "shop.example.com", code: "482913" });
    expect(webOtpLine("no line here")).toBeUndefined();
  });
});

describe("the one field the code may go into", () => {
  const facts = (fields: Array<Partial<SignInFacts["fields"][number]>>): SignInFacts => ({
    password: false, frames: [], widget: false, fields: fields.map((f) => ({ autocomplete: "", name: "", label: "", inputmode: "", ...f })),
  });

  test("exactly one one-time code field: its index", () => {
    expect(codeFieldIndex(facts([{ name: "q", label: "Search" }, { autocomplete: "one-time-code" }]))).toBe(1);
    expect(codeFieldIndex(facts([{ label: "Código de verificación" }]))).toBe(0);
  });

  test("none, or several (one box per digit): no field, the user types it", () => {
    expect(codeFieldIndex(facts([{ name: "promo_code", label: "Discount code" }]))).toBeUndefined();
    expect(codeFieldIndex(facts([{ name: "otp-1" }, { name: "otp-2" }, { name: "otp-3" }]))).toBeUndefined();
  });

  test("the window is short and fixed: five minutes from the sign-in click", () => {
    expect(CODE_WINDOW_MS).toBe(5 * 60_000);
  });
});
