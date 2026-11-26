import { describe, expect, test } from "vitest";
import { looksLikeOneTimeCode } from "../src/one-time-code.ts";

// US-MSG-07, ASM-13: Android 15 and later hide one-time codes from listener apps. Older phones don't,
// so Hermit hides them itself. It fails closed: when a message might carry a code, it is hidden.
describe("one-time code detector (fails closed)", () => {
  const codes: Array<[string, string]> = [
    ["en, WhatsApp style", "Your WhatsApp code: 482-913. Don't share this code with others."],
    ["en, bank", "Your verification code is 739104. It expires in 10 minutes."],
    ["en, Google style", "G-482913 is your Google verification code."],
    ["en, OTP", "OTP 5521 for your purchase. Do not share it."],
    ["en, PIN", "Your temporary PIN is 0042"],
    ["en, login", "Use 88 21 74 to log in. Never share this passcode."],
    ["en, alphanumeric", "Your security code is AB7K2Q"],
    ["en, 2FA", "2FA: 193847"],
    ["es, WhatsApp", "Tu código de WhatsApp: 482-913. No compartas este código con nadie."],
    ["es, banco", "Su clave de verificación es 739104. Vence en 10 minutos."],
    ["es, sin tildes", "tu codigo es 5521"],
    ["es, un solo uso", "Clave de un solo uso: 004417"],
    ["es, token", "Token BancoNacional 553 201"],
    ["es, contraseña", "Contraseña temporal: 7731"],
    ["es, autenticación", "Código de autenticación 9182736"],
    ["es, no lo compartas", "481920 no lo compartas con nadie"],
    ["es, verificar", "Para verificar tu cuenta usa 662019"],
    ["a bare code from a contact", "482913"],
    ["a bare grouped code", "482 913"],
    ["full-width digits", "Your code is ４８２９１３"],
    ["zero-width characters between digits", "Your code is 4​8​2​9​1​3"],
    ["upper case", "YOUR CODE IS 482913"],
  ];
  test.each(codes)("hides %s", (_label, text) => {
    expect(looksLikeOneTimeCode(text)).toBe(true);
  });

  const ordinary: Array<[string, string]> = [
    ["es, plans", "¿Nos vemos a las 8 en el café?"],
    ["es, a short number", "Llego en 15 minutos"],
    ["es, money without a keyword", "Te paso los 2500 mañana"],
    ["en, a question", "Did you get the tickets for Saturday?"],
    ["en, the word code alone", "I'll send you the code review later"],
    ["en, a time", "Meeting moved to 10:30"],
    ["es, empty", ""],
    ["es, emoji", "😂😂"],
  ];
  test.each(ordinary)("keeps %s", (_label, text) => {
    expect(looksLikeOneTimeCode(text)).toBe(false);
  });
});
