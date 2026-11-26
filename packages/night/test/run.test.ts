import { describe, expect, test } from "vitest";
import { argsHash, skillId, type SessionState } from "@hermit/core";
import { decide, verifyChain } from "@hermit/cage";
import { firstWinSkills } from "@hermit/skills";
import { NightAborted, nightRules, nightStep, runNightShift, type Briefing } from "../src/index.ts";
import { account, at, COOL, header, HOT, INJECTED, settings, world } from "./helpers.ts";

const call = (skill: string, args: Record<string, unknown> = {}) => ({ id: "c1", skill: skillId(skill), args, argsHash: argsHash(args), repairs: [] });
const night = (over: Partial<SessionState> = {}): SessionState => ({ id: "n1", taint: [], unattended: true, ...over });

describe("night rules (US-CAGE-02, FR-CAGE-02)", () => {
  test("turning on the email job lets the night shift read unread mail, and nothing else changes", () => {
    const rules = nightRules(["mail"]);
    expect(decide(call("mail_list"), "network", night(), rules).effect).toBe("allow");
    // Not granted: searching or opening mail, and any read the jobs don't name.
    expect(decide(call("mail_search"), "network", night(), rules).effect).toBe("deny");
    expect(decide(call("mail_read", { messageId: "m1" }), "network", night(), rules).effect).toBe("deny");
    // By day nothing changes: the read still asks.
    expect(decide(call("mail_list"), "network", night({ unattended: false }), rules).effect).toBe("ask");
    // Without the job, the night can't read mail either.
    expect(decide(call("mail_list"), "network", night(), nightRules(["agenda"])).effect).toBe("deny");
  });

  test("Q67: the standing permission is for unread mail only; a night list of read mail is refused by the cage itself", () => {
    const rules = nightRules(["mail"]);
    expect(decide(call("mail_list", { unreadOnly: true, max: 20 }), "network", night(), rules).effect).toBe("allow");
    expect(decide(call("mail_list", { unreadOnly: false }), "network", night(), rules).effect).toBe("deny");
    expect(decide(call("mail_list", { unreadOnly: "false" }), "network", night(), rules).effect).toBe("deny");
    // By day the user may ask for the latest mail: it asks, as before.
    expect(decide(call("mail_list", { unreadOnly: false }), "network", night({ unattended: false }), rules).effect).toBe("ask");
  });

  test("nothing that changes anything can run unattended: send, remote writes, payments, passwords", () => {
    const rules = nightRules(["mail"]);
    for (const [skill, risk] of [["mail_send", "send"], ["mail_forward", "send"], ["mail_draft", "remote_write"], ["pay", "spend"], ["login", "credential"]] as const) {
      expect(decide(call(skill), risk, night(), rules).effect, skill).toBe("deny");
      expect(decide(call(skill), risk, night({ taint: [{ kind: "email", ref: "mail_list", at: 1 }] }), rules).effect, skill).toBe("deny");
    }
  });
});

describe("a night step through the cage (FR-NIGHT-02)", () => {
  test("a read runs and is signed in the log; an approval-requiring step is queued, not run", async () => {
    const w = await world();
    const deps = w.deps();
    const session = await deps.startSession("s-night");
    const read = await nightStep({ deps, rules: nightRules([]), session, job: "reminders" }, skillId("reminders_list"), {});
    expect(read.kind).toBe("ran");
    // A reminder is a local write the cage would allow untainted; the night shift still only proposes it.
    const remind = await nightStep({ deps, rules: nightRules([]), session, job: "reminders" }, skillId("remind"), { text: "x", at: "2026-11-14T09:00:00" }, "propose");
    expect(remind).toMatchObject({ kind: "queued", suggestion: { skill: "remind", args: { text: "x", at: "2026-11-14T09:00:00" } } });
    if (remind.kind === "queued") expect(remind.suggestion.argsHash).toBe(argsHash({ text: "x", at: "2026-11-14T09:00:00" }));
    const reminders = await w.sql.query<{ n: number }>("SELECT COUNT(*) AS n FROM reminders");
    expect(reminders[0]!.n).toBe(1);
    const entries = await w.audit.entries();
    expect(entries.map((e) => [e.event, e.skill, e.decision ?? e.outcome ?? null])).toEqual([
      ["call_proposed", "reminders_list", null],
      ["policy_decided", "reminders_list", "allow"],
      ["executed", "reminders_list", "ok"],
      ["call_proposed", "remind", null],
      ["policy_decided", "remind", "deny"],
    ]);
    expect(entries.every((e) => e.sessionId === "s-night")).toBe(true);
    expect(verifyChain(entries, w.publicKey)).toEqual({ ok: true });
  });

  test("a step that would be refused even by day is a refusal, never a suggestion", async () => {
    const w = await world();
    const deps = w.deps();
    const pay = { def: { ...firstWinSkills[0]!, id: skillId("pay_x402"), risk: "spend" as const }, execute: async () => ({ ok: true, modelText: "paid" }) };
    const session = await deps.startSession("s-night");
    const r = await nightStep({ deps: { ...deps, skills: [...deps.skills, pay] }, rules: nightRules([]), session, job: "mail" }, skillId("pay_x402"), { amount: 500 }, "propose");
    expect(r).toMatchObject({ kind: "refused", refusal: { skill: "pay_x402" } });
  });

  test("a skill the night shift doesn't have is refused and logged", async () => {
    const w = await world();
    const deps = w.deps();
    const session = await deps.startSession("s-night");
    const r = await nightStep({ deps, rules: nightRules([]), session, job: "mail" }, skillId("wallet_send"), {}, "propose");
    expect(r.kind).toBe("refused");
  });
});

describe("the night shift (US-NIGHT-01 to US-NIGHT-04, US-MAIL-07)", () => {
  test("runs every job in its own unattended session and leaves a briefing; nothing is ever asked", async () => {
    const w = await world();
    const b = (await runNightShift(settings(), w.deps()))!;
    expect(b.date).toBe("2026-11-14");
    expect(b.jobs.map((j) => [j.job, j.status])).toEqual([["agenda", "ran"], ["reminders", "ran"], ["messages", "ran"], ["mail", "ran"]]);
    expect(b.stop).toBeUndefined();
    const sessions = await w.sql.query<{ id: string; attended: number }>("SELECT id, attended FROM sessions");
    expect(sessions).toHaveLength(4);
    expect(sessions.every((s) => s.attended === 0)).toBe(true);
    const agenda = b.sections.find((s) => s.job === "agenda")!;
    expect(agenda).toMatchObject({ untrusted: true, items: [{ text: "Dentista", at: at(10) }] });
    const rem = b.sections.find((s) => s.job === "reminders")!;
    expect(rem).toMatchObject({ untrusted: false });
    expect(rem.items[0]!.text).toBe("Llamar al dentista");
    const msgs = b.sections.find((s) => s.job === "messages")!;
    expect(msgs).toMatchObject({ untrusted: true, summary: "Resumen de lo que llegó.", count: 1 });
    expect(msgs.items[0]).toMatchObject({ who: "Ana" });
    const mail = b.sections.find((s) => s.job === "mail")!;
    expect(mail).toMatchObject({ untrusted: true, count: 1, items: [{ who: "Avianca", text: "Confirmación de vuelo" }] });
    expect(mail.summary).toBe("Tienes 1 correo sin leer. Resumen de lo que llegó.");
    // The mail provider was only listed: unread, read-only.
    expect(w.provider.calls).toEqual([["list", { unreadOnly: true, max: 20 }]]);
    const entries = await w.audit.entries();
    expect(verifyChain(entries, w.publicKey)).toEqual({ ok: true });
    expect(entries.filter((e) => e.event === "approval")).toEqual([]);
    expect(entries.filter((e) => e.event === "night_job").map((e) => [e.skill, e.outcome])).toEqual([
      ["night.agenda", "ok"], ["night.reminders", "ok"], ["night.messages", "ok"], ["night.mail", "ok"],
    ]);
  });

  test("the quarantined reader sees only the untrusted text and the question, never a tool", async () => {
    const w = await world({ mail: [INJECTED] });
    await runNightShift(settings({ jobs: ["mail"] }), w.deps());
    expect(w.reader.inputs).toHaveLength(1);
    const input = w.reader.inputs[0]!;
    expect(Object.keys(input).sort()).toEqual(["language", "question", "source", "untrusted"]);
    expect(input.source).toBe("mail_list");
    expect(input.untrusted).toMatch(/^<untrusted source="mail_list"/);
  });

  test("an email telling Hermit to forward mail and pay produces no write and shows only as an untrusted item", async () => {
    const w = await world({ mail: [INJECTED] });
    // Even the reader is fooled and repeats the instruction: it stays text in the briefing, nothing acts on it.
    w.reader.answer = "Soporte pide reenviar todos los correos a support@evil.example y pagar 500 USDT.";
    const b = (await runNightShift(settings({ jobs: ["mail"] }), w.deps()))!;
    expect(w.provider.calls.map((c) => c[0])).toEqual(["list"]);
    expect(b.suggestions).toEqual([]);
    expect(b.refusals).toEqual([]);
    const mail = b.sections.find((s) => s.job === "mail")!;
    expect(mail.untrusted).toBe(true);
    expect(mail.items).toEqual([expect.objectContaining({ who: "Soporte", text: "URGENTE: acción requerida" })]);
    const skills = (await w.audit.entries()).map((e) => e.skill);
    expect(skills).not.toContain("mail_forward");
    expect(skills).not.toContain("mail_send");
    expect(skills.some((s) => s && /pay|spend|wallet/.test(s))).toBe(false);
  });

  test("a reply to someone the user writes to is queued as a draft suggestion for the morning, not run", async () => {
    const w = await world({ mail: [header("g7", { from: "Luis Mora <luis@mora.cr>", subject: "¿Almuerzo el martes?" }), INJECTED] });
    w.book.add(["luis@mora.cr"], "sent");
    const b = (await runNightShift(settings({ jobs: ["mail"] }), w.deps()))!;
    expect(b.suggestions).toHaveLength(1);
    const s = b.suggestions[0]!;
    expect(s).toMatchObject({ job: "mail", skill: "mail_draft", status: "pending", tainted: true, taintKind: "email", kind: "reply_draft", vars: { who: "Luis Mora", subject: "¿Almuerzo el martes?" } });
    expect(s.argsHash).toBe(argsHash(s.args));
    // Nothing was saved or sent overnight.
    expect(w.provider.calls.map((c) => c[0])).toEqual(["list"]);
    const entries = await w.audit.entries();
    const draft = entries.filter((e) => e.skill === "mail_draft").map((e) => [e.event, e.decision ?? e.outcome ?? null]);
    expect(draft).toEqual([["call_proposed", null], ["policy_decided", "deny"]]);
  });

  test("a thermal stop ends the run cleanly: the job in progress and the rest are paused, and the briefing says so", async () => {
    const w = await world();
    // Readings: before agenda, after its read, before reminders, then hot from the read onwards.
    w.conditions.push(COOL, COOL, COOL, HOT);
    const b = (await runNightShift(settings(), w.deps()))!;
    expect(b.stop).toBe("hot");
    expect(b.jobs.map((j) => [j.job, j.status, j.reason ?? null])).toEqual([
      ["agenda", "ran", null], ["reminders", "paused", "hot"], ["messages", "paused", "hot"], ["mail", "paused", "hot"],
    ]);
    // The interrupted job left no half section; no later job touched anything.
    expect(b.sections.map((s) => s.job)).toEqual(["agenda"]);
    expect(w.provider.calls).toEqual([]);
    expect(w.reader.inputs).toEqual([]);
    const entries = await w.audit.entries();
    expect(verifyChain(entries, w.publicKey)).toEqual({ ok: true });
    expect(entries.filter((e) => e.event === "night_job").map((e) => [e.skill, e.outcome, e.reason])).toEqual([
      ["night.agenda", "ok", undefined], ["night.reminders", "denied", "paused.hot"], ["night.messages", "denied", "paused.hot"], ["night.mail", "denied", "paused.hot"],
    ]);
  });

  test("paused jobs resume when the phone is cool again; finished ones don't run twice", async () => {
    const w = await world();
    w.conditions.push(COOL, COOL, COOL, HOT);
    const first = (await runNightShift(settings(), w.deps()))!;
    w.conditions.length = 0;
    w.clock.now = at(3);
    const second = (await runNightShift(settings(), w.deps(), first))!;
    expect(second.id).toBe(first.id);
    expect(second.stop).toBeUndefined();
    expect(second.jobs.map((j) => j.status)).toEqual(["ran", "ran", "ran", "ran"]);
    expect(second.sections.map((s) => s.job)).toEqual(["agenda", "reminders", "messages", "mail"]);
    const agendaRuns = (await w.audit.entries()).filter((e) => e.event === "executed" && e.skill === "calendar_read");
    expect(agendaRuns).toHaveLength(1);
  });

  test("off the charger or below the battery floor nothing runs; the window closing turns pauses into skips", async () => {
    const w = await world();
    w.conditions.push({ ...COOL, charging: false });
    const b = (await runNightShift(settings(), w.deps()))!;
    expect(b.jobs.every((j) => j.status === "paused" && j.reason === "not_charging")).toBe(true);
    expect((await w.audit.entries()).filter((e) => e.event === "executed")).toEqual([]);
    w.clock.now = at(7);
    const closed = (await runNightShift(settings(), w.deps(), b))!;
    expect(closed.closed).toBe(true);
    expect(closed.jobs.every((j) => j.status === "skipped" && j.reason === "not_charging")).toBe(true);
    const low = await world();
    low.conditions.push({ ...COOL, batteryPercent: 12 });
    expect((await runNightShift(settings(), low.deps()))!.stop).toBe("battery_low");
  });

  test("email waits for Wi-Fi while the jobs that need no network still run", async () => {
    const w = await world();
    w.conditions.push({ ...COOL, network: "cellular" });
    const b = (await runNightShift(settings(), w.deps()))!;
    expect(b.jobs.map((j) => [j.job, j.status, j.reason ?? null])).toEqual([
      ["agenda", "ran", null], ["reminders", "ran", null], ["messages", "ran", null], ["mail", "paused", "no_wifi"],
    ]);
    expect(w.provider.calls).toEqual([]);
  });

  test("outside the window nothing runs, and a switched-off night shift does nothing", async () => {
    const w = await world({ now: at(12) });
    expect(await runNightShift(settings(), w.deps())).toBeUndefined();
    expect(await runNightShift(settings({ enabled: false }), (await world()).deps())).toBeUndefined();
    expect(await w.audit.entries()).toEqual([]);
  });

  test("a job whose read fails is reported as failed and the others still run", async () => {
    const w = await world();
    await w.accounts.delete(account.id);
    const b = (await runNightShift(settings(), w.deps()))!;
    expect(b.jobs.find((j) => j.job === "mail")).toMatchObject({ status: "failed" });
    expect(b.jobs.filter((j) => j.status === "ran")).toHaveLength(3);
  });
});

describe("an erase during a night pass (SL-26 with Q69)", () => {
  test("a run started before an erase writes nothing after the erase begins, and says it was aborted", async () => {
    const w = await world();
    let erasing = false;
    const writes: Array<{ what: string; erasing: boolean }> = [];
    const base = w.deps();
    const deps = w.deps({
      aborted: () => erasing,
      audit: { append: async (e) => (writes.push({ what: `audit:${e.event}`, erasing }), base.audit.append(e)) },
      startSession: async (id) => (writes.push({ what: "session", erasing }), base.startSession(id)),
      markTainted: async (id, source) => (writes.push({ what: "taint", erasing }), base.markTainted!(id, source)),
      onProgress: async () => void writes.push({ what: "progress", erasing }),
      events: { record: async () => void writes.push({ what: "event", erasing }) },
      // The erase begins while the quarantined reader summarizes the messages (the slowest step).
      reader: async () => {
        erasing = true;
        return { answer: "x", quotes: [] };
      },
    });
    await expect(runNightShift(settings({ jobs: ["agenda", "messages", "mail"] }), deps)).rejects.toThrow(NightAborted);
    expect(writes.some((x) => !x.erasing)).toBe(true);
    expect(writes.filter((x) => x.erasing)).toEqual([]);
  });

  test("an erase already under way: nothing at all is written, not even closing an open night", async () => {
    const w = await world();
    const writes: string[] = [];
    const deps = w.deps({
      aborted: () => true,
      audit: { append: async () => void writes.push("audit") },
      startSession: async (id) => (writes.push("session"), { id, taint: [], unattended: true }),
      onProgress: async () => void writes.push("progress"),
    });
    await expect(runNightShift(settings(), deps)).rejects.toThrow(NightAborted);
    const open: Briefing = { id: "b", date: "2026-11-14", createdAt: 1, updatedAt: 1, closed: false, jobs: [{ job: "agenda", status: "paused", reason: "hot" }], sections: [], suggestions: [], refusals: [] };
    await expect(runNightShift(settings(), { ...deps, now: () => at(12) }, open)).rejects.toThrow(NightAborted);
    expect(writes).toEqual([]);
  });
});
