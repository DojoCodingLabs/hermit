import { beforeEach, describe, expect, test } from "vitest";
import { nodeSql } from "@hermit/sql-node";
import { createEventLog, EventError, type EventLog } from "../src/events.ts";
import { migrate } from "../src/schema.ts";

let log: EventLog;
beforeEach(async () => {
  const sql = nodeSql();
  await migrate(sql);
  log = createEventLog(sql, () => 1000);
});

describe("local events (CT-03)", () => {
  test("records and lists with the shared envelope", async () => {
    await log.record({ name: "EVT-MODEL-01", sessionId: "s1", props: { ttfaMs: 4200, outcome: "responded", gpu: true } });
    expect(await log.list()).toEqual([{ name: "EVT-MODEL-01", at: 1000, sessionId: "s1", props: { ttfaMs: 4200, outcome: "responded", gpu: true } }]);
  });

  test("accepts hosts and codes", async () => {
    await log.record({ name: "EVT-PRIV-01", props: { host: "huggingface.co" } });
    expect(await log.list({ name: "EVT-PRIV-01" })).toHaveLength(1);
  });

  test("refuses anything that looks like content", async () => {
    await expect(log.record({ name: "EVT-MSG-01", props: { text: "hola Ana voy tarde" } })).rejects.toThrow(EventError);
    await expect(log.record({ name: "EVT-MSG-01", props: { code: "x".repeat(65) } })).rejects.toThrow(EventError);
  });

  test("refuses unknown event names", async () => {
    // @ts-expect-error not a defined event
    await expect(log.record({ name: "EVT-NOPE-01", props: {} })).rejects.toThrow(EventError);
  });

  test("clear empties the log", async () => {
    await log.record({ name: "EVT-CAGE-01", props: { rule: "hard-floor" } });
    await log.clear();
    expect(await log.list()).toEqual([]);
  });
});
