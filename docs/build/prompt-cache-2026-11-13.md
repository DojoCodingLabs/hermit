# Prompt cache: stable prefix results (2026-11-12 to 2026-11-13)

Source: `docs/research/harness-sota-parity.md`, priority 0. Profile `botpsy-q4-native-think256-stable` (eval only) against the shipped `botpsy-q4-native-think256`, both on the same code (PR #21).

## Mac (llama-server, same GGUF)

| Set | Stable prefix | Shipped |
| :---- | :---- | :---- |
| VA (124) | 122 | 122 |
| Dev holdout (90) | 85 | 84 |
| Messaging (50) | 50 | 50 |
| Memory and decline (60) | 58 | 56 |
| Trajectories, 4 seeds (30 each) | 29, 29 (seeds 1 and 2 on the final code) | 29, 29, 29, 29 |
| Blind holdout2 (100), one run each | 91 | 93 |
| Prompt tokens read per case | 49 to 159 | 430 to 960 |

The blind gap of 2 is within run-to-run noise but does not clear the bar for a default switch.

## Phone (S26, QVAC)

- First-win 40, stable prefix: 39/40, median 15.2 s, p90 21.8 s, on a hot phone (status 2 to 3).
  - Every case read the full ~1,920-token prompt. Each case is a new conversation, and QVAC cannot rewind BotPsy's DeltaNet state to a shared prefix across conversations.
- QVAC keeps one checkpoint per committed request (`cache_checkpoints`, default 1). That should serve the next turn of the same chat and the steps within a turn. The prefill warm-up at session start should serve the first message.
- The in-chat probe (`hermit://eval?p=<id>&probe=1`) is not yet measured: the S26 disconnected.
- Fast-route calls ran to their 200-token cap on QVAC; on llama-server they stop near 70 tokens. A dev log now prints the tail when a call hits its cap.

## Decision

The shipped profile stays the default. The stable prefix becomes the default only if the phone probe shows a real in-chat gain.

## Lessons

- Run heavy work one at a time.
  - Run Mac evals one at a time through `scripts/eval/mac-run.sh`. It runs at low priority, behind the optional `HERMIT_HEAVY` command prefix (for example, a lock that runs one heavy job at a time).
- Phone runs need Hermit in the foreground and the screen unlocked.
  - Samsung freezes background apps.
  - `scripts/phone/eval-runs.sh` keeps the screen on over USB and waits for an unlock.
- Dev builds ran the eval screen's effect twice, which doubled the load and spoiled cache measurements. It now starts once.
