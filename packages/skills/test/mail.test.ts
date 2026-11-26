import { describe, expect, test } from "vitest";
import { firstWinSkills, mailSkillDefs, skillById } from "../src/catalog.ts";
import { normalizeMailList, normalizeMailRead, normalizeMailSearch } from "../src/normalize.ts";

const ctx = (userText: string) => ({ userText, now: Date.UTC(2026, 10, 14, 15), timeZone: "America/Costa_Rica" });
const render = { conversation: () => undefined };

describe("mail skills in the catalog (FR-MAIL-02, US-MAIL-02, US-MAIL-03, US-MAIL-08)", () => {
  test("mail_list, mail_search and mail_read are network reads whose output is untrusted", () => {
    expect(mailSkillDefs.map((s) => [s.id, s.risk, s.producesUntrusted])).toEqual([
      ["mail_list", "network", true],
      ["mail_search", "network", true],
      ["mail_read", "network", true],
    ]);
  });

  test("they are not on the first-win menu: the app adds them only once mail is wired", () => {
    expect(firstWinSkills.map((s) => s.id)).not.toContain("mail_list");
    expect(skillById("mail_list")?.id).toBe("mail_list");
  });

  test("lean schemas: closed objects, few arguments, every one optional or tiny, and menu lines in both languages", () => {
    for (const s of mailSkillDefs) {
      expect(s.args.type, s.id).toBe("object");
      expect(s.args.additionalProperties, s.id).toBe(false);
      expect(Object.keys(s.args.properties as object).length, s.id).toBeLessThanOrEqual(4);
      expect(s.menuLine.length, s.id).toBeLessThanOrEqual(300);
      expect(s.menuLine, s.id).toMatch(/correo/);
    }
  });

  test("every mail skill takes an optional account, except reading one message (its id already names it)", () => {
    for (const id of ["mail_list", "mail_search"]) {
      const a = skillById(id)!.args as { properties: Record<string, unknown>; required: string[] };
      expect(a.properties.account, id).toBeDefined();
      expect(a.required, id).not.toContain("account");
    }
    const read = skillById("mail_read")!.args as { properties: Record<string, { pattern?: string }>; required: string[] };
    expect(read.required).toEqual(["messageId"]);
    expect(new RegExp(read.properties.messageId!.pattern!).test("m12")).toBe(true);
    expect(new RegExp(read.properties.messageId!.pattern!).test("AAMkAGI2THVSAAA=")).toBe(false);
  });

  test("the approval sheet says which account and what is looked for, never more", () => {
    expect(skillById("mail_list")!.describeAction({}, render)).toEqual({ title: "Read email", lines: [{ label: "Account", labelKey: "account", value: "All connected accounts", valueKey: "allAccounts" }, { label: "Which", labelKey: "which", value: "Unread", valueKey: "unread" }] });
    expect(skillById("mail_list")!.describeAction({ account: "work", unreadOnly: false }, render).lines).toEqual([{ label: "Account", labelKey: "account", value: "work" }, { label: "Which", labelKey: "which", value: "Most recent", valueKey: "mostRecent" }]);
    expect(skillById("mail_search")!.describeAction({ query: "vuelo", from: "Avianca" }, render).lines).toEqual([
      { label: "Account", labelKey: "account", value: "All connected accounts", valueKey: "allAccounts" },
      { label: "Looking for", labelKey: "lookingFor", value: "vuelo" },
      { label: "From", labelKey: "from", value: "Avianca" },
    ]);
    expect(skillById("mail_read")!.describeAction({ messageId: "m3" }, render)).toEqual({ title: "Open an email", lines: [{ label: "Message", labelKey: "message", value: "m3" }] });
  });
});

describe("mail normalizers (from the user's own words)", () => {
  test("unread or recent, from what the user said", () => {
    expect(normalizeMailList({ unreadOnly: false }, ctx("¿tengo correos sin leer?")).args).toEqual({ unreadOnly: true });
    expect(normalizeMailList({ unreadOnly: true }, ctx("show my latest emails")).args).toEqual({ unreadOnly: false });
    expect(normalizeMailList({}, ctx("anything important in my email?")).args).toEqual({});
  });

  test("a count the user said becomes max, capped at 50", () => {
    expect(normalizeMailList({}, ctx("mis últimos 10 correos")).args).toEqual({ unreadOnly: false, max: 10 });
    expect(normalizeMailList({ max: 5 }, ctx("my last 200 emails")).args).toEqual({ unreadOnly: false, max: 50 });
  });

  test("an empty account means every account", () => {
    expect(normalizeMailList({ account: " " }, ctx("revisa mi correo")).args).toEqual({});
    expect(normalizeMailSearch({ query: "vuelo", account: "" }, ctx("busca el vuelo")).args).toEqual({ query: "vuelo" });
  });

  test("search words drop the word for email itself and the sender already in from", () => {
    expect(normalizeMailSearch({ query: "Avianca flight confirmation email", from: "Avianca" }, ctx("find the flight confirmation email from Avianca")).args).toEqual({ query: "flight confirmation", from: "Avianca" });
    expect(normalizeMailSearch({ query: "correo de la renta" }, ctx("busca el correo de la renta")).args).toEqual({ query: "renta" });
  });

  test("a bare number or a capital M becomes the short message id", () => {
    expect(normalizeMailRead({ messageId: "3" }).args).toEqual({ messageId: "m3" });
    expect(normalizeMailRead({ messageId: "M12" }).args).toEqual({ messageId: "m12" });
    expect(normalizeMailRead({ messageId: "m4" }).notes).toEqual([]);
  });
});
