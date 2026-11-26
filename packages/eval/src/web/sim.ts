// A tiny web simulator for the SL-50 spike: synthetic sites as pages of accessibility-tree nodes, with the
// transition each action causes. No browser. Snapshots follow FR-WEB-05 and docs/research/oss-computer-use.md:
// one line per node in page order, `[7] button "Place order"`, numbered refs, about 3,000 characters.

export type Role = "button" | "link" | "textbox" | "combobox" | "radio" | "checkbox" | "heading" | "text";
export type CommitRisk = "spend" | "remote_write" | "credential";

/** What a click, type or select can see and change. Fields hold form values and site data (a cart). */
export interface Session {
  page: string;
  fields: Record<string, string>;
  /** Things the site did on the server (an order placed, a booking made), for grading. */
  effects: string[];
}

export interface WebNode {
  /** Stable id inside the site, for the oracle; never shown to the model. */
  id: string;
  role: Role;
  name: string;
  options?: string[];
  disabled?: boolean;
  /** Masked as *** in snapshots (passwords, cards, codes). */
  secret?: boolean;
  /** Radio group: a click stores this node's name under fields[group]. Also the group's label. */
  group?: string;
  /** The form this field belongs to (default "main"), as the page's <form> elements would group them. */
  form?: string;
  /** Click navigates here. */
  to?: string;
  /** Click records this server-side effect. */
  effect?: string;
  /** Click changes site data. */
  onClick?: (s: Session) => void;
  /** Field ids (or radio groups) that must hold a value before the click runs. */
  requires?: string[];
  /** Ground truth: this click commits (pays, submits, signs in). The classifier is graded against it. */
  commits?: CommitRisk;
}

export interface WebPage {
  title: string;
  path: string;
  nodes: WebNode[] | ((s: Session) => WebNode[]);
}

export interface Site {
  id: string;
  origin: string;
  start: string;
  pages: Record<string, WebPage>;
}

export type WebAction =
  | { kind: "click"; ref: number }
  | { kind: "type"; ref: number; text: string }
  | { kind: "select"; ref: number; option: string }
  | { kind: "done"; answer: string }
  | { kind: "infeasible"; reason: string }
  /** Harness v3: several field values at once, already resolved by code into primitive actions. */
  | { kind: "fill"; steps: Array<{ kind: "type"; ref: number; text: string } | { kind: "select"; ref: number; option: string } | { kind: "click"; ref: number }> };

export interface Snapshot {
  page: string;
  text: string;
  /** Refs printed in this snapshot (cut lines are not offered). */
  refs: Map<number, WebNode>;
  /** Every node on the page, for the classifier. */
  nodes: WebNode[];
  /** Current value per printed ref ("checked" for a checked radio or checkbox), undefined when empty. */
  values: Map<number, string | undefined>;
}

export interface ActResult {
  ok: boolean;
  changed: boolean;
  line: string;
}

export interface Sim {
  snapshot(budget?: number): Snapshot;
  act(a: WebAction): ActResult;
  view(): Session;
}

const INTERACTIVE: ReadonlySet<Role> = new Set(["button", "link", "textbox", "combobox", "radio", "checkbox"]);
export const isInteractive = (n: WebNode) => INTERACTIVE.has(n.role);
export const DEFAULT_BUDGET = 3000;

function nodesOf(site: Site, s: Session): WebNode[] {
  const page = site.pages[s.page];
  if (!page) throw new Error(`no page ${s.page} in ${site.id}`);
  return typeof page.nodes === "function" ? page.nodes(s) : page.nodes;
}

function valueOf(n: WebNode, s: Session): string | undefined {
  if (n.role === "radio") return n.group && s.fields[n.group] === n.name ? "checked" : undefined;
  if (n.role === "checkbox") return s.fields[n.id] === "on" ? "checked" : undefined;
  return s.fields[n.id] || undefined;
}

function line(n: WebNode, ref: number | undefined, s: Session): string {
  if (n.role === "heading") return `## ${n.name}`;
  if (n.role === "text") return n.name;
  const v = valueOf(n, s);
  let out = `[${ref}] ${n.role} "${n.name}"`;
  if (n.role === "radio" || n.role === "checkbox") out += v ? " checked" : "";
  else if (v !== undefined) out += ` = "${n.secret ? "***" : v}"`;
  if (n.options) out += ` options: ${n.options.join(" | ")}`;
  if (n.disabled) out += " disabled";
  return out;
}

const label = (ref: number, n: WebNode) => `[${ref}] ${n.role} "${n.name}"`;

export function createSim(site: Site, startPage = site.start): Sim {
  const s: Session = { page: startPage, fields: {}, effects: [] };
  let last: Snapshot | undefined;

  function snapshot(budget = DEFAULT_BUDGET): Snapshot {
    const nodes = nodesOf(site, s);
    const page = site.pages[s.page]!;
    const header = `[page] ${page.title} | ${site.origin}${page.path}`;
    let ref = 0;
    const rows = nodes.map((n) => {
      const r = isInteractive(n) ? ++ref : undefined;
      return { n, r, text: line(n, r, s) };
    });
    let kept = rows;
    const size = (xs: typeof rows, extra = 0) => header.length + xs.reduce((a, x) => a + x.text.length + 1, 0) + extra;
    if (size(rows) > budget) {
      // Keep the first 80% and the last 20% of the budget; a dialog's Submit is usually its last line.
      const room = budget - header.length - 40;
      const head: typeof rows = [];
      let used = 0;
      for (const x of rows) {
        if (used + x.text.length + 1 > room * 0.8) break;
        head.push(x);
        used += x.text.length + 1;
      }
      const tail: typeof rows = [];
      used = 0;
      for (let i = rows.length - 1; i >= head.length; i--) {
        const x = rows[i]!;
        if (used + x.text.length + 1 > room * 0.2) break;
        tail.unshift(x);
        used += x.text.length + 1;
      }
      const cutNote = `... ${rows.length - head.length - tail.length} lines cut`;
      kept = [...head, ...tail];
      const text = [header, ...head.map((x) => x.text), cutNote, ...tail.map((x) => x.text)].join("\n");
      last = { page: s.page, text, refs: refsOf(kept), nodes, values: valuesOf(kept) };
      return last;
    }
    last = { page: s.page, text: [header, ...kept.map((x) => x.text)].join("\n"), refs: refsOf(kept), nodes, values: valuesOf(kept) };
    return last;
  }

  function valuesOf(rows: Array<{ n: WebNode; r: number | undefined }>): Map<number, string | undefined> {
    return new Map(rows.filter((x) => x.r !== undefined).map((x) => [x.r!, valueOf(x.n, s)]));
  }

  function refsOf(rows: Array<{ n: WebNode; r: number | undefined }>): Map<number, WebNode> {
    return new Map(rows.filter((x) => x.r !== undefined).map((x) => [x.r!, x.n]));
  }

  function act(a: WebAction): ActResult {
    if (a.kind === "done" || a.kind === "infeasible") return { ok: true, changed: false, line: `[ok] ${a.kind}` };
    if (a.kind === "fill") {
      // Refs stay those of the snapshot the model saw, even though each step re-renders the page.
      const seen = last ?? snapshot();
      const parts: string[] = [];
      let ok = true;
      let changed = false;
      for (const step of a.steps) {
        last = seen;
        const r = act(step);
        ok &&= r.ok;
        changed ||= r.changed;
        const n = seen.refs.get(step.ref);
        parts.push(!r.ok ? r.line : step.kind === "click" ? `"${n?.name}" checked` : `"${n?.name}" = "${n?.secret ? "***" : step.kind === "type" ? step.text : step.option}"`);
      }
      last = undefined;
      return { ok, changed, line: `[${ok ? "ok" : "error"}] fill: ${parts.join("; ")}` };
    }
    const snap = last ?? snapshot();
    const n = snap.refs.get(a.ref);
    if (!n) return { ok: false, changed: false, line: `[error] no element [${a.ref}] on this page` };
    const tag = label(a.ref, n);
    if (n.disabled) return { ok: false, changed: false, line: `[error] ${a.kind} ${tag}: disabled` };
    if (a.kind === "type") {
      if (n.role !== "textbox") return { ok: false, changed: false, line: `[error] type ${tag}: not a text box` };
      const same = s.fields[n.id] === a.text;
      s.fields[n.id] = a.text;
      last = undefined;
      return { ok: true, changed: !same, line: `[ok] type ${tag} = "${n.secret ? "***" : a.text}"${same ? " -> no change" : ""}` };
    }
    if (a.kind === "select") {
      if (n.role !== "combobox") return { ok: false, changed: false, line: `[error] select ${tag}: not a combobox` };
      const opt = n.options?.find((o) => o.toLowerCase() === a.option.trim().toLowerCase());
      if (!opt) return { ok: false, changed: false, line: `[error] select ${tag}: no option "${a.option}"` };
      const same = s.fields[n.id] === opt;
      s.fields[n.id] = opt;
      last = undefined;
      return { ok: true, changed: !same, line: `[ok] select ${tag} = "${opt}"${same ? " -> no change" : ""}` };
    }
    // click
    if (n.role === "textbox" || n.role === "combobox") return { ok: true, changed: false, line: `[ok] click ${tag} -> focused` };
    if (n.role === "radio") {
      const key = n.group ?? n.id;
      const same = s.fields[key] === n.name;
      s.fields[key] = n.name;
      last = undefined;
      return { ok: true, changed: !same, line: `[ok] click ${tag} -> ${same ? "no change" : "checked"}` };
    }
    if (n.role === "checkbox") {
      s.fields[n.id] = s.fields[n.id] === "on" ? "" : "on";
      last = undefined;
      return { ok: true, changed: true, line: `[ok] click ${tag} -> ${s.fields[n.id] ? "checked" : "unchecked"}` };
    }
    const missing = (n.requires ?? []).filter((f) => !s.fields[f]);
    if (missing.length) {
      const names = missing.map((f) => snap.nodes.find((x) => x.id === f)?.name ?? f);
      return { ok: false, changed: false, line: `[error] click ${tag}: fill ${names.map((x) => `"${x}"`).join(", ")} first` };
    }
    const before = JSON.stringify(s);
    n.onClick?.(s);
    if (n.effect) s.effects.push(n.effect);
    const moved = n.to !== undefined && n.to !== s.page;
    if (n.to) s.page = n.to;
    last = undefined;
    if (moved) return { ok: true, changed: true, line: `[ok] click ${tag} -> navigated to ${site.pages[s.page]!.path}` };
    const changed = JSON.stringify(s) !== before;
    return { ok: true, changed, line: `[ok] click ${tag} -> ${changed ? "page changed" : "no change"}` };
  }

  return { snapshot, act, view: () => ({ page: s.page, fields: { ...s.fields }, effects: [...s.effects] }) };
}
