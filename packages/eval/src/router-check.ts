// Offline check of the learned router as a classifier (no LLM): precision and coverage by threshold.
import { guessIntent } from "../../model/src/router.ts";
import { VA_CASES } from "./va-cases.ts";
import { HOLDOUT_CASES } from "./holdout-cases.ts";

const norm = (l: string) => (l === "reply_message" ? "read_messages" : l);
for (const [name, cases] of [["va", VA_CASES], ["holdout", HOLDOUT_CASES]] as const) {
  for (const t of [0, 0.25, 0.3, 0.35, 0.4, 0.45]) {
    let fired = 0, right = 0, skillFired = 0, skillRight = 0;
    for (const c of cases) {
      const g = guessIntent(c.input);
      if (g.score < t) continue;
      fired++;
      const ok = norm(g.label) === c.expect.choice;
      if (ok) right++;
      if (g.label !== "respond" && g.label !== "ask_user") { skillFired++; if (ok) skillRight++; }
    }
    console.log(`${name.padEnd(8)} t=${t.toFixed(2)} fired ${fired}/${cases.length} precision ${(right / Math.max(1, fired) * 100).toFixed(0)}% | skill-fired ${skillFired} precision ${(skillRight / Math.max(1, skillFired) * 100).toFixed(0)}%`);
  }
}
