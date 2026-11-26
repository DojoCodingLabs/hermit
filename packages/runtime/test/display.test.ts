import { describe, expect, test } from "vitest";
import {
  LANGUAGE_SETTING, THEME_SETTING, colorScheme, colorSchemeOverride, languageChoice, languageOverride, languageSettingValue, textScale,
  themeChoice, themeSettingValue,
} from "../src/display.ts";
import { chatReducer, initialChat, spokenAnnouncement, turnAnnouncement, type ChatState } from "../src/chat-state.ts";
import { initialLock } from "../src/app-lock.ts";

describe("TalkBack while the app lock is engaged (US-SET-07, US-SET-09)", () => {
  const unlocked = { ...initialLock(true), locked: false };
  const locked = initialLock(true);

  test("unlocked, the reply is read as its text", () => {
    expect(spokenAnnouncement({ id: "a1", text: "Tu código es 1234" }, unlocked)).toEqual({ text: "Tu código es 1234" });
    expect(spokenAnnouncement({ id: "a1", text: "Hola" }, initialLock(false))).toEqual({ text: "Hola" });
  });

  test("locked, only a neutral line is read, never the reply", () => {
    expect(spokenAnnouncement({ id: "a1", text: "Tu código es 1234" }, locked)).toEqual({ copyKey: "HM-CHAT-01.replyReady" });
  });

  test("off screen with the lock on (inside the grace, not locked yet), only the neutral line", () => {
    expect(spokenAnnouncement({ id: "a1", text: "Tu código es 1234" }, { ...unlocked, hiddenAt: 1000 })).toEqual({ copyKey: "HM-CHAT-01.replyReady" });
    expect(spokenAnnouncement({ id: "a1", text: "Hola" }, { ...initialLock(false), hiddenAt: 1000 })).toEqual({ text: "Hola" });
  });

  test("locked, an outcome is neutral too", () => {
    expect(spokenAnnouncement({ id: "o1", copyKey: "common.outcome.offline" }, locked)).toEqual({ copyKey: "HM-CHAT-01.replyReady" });
  });

  test("unlocked, an outcome is read by its copy key", () => {
    expect(spokenAnnouncement({ id: "o1", copyKey: "common.outcome.offline" }, unlocked)).toEqual({ copyKey: "common.outcome.offline" });
  });
});

describe("language choice (HM-ONB-02, HM-SET-05, US-ONB-02)", () => {
  test("the override lives under the declared key", () => {
    expect(LANGUAGE_SETTING).toBe("locale.override");
  });

  test("no stored value, or 'system', follows the phone", () => {
    expect(languageOverride(undefined)).toBeUndefined();
    expect(languageOverride("system")).toBeUndefined();
    expect(languageChoice(undefined)).toBe("system");
    expect(languageChoice("system")).toBe("system");
  });

  test("a stored locale overrides the phone", () => {
    expect(languageOverride("en")).toBe("en");
    expect(languageOverride("es-419")).toBe("es-419");
    expect(languageChoice("es-419")).toBe("es-419");
  });

  test("an unknown stored value follows the phone instead of picking a language by accident", () => {
    expect(languageOverride("fr")).toBeUndefined();
    expect(languageOverride("es")).toBeUndefined();
    expect(languageChoice("")).toBe("system");
  });

  test("each choice stores one value that reads back as itself", () => {
    for (const c of ["system", "en", "es-419"] as const) expect(languageChoice(languageSettingValue(c))).toBe(c);
  });
});

describe("dark mode (HM-SET-07, US-SET-08)", () => {
  test("the choice lives under a declared key", () => {
    expect(THEME_SETTING).toBe("appearance.theme");
  });

  test("by default it follows the system", () => {
    expect(themeChoice(undefined)).toBe("system");
    expect(colorScheme(undefined, "dark")).toBe("dark");
    expect(colorScheme(undefined, "light")).toBe("light");
    expect(colorSchemeOverride(themeChoice(undefined))).toBe("auto");
  });

  test("a chosen scheme wins over the system", () => {
    expect(colorScheme("dark", "light")).toBe("dark");
    expect(colorScheme("light", "dark")).toBe("light");
    expect(colorSchemeOverride("dark")).toBe("dark");
    expect(colorSchemeOverride("light")).toBe("light");
  });

  test("an unknown value or no system answer is safe", () => {
    expect(themeChoice("sepia")).toBe("system");
    expect(colorScheme("sepia", "dark")).toBe("dark");
    expect(colorScheme(undefined, undefined)).toBe("light");
  });

  test("each choice stores one value that reads back as itself", () => {
    for (const c of ["system", "light", "dark"] as const) expect(themeChoice(themeSettingValue(c))).toBe(c);
  });
});

describe("text size (HM-SET-07, NFR-08)", () => {
  test("reports the phone's scale as a whole percent", () => {
    expect(textScale(1)).toEqual({ percent: 100, overLimit: false });
    expect(textScale(1.3)).toEqual({ percent: 130, overLimit: false });
    expect(textScale(0.85)).toEqual({ percent: 85, overLimit: false });
  });

  test("layouts are built for up to 200%; beyond that the screen says so", () => {
    expect(textScale(2)).toEqual({ percent: 200, overLimit: false });
    expect(textScale(2.2)).toEqual({ percent: 220, overLimit: true });
  });

  test("a missing or broken scale reads as 100%", () => {
    expect(textScale(Number.NaN)).toEqual({ percent: 100, overLimit: false });
    expect(textScale(0)).toEqual({ percent: 100, overLimit: false });
  });
});

describe("TalkBack announcement of a finished turn (US-SET-07)", () => {
  const running = (): ChatState => chatReducer(initialChat, { type: "send", id: "u1", text: "hola", at: 0 });

  test("nothing is announced while the reply streams", () => {
    const s = chatReducer(running(), { type: "token", text: "Hol" });
    expect(turnAnnouncement(s)).toBeUndefined();
  });

  test("the whole reply is announced once the turn finishes", () => {
    let s = chatReducer(running(), { type: "token", text: "Hol" });
    s = chatReducer(s, { type: "finished", id: "a1", view: { kind: "reply", text: "Hola, ¿qué tal?" } });
    expect(turnAnnouncement(s)).toEqual({ id: "a1", text: "Hola, ¿qué tal?" });
  });

  test("a question is announced as its text", () => {
    const s = chatReducer(running(), { type: "finished", id: "q1", view: { kind: "question", text: "¿A quién?" } });
    expect(turnAnnouncement(s)).toEqual({ id: "q1", text: "¿A quién?" });
  });

  test("an outcome is announced by its copy key, never by raw text", () => {
    const s = chatReducer(running(), { type: "finished", id: "o1", view: { kind: "outcome", outcome: "offline" } });
    expect(turnAnnouncement(s)).toEqual({ id: "o1", copyKey: "common.outcome.offline" });
  });

  test("a stop after an action is announced by its system row", () => {
    const s = chatReducer(running(), { type: "finished", id: "s1", view: { kind: "outcome", outcome: "stopped", afterAction: true } });
    expect(turnAnnouncement(s)).toEqual({ id: "s1", copyKey: "HM-CHAT-01.stoppedAfterAction" });
  });

  test("a restored conversation is not read aloud on open", () => {
    const s = chatReducer(initialChat, { type: "restore", entries: [{ kind: "user", text: "hola" }, { kind: "reply", text: "Hola" }], tainted: false });
    expect(turnAnnouncement(s)).toBeUndefined();
  });
});
