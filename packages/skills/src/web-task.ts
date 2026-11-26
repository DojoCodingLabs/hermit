import { skillId, type JsonSchema, type Recipe, type SkillDef, type SkillId } from "@hermit/core";

/**
 * SL-53 (US-WEB-07, US-WEB-11): each recipe the user saved is one skill on the menu, routed by the user's words. The
 * model's whole job is the SL-50 spike's strong part: pick the task and fill its parameters. The skill runs nothing on
 * the web. It offers HM-WEB-02 with the plan (the site, every step in words, every value), where the user taps Start;
 * the runner then replays the recipe with code, and every committing step asks on HM-APPR-01.
 */

const PREFIX = "recipe_";
export const MAX_RECIPES_PER_TURN = 2;

export const recipeSkillId = (recipe: Pick<Recipe, "id">): SkillId => skillId(`${PREFIX}${recipe.id}`);

/** The recipe id a skill id stands for, or undefined when it isn't a recipe's. */
export function recipeFromSkill(id: string): string | undefined {
  return id.startsWith(PREFIX) && /^[a-z0-9]{1,24}$/.test(id.slice(PREFIX.length)) ? id.slice(PREFIX.length) : undefined;
}

const host = (origin: string) => origin.replace(/^https:\/\//, "").replace(/:\d+$/, "");

const KIND_WORDS: Record<Recipe["kind"], string> = {
  book: "book", reorder: "reorder", checkout: "check out", fill_submit: "fill in and send a form", status: "check a status",
};

function argsOf(recipe: Recipe): JsonSchema {
  const properties: Record<string, unknown> = {};
  for (const p of recipe.params) {
    properties[p.name] = p.kind === "choice" && p.options
      ? { type: "string", enum: [...p.options], description: p.label }
      : { type: "string", description: p.label, maxLength: 100 };
  }
  // Nothing is required: a value the user didn't say is asked on the plan, never guessed by the model.
  return { type: "object", properties, required: [], additionalProperties: false };
}

const fold = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
const STOP = new Set(["the", "and", "con", "una", "las", "los", "del", "por", "para", "que", "with", "for", "www", "com", "net", "org", "my", "mi", "mis"]);
const significant = (s: string) => fold(s).split(/[^a-z0-9]+/).filter((w) => w.length >= 3 && !STOP.has(w));
const tokens = (s: string) => fold(s).split(/[^a-z0-9:]+/).filter(Boolean);

/** Times the user said, as HH:MM: "20:00", "8 pm", "8pm", "a las 8 de la noche"; a bare "a las 8" or "at 8" is 08:00 or 20:00. */
function timesSaid(text: string): Set<string> {
  const out = new Set<string>();
  const pad = (h: number, m: number) => `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
  const t = fold(text);
  for (const m of t.matchAll(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm|a\.\s?m\.|p\.\s?m\.|de la noche|de la tarde|de la manana|h\b|hrs\b)?/g)) {
    const h = Number(m[1]);
    const min = m[2] ? Number(m[2]) : 0;
    if (h > 23 || min > 59) continue;
    const mark = (m[3] ?? "").replace(/[\s.]/g, "");
    const before = t.slice(Math.max(0, (m.index ?? 0) - 7), m.index ?? 0);
    if (/^(pm|delanoche|delatarde)$/.test(mark) && h < 12) out.add(pad(h + 12, min));
    else if (/^(am|delamanana)$/.test(mark)) out.add(pad(h === 12 ? 0 : h, min));
    else if (m[2] || mark === "h" || mark === "hrs") out.add(pad(h, min));
    else if (/(a las|at|a la) $/.test(before)) {
      out.add(pad(h, min));
      if (h < 12) out.add(pad(h + 12, min));
    }
  }
  return out;
}

/**
 * The parameter values to keep: only those in the user's own words this turn (or their earlier messages), never from
 * tool output. A dropped value is asked on HM-WEB-02's plan (or its saved default is shown there), so a value an
 * injected page or message put in the model's mouth can't even reach the plan prefilled.
 */
export function recipeValuesFromUser(recipe: Recipe, args: Record<string, unknown>, userText: string, earlier: readonly string[] = []):
  { values: Record<string, string>; dropped: string[] } {
  const said = [userText, ...earlier].join("\n");
  const saidTokens = new Set(tokens(said));
  const saidWords = new Set(significant(said));
  const saidTimes = timesSaid(said);
  const values: Record<string, string> = {};
  const dropped: string[] = [];
  for (const p of recipe.params) {
    const raw = args[p.name];
    if (raw === undefined || raw === null || raw === "") continue;
    const v = typeof raw === "string" ? raw.trim() : typeof raw === "number" ? String(raw) : "";
    let ok = false;
    if (v && v.length <= 100) {
      if (p.kind === "choice") {
        ok = (p.options ?? []).includes(v) && (fold(said).includes(fold(v)) || saidTimes.has(v));
      } else if (p.kind === "number") {
        ok = /^\d{1,6}([.,]\d{1,2})?$/.test(v) && saidTokens.has(v);
      } else if (p.kind === "time") {
        ok = fold(said).includes(fold(v)) || saidTimes.has(v);
      } else {
        const words = significant(v);
        ok = fold(said).includes(fold(v)) || (words.length > 0 && words.every((w) => saidWords.has(w)));
      }
    }
    if (ok) values[p.name] = v;
    else dropped.push(p.name);
  }
  return { values, dropped };
}

/** One skill for one saved recipe. */
export function recipeSkill(recipe: Recipe): SkillDef {
  const site = host(recipe.origin);
  return {
    id: recipeSkillId(recipe),
    version: recipe.version,
    // It contacts nothing and changes nothing: it offers the plan; the user starts it, and commits ask on the sheet.
    risk: "read",
    producesUntrusted: false,
    menuLine: `Do the user's saved web task "${recipe.name}" on ${site} (${KIND_WORDS[recipe.kind]}). Opens the plan in Hermit's browser to check and start; nothing is sent without approval.`.slice(0, 300),
    args: argsOf(recipe),
    describeAction: (a) => ({
      title: recipe.name,
      lines: [{ label: "Site", labelKey: "site", value: site }, ...recipe.params.filter((p) => a[p.name] !== undefined).map((p) => ({ label: p.label, value: String(a[p.name]) }))],
    }),
    normalize(args, ctx) {
      const { values, dropped } = recipeValuesFromUser(recipe, args, ctx.userText, ctx.earlier ?? []);
      return { args: values, notes: dropped.map((d) => `${d}: not in your words, asked on the plan`) };
    },
  };
}

/**
 * The recipes to put on this turn's menu: those whose name or site the user's words name (significant words, accents
 * and case folded), best match first, then the most recently saved; at most two, so the small model's menu stays small.
 */
export function recipesForTurn(userText: string, recipes: readonly Recipe[], max = MAX_RECIPES_PER_TURN): Recipe[] {
  const said = new Set(significant(userText));
  const scored = recipes.map((r) => {
    const words = new Set([...significant(r.name), ...host(r.origin).split(".").slice(0, -1).flatMap((l) => significant(l))]);
    return { r, score: [...words].filter((w) => said.has(w)).length };
  });
  return scored.filter((x) => x.score > 0).sort((a, b) => b.score - a.score || b.r.updatedAt - a.r.updatedAt).slice(0, max).map((x) => x.r);
}
