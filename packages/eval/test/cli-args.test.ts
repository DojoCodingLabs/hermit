import { expect, test } from "vitest";
import { parseCliArgs } from "../src/cli-args.ts";

test("a cases file without --model uses the fake model", () => {
  expect(parseCliArgs(["my.jsonl"])).toEqual({ file: "my.jsonl", model: "fake" });
});

test("--model is read from the flag", () => {
  expect(parseCliArgs(["--model", "qvac", "my.jsonl"])).toEqual({ file: "my.jsonl", model: "qvac" });
});

test("no arguments means default cases and fake model", () => {
  expect(parseCliArgs([])).toEqual({ file: undefined, model: "fake" });
});
