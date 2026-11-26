# First phone session: Galaxy S26 Ultra, 2026-11-24

The first time the current app ran on the S26 Ultra (SM-S948B, Android 17, 11 GB RAM). The debug APK was built on the Mac (Q154, `docs/build/local-android-build.md`) and installed over the 2026-11-12 build, which kept its data and the downloaded models (an upgrade test: the database migrated cleanly). JavaScript came from Metro over `adb reverse`.

## Blockers found and fixed (PR #114)

| Problem | Cause | Fix |
| :---- | :---- | :---- |
| The app crashed on its first frame ("undefined is not a function", `mascot-motion.ts`) | A Reanimated worklet captures its closure where the function is defined, so `pieceMatrix` reached the UI thread with `mul` and `rotateAbout` still undefined (they were declared further down the file). The browser preview runs worklets on the JS thread and couldn't catch it | Helpers moved above the worklets that call them |
| The model wrote 0.2 tokens per second; a greeting took more than 10 minutes | Android keeps the on-screen app in the "foreground" cpuset (cores 0 to 5) although 8 cores are online; 8 model threads spin-waited on 6 cores. Not memory: the same speed with the weights in RAM, and no page faults | At most 5 model threads (stopgap); the follow-up reads the allowed cores, including the background set the night shift gets |

Thread sweep with the dev eval screen (`hermit://eval?...&probe=speed&threads=N`), BotPsy-0.8B Q4_K_M, foreground cpuset:

| Threads | Tokens per second | First token |
| ----: | :---- | ----: |
| 8 | 0.2 | 9.3 s |
| 6 | 31 to 43 | 0.32 s |
| 5 | 37 to 42 | 0.30 s |
| 4 | 31 | 0.37 s |
| 2 | 21 | 0.62 s |

## W1 first-win journey (steps of `scripts/phone/w1-journey.sh`, run by hand)

| Step | Result |
| :---- | :---- |
| 1. Installed, model verified, permissions | Pass (notification access, calendar, notifications, exact alarms) |
| 2. Airplane mode | Pass |
| 3. Remember a fact | Pass, 12 s |
| 4. Two reminders, one in 2 minutes | Pass: both set at the right local times, and the 2-minute one fired offline. One reply was cut mid-sentence and another misstated the date |
| 5. "¿Qué tengo mañana?" | The action ran; the answer named today's date and showed the events' times in UTC (6 hours off) |
| 6. Read a WhatsApp message from a test contact | Pass: the contact and the text were right; the time was in UTC and the wording was off |
| 7. Reply after the approval sheet and the fingerprint | Pass: the sheet showed the user's words, the taint warning, the recipient and the exact text; the reply was sent through WhatsApp |
| 8. Activity log | Pass: "Chain verified", every step listed |

Turns took 12 to 52 s, most of it reading the prompt (about 4,400 tokens at 140 to 190 tok/s; 8 to 20 s per model call). Every action was right. The words were the failures:

- Tool output gave the model UTC ISO times (`packages/agent/src/first-win-skills.ts`), and the model copied them. The phone's zone and the model's clock line were verified correct on the phone (`probe=time`).
- Confirmations after local writes were written by the model: one named the wrong date, one stopped mid-sentence.
- "¿Qué puedes hacer?" listed capabilities Hermit doesn't have.
- The chat didn't scroll to the newest reply.

Fixes: `fix/w1-replies` (local times, code-written confirmations, an honest capability answer) and Q155's chat-follow commit. W1 is re-run on the phone once they merge.

## SL-14: the model on the phone (the first-win set, 40 cases, 5 threads)

| Profile | Correct | es | en | First action median | p90 |
| :---- | ----: | ----: | ----: | ----: | ----: |
| `botpsy-q4-native-think256` (shipped) | 39/40 | 19/20 | 20/20 | 13.5 s | 24.6 s |
| `botpsy-q4-native-think256-stable` | 38/40 | 19/20 | 19/20 | 24.4 s | 27.0 s |
| `botpsy-q4-native-think256-fast-stable` | 39/40 | 19/20 | 20/20 | 18.9 s | 27.8 s |

The only miss in the shipped profile: `es-remind-4`, "a las 7:30" set at 19:30 instead of 07:30. The earlier on-phone run (2026-11-14, before the harness fixes) scored 21/40. The shipped profile stays: it is the most accurate and the fastest on the phone, the prefix-cache variants are slower there, and its median meets the 15 s bar while the p90 doesn't. Removing the second model call after local writes (code-written confirmations) is the next latency gain.

## Still to run on the phone

Every check in `docs/build/phone-runbook.md` beyond W1: the vault, autofill, the in-app browser, the wallet, the night shift in the background, TalkBack and 200% text, and the native modules merged since 2026-11-15.
