import { expect, test } from "vitest";
import { userLanguage } from "../src/prompt.ts";

test("short everyday phrases are detected in both languages", () => {
  for (const t of ["pon un recordatorio", "agenda una reunión", "mándale un mensaje", "llama a mi mamá", "buenos días", "olvida mi placa", "busca en internet vuelos a Lima", "horario de museos"]) {
    expect(userLanguage(t), t).toBe("Spanish (Latin America)");
  }
  for (const t of ["remind me later", "set up a meeting", "send a message", "call my mom", "good morning", "forget the gate code", "erase what I told you"]) {
    expect(userLanguage(t), t).toBe("English");
  }
  expect(userLanguage("ok")).toBeUndefined();
});
