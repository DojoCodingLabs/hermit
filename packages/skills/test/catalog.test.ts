import { describe, expect, test } from "vitest";
import { firstWinSkills, replyBinding, skillById } from "../src/catalog.ts";

describe("first-win catalog", () => {
  test("catalog has the first-win skills plus reminder management (US-REM-03), with spec risks", () => {
    expect(Object.fromEntries(firstWinSkills.map((s) => [s.id, s.risk]))).toEqual({
      remember: "local_write", recall: "read", forget: "local_write", remind: "local_write",
      reminders_list: "read", reminder_cancel: "local_write",
      calendar_read: "read", calendar_add: "local_write", read_messages: "read", reply_message: "send",
    });
  });

  // The menuLine is the tool description: long enough to say when to use the tool (one-line descriptions
  // cost accuracy, docs/research/harness-diagnosis.md), bounded because every token is prefill on slow phones.
  test("every menuLine is at most 300 characters", () => {
    for (const s of firstWinSkills) expect(s.menuLine.length, s.id).toBeLessThanOrEqual(300);
  });

  test("every args schema is an object with additionalProperties false and declared required fields", () => {
    for (const s of firstWinSkills) {
      expect(s.args.type, s.id).toBe("object");
      expect(s.args.additionalProperties, s.id).toBe(false);
      const props = Object.keys(s.args.properties as object);
      for (const r of s.args.required as string[]) expect(props, `${s.id}.${r}`).toContain(r);
    }
  });

  const ctx = {
    conversation: (id: string) => (id === "c1" ? { name: "Ana", address: "+506 8888 0000" } : undefined),
  };

  test("reply_message approval shows the trusted recipient, not model text", () => {
    const s = skillById("reply_message")!;
    const summary = s.describeAction({ conversationId: "c1", text: "Running 10 minutes late" }, ctx);
    expect(summary.lines).toContainEqual({ label: "To", labelKey: "to", value: "Ana (+506 8888 0000)" });
    expect(summary.lines).toContainEqual({ label: "Message", labelKey: "message", value: "Running 10 minutes late" });
  });

  test("reply_message to an unknown conversation is unresolved, so the loop refuses it", () => {
    const summary = skillById("reply_message")!.describeAction({ conversationId: "c999", text: "hi" }, ctx);
    expect(summary.unresolved).toBeTruthy();
    expect(summary.binding).toBeUndefined();
  });

  test("reply_message binds the approval to the conversation and the name shown", () => {
    const summary = skillById("reply_message")!.describeAction({ conversationId: "c1", text: "hi" }, ctx);
    const who = ctx.conversation("c1")!;
    expect(summary.binding).toBe(replyBinding("c1", who));
    expect(summary.unresolved).toBeUndefined();
  });

  test("reply_message takes no free-text recipient from the model", () => {
    const props = Object.keys(skillById("reply_message")!.args.properties as object);
    expect(props).toEqual(["conversationId", "text"]);
  });

  test("a fixed value Hermit writes carries its valueKey; the user's own words never do", () => {
    const read = skillById("read_messages")!;
    expect(read.describeAction({}, ctx).lines).toEqual([{ label: "From", labelKey: "from", value: "Everyone", valueKey: "everyone" }]);
    expect(read.describeAction({ contact: "  " }, ctx).lines[0]).toMatchObject({ value: "Everyone", valueKey: "everyone" });
    // A contact named like a fixed value is still the user's word: shown as it is, never translated.
    expect(read.describeAction({ contact: "Everyone" }, ctx).lines).toEqual([{ label: "From", labelKey: "from", value: "Everyone" }]);
    expect(read.describeAction({ contact: "Ana" }, ctx).lines).toEqual([{ label: "From", labelKey: "from", value: "Ana" }]);
  });

  test("skills that can return other people's text taint the session", () => {
    expect(firstWinSkills.filter((s) => s.producesUntrusted).map((s) => s.id).sort()).toEqual(["calendar_read", "read_messages", "recall"]);
  });

  test("skillById returns undefined for unknown skills", () => {
    expect(skillById("shell")).toBeUndefined();
  });
});
