import { describe, expect, it } from "vitest";
import { AUTHSERV_IDS, lexAuthResults, mailAuthVerdict } from "../src/mail-auth.ts";

// SL-56b security review: a From header can be forged, so an email gives a web task its code only when the receiving
// provider says it checked the sender. Read by an RFC 8601-aware lexer from the topmost Authentication-Results header
// only (the one the provider adds on top of anything the sender wrote), with the provider's own authserv-id. Only
// Gmail's is known (Q141): Outlook and IMAP mail are never verified until checked on a real message.

const GMAIL = AUTHSERV_IDS.gmail;
const site = { domain: "example.com", fromDomain: "mail.example.com" };
const verdict = (headers: string[], over: Partial<{ authservId: string | undefined; domain: string; fromDomain: string }> = {}) =>
  mailAuthVerdict(headers, { authservId: GMAIL, ...site, ...over });

describe("the lexer (RFC 8601)", () => {
  it("splits on ';' and whitespace only outside quoted strings and comments; a quoted string is one value", () => {
    expect(lexAuthResults('mx.google.com; dkim=pass (a; b "c") header.d="ex ample;com"; spf=none')).toEqual([
      ["mx.google.com"], ["dkim=pass", "header.d=ex ample;com"], ["spf=none"],
    ]);
  });

  it("folded lines are whitespace", () => {
    expect(lexAuthResults("mx.google.com;\r\n\tdmarc=pass\r\n  header.from=example.com")).toEqual([["mx.google.com"], ["dmarc=pass", "header.from=example.com"]]);
  });

  it.each(['mx.google.com; dkim=pass header.d="example.com', "mx.google.com; dkim=pass (unclosed", "mx.google.com; dkim=pass )"])("a stray quote or parenthesis is no header: %s", (h) => {
    expect(lexAuthResults(h)).toBeUndefined();
  });
});

describe("the provider's verdict (fails closed)", () => {
  it("Gmail's DMARC pass for the site's domain", () => {
    const h = "mx.google.com;\r\n       dkim=pass header.i=@mail.example.com header.s=s1 header.b=AbC;\r\n       spf=pass (google.com: domain of bounce@mail.example.com designates 1.2.3.4 as permitted sender) smtp.mailfrom=bounce@mail.example.com;\r\n       dmarc=pass (p=REJECT sp=REJECT dis=NONE) header.from=mail.example.com";
    expect(verdict([h])).toBe("dmarc");
  });

  it("a quoted value counts as the value", () => {
    expect(verdict(['mx.google.com; dmarc=pass header.from="example.com"'])).toBe("dmarc");
  });

  it("no DMARC, but a DKIM pass signed by the site's registrable domain", () => {
    expect(verdict(["mx.google.com; dkim=pass header.d=example.com header.s=k; spf=neutral"])).toBe("dkim");
    expect(verdict(["mx.google.com; dkim=pass header.i=@news.example.com"])).toBe("dkim");
  });

  it.each([
    ["no header", []],
    ["DMARC failed", ["mx.google.com; dkim=pass header.d=example.com; dmarc=fail header.from=example.com"]],
    ["DMARC pass for another domain", ["mx.google.com; dmarc=pass header.from=evil.example"]],
    ["DKIM pass by another domain only", ["mx.google.com; dkim=pass header.d=evil.example; spf=pass smtp.mailfrom=example.com"]],
    ["SPF alone", ["mx.google.com; spf=pass smtp.mailfrom=bounce@example.com"]],
    ["another authserv-id on top (written by the sender)", ["evil.example; dmarc=pass header.from=example.com"]],
    ["the provider's verdict only below one the sender wrote", ["evil.example; dmarc=pass header.from=example.com", "mx.google.com; dmarc=pass header.from=example.com"]],
    ["a duplicate DMARC result, fail then pass", ["mx.google.com; dmarc=fail header.from=example.com; dmarc=pass header.from=example.com"]],
    ["a duplicate DMARC result, pass then fail", ["mx.google.com; dmarc=pass header.from=example.com; dmarc=fail header.from=example.com"]],
    ["a duplicate DKIM result", ["mx.google.com; dkim=fail header.d=example.com; dkim=pass header.d=example.com"]],
    ["a pass hidden in a comment", ["mx.google.com; dmarc=fail (dmarc=pass header.from=example.com) header.from=example.com"]],
    ["a quoted ';' that hides a second result", ['mx.google.com; dkim=fail header.d="x; dmarc=pass header.from=example.com"']],
    ["a method name inside a property value", ["mx.google.com; dkim=pass header.d=dmarc=pass"]],
    ["a bare word in a result", ["mx.google.com; dmarc=pass sure header.from=example.com"]],
    ["a stray quote", ['mx.google.com; dmarc=pass header.from="example.com']],
    ["garbage", ["mx.google.com; ;;; ==="]],
    ["no authserv-id (the Microsoft style) for Gmail", ["dmarc=pass header.from=example.com"]],
  ])("not verified: %s", (_label, headers) => {
    expect(verdict(headers as string[])).toBeUndefined();
  });

  it("the From domain itself must be the site's, whatever the header says", () => {
    expect(verdict(["mx.google.com; dmarc=pass header.from=example.com"], { fromDomain: "evil.example" })).toBeUndefined();
  });

  it("Outlook and IMAP: no receiving authserv-id Hermit has checked, so never verified (Q141: Gmail only until checked)", () => {
    expect(AUTHSERV_IDS.outlook).toBeUndefined();
    expect(AUTHSERV_IDS.imap).toBeUndefined();
    const ms = "spf=pass (sender IP is 1.2.3.4) smtp.mailfrom=example.com; dkim=pass (signature was verified) header.d=example.com;dmarc=pass action=none header.from=example.com;compauth=pass reason=100";
    expect(verdict([ms], { authservId: AUTHSERV_IDS.outlook })).toBeUndefined();
  });
});
