import type { JsonSchema } from "./types.ts";

// Deterministic repairs for small models (ported in spirit from Hermes Agent's repair chain).
// Each repair is recorded so the audit and the eval can see what was fixed.

export class RepairError extends Error {
  constructor(readonly code: "bad_json", message: string) {
    super(`${code}: ${message}`);
  }
}

function levenshtein(a: string, b: string): number {
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0]!;
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const up = prev[j]!;
      prev[j] = Math.min(up + 1, prev[j - 1]! + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = up;
    }
  }
  return prev[b.length]!;
}

export function repairSkillName(raw: string, menu: readonly string[]): { name: string; repaired: boolean } | null {
  if (menu.includes(raw)) return { name: raw, repaired: false };
  const norm = raw
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .toLowerCase()
    .replace(/[\s-]+/g, "_")
    .replace(/_tool$/, "");
  if (menu.includes(norm)) return { name: norm, repaired: true };
  const scored = menu.map((m) => ({ m, d: levenshtein(norm, m) })).filter((x) => x.d <= 2).sort((a, b) => a.d - b.d);
  if (!scored.length || (scored[1] && scored[1].d === scored[0]!.d)) return null;
  return { name: scored[0]!.m, repaired: true };
}

export function parseArgs(rawText: string): { value: unknown; repairs: string[] } {
  const repairs: string[] = [];
  let text = rawText.trim();
  const fence = text.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  if (fence) {
    text = fence[1]!;
    repairs.push("code_fence");
  }
  try {
    return { value: JSON.parse(text), repairs };
  } catch {
    // fall through to repairs
  }
  const fixed = text
    .replace(/,\s*([}\]])/g, "$1")
    .replace(/\bNone\b/g, "null")
    .replace(/\bTrue\b/g, "true")
    .replace(/\bFalse\b/g, "false");
  try {
    const value = JSON.parse(fixed);
    repairs.push("json_fixed");
    return { value, repairs };
  } catch (err) {
    throw new RepairError("bad_json", (err as Error).message);
  }
}

type Prop = { type?: string; maxLength?: number; pattern?: string; enum?: unknown[] };
const propsOf = (schema: JsonSchema) => (schema.properties ?? {}) as Record<string, Prop>;
/** Own-key lookup only, so "constructor" or "__proto__" never resolve to inherited values. */
const propFor = (props: Record<string, Prop>, k: string): Prop | undefined => (Object.hasOwn(props, k) ? props[k] : undefined);
/** Names that could reach Object.prototype. Model output can never set them. */
const hostileKey = (k: string) => k === "__proto__" || k === "prototype" || k in Object.prototype;

export function coerceArgs(args: unknown, schema: JsonSchema): { args: Record<string, unknown>; repairs: string[] } {
  const repairs: string[] = [];
  const input = args && typeof args === "object" && !Array.isArray(args) ? (args as Record<string, unknown>) : {};
  const props = propsOf(schema);
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(input)) {
    const p = propFor(props, k);
    if (hostileKey(k) || !p) {
      if (hostileKey(k) || schema.additionalProperties === false) {
        repairs.push(`dropped:${k}`);
        continue;
      }
      out[k] = v;
      continue;
    }
    if ((p.type === "integer" || p.type === "number") && typeof v === "string" && v.trim() !== "" && !Number.isNaN(Number(v))) {
      out[k] = Number(v);
      repairs.push(`coerced:${k}`);
    } else if (p.type === "boolean" && (v === "true" || v === "false")) {
      out[k] = v === "true";
      repairs.push(`coerced:${k}`);
    } else {
      out[k] = v;
    }
  }
  return { args: out, repairs };
}

const typeOk = (t: string | undefined, v: unknown) => {
  switch (t) {
    case undefined: return true;
    case "string": return typeof v === "string";
    case "integer": return Number.isInteger(v);
    case "number": return typeof v === "number" && Number.isFinite(v);
    case "boolean": return typeof v === "boolean";
    case "array": return Array.isArray(v);
    case "object": return !!v && typeof v === "object" && !Array.isArray(v);
    default: return false;
  }
};

/** Validates the subset of JSON Schema the skill catalog uses. Empty array means valid. */
export function validateArgs(args: Record<string, unknown>, schema: JsonSchema): string[] {
  const errors: string[] = [];
  const props = propsOf(schema);
  for (const r of (schema.required ?? []) as string[]) if (!Object.hasOwn(args, r)) errors.push(`${r} is required`);
  for (const [k, v] of Object.entries(args)) {
    const p = propFor(props, k);
    if (!p) {
      if (schema.additionalProperties === false) errors.push(`${k} is not allowed`);
      continue;
    }
    if (!typeOk(p.type, v)) {
      errors.push(`${k} must be ${p.type}`);
      continue;
    }
    if (typeof v === "string") {
      if (p.maxLength !== undefined && v.length > p.maxLength) errors.push(`${k} is longer than ${p.maxLength} characters`);
      if (p.pattern && !new RegExp(p.pattern, "u").test(v)) errors.push(`${k} has an invalid format`);
    }
    if (p.enum && !p.enum.includes(v)) errors.push(`${k} must be one of ${p.enum.join(", ")}`);
  }
  return errors;
}
