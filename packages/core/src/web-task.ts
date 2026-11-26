import { normalizeOrigin } from "./autofill-origin.ts";
import { isProfileKind, type ProfileKind } from "./profile.ts";
import { parseWebUrl } from "./web.ts";

/**
 * SL-53 (US-WEB-07 to US-WEB-11, FR-WEB-05 to FR-WEB-10): web tasks are recipe-first. The SL-50 spike measured the
 * phone model at 38 to 54% per step when it drives a page, so code owns the sequence: a recipe is Hermit's own,
 * versioned list of steps bound to one exact origin, finding elements by role and name, with the user's values as
 * parameters. The model only picks a recipe and fills its parameters from the user's words. Every click is classified
 * here before it runs (FR-WEB-07), and a committing one is approved on HM-APPR-01. The format is Hermit's own;
 * workflow-use (AGPL) is not copied.
 */

/** The recipe format this code reads. A stored recipe of another format is refused, never guessed. */
export const RECIPE_FORMAT = 1;
/** FR-WEB-06: at most 15 browser steps per task. */
export const MAX_RECIPE_STEPS = 15;
/** FR-WEB-06: a task stops after 3 failed or no-change actions in a row. */
export const MAX_FAILED_IN_A_ROW = 3;
export const MAX_RECIPE_PARAMS = 8;
/** How many recipes the user may keep: each one is a skill the router may offer. */
export const MAX_RECIPES = 30;

/** FR-WEB-06: the known task kinds. Anything else is declined on the phone (Boost, V2). */
export const TASK_KINDS = ["book", "reorder", "checkout", "fill_submit", "status"] as const;
export type TaskKind = (typeof TASK_KINDS)[number];

/** What a committing click is to the cage (FR-WEB-07). */
export type CommitRisk = "remote_write" | "spend" | "credential";
const COMMIT_RISKS: readonly CommitRisk[] = ["remote_write", "spend", "credential"];

/** Roles a step may target, as the injected accessibility snapshot names them (FR-WEB-05). */
export const TARGET_ROLES = ["button", "link", "textbox", "searchbox", "combobox", "checkbox", "radio", "option", "tab", "menuitem"] as const;

/** An element by role and accessible name; `nth` picks among identical ones in page order (five "Buy again" buttons). */
export interface Target {
  role: string;
  name: string;
  nth?: number;
}

export type ValueSource =
  /** One of the recipe's parameters: the user's words this time, or what they typed on HM-WEB-02. */
  | { param: string }
  /** A value the user chose to keep fixed when saving. */
  | { literal: string }
  /** A plain profile field (SL-35), through the profile's own approval; sensitive fields are never typed by a task. */
  | { profile: ProfileKind };

export type RecipeStep =
  | { op: "open"; path: string }
  | { op: "fill"; target: Target; value: ValueSource }
  | { op: "select"; target: Target; value: ValueSource }
  | { op: "check"; target: Target; on: boolean }
  | { op: "click"; target: Target; commit?: CommitRisk }
  | { op: "wait"; target: Target; timeoutMs: number }
  /** The page as text goes to the quarantined reader (FR-WEB-03) with this question; only its summary comes back. */
  | { op: "read"; question: string }
  /** The vault's login for this exact origin (FR-VAULT-04), through the SL-36 approval: a Keystore signature. */
  | { op: "login" };

export type ParamKind = "text" | "number" | "date" | "time" | "choice";
const PARAM_KINDS: readonly ParamKind[] = ["text", "number", "date", "time", "choice"];

export interface RecipeParam {
  name: string;
  label: string;
  kind: ParamKind;
  options?: string[];
  required: boolean;
  /** The value the user used when the recipe was saved, offered on HM-WEB-02 when their words don't say. */
  default?: string;
}

export interface Recipe {
  format: typeof RECIPE_FORMAT;
  id: string;
  /** Goes up by one each time the user saves a change. */
  version: number;
  name: string;
  kind: TaskKind;
  /** Exact origin (scheme, host, port), https only. Every page the task drives must be on it. */
  origin: string;
  params: RecipeParam[];
  steps: RecipeStep[];
  createdAt: number;
  updatedAt: number;
}

export type RecipeProblemCode =
  | "shape" | "format" | "id" | "version" | "name" | "kind" | "origin" | "params" | "param" | "steps" | "first_step" | "op" | "path"
  | "target" | "value" | "unknown_param" | "unused_param" | "wait" | "question" | "commit";

export interface RecipeProblem {
  code: RecipeProblemCode;
  /** The step or parameter index. */
  at?: number;
}

const ID = /^[a-z0-9]{1,24}$/;
const PARAM_NAME = /^[a-z][a-z0-9_]{0,23}$/;
// eslint-disable-next-line no-control-regex -- control characters are exactly what is refused
const CONTROL = /[\u0000-\u001f\u007f]/;
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const text = (v: unknown, max: number): v is string => typeof v === "string" && v.trim().length > 0 && v.length <= max && !CONTROL.test(v);
const int = (v: unknown, min: number, max: number): v is number => typeof v === "number" && Number.isInteger(v) && v >= min && v <= max;

/** A path on the recipe's own origin: starts with one slash, no backslash, no whitespace or control characters. */
export function isSamePath(path: unknown): path is string {
  return typeof path === "string" && path.length <= 300 && path.startsWith("/") && !path.startsWith("//") && !/[\\\s]/.test(path) && !CONTROL.test(path);
}

/** An exact https origin as the recipe must store it (normalized, public host, no path). */
export function isRecipeOrigin(origin: unknown): origin is string {
  if (typeof origin !== "string" || !origin.startsWith("https://")) return false;
  if (normalizeOrigin(origin) !== origin) return false;
  return parseWebUrl(`${origin}/`) !== undefined;
}

function targetOk(t: unknown): t is Target {
  return isObj(t) && typeof t.role === "string" && (TARGET_ROLES as readonly string[]).includes(t.role) && text(t.name, 120) && (t.nth === undefined || int(t.nth, 0, 50));
}

function valueOk(v: unknown): v is ValueSource {
  if (!isObj(v)) return false;
  const keys = Object.keys(v);
  if (keys.length !== 1) return false;
  if ("param" in v) return typeof v.param === "string" && PARAM_NAME.test(v.param);
  if ("literal" in v) return typeof v.literal === "string" && v.literal.length <= 200 && !CONTROL.test(v.literal);
  if ("profile" in v) return isProfileKind(v.profile);
  return false;
}

/**
 * Checks a stored or drafted recipe against the format. Anything that doesn't fit is refused with codes (never thrown),
 * so a corrupted row or a hand-edited one can't run: steps the runner doesn't know, a path to another site, more than
 * 15 steps, a parameter nobody fills or a value from a parameter that doesn't exist.
 */
export function validateRecipe(raw: unknown): { ok: true; recipe: Recipe } | { ok: false; problems: RecipeProblem[] } {
  if (!isObj(raw)) return { ok: false, problems: [{ code: "shape" }] };
  const problems: RecipeProblem[] = [];
  const add = (code: RecipeProblemCode, at?: number) => problems.push(at === undefined ? { code } : { code, at });
  if (raw.format !== RECIPE_FORMAT) return { ok: false, problems: [{ code: "format" }] };
  if (typeof raw.id !== "string" || !ID.test(raw.id)) add("id");
  if (!int(raw.version, 1, 1_000_000)) add("version");
  if (!text(raw.name, 60)) add("name");
  if (typeof raw.kind !== "string" || !(TASK_KINDS as readonly string[]).includes(raw.kind)) add("kind");
  if (!isRecipeOrigin(raw.origin)) add("origin");
  if (!int(raw.createdAt, 0, Number.MAX_SAFE_INTEGER) || !int(raw.updatedAt, 0, Number.MAX_SAFE_INTEGER)) add("shape");

  const params = Array.isArray(raw.params) ? raw.params : undefined;
  const names = new Set<string>();
  if (!params || params.length > MAX_RECIPE_PARAMS) add("params");
  for (const [i, p] of (params ?? []).entries()) {
    const ok = isObj(p) && typeof p.name === "string" && PARAM_NAME.test(p.name) && !names.has(p.name) && text(p.label, 60) &&
      typeof p.kind === "string" && (PARAM_KINDS as readonly string[]).includes(p.kind) && typeof p.required === "boolean" &&
      (p.default === undefined || (typeof p.default === "string" && p.default.length <= 200 && !CONTROL.test(p.default))) &&
      (p.kind === "choice"
        ? Array.isArray(p.options) && p.options.length >= 1 && p.options.length <= 20 && p.options.every((o) => text(o, 60))
        : p.options === undefined);
    if (!ok) add("param", i);
    else names.add(p.name as string);
  }

  const steps = Array.isArray(raw.steps) ? raw.steps : undefined;
  const used = new Set<string>();
  if (!steps || steps.length < 1 || steps.length > MAX_RECIPE_STEPS) add("steps");
  for (const [i, s] of (steps ?? []).entries()) {
    if (!isObj(s) || typeof s.op !== "string") {
      add("op", i);
      continue;
    }
    if (i === 0 && s.op !== "open") add("first_step", 0);
    switch (s.op) {
      case "open":
        if (!isSamePath(s.path)) add("path", i);
        break;
      case "fill":
      case "select":
        if (!targetOk(s.target)) add("target", i);
        if (!valueOk(s.value)) add("value", i);
        else if ("param" in s.value) {
          if (!names.has(s.value.param)) add("unknown_param", i);
          used.add(s.value.param);
        }
        break;
      case "check":
        if (!targetOk(s.target)) add("target", i);
        if (typeof s.on !== "boolean") add("value", i);
        break;
      case "click":
        if (!targetOk(s.target)) add("target", i);
        if (s.commit !== undefined && !COMMIT_RISKS.includes(s.commit as CommitRisk)) add("commit", i);
        break;
      case "wait":
        if (!targetOk(s.target)) add("target", i);
        if (!int(s.timeoutMs, 500, 15_000)) add("wait", i);
        break;
      case "read":
        if (!text(s.question, 200)) add("question", i);
        break;
      case "login":
        break;
      default:
        add("op", i);
    }
  }
  for (const [i, p] of (params ?? []).entries()) if (isObj(p) && typeof p.name === "string" && names.has(p.name) && !used.has(p.name)) add("unused_param", i);
  return problems.length ? { ok: false, problems } : { ok: true, recipe: raw as unknown as Recipe };
}

/** The address of a path on the recipe's origin. */
export function recipeUrl(recipe: Pick<Recipe, "origin">, path: string): string {
  return `${recipe.origin}${path}`;
}

/** The exact origin of a page address (scheme, host, non-default port), or undefined for anything that isn't http(s). */
export function originOf(url: string): string | undefined {
  const m = /^(https?:\/\/[^/?#]+)/i.exec(url);
  if (!m || m[1]!.includes("@")) return undefined;
  return normalizeOrigin(m[1]!);
}

/** A form field as the injected script reads it: its label, its current value (masked when secret) and whether it is secret. */
export interface LiveField {
  label: string;
  value: string;
  secret: boolean;
}

/**
 * An element on the live page, read by the injected script. Labels and text are the site's own words: untrusted,
 * shown to the user, never given to the model outside the quarantined reader.
 */
export interface LiveElement {
  role: string;
  name: string;
  nth: number;
  disabled?: boolean;
  /** A button of type submit, or Enter in a field that submits its form. */
  submits?: boolean;
  /**
   * The form the element submits or belongs to, and the fields that would be sent. `action`, `method` and `target` are
   * the effective submission: a submit button's own `formaction`, `formmethod` and `formtarget` win over the form's.
   * `target` is the window the response opens in (absent, empty or `_self`: this page).
   */
  form?: { id: string; action?: string; method?: string; target?: string; fields: LiveField[] };
  /** The page has a form field outside search (FR-WEB-07's default for unclassifiable buttons). */
  pageHasForm: boolean;
  /** Text next to the element (its row, its dialog), where amounts are read from. */
  nearby?: string;
}

const fold = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

// FR-WEB-07, in the spirit of Nanobrowser's classifier (Apache 2.0), reimplemented with the SL-50 spike's vocabulary
// (packages/eval/src/web/classify.ts). English and Spanish. Spend first, then credential, then writes, then safe.
const SPEND = /\b(place (your )?order|pay( now)?|buy now|complete (purchase|order)|confirm (purchase|payment|order)|checkout now|realizar (el )?pedido|pagar|comprar ahora|confirmar (compra|pago|pedido)|finalizar compra)\b/;
const CREDENTIAL = /\b(sign in|log ?in|iniciar sesion|ingresar|entrar|grant|allow|authorize|autorizar|permitir)\b/;
const WRITE = /\b(submit|send|confirm|book|reserve|delete|remove|cancel (order|reservation|booking|subscription)|save|request|update|apply|subscribe|unsubscribe|enviar|confirmar|reservar|eliminar|borrar|quitar|cancelar|guardar|solicitar|actualizar|aplicar|suscribir)\b/;
const SAFE = /\b(add to cart|agregar al carrito|anadir al carrito|buy again|volver a comprar|proceed to checkout|continuar al pago|ir a pagar|go to cart|ver carrito|cart|carrito|search|buscar|view|ver|track|rastrear|reject all|rechazar todo|back|volver|edit|editar|change|cambiar|your orders|mis pedidos|orders|pedidos|menu|home|inicio)\b/;
const MONEY = /([$€£₡]\s?\d|\d[.,]\d{2}\s?(usd|eur|crc|mxn|cop)?\b|\b(usd|eur|crc|mxn|cop|usdt)\s?\d)/i;
const GENERIC = /\b(continue|continuar|next|siguiente|ok|aceptar|accept|done|listo|finish|terminar)\b/;

/**
 * Whether a click commits, and as what. Policy: err toward asking. A false positive costs one prompt; a false negative
 * is not allowed (FR-WEB-07). Only buttons and links click; a field never commits on its own.
 */
export function classifyClick(e: LiveElement): CommitRisk | null {
  if (e.role !== "button" && e.role !== "link" && e.role !== "menuitem") return null;
  const name = fold(e.name);
  const money = MONEY.test(e.name) || MONEY.test(e.nearby ?? "");
  if (SPEND.test(name)) return "spend";
  if (GENERIC.test(name) && money) return "spend";
  if (CREDENTIAL.test(name)) return "credential";
  if (WRITE.test(name)) return "remote_write";
  if (e.submits) return "remote_write";
  if (SAFE.test(name)) return null;
  return e.role === "button" && e.pageHasForm ? "remote_write" : null;
}

const RANK: Record<CommitRisk, number> = { remote_write: 1, credential: 2, spend: 3 };

/** The step's risk: the stricter of what the recipe recorded and what the live element is. Only clicks commit. */
export function stepRisk(step: RecipeStep, live: LiveElement | undefined): CommitRisk | null {
  if (step.op !== "click") return null;
  const now = live ? classifyClick(live) : null;
  const was = step.commit ?? null;
  if (!now) return was;
  if (!was) return now;
  return RANK[now] >= RANK[was] ? now : was;
}

/**
 * FR-WEB-09: after the approval, the element must still be the one the sheet showed: role, name, page origin, form
 * target, and the values the form would send. Any mismatch cancels the action.
 */
export function sameApprovedElement(shown: { element: LiveElement; origin: string }, now: { element: LiveElement; origin: string }): boolean {
  const a = shown.element;
  const b = now.element;
  if (shown.origin !== now.origin || a.role !== b.role || a.name !== b.name || (a.disabled ?? false) !== (b.disabled ?? false)) return false;
  if ((a.form?.action ?? "") !== (b.form?.action ?? "") || (a.form?.method ?? "") !== (b.form?.method ?? "")) return false;
  if ((a.form?.target ?? "") !== (b.form?.target ?? "")) return false;
  const fields = (e: LiveElement) => JSON.stringify((e.form?.fields ?? []).map((f) => [f.label, f.secret ? "" : f.value, f.secret]));
  return fields(a) === fields(b);
}

/** What the recorder sees while the user does a task themselves (US-WEB-11). Values exist only until the draft is made. */
export type RecordedEvent =
  | { kind: "click"; target: Target; risk: CommitRisk | null }
  | { kind: "fill"; target: Target; value: string; secret: boolean; label: string; form?: string }
  | { kind: "select"; target: Target; value: string; label: string; options?: string[] }
  | { kind: "check"; target: Target; on: boolean };

export type DraftRefusal = "not_https" | "too_long" | "invalid";

const slug = (label: string) => {
  const s = fold(label).replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").replace(/^(\d)/, "v$1").slice(0, 24);
  return s || "value";
};

/**
 * Turns what the user did into a recipe draft. Every value the user typed or picked becomes a parameter, with what they
 * used as its default, unless they marked it `fixed`; repeated edits of one field keep the last value. A secret field is
 * never recorded: its form becomes one `login` step (the vault's login for that origin), and the form's other typed
 * values (the username) are dropped with it. The draft goes through `validateRecipe`; the user names and saves it.
 */
export function draftRecipe(input: {
  startUrl: string;
  events: readonly RecordedEvent[];
  name: string;
  kind: TaskKind;
  now: number;
  id: string;
  /** Parameter names the user chose to keep as they typed them. */
  fixed?: readonly string[];
  question?: string;
}): { ok: true; recipe: Recipe } | { ok: false; reason: DraftRefusal } {
  const origin = originOf(input.startUrl);
  if (!origin || !origin.startsWith("https://")) return { ok: false, reason: "not_https" };
  const path = input.startUrl.slice(origin.length) || "/";

  const secretForms = new Set(input.events.flatMap((e) => (e.kind === "fill" && e.secret ? [e.form ?? "?"] : [])));
  const steps: RecipeStep[] = [{ op: "open", path: path.startsWith("/") ? path : `/${path}` }];
  const params: RecipeParam[] = [];
  const paramFor = new Map<string, RecipeParam>();
  const key = (t: Target) => `${t.role}|${t.name}|${t.nth ?? 0}`;
  const loginAdded = new Set<string>();

  for (const e of input.events) {
    if (e.kind === "fill" && (e.secret || secretForms.has(e.form ?? "\u0000"))) {
      const form = e.form ?? "?";
      if (!loginAdded.has(form)) {
        steps.push({ op: "login" });
        loginAdded.add(form);
      }
      continue;
    }
    if (e.kind === "click") {
      steps.push(e.risk ? { op: "click", target: e.target, commit: e.risk } : { op: "click", target: e.target });
      continue;
    }
    if (e.kind === "check") {
      steps.push({ op: "check", target: e.target, on: e.on });
      continue;
    }
    // A fill or a select: the last value for a field wins, in the position of its first edit.
    const k = key(e.target);
    const existing = paramFor.get(k);
    if (existing) {
      existing.default = e.value;
      continue;
    }
    const base = slug(e.label);
    let name = base;
    for (let n = 2; params.some((p) => p.name === name); n++) name = `${base.slice(0, 21)}_${n}`;
    const param: RecipeParam = e.kind === "select" && e.options?.length
      ? { name, label: e.label.slice(0, 60), kind: "choice", options: e.options.slice(0, 20), required: true, default: e.value }
      : { name, label: e.label.slice(0, 60), kind: "text", required: true, default: e.value };
    params.push(param);
    paramFor.set(k, param);
    steps.push({ op: e.kind, target: e.target, value: { param: name } });
  }
  if (input.question?.trim()) steps.push({ op: "read", question: input.question.trim() });
  if (steps.length > MAX_RECIPE_STEPS) return { ok: false, reason: "too_long" };

  // Values the user keeps fixed become literals; the rest are asked each time (or filled from their words).
  const fixed = new Set(input.fixed ?? []);
  const finalSteps = steps.map((s): RecipeStep => {
    if ((s.op === "fill" || s.op === "select") && "param" in s.value && fixed.has(s.value.param)) {
      return { ...s, value: { literal: params.find((p) => p.name === (s.value as { param: string }).param)?.default ?? "" } };
    }
    return s;
  });
  const recipe: Recipe = {
    format: RECIPE_FORMAT,
    id: input.id,
    version: 1,
    name: input.name.trim(),
    kind: input.kind,
    origin,
    params: params.filter((p) => !fixed.has(p.name)),
    steps: finalSteps,
    createdAt: input.now,
    updatedAt: input.now,
  };
  const v = validateRecipe(recipe);
  return v.ok ? { ok: true, recipe: v.recipe } : { ok: false, reason: "invalid" };
}
