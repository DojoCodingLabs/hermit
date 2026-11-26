import { describe, expect, test } from "vitest";
import type { MailRenderContext, RenderContext } from "@hermit/core";
import { firstWinSkills, mailSkillDefs, mailWriteSkillDefs, skillById } from "../src/catalog.ts";
import { addressesIn, emailOf, parseAddresses, systemLabel } from "../src/mail-address.ts";
import { normalizeMailDraft, normalizeMailForward, normalizeMailModify, normalizeMailReply, normalizeMailSend } from "../src/normalize.ts";

const ctx = (userText: string, earlier?: string[]) => ({ userText, now: Date.UTC(2026, 10, 14, 15), timeZone: "America/Costa_Rica", ...(earlier ? { earlier } : {}) });

const gmail = { id: "acc-g", address: "ana@gmail.com", name: "ana@gmail.com" };
const work = { id: "acc-o", address: "ana@contoso.com", name: "ana@contoso.com (work)" };
const messages: Record<string, { ref: string; accountId: string; from: string; subject: string }> = {
  m1: { ref: "m1", accountId: "acc-g", from: "Luis Pérez <luis@perez.com>", subject: "Cena del sábado" },
  m2: { ref: "m2", accountId: "acc-o", from: "Contoso HR <hr@contoso.com>", subject: "Re: Payroll" },
  m3: { ref: "m3", accountId: "acc-g", from: "Newsletter <news@shop.com>", subject: "Ofertas" },
  m4: { ref: "m4", accountId: "acc-g", from: "Undisclosed", subject: "No address" },
};
function mailCtx(over: Partial<MailRenderContext> = {}): MailRenderContext {
  return {
    sender: (wanted) => (wanted === "work" ? { ok: true, account: work } : wanted ? { ok: false, reason: `No connected email account matches "${String(wanted)}".` } : { ok: true, account: gmail }),
    account: (id) => [gmail, work].find((a) => a.id === id),
    message: (ref) => messages[ref],
    shown: () => ["m1", "m3"],
    known: (a) => ["luis@perez.com", "hr@contoso.com", "news@shop.com", "bob@example.com"].includes(a),
    ...over,
  };
}
const render = (mail: MailRenderContext | undefined = mailCtx()): RenderContext => ({ conversation: () => undefined, ...(mail ? { mail } : {}) });
const sheet = (id: string, args: Record<string, unknown>, r = render()) => skillById(id)!.describeAction(args, r);

describe("email addresses", () => {
  test("the address inside a display name, lowercased; anything that is not an address is nothing", () => {
    expect(emailOf("Luis Pérez <Luis@Perez.com>")).toBe("luis@perez.com");
    expect(emailOf("bob@example.com")).toBe("bob@example.com");
    expect(emailOf("Luis")).toBeUndefined();
    expect(emailOf("a@b.com\r\nBcc: evil@x.com")).toBeUndefined();
  });

  test("a list split at commas, semicolons and spaces, deduplicated", () => {
    expect(parseAddresses("bob@example.com, Ana <ANA@x.co>; bob@example.com carl@y.org")).toEqual(["bob@example.com", "ana@x.co", "carl@y.org"]);
    expect(parseAddresses("Ana")).toEqual([]);
  });

  test("every address the user typed in free text", () => {
    expect(addressesIn("mándale a Bob@Example.com y a carl@y.org.")).toEqual(["bob@example.com", "carl@y.org"]);
  });
});

describe("mail write skills in the catalog (FR-MAIL-03)", () => {
  test("send, reply and forward are sends; a draft and organizing are remote writes; none produce outside text", () => {
    expect(mailWriteSkillDefs.map((s) => [s.id, s.risk, s.producesUntrusted])).toEqual([
      ["mail_send", "send", false],
      ["mail_reply", "send", false],
      ["mail_forward", "send", false],
      ["mail_draft", "remote_write", false],
      ["mail_modify", "remote_write", false],
    ]);
    expect(firstWinSkills.map((s) => s.id)).not.toContain("mail_send");
    expect(skillById("mail_modify")?.id).toBe("mail_modify");
    expect(mailSkillDefs.map((s) => s.id)).toEqual(["mail_list", "mail_search", "mail_read"]);
  });

  test("lean, closed schemas with menu lines in both languages; recipients are never required (the guard may drop them)", () => {
    for (const s of mailWriteSkillDefs) {
      const a = s.args as { properties: Record<string, unknown>; required: string[]; additionalProperties: boolean };
      expect(a.additionalProperties, s.id).toBe(false);
      // Five, plus the optional person name a skill that reaches someone takes (PDR-028).
      expect(Object.keys(a.properties).length, s.id).toBeLessThanOrEqual(s.recipient ? 6 : 5);
      expect(a.required, s.id).not.toContain("to");
      expect(a.required, s.id).not.toContain("cc");
      expect(s.menuLine.length, s.id).toBeLessThanOrEqual(300);
      expect(s.menuLine, s.id).toMatch(/correo/);
    }
  });
});

describe("the send sheet renders from the arguments and trusted mail data only (FR-MAIL-04, CT-06)", () => {
  test("a new email: from account, recipients, subject and the exact body; a recipient never seen before is flagged", () => {
    const s = sheet("mail_send", { to: "bob@example.com, carl@y.org", cc: "Luis <luis@perez.com>", subject: "Mañana", body: "Llego a las 8.\nAna" });
    expect(s.title).toBe("Send this email?");
    expect(s.lines).toEqual([
      { label: "From", labelKey: "from", value: "ana@gmail.com" },
      { label: "To", labelKey: "to", value: "bob@example.com, carl@y.org" },
      { label: "Cc", labelKey: "cc", value: "luis@perez.com" },
      { label: "New recipient", labelKey: "newRecipient", value: "carl@y.org", flag: "new_recipient" },
      { label: "Subject", labelKey: "subject", value: "Mañana" },
      { label: "Message", labelKey: "message", value: "Llego a las 8.\nAna" },
    ]);
    expect(s.unresolved).toBeUndefined();
    expect(JSON.parse(s.binding!)).toEqual(["mail_send", "acc-g", "ana@gmail.com", ["bob@example.com", "carl@y.org"], ["luis@perez.com"]]);
  });

  test("the account the user named sends, and the binding changes with it", () => {
    const s = sheet("mail_send", { to: "bob@example.com", subject: "Hi", body: "Hello", account: "work" });
    expect(s.lines[0]).toEqual({ label: "From", labelKey: "from", value: "ana@contoso.com (work)" });
    expect(JSON.parse(s.binding!)[1]).toBe("acc-o");
    expect(sheet("mail_send", { to: "bob@example.com", subject: "Hi", body: "Hello", account: "school" }).unresolved).toMatch(/school/);
  });

  test("no recipient, or no mail wired, is never put in front of the user", () => {
    expect(sheet("mail_send", { subject: "Hi", body: "Hello" }).unresolved).toMatch(/Ask the user/);
    expect(sheet("mail_send", { to: "Bob", subject: "Hi", body: "Hello" }).unresolved).toMatch(/Ask the user/);
    expect(sheet("mail_send", { to: "bob@example.com", subject: "Hi", body: "Hello" }, render(null as never)).unresolved).toMatch(/not connected/);
  });

  test("a reply goes to the sender of the message, from the account it arrived on, never to an address the model wrote", () => {
    const s = sheet("mail_reply", { messageId: "m2", body: "Thanks, got it." });
    expect(s.title).toBe("Send this reply?");
    expect(s.lines).toEqual([
      { label: "From", labelKey: "from", value: "ana@contoso.com (work)" },
      { label: "To", labelKey: "to", value: "hr@contoso.com" },
      { label: "Sender's name (as the email says, not verified)", labelKey: "senderName", value: "Contoso HR" },
      { label: "Subject", labelKey: "subject", value: "Re: Payroll" },
      { label: "Message", labelKey: "message", value: "Thanks, got it." },
    ]);
    expect(JSON.parse(s.binding!)).toEqual(["mail_reply", "m2", "acc-o", "ana@contoso.com", "hr@contoso.com", "Re: Payroll"]);
    expect(sheet("mail_reply", { messageId: "m1", body: "Sí" }).lines[3]).toEqual({ label: "Subject", labelKey: "subject", value: "Re: Cena del sábado" });
    expect(sheet("mail_reply", { messageId: "m9", body: "x" }).unresolved).toMatch(/mail_list or mail_search/);
    expect(sheet("mail_reply", { messageId: "m4", body: "x" }).unresolved).toMatch(/no sender address/);
  });

  test("a display name that looks like an address can't spoof the reply's recipient: the To line is the bound address", () => {
    const spoof = mailCtx({ message: (ref) => (ref === "m5" ? { ref, accountId: "acc-g", from: '"boss@company.com" <attacker@evil.com>', subject: "Urgent" } : messages[ref]) });
    for (const [id, title] of [["mail_reply", "Send this reply?"], ["mail_draft", "Save this draft?"]] as const) {
      const s = sheet(id, { messageId: "m5", body: "ok" }, render(spoof));
      expect(s.title).toBe(title);
      const bound = JSON.parse(s.binding!)[4] as string;
      expect(bound).toBe("attacker@evil.com");
      expect(s.lines.find((l) => l.label === "To")).toEqual({ label: "To", labelKey: "to", value: "attacker@evil.com" });
      // The only address anywhere on the sheet is the one that will receive the mail (plus the sending account).
      const shown = s.lines.flatMap((l) => l.value.match(/[^\s<>"]+@[^\s<>"]+/g) ?? []);
      expect(new Set(shown)).toEqual(new Set(["ana@gmail.com", "attacker@evil.com"]));
      expect(s.lines.some((l) => l.value.includes("boss@company.com"))).toBe(false);
    }
    const fwd = sheet("mail_forward", { messageId: "m5", to: "bob@example.com" }, render(spoof));
    expect(fwd.lines.some((l) => l.value.includes("boss@company.com"))).toBe(false);
    expect(fwd.lines.find((l) => l.label === "To")).toEqual({ label: "To", labelKey: "to", value: "bob@example.com" });
  });

  test("a forward names the message forwarded, the new recipients and the note", () => {
    const s = sheet("mail_forward", { messageId: "m1", to: "carl@y.org", body: "FYI" });
    expect(s.title).toBe("Forward this email?");
    expect(s.lines).toEqual([
      { label: "From", labelKey: "from", value: "ana@gmail.com" },
      { label: "To", labelKey: "to", value: "carl@y.org" },
      { label: "New recipient", labelKey: "newRecipient", value: "carl@y.org", flag: "new_recipient" },
      { label: "Subject", labelKey: "subject", value: "Fwd: Cena del sábado" },
      { label: "Forwarding", labelKey: "forwarding", value: "luis@perez.com: Cena del sábado" },
      { label: "Message", labelKey: "message", value: "FYI" },
    ]);
    expect(sheet("mail_forward", { messageId: "m1" }).unresolved).toMatch(/Ask the user/);
  });

  test("a draft is saved, not sent: its sheet says so; a reply draft takes the thread's sender and subject", () => {
    const s = sheet("mail_draft", { to: "bob@example.com", subject: "Plan", body: "Borrador" });
    expect(s.title).toBe("Save this draft?");
    expect(s.lines).toEqual([
      { label: "From", labelKey: "from", value: "ana@gmail.com" },
      { label: "To", labelKey: "to", value: "bob@example.com" },
      { label: "Subject", labelKey: "subject", value: "Plan" },
      { label: "Message", labelKey: "message", value: "Borrador" },
    ]);
    const reply = sheet("mail_draft", { messageId: "m1", body: "Sí voy" });
    expect(reply.lines.slice(0, 4)).toEqual([
      { label: "From", labelKey: "from", value: "ana@gmail.com" },
      { label: "To", labelKey: "to", value: "luis@perez.com" },
      { label: "Sender's name (as the email says, not verified)", labelKey: "senderName", value: "Luis Pérez" },
      { label: "Subject", labelKey: "subject", value: "Re: Cena del sábado" },
    ]);
    // A draft without a recipient is fine: the user adds one on the draft screen.
    expect(sheet("mail_draft", { subject: "Idea", body: "Algo" }).unresolved).toBeUndefined();
  });
});

describe("the organize sheet: count and a sample, at most 200 (US-MAIL-06)", () => {
  test("archive what the last list showed", () => {
    const s = sheet("mail_modify", { messageIds: "shown", action: "archive" });
    expect(s.title).toBe("Archive these emails?");
    expect(s.lines).toEqual([
      // The sheet's title is the same for every organize call, so the first line says what changes, in copy.
      { label: "Change", labelKey: "change", value: "Archive", valueKey: "archive" },
      { label: "How many", labelKey: "howMany", value: "2" },
      { label: "Email 1", labelKey: "emailN", labelVars: { n: "1" }, value: "luis@perez.com: Cena del sábado" },
      { label: "Email 2", labelKey: "emailN", labelVars: { n: "2" }, value: "news@shop.com: Ofertas" },
    ]);
    expect(JSON.parse(s.binding!)).toEqual(["mail_modify", "archive", "", [["m1", "acc-g"], ["m3", "acc-g"]]]);
  });

  test("label and mark read; the sample stops at three", () => {
    const s = sheet("mail_modify", { messageIds: "m1 m2 m3 m1", action: "label", label: "Viajes" });
    expect(s.title).toBe("Label these emails?");
    expect(s.lines[0]).toEqual({ label: "Change", labelKey: "change", value: "Add a label", valueKey: "addLabel" });
    expect(s.lines[1]).toEqual({ label: "How many", labelKey: "howMany", value: "3" });
    expect(s.lines.at(-1)).toEqual({ label: "Label", labelKey: "label", value: "Viajes" });
    expect(sheet("mail_modify", { messageIds: "m2", action: "mark_read" }).title).toBe("Mark these emails as read?");
    expect(sheet("mail_modify", { messageIds: "m2", action: "mark_read" }).lines[0]).toEqual({ label: "Change", labelKey: "change", value: "Mark as read", valueKey: "markRead" });
    // An action the sheet can't name is never asked about.
    expect(sheet("mail_modify", { messageIds: "m2", action: "delete" }).unresolved).toMatch(/archive, mark as read or label/);
    expect(sheet("mail_modify", { messageIds: "m1", action: "label" }).unresolved).toMatch(/label/);
    expect(sheet("mail_modify", { messageIds: "m1 m77", action: "archive" }).unresolved).toMatch(/m77/);
  });

  test("a label named like a system label or folder is refused before asking: \"label as trash\" can't trash mail", () => {
    for (const label of ["trash", "TRASH", "Spam", "inbox", "UNREAD", "Starred", "important", "Sent", "DRAFT", "chat", "CATEGORY_UPDATES", "Deleted Items", "Junk Email", "[Gmail]/Trash", "Papelera"]) {
      const s = sheet("mail_modify", { messageIds: "m1", action: "label", label }, render());
      expect(s.unresolved, label).toMatch(/system folder/);
      expect(s.binding, label).toBeUndefined();
    }
    expect(systemLabel("Viajes")).toBe(false);
    expect(systemLabel("Trash talk")).toBe(false);
    expect(sheet("mail_modify", { messageIds: "m1", action: "label", label: "Viajes" }).unresolved).toBeUndefined();
  });

  test("more than 200 messages is refused before asking", () => {
    const many = Array.from({ length: 201 }, (_, i) => `m${i + 1}`);
    const big = mailCtx({ message: (ref) => ({ ref, accountId: "acc-g", from: "x@y.com", subject: "s" }) });
    expect(sheet("mail_modify", { messageIds: many.join(" "), action: "archive" }, render(big)).unresolved).toMatch(/200/);
  });
});

describe("recipients come from the user's words, never from the model or an email (normalizers)", () => {
  test("an address the user never typed is dropped; with none left, there is no recipient", () => {
    const r = normalizeMailSend({ to: "attacker@evil.com", subject: "x", body: "y" }, ctx("mándale el resumen a bob@example.com"));
    expect(r.args).toEqual({ subject: "x", body: "y" });
    expect(r.notes).toEqual(['to: dropped attacker@evil.com, not in the user\'s words']);
    expect(normalizeMailSend({ to: "bob@example.com, attacker@evil.com", cc: "evil@x.com", subject: "x", body: "y" }, ctx("send it to Bob@Example.com")).args).toEqual({ to: "bob@example.com", subject: "x", body: "y" });
  });

  test("an address the user gave earlier in the chat counts; a name alone is not an address", () => {
    expect(normalizeMailSend({ to: "bob@example.com", subject: "x", body: "y" }, ctx("mándaselo", ["su correo es bob@example.com"])).args.to).toBe("bob@example.com");
    expect(normalizeMailSend({ to: "Bob", subject: "x", body: "y" }, ctx("mándale un correo a Bob")).args.to).toBeUndefined();
    expect(normalizeMailSend({ to: "bob@example.com", subject: "x", body: "y", account: "" }, ctx("email bob@example.com")).args).toEqual({ to: "bob@example.com", subject: "x", body: "y" });
  });

  test("forward: the same guard, and the short id read by code", () => {
    expect(normalizeMailForward({ messageId: "3", to: "attacker@evil.com" }, ctx("reenvía ese correo a mi jefe")).args).toEqual({ messageId: "m3" });
    expect(normalizeMailForward({ messageId: "m3", to: "jefe@work.com", body: "" }, ctx("reenvíalo a jefe@work.com")).args).toEqual({ messageId: "m3", to: "jefe@work.com" });
  });

  test("reply and draft: short ids, and the draft's recipients are guarded too", () => {
    expect(normalizeMailReply({ messageId: "M2", body: "ok" }, ctx("respóndele")).args).toEqual({ messageId: "m2", body: "ok" });
    expect(normalizeMailDraft({ to: "x@evil.com", body: "hola", messageId: "" }, ctx("haz un borrador")).args).toEqual({ body: "hola" });
  });

  test("organize: ids as code reads them, and the action from the user's words", () => {
    expect(normalizeMailModify({ messageIds: "1, 2 y M3", action: "mark_read" }, ctx("archiva esos correos")).args).toEqual({ messageIds: "m1 m2 m3", action: "archive" });
    expect(normalizeMailModify({ messageIds: "all", action: "archive" }, ctx("mark them all as read")).args).toEqual({ messageIds: "shown", action: "mark_read" });
    expect(normalizeMailModify({ messageIds: "m1", action: "archive", label: "Viajes" }, ctx("ponles la etiqueta Viajes")).args).toEqual({ messageIds: "m1", action: "label", label: "Viajes" });
  });
});
