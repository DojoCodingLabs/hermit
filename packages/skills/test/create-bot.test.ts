/**
 * Multi-bot (Task 12, spec 6.4 "Creating a bot", 6.8): Hermit's create_bot. It proposes; it creates nothing and never
 * sets a mode. It is in no group, so only Hermit, the primary bot, holds it.
 */
import { expect, test } from "vitest";
import { MAX_BOT_NAME_CHARS, MAX_ROLE_CHARS, RESERVED_GROUPS, SKILL_GROUPS } from "@hermit/core";
import { createBotDef, MAX_PROPOSED_SITES } from "../src/bots.ts";

test("create_bot proposes and never sets a mode", () => {
  expect([createBotDef.id, createBotDef.risk, createBotDef.tier, createBotDef.group]).toEqual(["create_bot", "read", "low", undefined]);
  expect(Object.keys((createBotDef.args as { properties: object }).properties)).toEqual(["name", "role", "grants", "sites"]);
});
test("its arguments: a name and a role within a bot's limits, the groups a bot may hold by their ids, five sites at most", () => {
  const args = createBotDef.args as { properties: Record<string, object>; required: string[]; additionalProperties: boolean };
  expect([args.required, args.additionalProperties, createBotDef.producesUntrusted]).toEqual([["name", "role"], false, false]);
  expect(args.properties.name).toMatchObject({ type: "string", maxLength: MAX_BOT_NAME_CHARS });
  expect(args.properties.role).toMatchObject({ type: "string", maxLength: MAX_ROLE_CHARS });
  // The coordinator's ruling on concern 3: a group no screen shows (vault_logins in wave 1) is never proposed.
  expect(args.properties.grants).toEqual(expect.objectContaining({ type: "array", items: { type: "string", enum: SKILL_GROUPS.filter((g) => !RESERVED_GROUPS.includes(g)) }, uniqueItems: true }));
  expect(RESERVED_GROUPS).toEqual(["vault_logins"]);
  expect([MAX_PROPOSED_SITES, args.properties.sites]).toMatchObject([5, { type: "array", items: { type: "string" }, maxItems: 5 }]);
  expect(createBotDef.menuLine).toBe("Propose a new specialist bot when the user asks you to create or set up a bot (\"créame un bot que...\", \"hazme un bot para...\", \"make me a bot that...\"). It only shows a card; nothing is created until the user taps Create.");
});
