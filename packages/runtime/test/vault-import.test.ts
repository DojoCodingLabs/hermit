/**
 * SL-34 (US-VAULT-03, FR-VAULT-03): importing a CSV into the vault. The file's content lives only in memory, the
 * preview carries names and sites only, one fingerprint seals everything, and the signed log gets one summary entry.
 */
import { describe, expect, test } from "vitest";
import { nodeSql } from "@hermit/sql-node";
import { IMPORT_LIMITS } from "@hermit/core";
import { ed25519Signer } from "@hermit/cage";
import { profileById, type CompletionEngine, type EngineRequest } from "@hermit/model";
import { createHermit } from "../src/hermit.ts";
import { VAULT_IDLE_MS } from "../src/vault.ts";
import { cipher, fakeKeystore, random, setup } from "./vault-fixtures.ts";

const utf8ToBytes = (s: string) => new TextEncoder().encode(s);

const SECRETS = ["gh-S3cret!", "ana@example.com", "PIN 4821", "bk-Pa55", "admin123", "new-gh-pass"];

const CSV = [
  "name,url,username,password,note",
  "GitHub,https://github.com/login,ana@example.com,new-gh-pass,",
  "Banco,https://banco.example/,ana@example.com,bk-Pa55,PIN 4821",
  "router,http://192.168.1.1/,admin,admin123,",
].join("\r\n");

const file = (s = CSV) => utf8ToBytes(s);

async function withSaved() {
  const w = await setup();
  await w.vault.create("p");
  const saved = await w.vault.save({ name: "GitHub work", origins: ["https://github.com"], username: "ana@example.com", secret: "gh-S3cret!", notes: "" }, "p");
  if (saved.kind !== "saved") throw new Error(saved.kind);
  return { ...w, githubId: saved.id };
}

describe("preparing an import", () => {
  test("the picked bytes are zeroed once read, whatever the outcome", async () => {
    const w = await withSaved();
    const ok = file();
    await w.vault.prepareImport(ok);
    expect(ok.every((b) => b === 0)).toBe(true);
    const bad = file("a,b\r\n1,\"open");
    expect(await w.vault.prepareImport(bad)).toEqual({ kind: "refused", problem: "bad_csv" });
    expect(bad.every((b) => b === 0)).toBe(true);
    w.vault.lock();
    const locked = file();
    expect(await w.vault.prepareImport(locked)).toEqual({ kind: "locked" });
    expect(locked.every((b) => b === 0)).toBe(true);
  });

  test("the preview lists names and sites and flags the saved login it duplicates; no secret is in it", async () => {
    const w = await withSaved();
    const r = await w.vault.prepareImport(file());
    if (r.kind !== "preview") throw new Error(r.kind);
    expect(r.preview.format).toBe("chrome");
    expect(r.preview.ready.map((x) => [x.row, x.name, x.origins, x.existing])).toEqual([
      [2, "GitHub", ["https://github.com"], [{ id: w.githubId, name: "GitHub work" }]],
      [3, "Banco", ["https://banco.example"], []],
    ]);
    expect(r.preview.refused).toEqual([{ row: 4, name: "router", site: "http://192.168.1.1/", problems: ["origin_not_https"] }]);
    const text = JSON.stringify(r);
    for (const v of SECRETS) expect(text).not.toContain(v);
  });

  test("an unknown header and a file over the caps are refused with their codes", async () => {
    const w = await withSaved();
    expect(await w.vault.prepareImport(file("a,b,c\r\n1,2,3"))).toEqual({ kind: "refused", problem: "unknown_format" });
    expect(await w.vault.prepareImport(new Uint8Array(IMPORT_LIMITS.bytes + 1))).toEqual({ kind: "refused", problem: "too_large" });
  });

  test("nothing from the file reaches the database before the import is approved", async () => {
    const w = await withSaved();
    await w.vault.prepareImport(file());
    const dump = JSON.stringify(await dumpTables(w.sql));
    for (const v of ["Banco", "banco.example", "new-gh-pass", "bk-Pa55", "PIN 4821", "admin123"]) expect(dump).not.toContain(v);
  });
});

describe("committing an import (one fingerprint)", () => {
  test("adds the new rows, skips the duplicate by default, all behind exactly one fingerprint", async () => {
    const w = await withSaved();
    await w.vault.prepareImport(file());
    const before = w.ks.s.prompts;
    const r = await w.vault.commitImport({}, "p");
    expect(r).toEqual({ kind: "imported", counts: { added: 1, replaced: 0, skipped: 1, refused: 1 } });
    expect(w.ks.s.prompts - before).toBe(1);
    const list = await w.vault.list();
    expect(list.kind === "items" && list.items.map((i) => i.name)).toEqual(["Banco", "GitHub work"]);
    // The saved GitHub login is untouched.
    const kept = await w.vault.reveal(w.githubId, "p");
    expect(kept.kind === "revealed" && kept.secrets.secret).toBe("gh-S3cret!");
  });

  test("replace overwrites the one saved login it duplicates (same id); keep both adds a second", async () => {
    const w = await withSaved();
    await w.vault.prepareImport(file());
    expect(await w.vault.commitImport({ 2: "replace" }, "p")).toMatchObject({ counts: { added: 1, replaced: 1, skipped: 0 } });
    const replaced = await w.vault.reveal(w.githubId, "p");
    expect(replaced.kind === "revealed" && replaced.secrets.secret).toBe("new-gh-pass");

    const v = await withSaved();
    await v.vault.prepareImport(file());
    expect(await v.vault.commitImport({ 2: "keep_both" }, "p")).toMatchObject({ counts: { added: 2, replaced: 0, skipped: 0 } });
    const list = await v.vault.list();
    expect(list.kind === "items" && list.items.map((i) => i.name)).toEqual(["Banco", "GitHub", "GitHub work"]);
  });

  test("a cancelled fingerprint imports nothing and keeps the preview for another try", async () => {
    const w = await withSaved();
    await w.vault.prepareImport(file());
    w.ks.s.next = "cancel";
    expect(await w.vault.commitImport({}, "p")).toEqual({ kind: "cancelled" });
    const list = await w.vault.list();
    expect(list.kind === "items" && list.items).toHaveLength(1);
    expect(await w.vault.commitImport({}, "p")).toMatchObject({ kind: "imported" });
  });

  test("after the import (or a cancel, or a lock) the file's content is dropped: a second commit has nothing", async () => {
    const w = await withSaved();
    await w.vault.prepareImport(file());
    await w.vault.commitImport({}, "p");
    expect(await w.vault.commitImport({}, "p")).toEqual({ kind: "nothing_pending" });

    await w.vault.prepareImport(file());
    w.vault.cancelImport();
    expect(await w.vault.commitImport({}, "p")).toEqual({ kind: "nothing_pending" });

    await w.vault.prepareImport(file());
    w.vault.lock();
    await w.vault.unlock("p");
    expect(await w.vault.commitImport({}, "p")).toEqual({ kind: "nothing_pending" });

    await w.vault.prepareImport(file());
    w.tick(VAULT_IDLE_MS + 1);
    expect(await w.vault.commitImport({}, "p")).toEqual({ kind: "locked" });
    await w.vault.unlock("p");
    expect(await w.vault.commitImport({}, "p")).toEqual({ kind: "nothing_pending" });
  });

  test("every key handed out for the import is zeroed", async () => {
    const w = await withSaved();
    await w.vault.prepareImport(file());
    await w.vault.commitImport({}, "p");
    for (const k of w.ks.s.handedOut) expect(k.every((b) => b === 0)).toBe(true);
  });

  test("the database holds the imported secrets only sealed", async () => {
    const w = await withSaved();
    await w.vault.prepareImport(file());
    await w.vault.commitImport({ 2: "replace" }, "p");
    const dump = JSON.stringify(await dumpTables(w.sql));
    for (const v of SECRETS) expect(dump).not.toContain(v);
  });
});

describe("the signed log", () => {
  test("one summary entry with counts, and no name, site, id or secret", async () => {
    const w = await withSaved();
    const before = (await w.audit.entries()).length;
    await w.vault.prepareImport(file());
    await w.vault.commitImport({ 2: "replace" }, "p");
    const added = (await w.audit.entries()).slice(before);
    expect(added.map((e) => [e.event, e.reason])).toEqual([["vault", "vault.imported added=1 replaced=1 skipped=0 refused=1"]]);
    expect(added[0]!.argsHash).toMatch(/^[0-9a-f]{64}$/);
    const text = JSON.stringify(added);
    for (const v of [...SECRETS, "Banco", "GitHub", "banco.example", "github.com", w.githubId]) expect(text).not.toContain(v);
    expect(await w.audit.verify(await ed25519Signer(new Uint8Array(32).fill(4)).publicKey())).toEqual({ ok: true });
  });
});

describe("secrets never reach the model", () => {
  test("after an import, no prompt holds any part of the file", async () => {
    const sql = nodeSql();
    const requests: EngineRequest[] = [];
    const engine: CompletionEngine = {
      async complete(req) {
        requests.push(req);
        return { text: requests.length % 2 ? '{"choice":"respond"}' : "No puedo ver tus contraseñas.", toolCalls: [] };
      },
    };
    const ks = fakeKeystore();
    let n = 0;
    const hermit = createHermit(
      {
        sql,
        signer: ed25519Signer(new Uint8Array(32).fill(4)),
        notifier: { schedule: async () => "n", cancel: async () => {} },
        calendar: { list: async () => [], add: async () => {}, calendars: async () => [] },
        replySender: { send: async () => "sent" },
        engine,
        approvals: { request: async (r) => ({ kind: "approved", biometric: true, argsHash: r.call.argsHash }) },
        now: () => Date.UTC(2026, 10, 15),
        timeZone: () => "America/Costa_Rica",
        language: () => "es-419",
        newId: () => `id${++n}`,
        vault: { key: ks.port, cipher, random, onScreen: () => true },
      },
      profileById("botpsy-q4-two-stage-nothink")!,
    );
    await hermit.init();
    const vault = hermit.vault!;
    await vault.create("p");
    expect(await vault.prepareImport(file())).toMatchObject({ kind: "preview" });
    expect(await vault.commitImport({}, "p")).toMatchObject({ kind: "imported" });
    const s = await hermit.startSession();
    await hermit.send(s, "¿qué contraseñas importé del archivo?");
    const seen = JSON.stringify(requests);
    for (const v of [...SECRETS, "banco.example"]) expect(seen).not.toContain(v);
    const activity = JSON.stringify(await hermit.activity());
    for (const v of [...SECRETS, "Banco", "banco.example"]) expect(activity).not.toContain(v);
  });
});

async function dumpTables(sql: ReturnType<typeof nodeSql>) {
  const tables = (await sql.query<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")).map((t) => t.name);
  const out: Record<string, unknown> = {};
  for (const t of tables) out[t] = await sql.query(`SELECT * FROM "${t}"`);
  return out;
}
