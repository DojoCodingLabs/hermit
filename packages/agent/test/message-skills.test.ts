/** read_messages output for WhatsApp Business (US-MSG-06) and hidden one-time codes (US-MSG-07). */
import { describe, expect, test } from "vitest";
import { nodeSql } from "@hermit/sql-node";
import { conversationId, createMessageStore, migrate, type CapturedNotification, type SessionState } from "@hermit/core";
import { messageSkills } from "../src/first-win-skills.ts";

const AT = Date.UTC(2026, 10, 12, 15, 0);
const note = (over: Partial<CapturedNotification>): CapturedNotification => ({
  packageName: "com.whatsapp", conversationKey: "c1", title: "Ana", sender: "Ana", text: "¿Ya vienes?",
  postedAt: AT, notificationKey: "k1", replyHandle: "h1", ...over,
});

async function read(notes: CapturedNotification[], contact?: string) {
  const sql = nodeSql();
  await migrate(sql);
  const store = createMessageStore(sql);
  await store.ingestMany(notes);
  const skill = messageSkills(store, { send: async () => "sent" }, { timeZone: "America/Costa_Rica", now: () => AT }).find((s) => s.def.id === "read_messages")!;
  return skill.execute(contact ? { contact } : {}, { session: {} as SessionState });
}

describe("read_messages", () => {
  test("names WhatsApp Business so the model can tell the person where a message came from, at the local time (W1)", async () => {
    const r = await read([
      note({}),
      note({ packageName: "com.whatsapp.w4b", conversationKey: "c2", title: "Taller Mora", sender: "Taller Mora", text: "Su carro está listo", postedAt: AT + 1, notificationKey: "k2" }),
    ]);
    const lines = r.modelText.split("\n");
    expect(lines[0]).toBe(`conversationId: ${conversationId("whatsapp", "c1")} | Thursday, November 12, 2026, 09:00 (today) | Ana: ¿Ya vienes?`);
    expect(lines[1]).toBe(`conversationId: ${conversationId("whatsapp_business", "c2")} | Thursday, November 12, 2026, 09:00 (today) | WhatsApp Business | Taller Mora: Su carro está listo`);
  });

  test("a hidden one-time code reaches the model as a marker, never as the code", async () => {
    const r = await read([note({ title: "Banco", sender: "Banco", text: "Tu código es 482913. No lo compartas." })]);
    expect(r.modelText).not.toContain("482913");
    expect(r.modelText).toContain("Banco: [one-time code hidden: Hermit never reads these codes]");
  });
});
