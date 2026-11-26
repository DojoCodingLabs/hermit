// FR-PRIV-02 through the composition root: the app's fetch wrapper records each host, the privacy screen lists them.
import { expect, test } from "vitest";
import { nodeSql } from "@hermit/sql-node";
import { ed25519Signer } from "@hermit/cage";
import { PROFILES } from "@hermit/model";
import { createHermit } from "../src/hermit.ts";

test("hosts recorded by the app are counted in the encrypted database and listed for HM-SET-02", async () => {
  let now = 10;
  const hermit = createHermit(
    {
      sql: nodeSql(),
      signer: ed25519Signer(new Uint8Array(32).fill(4)),
      notifier: { schedule: async () => "n", cancel: async () => {} },
      calendar: { list: async () => [], add: async () => {}, calendars: async () => [] },
      replySender: { send: async () => "sent" },
      engine: { complete: async () => ({ text: "", toolCalls: [] }) },
      approvals: { request: async () => ({ kind: "denied" }) },
      now: () => now,
      timeZone: () => "UTC",
      language: () => "en",
      newId: () => "id",
    },
    PROFILES[0]!,
  );
  await hermit.init();
  await hermit.hosts.record(PROFILES[0]!.file.url);
  now = 20;
  await hermit.hosts.record(PROFILES[0]!.file.url);
  expect(await hermit.hosts.list()).toEqual([{ host: "huggingface.co", count: 2, lastAt: 20 }]);
  expect(await hermit.settings.get("relay.dojo")).toBeUndefined(); // Dojo's relay is off until the user opts in
});
