# Is it the model or the harness? Diagnosis and the plan for a SOTA vertical harness

Measured 2026-11-11 on the Mac with `packages/eval/src/mac-eval.ts`. The setup is the exact BotPsy-0.8B Q4_K_M file from the phone (sha256 `482db2df…`) on llama.cpp's `llama-server --jinja`, with the same harness code (`createModelPort`), the same 40 cases, a fixed clock and seed 7. The baseline reproduces the phone: 22/40 on the Mac against 21/40 on the S26. So accuracy work can run on the Mac, and the phone is only needed for speed.

Companion research: [harness-literature.md](harness-literature.md), [harness-inference.md](harness-inference.md), [harness-agents.md](harness-agents.md), [harness-market.md](harness-market.md).

## Answer: mostly the harness

Same model and cases throughout; only the harness changes. One run each (see the caveat below).

| Run | Format | Thinking | Tool descriptions | Clock line | Score | es | en | Median first action (Mac) |
| :---- | :---- | :---- | :---- | :---- | :---- | :---- | :---- | :---- |
| H0 (what ships) | our JSON grammar | off | one line | ISO with offset | 22/40 | 12 | 10 | about 0.4 s |
| H1 | our JSON grammar | 1,024 | one line | ISO with offset | 20/40 | 7 | 13 | |
| H2 | native, respond/ask_user as tools | off | one line | ISO with offset | 26/40 | 15 | 11 | |
| H3 | native, respond/ask_user as tools | off | one line | plain | 27/40 | 15 | 12 | |
| H4 | native, respond/ask_user as tools | off | rich | ISO with offset | 29/40 | 14 | 15 | |
| H5 | native, respond/ask_user as tools | 1,024 | one line | ISO with offset | 29/40 | 17 | 12 | 4.1 s |
| H6 | native, plain text answers | off | rich | plain | 25/40 | 14 | 11 | 0.4 s |
| **H7** | **native, plain text answers** | **1,024** | **rich** | **plain** | **31/40** | **17** | **14** | **2.9 s** |

Notes on the runs:
- "Native" means BotPsy's own Qwen3.5 XML tool calls, rendered by its chat template.
- "Rich" descriptions are BFCL-style: when to use the tool, trigger phrases in both languages, and argument descriptions.
- "Plain" clock means a weekday, date and 24-hour time with no ISO-with-offset string to copy.

**H7's 9 misses:**
- 4 are our own labels: a plain-text answer ending in "?" counts as ask_user, so friendly chat replies that end with a question fail. To the user, respond and ask_user both show text. Scored as one "answer in words" family, H7 is 35/40 (87.5%), above PDR-003's 85% bar.
- 2 are time arithmetic: 7:30 became 19:30, and "10 tonight" became the current hour.
- 3 are wrong tools: forget became recall, calendar_add became calendar_read, and one remind became a question.

**Caveat:** 40 cases give a 95% interval of about ±15 points. H0 against H7 (22 against 31, the same cases) is a real difference. Steps of 2 to 3 points between neighboring rows are not. Grow the set before trusting small steps (see the plan).

## What was wrong with our harness, ranked

1. **Off-distribution output format.** We forced `{"choice","args"}` JSON from the first token. BotPsy was trained to write `<tool_call><function=…><parameter=…>`. The literature shows the same pattern: hard schemas on small models keep output 100% valid while accuracy drops (harness-literature.md).
2. **Thinking off.** BotPsy was trained, rewarded and benchmarked with thinking on. Its thinking traces show it reasoning about which tool fits. A 256-token cap is worse than none: our 6/40, matching published results for truncated reasoning.
3. **Tool descriptions too thin.** In its thinking the model says "I don't have a tool for that" about recall and reply. One-line menu entries never said that recall covers any question about the user's own life.
4. **A clock it could copy.** `Now: 2026-11-11T21:00:00-06:00` was copied verbatim into `at` and even into `read_messages.from`.
5. **Fake tools for talking.** We modeled respond and ask_user as tools. BotPsy's strongest skill (86.1 on BFCL's no-tool cases) is answering in plain text when no tool fits.
6. **Phone bugs:**
   - The native profile never had tools rendered, because `tools: true` was missing at load (fixed in `qvac-engine.ts`).
   - The thinking profile wrote its JSON inside the open think block.
7. **Still open:**
   - History stores past calls as JSON text and results as `Result:` user turns, not `<tool_call>` and `<tool_response>`.
   - `narrowMenu` edits the prompt rather than the grammar.
   - The `read_messages.from` field name invites dates.

## Plan: a SOTA harness for the Virtual Assistant vertical

The goal: a small model performs like a frontier model on Hermit's job. The harness turns each open-ended request into a small, checkable decision. Code does everything the model is bad at, verifiers catch the rest, and the eval proves it family by family.

The honest bound: no harness makes a 0.8B model a general Opus-class reasoner. On a closed menu of skills with verifiers, it can reach frontier-level task success on that menu, and that is the claim to make and measure.

Layers, in build order. Each is kept only if the eval says it helps.

1. **Trained format end to end.**
   - Native tool calls (done in `pick`).
   - Tool results as `tool` turns, so the template wraps them in `<tool_response>`.
   - Past calls stored as real `tool_calls`.
   - Every call in history gets a result, a placeholder if it was denied.
2. **Thinking on the decision, off for the words.** Thinking for picking and filling, with a generous budget that forces a clean `</think>` when it runs out (never a mid-thought cut). The reply prompt stays thinking-off and short.
3. **Rich, bilingual tool descriptions** move from `harness-v2.ts` into the skill catalog, plus unambiguous argument names (`read_messages.contact`, not `from`).
4. **Code for what small models are bad at:**
   - Time: the model copies the user's time words into a field, and CT-02 code resolves them to an instant, or a verifier checks the hour against the user's text.
   - Contacts: resolved by the app, never invented.
   - Language: detected from the user's words.
5. **Verifiers and one targeted repair.**
   - Per-skill deterministic checks: the hour matches the words, the time is in the future, `fact` is in the user's language, and the contact exists.
   - On a failure, one repair turn that quotes the exact error with thinking reopened (Atomic Agent), then ask the user.
6. **Grammar inside the native format only.** A lazy grammar after `<tool_call>` that restricts tool names (narrowing by grammar, not by editing the prompt, so the prefix cache stays stable; Atomic Agent, LiteRT-LM `AllowedTools`).
7. **Retrieved examples (ToolRAG).** A bank of a few hundred bilingual full-call examples. Insert the 3 nearest to the user's words (TinyAgent).
8. **Selective self-consistency.** Only when a verifier fails or the call is a write: sample 2 to 3 candidates and take the agreeing one. The cost is paid only where it buys safety.
9. **The eval as the product's spine.**
   - 150 or more cases by family (time, memory, calendar, messaging, declining, missing info, injection) in both languages.
   - Trajectory grading over the whole loop, not just the first action.
   - pass^k over 3 seeds.
   - A scripted-model run on every PR to check the harness, and a live-model run to check the model.
   - A capability matrix against Instinct, Grok bot, Claude Duet, OpenAI dots, Atomic Agent and Muse.
10. **Distill the harness into the model (PDR-009).** A frontier model runs inside this exact harness to generate trajectories in BotPsy's format, and BotPsy is fine-tuned on them. The harness is what makes the data right.

## Overnight build (2026-11-11 to 11-12): from 22/40 to 84 of 100 unseen cases

Mac, same BotPsy-0.8B Q4_K_M file as the phone, llama-server, fixed clock (Wednesday 2026-11-11 21:00). Three sets:
- **VA (124):** written by us while building, so it flatters the harness.
- **Dev held-out (90):** written blind by a separate agent. Its 19 failures were then read for diagnosis, so it now counts as development data.
- **Blind held-out 2 (100):** written blind and never inspected or tuned on. This is the honest number.

| Harness version | VA 124 | Dev held-out 90 | Blind held-out 2 (100) |
| :---- | :---- | :---- | :---- |
| H0, JSON grammar, thinking off (what shipped) | 91 with the later prompt fixes | 55 | 73 (with code-read times already applied) |
| Native format, thinking 256, rich descriptions, menu prompt | 91 | | |
| + 7-day date table, language follows the user | 94 | | |
| + code reads times and dates (`extractWhen`, `SkillDef.normalize`) | 101 | | |
| + router with enforced calls | 116 | 71 | **84** |
| + wider router vocabulary, read-before-add ordering, ask detection, reply follow-through, answers from the pick | 119 | 82 | **88** |

Per family on blind held-out 2 (new harness): time 20/20, memory 16/20, calendar 12/16, messaging 11/14, ask 7/10, decline 10/12, chat 8/8.

**Trajectory eval** (whole conversations through the real runtime, graded on end state): 13/13 on each of 4 seeds (pass^4). It covers remember then recall in both languages, forget, reminders (absolute and relative), ask then remind, adding an event and reading the calendar, read then reply, reply in one turn, an injected WhatsApp message that is not followed, declining a purchase, and chat.

**Two integration bugs only the trajectory eval could find (both fixed):**
- The untrusted-content wrapper's `id=` attribute sat next to the real conversation id, and BotPsy copied the wrong one into `reply_message`. It is now `seal=`, and the real one is labeled `conversationId:`.
- BotPsy sent the instruction ("dile que voy tarde") instead of the message. `reply_message.normalize` now cuts the instruction.

**Latency on the Mac:** median first action 2.4 to 3.0 s with thinking 256, against 0.4 s with no thinking. Phone numbers are pending on the S26.

### What each layer contributed, and why it generalizes

| Layer | Kind | Evidence |
| :---- | :---- | :---- |
| The model's own tool format and thinking | Match the training distribution | +4 to +9 on the first-win 40 |
| Tool descriptions that say when to use the tool | Prompt | +3 |
| A 7-day date table in place of arithmetic | Lookup, not reasoning | Time family +2 |
| Code reads times and dates from the user's words | Deterministic, 99 unit tests | Time 19 to 25 of 28 (VA), 20/20 blind |
| Router with enforced calls, plus a constrained fallback for runtimes that don't enforce `required` | Deterministic routing | VA +15; blind 73 to 84 |
| Language follows the user's words; a question anywhere is ask_user | Classification fixes | Ask 3 to 8 of 10 (VA) |

### Not good enough, measured

- **Learned routers are too imprecise to force calls.** A character n-gram nearest-neighbor router and a BotPsy-embedding router reached 60 to 83% precision. EmbeddingGemma-300M reached 85 to 92% overall, but only 60 to 86% on the cases the phrase router misses (`packages/eval/src/router-check.ts`, `embed-check.ts`; Q34).
- **The thinking budget still pays with the full harness.** Dev set: 256 tokens 82/90 at 2.4 s, 128 tokens 78 at 1.9 s, off 75 at 0.7 s.
- llama.cpp does not enforce `tool_choice: "required"` for Qwen's XML tool format, with thinking on or off. Hence the constrained fallback.

### Still open

- **Speed on the phone:** S26 numbers for thinking 256, and calibration on a big.LITTLE phone.
- **Prefix cache:** in-memory only. It needs a QVAC patch (`ephemeral`), and the privacy check has to happen on the device.
- **pass^k:** seeds other than 7.
- **A fine-tune (PDR-009)** on trajectories produced by this harness.
