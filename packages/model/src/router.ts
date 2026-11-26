import { EXAMPLE_BANK } from "./example-bank.ts";

/**
 * The learned router: nearest neighbors over character n-grams of labeled examples (example-bank.ts).
 * No model, no network, microseconds on any phone. It complements the phrase hints (intent-hints.ts),
 * which can't list every way people write in two languages, and only speaks when it is confident.
 */
const N = 3;

function grams(text: string): Map<string, number> {
  const t = ` ${text.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^\p{L}\p{N}' ]+/gu, " ").replace(/\s+/g, " ").trim()} `;
  const out = new Map<string, number>();
  for (let i = 0; i + N <= t.length; i++) {
    const g = t.slice(i, i + N);
    out.set(g, (out.get(g) ?? 0) + 1);
  }
  return out;
}

/** Inverse document frequency over the bank: rare n-grams ("agend", "recall"-like stems) weigh more. */
const docs = EXAMPLE_BANK.map(([text, label]) => ({ label, g: grams(text) }));
const df = new Map<string, number>();
for (const d of docs) for (const g of d.g.keys()) df.set(g, (df.get(g) ?? 0) + 1);
const idf = (g: string) => Math.log((docs.length + 1) / ((df.get(g) ?? 0) + 1)) + 1;

function vector(g: Map<string, number>): { v: Map<string, number>; norm: number } {
  const v = new Map<string, number>();
  let sq = 0;
  for (const [k, c] of g) {
    const w = c * idf(k);
    v.set(k, w);
    sq += w * w;
  }
  return { v, norm: Math.sqrt(sq) || 1 };
}
const bank = docs.map((d) => ({ label: d.label, ...vector(d.g) }));

export interface RouterGuess {
  label: string;
  /** Mean cosine similarity of the top neighbors with this label. */
  score: number;
  /** Lead over the best other label. */
  margin: number;
}

/** Top-k neighbors vote by similarity; returns the winning label with its score and margin. */
export function guessIntent(text: string, k = 3): RouterGuess {
  const q = vector(grams(text));
  const sims = bank
    .map((b) => {
      let dot = 0;
      for (const [g, w] of q.v) dot += w * (b.v.get(g) ?? 0);
      return { label: b.label, sim: dot / (q.norm * b.norm) };
    })
    .sort((a, b) => b.sim - a.sim)
    .slice(0, k);
  const votes = new Map<string, number>();
  for (const s of sims) votes.set(s.label, (votes.get(s.label) ?? 0) + s.sim);
  const ranked = [...votes].sort((a, b) => b[1] - a[1]);
  const [label, total] = ranked[0]!;
  const count = sims.filter((s) => s.label === label).length;
  return { label, score: total / count, margin: total - (ranked[1]?.[1] ?? 0) };
}
