// SL-53 (HM-WEB-02): the pure parts of the live browser screen, tested on Node. The rules (the recipe format, the cage,
// the runner) live in @hermit/core and @hermit/runtime; this only decides what the screen says and reads what the
// recorder posted.
import type { CommitRisk, LiveElement, Recipe, RecordedEvent, Target } from "@hermit/core";
import type { SiteLogins, WebTaskEnd, WebTaskState } from "@hermit/runtime";

/** How HM-WEB-02 opens: the chat's one-time offer, a saved recipe from the list, recording, or the list. */
export type BrowserStart = { kind: "offer"; offerId: string } | { kind: "recipe"; id: string } | { kind: "record" } | { kind: "list" };

export function startFrom(params: { offer?: unknown; recipe?: unknown; record?: unknown }): BrowserStart {
  if (typeof params.offer === "string" && params.offer) return { kind: "offer", offerId: params.offer };
  if (typeof params.recipe === "string" && /^[a-z0-9]{1,24}$/.test(params.recipe)) return { kind: "recipe", id: params.recipe };
  if (params.record === "1") return { kind: "record" };
  return { kind: "list" };
}

const str = (v: unknown, max: number): v is string => typeof v === "string" && v.length <= max;

function targetOf(v: unknown): Target | undefined {
  const o = v as Record<string, unknown> | undefined;
  if (!o || !str(o.role, 40) || !str(o.name, 120) || !o.name.trim() || typeof o.nth !== "number") return undefined;
  return { role: o.role, name: o.name, ...(o.nth > 0 ? { nth: Math.floor(o.nth) } : {}) };
}

/**
 * One recorder event (the page script's JSON, forwarded by the native view only while recording), checked field by
 * field. A click is classified here, on the live element the script read, so a committing step is marked as such in
 * the draft. A secret field's value is dropped even if a page sent one.
 */
export function recordedEvent(json: string, classify: (e: LiveElement) => CommitRisk | null): RecordedEvent | undefined {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return undefined;
  }
  const o = raw as Record<string, unknown> | null;
  if (!o || typeof o !== "object") return undefined;
  const target = targetOf(o.target);
  if (!target) return undefined;
  switch (o.kind) {
    case "click": {
      const live = o.live as LiveElement | undefined;
      const valid = live && str(live.role, 40) && str(live.name, 200) && typeof live.pageHasForm === "boolean";
      return { kind: "click", target, risk: valid ? classify(live) : classify({ role: target.role, name: target.name, nth: target.nth ?? 0, pageHasForm: true }) };
    }
    case "check":
      return typeof o.on === "boolean" ? { kind: "check", target, on: o.on } : undefined;
    case "fill": {
      if (!str(o.label, 120) || typeof o.secret !== "boolean") return undefined;
      const value = o.secret ? "" : str(o.value, 200) ? o.value : undefined;
      if (value === undefined) return undefined;
      return { kind: "fill", target, value, secret: o.secret, label: o.label || target.name, ...(str(o.form, 200) ? { form: o.form } : {}) };
    }
    case "select": {
      if (!str(o.label, 120) || !str(o.value, 200)) return undefined;
      const options = Array.isArray(o.options) ? o.options.filter((x): x is string => str(x, 60)).slice(0, 20) : undefined;
      return { kind: "select", target, value: o.value, label: o.label || target.name, ...(options?.length ? { options } : {}) };
    }
    default:
      return undefined;
  }
}

const ROLES = new Set(["link", "button", "checkbox", "radio", "tab", "menuitem", "option", "combobox", "textbox", "searchbox"]);

/** One recorded step in words for the save screen: its copy key, the element's role as a copy key, and its vars. */
export interface RecordedStepLine {
  key: string;
  roleKey: string;
  vars: Record<string, string>;
}

/**
 * Every recorded step, in order, for the user to check before saving (US-WEB-11): what kind of step it is, the element's
 * role and name, and the value. A secret field, and every field of a form that has one (the username goes with the
 * password into the saved login, as the draft does), is shown without its value.
 */
export function recordedSteps(events: readonly RecordedEvent[]): RecordedStepLine[] {
  const secretForms = new Set(events.flatMap((e) => (e.kind === "fill" && e.secret ? [e.form ?? "?"] : [])));
  return events.map((e): RecordedStepLine => {
    const roleKey = `HM-WEB-02.role.${ROLES.has(e.target.role) ? e.target.role : "other"}`;
    const name = e.target.name;
    switch (e.kind) {
      case "click": {
        const kind = e.risk === "spend" ? "pay" : e.risk === "credential" ? "signin" : e.risk === "remote_write" ? "submit" : "click";
        return { key: `HM-WEB-02.save.step.${kind}`, roleKey, vars: { name } };
      }
      case "fill":
        return e.secret || secretForms.has(e.form ?? "\u0000")
          ? { key: "HM-WEB-02.save.step.secret", roleKey, vars: { name } }
          : { key: "HM-WEB-02.save.step.fill", roleKey, vars: { name, value: e.value } };
      case "select":
        return { key: "HM-WEB-02.save.step.select", roleKey, vars: { name, value: e.value } };
      case "check":
        return { key: e.on ? "HM-WEB-02.save.step.check" : "HM-WEB-02.save.step.uncheck", roleKey, vars: { name } };
    }
  });
}

/** The live line's copy: the step in words while running or paused, with its number. */
export function liveLine(state: WebTaskState): { key: string; vars: Record<string, string> } | undefined {
  if (state.kind !== "running" && state.kind !== "paused") return undefined;
  return { key: "HM-WEB-02.live.step", vars: { n: String(state.step + 1), total: String(state.total) } };
}

/** The copy key for how a task ended. */
export function endKey(end: WebTaskEnd): string {
  switch (end.kind) {
    case "done":
      return "HM-WEB-02.end.done";
    case "stopped":
      return "HM-WEB-02.end.stopped";
    case "failed":
      return `HM-WEB-02.end.failed.${end.reason}`;
    case "refused":
      return `HM-WEB-02.end.refused.${end.reason}`;
  }
}

/** A typed address as the start of a recording: https only, a bare host gets https. Undefined when it isn't one. */
export function recordAddress(typed: string): string | undefined {
  let s = typed.trim();
  if (!s) return undefined;
  if (!/^[a-z][a-z0-9+.-]*:/i.test(s)) s = `https://${s.replace(/^\/\//, "")}`;
  const m = /^https:\/\/([a-z0-9.-]+\.[a-z]{2,})(:\d{1,5})?(\/[^\s]*)?$/i.exec(s);
  if (!m) return undefined;
  return `https://${m[1]!.toLowerCase()}${m[2] ?? ""}${m[3] ?? "/"}`;
}

/**
 * SL-56: the plan's "Sign in with" line, for a recipe with a sign-in step. No saved login for the exact site: the user
 * signs in on the page. One: it is the one. Several: the user picks, and until they do (or when their pick is gone)
 * the user signs in themselves, as the runner does; Hermit never picks one for them.
 */
export type LoginPicker =
  | { kind: "none" }
  | { kind: "yourself" }
  | { kind: "one"; name: string }
  | { kind: "pick"; choices: Array<{ value: string; label: string }>; selected: string };

/** The picker's value for "I'll sign in myself": no item hash. */
export const SIGN_IN_MYSELF = "";

export function loginPicker(recipe: Pick<Recipe, "steps">, logins: SiteLogins | undefined, myselfLabel: string): LoginPicker {
  if (!recipe.steps.some((s) => s.op === "login")) return { kind: "none" };
  const list = logins?.logins ?? [];
  if (list.length === 0) return { kind: "yourself" };
  if (list.length === 1) return { kind: "one", name: list[0]!.name };
  return {
    kind: "pick",
    choices: [...list.map((l) => ({ value: l.hash, label: l.name })), { value: SIGN_IN_MYSELF, label: myselfLabel }],
    selected: logins?.chosen ?? SIGN_IN_MYSELF,
  };
}
