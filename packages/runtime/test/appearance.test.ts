import { describe, expect, test } from "vitest";
import { nodeSql } from "@hermit/sql-node";
import { migrate } from "@hermit/core";
import { QUIET_SETTING, appearance, quietSettingValue } from "../src/appearance.ts";
import { createHermit } from "../src/hermit.ts";
import { chatReducer, initialChat, type ChatAction } from "../src/chat-state.ts";

describe("appearance (HM-SET-06, US-SET-06, US-CHAT-08)", () => {
  test("by default the mascot shows and motion is on", () => {
    expect(appearance({ quiet: undefined, systemReduceMotion: false })).toEqual({ quiet: false, showMascot: true, motion: true, systemReduceMotion: false });
  });

  test("quiet mode hides the mascot and turns off motion", () => {
    expect(appearance({ quiet: "1", systemReduceMotion: false })).toEqual({ quiet: true, showMascot: false, motion: false, systemReduceMotion: false });
  });

  test("the system's remove animations setting turns off motion but keeps the mascot (Q52)", () => {
    expect(appearance({ quiet: undefined, systemReduceMotion: true })).toEqual({ quiet: false, showMascot: true, motion: false, systemReduceMotion: true });
    expect(appearance({ quiet: "0", systemReduceMotion: true })).toMatchObject({ showMascot: true, motion: false });
  });

  test("turning quiet mode off brings motion back only when the system allows it", () => {
    expect(appearance({ quiet: "0", systemReduceMotion: false })).toMatchObject({ quiet: false, showMascot: true, motion: true });
  });

  test("an unknown stored value is read as off, never as a hidden mascot by accident", () => {
    expect(appearance({ quiet: "yes", systemReduceMotion: false })).toMatchObject({ quiet: false, showMascot: true });
  });

  test("the switch stores 1 or 0 under one declared key", () => {
    expect(QUIET_SETTING).toBe("appearance.quiet");
    expect(quietSettingValue(true)).toBe("1");
    expect(quietSettingValue(false)).toBe("0");
  });

  test("the key round-trips through the settings table", async () => {
    const sql = nodeSql();
    await migrate(sql);
    // Only `settings` is exercised: get and set touch no other port.
    const hermit = createHermit({ sql } as unknown as Parameters<typeof createHermit>[0], {} as Parameters<typeof createHermit>[1]);
    expect(await hermit.settings.get(QUIET_SETTING)).toBeUndefined();
    await hermit.settings.set(QUIET_SETTING, quietSettingValue(true));
    expect(appearance({ quiet: await hermit.settings.get(QUIET_SETTING), systemReduceMotion: false }).showMascot).toBe(false);
  });
});

describe("the offline mascot state (US-CHAT-08)", () => {
  const run = (actions: ChatAction[]) => actions.reduce(chatReducer, initialChat);

  test("a turn that needed the internet while offline ends in the offline pose, not the error pose", () => {
    const s = run([{ type: "send", id: "u", text: "x" }, { type: "finished", id: "o", view: { kind: "outcome", outcome: "offline" } }]);
    expect(s.mascot).toBe("offline");
    expect(s.items.at(-1)).toEqual({ kind: "outcome", id: "o", outcome: "offline" });
  });

  test("the next send leaves the offline pose", () => {
    const s = run([
      { type: "send", id: "u", text: "x" },
      { type: "finished", id: "o", view: { kind: "outcome", outcome: "offline" } },
      { type: "send", id: "u2", text: "y" },
    ]);
    expect(s.mascot).toBe("thinking");
  });
});
