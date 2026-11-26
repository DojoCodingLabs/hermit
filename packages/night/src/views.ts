import type { Briefing, BriefingItem, SuggestionStatus } from "./briefing.ts";
import { blockers, type DeviceState } from "./conditions.ts";
import { JOB_NEEDS_NETWORK, NIGHT_JOBS, validateNightSettings, type NightJobId, type NightSettings } from "./settings.ts";

/*
 * What HM-NIGHT-01 and HM-NIGHT-02 render, as copy keys and rows (docs/prd/hermit-ui-states-and-edge-cases.md).
 * The screens stay thin: every state and its copy is decided here and tested.
 */

export interface NightSettingsView {
  enabled: boolean;
  window: { start: string; end: string };
  briefingAt: string;
  jobs: Array<{ id: NightJobId; on: boolean; labelKey: string; noteKey?: string }>;
  /** Always shown (US-CAGE-02): while you sleep Hermit can't send, pay, sign in or change anything. */
  unattendedKey: "HM-NIGHT-01.unattended";
  /** The guards, always listed (FR-NIGHT-01, NFR-04). */
  conditionKeys: string[];
  /** What would hold the night shift back right now (only while it is on). */
  nowKeys: string[];
  problemKeys: string[];
}

export function nightSettingsView(settings: NightSettings, device: DeviceState | undefined): NightSettingsView {
  const needsNetwork = settings.jobs.some((j) => JOB_NEEDS_NETWORK[j]);
  return {
    enabled: settings.enabled,
    window: { ...settings.window },
    briefingAt: settings.briefingAt,
    jobs: NIGHT_JOBS.map((id) => ({ id, on: settings.jobs.includes(id), labelKey: `HM-NIGHT-01.job.${id}`, ...(id === "mail" ? { noteKey: "HM-NIGHT-01.job.mailNote" } : {}) })),
    unattendedKey: "HM-NIGHT-01.unattended",
    conditionKeys: ["charging", "cool", "battery", "screen", "wifi"].map((c) => `HM-NIGHT-01.condition.${c}`),
    // The screen is on while the user looks at this, so that guard is never shown as a live problem here.
    nowKeys: settings.enabled && device ? blockers(device, { needsNetwork, manual: true }).map((r) => `HM-NIGHT-02.reason.${r}`) : [],
    problemKeys: validateNightSettings(settings).map((p) => `HM-NIGHT-01.problem.${p}`),
  };
}

export interface BriefingView {
  state: "empty" | "ready";
  emptyKey?: "HM-NIGHT-02.empty";
  date?: string;
  /** A guard ended the night early (US-NIGHT-04): said at the top. */
  stoppedKey?: string;
  /** Other people's text is shown as quotes, with this note (ST-TAINTED). */
  untrustedKey: "HM-NIGHT-02.untrusted";
  sections: Array<{ job: NightJobId; titleKey: string; untrusted: boolean; summary?: string; quotes: string[]; items: BriefingItem[]; emptyKey?: string }>;
  suggestions: Array<{
    id: string;
    titleKey: string;
    vars: Record<string, string>;
    status: SuggestionStatus;
    /** Opens the normal approval sheet (only while pending). */
    actionKey?: "HM-NIGHT-02.review";
    statusKey?: string;
    taintKey?: string;
  }>;
  /** US-NIGHT-03: what ran, paused or was skipped, with the reason. */
  log: Array<{ job: NightJobId; jobKey: string; statusKey: string; reasonKey?: string }>;
  /** Steps refused because no one could approve them, listed by skill. */
  refusals: Array<{ skill: string; key: "HM-NIGHT-02.refused" }>;
}

const TAINT_KEY: Record<string, string> = { email: "HM-NIGHT-02.fromEmail", inbound_message: "HM-NIGHT-02.fromMessages", web: "HM-NIGHT-02.fromWeb" };

/** HM-NIGHT-02, from the stored briefing; never from a model's prose. */
export function briefingView(b: Briefing | undefined): BriefingView {
  if (!b) return { state: "empty", emptyKey: "HM-NIGHT-02.empty", untrustedKey: "HM-NIGHT-02.untrusted", sections: [], suggestions: [], log: [], refusals: [] };
  return {
    state: "ready",
    date: b.date,
    ...(b.stop ? { stoppedKey: `HM-NIGHT-02.stopped.${b.stop}` } : {}),
    untrustedKey: "HM-NIGHT-02.untrusted",
    sections: b.sections.map((s) => ({
      job: s.job,
      titleKey: `HM-NIGHT-02.section.${s.job}`,
      untrusted: s.untrusted,
      ...(s.summary ? { summary: s.summary } : {}),
      quotes: s.quotes,
      items: s.items,
      ...(s.items.length ? {} : { emptyKey: `HM-NIGHT-02.sectionEmpty.${s.job}` }),
    })),
    suggestions: b.suggestions.map((s) => ({
      id: s.id,
      titleKey: `HM-NIGHT-02.suggest.${s.kind}`,
      vars: s.kind === "other" ? { skill: s.skill } : s.vars,
      status: s.status,
      ...(s.status === "pending" ? { actionKey: "HM-NIGHT-02.review" as const } : { statusKey: `HM-NIGHT-02.suggestion.${s.status}` }),
      ...(s.tainted ? { taintKey: TAINT_KEY[s.taintKind ?? "inbound_message"] ?? "HM-NIGHT-02.fromMessages" } : {}),
    })),
    log: b.jobs.map((j) => ({
      job: j.job,
      jobKey: `HM-NIGHT-01.job.${j.job}`,
      statusKey: `HM-NIGHT-02.status.${j.status}`,
      ...(j.reason ? { reasonKey: `HM-NIGHT-02.reason.${j.reason}` } : {}),
    })),
    refusals: b.refusals.map((r) => ({ skill: r.skill, key: "HM-NIGHT-02.refused" as const })),
  };
}
