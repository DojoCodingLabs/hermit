// SL-53 (FR-WEB-05, US-WEB-08): the BrowserPort the task runner drives, over the native WebView's three calls (load,
// evaluate, currentUrl) and its events. Pure, so it runs on Node with a fake WebView. Everything the page says comes
// back through `parseResult` and a shape check: a page that breaks Hermit's script gets "not found", never a crash,
// and nothing it returns is code.
import type { BrowserOutcome, BrowserPort, LiveElement, Target } from "@hermit/core";
// The one file, not the package: this runs on Node's type stripping in the app's tests, which can't load all of core.
import { asSignInFacts } from "@hermit/core/web-login";
import { pageCall, parseResult } from "./browser-script.ts";

export interface BrowserHandle {
  load(url: string): Promise<boolean>;
  evaluate(script: string): Promise<string>;
  currentUrl(): Promise<string>;
}

export type BrowserEvent = { type: "started" | "load" | "blocked" | "request"; url: string } | { type: "record"; url: string; event: string };

export interface BrowserTiming {
  sleep(ms: number): Promise<void>;
  now(): number;
}

export const LOAD_TIMEOUT_MS = 20_000;
const POLL_MS = 300;
const SETTLE_MS = 2_500;

const str = (v: unknown, max: number) => typeof v === "string" && v.length <= max;

/** A live element as the page script returned it, or undefined when it isn't one (FR-WEB-05's fields only). */
export function asLive(v: unknown): LiveElement | undefined {
  if (!v || typeof v !== "object") return undefined;
  const o = v as Record<string, unknown>;
  if (!str(o.role, 40) || !str(o.name, 200) || typeof o.nth !== "number" || typeof o.pageHasForm !== "boolean") return undefined;
  const out: LiveElement = { role: o.role as string, name: o.name as string, nth: Math.max(0, Math.floor(o.nth)), pageHasForm: o.pageHasForm };
  if (o.disabled === true) out.disabled = true;
  if (o.submits === true) out.submits = true;
  if (str(o.nearby, 120)) out.nearby = o.nearby as string;
  const f = o.form as Record<string, unknown> | undefined;
  if (f !== undefined && f !== null) {
    // A form whose submission (action, method, target) can't be read is no element: dropping just the bad part would
    // skip the runner's off-site and new-window checks.
    const opt = (v: unknown, max: number) => v === undefined || str(v, max);
    if (typeof f !== "object" || !str(f.id, 200) || !Array.isArray(f.fields) || !opt(f.action, 2000) || !opt(f.method, 10) || !opt(f.target, 100)) return undefined;
    const fields = (f.fields as unknown[]).slice(0, 30).flatMap((x) => {
      const y = x as Record<string, unknown>;
      return y && str(y.label, 200) && str(y.value, 400) && typeof y.secret === "boolean" ? [{ label: y.label as string, value: y.secret ? "" : (y.value as string), secret: y.secret as boolean }] : [];
    });
    out.form = {
      id: f.id as string,
      fields,
      ...(f.action !== undefined ? { action: f.action as string } : {}),
      ...(f.method !== undefined ? { method: f.method as string } : {}),
      ...(f.target !== undefined ? { target: f.target as string } : {}),
    };
  }
  return out;
}

const asOutcome = (v: unknown): BrowserOutcome => {
  const o = v as { ok?: unknown; changed?: unknown; reason?: unknown } | undefined;
  if (o?.ok === true) return { ok: true, changed: o.changed === true };
  const reason = o?.reason;
  return { ok: false, reason: reason === "not_found" || reason === "disabled" || reason === "off_origin" ? reason : "failed" };
};

export function createBrowserPort(h: BrowserHandle, t: BrowserTiming): BrowserPort & { onEvent(e: BrowserEvent): void } {
  let loads = 0;
  let starts = 0;
  let blocked = 0;
  const call = async (script: string) => parseResult(await h.evaluate(script).catch(() => undefined));

  /** Waits until the load count passes `since`, or the time is up. */
  async function waitLoad(since: number, timeoutMs: number): Promise<boolean> {
    const end = t.now() + timeoutMs;
    while (t.now() < end) {
      if (loads > since) return true;
      await t.sleep(POLL_MS);
    }
    return loads > since;
  }

  return {
    onEvent(e) {
      if (e.type === "load") loads++;
      else if (e.type === "started") starts++;
      else if (e.type === "blocked") blocked++;
    },
    async open(url) {
      const since = loads;
      if (!(await h.load(url).catch(() => false))) return { ok: false, reason: "blocked" };
      return (await waitLoad(since, LOAD_TIMEOUT_MS)) ? { ok: true, changed: true } : { ok: false, reason: "timeout" };
    },
    url: () => h.currentUrl().catch(() => ""),
    async find(target: Target, timeoutMs: number) {
      const end = t.now() + timeoutMs;
      for (;;) {
        const found = asLive(await call(pageCall("find", target)));
        if (found) return found;
        if (t.now() >= end) return undefined;
        await t.sleep(POLL_MS);
      }
    },
    click: (target) => settled(pageCall("act", "click", target, null)),
    // SL-56b: the code, the field and the origin go into one page call; the page may then submit and navigate.
    fillCode: (input) => settled(pageCall("fillCode", input.code, input.origin, input.field, input.expect)),
    async fill(target, value) {
      return asOutcome(await call(pageCall("act", "fill", target, value)));
    },
    async select(target, option) {
      return asOutcome(await call(pageCall("act", "select", target, option)));
    },
    async check(target, on) {
      return asOutcome(await call(pageCall("act", "check", target, on)));
    },
    async fillLogin(values) {
      return asOutcome(await call(pageCall("fillLogin", values.username, values.password, values.origin)));
    },
    async snapshot() {
      const v = await call(pageCall("snapshot"));
      return typeof v === "string" ? v.slice(0, 4000) : "";
    },
    async candidates(role) {
      const v = await call(pageCall("candidates", role));
      return Array.isArray(v) ? v.flatMap((x) => (asLive(x) ? [asLive(x)!] : [])) : [];
    },
    // SL-56: the page after a sign-in click, shape-checked; a report that isn't one is undefined (the user checks).
    async signInFacts() {
      return asSignInFacts(await call(pageCall("signInFacts")));
    },
  };

  /** Runs an action that may navigate, then lets the page settle (FR-WEB-06 counts actions that change nothing). */
  async function settled(script: string): Promise<BrowserOutcome> {
    const before = await call(pageCall("sig"));
    const since = { loads, starts, blocked };
    const out = asOutcome(await call(script));
    if (!out.ok) return out;
    // Settle: a navigation that starts loads to its end; otherwise the page has a moment to change itself.
    const end = t.now() + SETTLE_MS;
    while (t.now() < end && starts === since.starts && loads === since.loads && blocked === since.blocked) {
      await t.sleep(POLL_MS);
      if ((await call(pageCall("sig"))) !== before) break;
    }
    if (blocked > since.blocked) return { ok: false, reason: "blocked" };
    if (starts > since.starts) await waitLoad(since.loads, LOAD_TIMEOUT_MS);
    const after = await call(pageCall("sig"));
    return { ok: true, changed: loads > since.loads || after !== before };
  }
}
