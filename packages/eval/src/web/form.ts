// Harness v3: a form on the page becomes one typed slot-filling step, like a skill's arguments. Code reads the
// fields from the tree and builds the grammar (options pinned); the model fills the values in one JSON object;
// code turns it into the primitive actions and runs them. The submit click stays a separate, guarded step.
import type { Snapshot, WebNode } from "./sim.ts";

export type PrimitiveAction = { kind: "type"; ref: number; text: string } | { kind: "select"; ref: number; option: string } | { kind: "click"; ref: number };

export interface FormField {
  key: string;
  kind: "text" | "choice" | "radio";
  optional: boolean;
  options?: string[];
  /** The textbox or combobox ref, or one ref per radio option (same order as options). */
  refs: number[];
}

export interface Form {
  id: string;
  fields: FormField[];
}

const isSearch = (n: WebNode) => /\b(search|buscar)\b/i.test(n.name);
const isOptional = (name: string) => /\b(optional|opcional)\b/i.test(name);

export function formsOf(snap: Snapshot): Form[] {
  const forms = new Map<string, Form>();
  const formOf = (n: WebNode) => {
    const id = n.form ?? "main";
    if (!forms.has(id)) forms.set(id, { id, fields: [] });
    return forms.get(id)!;
  };
  for (const [r, n] of snap.refs) {
    if (n.disabled) continue;
    if (n.role === "textbox" && !isSearch(n)) formOf(n).fields.push({ key: n.name, kind: "text", optional: isOptional(n.name), refs: [r] });
    if (n.role === "combobox") formOf(n).fields.push({ key: n.name, kind: "choice", optional: isOptional(n.name), options: n.options ?? [], refs: [r] });
    if (n.role === "radio" && n.group) {
      const f = formOf(n);
      const g = f.fields.find((x) => x.kind === "radio" && x.key === n.group);
      if (g) {
        g.options!.push(n.name);
        g.refs.push(r);
      } else f.fields.push({ key: n.group, kind: "radio", optional: false, options: [n.name], refs: [r] });
    }
  }
  return [...forms.values()].filter((f) => f.fields.length);
}

/** One `fill` variant per form, for the step's anyOf. */
export function fillSchema(forms: Form[]): Record<string, unknown>[] {
  return forms.map((f) => ({
    type: "object",
    properties: {
      action: { const: "fill" },
      form: { const: f.id },
      values: {
        type: "object",
        properties: Object.fromEntries(f.fields.map((x) => [x.key, x.options ? { type: "string", enum: x.options } : { type: "string", maxLength: 80 }])),
        required: f.fields.filter((x) => !x.optional).map((x) => x.key),
        additionalProperties: false,
      },
    },
    required: ["action", "form", "values"],
    additionalProperties: false,
  }));
}

export type ParsedFill = { ok: true; steps: PrimitiveAction[] } | { ok: false; error: string };

export function parseFill(o: { form?: unknown; values?: unknown }, snap: Snapshot): ParsedFill {
  const form = formsOf(snap).find((f) => f.id === String(o.form ?? "main"));
  if (!form) return { ok: false, error: `no form ${String(o.form)} on this page` };
  const values = (o.values && typeof o.values === "object" ? o.values : {}) as Record<string, unknown>;
  const steps: PrimitiveAction[] = [];
  for (const f of form.fields) {
    const raw = values[f.key];
    const v = typeof raw === "string" ? raw.trim() : raw === undefined ? "" : String(raw);
    if (!v) continue;
    if (f.kind === "text") steps.push({ kind: "type", ref: f.refs[0]!, text: v });
    else {
      const i = f.options!.findIndex((x) => x.toLowerCase() === v.toLowerCase());
      if (i < 0) return { ok: false, error: `no option "${v}" for "${f.key}"` };
      steps.push(f.kind === "choice" ? { kind: "select", ref: f.refs[0]!, option: f.options![i]! } : { kind: "click", ref: f.refs[i]! });
    }
  }
  if (!steps.length) return { ok: false, error: "fill needs at least one value" };
  return { ok: true, steps };
}
