// The one action the model writes per step, its grammar, and the code that validates it against the page.
import { parseFill } from "./form.ts";
import type { Snapshot, WebAction, WebNode } from "./sim.ts";

const CLICKABLE = new Set<WebNode["role"]>(["button", "link", "radio", "checkbox"]);

function refsBy(snap: Snapshot, pick: (n: WebNode) => boolean): number[] {
  return [...snap.refs].filter(([, n]) => pick(n) && !n.disabled).map(([r]) => r);
}

/**
 * A JSON schema for llama.cpp's grammar: the ref can only be a number printed in this snapshot, and only of
 * the right kind (click a button, type into a text box, select in a combobox). Disabled elements are left out,
 * and so is any `kind:ref` in `exclude` (actions the harness already saw change nothing).
 */
export function actionSchema(snap: Snapshot, exclude: ReadonlySet<string> = new Set(), opts: { optionEnums?: boolean } = {}): Record<string, unknown> {
  const variant = (action: string, props: Record<string, unknown>) => ({
    type: "object",
    properties: { action: { const: action }, ...props },
    required: ["action", ...Object.keys(props)],
    additionalProperties: false,
  });
  const text = { type: "string", maxLength: 200 };
  const out: unknown[] = [];
  const keep = (kind: string) => (r: number) => !exclude.has(`${kind}:${r}`);
  const click = refsBy(snap, (n) => CLICKABLE.has(n.role)).filter(keep("click"));
  const type = refsBy(snap, (n) => n.role === "textbox").filter(keep("type"));
  const select = refsBy(snap, (n) => n.role === "combobox").filter(keep("select"));
  if (click.length) out.push(variant("click", { ref: { type: "integer", enum: click } }));
  if (type.length) out.push(variant("type", { ref: { type: "integer", enum: type }, text }));
  if (select.length && opts.optionEnums) {
    // One variant per combobox, so the option can only be one this combobox lists.
    for (const r of select) out.push(variant("select", { ref: { type: "integer", enum: [r] }, option: { type: "string", enum: snap.refs.get(r)!.options ?? [] } }));
  } else if (select.length) out.push(variant("select", { ref: { type: "integer", enum: select }, option: { type: "string", maxLength: 60 } }));
  out.push(variant("done", { answer: text }));
  out.push(variant("infeasible", { reason: text }));
  return { anyOf: out };
}

export type Parsed = { ok: true; action: WebAction } | { ok: false; error: string };

function firstObject(raw: string): unknown {
  const s = raw.replace(/<think>[\s\S]*?<\/think>/g, "");
  const start = s.indexOf("{");
  if (start < 0) return undefined;
  let depth = 0;
  let inStr = false;
  for (let i = start; i < s.length; i++) {
    const c = s[i];
    if (inStr) {
      if (c === "\\") i++;
      else if (c === '"') inStr = false;
    } else if (c === '"') inStr = true;
    else if (c === "{") depth++;
    else if (c === "}" && --depth === 0) {
      try {
        return JSON.parse(s.slice(start, i + 1));
      } catch {
        return undefined;
      }
    }
  }
  return undefined;
}

/** Reads the model's output and checks it against the page it saw. Code, not the model, decides validity. */
export function parseAction(raw: string, snap: Snapshot): Parsed {
  const o = firstObject(raw) as Record<string, unknown> | undefined;
  if (!o || typeof o !== "object") return { ok: false, error: "no JSON object" };
  const kind = String(o.action ?? "");
  const str = (k: string) => (typeof o[k] === "string" ? (o[k] as string).trim() : "");
  if (kind === "done") return { ok: true, action: { kind, answer: str("answer") } };
  if (kind === "infeasible") return { ok: true, action: { kind, reason: str("reason") } };
  if (kind === "fill") {
    const f = parseFill(o, snap);
    return f.ok ? { ok: true, action: { kind, steps: f.steps } } : f;
  }
  if (kind !== "click" && kind !== "type" && kind !== "select") return { ok: false, error: `unknown action ${kind}` };
  const ref = Number(o.ref);
  const n = Number.isInteger(ref) ? snap.refs.get(ref) : undefined;
  if (!n) return { ok: false, error: `ref ${String(o.ref)} is not on this page` };
  if (kind === "click") {
    if (!CLICKABLE.has(n.role)) return { ok: false, error: `ref ${ref} is a ${n.role}, not clickable` };
    return { ok: true, action: { kind, ref } };
  }
  if (kind === "type") {
    if (n.role !== "textbox") return { ok: false, error: `ref ${ref} is a ${n.role}, not a textbox` };
    if (!str("text")) return { ok: false, error: "type needs text" };
    return { ok: true, action: { kind, ref, text: str("text") } };
  }
  if (n.role !== "combobox") return { ok: false, error: `ref ${ref} is a ${n.role}, not a combobox` };
  if (!str("option")) return { ok: false, error: "select needs an option" };
  return { ok: true, action: { kind, ref, option: str("option") } };
}
