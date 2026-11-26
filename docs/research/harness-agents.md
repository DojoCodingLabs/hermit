# Hermit: how open-source agent harnesses make small models call tools reliably

Research date: 2026-11-11. I shallow-cloned each repo (sparse where large) and read the code, not just the READMEs. Commits read: smolagents `96f33fa`, Hermes-Function-Calling `ea3c472`, hermes-agent (main, 2026-11-11), gorilla `6ea5797`, google-ai-edge/gallery `02939cd`, LiteRT-LM `39ccca6`, TinyAgent `cc45c0e`, openai-agents-python `64fbde5`, HF deepseek-ai/DeepSeek-V3.1 `c0781d0` and DeepSeek-V3.2 `a7e62ac` (LFS weights skipped). The clones were deleted afterwards.

Hermit baseline I compared against: `packages/model/src/port.ts`, `prompt.ts`, `intent-hints.ts`, `packages/agent/src/loop.ts`, `packages/skills/src/catalog.ts`. Per step: one grammar-constrained JSON call `{"choice": ..., "args": {...}}` over the menu (or native tools in the `native_tools` profile), a regex intent hint that removes menu items *from the prompt*, a separate reply prompt for words, the cage, max 4 skill calls and 3 strikes per turn.

## Bottom line for Hermit

Ranked by expected gain on BotPsy-0.8B per unit of work. Each is testable with the Q29 on-phone eval (40 es/en cases).

1. **Call in the model's own trained format, and keep history in that same format.** BotPsy is a Qwen3.5 fine-tune trained on Qwen's `<tool_call>{"name":..., "arguments":...}</tool_call>` with results inside `<tool_response>` in a user turn. Hermit's default two_stage asks for a foreign envelope `{"choice", "args"}`, writes past calls into history as a *third* shape `{"skill", "args"}` (`loop.ts`, the `messages.push({ role: "assistant", content: JSON.stringify({ skill: def.id, args }) })` line), and writes results as `Result: ...`. So the model sees three formats, none of them the trained one. Fix: grammar-constrain the native syntax (the `native_tools` profile already exists) and render past calls and results through the template exactly as trained. Who does it: LiteRT-LM builds its Lark grammar over each model's *own* call syntax (`llg_fc_tool_calls.cc`), BFCL's `qwen_fc.py` replays the Qwen template byte for byte including `<tool_response>`, DeepSeek ships the encoder that defines the trained format (`encoding/encoding_dsv32.py`), Hermes-Function-Calling validates against the format Hermes models were trained on. Cheapest first test: in two_stage, at least make the history call shape match the grammar (`choice`) and wrap results in `<tool_response>`.
2. **Narrow with the grammar, not by deleting skills from the prompt.** Today `narrowMenu` changes `systemPrompt(ctx, offered)`, so the menu, the examples and the KV-cache prefix all change per utterance, and the model never sees the full catalog consistently. LiteRT-LM's `ToolChoice::AllowedTools{names, required}` keeps every declaration in the stable preface and only restricts the *grammar* to the allowed names (`tool_choice.h`, `allowed_function_names` in `llg_fc_tool_calls.cc`). hermes-agent treats the byte-stable prefix as an invariant ("Per-conversation prompt caching is sacred", root `AGENTS.md`). Same safety (grammar still cannot emit a removed skill), better cache reuse on the S26, and the model's context is identical across turns.
3. **Show argument schemas, and give few-shots as full calls with resolved arguments.** In two_stage the model sees only `id: menuLine` and must fill `at`, `start`, `conversationId` without ever seeing their descriptions. Every harness studied puts the full parameter schema with descriptions in front of the model (smolagents `to_tool_calling_prompt`, Hermes `<tools>` block plus a pydantic call schema, BFCL `available_tools` JSON, Gallery `@ToolParam(description=...)`, DeepSeek `<functions>` JSONSchema). Hermes' few-shots (`prompt_assets/few_shot.json`) and TinyAgent's examples are complete calls with argument values, not `text -> name` pairs. For Hermit that means examples like `"recuérdame llamar a mamá a las 9 de la noche" -> remind {"text":"llamar a mamá","at":"2026-11-11T21:00:00"}` with `Now` fixed in the example, which teaches relative-time resolution, Hermit's main argument failure.
4. **End the turn after a terminal write skill; reset the narrowing after a call.** After `remind`, `remember`, `forget` or `calendar_add` succeeds, Hermit loops back to `pick`, which costs a model call and invited the repeat that `doneThisTurn` now patches. openai-agents-python has `tool_use_behavior="stop_on_first_tool"` / `StopAtTools` (`src/agents/agent.py`) and `reset_tool_choice=True` "so the agent doesn't enter an infinite loop of tool usage" (`run_internal/tool_execution.py`, `maybe_reset_tool_choice`). Gallery Mobile Actions is single-shot per request. For Hermit: mark write skills terminal (go straight to `respond`, or a templated confirmation), and drop the intent hint once its skill has run (today the hint "holds until the user speaks again").
5. **Give `pick` a short, current-turn context.** Gallery's Mobile Actions resets the conversation after every request (`MobileActionsViewModel.kt`, `resetConversation` in `onCompletion`) and the system prompt is one line plus the date. BotPsy "wandered from remind to forget after a failure", which is a context problem. Test: `pick` sees system prompt + profile facts + only the current user message and this turn's calls/results; `respond` keeps the longer history.
6. **Replace or back up the regex hint with a tiny learned router plus retrieved examples.** TinyAgent's ToolRAG (`src/tiny_agent/tool_rag/classifier_tool_rag.py`) runs a small multi-label classifier (`squeeze-ai-lab/TinyAgent-ToolRAG`, sigmoid, threshold 0.5) to pick the tool subset, then retrieves the top 6 in-context examples by embedding similarity *among examples that use those tools*, and adds tool-specific rules only for tools present (`prompts.py`, `TOOL_SPECIFIC_PROMPTS`). The README reports TinyAgent-1.1B going to 80.06% success with ToolRAG and fine-tuning. Hermit version: keep the regex as tier one, add an embedding nearest-neighbour over a few hundred labelled es/en utterances as tier two, and feed the retrieved examples (item 3) into the prompt.
7. **Sharper error feedback.** smolagents appends "Now let's retry: take care not to repeat previous errors! If you have retried several times, try a completely different approach." (`memory.py`). Hermes returns the validation trace inside `<tool_response>` with "Please call this function again with correct arguments" (`functioncall.py`). hermes-agent answers an unknown name with the full list of valid names, a terse message for an empty name, auto-repairs near-miss names, and stops after 3 strikes only when the batch had no valid call (`agent/turn_tool_validation.py`, `conversation_loop.py` `_invalid_tool_name_error_content`). Hermit's strike text is generic ("Pick from the menu and fill every required field"); include the field, the bad value and an example of a valid value.
8. **Add BFCL-style eval categories.** BFCL scores *irrelevance* (no call is correct) and *relevance* separately (`eval_checker/eval_runner.py`), has missing-parameter and missing-function multi-turn categories, normalises strings before comparing (`ast_checker.py` `standardize_string`), and treats "no decodable call" as the end of the step. Hermit's 40 cases should gain explicit "should respond, not act" and "should ask_user because a field is missing" cases, scored separately from tool choice and argument accuracy.
9. **Thinking only where it pays, with a hard close.** DeepSeek-V3.1 allows tool calls only in non-thinking mode; V3.2 adds "thinking with tools": reasoning is kept across tool calls inside the current user turn, dropped from earlier turns, and the model is told to open a thinking block *after* function results (`encoding_dsv32.py`, `TOOLS_SYSTEM_TEMPLATE`, `drop_thinking_messages`). LiteRT-LM enforces a thinking budget by masking all tokens except the end-of-thinking delimiter once the budget is spent (`thinking_budget_constraint.h`). smolagents' structured mode puts a `thought` string before the action in the JSON schema (`CODEAGENT_RESPONSE_FORMAT`). For a 0.8B model: test no-think `pick` against think-only-after-results, with a forced close at the budget.
10. **Language rule and user text last.** DeepSeek's search-agent prompt has a "Core Instruction: Language Consistency" block and places the user's request after all instructions in the same turn ("# The user's message is: ..."; `assets/search_tool_trajectory.html`, `developer` role in `encoding_dsv32.py`). Cheap to try against the "answered Spanish in English" bug.

Also check: `remind.at` uses `format: "date-time"` while the prompt says "ISO-8601 without an offset". In llama.cpp's JSON-schema-to-grammar converter the `date-time` format requires a `Z` or offset, as far as I know. If QVAC uses that converter, the grammar and the prompt disagree. I did not verify this against QVAC's code.

## 1. DeepSeek (chat templates and "thinking with tools")

There is no standalone open-source DeepSeek agent harness. Their internal search and code-agent frameworks behind the V3.1 benchmarks are not public (README: "evaluated with our internal search framework", "our internal code agent framework"). The closest public equivalent is the **official tool-call encoding plus the published agent trajectories** that define how their models must be driven. Those are code:

- https://huggingface.co/deepseek-ai/DeepSeek-V3.1 : `assets/chat_template.jinja`, `assets/search_tool_trajectory.html`, `assets/code_agent_trajectory.html`, `README.md` (ToolCall, Code-Agent, Search-Agent sections).
- https://huggingface.co/deepseek-ai/DeepSeek-V3.2 : `encoding/encoding_dsv32.py` (the reference encoder and parser, with tests and golden outputs in `encoding/test_*`).

Architecture:
- Loop: plain multi-turn chat; the app executes calls and appends `tool` messages; the model either calls again or answers.
- Tool presentation: V3.1 puts a `## Tools` block (name, description, JSON schema per tool) after the system prompt, plus "IMPORTANT: ALWAYS adhere to this exact format" and rules ("`tool_call_name` must be an exact match", "`tool_call_arguments` must be valid JSON that strictly follows the tool's Parameters Schema"). V3.2 lists tools as JSONSchema inside `<functions>`.
- Output format: V3.1 uses special tokens `<｜tool▁calls▁begin｜><｜tool▁call▁begin｜>name<｜tool▁sep｜>{json}<｜tool▁call▁end｜>`. V3.2 switches to an XML "DSML" format: `<｜DSML｜invoke name="..."><｜DSML｜parameter name="k" string="true|false">value</...>`. Strings are written raw with no JSON escaping, and a `string` flag carries the type. That removes the escaping errors that JSON-in-JSON causes.
- Constraint: none in the harness; the parser (`parse_tool_calls`) asserts on format errors.
- Results: V3.2 groups all results of one call batch as `<function_results><result>...</result></function_results>`, in order.
- Thinking: V3.1 supports tool calls only in non-thinking mode (the prefix ends with `</think>`), except the dedicated search-agent format. V3.2 interleaves: thinking is kept across tool calls within the current user turn, dropped for earlier turns (`drop_thinking_messages`), and the template appends `<think>` after results so the model reflects on them before acting again.
- Search agent prompt: date line, a language-consistency rule, citation rule, "You must first engage in step-by-step, rigorous thinking", then tools, then "# The user's message is: ...". Parallel calls allowed ("1 to 5 search queries in parallel").

What it does that Hermit does not: one canonical, model-trained call format used identically for output and history; results grouped and ordered in a fixed wrapper; reasoning scoped to the current turn and placed after results; user message placed after the instructions; an explicit language-consistency rule.

## 2. Hugging Face smolagents

https://github.com/huggingface/smolagents : `src/smolagents/agents.py`, `memory.py`, `models.py`, `tools.py`, `prompts/toolcalling_agent.yaml`, `prompts/code_agent.yaml`, `prompts/structured_code_agent.yaml`.

Architecture:
- Loop (`MultiStepAgent._run_stream`): ReAct, `max_steps=20` default. Each step rebuilds messages from memory, calls the model, parses, executes, appends an observation. On `max_steps` it makes one extra call with a "you got stuck, answer anyway" prompt (`provide_final_answer`, `final_answer.pre_messages`).
- ToolCallingAgent: native tool calling with `tool_choice="required"` by default (`models.py` line ~510). Ending is itself a tool, `final_answer`, so every step is a call. If the backend returns text, it parses the first `{...}` blob (`parse_json_blob`). Stop sequences `Observation:` and `Calling tools:`. Parallel calls run in a thread pool.
- CodeAgent: Thought, then a Python code block, then Observation. Tools are Python functions, so one step can chain several calls with variables. Optional `use_structured_outputs_internally` constrains the output to `{"thought": str, "code": str}` (`CODEAGENT_RESPONSE_FORMAT`), which puts reasoning before the action inside the schema.
- Tool presentation: system prompt with 3 worked multi-step examples on "notional tools", then the real tool list (`name: description, Takes inputs: {...}, Returns ...`), then 4 rules, including "Never re-do a tool call that you previously did with the exact same parameters."
- Planning: optional `planning_interval`. Step 1 writes a facts survey (given, to look up, to derive) and a plan ending in `<end_plan>`; later planning steps update facts and plan with the remaining step count.
- Validation and errors: `validate_tool_arguments` checks schema, types and required fields before execution. Model-caused errors (`AgentParsingError`, `AgentToolCallError`, `AgentExecutionError`) are stored on the step and shown to the model as a tool message: "Error: ... Now let's retry: take care not to repeat previous errors! If you have retried several times, try a completely different approach." Unknown tool errors list the valid names. `final_answer_checks` can reject a final answer and force another step.

What it does that Hermit does not: termination as a tool (one decision type, no separate respond path); error text that tells the model not to repeat and to change approach; optional thought field inside the constrained schema; explicit plan and fact survey; final-answer validators.

## 3. NousResearch Hermes-Function-Calling and hermes-agent

https://github.com/NousResearch/Hermes-Function-Calling : `prompt_assets/sys_prompt.yml`, `prompt_assets/few_shot.json`, `prompter.py`, `functioncall.py`, `validator.py`, `jsonmode.py`, `schema.py`.

Architecture (Hermes-Function-Calling):
- Loop: recursive, `max_depth=5`. First user message gets the suffix "This is the first turn and you don't have <tool_results> to analyze yet".
- Prompt (`sys_prompt.yml`, sections Role, Objective, Tools, Examples, Schema, Instructions): "You can call only one function at a time", tools as OpenAI JSON inside `<tools></tools>`, the pydantic JSON schema of a call (`{"name", "arguments"}`), optional few-shot examples, and "Don't make assumptions about what values to plug into function arguments".
- Output: `<tool_call>{"name": ..., "arguments": {...}}</tool_call>` (the format Hermes and Qwen models are trained on). No grammar in the core loop; the `examples/` notebooks show Outlines and llama-cpp grammar variants.
- Validation (`validator.py`): parse with `json.loads`, then `ast.literal_eval`, then markdown extraction; check the function exists, enum values, Python types, and required arguments.
- Errors: returned inside `<tool_response>` with the traceback and "Please call this function again with correct arguments within XML tags <tool_call></tool_call>". Parse errors get "Please call the function again with correct syntax".
- Results: `<tool_response>{"name": ..., "content": ...}</tool_response>` in a `tool` turn, prefixed with "Agent iteration N to assist with user query: ...", which restates the goal every step.

https://github.com/NousResearch/hermes-agent : a large general personal agent (CLI, gateway, 25+ platforms), not a small-model harness, but several mechanisms transfer:
- `agent/turn_tool_validation.py`: repairs hallucinated tool names (`_repair_tool_call`), errors only the invalid calls in a mixed batch and runs the valid ones, 3-strike exit counted only when a batch had no valid call, refuses arguments truncated by `length`.
- `agent/conversation_loop.py` `_invalid_tool_name_error_content`: an unknown name gets "Tool 'x' does not exist. Available tools: ..."; an empty name (the model echoing call syntax it saw in data) gets a terse error that does not dump the catalog.
- `agent/tool_guardrails.py`: per-turn loop detection (same call with same args and same result, repeated failures of one tool, idempotent calls with no progress), warn then block.
- `agent/repetition_guard.py`: aborts outputs dominated by long verbatim repeats.
- `tools/tool_search_catalog.py`: BM25 search over deferred tools, so rarely used tools stay out of the prompt and the listing stays byte-stable.
- Root `AGENTS.md`: never change the system prompt or tool list mid-conversation, because it breaks the cached prefix.

What they do that Hermit does not: full call examples with arguments; type, enum and required-field errors returned in the trained result wrapper; the user goal restated in every result message; name repair against the catalog with a list of valid names in the error; loop detection keyed on (call, result); a byte-stable prefix as a rule.

## 4. Berkeley gorilla BFCL handlers

https://github.com/ShishirPatil/gorilla , folder `berkeley-function-call-leaderboard/bfcl_eval/`: `constants/default_prompts.py`, `model_handler/base_handler.py`, `model_handler/local_inference/qwen.py`, `qwen_fc.py`, `functiongemma.py`, `base_oss_handler.py`, `eval_checker/ast_eval/ast_checker.py`, `eval_checker/eval_runner.py`.

Architecture:
- Two modes per model. **FC mode** (`qwen_fc.py`): tools go through the model's native template: system turn gets "# Tools ... <tools>{json per line}</tools> For each function call, return a json object with function name and arguments within <tool_call></tool_call> XML tags". Past calls are re-rendered as `<tool_call>`, results as a user turn with `<tool_response>`, and `<think>` is kept only after the last real user query. Parsing extracts `<tool_call>` JSON. **Prompt mode** (`qwen.py` plus `default_prompts.py`): tools are pasted as JSON into a generic system prompt ("You are an expert in composing functions... If none of the functions can be used, point it out. If the given question lacks the parameters required by the function, also point it out."), and the model must answer `[func(a=1, b=2)]` Python syntax (or JSON/XML variants), with "You SHOULD NOT include any other text".
- FunctionGemma handler (`functiongemma.py`): Gemma control tokens (`<start_function_declaration>`, `<start_function_call>`, `<escape>` around every string), a `developer` turn, and the one-line system prompt "You are a model that can do function calling with the following functions".
- Multi-turn loop (`base_handler.py`): up to `MAXIMUM_STEP_LIMIT = 20` steps per turn; an empty or undecodable response ends the step ("Proceed to next turn"), i.e. "no call" is the implicit answer. Over the limit the whole entry fails.
- Scoring: AST match against lists of acceptable values per parameter, with string normalisation (spaces and `,./-_*^` removed, lowercase); type checks; separate relevance and irrelevance categories (irrelevance passes only when no call is produced); multi-turn executes calls against simulated backends and compares state.

What it does that Hermit does not: the model's native template replayed exactly (FC mode) instead of a custom format; explicit instruction to say so when no function fits or a parameter is missing; scoring that separates "should not act" and "should ask" from tool choice and argument accuracy; tolerant string comparison.

## 5. Google on-device: Gallery (Mobile Actions, FunctionGemma) and LiteRT-LM

https://github.com/google-ai-edge/gallery : `Function_Calling_Guide.md`, `Android/src/app/src/main/java/com/google/ai/edge/gallery/customtasks/mobileactions/{MobileActionsTools.kt, MobileActionsTask.kt, MobileActionsViewModel.kt, Actions.kt}`, `customtasks/agentchat/AgentChatTaskModule.kt`, `tools/LoadSkillTool.kt`.

https://github.com/google-ai-edge/LiteRT-LM : `docs/api/cpp/tool-use.md`, `docs/api/cpp/constrained-decoding.md`, `runtime/components/constrained_decoding/{llg_fc_tool_calls.cc, llg_tool_call_utils.cc, tool_choice.h, thinking_budget_constraint.h}`, `runtime/conversation/model_data_processor/function_gemma_data_processor.cc`, `js/packages/core/src/orchestration/auto_tool_chat.ts`.

Architecture (Mobile Actions with FunctionGemma 270M):
- The model is fine-tuned for exactly this tool set; the guide's first step for custom logic is "fine-tune your own version of the model".
- Tools are Kotlin methods with `@Tool(description=...)` and `@ToolParam(description=...)`; LiteRT-LM turns them into declarations in the preface.
- System prompt is two lines: "You are a model that can do function calling with the following functions" and the current date, time and weekday.
- Single-shot: each request is one user message; the tool returns `{"result": "success", ...echoed args}`; the conversation is **reset after every request** (`resetConversation` in `onCompletion`).
- Agent Chat (Gemma, more tools): a rigid numbered routing procedure in the system prompt ("EVALUATE AND ROUTE ... FLOW A: SKILL EXECUTION ... FLOW B: MCP TOOL"), skills listed by name and description only, with full instructions loaded on demand by a `load_skill` tool, and "You MUST execute all steps silently".

Architecture (LiteRT-LM runtime):
- Loop: outer user loop, inner model/tool loop until a message has no `tool_calls`; the JS `AutoToolChat` caps recurring tool calls (default 25).
- Constraint: `SetEnableConstrainedDecoding(true)` makes the runtime build a Lark grammar (via llguidance) from the tool declarations in the model's *native* call syntax (for FunctionGemma: `call:name{key:<escape>value<escape>}` inside call fences). Enums become alternations, properties are ordered, nested objects get their own rules.
- Tool choice modes (`tool_choice.h`): `Auto`, `None` (text only), `Required` (call first, no preamble), `ForcedFunction{name}`, and `AllowedTools{names, required}`, which keeps all tools declared but limits the grammar to a subset.
- Thinking budget (`thinking_budget_constraint.h`): once the budget is spent, only the end-of-thinking tokens are allowed.
- Streaming: text streams; when a call starts, the runtime buffers until the call is complete and then emits parsed JSON.

What they do that Hermit does not: grammar over the model's own format; subset restriction at grammar level with a stable prompt (`AllowedTools`); hard thinking cut-off; per-request reset for action tasks; argument descriptions on every parameter; tool results that echo the arguments back, so the reply step can only restate what was done; progressive disclosure of instructions (`load_skill`).

## 6. Other small-model harnesses

**Berkeley TinyAgent** (https://github.com/SqueezeAILab/TinyAgent): `src/tiny_agent/tool_rag/{classifier_tool_rag.py, base_tool_rag.py}`, `src/tiny_agent/prompts.py`, `src/tiny_agent/tiny_agent.py`, `src/llm_compiler/planner.py`.
- Loop: LLMCompiler. The model writes the whole plan as numbered calls with `$1` references to earlier results, ending in `join()`; independent calls run in parallel; a joiner decides to finish or replan with the error shown ("You MUST correct this error and try again!").
- ToolRAG: multi-label classifier (sigmoid, threshold 0.5) over 16 tools picks the subset; then the top 6 examples by embedding similarity among examples that use those tools are injected; tool-specific rules are added only for tools in the subset ("Before sending an SMS, you MUST use get_phone_number...").
- Fine-tuned TinyAgent-1.1B and 7B on 40k synthetic cases; README reports 80.06% and 84.95% success with ToolRAG.
- vs Hermit: learned router instead of regex; retrieved, call-complete examples instead of a fixed list; rules gated by the tools present.

**OpenAI Agents SDK** (https://github.com/openai/openai-agents-python): `src/agents/agent.py`, `src/agents/run_internal/tool_execution.py`.
- `tool_use_behavior`: `run_llm_again` (default), `stop_on_first_tool`, `StopAtTools(stop_at_tool_names)`, or a function deciding whether tool results are final.
- `reset_tool_choice=True`: after any tool use the forced `tool_choice` is cleared "to ensure the agent doesn't enter an infinite loop of tool usage".
- `max_turns` with a `MaxTurnsExceeded` error handler; tool exceptions become model-visible error strings through a failure function.
- vs Hermit: terminal tools that end the turn without another model call; forcing removed after the first call.

**Not studied:** Liquid AI LEAP / LFM2 tool use. LiteRT-LM ships LFM2 tool templates under `models/lfm2/testdata/` if needed later.

## Comparison at a glance

| Harness | Tools shown | Output format | Grammar | Errors back to model | Ends turn by |
|---|---|---|---|---|---|
| Hermit | id + one-line menu, `text -> name` examples | custom `{"choice","args"}` (or native) | JSON schema anyOf | generic strike text | `respond` choice, then a separate reply prompt |
| DeepSeek V3.2 | JSONSchema in `<functions>` | DSML XML, raw strings | none (parser asserts) | n/a (app side) | text without calls |
| smolagents | name, description, inputs, output | JSON action or Python code | optional `{thought, code}` | "retry, don't repeat, change approach" | `final_answer` tool |
| Hermes FC | full OpenAI JSON in `<tools>` + call schema + few-shot | `<tool_call>` JSON | none in core | traceback in `<tool_response>` | text without calls |
| BFCL | native template (FC) or JSON in prompt | native or `[f(a=1)]` | none | none (scored) | empty or undecodable response |
| Gallery / LiteRT-LM | declarations with param descriptions | model-native call syntax | Lark grammar from tools, `AllowedTools` | `{"error": ...}` result | text without calls; Mobile Actions single-shot |
| TinyAgent | classifier-picked subset + retrieved examples | numbered plan with `$n` refs | none | replan with error | `join()` |
| OpenAI Agents SDK | provider-native | provider-native | provider | error string | text, or `StopAtTools` |
