/**
 * Q155: long answers, never cut silently. A reply that used up its tokens says so in the turn view and stays so after a
 * restart; Seguir writes the next part into the same reply, words only, in the chat's own sessions; a reply the user
 * stopped while it was written keeps what was already on screen.
 */
import { describe, expect, test } from "vitest";
import { nodeSql } from "@hermit/sql-node";
import { createSessions, type ApprovalPort } from "@hermit/core";
import { ed25519Signer } from "@hermit/cage";
import { profileById, type CompletionEngine, type EngineRequest, type EngineStop } from "@hermit/model";
import { createHermit } from "../src/hermit.ts";

// Two-stage: the pick is a JSON choice, so {"choice":"respond"} hands the words to the reply prompt.
const PROFILE = profileById("botpsy-q4-two-stage-nothink")!;
const NOW = Date.UTC(2026, 10, 12, 0, 0);
const tick = () => new Promise((r) => setTimeout(r, 0));

/** A scripted engine step: the text it returns, how it ended, and whether it streams and then waits for a stop. */
type Step = { text: string; stop?: EngineStop; hang?: boolean } | { fail: true };

function setup(script: Step[], approvals: ApprovalPort = { request: async () => ({ kind: "denied" }) }) {
  const sql = nodeSql();
  const requests: EngineRequest[] = [];
  let i = 0;
  const engine: CompletionEngine = {
    complete(req) {
      requests.push(req);
      if (req.signal?.aborted) return Promise.reject(new Error("Stopped by the user."));
      const s = script[i++] ?? { text: '{"choice":"respond"}' };
      if ("fail" in s) return Promise.reject(new Error("engine down"));
      if (!req.jsonSchema) for (const ch of s.text.match(/[\s\S]{1,6}/g) ?? []) req.onToken?.(ch);
      if (s.hang) return new Promise((_, reject) => req.signal?.addEventListener("abort", () => reject(new Error("cancelled")), { once: true }));
      return Promise.resolve({ text: s.text, toolCalls: [], ...(s.stop ? { stop: s.stop } : {}) });
    },
  };
  let n = 0;
  const hermit = createHermit(
    {
      sql,
      signer: ed25519Signer(new Uint8Array(32).fill(4)),
      notifier: { schedule: async () => "n", cancel: async () => {} },
      calendar: { list: async () => [], add: async () => {}, calendars: async () => [] },
      replySender: { send: async () => "sent" },
      engine,
      approvals,
      now: () => NOW,
      timeZone: () => "America/Costa_Rica",
      language: () => "es-419",
      newId: () => `id${++n}`,
    },
    PROFILE,
  );
  return { hermit, sql, requests };
}

// The two-stage pick for words that are not a long-form request; a recipe goes straight to its long answer (one call).
const respond = { text: '{"choice":"respond"}' };
const PART_1 = "Arroz con leche.\n\nIngredientes:\n- 1 taza de arroz\n- 1 litro de leche\n- 1 taza de azúcar\n- canela en ra";
const SHOWN_1 = "Arroz con leche.\n\nIngredientes:\n- 1 taza de arroz\n- 1 litro de leche\n- 1 taza de azúcar";
const PART_2 = "- canela en rama\n\nPasos:\n1. Lava el arroz.\n2. Hiérvelo con la leche y la canela.";

describe("a cut reply is never silent (Q155)", () => {
  test("the turn view says the reply was cut, and a restart still shows it cut", async () => {
    const w = setup([{ text: PART_1, stop: "length" }]);
    await w.hermit.init();
    const s = await w.hermit.startSession();
    expect(await w.hermit.send(s, "dame una receta de arroz con leche")).toEqual({ kind: "reply", text: SHOWN_1, cut: true });
    expect((await w.hermit.transcript(s)).entries).toEqual([
      { kind: "user", text: "dame una receta de arroz con leche" },
      { kind: "reply", text: SHOWN_1, cut: true },
    ]);
  });

  test("Seguir writes the next part into the same reply, words only, and it ends whole", async () => {
    const w = setup([{ text: PART_1, stop: "length" }, { text: PART_2, stop: "end" }]);
    await w.hermit.init();
    const s = await w.hermit.startSession();
    await w.hermit.send(s, "dame una receta de arroz con leche");
    const streamed: string[] = [];
    const view = await w.hermit.continueReply(s, { onToken: (t) => streamed.push(t) });
    const whole = `${SHOWN_1}\n${PART_2}`;
    expect(view).toEqual({ kind: "reply", text: whole });
    // What streamed is exactly what was appended to the bubble.
    expect(SHOWN_1 + streamed.join("")).toBe(whole);
    // Words only: no tools, no schema; the cage had nothing to decide and the signed log holds nothing.
    const req = w.requests.at(-1)!;
    expect(req.tools).toBeUndefined();
    expect(req.jsonSchema).toBeUndefined();
    expect((await w.hermit.activity()).rows).toEqual([]);
    // One reply, grown in place: one bubble after a restart, one message for the model.
    expect((await w.hermit.transcript(s)).entries).toEqual([
      { kind: "user", text: "dame una receta de arroz con leche" },
      { kind: "reply", text: whole },
    ]);
    const history = await createSessions(w.sql, () => NOW).history(s, 10);
    expect(history.map((m) => m.role)).toEqual(["user", "assistant"]);
    expect(history.at(-1)!.content).toBe(whole);
  });

  test("a part that runs out of tokens too stays cut, so Seguir can be tapped again", async () => {
    const w = setup([{ text: PART_1, stop: "length" }, { text: "- canela en rama\n\nPasos:\n1. Lava el arroz.\n2. Hiérvelo con la le", stop: "length" }, { text: "2. Hiérvelo con la leche y la canela.", stop: "end" }]);
    await w.hermit.init();
    const s = await w.hermit.startSession();
    await w.hermit.send(s, "dame una receta de arroz con leche");
    expect(await w.hermit.continueReply(s)).toEqual({ kind: "reply", text: `${SHOWN_1}\n- canela en rama\n\nPasos:\n1. Lava el arroz.`, cut: true });
    expect(await w.hermit.continueReply(s)).toEqual({ kind: "reply", text: `${SHOWN_1}\n- canela en rama\n\nPasos:\n1. Lava el arroz.\n2. Hiérvelo con la leche y la canela.` });
  });

  // Review 2026-11-25, finding 2: this used to end the cut with no word why. The view says there was nothing more (the
  // chat shows "No encontré nada más que agregar."), and Seguir is not offered again, so it is never an endless tap.
  test("a Seguir that adds nothing says so, and the reply is no longer offered Seguir", async () => {
    const w = setup([{ text: PART_1, stop: "length" }, { text: "- 1 taza de azúcar", stop: "end" }]);
    await w.hermit.init();
    const s = await w.hermit.startSession();
    await w.hermit.send(s, "dame una receta de arroz con leche");
    expect(await w.hermit.continueReply(s)).toEqual({ kind: "reply", text: SHOWN_1, nothingMore: true });
    expect((await w.hermit.transcript(s)).entries.at(-1)).toEqual({ kind: "reply", text: SHOWN_1 });
    const before = w.requests.length;
    await expect(w.hermit.continueReply(s)).rejects.toThrow(/nothing to continue/i);
    expect(w.requests.length).toBe(before);
  });

  test("a failed continuation changes nothing: the reply is still cut", async () => {
    const w = setup([{ text: PART_1, stop: "length" }, { fail: true }]);
    await w.hermit.init();
    const s = await w.hermit.startSession();
    await w.hermit.send(s, "dame una receta de arroz con leche");
    expect(await w.hermit.continueReply(s)).toEqual({ kind: "outcome", outcome: "model_error" });
    expect((await w.hermit.transcript(s)).entries.at(-1)).toEqual({ kind: "reply", text: SHOWN_1, cut: true });
  });

  test("Seguir never runs where nobody asked: not in an unattended session, not for a reply that isn't cut or isn't the last", async () => {
    const w = setup([{ text: PART_1, stop: "length" }, respond, { text: "Claro.", stop: "end" }]);
    await w.hermit.init();
    const night = await w.hermit.startSession({ attended: false });
    await expect(w.hermit.continueReply(night)).rejects.toThrow(/attended/);
    const s = await w.hermit.startSession();
    await expect(w.hermit.continueReply(s)).rejects.toThrow(/nothing to continue/i);
    await w.hermit.send(s, "dame una receta de arroz con leche");
    await w.hermit.send(s, "gracias");
    const before = w.requests.length;
    await expect(w.hermit.continueReply(s)).rejects.toThrow(/nothing to continue/i);
    expect(w.requests.length).toBe(before);
  });

  test("stopping a reply while it is written keeps what was on screen, marked stopped, and Seguir can go on", async () => {
    const w = setup([{ text: "Arroz con leche.\n\nIngredientes:\n- 1 taza de arroz\n- 1 litro de leche", hang: true }, { text: "- 1 taza de azúcar", stop: "end" }]);
    await w.hermit.init();
    const s = await w.hermit.startSession();
    const stop = new AbortController();
    const shown: string[] = [];
    const turn = w.hermit.send(s, "dame una receta de arroz con leche", { signal: stop.signal, onToken: (t) => shown.push(t) });
    await tick();
    stop.abort();
    expect(shown.join("")).toBe("Arroz con leche.\n\nIngredientes:\n- 1 taza de arroz\n- 1 litro de leche");
    // Kept the way a cut reply ends: at its last whole line (the last one may not have been finished).
    const kept = "Arroz con leche.\n\nIngredientes:\n- 1 taza de arroz";
    expect(await turn).toEqual({ kind: "reply", text: kept, cut: true, stopped: true });
    expect((await w.hermit.transcript(s)).entries.at(-1)).toEqual({ kind: "reply", text: kept, cut: true, stopped: true });
    // Nothing ran, so nothing is in the log; the model's history holds the words it had written.
    expect((await w.hermit.activity()).rows).toEqual([]);
    const view = await w.hermit.continueReply(s);
    expect(view).toEqual({ kind: "reply", text: `${kept}\n- 1 taza de azúcar` });
  });

  // Review 2026-11-25, finding 1: the raw stream was kept, so a Stop inside a word joined Seguir's next words as
  // "mant equilla" (or "mant mantequilla").
  test("a Stop inside a word keeps only whole words, and Seguir joins the next ones with one space", async () => {
    const said = "Arroz con leche.\n\nPon la leche en una olla con la canela y la cáscara de limón, espera a que hierva y luego agrega la mant";
    const w = setup([{ text: said, hang: true }, { text: "la mantequilla y el arroz lavado.", stop: "end" }]);
    await w.hermit.init();
    const s = await w.hermit.startSession();
    const stop = new AbortController();
    const turn = w.hermit.send(s, "dame una receta de arroz con leche", { signal: stop.signal });
    await tick();
    stop.abort();
    const kept = "Arroz con leche.\n\nPon la leche en una olla con la canela y la cáscara de limón, espera a que hierva y luego agrega la";
    expect(await turn).toEqual({ kind: "reply", text: kept, cut: true, stopped: true });
    expect((await w.hermit.transcript(s)).entries.at(-1)).toEqual({ kind: "reply", text: kept, cut: true, stopped: true });
    // The model says "la" again: it is said once.
    expect(await w.hermit.continueReply(s)).toEqual({ kind: "reply", text: `${kept} mantequilla y el arroz lavado.` });
  });

  test("a Stop inside a word during Seguir keeps only whole words too, and the next part goes on on the same line", async () => {
    const part = "- canela en rama\n\nPasos:\n1. Lava el arroz y ponlo a remojar en agua fría durante media hora, luego escúrrelo y ponlo en una ol";
    const w = setup([{ text: PART_1, stop: "length" }, { text: part, hang: true }, { text: "olla con la leche.\n2. Hierve todo a fuego lento.", stop: "end" }]);
    await w.hermit.init();
    const s = await w.hermit.startSession();
    await w.hermit.send(s, "dame una receta de arroz con leche");
    const stop = new AbortController();
    const going = w.hermit.continueReply(s, { signal: stop.signal });
    await tick();
    stop.abort();
    const kept = `${SHOWN_1}\n- canela en rama\n\nPasos:\n1. Lava el arroz y ponlo a remojar en agua fría durante media hora, luego escúrrelo y ponlo en una`;
    expect(await going).toEqual({ kind: "reply", text: kept, cut: true, stopped: true });
    expect((await w.hermit.transcript(s)).entries.at(-1)).toEqual({ kind: "reply", text: kept, cut: true, stopped: true });
    expect(await w.hermit.continueReply(s)).toEqual({ kind: "reply", text: `${kept} olla con la leche.\n2. Hierve todo a fuego lento.` });
  });

  // Review 2026-11-25, finding 6 (a check): model words after a read of others' messages are stored without the untrusted
  // flag on the finished path too (only code-built answers that quote others carry it); the session's taint says so.
  // Words a Stop keeps are stored the same way.
  test("words a Stop keeps after a read of others' messages are stored like the finished reply, and the turn says tainted", async () => {
    const words = "Ana te escribió sobre la cena del viernes y pregunta si llevas el postre o las bebidas.";
    const run = async (last: Step) => {
      const w = setup([{ text: '{"choice":"read_messages","args":{"contact":"Ana"}}' }, respond, last]);
      await w.hermit.init();
      await w.hermit.messages.ingest({ packageName: "com.whatsapp", conversationKey: "ana", title: "Ana", sender: "Ana", text: "¿Llevas postre?", postedAt: NOW - 1000, notificationKey: "k1", replyHandle: "h" });
      const s = await w.hermit.startSession();
      const stop = new AbortController();
      const turn = w.hermit.send(s, "¿qué me escribió Ana?", { signal: stop.signal });
      if ("hang" in last && last.hang) {
        for (let i = 0; i < 100 && w.requests.length < 3; i++) await tick();
        stop.abort();
      }
      return { view: await turn, history: await createSessions(w.sql, () => NOW).history(s, 10) };
    };
    const finished = await run({ text: words, stop: "end" });
    const stopped = await run({ text: words, hang: true });
    expect(finished.view).toMatchObject({ kind: "reply", text: words, tainted: true });
    expect(stopped.view).toMatchObject({ kind: "reply", text: words, cut: true, stopped: true, tainted: true });
    const flags = (h: Array<{ role: string; untrusted?: boolean }>) => h.map((m) => `${m.role}:${m.untrusted ? "untrusted" : "trusted"}`);
    expect(flags(finished.history)).toEqual(["user:trusted", "assistant:trusted", "tool:untrusted", "assistant:trusted"]);
    expect(flags(stopped.history)).toEqual(flags(finished.history));
  });

  test("stopping Seguir keeps the part already shown, still cut", async () => {
    const w = setup([{ text: PART_1, stop: "length" }, { text: PART_2, hang: true }]);
    await w.hermit.init();
    const s = await w.hermit.startSession();
    await w.hermit.send(s, "dame una receta de arroz con leche");
    const stop = new AbortController();
    const streamed: string[] = [];
    const going = w.hermit.continueReply(s, { signal: stop.signal, onToken: (t) => streamed.push(t) });
    await tick();
    stop.abort();
    const view = await going;
    expect(view).toMatchObject({ kind: "reply", cut: true, stopped: true });
    expect((view as { text: string }).text).toBe((SHOWN_1 + streamed.join("")).trimEnd());
    expect((await w.hermit.transcript(s)).entries.at(-1)).toMatchObject({ kind: "reply", cut: true, stopped: true });
  });

  // The S26 on 2026-11-21: after a reminder the model's confirmation stopped mid-sentence, with nothing saying so.
  test("a short confirmation cut mid-sentence says so, and Seguir finishes the sentence without saying it twice", async () => {
    const w = setup([
      { text: '{"choice":"remind","args":{"text":"Tomar agua","at":"2026-11-11T18:30"}}' },
      respond,
      { text: "La alarma ha sido configurada para tomar agua en", stop: "length" },
      // The model starts the sentence over; only what is new is appended.
      { text: "La alarma ha sido configurada para tomar agua en 30 minutos.", stop: "end" },
    ]);
    await w.hermit.init();
    const s = await w.hermit.startSession();
    const view = await w.hermit.send(s, "recuérdame tomar agua en 30 minutos");
    // No whole sentence to fall back to: it ends at its last whole word (the last one may be half of one), and the cut
    // is said.
    expect(view).toEqual({ kind: "reply", text: "La alarma ha sido configurada para tomar agua", cut: true });
    expect(await w.hermit.continueReply(s)).toEqual({ kind: "reply", text: "La alarma ha sido configurada para tomar agua en 30 minutos." });
  });
});
