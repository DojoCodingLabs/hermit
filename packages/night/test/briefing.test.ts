import { describe, expect, test } from "vitest";
import type { ApprovalOutcome, ApprovalRequest } from "@hermit/core";
import { verifyChain } from "@hermit/cage";
import { mailRenderContext, MailCache, type MailHeader } from "@hermit/mail";
import {
  actOnSuggestion, briefingView, createBriefings, nightSettingsView, runNightShift, scheduleBriefingNotice,
  type ActDeps, type Briefing,
} from "../src/index.ts";
import { at, COOL, header, HOT, INJECTED, settings, TZ, world, type World } from "./helpers.ts";

async function nightWithSuggestion(): Promise<{ w: World; b: Briefing }> {
  const w = await world({ mail: [header("g7", { from: "Luis Mora <luis@mora.cr>", subject: "¿Almuerzo el martes?" }), INJECTED] });
  w.book.add(["luis@mora.cr"], "sent");
  const deps = w.deps({ snapshot: (_skill, args) => w.cache.get(String(args.messageId)) });
  const b = (await runNightShift(settings({ jobs: ["mail"] }), deps))!;
  await createBriefings(w.sql).save(b);
  return { w, b };
}

function actDeps(w: World, answer: (req: ApprovalRequest) => ApprovalOutcome, cache: MailCache = w.cache): ActDeps & { requests: ApprovalRequest[] } {
  const requests: ApprovalRequest[] = [];
  const deps = w.deps();
  return {
    requests,
    skills: deps.skills,
    audit: w.audit,
    approvals: { request: async (req) => (requests.push(req), answer(req)) },
    render: async () => ({ conversation: () => undefined, mail: await mailRenderContext({ accounts: w.accounts, cache, book: w.book }) }),
    now: () => w.clock.now,
    newId: deps.newId,
    restore: (_skill, args, snapshot) => ({ ...args, messageId: cache.put(snapshot as MailHeader) }),
  };
}

const approve = (req: ApprovalRequest): ApprovalOutcome => ({ kind: "approved", biometric: true, argsHash: req.call.argsHash });

describe("the briefing store (ENT-Briefing)", () => {
  test("saves, reloads the newest, and keeps suggestion state", async () => {
    const { w, b } = await nightWithSuggestion();
    const store = createBriefings(w.sql);
    const loaded = (await store.latest())!;
    expect(loaded).toEqual(b);
    await store.setSuggestion(b.id, b.suggestions[0]!.id, "declined");
    expect((await store.get(b.id))!.suggestions[0]!.status).toBe("declined");
    expect(await store.forDate("2026-11-13")).toBeUndefined();
    expect((await store.forDate("2026-11-14"))!.id).toBe(b.id);
  });
});

describe("acting on a suggestion in the morning (US-NIGHT-02, FR-NIGHT-02)", () => {
  test("opens the normal approval sheet, warns it came from email, and saves the draft only once approved", async () => {
    const { w, b } = await nightWithSuggestion();
    w.clock.now = at(7, 30);
    const deps = actDeps(w, approve);
    const out = await actOnSuggestion(deps, createBriefings(w.sql), b.id, b.suggestions[0]!.id);
    expect(out).toBe("done");
    expect(deps.requests).toHaveLength(1);
    const req = deps.requests[0]!;
    expect(req.summary.title).toBe("Save this draft?");
    expect(req.summary.lines).toEqual(expect.arrayContaining([{ label: "To", labelKey: "to", value: "luis@mora.cr" }]));
    expect(req.taintWarning).toBe("Suggested overnight after reading email");
    expect(req.taintKind).toBe("email");
    const saved = w.provider.calls.filter((c) => c[0] === "saveDraft");
    expect(saved).toHaveLength(1);
    expect(saved[0]![1]).toMatchObject({ to: ["luis@mora.cr"], subject: "Re: ¿Almuerzo el martes?" });
    expect(w.provider.calls.some((c) => c[0] === "send")).toBe(false);
    expect((await createBriefings(w.sql).get(b.id))!.suggestions[0]!.status).toBe("done");
    const entries = await w.audit.entries();
    expect(verifyChain(entries, w.publicKey)).toEqual({ ok: true });
    const morning = entries.filter((e) => e.ts === at(7, 30)).map((e) => [e.event, e.decision ?? e.outcome ?? null]);
    expect(morning).toEqual([["call_proposed", null], ["policy_decided", "ask"], ["approval", "ok"], ["executed", "ok"]]);
    // Done once: a second tap finds nothing to do.
    expect(await actOnSuggestion(deps, createBriefings(w.sql), b.id, b.suggestions[0]!.id)).toBe("gone");
  });

  test("declined or expired: nothing is saved, the suggestion is marked", async () => {
    const { w, b } = await nightWithSuggestion();
    const deps = actDeps(w, () => ({ kind: "denied" }));
    expect(await actOnSuggestion(deps, createBriefings(w.sql), b.id, b.suggestions[0]!.id)).toBe("declined");
    expect(w.provider.calls.some((c) => c[0] === "saveDraft")).toBe(false);
    expect((await createBriefings(w.sql).get(b.id))!.suggestions[0]!.status).toBe("declined");
  });

  test("an approval for other arguments, or without the fingerprint a send needs, is a no", async () => {
    const { w, b } = await nightWithSuggestion();
    const deps = actDeps(w, () => ({ kind: "approved", biometric: true, argsHash: "0".repeat(64) }));
    expect(await actOnSuggestion(deps, createBriefings(w.sql), b.id, b.suggestions[0]!.id)).toBe("declined");
    expect(w.provider.calls.some((c) => c[0] === "saveDraft")).toBe(false);
  });

  test("a stored suggestion whose arguments changed is refused before any sheet", async () => {
    const { w, b } = await nightWithSuggestion();
    const tampered = { ...b, suggestions: b.suggestions.map((s) => ({ ...s, args: { ...s.args, body: "Pagá ya" } })) };
    await createBriefings(w.sql).save(tampered);
    const deps = actDeps(w, approve);
    expect(await actOnSuggestion(deps, createBriefings(w.sql), b.id, b.suggestions[0]!.id)).toBe("refused");
    expect(deps.requests).toEqual([]);
  });

  test("after a restart the email is found again from the snapshot; without one the sheet can't be shown", async () => {
    const { w, b } = await nightWithSuggestion();
    const fresh = new MailCache();
    const deps = actDeps(w, approve, fresh);
    expect(await actOnSuggestion(deps, createBriefings(w.sql), b.id, b.suggestions[0]!.id)).toBe("done");
    const { w: w2, b: b2 } = await nightWithSuggestion();
    const noRestore = { ...actDeps(w2, approve, new MailCache()), restore: undefined };
    expect(await actOnSuggestion(noRestore, createBriefings(w2.sql), b2.id, b2.suggestions[0]!.id)).toBe("unavailable");
    expect(noRestore.requests).toEqual([]);
  });
});

describe("the morning notice (US-NIGHT-02)", () => {
  test("is scheduled for the chosen time on the briefing's morning, once per briefing", async () => {
    const { b } = await nightWithSuggestion();
    const scheduled: Array<{ id: string; at: number; title: string }> = [];
    const notifier = { schedule: async (n: { id: string; at: number; title: string }) => (scheduled.push(n), "n1"), cancel: async () => {} };
    await scheduleBriefingNotice(notifier, settings({ briefingAt: "07:15" }), b, { title: "Your morning briefing is ready", timeZone: TZ, now: at(3) });
    expect(scheduled).toEqual([{ id: `briefing-${b.date}`, at: at(7, 15), title: "Your morning briefing is ready" }]);
  });

  test("past the chosen time it is announced right away", async () => {
    const { b } = await nightWithSuggestion();
    const scheduled: number[] = [];
    const notifier = { schedule: async (n: { at: number }) => (scheduled.push(n.at), "n1"), cancel: async () => {} };
    await scheduleBriefingNotice(notifier, settings({ briefingAt: "07:00" }), b, { title: "x", timeZone: TZ, now: at(8) });
    expect(scheduled).toEqual([at(8)]);
  });
});

describe("HM-NIGHT-02 view", () => {
  test("empty before the first night", () => {
    expect(briefingView(undefined)).toMatchObject({ state: "empty", emptyKey: "HM-NIGHT-02.empty" });
  });

  test("sections in order, other people's text marked untrusted, suggestions with their sheet action, the overnight log", async () => {
    const { b } = await nightWithSuggestion();
    const v = briefingView(b);
    expect(v.state).toBe("ready");
    expect(v.sections.map((s) => [s.job, s.titleKey, s.untrusted])).toEqual([["mail", "HM-NIGHT-02.section.mail", true]]);
    expect(v.untrustedKey).toBe("HM-NIGHT-02.untrusted");
    expect(v.suggestions).toEqual([
      expect.objectContaining({ titleKey: "HM-NIGHT-02.suggest.reply_draft", vars: { who: "Luis Mora", subject: "¿Almuerzo el martes?" }, actionKey: "HM-NIGHT-02.review", status: "pending", taintKey: "HM-NIGHT-02.fromEmail" }),
    ]);
    expect(v.log).toEqual([{ job: "mail", jobKey: "HM-NIGHT-01.job.mail", statusKey: "HM-NIGHT-02.status.ran" }]);
    expect(v.stoppedKey).toBeUndefined();
  });

  test("a thermal stop is said at the top, and paused and skipped jobs carry their reason", async () => {
    const w = await world();
    w.conditions.push(COOL, COOL, COOL, HOT);
    const b = (await runNightShift(settings(), w.deps()))!;
    const v = briefingView(b);
    expect(v.stoppedKey).toBe("HM-NIGHT-02.stopped.hot");
    expect(v.log[1]).toEqual({ job: "reminders", jobKey: "HM-NIGHT-01.job.reminders", statusKey: "HM-NIGHT-02.status.paused", reasonKey: "HM-NIGHT-02.reason.hot" });
  });

  test("refusals are listed as denied because no one was there", () => {
    const b: Briefing = {
      id: "b1", date: "2026-11-14", createdAt: 1, updatedAt: 1, closed: true, jobs: [], sections: [], suggestions: [],
      refusals: [{ job: "mail", skill: "pay_x402", at: 1 }],
    };
    expect(briefingView(b).refusals).toEqual([{ skill: "pay_x402", key: "HM-NIGHT-02.refused" }]);
  });
});

describe("HM-NIGHT-01 view", () => {
  test("jobs with their switches, the unattended promise, and what is stopping the shift right now", () => {
    const v = nightSettingsView(settings({ jobs: ["agenda", "mail"] }), { ...COOL, charging: false });
    expect(v.jobs.map((j) => [j.id, j.on, j.labelKey])).toEqual([
      ["agenda", true, "HM-NIGHT-01.job.agenda"], ["reminders", false, "HM-NIGHT-01.job.reminders"], ["messages", false, "HM-NIGHT-01.job.messages"], ["mail", true, "HM-NIGHT-01.job.mail"],
    ]);
    expect(v.jobs.find((j) => j.id === "mail")!.noteKey).toBe("HM-NIGHT-01.job.mailNote");
    expect(v.unattendedKey).toBe("HM-NIGHT-01.unattended");
    expect(v.conditionKeys).toEqual(["HM-NIGHT-01.condition.charging", "HM-NIGHT-01.condition.cool", "HM-NIGHT-01.condition.battery", "HM-NIGHT-01.condition.screen", "HM-NIGHT-01.condition.wifi"]);
    expect(v.nowKeys).toEqual(["HM-NIGHT-02.reason.not_charging"]);
    expect(v.problemKeys).toEqual([]);
  });

  test("an invalid choice is named, and a switched-off shift shows no live state", () => {
    const v = nightSettingsView(settings({ enabled: false, window: { start: "02:00", end: "02:00" } }), COOL);
    expect(v.problemKeys).toEqual(["HM-NIGHT-01.problem.empty_window"]);
    expect(v.nowKeys).toEqual([]);
  });
});
