import { describe, expect, test } from "vitest";
import { asSignInFacts, checkSignIn, type SignInFacts } from "../src/web-login.ts";

const facts = (over: Partial<SignInFacts> = {}): SignInFacts => ({ password: false, fields: [], frames: [], widget: false, ...over });
const field = (over: Partial<SignInFacts["fields"][number]> = {}) => ({ autocomplete: "", name: "", label: "", inputmode: "", ...over });

describe("after the sign-in click, code reads what the page shows (SL-56)", () => {
  test("no password field, no code, no captcha: signed in", () => {
    expect(checkSignIn(facts({ fields: [field({ name: "q", label: "Search" })] }))).toBe("signed_in");
  });

  test("the password field is still there: the site refused the sign-in, never reported as done", () => {
    expect(checkSignIn(facts({ password: true }))).toBe("rejected");
  });

  test.each([
    field({ autocomplete: "one-time-code" }),
    field({ name: "otp" }),
    field({ name: "totp_code" }),
    field({ label: "Verification code" }),
    field({ label: "Enter the 6-digit security code" }),
    field({ name: "two_factor_code" }),
    field({ label: "2FA code" }),
    field({ label: "Código de verificación" }),
    field({ label: "Ingresa el codigo que te enviamos" }),
    field({ name: "mfa" }),
  ])("a one-time code field is a code to type, which the user does: %o", (f) => {
    expect(checkSignIn(facts({ fields: [f] }))).toBe("code");
  });

  test.each([
    "https://www.google.com/recaptcha/api2/anchor?k=abc",
    "https://www.recaptcha.net/recaptcha/api2/anchor",
    "https://newassets.hcaptcha.com/captcha/v1/abc/static/hcaptcha.html",
    "https://challenges.cloudflare.com/cdn-cgi/challenge-platform/turnstile",
    "https://client-api.arkoselabs.com/fc/gc/",
    "https://WWW.Google.com:443/recaptcha/api2/bframe?k=abc",
  ])("a captcha frame is the user's to solve: %s", (src) => {
    expect(checkSignIn(facts({ frames: [src] }))).toBe("captcha");
  });

  test("a captcha widget marker on the page is a captcha too", () => {
    expect(checkSignIn(facts({ widget: true }))).toBe("captcha");
  });

  test("a captcha or a code wins over a visible password: the user acts on the live page first", () => {
    expect(checkSignIn(facts({ password: true, widget: true }))).toBe("captcha");
    expect(checkSignIn(facts({ password: true, fields: [field({ autocomplete: "one-time-code" })] }))).toBe("code");
  });

  test("lookalike frames and ordinary fields are not challenges", () => {
    expect(checkSignIn(facts({ frames: ["https://www.google.com/maps/embed", "https://recaptcha.example.com/", "https://evilhcaptcha.com/x", "not a url"] }))).toBe("signed_in");
    // Parsed by hand (no URL in core): user info, a lookalike suffix or a plain http frame is no captcha frame.
    expect(checkSignIn(facts({ frames: ["https://www.google.com@evil.example/recaptcha/", "https://www.google.com.evil.example/recaptcha/", "https://hcaptcha.com.evil.example/", "http://www.google.com/recaptcha/api2/anchor"] }))).toBe("signed_in");
    expect(checkSignIn(facts({ fields: [field({ name: "postal_code", label: "Postal code" }), field({ name: "promo", label: "Discount code" })] }))).toBe("signed_in");
  });
});

describe("the page's report is checked field by field (fail closed)", () => {
  test("a well-formed report is kept, cut to its bounds", () => {
    const got = asSignInFacts({
      password: false,
      fields: Array.from({ length: 50 }, () => ({ autocomplete: "", name: "x", label: "y", inputmode: "" })),
      frames: ["https://a.example/"],
      widget: false,
    });
    expect(got?.fields).toHaveLength(30);
    expect(got?.frames).toEqual(["https://a.example/"]);
  });

  test.each([undefined, null, "signed in", { password: "no" }, { password: false, fields: "x", frames: [], widget: false }, { password: false, fields: [], frames: [1], widget: false }])(
    "anything else is no report: %o",
    (raw) => {
      expect(asSignInFacts(raw)).toBeUndefined();
    },
  );

  test("a field with an unreadable part is read as empty strings, never dropped (dropping could hide a code field)", () => {
    const got = asSignInFacts({ password: false, fields: [{ autocomplete: 5, name: "otp", label: "x".repeat(500), inputmode: null }], frames: [], widget: false });
    expect(got?.fields).toEqual([{ autocomplete: "", name: "otp", label: "x".repeat(200), inputmode: "" }]);
    expect(checkSignIn(got!)).toBe("code");
  });
});
