// Decision-model spike (docs/research/decision-models.md): can a letter-choice "decision" prompt pick the skill
// on the cases the phrase router misses? Same prompt for any llama-server model (BotPsy control, Intern-Decision).
// Usage: node --experimental-transform-types src/decision-check.ts <url> [--decision-token 248077] [--sets va,holdout]
import { routeIntent } from "../../model/src/intent-hints.ts";
import { firstWinSkills } from "../../skills/src/catalog.ts";
import type { EvalCase } from "./cases.ts";
import { VA_CASES } from "./va-cases.ts";
import { HOLDOUT_CASES } from "./holdout-cases.ts";
import { HOLDOUT2_CASES } from "./holdout2-cases.ts";
import { MESSAGING_CASES } from "./messaging-cases.ts";
import { MEMDEC_CASES } from "./memdec-cases.ts";

const args = process.argv.slice(2);
const url = args[0] ?? "http://localhost:8090";
const flag = (n: string) => (args.indexOf(n) >= 0 ? args[args.indexOf(n) + 1] : undefined);
const decisionToken = flag("--decision-token") ? Number(flag("--decision-token")) : undefined;
const SETS: Record<string, readonly EvalCase[]> = { va: VA_CASES, holdout: HOLDOUT_CASES, holdout2: HOLDOUT2_CASES, messaging: MESSAGING_CASES, memdec: MEMDEC_CASES };
const sets = (flag("--sets") ?? "va,holdout,messaging,memdec").split(",");

// Options: every skill with its short label, then "respond" (no action). ask_user comes from the details field.
const LETTERS = "ABCDEFGHIJKLMNOP";
const options = [...firstWinSkills.map((s) => ({ id: s.id as string, label: s.menuLine.split(/ \(|\. /)[0]! })), { id: "respond", label: "no action: chat, or something no skill can do (calls, purchases, payments, weather)" }];
const letterOf = new Map(options.map((o, i) => [o.id, LETTERS[i]!]));

function prompt(utterance: string): string {
  const schema = [
    "skill: Which action fits the user's latest message? The message may be in Spanish or English.",
    ...options.map((o, i) => `    ${LETTERS[i]} = ${o.id}: ${o.label}`),
    "details: Does the message say what to do and give enough details to do it?",
    "    A = no: The answer is no (negative, or disagree with the claim).",
    "    B = yes: The answer is yes (affirmative, or align with the claim).",
  ].join("\n");
  return `<|im_start|>system
You are a careful decision assistant. Use the state and decision schema in the user message to make the requested decisions. For every field, choose exactly one answer symbol (e.g. A, B, C, ...) from its listed options and return one valid JSON object mapping each field name to its chosen symbol. Use the field names and symbols exactly as given. Do not include explanations, Markdown, or extra text.<|im_end|>
<|im_start|>user
Return one answer for every field using the supplied answer symbols.

## State
${JSON.stringify(utterance)}
## Decision schema
${schema}<|im_end|>
<|im_start|>assistant
<think>

</think>

{
    "skill": "`;
}

async function probs(p: unknown, allowed: string): Promise<Map<string, number>> {
  const res = await fetch(`${url}/completion`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ prompt: p, n_predict: 1, n_probs: 64, temperature: 0, cache_prompt: true }) });
  const j = (await res.json()) as { completion_probabilities: Array<{ top_logprobs?: Array<{ token: string; logprob: number }>; probs?: Array<{ tok_str: string; prob: number }> }> };
  const first = j.completion_probabilities[0]!;
  const entries = first.top_logprobs ? first.top_logprobs.map((t) => [t.token, Math.exp(t.logprob)] as const) : (first.probs ?? []).map((t) => [t.tok_str, t.prob] as const);
  const m = new Map<string, number>();
  for (const [tok, pr] of entries) if (allowed.includes(tok.trim()) && tok.trim().length === 1) m.set(tok.trim(), (m.get(tok.trim()) ?? 0) + pr);
  const total = [...m.values()].reduce((a, b) => a + b, 0) || 1;
  for (const [k, v] of m) m.set(k, v / total);
  return m;
}

const residual: Array<{ set: string; c: EvalCase }> = [];
for (const name of sets) for (const c of SETS[name] ?? []) if (routeIntent(c.input, firstWinSkills).skills.length === firstWinSkills.length && !routeIntent(c.input, firstWinSkills).outOfScope) residual.push({ set: name, c });

const rows: Array<{ id: string; lang: string; expect: string; got: string; conf: number; details: number }> = [];
for (const { c } of residual) {
  const text = prompt(c.input);
  const skill = await probs(text, LETTERS.slice(0, options.length));
  const [best, conf] = [...skill].sort((a, b) => b[1] - a[1])[0] ?? ["?", 0];
  const cont = decisionToken !== undefined ? [text, decisionToken, '",\n    "details": "'] : `${text}${best}",\n    "details": "`;
  const det = await probs(cont, "AB");
  const yes = det.get("B") ?? 0.5;
  const pickedId = options[LETTERS.indexOf(best)]?.id ?? "?";
  // --no-details: score the skill choice alone (the details field over-asks on some models).
  const got = !args.includes("--no-details") && yes < 0.5 && pickedId !== "respond" ? "ask_user" : pickedId;
  rows.push({ id: c.id, lang: c.lang, expect: c.expect.choice, got, conf, details: yes });
}

const ok = (r: (typeof rows)[number]) => r.got === r.expect || (r.expect === "respond" && r.got === "ask_user");
console.log(`${url}: ${residual.length} router-miss cases from ${sets.join(",")}`);
console.log(`  overall accuracy ${rows.filter(ok).length}/${rows.length} | es ${rows.filter((r) => r.lang === "es" && ok(r)).length}/${rows.filter((r) => r.lang === "es").length} | en ${rows.filter((r) => r.lang === "en" && ok(r)).length}/${rows.filter((r) => r.lang === "en").length}`);
for (const t of [0, 0.5, 0.7, 0.8, 0.9]) {
  const fired = rows.filter((r) => r.conf >= t && r.got !== "respond" && r.got !== "ask_user");
  console.log(`  forcing a skill at confidence >= ${t}: fires ${fired.length}, precision ${fired.length ? Math.round((fired.filter(ok).length / fired.length) * 100) : 0}%`);
}
const asks = rows.filter((r) => r.expect === "ask_user");
console.log(`  ask_user recall ${asks.filter(ok).length}/${asks.length}`);
for (const r of rows.filter((x) => !ok(x)).slice(0, 25)) console.log(`  miss ${r.id}: expected ${r.expect}, got ${r.got} (${r.conf.toFixed(2)})`);
void letterOf;
