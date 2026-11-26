import { describe, expect, test } from "vitest";
import { coerceArgs, parseArgs, repairSkillName, validateArgs } from "../src/repair.ts";

const menu = ["remember", "recall", "forget", "remind", "reply_message", "read_messages"];
const schema = {
  type: "object",
  properties: {
    conversationId: { type: "string", maxLength: 8, pattern: "^[a-z0-9]+$" },
    text: { type: "string", maxLength: 10 },
    count: { type: "integer" },
    urgent: { type: "boolean" },
  },
  required: ["conversationId", "text"],
  additionalProperties: false,
};

describe("repairSkillName", () => {
  test("repairs common skill-name slips", () => {
    for (const raw of ["Reply-Message", "replyMessage", "reply_message_tool", "reply_mesage", "REPLY MESSAGE"]) {
      expect(repairSkillName(raw, menu)?.name, raw).toBe("reply_message");
    }
    expect(repairSkillName("remember", menu)).toEqual({ name: "remember", repaired: false });
  });

  test("rejects names that are not on the menu", () => {
    expect(repairSkillName("shell", menu)).toBeNull();
    expect(repairSkillName("execute_code", menu)).toBeNull();
  });
});

describe("parseArgs", () => {
  test("parses fenced json with trailing commas", () => {
    const r = parseArgs('```json\n{"a": 1, "b": [1, 2,],}\n```');
    expect(r.value).toEqual({ a: 1, b: [1, 2] });
    expect(r.repairs.length).toBeGreaterThan(0);
  });

  test("maps python literals", () => {
    expect(parseArgs('{"a": None, "b": True, "c": False}').value).toEqual({ a: null, b: true, c: false });
  });

  test("throws on hopeless json", () => {
    expect(() => parseArgs("I think you should call remember")).toThrow(/bad_json/);
  });
});

describe("coerceArgs and validateArgs", () => {
  test("coerces numeric and boolean strings", () => {
    const r = coerceArgs({ conversationId: "c1", text: "hi", count: "42", urgent: "true" }, schema);
    expect(r.args).toEqual({ conversationId: "c1", text: "hi", count: 42, urgent: true });
  });

  test("drops undeclared properties", () => {
    const r = coerceArgs({ conversationId: "c1", text: "hi", to: "Ana" }, schema);
    expect(r.args).toEqual({ conversationId: "c1", text: "hi" });
    expect(r.repairs).toContain("dropped:to");
  });

  test("validate reports missing required, too long and pattern mismatch", () => {
    expect(validateArgs({ conversationId: "c1", text: "hi" }, schema)).toEqual([]);
    const errors = validateArgs({ conversationId: "C-1!", text: "this is far too long" }, schema);
    expect(errors.join(" ")).toMatch(/conversationId/);
    expect(errors.join(" ")).toMatch(/text/);
    expect(validateArgs({ text: "hi" }, schema).join(" ")).toMatch(/conversationId is required/);
  });
});

describe("hostile keys", () => {
  test("__proto__ from model json cannot satisfy required fields", () => {
    const parsed = parseArgs('{"conversationId": "c1", "__proto__": {"text": "smuggled"}}').value;
    const { args } = coerceArgs(parsed, schema);
    expect(Object.getPrototypeOf(args)).not.toEqual({ text: "smuggled" });
    expect((args as Record<string, unknown>).text).toBeUndefined();
    expect(validateArgs(args, schema).join(" ")).toMatch(/text is required/);
  });

  test("prototype names are never treated as declared properties", () => {
    const open = { type: "object", properties: { a: { type: "string" } } };
    const { args, repairs } = coerceArgs({ constructor: "x", toString: "y", a: "ok" }, open);
    expect(Object.keys(args)).toEqual(["a"]);
    expect(repairs).toEqual(expect.arrayContaining(["dropped:constructor", "dropped:toString"]));
  });
});
