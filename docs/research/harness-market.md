# Market harnesses for small on-device models: Atomic Agent (deep), Liquid LFM2.5/LFM3, Apple Foundation Models

Research date: 2026-11-11. Sources:
- **Atomic Agent:** a sparse, shallow clone of `AtomicBot-ai/atomic-agent` at `1b4e641` (2026-11-10). It covered only the runtime parts listed below and was deleted afterwards.
- **Liquid AI:** docs.liquid.ai and the Hugging Face model cards.
- **Apple:** the developer documentation JSON (the HTML pages are rendered in the browser and could not be read directly) and Apple's 2025 foundation models update.

This note does not repeat `atomic-agent.md`, `agents.md`, `harness-agents.md`, `harness-inference.md` or `harness-literature.md`. It goes deeper on the parts of Atomic those notes only summarized, and adds Liquid and Apple.

Hermit baseline compared against:
- `packages/model/src/port.ts`, `prompt.ts`, `profile.ts`;
- `packages/agent/src/loop.ts`;
- the uncommitted `packages/eval/src/harness-v2.ts`.

Today's measurement: BotPsy-0.8B scores 29/40 in native Qwen XML with thinking on, and 22/40 under our JSON grammar.

## Bottom line for Hermit

Ranked by expected gain on BotPsy per unit of work, assuming native XML plus thinking (29/40) as the new base. Each item names the harness that does it.

1. **Make native XML the default profile, and write nothing in our prompt that asks for a different output shape.**
   - Atomic measured this trap, though on cloud thinking models rather than locally. With native `tools` on the request but a prompt that still said "Emit a JSON ARRAY of tool calls now", **0 of 6 completions used native tool calls**. The models went back to text JSON (GitHub issue #285).
   - Atomic now keeps two sets of persona, rules, instructions and repair text, one per transport (`src/prompt/stable-prefix.ts`: `NATIVE_TOOLS_SYSTEM_PERSONA`, `COMPACT_NATIVE_TOOLS_RULES_LINE`; `src/agent/step/step-parsing.ts`: `buildToolCallRepairPrompt` branches on `toolTransport`).
   - Hermit's `systemPrompt()` still says "You act only by choosing one action from the menu", plus a `Menu:` list and `"text" -> choice` examples, even under `native_tools`.
   - **Test:** a native-only system prompt with no menu, no `-> choice` examples and no "choose an action" wording. The template's own `# Tools` block and `<IMPORTANT>` block do that job.

2. **Bound thinking with a forced close, never by cutting it off. Lift the bound on the step that writes the answer.**
   - Atomic's reasoning prelude (`src/llm/grammar/reasoning-prelude.ts`) admits `budgetTokens × 4` characters of think body. After that, the sampler can only emit `</think>`, then at most 8 whitespace characters, then the call.
   - The shipped default went from 1,500 tokens to **0, meaning unbounded** (config v78, `src/llm/reasoning-budget.ts`). The reason: the old bound "cut thinking models off mid-thought".
   - The forced final step always uses the unbounded variant (`withUnboundedReasoningPrelude`).
   - The persona asks the model to keep thinking short instead ("Keep any thinking to a few words").
   - A local thinking model gets `n_predict` 32,768 (`src/agent/step/thinking-reply-cap.ts`), because "a long think block ate it before the reply started".
   - **Test on BotPsy**, all with a grammar-forced close (QVAC `reasoning_budget`, or our own prelude rule):
     - thinking budgets of 256, 512, 1,024 and unbounded;
     - the instruction "think in a few words" added to the system prompt;
     - token and latency counts recorded for every case.

3. **Narrow skills in the grammar, not in the prompt, and keep a typed branch per skill. Do it over Qwen XML, not JSON.**
   - Atomic's `buildGrammarForTools` (`src/llm/grammar/build-grammar.ts`, `tool-call-branches.ts`) rewrites only `tool-name`, and the dedicated per-tool branches, per request. "The grammar travels with each request and is not part of the KV-cached prefix, so a tool can vanish from the sampler's vocabulary while its descriptor stays in `### tools`."
   - `reply` is always kept as the exit.
   - Hermit's `narrowMenu` (`intent-hints.ts`) removes skills from the prompt, which changes the prefix and the tools block on every utterance.
   - **Test:** render all 8 skills in the template every time, and let the intent hint restrict only a hand-written GBNF over Qwen's own syntax (sketch in section 1.2). That combines Atomic's narrowing with the trained format, as LiteRT-LM's `AllowedTools` does (`harness-agents.md`).

4. **Recover calls the server failed to parse, and coerce argument types without doing harm.**
   - Atomic's `src/llm/provider/openai/qwen-tagged-tool-response-adapter.ts` parses `<tool_call><function=NAME><parameter=K>V</parameter>` (and the Hermes JSON form) out of `content`, and, for Qwen, also out of `reasoning_content` ("Qwen thinking models put the call there", #105). It coerces each string value against the tool's JSON schema.
   - `src/tools/coerce-tool-args.ts` unwraps over-encoded values (`"200000"` becomes `200000`) "whenever the declared schema" does not already accept the string.
   - **Test:** on any BotPsy turn where QVAC returns no `toolCalls`, run this parser over the raw text and the reasoning before declaring `respond`. Count how many of the 11 misses it rescues.

5. **Return this turn's reasoning to the model across its tool calls; drop reasoning from earlier turns.**
   - Liquid's LFM3 tool docs: "Keep the assistant's content and reasoning from the current tool-use turn in the history."
   - Atomic does the same (`src/prompt/build-prompt-world-conversation.ts`, ATO-887): "Only the current macro-turn's reasoning goes back".
   - Hermit strips `<think>` everywhere (`stripThinking`).
   - **Test:** pass `reasoning_content` on the assistant tool-call message within the turn, and let the Qwen3.5 template drop it for older turns.

6. **Run an ablation on presence penalty and temperature for the call step.**
   - Hermit uses the BotPsy card values: temperature 0.3, presence penalty 1.5.
   - The others:
     - Atomic uses 0.2 / 0.95 / 40 with `repeat_penalty` 1.1 over only the last 256 tokens (`src/llm/llama-server-client.ts`). Its DRY sampler note warns that a wide penalty window "would penalise exact copying from context (a path, an `os.fs.edit` old string)" (`src/llm/dry-sampler.ts`).
     - Liquid recommends 0.1 / top_k 50 / repetition 1.05 for LFM2.5-1.2B-Instruct, and **greedy (temperature 0)** for the dedicated LFM2-1.2B-Tool.
   - Presence 1.5 may fight the copying of `conversationId`, names and times that Hermit's arguments need.
   - **Test:** presence 0 against 1.5, and temperature 0.1 against 0.3, on the call step only, with the reply step unchanged.

7. **Put the clock and a short "respond now" anchor next to the generation point, outside the cached prefix.**
   - Atomic moved the date out of the stable prefix because "the model kept anchoring on its training-era year". It now renders `CURRENT DATE: ... this is today. Use it for any time-relative reasoning; never assume an earlier year.` in the tail.
   - It ends every prompt with `### respond` / `Respond now.`, which "empirically prevents reasoning-mode repetition loops" (`src/prompt/build-prompt.ts`).
   - **Test:** the `plainNow()` line (from `harness-v2.ts`) appended to the last user message rather than placed in the system turn. This also keeps the system prefix byte-stable for the KV cache.

8. **One specific in-step repair, with a reopened think block, then stop.**
   - Atomic replays the same prompt plus a `### tool-call-repair` block that quotes the reason and per-call errors, capped at `REPAIR_MAX_TOKENS = 1024`.
   - It then allows at most `PARSE_RECOVERY_BUDGET = 2` further steps (`src/agent/turn/parse-failure-recovery.ts`).
   - Important detail: the repair **reopens** `<think>`. Appending a closed `<think>\n</think>` "on both qwen-3.5-9b and qwen-3.6-35b-a3b" produced "markdown-fenced JSON with interleaved prose" (`step-parsing.ts`).
   - Hermit's strike text is generic. **Test:** the reason, the field and an example valid value in a `tool` response, with thinking left on.

9. **End the turn after the first successful write.**
   - Apple Foundation Models exposes `toolCallingMode` as `.allowed`, `.required` or `.disallowed`. Its own sample switches from `.required` to `.allowed` after the first call, because with `.required` and no exit "the model continues to call the tool".
   - This independently confirms `harness-agents.md` item 4: terminal write skills and resetting forced choice.

10. **Copy Atomic's eval discipline for harness comparisons.**
    - Atomic pins greedy decoding for A/B harness comparisons. Temperature 0 and a fixed seed through `ATOMIC_AGENT_LLAMA_TEMPERATURE` / `ATOMIC_AGENT_LLAMA_SEED` mean "a prompt-version comparison is not confounded by sampling noise".
    - Its small-model bench (`eval-agents/small-models/`):
      - gives every run fresh state;
      - runs 3 repeats per task;
      - gates on a per-size minimum pass rate (4B: 0.8);
      - logs parse retries, loop detections and tokens per run;
      - unit-tests every checker both ways ("untouched fixture fails, reference solution passes").
    - Our 29 versus 22 is one sampled run each. **Rerun both at temperature 0 with a fixed seed, and with 3 sampled repeats, before acting on the 7-point gap.**

What not to copy:
- **Flattened history.** On its default Qwen path, Atomic sends a raw `/completion` prompt with **no ChatML turn markers at all**. Section 1.3 has the details: `### system` ... `### conversation` with `user:`, `assistant_tool_call:` and `tool_result[tool ok]:` lines ... `Respond now.\n<think>\n`. The whole history is flattened into text. That suits 4B+ generalist models, which are all Atomic ships, but it is the opposite of what our 29 versus 22 measurement says about a tool-tuned 0.8B.
- **Its own JSON array format** (`[{"tool":..,"args":..}]`). The same reasoning applies.

## 1. Atomic Agent, deep read

Paths are relative to the repo at `1b4e641`.

### 1.1 The grammar text

**Base file `grammars/tool-call.gbnf`** (171 lines). The load-bearing rules, verbatim:

```
root ::= tool-call-array
tool-call ::= reply-call | shell-call | fs-read-call | fs-write-call | fs-edit-call | fs-move-call | fs-list-call | fs-grep-call | fs-glob-call | web-search-call | web-fetch-call | http-request-call | skill-view-call | tool-view-call | tool-search-call | notes-store-call | notes-recall-call | other-call
reply-call ::= "{" ws "\"tool\"" ws ":" ws "\"reply\"" ws "," ws "\"args\"" ws ":" ws reply-args ws "}"
other-call ::= "{" ws "\"tool\"" ws ":" ws tool-name ws "," ws "\"args\"" ws ":" ws object ws "}"
shell-call ::= "{" ws "\"tool\"" ws ":" ws "\"os.shell.run\"" ws "," ws "\"args\"" ws ":" ws shell-args ws "}"
shell-args ::= "{" ws "\"cmd\"" ws ":" ws required-string ( ws "," ws pair )* ws "}"
required-string ::= "\"" chars-nonempty "\""
reply-args ::= "{" ws "\"text\"" ws ":" ws reply-text ( ws "," ws "\"attachments\"" ws ":" ws value )? ws "}"
reply-text ::= "\"" reply-pending "\""
reply-chars ::= ( reply-hard reply-chars | reply-soft reply-pending )?
reply-pending ::= reply-hard reply-chars | reply-soft reply-pending
reply-hard ::= [^"\\\x00-\x1f :(\[{=,] | "\\" escape
reply-soft ::= [ :(\[{=,]
tool-call-array ::= "[" ws tool-call ( ws "," ws tool-call ){0,15} ws "]"
tool-name ::= browser-tool | os-tool | discovery-tool | memory-tool | tasks-tool | vision-tool | image-tool | fusion-tool | verify-tool | plan-tool | mcp-native-tool | "\"finish\""
chars-nonempty ::= char chars
ws ::= ( [ \t\n\r] ){0,64}
```

Why each rule exists, from the file's own comments:

- **Array root.** "Every completion starts with `[` so the model cannot fall into the single-object form via first-token bias."
- **Dedicated branches.** Under the generic `object`, `{"tool":"os.shell.run","args":{}}` was legal "and small local models took that way out" (Nemotron 3.5 Bolt E4B, 23.10.2026). The same fix was applied to the fs, web, skill and notes tools (ATO-909, ATO-1114). The comments admit a known hole: a free key can repeat a required one, and `JSON.parse` keeps the last value.
- **`reply-text`.** Tokenizers merge ` "` and `:"` into one token. Under the generic string rule that token closed the string, so a reply ended at `memory:` and still parsed as valid. The text may close only after a "hard" character.
- **`ws{0,64}`.** "GBNF masks EOG until the whole root is satisfied, so an unbounded `[ \t\n\r]*` gives a stuck sampler an infinite legal move ... a silent multi-minute hang."
- **MCP names** are not in `tool-name` unless real MCP tools exist, because a permissive pattern let a model invent `mcp.example.toolkit` (ATO-1029).

**Reasoning profiles** (`src/llm/grammar/build-grammar.ts`, `reasoning-prelude.ts`):

- The root becomes `root ::= think-prelude tool-call-array` (Gemma: `channel-prelude`).
- The prelude rule:

  ```
  think-prelude ::= think-body "</think>" prelude-trail-ws
  think-body ::= think-char{0,N}          (N = budget × 4; chained past 1,999)
  think-char ::= [^<] | "<" [^/] | "</" [^t] | "</t" [^h] | ...   (one alternative per sentinel prefix)
  prelude-trail-ws ::= ( [ \t\n\r] ){0,8}
  ```

  Gemma 4 emits its own opener, so its prelude starts with the literal `"<|channel>thought\n"`.
- **Bounds past the repetition cap.** llama.cpp caps a single quantifier at 1,999 repetitions (`MAX_REPETITION_THRESHOLD` 2000; "current master silently treats anything above 2,000 as unbounded"). Longer bounds are chained: `body ::= unit{0,1998} | unit{1999} body-2`.
- **Trailing whitespace bound.** The 8-character limit after `</think>` exists because Gemma 4 26B "slide[s] into a whitespace-only degenerate loop after a long think block".
- **Hardened strings.** For reasoning profiles, a four-state automaton replaces the string rules so that `<|` and `|>` can never appear inside a JSON string (F37). Without it, "a thought block that opens mid-call lands in an argument value, and the tool runs on it". There is a carve-out for ` |>` after whitespace, so code pipes still work (ATO-800).
- **Thinking off** uses `withoutReasoningPrelude`, which restores `root ::= tool-call-array`. The prompt then ends with the template's own disabled marker, `<think>\n\n</think>\n\n` (`QWEN_THINK_PROFILE.promptThinkingDisabledMarker`, F49).

**Per-request narrowing** (`narrowToolCallRules`):

- A step's allowed names become:
  - `tool-call ::= reply-call | <dedicated branches that are allowed> | other-call`;
  - plus `tool-name ::= "\"a\"" | "\"b\""` for the rest, sorted.
- `reply` is always kept: "a grammar with no exit would trap the step".
- Callers:
  - the final step (`reply`/`finish` only);
  - worker roles;
  - an orchestrator minus whatever the Fusion gate would refuse ("a refusal the model cannot generate is one it cannot spend 20 minutes writing").
- Results are LRU-cached: 64 per base grammar, 8 bases.

### 1.2 What this means for Hermit's grammar

Atomic generates its grammar over its own JSON. The idea carries over to the format BotPsy was trained on. Hermit's 8 skills and their required arguments are known, so every branch can be fully typed, which is the thing Atomic could not do for its long tail of tools. Sketch, untested:

```
root ::= think-prelude ( call | answer )
call ::= "<tool_call>\n<function=" skill-branch "</function>\n</tool_call>"
skill-branch ::= remind-fn | remember-fn | ...           # per-request: only the allowed skills
remind-fn ::= "remind>\n" p-text p-at
p-text ::= "<parameter=text>\n" nonempty "\n</parameter>\n"
p-at ::= "<parameter=at>\n" datetime "\n</parameter>\n"
datetime ::= [0-9]{4} "-" [0-1][0-9] "-" [0-3][0-9] "T" [0-2][0-9] ":" [0-5][0-9] ":" [0-5][0-9]
answer ::= [^<] ...                                       # free text; no tool call
think-prelude ::= think-body "</think>" ( [ \t\n] ){0,8}
```

- Copy `ws{0,64}`, the bounded prelude and the `<|` exclusion.
- Keep the template's tools block complete. Narrowing happens only here.
- Check first whether QVAC accepts a custom `grammar` together with a templated, `tools`-bearing prompt. `harness-inference.md` notes that `grammar` and `json_schema` are mutually exclusive in `@qvac/llm-llamacpp`. If QVAC refuses, render the template ourselves and send raw text plus the grammar, as Atomic's `/completion` path does.

### 1.3 Prompt scaffold for small windows

- **Structure** (`src/prompt/stable-prefix.ts`):
  - a byte-stable prefix: `### system` (persona), `### rules`, `### skills`, `### tools` (`# common (full)` plus `# extras` one-liners), `### capabilities`, `### instructions`;
  - then a variable tail: memory sections, `### world`, `### conversation`, notices, `CURRENT DATE: ...`, `### respond` / `Respond now.`, and the reasoning prefill.
- **Compact mode** (`src/prompt/compact-prompt.ts`):
  - **when it is on:** automatically for windows of 64K or less;
  - **tool forms:** authored short summaries (`compact-tool-forms.ts`: "Authored, not derived: a truncated summary cuts the sentence that mattered as often as the one that did not"); rare tools become one-liners behind `tool.view` / `tool.search`;
  - **skill catalog:** capped at 0.5% of the window;
  - **size:** about 3.7K instead of 9.6K tokens;
  - **latch:** the decision is held per session so the prefix never flips.
- **Tool lines** look like `- os.fs.read: <summary>\n  args: { path: string, maxBytes?: number, offset?: number /* 1-based; neg=from end */, ... }`. The arguments are TypeScript-style, not JSON Schema, and "`argsSchema` is never shortened, so the args the model sees cannot drift from the grammar and the parser."
- **Instructions in compact grammar mode**, verbatim: "Emit a JSON ARRAY of tool calls now. Always start with `[` and end with `]`, even for a single call." Then one-call and reply examples (`[{"tool":"os.fs.read","args":{"path":"a.ts"}}]`), then a solo rule.
- **Framing for Qwen.**
  - With `useServerTemplate: "auto"`, a known Qwen or Gemma model keeps the hand-built framing (`src/llm/server-template-policy.ts`).
  - For `qwen-think` that means **no `<|im_start|>` markers at all**. The prompt is plain text ending in `<think>\n` (asserted in `build-prompt.test.ts`: `prompt.tail.endsWith("<think>\n")`).
  - Unknown model families go through llama-server's `/apply-template`, as one system message plus one user message. The tail is spliced between a cached head and foot at a sentinel, so the prefix stays byte-stable (`server-template-renderer.ts`).

### 1.4 How results are rendered

- **Format.** `src/session/conversation-turn.ts` renders each history item as one line in `### conversation`: `user: ...`, `assistant_tool_call: <tool> {json}`, `tool_result[<tool> ok|error]: <body>` with an optional ` (truncated)`, and `assistant: ...`.
- **Size caps.** A result body may use 8,000 characters while its turn is open. Once the macro-turn is answered it drops to 400 characters (`TOOL_RESULT_RENDER_CAP_CHARS`, `TOOL_RESULT_HISTORY_CAP_CHARS`). Shell output is cut from the tail, because "its last lines (the `exit:` line, the verdict) are the answer". A repeated file read renders as a pointer to the earlier copy.
- **Safety.** Fake chat-template tokens in world or page text are neutralised (`control-marker-guard.ts`).
- **Side effect.** The text form invites models to *continue* it. `src/llm/reliability/fabricated-tool-transcript.ts` exists because models "keep writing that text: invented `tool_result[os.fs.write ok]` lines ... and [report] work that never happened". It aborts such streams. This is another reason for Hermit to keep the template's real `tool` role.

### 1.5 Thinking models

There are three profiles (`src/llm/model-profile.ts`):

| Profile | Thinking framing |
|---|---|
| `qwen-think` (also Nemotron) | `<think>` is prefilled; the grammar starts inside the think body |
| `gemma4-think` | `<|think|>` inside a real system turn; the model emits `<|channel>thought` itself, because a prefilled channel reads as *thinking disabled* |
| `plain-instruct` | no thinking framing |

- The thinking setting (`localModels.thinking`) defaults to `auto`, which means on for Qwen. The reasoning budget defaults to 0, meaning unbounded.
- Two more files: `stream-repetition-watcher.ts` aborts a stream whose tail repeats one block 8 or more times over at least 256 characters. It was written after "16,384 tokens of one repeated code block in 18 minutes on an 8 GB Mac".
- LFM2.5 has **no profile and no catalog entry** in the desktop agent. It would run as `plain-instruct` through the server template. LFM2.5 appears only in the separate Atomic Chat mobile catalog (`atomic-agent.md`).

### 1.6 Retries

| Mechanism | File | What it does |
|---|---|---|
| In-step repair | `src/agent/step/step-parsing.ts` | Same prompt plus `### tool-call-repair` (reason, per-call errors, "Emit a corrected JSON array only"). Capped at 1,024 tokens. Reopens think. |
| Turn-level recovery | `src/agent/turn/parse-failure-recovery.ts` | Up to 2 fresh steps with a `### notice`: "Your previous output was rejected before any tool ran ... Nothing you attempted has happened yet". A third failure "is a model that cannot emit valid JSON at all". |
| Mechanical JSON repair, name aliases | `repair-tool-call-json.ts`, `tool-name-resolution.ts` | Covered in `atomic-agent.md`. |
| Truncation, empty-completion, size-rejection and out-of-memory recovery | `src/agent/turn/*` | Each is its own module. |
| Transport retries | `llama-server-client.ts` `runWithRetry` | Retries network errors and 5xx only. Grammar 4xx errors short-circuit. |

### 1.7 Their evals, and grammar against native

**GAIA L1** (`eval-agents/`, `GAIA-L1-EXPERIMENT.md`):
- Adapters for atomic-agent, Hermes and OpenClaw; the official GAIA scorer; per-run `environment.json`.
- Small-model rows: Qwen3.5-9B Q4_K_M 28/53 (52.8%), Gemma-4-12B 24/53 (45.3%), Qwen3.6-35B-A3B 37/53.
- Single runs, across versions 0.1.36 to 0.1.47.

**Small-model release gate** (`eval-agents/small-models/`, ATO-1118):

| Aspect | Setting |
|---|---|
| Tasks | 16 offline tasks with deterministic checkers |
| Models | Qwen3.5 4B, 9B and 27B Q4_K_M |
| Windows | 32K and 64K |
| Thinking | on and off; **the gated cells are thinking off** |
| Repeats | 3 |
| Pass-rate minimums | 0.8 (4B), 0.9 (9B), 0.95 (27B) |
| llama-server flags | `-ngl 999 -c <window> --jinja --parallel 1 -fa auto --ctx-checkpoints 32`, plain f16 KV cache |

The `RUNBOOK.md` time figures are marked "estimates, not measured yet". No results are committed.

**Grammar against native: not measured locally.**
- `llm.toolTransport` can be `auto`, `grammar` or `native_tools`. The llama-server provider is hard-wired to `grammar`; OpenAI-compatible providers use `native_tools` (`src/llm/provider/llama-server/llama-server-provider.ts:49`, `openai-provider.ts:214`).
- The only number is issue #285: cloud GLM/DeepSeek, 0 of 6 native calls under a contradictory prompt. That is a prompt bug, not a format comparison.
- Searching the issues found nothing for "native tools grammar", "qwen3.5 0.8b" or "LFM".
- Our 29 versus 22 is therefore new evidence they do not have.

### 1.8 What they recommend locally

| Setting | Value | Source |
|---|---|---|
| Model catalog | Ranked by RAM. Qwen 3.5 4B is the smallest auto-recommended model (rank 8, 8 GB). Qwen 3.5 2B is only a "starter" with no rank. Gemma 4 E4B, 12B, 26B-A4B; Qwen 3.5 9B; Qwen 3.6 27B / 35B-A3B. | `src/local-llm/catalog/models-catalog.ts` |
| Sampling | Temperature 0.2, top_p 0.95, top_k 40, `repeat_penalty` 1.1, `repeat_last_n` 256. DRY off. | |
| `n_predict` | 16,384, raised to 32,768 for thinking profiles | |
| `--jinja` | Required ("without it tool calls do not work") | |
| Thinking | `auto`, with an unbounded budget | |

## 2. Liquid AI: LEAP SDK and LFM2.5 / LFM3 tool use

**Formats** (https://docs.liquid.ai/docs/key-concepts/tool-use):

- **LFM2/LFM2.5:**
  - Tools go as JSON in the system prompt (recommended: `"List of tools: <json>"`), between `<|tool_list_start|>` and `<|tool_list_end|>` on LFM2.
  - Calls are **Pythonic by default**: `<|tool_call_start|>[get_candidate_status(candidate_id="12345")]<|tool_call_end|>`. Adding "Output function calls as JSON" to the system prompt switches to JSON.
  - Results come back in the `tool` role, wrapped in `<|tool_response_start|>`/`<|tool_response_end|>` by the template. The model then answers in plain text.
- **LFM3** (new): a superset of `qwen3_coder`. That is `<tools>`, and `<tool_call><function=..><parameter=..>`, the same XML BotPsy emits, plus `<tool_response>`, `<think>` and ChatML markers.
  - "Keep the assistant's content and reasoning from the current tool-use turn in the history."
  - `defer_loading: true` keeps a tool out of the system prompt. An always-loaded `search_tools` returns `tool_reference` parts, which the template expands into `<additional_tools>` inside the tool response. The docs say this keeps the system prompt stable, so engines can reuse the cached prefix.
  - Best practices: only the relevant tools, concise descriptions, related tools grouped.
  - The examples use temperature 0.1, top_k 50, repetition penalty 1.1.

**Small models:**
- **LFM2-1.2B-Tool** (https://huggingface.co/LiquidAI/LFM2-1.2B-Tool) is deliberately **non-thinking**. The design goal was "a non-thinking model that outperforms similarly sized thinking models for tool use", aimed at mobile, in-car and embedded use. It recommends **greedy decoding (temperature 0)**, and its system prompt "must provide all the available tools".
- **LFM2.5-1.2B-Instruct** (https://huggingface.co/LiquidAI/LFM2.5-1.2B-Instruct):
  - recommends temperature 0.1, top_k 50, repetition penalty 1.05;
  - suits "agentic tasks, data extraction, and RAG";
  - scores 49.12 on BFCLv3, with "a custom Liquid handler to support our tool use template". That is the same native-format lesson.
  - A separate LFM2.5-1.2B-Thinking variant exists.

**LEAP Edge SDK** (https://docs.liquid.ai/deployment/on-device/sdk/ai-agent-usage-guide):
- `conversation.registerFunction(...)` registers a tool.
- Calls arrive as a `MessageResponse.FunctionCalls` stream variant.
- Results go back as a `TOOL`-role message; the conversation is rebuilt from history and continued with an empty user turn.
- Parsers: `LFMFunctionCallParser` for LFM, `HermesFunctionCallParser` for Qwen3. "A wrong parser can cause gibberish output."
- Tool arguments are "unsafe by design": validate and coerce them before dispatch.
- Defaults come from the per-quant bundle manifest (`sampling_parameters` in LeapBundles), "rather than the HF model card defaults". The example uses temperature 0.3, minP 0.15, repetition penalty 1.05.
- Constrained generation is separate: `@Generatable` / `@Guide` produce a JSON Schema.
- **The page says the LEAP SDK is deprecated, and recommends building on llama.cpp directly.**

**What Hermit takes from Liquid:**
- The vendor that tunes 1B tool models ships them **non-thinking, greedy, with the full tool list in the system prompt and its own call format**.
- For BotPsy, which was trained with thinking, the matching move is to keep its own format and test low temperature on the call step (Bottom line item 6).
- If Hermit ever adds an LFM profile:
  - it needs its own parser (Pythonic calls, not Qwen XML);
  - the JSON-call switch line belongs in the system prompt;
  - LFM3 would share BotPsy's XML parser.

## 3. Apple Foundation Models (on-device ~3B), tool calling guidance

Sources: https://developer.apple.com/documentation/foundationmodels/expanding-generation-with-tool-calling, `.../tool`, `.../generating-swift-data-structures-with-guided-generation`, https://machinelearning.apple.com/research/apple-foundation-models-2025-updates.

- **Typed arguments under constrained sampling, in a format the model was trained on.**
  - A `Tool` has a `name`, a `description` and `@Generable struct Arguments` with `@Guide(description:, .range(1...6))`.
  - "Tools use guided generation for the Arguments property". Guided generation uses "constrained sampling", which "prevents the model from producing malformed output".
  - "The framework injects the response format into the prompt", and the model follows it "because of post-training on a special dataset designed with the guided generation specification".
  - Tool calling "builds on guided generation", and "post-training on tool-use data improved the model's reliability".
  - This is the vendor version of "constrain the format the model was trained on", which our 29 versus 22 supports.
- **Short descriptions.** "Keep descriptions as short as possible because long descriptions take up context size and can introduce latency." Properties are generated "in the order they're declared". Hermit should keep `harness-v2.ts`'s rich descriptions to one line each, and declare `text` before `at`.
- **Tool calling modes.** `toolCallingMode` can be `.allowed` (the default), `.required` or `.disallowed`. With `.required` "you must define an exit condition ... otherwise, the model continues to call the tool". Apple's sample flips to `.allowed` after the first call (`toolCallCount < 1 ? .required : .allowed`). Use `.disallowed` when the session already has what it needs ("Summarize the recipes you found"). For Hermit:
  - `required` for the pick when the intent hint fired;
  - `disallowed` for the reply step;
  - after a write skill, either end the turn or drop back to `allowed`.
- **Errors.** A tool may throw, and the framework then rolls the transcript back to the last valid state; or it may "return a string that briefly tells the model what didn't work, like 'Cannot access the database.'" Short, plain error strings, not stack traces.
- **Parallel and serial calls.** The model "can call a tool multiple times in parallel", and "if the model needs to pass the output of one tool as the input to another, it executes back-to-back tool calls". For Hermit, `read_messages` followed by `reply_message` is the serial case and needs no special prompting.

## Gaps

- **Atomic files not read:** the stream parser and the JSON repair internals (covered earlier), `src/runtime`, and the closed desktop app. Atomic Chat mobile's harness, which runs LFM2.5 on phones, is not public, so how it calls tools is unknown.
- **The native-XML GBNF sketch is untested.** Whether QVAC accepts a custom `grammar` with a templated prompt, or with `tools`, needs a dev-build check.
- **Apple's docs give no tool-count limit or benchmark.** Liquid gives no numeric small-model tool-reliability guidance beyond the model cards.
