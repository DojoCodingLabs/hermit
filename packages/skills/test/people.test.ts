import { describe, expect, test } from "vitest";
import { validateArgs, type FoundPerson, type MailRenderContext, type RenderContext } from "@hermit/core";
import { skillById } from "../src/catalog.ts";
import { intentSkillById } from "../src/intents.ts";

const def = (id: string) => intentSkillById(id) ?? skillById(id)!;

const gmail = { id: "acc-g", address: "me@gmail.com", name: "me@gmail.com" };
const mail: MailRenderContext = {
  sender: () => ({ ok: true, account: gmail }),
  account: (id) => (id === gmail.id ? gmail : undefined),
  message: (ref) => (ref === "m1" ? { ref, accountId: "acc-g", from: "Avianca <news@avianca.com>", subject: "Your trip" } : undefined),
  shown: () => ["m1"],
  known: (a) => a === "ana.lopez@example.com",
};
const withFound = (found: FoundPerson[]): RenderContext => ({ conversation: () => undefined, mail, found });

describe("skills that reach a person declare which argument a name may fill (PDR-028)", () => {
  test("WhatsApp, SMS and the dialer resolve a phone; email skills resolve an address; only sends need one", () => {
    expect(["open_whatsapp_chat", "compose_sms", "dial", "compose_email", "mail_send", "mail_forward", "mail_draft"].map((id) => [id, def(id).recipient])).toEqual([
      ["open_whatsapp_chat", { field: "phone", kind: "phone" }],
      ["compose_sms", { field: "phone", kind: "phone" }],
      ["dial", { field: "phone", kind: "phone" }],
      ["compose_email", { field: "to", kind: "email" }],
      ["mail_send", { field: "to", kind: "email", required: true }],
      ["mail_forward", { field: "to", kind: "email", required: true }],
      ["mail_draft", { field: "to", kind: "email" }],
    ]);
    // Saving a new contact, a reply (to the sender) and the rest never resolve anyone.
    for (const id of ["add_contact", "navigate", "share", "set_alarm", "mail_reply", "mail_modify"]) expect(def(id).recipient, id).toBeUndefined();
  });

  test("each of them takes the person's name in its own optional argument", () => {
    for (const id of ["open_whatsapp_chat", "compose_sms", "dial", "compose_email", "mail_send", "mail_forward", "mail_draft"]) {
      const props = def(id).args.properties as Record<string, { description: string }>;
      expect(props.person?.description, id).toMatch(/name/i);
      expect(def(id).args.required as string[], id).not.toContain("person");
    }
    expect(validateArgs({ person: "Mamá" }, def("dial").args)).toEqual([]);
  });
});

describe("the sheet shows the exact number or address and where it came from (invariant 4)", () => {
  test("a number from the contacts", () => {
    const found: FoundPerson[] = [{ field: "phone", kind: "phone", name: "Mamá", value: "+50688881234", sources: ["contacts"] }];
    expect(def("dial").describeAction({ phone: "+50688881234", person: "mamá" }, withFound(found)).lines).toEqual([
      { label: "Number", labelKey: "number", value: "+50688881234" },
      { label: "From your contacts", value: "Mamá", flag: "from_contacts" },
    ]);
    expect(def("open_whatsapp_chat").describeAction({ phone: "+50688881234", text: "Ya voy" }, withFound(found)).lines).toEqual([
      { label: "To", labelKey: "to", value: "+50688881234" },
      { label: "From your contacts", value: "Mamá", flag: "from_contacts" },
      { label: "Message", labelKey: "message", value: "Ya voy" },
    ]);
  });

  test("a line only for a value the sheet actually shows: a stale or different entry is never labeled", () => {
    const other: FoundPerson[] = [{ field: "phone", kind: "phone", name: "Mamá", value: "+50600000000", sources: ["contacts"] }];
    expect(def("dial").describeAction({ phone: "+50688881234" }, withFound(other)).lines).toEqual([{ label: "Number", labelKey: "number", value: "+50688881234" }]);
  });

  test("an address the user emailed before keeps the SL-49 flag rules and says so", () => {
    const found: FoundPerson[] = [{ field: "to", kind: "email", name: "Ana", value: "ana.lopez@example.com", sources: ["sent_mail"] }];
    const s = def("mail_forward").describeAction({ messageId: "m1", to: "ana.lopez@example.com", person: "Ana" }, withFound(found));
    expect(s.lines).toEqual([
      { label: "From", labelKey: "from", value: "me@gmail.com" },
      { label: "To", labelKey: "to", value: "ana.lopez@example.com" },
      { label: "You emailed before", value: "ana.lopez@example.com", flag: "emailed_before" },
      { label: "Subject", labelKey: "subject", value: "Fwd: Your trip" },
      { label: "Forwarding", labelKey: "forwarding", value: "news@avianca.com: Your trip" },
    ]);
    // The binding is the same with or without the label: the executor re-renders without it.
    expect(s.binding).toBe(def("mail_forward").describeAction({ messageId: "m1", to: "ana.lopez@example.com", person: "Ana" }, { conversation: () => undefined, mail }).binding);
  });

  test("an address from the contacts that the user never emailed is still a new recipient", () => {
    const found: FoundPerson[] = [{ field: "to", kind: "email", name: "Carlos Rojas", value: "crojas@example.org", sources: ["contacts"] }];
    const s = def("mail_send").describeAction({ to: "crojas@example.org", subject: "Hola", body: "Nos vemos" }, withFound(found));
    expect(s.lines).toEqual([
      { label: "From", labelKey: "from", value: "me@gmail.com" },
      { label: "To", labelKey: "to", value: "crojas@example.org" },
      { label: "New recipient", labelKey: "newRecipient", value: "crojas@example.org", flag: "new_recipient" },
      { label: "From your contacts", value: "Carlos Rojas", flag: "from_contacts" },
      { label: "Subject", labelKey: "subject", value: "Hola" },
      { label: "Message", labelKey: "message", value: "Nos vemos" },
    ]);
  });

  test("both sources: the contact's name and that the user emailed it before", () => {
    const found: FoundPerson[] = [{ field: "to", kind: "email", name: "Ana López", value: "ana.lopez@example.com", sources: ["contacts", "sent_mail"] }];
    expect(def("compose_email").describeAction({ to: "ana.lopez@example.com", body: "Hola" }, withFound(found)).lines).toEqual([
      { label: "To", labelKey: "to", value: "ana.lopez@example.com" },
      { label: "From your contacts", value: "Ana López", flag: "from_contacts" },
      { label: "You emailed before", value: "ana.lopez@example.com", flag: "emailed_before" },
      { label: "Message", labelKey: "message", value: "Hola" },
    ]);
  });
});
