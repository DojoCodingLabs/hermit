import { describe, expect, it } from "vitest";
import { clip } from "../src/text.ts";

// #140: clip() never returns more than max characters. When the limit is too small to fit "...", it cuts without them.
describe("clip with a limit too small for ...", () => {
  it("cuts without the dots when the limit is under 4", () => {
    expect(clip("hello", 3)).toBe("hel");
    expect(clip("hello", 2)).toBe("he");
    expect(clip("hello", 1)).toBe("h");
    expect(clip("hello", 0)).toBe("");
  });

  it("keeps the dots from a limit of 4 up, as before", () => {
    expect(clip("hello", 4)).toBe("h...");
    expect(clip("hello world", 8)).toBe("hello...");
  });

  it("never returns more than the limit", () => {
    for (const text of ["hello", "Hola Ana, nos vemos el lunes", "uno dos tres"]) {
      for (let max = 0; max <= text.length + 2; max++) expect(clip(text, max).length, `${text} / ${max}`).toBeLessThanOrEqual(max);
    }
  });
});
