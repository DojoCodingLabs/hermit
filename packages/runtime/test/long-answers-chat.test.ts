/**
 * Q155 on HM-CHAT-01: a cut reply carries its cut line and, while it is the latest, Seguir; Seguir streams into the same
 * bubble; stopping a reply keeps its words, marked stopped; TalkBack hears the cut and, after Seguir, only what is new.
 */
import { describe, expect, test } from "vitest";
import { initialLock } from "../src/app-lock.ts";
import { chatReducer, continuable, initialChat, inputControl, spokenAnnouncement, turnAnnouncement, type ChatAction, type ChatState } from "../src/chat-state.ts";

const run = (actions: ChatAction[], from: ChatState = initialChat) => actions.reduce(chatReducer, from);
const CUT = "Ingredientes:\n- 1 taza de arroz";
// What TalkBack says for it: the structure as sentences, no list signs.
const SPOKEN_CUT = "Ingredientes. 1 taza de arroz.";
const sent: ChatAction[] = [{ type: "send", id: "u1", text: "dame una receta", at: 1_000 }, { type: "token", text: "Ingredientes:\n- 1 taza de arroz\n- 1 lit" }];
const cutTurn = run([...sent, { type: "finished", id: "a1", view: { kind: "reply", text: CUT, cut: true }, at: 9_000 }]);

describe("a cut reply in the chat", () => {
  test("the finished bubble carries the cut, and Seguir belongs to it while it is the latest", () => {
    expect(cutTurn.items.at(-1)).toEqual({ kind: "assistant", id: "a1", text: CUT, streaming: false, cut: true });
    expect(cutTurn.busy).toBe(false);
    expect(continuable(cutTurn)).toBe("a1");
    // A whole reply has nothing to continue; neither does a cut one once the user has written again.
    expect(continuable(run([...sent, { type: "finished", id: "a1", view: { kind: "reply", text: CUT } }]))).toBeUndefined();
    const later = run([{ type: "send", id: "u2", text: "gracias" }], cutTurn);
    expect(continuable(later)).toBeUndefined();
    // The older bubble still says it was cut: never silent, even when it is no longer the latest.
    expect(later.items.find((i) => i.id === "a1")).toMatchObject({ cut: true });
  });

  test("TalkBack hears the cut after the reply, never only the words", () => {
    expect(turnAnnouncement(cutTurn)).toEqual({ id: "a1", text: SPOKEN_CUT, also: ["HM-CHAT-01.cut.spoken"] });
    expect(spokenAnnouncement(turnAnnouncement(cutTurn)!, initialLock(false))).toEqual({ text: SPOKEN_CUT, also: ["HM-CHAT-01.cut.spoken"] });
    // Locked, still nothing private is read: the neutral line only.
    expect(spokenAnnouncement(turnAnnouncement(cutTurn)!, { ...initialLock(true), locked: true })).toEqual({ copyKey: "HM-CHAT-01.replyReady" });
  });
});

describe("Seguir", () => {
  const going = run([{ type: "continue", id: "a1", at: 20_000 }], cutTurn);

  test("it runs like a turn (stop in the composer) and streams into the same bubble", () => {
    expect(going.busy).toBe(true);
    expect(inputControl(going)).toBe("stop");
    expect(going.live).toEqual({ statusKey: "HM-CHAT-01.cut.continuing", thinking: "", startedAt: 20_000 });
    expect(going.items.at(-1)).toMatchObject({ id: "a1", continuing: true });
    const streamed = run([{ type: "token", text: "\n- 1 litro" }, { type: "token", text: " de leche" }], going);
    expect(streamed.items).toHaveLength(cutTurn.items.length);
    expect(streamed.items.at(-1)).toMatchObject({ id: "a1", text: `${CUT}\n- 1 litro de leche`, continuing: true });
    // Only the latest cut reply, only when nothing runs.
    expect(run([{ type: "continue", id: "u1" }], cutTurn)).toBe(cutTurn);
    expect(run([{ type: "continue", id: "a1" }], going)).toBe(going);
  });

  test("it ends with the whole reply from the runtime; TalkBack hears only the new part", () => {
    const whole = `${CUT}\n- 1 litro de leche`;
    const done = run([{ type: "token", text: "\n- 1 litro de leche" }, { type: "continued", id: "a1", view: { kind: "reply", text: whole }, at: 26_000 }], going);
    expect(done.items.at(-1)).toEqual({ kind: "assistant", id: "a1", text: whole, streaming: false });
    expect(done.busy).toBe(false);
    expect(continuable(done)).toBeUndefined();
    expect(turnAnnouncement(done)).toEqual({ id: "a1:31", text: "1 litro de leche." });
    // Still cut: Seguir again.
    const again = run([{ type: "continued", id: "a1", view: { kind: "reply", text: whole, cut: true } }], going);
    expect(again.items.at(-1)).toMatchObject({ cut: true });
    expect(continuable(again)).toBe("a1");
    expect(turnAnnouncement(again)).toEqual({ id: "a1:31", text: "1 litro de leche.", also: ["HM-CHAT-01.cut.spoken"] });
  });

  test("a failed Seguir puts the reply back as it was, still cut, and says so", () => {
    const failed = run([{ type: "token", text: "\n- 1 lit" }, { type: "continued", id: "a1", view: { kind: "outcome", outcome: "model_error" } }], going);
    expect(failed.items.at(-1)).toEqual({ kind: "assistant", id: "a1", text: CUT, streaming: false, cut: true, continueFailed: true });
    expect(continuable(failed)).toBe("a1");
    expect(turnAnnouncement(failed)).toEqual({ id: "a1:failed", copyKey: "HM-CHAT-01.cut.failed" });
    // Tapping it again clears the failure.
    expect(run([{ type: "continue", id: "a1" }], failed).items.at(-1)).not.toHaveProperty("continueFailed");
  });

  // Review 2026-11-25, finding 2: Seguir that adds nothing used to end the cut with no word why. Now code says so, and
  // Seguir goes: tapping it again would only bring the same nothing.
  test("a Seguir that adds nothing says so in code's words, and Seguir goes", () => {
    const none = run([{ type: "continued", id: "a1", view: { kind: "reply", text: CUT, nothingMore: true }, at: 24_000 }], going);
    expect(none.items.at(-1)).toEqual({ kind: "assistant", id: "a1", text: CUT, streaming: false, nothingMore: true });
    expect(none.mascot).toBe("done");
    expect(continuable(none)).toBeUndefined();
    expect(turnAnnouncement(none)).toEqual({ id: "a1:nothing", copyKey: "HM-CHAT-01.cut.nothingMore" });
    // The note goes once the user writes again, like a failed Seguir's.
    expect(run([{ type: "send", id: "u2", text: "gracias" }], none).items.find((i) => i.id === "a1")).toEqual({ kind: "assistant", id: "a1", text: CUT, streaming: false });
  });

  test("stopping Seguir keeps what streamed, marked stopped, and nothing more is written", () => {
    const stopped = run([{ type: "token", text: "\n- 1 litro" }, { type: "stop" }, { type: "token", text: " zombie" }], going);
    expect(stopped.items.at(-1)).toMatchObject({ text: `${CUT}\n- 1 litro` });
    const done = chatReducer(stopped, { type: "continued", id: "a1", view: { kind: "reply", text: `${CUT}\n- 1 litro`, cut: true, stopped: true } });
    expect(done.items.at(-1)).toEqual({ kind: "assistant", id: "a1", text: `${CUT}\n- 1 litro`, streaming: false, cut: true, stopped: true });
    expect(done.mascot).toBe("idle");
    expect(turnAnnouncement(done)).toEqual({ id: "a1:31", text: "1 litro.", also: ["HM-CHAT-01.cut.spokenStopped"] });
  });
});

describe("a reply the user stopped while it was written", () => {
  test("its words stay on screen, marked stopped, and Seguir can go on", () => {
    const s = run([...sent, { type: "stop" }, { type: "finished", id: "a1", view: { kind: "reply", text: CUT, cut: true, stopped: true } }]);
    expect(s.items).toEqual([{ kind: "user", id: "u1", text: "dame una receta" }, { kind: "assistant", id: "a1", text: CUT, streaming: false, cut: true, stopped: true }]);
    expect(s.mascot).toBe("idle");
    expect(continuable(s)).toBe("a1");
  });

  test("a restart brings back cut and stopped replies as they were", () => {
    const s = chatReducer(initialChat, {
      type: "restore",
      tainted: false,
      entries: [{ kind: "user", text: "dame una receta" }, { kind: "reply", text: CUT, cut: true }, { kind: "user", text: "y otra" }, { kind: "reply", text: "Pasos:", cut: true, stopped: true }],
    });
    expect(s.items.slice(1)).toEqual([
      { kind: "assistant", id: "r1", text: CUT, streaming: false, cut: true },
      { kind: "user", id: "r2", text: "y otra" },
      { kind: "assistant", id: "r3", text: "Pasos:", streaming: false, cut: true, stopped: true },
    ]);
    expect(continuable(s)).toBe("r3");
  });

  test("the words-only step changes nothing on screen", () => {
    const s = run([{ type: "send", id: "u1", text: "hola" }]);
    expect(chatReducer(s, { type: "step", event: { kind: "words" } })).toEqual(s);
  });
});

describe("a long reply by ear (TalkBack)", () => {
  test("a long answer reads its opening, then says the whole reply is in the chat; each block is still there to swipe through", () => {
    const steps = Array.from({ length: 14 }, (_, i) => `${i + 1}. Paso número ${i + 1}: mezcla, revuelve y espera un poco antes de seguir.`).join("\n");
    const text = `Pan amasado para 8 personas.\n\nPasos:\n${steps}`;
    const s = run([{ type: "send", id: "u1", text: "dame una receta de pan amasado" }, { type: "finished", id: "a1", view: { kind: "reply", text } }]);
    const a = turnAnnouncement(s) as { id: string; text: string; also?: string[] };
    expect(a.also).toEqual(["HM-CHAT-01.long.spoken"]);
    expect(a.text.startsWith("Pan amasado para 8 personas. Pasos. 1, Paso número 1")).toBe(true);
    expect(a.text.length).toBeLessThanOrEqual(320);
    expect(a.text).not.toMatch(/[-*#]/);
  });

  test("a long answer that was cut says both", () => {
    const text = Array.from({ length: 30 }, (_, i) => `- ingrediente ${i + 1} en cantidad suficiente`).join("\n");
    const s = run([{ type: "send", id: "u1", text: "dame una lista larga" }, { type: "finished", id: "a1", view: { kind: "reply", text, cut: true } }]);
    expect((turnAnnouncement(s) as { also?: string[] }).also).toEqual(["HM-CHAT-01.long.spoken", "HM-CHAT-01.cut.spoken"]);
  });
});
