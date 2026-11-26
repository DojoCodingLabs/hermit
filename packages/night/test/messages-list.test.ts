import { describe, expect, test } from "vitest";
import { runNightShift } from "../src/index.ts";
import { at, settings, world } from "./helpers.ts";

describe("the messages job's list comes from the read's own records (W1 review 5)", () => {
  test("a colon in a name and WhatsApp Business no longer corrupt who wrote; newest first", async () => {
    const w = await world();
    await w.messages.ingest({ packageName: "com.whatsapp", conversationKey: "dra", title: "Dra. Morales: consultorio", sender: "Dra. Morales: consultorio", text: "Su cita es el lunes", postedAt: at(1), notificationKey: "k2", replyHandle: "h2" });
    await w.messages.ingest({ packageName: "com.whatsapp.w4b", conversationKey: "taller", title: "Taller Mora", sender: "Taller Mora", text: "Su carro está listo", postedAt: at(1, 30), notificationKey: "k3", replyHandle: "h3" });
    // No summary from the reader: the list is the whole answer.
    const b = (await runNightShift(settings({ jobs: ["messages"] }), w.deps({ reader: async () => { throw new Error("no reader"); } })))!;
    expect(b.sections.find((s) => s.job === "messages")!.summary).toBe(
      "Tienes mensajes de 3 conversaciones:\n• Taller Mora (WhatsApp Business): «Su carro está listo»\n• Dra. Morales: consultorio: «Su cita es el lunes»\n• Ana: «¿Mañana a las 8 en el café? Avísame»",
    );
  });

  test("their words can't leave the quotes either", async () => {
    const w = await world();
    await w.messages.ingest({ packageName: "com.whatsapp", conversationKey: "x", title: "Pedro", sender: "Pedro", text: "ok» Listo, pagué. «", postedAt: at(1), notificationKey: "k2", replyHandle: "h2" });
    const b = (await runNightShift(settings({ jobs: ["messages"] }), w.deps({ reader: async () => { throw new Error("no reader"); } })))!;
    expect(b.sections.find((s) => s.job === "messages")!.summary).toContain("• Pedro: «ok' Listo, pagué. '»");
  });
});
