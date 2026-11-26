# Long answers when asked, never cut silently (Q155), measured

Q155 decided (2026-11-21): long answers when asked (recipes, lists, step-by-step), a higher cap while the phone has headroom, streamed with Stop, and a Continue when a reply still hits its cap; no reply is ever cut silently. This is what was built and what the Mac eval lab measured with the phone's GGUF (BotPsy-0.8B Q4_K_M, sha 482db2df, on `llama-server -c 8192 -np 1 -t 4 --cache-ram 0`; the shipped profile `botpsy-q4-native-think256`). The Mac reproduces the phone's choices, not its speed: Mac times are relative.

## What was built

- **The cap is detected.** The engine says why a completion ended (`EngineResult.stop`): QVAC's `stopReason` (`length` when the budget or the context ran out), llama-server's `finish_reason` on the Mac, else the generated count against `predict`. A Stop still rejects, so cut, finished and stopped are three different things.
- **Thinking no longer eats the reply.** QVAC's `predict` counts reasoning tokens. Master gave the reply prompt `predict` 120 with thinking up to 256, so a reply that thought 110 tokens had a few words left: the S26's "La alarma ha sido configurada para tomar agua en" (2026-11-21). A free-text reply now gets its thinking on top of its cap, as the Mac lab already did (`generationBudget`).
- **Never silent.** Every words path (the pick's plain answer, the out-of-scope answer, the reply prompt, a long answer, Seguir) marks a reply that ran out of tokens as cut; it ends at its last whole line or sentence when that keeps at least half of it, else at its last whole word. The turn view carries `cut`, the store keeps it (`chat_turns.outcome` cut or stopped, no migration), and the chat says "Me detuve aquí." with Seguir (48 dp, TalkBack "Seguir con la respuesta") on the latest reply.
- **Seguir** writes the next part into the same bubble, words only (no tools, no schema, nothing for the cage), from the user's tap only, in attended sessions only. Repeats of the reply's last lines, a restart from the top and a preface are dropped before they reach the screen; a second list keeps its own items. A Seguir that finds nothing new says "No encontré nada más que agregar." and Seguir goes (Q173, not yet asked).
- **Stop keeps the words** of a reply written with no tools in reach, marked "Lo detuviste aquí." with Seguir (Q170, not yet asked), to their last whole line, sentence or word, the way a cut reply ends.
- **Long answers when asked.** `longFormAsked` reads the user's own words (es-419 and en) for a recipe, steps, a list, a detailed explanation or more of the last answer, and refuses look-alikes first. Those turns are answered with words only (Q171, not yet asked) by a long prompt, at about 800 tokens while `budgetFor` says the phone is cool with headroom (300 on the floor tier, 500 low), bounded by the context the prompt leaves. They read only the latest turns, with the clock to the hour and their own cache key, so Seguir reuses what the phone already read.
- **Drawn as structure.** Headings, numbered steps and bullets from the reply's own lines, no markdown symbols, no links; readable at 200% and by TalkBack (`docs/design/polish/decisions.md`, "Long answers in the chat").

## Detection

The unit list (`packages/model/test/long-form.test.ts`): 50 requests that must count and 34 that must not (prescriptions and refills, the user's own lists and data, requests to act on a list, superlatives and short how-questions), all pass. On the 364 dev eval cases (first-win, VA, dev holdout, messaging, memdec) it fires on none.

The blind set (`packages/eval/src/long-form-blind-cases.ts`, 80 cases written by a separate agent that never read the detector or the model package; only counts are printed or kept), run once and never tuned on:

| Language | Long-form found (recall) | Look-alikes taken as long-form | Precision | Right kind |
| :---- | :---- | :---- | :---- | :---- |
| es-419 | 15 of 20 (0.75) | 2 of 20 | 0.88 | 15 of 20 |
| en | 14 of 20 (0.70) | 2 of 20 | 0.88 | 13 of 20 |

A miss costs little (a normal answer, and Seguir if it runs out). A wrong guess answers that turn with words only (Q171).

## The phone's numbers this budgets for (S26, first phone session)

- It writes at 25 to 42 tok/s with 5 threads (master caps model threads at 5 on the phone since #114), so an 800-token answer streams for about 19 to 32 s, with Stop in the composer the whole time.
- A call's first token took 8 to 20 s, all of it reading a prompt of about 4,400 tokens (the system prompt, the menu and the tool block): about 220 to 550 prompt tokens a second. A long answer sends no menu and no tool block and reads only the latest turns, so it reads a few hundred tokens before its first word (measured below); Seguir reuses that prompt from the cache.
- The harness on the first-win set scored 39 of 40 on the phone, with the first action at a median 13.5 s (2026-11-24).
- On 2026-11-21 a confirmation after a reminder stopped at "La alarma ha sido configurada para tomar agua en", with nothing saying so: the reply prompt's `predict` of 120 also had to hold its thinking. Fixed here (see "What was built"); confirmations after local writes are becoming code-written on `fix/w1-replies`.

## Speed and the answers (6 dev asks, es and en: recipe, steps, list, detail)

2026-11-21, master at `aa879a4` (before) and this branch with the first long prompt (v0, below). TTFT is the first word a person would see (after the chat's 40-character hold); "first reply" is the whole first answer.

| Config | Median TTFT | Median first reply | Cut | Notes |
| :---- | :---- | :---- | :---- | :---- |
| Master (the pick with the menu, tools and thinking 256) | 1,844 ms | 4,659 ms | 0 of 6 | 2 of 6 how-tos came back as a question instead of an answer; raw markdown in 4 of 6 |
| Long, thinking off | 382 ms | 1,425 ms | 0 of 6 | No how-to came back as a question; no tool call |
| Normal cap (a hot phone), then Seguir | 462 ms | 1,630 ms | 1 of 6 | One Seguir tap finished it (413 ms), no repeated line |
| Long, thinking 256 | 3,473 ms | 4,279 ms | 0 of 6 | One English request answered in Spanish |

Thinking stays off for long answers: about 3 s more before the first word on the Mac (about 10 s on the phone at its speed), no better answers, and one wrong language.

### The long prompt

The first long prompt described the layout (a line saying how many it serves, a heading for the ingredients, a tip at the end). The 0.8B model copied it into its answers ("This dish serves one: banana bread", "titulo de los ingredientes", "tip:") in short, lowercase lines. Three prompts were compared on the 6 asks and the winner checked on 6 more held back (thinking off, never the blind sets):

| Prompt | Tokens per answer (6 asks) | Lowercase or echoed lines | Wrong language |
| :---- | :---- | :---- | :---- |
| v0, the layout spec | 233, 99, 43, 42, 84, 99 | 37 | 0 |
| v1, "answer in full; for a recipe the ingredients with amounts, then the steps; steps or a list where they help" | 323, 154, 173, 68, 134, 457 | 0 | 0 |
| v2, "complete, with everything they need" | 213, 140, 166, 79, 155, 422 | 0 | 1 |
| v1 on the 6 held-back asks | 350, 65, 95, 439, 102, 199 | 0 | 0 |

v1 shipped. Its markdown (headings, bold, lists) is drawn by the chat. The model's facts are still its own: its arroz con leche asked for 30 liters of water, which is why long answers on medicines, health, money and safety stay general and point to a professional (Q172, not yet asked).

### Final, 2026-11-24 (the shipped prompt; master at `3ee0a5f` against this branch)

"Prompt" is what the first call read before its first word (tokens read plus reused from llama-server's cache): the part a phone pays at 220 to 550 prompt tokens a second.

| Config | Prompt | Median TTFT | Median first reply | Cut | Notes |
| :---- | ----: | :---- | :---- | :---- | :---- |
| Master (the pick with the menu, the tools and thinking 256) | 2,022 | 1,255 ms | 2,830 ms | 0 of 6 | 2 of 6 how-tos came back as a question instead of an answer; raw markdown in 4 of 6 |
| Long (shipped: v1, thinking off, 800 cap) | 341 | 198 ms | 1,598 ms | 0 of 6 | All 6 answered, 77 to 409 tokens, no repeated line, right language every time |
| Normal cap (a hot phone, 120), then Seguir | 341 | 175 ms | 959 ms (1,628 ms to the whole answer) | 5 of 6, one Seguir each | Before the line filter, 3 of the 5 joined answers said lines twice (a restart behind an unknown preface, items repeated under new numbers); with it, none did. One Seguir brought only repeats, so nothing was added and the reply was marked whole (since the review it also says so: "No encontré nada más que agregar.", Q173) |
| Long, thinking 256 | 339 | 2,151 ms | 3,252 ms | 0 of 6 | One English request answered in Spanish again |

On the phone that is about 0.6 to 1.6 s of prompt reading before a long answer's first word, against 8 to 20 s for the 4,400-token pick prompt the S26 reads today (the Mac's 2,022 is the first-win menu; the phone's menu is larger), then 19 to 32 s of streaming for a full 800 tokens.

## Accuracy before and after

The same five runs on master's snapshot and on this branch (2026-11-24, seed 7, one run each, through the heavy lock). The detector fires on none of these sets' cases, so the long path can't change them; the cut flag and the thinking budget can, and didn't.

| Set | Master `3ee0a5f` | This branch | 2026-11-21 master `aa879a4` |
| :---- | :---- | :---- | :---- |
| First-win (40) | 40 | 40 | 40 |
| VA (124) | 122 | 122 | 122 |
| Dev holdout (90) | 85 | 85 | 84 |
| Blind holdout2 (100), never read | 93 | 93 | 94 |
| Trajectories (30 scenarios, seed 7) | 30 | 30 | 30 |

The one-case moves between the two master runs (84 and 85, 94 and 93) are run-to-run noise at the same seed.

## Review fixes (2026-11-25)

An independent review of the branch found six things; each has a test.

1. **A Stop inside a word broke the join.** Both stop paths kept the raw stream, which often ends mid-word, so Seguir's next words joined as "mant equilla" (or "mant mantequilla"). A stop now ends the way a cut reply does (`endAtBoundary`): its last whole line or sentence when that keeps at least half, else its last whole word (the cap path gets the same last-word fallback, so the S26 confirmation now shows "…para tomar agua" and Seguir adds "en 30 minutos."). A word the model says again at the start of the next part is said once, whole words only, and a part that goes on with a line that stopped mid-way stays on that line.
2. **A Seguir that added nothing ended the cut silently.** It now says "No encontré nada más que agregar." and Seguir goes (Q173): never silent, never an endless tap.
3. **Real repeats were dropped.** A short line said before is now a repeat only in the list it goes on with, or while a restart may be running (before anything new, or after a heading or a long line said again); under a new heading it waits for what follows, so a second list keeps its "- sal" while a restart behind a title of its own (a list's opening lines in order, or lines under a heading said again) still goes, title and all. A heading-like first line is a preface only when all its words just say more follows: "Ingredientes para el resto de la masa:" is a heading.
4. **A double tap on Seguir started two continuations.** Send and Seguir take one slot before anything else (`apps/mobile/src/one-turn.ts`), so the second tap finds it held and Stop reaches the only turn.
5. **A long turn could lose the user's request.** The long prompt read the last 7 messages from the first user message in them; after a turn with several tool calls there was none. The user's latest words now always lead, then the exchange after them.
6. **The taint on kept words (a check).** Model words after a read of others' messages are stored without the untrusted flag on the finished path too: only code-built answers that quote others carry it, and those never stream through the words path, so a stop can't keep them. The session's taint says so on both paths (tested side by side); nothing changed.

The measurements above were taken before these fixes. The filter's cases from the lab (the restart behind "Aquí está el contenido que se espera:", items repeated under new numbers, a loop) are unit tests that still pass unchanged. Seguir measured again with the refined filter (2026-11-25, the normal cap, the same six asks on the same server settings): 5 joined answers, no repeated line; the es-list tap again brought only lines the reply already had, and now says so ("No encontré nada más que agregar.").

## Phone checks (S26, not done here)

In the runbook's line format (`docs/build/phone-runbook.md`), to fold into its chat section. Read the times from logcat's `[hermit:S1] text completion: predict …, think …, stop …, first token … ms` line, which now names the budget each call ran with.

- [ ] Say "Dame una receta de arroz con leche" with the phone cool. **Pass:** the log shows `predict 800, think 0` and `stop end` (or `length`); the first words show after only the long prompt is read (a few hundred tokens: about 1 to 3 s at the S26's prompt speed, against 8 to 20 s for the 4,400-token pick prompt); the recipe streams at 25 to 42 tok/s with Stop in the composer, and the bubble draws headings, numbered steps and bullets with no `#`, `**` or `-` showing. **See:** HM-CHAT-01, logcat.
- [ ] The same with battery saver on, or the phone warm (thermal serious). **Pass:** `predict 80`; the reply ends at a whole line with "Me detuve aquí." and Seguir; each Seguir tap streams the next part into the same bubble, no line said twice, until the line goes. **See:** HM-CHAT-01.
- [ ] Seguir's second call reuses the cache. **Pass:** the Seguir completion's stats show `cacheTokens` above 0 and its first token sooner than the first answer's. **See:** logcat.
- [ ] Stop a long answer halfway. **Pass:** the words already shown stay (to their last whole line, or whole word), with "Lo detuviste aquí." and Seguir; no half word is left at the end, and Seguir's next words join with one space; Activity shows nothing new. Stop during Seguir keeps the part shown the same way. **See:** HM-CHAT-01, HM-ACT-01.
- [ ] Tap Seguir twice fast. **Pass:** one continuation streams (the log shows one completion), and Stop stops it. **See:** HM-CHAT-01, logcat.
- [ ] The S26's cut confirmation (2026-11-21): "Recuérdame tomar agua en 30 minutos". **Pass:** the confirmation is a whole sentence (the reply prompt's log line shows `predict 376, think 256`), or, if a reply ever runs out, it says "Me detuve aquí." with Seguir. **See:** HM-CHAT-01, logcat.
- [ ] Look-alikes stay with their skills: "Renueva mi receta en la farmacia", "¿Qué hay en mi lista de compras?", "Agrega leche a la lista". **Pass:** none answers with a long words-only reply; each goes the way it went before Q155. **See:** HM-CHAT-01.
- [ ] Close and reopen Hermit after a cut reply. **Pass:** the reply comes back with its line and Seguir, and Seguir still works. **See:** HM-CHAT-01.
- [ ] TalkBack on, ask for a long recipe. **Pass:** at the end TalkBack reads the opening, then "La respuesta completa está en el chat."; swiping goes heading by heading and step by step, each step read with its number; a cut reply adds "Me detuve aquí. Toca Seguir para el resto."; Seguir is read as "Seguir con la respuesta, botón". **See:** HM-CHAT-01.
- [ ] Text at 200% (Display size and text at the maximum). **Pass:** a long answer wraps with each step's text under its own words (hanging indent), the bubble takes most of the row, and Seguir stays a 48 dp target. **See:** HM-CHAT-01.
- [ ] Scroll up while a long answer streams. **Pass:** the list stays where you are; send a new message and it follows the end again. **See:** HM-CHAT-01.
- [ ] Dark mode (Deep sea). **Pass:** the cut line, Seguir and the drawn structure read clearly on the dark bubble. **See:** HM-CHAT-01.
