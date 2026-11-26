/** SL-32: HM-ACT-02 entry details and the logged clear of HM-ACT-01, through the composition root. */
import { describe, expect, test } from "vitest";
import { nodeSql } from "@hermit/sql-node";
import { ed25519Signer } from "@hermit/cage";
import { profileById, type CompletionEngine } from "@hermit/model";
import { createHermit } from "../src/hermit.ts";

const PROFILE = profileById("botpsy-q4-two-stage-nothink")!;
let clock = 1_000;

function setup(script: string[]) {
  const sql = nodeSql();
  let i = 0;
  const engine: CompletionEngine = { complete: async () => ({ text: script[i++] ?? '{"choice":"respond"}', toolCalls: [] }) };
  let n = 0;
  const hermit = createHermit(
    {
      sql,
      signer: ed25519Signer(new Uint8Array(32).fill(6)),
      notifier: { schedule: async () => "n", cancel: async () => {} },
      calendar: { list: async () => [], add: async () => {}, calendars: async () => [] },
      replySender: { send: async () => "sent" },
      engine,
      approvals: { request: async (r) => ({ kind: "approved", biometric: true, argsHash: r.call.argsHash }) },
      now: () => clock,
      timeZone: () => "America/Costa_Rica",
      language: () => "en",
      newId: () => `id${++n}`,
    },
    PROFILE,
  );
  return { hermit, sql };
}

async function withOneCall() {
  const w = setup(['{"choice":"remember","args":{"fact":"My passport expires in March"}}', '{"choice":"respond"}', "Saved."]);
  await w.hermit.init();
  await w.hermit.send(await w.hermit.startSession(), "remember my passport expires in March");
  return w;
}

describe("activity details and a logged clear (SL-32)", () => {
  test("a row opens its entries with hashes and signature, never the remembered text", async () => {
    const w = await withOneCall();
    const { rows } = await w.hermit.activity();
    const detail = await w.hermit.activityEntry(rows[0]!.seq);
    expect(detail?.map((d) => d.event)).toEqual(["call_proposed", "policy_decided", "executed"]);
    expect(detail?.every((d) => d.skill === "remember" && /^[0-9a-f]{64}$/.test(d.hash) && /^[0-9a-f]{128}$/.test(d.sig))).toBe(true);
    expect(JSON.stringify(detail)).not.toContain("passport");
    expect(await w.hermit.activityEntry(999)).toBeUndefined();
  });

  test("clearing leaves exactly one logged entry, with the previous count, and the chain verifies", async () => {
    const w = await withOneCall();
    const before = (await w.sql.query<{ n: number }>("SELECT COUNT(*) AS n FROM audit"))[0]!.n;
    clock = 5_000;
    const out = await w.hermit.clearActivity();
    expect(out).toEqual({ kind: "cleared", count: before });
    const { rows, chain } = await w.hermit.activity();
    expect(rows).toEqual([expect.objectContaining({ seq: 1, mark: "cleared", clearedCount: before, at: 5_000 })]);
    expect(chain).toEqual({ kind: "verified", count: 1 });
  });

  test("the log keeps working after a clear", async () => {
    const remember = ['{"choice":"remember","args":{"fact":"x"}}', '{"choice":"respond"}', "Ok."];
    const w = setup([...remember, ...remember]);
    await w.hermit.init();
    const s = await w.hermit.startSession();
    await w.hermit.send(s, "remember x");
    await w.hermit.clearActivity();
    await w.hermit.send(s, "remember x");
    const { rows, chain } = await w.hermit.activity();
    expect(rows.map((r) => r.mark)).toEqual(["ran", "cleared"]);
    expect(chain.kind).toBe("verified");
  });

  test("a broken chain is read-only evidence: the clear is refused and nothing changes (EC-ACT-02)", async () => {
    const w = await withOneCall();
    await w.sql.exec("DROP TRIGGER IF EXISTS audit_no_update");
    await w.sql.exec("UPDATE audit SET skill = 'pay' WHERE seq = 2");
    const before = await w.sql.query("SELECT * FROM audit ORDER BY seq");
    expect(await w.hermit.clearActivity()).toEqual({ kind: "refused_broken" });
    expect(await w.sql.query("SELECT * FROM audit ORDER BY seq")).toEqual(before);
  });
});
