import { describe, expect, test } from "vitest";
import { confirmationMatches, eraseReducer, initialErase, type EraseAction, type EraseScreen } from "../src/erase-screen.ts";

const run = (from: EraseScreen, actions: EraseAction[]) => actions.reduce(eraseReducer, from);
const WORD = "BORRAR";

describe("typed confirmation (HM-SET-03)", () => {
  test("matches the word ignoring case, accents and surrounding spaces", () => {
    expect(confirmationMatches(" borrar ", WORD)).toBe(true);
    expect(confirmationMatches("BÓRRAR", WORD)).toBe(true);
    expect(confirmationMatches("DELETE", "DELETE")).toBe(true);
  });

  test("anything else does not match, the empty string included", () => {
    expect(confirmationMatches("", WORD)).toBe(false);
    expect(confirmationMatches("borra", WORD)).toBe(false);
    expect(confirmationMatches("borrar todo", WORD)).toBe(false);
  });
});

describe("erase screen (HM-SET-03)", () => {
  test("opens on the confirmation, or on the wallet warning when the wallet holds money", () => {
    expect(initialErase({})).toEqual({ kind: "confirm", typed: "" });
    expect(initialErase({ walletBalance: "12.50 USD₮" })).toEqual({ kind: "wallet_warning", balance: "12.50 USD₮" });
  });

  test("an interrupted erase found at launch resumes without asking again", () => {
    expect(initialErase({ resume: { done: 3, total: 11 } })).toEqual({ kind: "erasing", done: 3, total: 11, resumed: true });
  });

  test("the wallet warning must be acknowledged before the confirmation", () => {
    const s = run(initialErase({ walletBalance: "5 USD₮" }), [{ type: "submit", word: WORD }]);
    expect(s.kind).toBe("wallet_warning");
    expect(run(s, [{ type: "wallet_ack" }])).toEqual({ kind: "confirm", typed: "" });
  });

  test("submit does nothing until the word matches (ST-DISABLED)", () => {
    const s = run(initialErase({}), [{ type: "type", text: "borr" }, { type: "submit", word: WORD }]);
    expect(s).toEqual({ kind: "confirm", typed: "borr" });
  });

  test("the word, then the fingerprint, then the erase", () => {
    const s = run(initialErase({}), [{ type: "type", text: "borrar" }, { type: "submit", word: WORD }]);
    expect(s).toEqual({ kind: "authenticating", typed: "borrar" });
    expect(run(s, [{ type: "auth", ok: true }])).toEqual({ kind: "erasing", done: 0, total: 0, resumed: false });
  });

  test("a failed or cancelled fingerprint deletes nothing and says so", () => {
    const s = run(initialErase({}), [{ type: "type", text: "borrar" }, { type: "submit", word: WORD }, { type: "auth", ok: false }]);
    expect(s).toEqual({ kind: "confirm", typed: "borrar", authFailed: true });
    // Typing again clears the notice.
    expect(run(s, [{ type: "type", text: "borra" }])).toEqual({ kind: "confirm", typed: "borra" });
  });

  test("progress is determinate, a failure keeps the count, and retry continues", () => {
    let s = run(initialErase({}), [{ type: "type", text: WORD }, { type: "submit", word: WORD }, { type: "auth", ok: true }, { type: "progress", done: 4, total: 11 }]);
    expect(s).toEqual({ kind: "erasing", done: 4, total: 11, resumed: false });
    s = run(s, [{ type: "failed" }]);
    expect(s).toEqual({ kind: "failed", done: 4, total: 11 });
    expect(run(s, [{ type: "retry" }])).toEqual({ kind: "erasing", done: 4, total: 11, resumed: true });
  });

  test("finishing lands on done; nothing goes back from there", () => {
    const s = run(initialErase({ resume: { done: 9, total: 11 } }), [{ type: "finished" }]);
    expect(s).toEqual({ kind: "done" });
    expect(run(s, [{ type: "retry" }, { type: "type", text: "x" }, { type: "failed" }])).toEqual({ kind: "done" });
  });

  test("no going back to the confirmation once the erase started", () => {
    const s = run(initialErase({ resume: { done: 1, total: 11 } }), [{ type: "type", text: "x" }, { type: "submit", word: WORD }, { type: "wallet_ack" }]);
    expect(s.kind).toBe("erasing");
  });
});
