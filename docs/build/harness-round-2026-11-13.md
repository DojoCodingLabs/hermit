# Harness round, 13 November 2026 (PRs #24 to #29)

Every fix moves work from the model into code: deterministic, model-agnostic, and measured on the Mac eval lab (same GGUF as the phone).

| PR | Fix | Evidence |
| :---- | :---- | :---- |
| #24 | Recall across languages: when the keyword search finds nothing, the newest notes go to the model to judge | cross-language recall passes; decline 18/18 |
| #25 | A skill can end the turn with its own question; an ambiguous cancel asks which, word for word | 4/4 seeds (flaky before) |
| #26 | Honesty guard: a failed action is never reported as done | fired 0 times on honest answers |
| #27 | Several requests in one message: each action keeps its own clause | 4/4 seeds, 5 model calls instead of 8 |
| #28 | Catch-up answers ("¿qué me perdí?") come from a template, with no model call | 4/4 seeds, 2 calls |
| #29 | Absolute dates in the time parser; "the day of X" uses the date given earlier in the chat | 4/4 seeds; dev holdout 85/90 |

## Master after the round (shipped profile `botpsy-q4-native-think256`)

- Trajectories: 30 scenarios × 4 seeds = **120/120**, every scenario in every seed (before: 116/120, with 5 flaky scenarios).
- VA 122/124, dev holdout 85/90.
- Blind holdout2: 93/100, run once and never read. The fixes were not tuned on it, so it did not move; its misses are spread across memory (3), messaging (2), calendar (1) and decline (1).
