// Offline check: kNN intent routing over sentence embeddings from an OpenAI-compatible /v1/embeddings server.
import { EXAMPLE_BANK } from "../../model/src/example-bank.ts";
import { VA_CASES } from "./va-cases.ts";
import { HOLDOUT_CASES } from "./holdout-cases.ts";
import { routeIntent } from "../../model/src/intent-hints.ts";
import { firstWinSkills } from "../../skills/src/catalog.ts";

const url = process.argv[2] ?? "http://localhost:8091";
const prefix = process.argv[3] ?? "";
async function embed(texts: string[]): Promise<number[][]> {
  const out: number[][] = [];
  for (let i = 0; i < texts.length; i += 32) {
    const res = await fetch(`${url}/v1/embeddings`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ input: texts.slice(i, i + 32).map((t) => prefix + t) }) });
    const j = (await res.json()) as { data: Array<{ embedding: number[] }> };
    out.push(...j.data.map((d) => { const n = Math.hypot(...d.embedding) || 1; return d.embedding.map((x) => x / n); }));
  }
  return out;
}
const dot = (a: number[], b: number[]) => a.reduce((s, x, i) => s + x * b[i]!, 0);
const bankV = await embed(EXAMPLE_BANK.map(([t]) => t));
const norm = (l: string) => (l === "reply_message" ? "read_messages" : l);
for (const [name, cases] of [["va", VA_CASES], ["holdout", HOLDOUT_CASES]] as const) {
  const qv = await embed(cases.map((c) => c.input));
  const guesses = qv.map((q) => {
    const sims = bankV.map((b, i) => ({ label: EXAMPLE_BANK[i]![1], sim: dot(q, b) })).sort((a, b) => b.sim - a.sim).slice(0, 3);
    const votes = new Map<string, number>();
    for (const s of sims) votes.set(s.label, (votes.get(s.label) ?? 0) + s.sim);
    const [label, total] = [...votes].sort((a, b) => b[1] - a[1])[0]!;
    return { label, score: total / sims.filter((s) => s.label === label).length };
  });
  // Residual: only cases the phrase router leaves alone, and only skill guesses (what it would force).
  const residual = cases.map((c, i) => ({ c, g: guesses[i]! })).filter(({ c }) => routeIntent(c.input, firstWinSkills).skills.length === firstWinSkills.length);
  for (const t of [0.6, 0.7, 0.75, 0.8]) {
    const fired = residual.filter(({ g }) => g.score >= t && g.label !== "respond" && g.label !== "ask_user");
    const right = fired.filter(({ c, g }) => norm(g.label) === c.expect.choice).length;
    console.log(`${name.padEnd(8)} residual ${residual.length}: t=${t} skill-fired ${fired.length} precision ${(right / Math.max(1, fired.length) * 100).toFixed(0)}% wrong=${fired.filter(({ c, g }) => norm(g.label) !== c.expect.choice).map(({ c, g }) => `${c.id}->${g.label}`).join(",")}`);
  }
  const scores = guesses.map((g) => g.score).sort((a, b) => a - b);
  for (const q of [0, 0.25, 0.5, 0.75]) {
    const t = scores[Math.floor(q * (scores.length - 1))]!;
    let fired = 0, right = 0;
    cases.forEach((c, i) => { const g = guesses[i]!; if (g.score < t) return; fired++; if (norm(g.label) === c.expect.choice) right++; });
    console.log(`${name.padEnd(8)} t=${t.toFixed(3)} fired ${fired}/${cases.length} precision ${(right / Math.max(1, fired) * 100).toFixed(0)}%`);
  }
}
