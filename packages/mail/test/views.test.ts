import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { MailCache, MailDrafts, mailAccountsView, mailDraftView, mailConnectErrorKey, mailDisconnectedKey, mailShownView, type MailConnectProblem } from "../src/index.ts";
import { gmailAccount, imapAccount, NOW, outlookAccount } from "./fixtures.ts";

const load = (name: string): Record<string, string> => JSON.parse(readFileSync(new URL(`../../copy/locales/${name}.json`, import.meta.url), "utf8"));
const en = load("en");
const es = load("es-419");
const hasCopy = (key: string) => {
  expect(en[key], key).toBeTruthy();
  expect(es[key], key).toBeTruthy();
};

describe("HM-MAIL-01 email accounts", () => {
  it("empty, then every account listed separately in the order connected, with the privacy line always", () => {
    const empty = mailAccountsView([]);
    expect(empty).toMatchObject({ state: "empty", emptyKey: "HM-MAIL-01.empty", rows: [] });
    const list = mailAccountsView([imapAccount, gmailAccount, outlookAccount]);
    expect(list.state).toBe("list");
    expect(list.rows.map((r) => [r.address, r.serviceKey, r.label])).toEqual([
      ["ana@gmail.com", "HM-MAIL-01.service.gmail", undefined],
      ["ana@contoso.com", "HM-MAIL-01.service.outlook", "work"],
      ["ana@fastmail.com", "HM-MAIL-01.service.imap", undefined],
    ]);
    for (const v of [empty, list]) for (const k of [v.titleKey, v.privacyKey, ...v.connectKeys, ...(v.emptyKey ? [v.emptyKey] : []), ...v.rows.map((r) => r.serviceKey)]) hasCopy(k);
    expect(en["HM-MAIL-01.privacy"]).toMatch(/straight between this phone/);
  });

  it("every connection problem and disconnect outcome has copy in both languages", () => {
    const problems: Array<MailConnectProblem | "needs_client_id"> = [
      "cancelled", "state_mismatch", "exchange_failed", "profile_failed", "missing_scopes", "expired", "invalid_address", "missing_password", "invalid_host", "invalid_port", "auth_failed", "unreachable", "needs_client_id",
    ];
    for (const p of problems) hasCopy(mailConnectErrorKey(p));
    for (const r of ["yes", "unsupported", "failed"] as const) for (const provider of ["gmail", "outlook", undefined] as const) hasCopy(mailDisconnectedKey(r, provider));
    // Microsoft can't revoke one app's tokens: the screen says where to remove access instead of "access deleted".
    expect(mailDisconnectedKey("unsupported", "outlook")).toBe("HM-MAIL-01.disconnectedMicrosoft");
    expect(mailDisconnectedKey("yes", "gmail")).toBe("HM-MAIL-01.disconnected");
    expect(mailDisconnectedKey("failed", "outlook")).toBe("HM-MAIL-01.disconnectedNotRevoked");
    for (const k of ["HM-MAIL-01.password", "HM-MAIL-01.passwordHelp", "HM-MAIL-01.browserNote", "HM-MAIL-01.disconnect", "HM-MAIL-01.signInAgain"]) hasCopy(k);
  });
});

describe("HM-MAIL-02 inbox summary and HM-MAIL-03 search results", () => {
  const item = (ref: string) => ({ ref, id: ref, accountId: "acc-g", from: "Avianca <noreply@avianca.com>", subject: "Vuelo", at: NOW, preview: "", unread: true });

  it("lists what the last mail_list showed, from the cache, never from the model's answer", () => {
    const cache = new MailCache();
    cache.remember("mail_list", [item("m1"), item("m2")]);
    const v = mailShownView(cache.shown(), "HM-MAIL-02", "es-419", "America/Costa_Rica");
    expect(v).toMatchObject({ state: "list", titleKey: "HM-MAIL-02.title", untrustedKey: "HM-MAIL-02.untrusted" });
    expect(v.rows.map((r) => r.ref)).toEqual(["m1", "m2"]);
    // A search result is not what a summary used.
    expect(mailShownView(cache.shown(), "HM-MAIL-03", "en", "UTC")).toMatchObject({ state: "empty", emptyKey: "HM-MAIL-03.empty" });
    for (const k of ["HM-MAIL-02.title", "HM-MAIL-02.empty", "HM-MAIL-02.untrusted", "HM-MAIL-02.unread", "HM-MAIL-03.title", "HM-MAIL-03.empty", "HM-MAIL-03.open"]) hasCopy(k);
  });

  it("disconnecting an account drops its messages from the screens (FR-MAIL-05)", () => {
    const cache = new MailCache();
    cache.remember("mail_search", [item("m1"), { ...item("m2"), accountId: "acc-o" }]);
    cache.clearAccount("acc-g");
    expect(mailShownView(cache.shown(), "HM-MAIL-03", "en", "UTC").rows.map((r) => r.ref)).toEqual(["m2"]);
  });
});

describe("HM-MAIL-04 draft and the send sheet's new-recipient flag (SL-49)", () => {
  it("every key the draft screen and the flag use has copy in both languages", () => {
    const d = new MailDrafts().add({ accountId: "acc-g", from: "ana@gmail.com", to: [], cc: [], subject: "", body: "x", savedAt: NOW });
    const v = mailDraftView(d);
    for (const key of [v.titleKey, v.savedKey!, ...v.fields.map((f) => f.labelKey), ...v.actions, "HM-MAIL-04.from", "HM-MAIL-04.empty", "HM-APPR-01.newRecipient"]) hasCopy(key);
    expect(es["HM-MAIL-04.saved"]).toBe("Guardado en tus borradores. No se envió nada.");
  });
});
