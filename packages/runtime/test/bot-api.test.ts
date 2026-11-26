import { expect, test } from "vitest";
import { BOT_REFUSALS, RUN_PRIORITIES, cacheKeyFor, typedWordOk } from "../src/bot-api.ts";

test("priorities run user, reply, handoff, routine", () => expect(RUN_PRIORITIES).toEqual(["user", "reply", "handoff", "routine"]));
test("the prompt-cache key is per bot", () => expect(cacheKeyFor("b7")).toBe("hermit-v1:b7"));
test("Don't ask takes the typed word in either language", () => {
  for (const ok of ["entiendo", " Entiendo. ", "I understand", "i understand!"]) expect(typedWordOk(ok), ok).toBe(true);
  for (const no of ["", "ok", "entiendo que no", "entiend"]) expect(typedWordOk(no), no).toBe(false);
});
test("the refusals are a closed list", () => expect(BOT_REFUSALS).toHaveLength(14));
