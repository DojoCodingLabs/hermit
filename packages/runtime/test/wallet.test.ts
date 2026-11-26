/**
 * SL-38 (US-PAY-01, US-PAY-02, FR-PAY-01): the wallet service over a fake Keystore, a fake worklet and a memory record,
 * with the real schema and the real signed log; and, through the composition root, the checks that the words never
 * reach the database, the model, the log or a night run.
 */
import { describe, expect, test, vi } from "vitest";
import { nodeSql } from "@hermit/sql-node";
import { parseWalletRecord, walletIdHash, WALLET_NETWORK } from "@hermit/core";
import { ed25519Signer } from "@hermit/cage";
import { profileById, type CompletionEngine, type EngineRequest } from "@hermit/model";
import { DEFAULT_NIGHT_SETTINGS, type DeviceState } from "@hermit/night";
import { createHermit } from "../src/hermit.ts";
import { fakeKeystore, random } from "./vault-fixtures.ts";
import { answersFor, fakeWorklet, memoryRecord, setupWallet } from "./wallet-fixtures.ts";

const ABOUT = "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";
const LEGAL = "legal winner thank year wave sausage worth useful legal winner thank yellow";

/**
 * Any three consecutive words of the phrase, in order, with anything but letters between them (a JSON array, a
 * sentence): the shape a leak takes. Single words alone are common English and say nothing.
 */
const leaks = (text: string, words: readonly string[]) => {
  const found: string[] = [];
  for (let i = 0; i + 3 <= words.length; i++) {
    const w = words.slice(i, i + 3);
    if (new RegExp(`\\b${w.join("[^a-z]+")}\\b`, "i").test(text)) found.push(w.join(" "));
  }
  return found;
};

describe("create (US-PAY-01)", () => {
  test("none, then created behind the fingerprint that stores the wallet key; the backup is still owed", async () => {
    const w = await setupWallet();
    expect(await w.wallet.status()).toBe("none");
    const r = await w.wallet.create("p");
    expect(r).toMatchObject({ kind: "created" });
    expect(w.ks.s.prompts).toBe(1);
    expect(await w.wallet.status()).toBe("needs_backup");
    const rec = parseWalletRecord(w.record.s.text!)!;
    expect(rec).toMatchObject({ id: "w1", words: 12, source: "created", chainId: 2201, path: WALLET_NETWORK.path });
    expect(rec.backedUpAt).toBeUndefined();
    expect(r.kind === "created" && r.address).toBe(rec.address);
  });

  test("one wallet per device: a second create or a restore is refused while one exists", async () => {
    const w = await setupWallet();
    await w.wallet.create("p");
    expect(await w.wallet.create("p")).toEqual({ kind: "exists" });
    expect(await w.wallet.restore(ABOUT, "p")).toEqual({ kind: "exists" });
    expect(w.worklet.s.calls.filter((c) => c === "create")).toHaveLength(1);
  });

  test("a cancelled fingerprint or a phone without one makes nothing", async () => {
    const w = await setupWallet();
    w.ks.s.next = "cancel";
    expect(await w.wallet.create("p")).toEqual({ kind: "cancelled" });
    expect(await w.wallet.status()).toBe("none");
    expect(w.worklet.s.calls).toEqual([]);
  });

  test("a worklet that fails leaves no record", async () => {
    const w = await setupWallet();
    w.worklet.s.fail = "create";
    expect(await w.wallet.create("p")).toEqual({ kind: "failed" });
    expect(await w.wallet.status()).toBe("none");
  });

  test("unattended (not on screen) nothing is created, revealed or restored, and no fingerprint is asked", async () => {
    let on = false;
    const w = await setupWallet({ onScreen: () => on });
    expect(await w.wallet.create("p")).toEqual({ kind: "not_on_screen" });
    expect(await w.wallet.restore(ABOUT, "p")).toEqual({ kind: "not_on_screen" });
    on = true;
    await w.wallet.create("p");
    on = false;
    expect(await w.wallet.reveal("p")).toEqual({ kind: "not_on_screen" });
    expect(w.ks.s.prompts).toBe(1);
  });

  test("every wallet key handed to the worklet is zeroed once it answers", async () => {
    const w = await setupWallet();
    await w.wallet.create("p");
    const shown = await w.wallet.reveal("p");
    if (shown.kind !== "words") throw new Error(shown.kind);
    expect(w.worklet.s.keysSeen).toHaveLength(2);
    for (const k of [...w.worklet.s.keysSeen, ...w.ks.s.handedOut]) expect(k.every((b) => b === 0)).toBe(true);
  });
});

describe("a stored record that can't be read (security review)", () => {
  test("counts as lost, never as none: create refuses to overwrite it, and nothing is written", async () => {
    const w = await setupWallet();
    w.record.s.text = "{not a wallet record";
    expect(await w.wallet.status()).toBe("lost");
    expect(await w.wallet.create("p")).toEqual({ kind: "exists" });
    expect(w.record.s.text).toBe("{not a wallet record");
  });
});

describe("back up (US-PAY-01: shown once behind a fingerprint, three words confirmed)", () => {
  test("reveal asks a fresh fingerprint, shows 12 words and asks three of them; the right answers finish the backup", async () => {
    const w = await setupWallet();
    await w.wallet.create("p");
    const before = w.ks.s.prompts;
    const shown = await w.wallet.reveal("p");
    if (shown.kind !== "words") throw new Error(shown.kind);
    expect(w.ks.s.prompts).toBe(before + 1);
    expect(shown.words).toHaveLength(12);
    expect(shown.positions).toHaveLength(3);
    expect(await w.wallet.confirmBackup(answersFor(shown.words, shown.positions))).toBe("confirmed");
    expect(await w.wallet.status()).toBe("ready");
    expect(parseWalletRecord(w.record.s.text!)!.backedUpAt).toBe(1_000);
  });

  test("once backed up the words are never shown again", async () => {
    const w = await setupWallet();
    await w.wallet.create("p");
    const shown = await w.wallet.reveal("p");
    if (shown.kind !== "words") throw new Error(shown.kind);
    await w.wallet.confirmBackup(answersFor(shown.words, shown.positions));
    const prompts = w.ks.s.prompts;
    expect(await w.wallet.reveal("p")).toEqual({ kind: "backed_up" });
    expect(w.ks.s.prompts).toBe(prompts);
  });

  test("a wrong word fails the check and drops it: the words must be shown again, behind another fingerprint", async () => {
    const w = await setupWallet();
    await w.wallet.create("p");
    const shown = await w.wallet.reveal("p");
    if (shown.kind !== "words") throw new Error(shown.kind);
    const wrong = answersFor(shown.words, shown.positions);
    wrong[1] = wrong[1] === "zoo" ? "abandon" : "zoo";
    expect(await w.wallet.confirmBackup(wrong)).toBe("mismatch");
    expect(await w.wallet.confirmBackup(answersFor(shown.words, shown.positions))).toBe("nothing_pending");
    expect(await w.wallet.status()).toBe("needs_backup");
  });

  test("locking (the app lock, leaving the screen) drops a pending check", async () => {
    const w = await setupWallet();
    await w.wallet.create("p");
    const shown = await w.wallet.reveal("p");
    if (shown.kind !== "words") throw new Error(shown.kind);
    w.wallet.lock();
    expect(await w.wallet.confirmBackup(answersFor(shown.words, shown.positions))).toBe("nothing_pending");
  });

  test("a cancelled fingerprint shows nothing; new fingerprints make the wallet lost", async () => {
    const w = await setupWallet();
    await w.wallet.create("p");
    w.ks.s.next = "cancel";
    expect(await w.wallet.reveal("p")).toEqual({ kind: "cancelled" });
    w.ks.s.invalidated = true;
    expect(await w.wallet.reveal("p")).toEqual({ kind: "lost" });
    expect(await w.wallet.status()).toBe("lost");
  });

  test("the screen must still be showing after the fingerprint, or the words are not handed over", async () => {
    let on = true;
    const w = await setupWallet({ onScreen: () => on });
    await w.wallet.create("p");
    const unwrap = w.ks.port.unwrap.bind(w.ks.port);
    w.ks.port.unwrap = async (prompt) => {
      const r = await unwrap(prompt);
      on = false;
      return r;
    };
    expect(await w.wallet.reveal("p")).toEqual({ kind: "not_on_screen" });
  });
});

describe("restore (US-PAY-02)", () => {
  test("an invalid phrase is named before any fingerprint", async () => {
    const w = await setupWallet();
    expect(await w.wallet.restore("abandon abandon", "p")).toEqual({ kind: "invalid", check: { ok: false, problem: "word_count", count: 2 } });
    expect(await w.wallet.restore(ABOUT.replace(/about$/, "abandon"), "p")).toEqual({ kind: "invalid", check: { ok: false, problem: "checksum" } });
    expect(w.ks.s.prompts).toBe(0);
    expect(w.worklet.s.calls).toEqual([]);
  });

  test("the derived address and its balance are shown before anything is committed", async () => {
    const w = await setupWallet();
    w.worklet.s.balance = 2_500_000n;
    const r = await w.wallet.restore(`  ${LEGAL.toUpperCase()} `, "p");
    if (r.kind !== "preview") throw new Error(r.kind);
    expect(r.address).toMatch(/^0x[0-9a-f]{40}$/);
    expect(r.balance).toEqual({ amount: 2_500_000n, asset: "USDT", network: "eip155:2201" });
    expect(w.record.s.text).toBeUndefined();
    expect(await w.wallet.status()).toBe("none");
    expect(await w.wallet.commitRestore()).toBe("restored");
    const rec = parseWalletRecord(w.record.s.text!)!;
    expect(rec).toMatchObject({ address: r.address, source: "restored", backedUpAt: 1_000 });
    expect(await w.wallet.status()).toBe("ready");
    // Restored words were typed by the user: nothing is shown again.
    expect(await w.wallet.reveal("p")).toEqual({ kind: "backed_up" });
  });

  test("the same words restore the same address as the wallet they came from", async () => {
    const a = await setupWallet();
    await a.wallet.create("p");
    const shown = await a.wallet.reveal("p");
    if (shown.kind !== "words") throw new Error(shown.kind);
    const b = await setupWallet();
    const r = await b.wallet.restore(shown.words.join(" "), "p");
    expect(r.kind === "preview" && r.address).toBe(parseWalletRecord(a.record.s.text!)!.address);
  });

  test("offline, the preview still shows the address and says the balance is unknown", async () => {
    const w = await setupWallet();
    w.worklet.s.offline = true;
    const r = await w.wallet.restore(ABOUT, "p");
    expect(r).toMatchObject({ kind: "preview" });
    expect(r.kind === "preview" && r.balance).toBeUndefined();
  });

  test("Not my wallet: nothing is committed and the new wallet key is destroyed", async () => {
    const w = await setupWallet();
    await w.wallet.restore(ABOUT, "p");
    await w.wallet.cancelRestore();
    expect(w.ks.s.destroyed).toBe(1);
    expect(await w.wallet.commitRestore()).toBe("nothing_pending");
    expect(await w.wallet.status()).toBe("none");
  });

  test("a lost wallet can be restored over, or started over", async () => {
    const w = await setupWallet();
    await w.wallet.create("p");
    w.ks.s.invalidated = true;
    await w.wallet.reveal("p");
    expect(await w.wallet.status()).toBe("lost");
    expect(await w.wallet.create("p")).toEqual({ kind: "exists" });
    const r = await w.wallet.restore(ABOUT, "p");
    expect(r.kind).toBe("preview");
    expect(await w.wallet.commitRestore()).toBe("restored");
    expect(await w.wallet.status()).toBe("ready");

    const v = await setupWallet();
    await v.wallet.create("p");
    v.ks.s.invalidated = true;
    expect(await v.wallet.startOver()).toBe("not_lost");
    await v.wallet.reveal("p");
    expect(await v.wallet.startOver()).toBe("done");
    expect(await v.wallet.status()).toBe("none");
    expect(v.record.s.text).toBeUndefined();
    expect(v.ks.s.destroyed).toBe(1);
  });
});

describe("balance (HM-PAY-01)", () => {
  test("USD₮ on Stable testnet, read with no fingerprint; offline says so", async () => {
    const w = await setupWallet();
    expect(await w.wallet.balance()).toEqual({ kind: "none" });
    await w.wallet.create("p");
    const prompts = w.ks.s.prompts;
    w.worklet.s.balance = 1_230_000n;
    expect(await w.wallet.balance()).toEqual({ kind: "balance", usdt: { amount: 1_230_000n, asset: "USDT", network: "eip155:2201" } });
    w.worklet.s.offline = true;
    expect(await w.wallet.balance()).toEqual({ kind: "unavailable" });
    expect(w.ks.s.prompts).toBe(prompts);
  });
});

describe("where the words never go", () => {
  test("the signed log names the wallet by its id hash and an action code only", async () => {
    const w = await setupWallet();
    await w.wallet.create("p");
    const shown = await w.wallet.reveal("p");
    if (shown.kind !== "words") throw new Error(shown.kind);
    await w.wallet.confirmBackup(answersFor(shown.words, shown.positions));
    const entries = await w.audit.entries();
    expect(entries.map((e) => [e.event, e.reason, e.argsHash])).toEqual([
      ["wallet", "wallet.created", walletIdHash("w1")],
      ["wallet", "wallet.revealed", walletIdHash("w1")],
      ["wallet", "wallet.backed_up", walletIdHash("w1")],
    ]);
    const address = parseWalletRecord(w.record.s.text!)!.address;
    const dump = JSON.stringify(entries);
    expect(leaks(dump, shown.words)).toEqual([]);
    expect(dump.toLowerCase()).not.toContain(address.slice(2).toLowerCase());
    expect(dump).not.toContain("w1\"");
  });

  test("nothing is written to the database but the log, and nothing at all is logged to the console", async () => {
    const spies = (["log", "info", "warn", "error", "debug"] as const).map((m) => vi.spyOn(console, m));
    try {
      const w = await setupWallet();
      await w.wallet.create("p");
      const shown = await w.wallet.reveal("p");
      if (shown.kind !== "words") throw new Error(shown.kind);
      await w.wallet.confirmBackup(answersFor(shown.words, shown.positions));
      for (const s of spies) expect(s).not.toHaveBeenCalled();
      const tables = (await w.sql.query<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table'")).map((r) => r.name);
      let dump = "";
      for (const t of tables) dump += JSON.stringify(await w.sql.query(`SELECT * FROM "${t}"`));
      expect(leaks(dump, shown.words)).toEqual([]);
      // The record holds the sealed seed, never the words or the entropy in the clear.
      expect(leaks(w.record.s.text!, shown.words)).toEqual([]);
    } finally {
      for (const s of spies) s.mockRestore();
    }
  });
});

describe("the wallet in the composition root", () => {
  const PROFILE = profileById("botpsy-q4-two-stage-nothink")!;
  const COOL: DeviceState = { charging: true, batteryPercent: 90, thermalStatus: 0, screenOn: false, network: "wifi" };

  function hermitWithWallet() {
    const requests: EngineRequest[] = [];
    const engine: CompletionEngine = {
      async complete(req) {
        requests.push(req);
        return { text: '{"answer":"Listo.","quotes":[]}', toolCalls: [] };
      },
    };
    const ks = fakeKeystore();
    const worklet = fakeWorklet();
    const record = memoryRecord();
    const touched: string[] = [];
    const watch = <T extends object>(name: string, o: T): T =>
      new Proxy(o, { get: (t, k) => (typeof (t as Record<PropertyKey, unknown>)[k] === "function" ? (...a: unknown[]) => (touched.push(`${name}.${String(k)}`), (t as Record<PropertyKey, (...x: unknown[]) => unknown>)[k]!(...a)) : (t as Record<PropertyKey, unknown>)[k]) });
    let n = 0;
    const hermit = createHermit(
      {
        sql: nodeSql(),
        signer: ed25519Signer(new Uint8Array(32).fill(5)),
        notifier: { schedule: async () => "n", cancel: async () => {} },
        calendar: { list: async () => [], add: async () => {}, calendars: async () => [] },
        replySender: { send: async () => "sent" },
        engine,
        approvals: { request: async () => ({ kind: "denied" }) },
        wallet: {
          key: watch("key", ks.port), record: watch("record", record.port), worklet: watch("worklet", worklet.port), random, onScreen: () => true,
          chain: watch("chain", { call: async (method: string) => (method === "eth_blockNumber" ? "0x100" : []) }),
          payees: async () => (touched.push("payees"), []),
        },
        now: () => Date.UTC(2026, 10, 14, 8),
        timeZone: () => "America/Costa_Rica",
        language: () => "es-419",
        newId: () => `id${++n}`,
      },
      PROFILE,
    );
    return { hermit, requests, touched, worklet };
  }

  test("a night run never touches the wallet: no key, no record, no worklet", async () => {
    const w = hermitWithWallet();
    await w.hermit.init();
    await w.hermit.night.saveSettings({ ...DEFAULT_NIGHT_SETTINGS, enabled: true });
    w.touched.length = 0;
    await w.hermit.night.run({ conditions: () => COOL, noticeTitle: "x" });
    expect(w.touched).toEqual([]);
  });

  test("the model never sees the words: no skill names the wallet, and a turn after a backup carries none of them", async () => {
    const w = hermitWithWallet();
    await w.hermit.init();
    const wallet = w.hermit.wallet!;
    await wallet.create("p");
    const shown = await wallet.reveal("p");
    if (shown.kind !== "words") throw new Error(shown.kind);
    // The watch works: the screens' calls are seen (so the night test's empty list means something).
    expect(w.touched).toContain("worklet.create");
    expect(w.touched).toContain("key.unwrap");
    // And the leak check finds a leak when there is one.
    expect(leaks(JSON.stringify({ x: shown.words }), shown.words)).toHaveLength(10);
    const session = await w.hermit.startSession();
    await w.hermit.send(session, "¿Qué hay en mi billetera?").catch(() => undefined);
    expect(w.requests.length).toBeGreaterThan(0);
    const sent = JSON.stringify(w.requests);
    expect(leaks(sent, shown.words)).toEqual([]);
    expect(sent).not.toMatch(/"name":"[^"]*wallet[^"]*"/i);
  });

  test("SL-39: a night run after the screens read the balance and history still touches nothing in the wallet", async () => {
    const w = hermitWithWallet();
    await w.hermit.init();
    await w.hermit.wallet!.create("p");
    await w.hermit.wallet!.balance();
    expect((await w.hermit.wallet!.history()).kind).toBe("page");
    expect(w.touched).toContain("chain.call");
    expect(w.touched).toContain("payees");
    await w.hermit.night.saveSettings({ ...DEFAULT_NIGHT_SETTINGS, enabled: true });
    w.touched.length = 0;
    await w.hermit.night.run({ conditions: () => COOL, noticeTitle: "x" });
    expect(w.touched).toEqual([]);
  });

  test("SL-39: the model can't read the balance or the history (no read skill in the packet), and a turn carries neither", async () => {
    const w = hermitWithWallet();
    await w.hermit.init();
    await w.hermit.wallet!.create("p");
    w.worklet.s.balance = 4_321_987n;
    expect(await w.hermit.wallet!.balance()).toMatchObject({ kind: "balance" });
    await w.hermit.wallet!.history();
    w.touched.length = 0;
    const session = await w.hermit.startSession();
    await w.hermit.send(session, "¿Cuánto saldo tengo en USD₮?").catch(() => undefined);
    expect(w.requests.length).toBeGreaterThan(0);
    // The turn asked nothing of the wallet, the RPC or the payees.
    expect(w.touched).toEqual([]);
    const sent = JSON.stringify(w.requests);
    expect(sent).not.toMatch(/"name":"[^"]*(balance|wallet|transfer|history|receive|saldo)[^"]*"/i);
    expect(sent).not.toContain("4321987");
    expect(sent).not.toMatch(/4[.,]32/);
  });
});
