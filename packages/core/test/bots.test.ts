import { expect, test } from "vitest";
import {
  FINGERPRINT_GROUPS, HERMIT_BOT_ID, MAX_BOT_NAME_CHARS, MAX_BOTS, MAX_PINS, MAX_ROLE_CHARS, PRIVATE_GROUPS, SKILL_GROUPS,
  heldGroups, needsFingerprint, normalizeSite, readKind, tierOf,
} from "../src/bots.ts";

test("the contract's values", () => {
  expect([HERMIT_BOT_ID, MAX_BOTS, MAX_PINS, MAX_BOT_NAME_CHARS, MAX_ROLE_CHARS]).toEqual(["hermit", 50, 2, 40, 800]);
  expect(SKILL_GROUPS).toHaveLength(13);
  expect(FINGERPRINT_GROUPS).toEqual(["vault_logins", "mail_send", "wallet_pay"]);
  expect(PRIVATE_GROUPS).toEqual(["messages_read", "mail_read", "calendar", "contacts"]);
});
test("a skill without a tier is high", () => {
  expect(tierOf({})).toBe("high");
  expect(tierOf({ tier: "low" })).toBe("low");
});
test("private groups read private data; the web and every connector or MCP source read the web", () => {
  expect(readKind("mail_read", undefined)).toBe("private");
  expect(readKind("web_read", undefined)).toBe("web");
  expect(readKind("web_tasks", undefined)).toBe("web");
  expect(readKind(undefined, "conn_meta_ads")).toBe("web");
  expect(readKind("notes", undefined)).toBeUndefined();
});
test("the primary bot holds every group", () => {
  expect(heldGroups({ primary: true, grants: [] })).toEqual(SKILL_GROUPS);
  expect(heldGroups({ primary: false, grants: ["notes"] })).toEqual(["notes"]);
});
test("sites are registrable domains", () => {
  expect(normalizeSite("https://www.Wikivoyage.org/search?q=1")).toBe("wikivoyage.org");
  expect(normalizeSite("wikivoyage.org")).toBe("wikivoyage.org");
  expect(normalizeSite("192.168.0.1")).toBeUndefined();
});
test("the fingerprint for a newly held mail send, login or pay group, or for Don't ask", () => {
  expect(needsFingerprint({ grants: ["mail_read"], mode: "ask" })).toBe(false);
  expect(needsFingerprint({ grants: ["mail_read", "mail_send"], mode: "ask" })).toBe(true);
  expect(needsFingerprint({ grants: ["mail_send", "notes"], mode: "ask" }, { grants: ["mail_send"], mode: "ask" })).toBe(false);
  expect(needsFingerprint({ grants: ["notes"], mode: "dont_ask" }, { grants: ["notes"], mode: "auto" })).toBe(true);
  expect(needsFingerprint({ grants: ["notes"], mode: "dont_ask" }, { grants: ["notes"], mode: "dont_ask" })).toBe(false);
});
