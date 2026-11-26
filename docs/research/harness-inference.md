# How runtimes wire tool calling for Qwen3.5-family models, and where Hermit's harness differs from what BotPsy was trained on

Read 2026-11-11 from the code itself: BotPsy's chat template and model cards on Hugging Face, the installed QVAC SDK (`@qvac/sdk` 0.23.0, `@qvac/inference` 0.23.0, `@qvac/llm-llamacpp` 0.65.1 on `@qvac/fabric` 0.25.0), the QVAC addon C++ source (tetherto/qvac at b49c741, which is `@qvac/llm-llamacpp` 0.70.1, five patch releases newer than what we ship), llama.cpp master (ggml-org/llama.cpp at dd6b945) and Qwen-Agent (QwenLM/Qwen-Agent at 31a4d36). Hermit code read: `packages/model/src/port.ts`, `prompt.ts`, `profile.ts`, `engine.ts`, `apps/mobile/src/adapters/qvac-engine.ts`, `packages/agent/src/loop.ts`.

Paths below are abbreviated:

- `SDK/` = `node_modules/.pnpm/@qvac+sdk@0.23.0_c16f6548d648c0b63022b1f6cb3c51f5/node_modules/@qvac/sdk/dist/`
- `INF/` = `node_modules/.pnpm/@qvac+inference@0.23.0_1902d49843acebfaef6ca9639338b6bf/node_modules/@qvac/inference/dist/`
- `ADDON/` = `node_modules/.pnpm/@qvac+llm-llamacpp@0.65.1_bare-abort-controller@1.1.2_bare-buffer@3.7.1/node_modules/@qvac/llm-llamacpp/`
- `QVAC-SRC/` = https://github.com/tetherto/qvac/tree/b49c741591a570e545ff373bcec6b3995e6c9ee8/packages/llm-llamacpp/addon/src/
- `LCPP/` = https://github.com/ggml-org/llama.cpp/tree/dd6b945be2188da875ab05a259ce94c6b2736e64/

## Bottom line for Hermit

Yes, the harness is a plausible reason BotPsy underperforms. Two profiles have outright bugs, and the default profile (`botpsy-q4-two-stage-nothink`) asks the model for an output shape, a prompt layout and a reasoning mode it was never trained on.

### Bugs (fix before reading any eval number)

**B1. `botpsy-q4-native-think256` fails with an RPCError because the model is loaded without `tools: true`.** (Confirmed in code.)
- `qvac-engine.ts:22-31` calls `loadModel` with no `tools` key. The SDK only renders tools when the model was loaded with `modelConfig.tools === true`. Otherwise it drops them silently: `INF/plugins/builtin/llamacpp-completion/plugin.js:313` sets `toolsActive = tools.length > 0 && modelCfg.tools === true`, and `:362` forwards `tools` only when `toolsActive`. The same check is in `INF/plugins/builtin/llamacpp-completion/ops/completion-stream.js:188-194,247`.
- `generationParams.tool_choice: "required"` still goes through (`qvac-engine.ts:59`). The client-side refine passes because `tools` is non-empty in the request (`INF/schemas/completion-stream.js:78-90`). The native addon then sees a forced call with no tools in the prompt and throws. The binary contains `generationParams.tool_choice is "required" but the prompt declares no tools`, and the addon changelog says "`required` and a function name now fail with `InvalidArgument` rather than silently answering in prose" (QVAC CHANGELOG 0.53.0, lines 800-808). The worker turns that into the RPCError we saw.
- Fix: `modelConfig: { tools: true, ... }`. The BotPsy GGUF card's QVAC example does exactly this ("`tools: true, // render tools into the prompt and parse tool calls`"), and so does `SDK/examples/tools/llamacpp-tools-qwen35.js`. In the addon, `tools: "true"` is what turns on Jinja (`QVAC-SRC/model-interface/LoadFitNormalization.cpp:1289-1298`).

**B2. `botpsy-q4-two-stage-think256` most likely parses nothing and always falls back to `respond`.** (Inferred from code. Check it with `final.thinkingText` / `final.raw.fullText`.)
- With `reasoning_budget != 0`, the addon renders the template with `enable_thinking = true` (`QVAC-SRC/model-interface/TextLlmContext.cpp:333`), so the prompt ends in `<|im_start|>assistant\n<think>\n` (template lines 150-156).
- `json_schema` becomes an eager OUTPUT_FORMAT grammar that "starts at a JSON value" (`QVAC-SRC/model-interface/GenerationParamsApply.cpp:63-98`, `QVAC-SRC/utils/ChatTemplateUtils.cpp:680-694`). The model therefore has to write `{...}` as its first token *inside* the forced-open think block. It cannot think and never closes `</think>`.
- The addon streams a synthetic `<think>\n` opener when the template forced the channel open (`QVAC-SRC/model-interface/TextLlmContext.cpp:868-877`, CHANGELOG line 1940). With `captureThinking: true` (`qvac-engine.ts:45`), the SDK normalizer then routes every following token to `thinkingParts`, and an unclosed think frame is never moved to content at `finish()` (`INF/utils/completion-normalizer.js:137-143,372-407`).
- So `final.contentText` is empty, `safeJson` fails (`port.ts:77`), and `pick` returns `respond`. Whatever this profile scored, it measured the reply path, not tool selection.

### Mismatches with BotPsy's training, ranked by likely impact

1. **Thinking is off (or capped at 256), while BotPsy was trained, RL-rewarded and evaluated with thinking on.** The card says it plainly: "BotPsy was trained and evaluated in thinking mode. The chat template defaults to non-thinking, so pass `enable_thinking=True`" (model card, Usage). The RL tool reward "first checks the reasoning and tool-call format" (blog, Methodology). The blog measures thousands of reasoning tokens per correct answer even after its efficiency training (IFEval 3,148; MMLU-Pro 1,912). `nothink` puts BotPsy in the template's non-thinking branch (`<think>\n\n</think>\n\n`), which is the base model's path and not the one post-training optimized. This is the largest single distribution shift. The cost is latency: on the S26 at 21 to 32 tok/s, 256 thinking tokens take roughly 8 to 12 s of the 15 s bar.
2. **We constrain the whole output to our own JSON envelope from token 0. BotPsy emits Qwen3.5 XML tool calls after optional reasoning.** Trained output: `<tool_call>\n<function=NAME>\n<parameter=KEY>\nVALUE\n</parameter>\n</function>\n</tool_call>` (template line 53; card "Qwen3.5 XML format"). Ours: `{"choice":"remind","args":{"text":...,"at":...}}` through `anyOf` (`port.ts:64-76`), which BotPsy has never seen. llama.cpp does something different for native tools (see "Lazy grammar vs whole-output grammar"): under `auto` the grammar stays off until the model writes `<tool_call>`, and under `required` it is eager but still admits the `<think>` block and free text first (`LCPP/common/parsers/qwen3-coder.cpp:78-95,165-204`). The grammar then only enforces the format the model already wants to write. Ours forces a format it does not want to write, and grammar-forced tokens in a format the model does not expect pull the remaining tokens off-distribution.
3. **The tools are not where the model expects them.** Trained: the system turn starts with `# Tools\n\nYou have access to the following functions:\n\n<tools>` followed by one OpenAI-style JSON tool per line, then a fixed `<IMPORTANT>` instruction block, and only then the developer's system text (template lines 45-60). Ours: a prose "Menu:" with one-line descriptions, no argument schemas in the prompt (the schema lives only in the grammar), and few-shot lines of the form `"text" -> remind` (`prompt.ts:38-69`). The model does not see `text`/`at` descriptions or `required` lists in the place it learned to read them.
4. **Prior calls and tool results break the template's multi-step structure.** Trained: an assistant turn carries `tool_calls` and is rendered as `<tool_call>...` (template lines 107-131). Results come as `role: "tool"` and are rendered as `<|im_start|>user\n<tool_response>\n...\n</tool_response><|im_end|>` (lines 134-145). Ours: the call is stored as assistant text `{"skill":"remind","args":{...}}` (`loop.ts:123`), a third format, and the result as a user turn `Result: ...` (`prompt.ts:130-142`). The template finds "the last real user query" by skipping user turns that are wrapped in `<tool_response>` (lines 67-77). Our `Result:` turns are not wrapped, so every tool result looks like a new user query: earlier calls lose their trained context, and the model sees "user said `Result: ...`" where it learned to see a tool response. This matters for every multi-step turn (read then reply, error then repair).
5. **`respond` and `ask_user` are pseudo-tools, forced with `tool_choice: "required"`, while BotPsy learned to answer in prose when no tool fits.** Its best benchmark is declining to call (BFCL hallucination 86.1, ACEBench special cases 51.3). The trained "no tool" behavior is plain text with no `<tool_call>` (template `<IMPORTANT>` line: "If there is no function call available, answer the question like normal"). `required` plus `respond`/`ask_user` tools turns that strength into a forced pick among JSON schemas. In two_stage, `respond`/`ask_user` are branches of the `anyOf`, which has the same effect.
6. **Final replies are written under a different system prompt with no tools.** `words()` swaps in `replyPrompt` (`port.ts:116-148`, `prompt.ts:75-89`). BotPsy was trained to read `<tool_response>` and answer in the same conversation, under the same tools-bearing system turn. Lower impact: it is plain text generation, and the swap was added for a real symptom (bare action names).
7. **The system prompt competes with the template's format instructions.** If tools are rendered natively, our "act only by choosing one action from the menu" text and the `-> choice` examples land after the template's `<IMPORTANT>` block and describe a different protocol. Native profiles should drop the menu and the examples.
8. **Argument key order is fixed by the grammar.** `json_schema_to_grammar` accepts properties in declared order, required first (stated for the tool grammar in `ADDON/README.md:346`, which also says Qwen3.5's top-level `<parameter=...>` args accept up to six required ones in any order). Our skill schemas declare required keys first (`packages/skills/src/catalog.ts:39`), so this is low risk. It costs nothing in the native format.
9. **Token caps.** Native pick has `maxTokens: 512` (`port.ts:51`). The card says "keep `predict` at 2,048 tokens or more". With thinking and `required`, QVAC warns that "the eager grammar these produce admits an unbounded `<think>` prefix" and recommends a positive `reasoning_budget` (CHANGELOG lines 803-808). A 256 budget plus a call fits in 512, but there is no slack.
10. **Low confidence, worth one check: which renderer runs.** Without `tools: true` the addon leaves `use_jinja` at fabric's default. A comment in the addon source says "fabric defaults `use_jinja` to true" (`QVAC-SRC/model-interface/TextLlmContext.hpp:296-297`), and upstream `common_params.use_jinja = true` (`LCPP/common/common.h:668`). If so, the default profile gets the real template. If any render falls back to the legacy renderer (`ChatTemplateUtils` logs "falling back to the legacy renderer, which ignores tools"), the prompt loses the `<think>\n\n</think>\n\n` prefill (`LCPP/common/chat.cpp:1645-1707`), and a thinking-trained model would then start reasoning in visible text. That matches the symptom `stripVisibleReasoning` was written for. Check the rendered prompt once on a dev build.

Sampling matches the card (temperature 0.3, top_p 0.95, top_k 20, presence penalty 1.5; `profile.ts:80`), and the quantization is not the issue (Q4_K_M loses about 1.5 points on average per the GGUF card).

### What a "trained-format" profile looks like on QVAC 0.23

- `loadModel({ modelType: "llamacpp-completion", modelConfig: { tools: true, ctx_size, device: "cpu", threads: 8 } })`.
- `completion({ history, tools, captureThinking: true, generationParams: { temp: 0.3, top_p: 0.95, top_k: 20, presence_penalty: 1.5, reasoning_budget: N, tool_choice: "auto", parallel_tool_calls: false, predict: 1024 or more } })`. The dialect auto-detects as `qwen35` from the GGUF architecture (`INF/utils/tools/dialect.js:21-48`; the GGUF reports `architecture: qwen35`). No `responseFormat`: the SDK rejects it together with tools (`INF/schemas/completion-stream.js:261-271`), and the addon rejects `required` together with `json_schema` (`ADDON/index.js:160-170`).
- History in native form: a short system prompt (identity, untrusted-text rule, language, now, facts; no menu); the previous call as `{ role: "assistant", content: "", toolCalls: [{ id, name, arguments }] }`; the result as `{ role: "tool", content, toolCallId, toolName }` (schema in `INF/schemas/completion-stream.js:158-213`). The template turns these into `<tool_call>` and `<tool_response>`.
- Prose output (no `final.toolCalls`) means respond or ask_user. That needs a classifier or a final cheap call, but it plays to BotPsy's strongest benchmark instead of against it.
- Sweep `reasoning_budget` over 0, 256, 512 and -1 under that format before concluding that thinking is too slow. `tool_choice: "required"` is only worth trying once `respond`/`ask_user` stop being tools.

## 1. BotPsy's chat template

Source: https://huggingface.co/qvac/BotPsy-0.8B/raw/main/chat_template.jinja (7,791 bytes). The GGUF repo's embedded `tokenizer.chat_template` (from `https://huggingface.co/api/models/qvac/BotPsy-0.8B-GGUFs?expand[]=gguf`) is byte-identical. GGUF metadata: `architecture: qwen35`, `context_length: 262144`, `eos_token: <|im_end|>`. `generation_config.json`: temperature 0.3, top_k 20, top_p 0.95, eos ids 248046 and 248044.

- **Tools in the system prompt** (lines 45-60): when `tools` is non-empty, the system turn is `# Tools\n\nYou have access to the following functions:\n\n<tools>` + one `tool | tojson` per line + `\n</tools>`, then the format instructions and `<IMPORTANT>` block (verbatim in the appendix), then `\n\n` + the developer's system message (trimmed). The developer system text comes *after* the tools, inside the same system turn. Without tools, the system message is rendered alone (lines 62-65).
- **Tool-call syntax** (line 53 instructs it; lines 107-131 render it in history): Qwen3-Coder / Qwen3.5 XML, not Hermes JSON.
  ```
  <tool_call>
  <function=NAME>
  <parameter=KEY>
  VALUE
  </parameter>
  </function>
  </tool_call>
  ```
  String values are raw text. Objects and arrays are JSON (`tojson`, line 124). Each value sits on its own lines between `<parameter=...>\n` and `\n</parameter>`. Reasoning text is allowed *before* the call but not after ("NO suffix"). Several calls are separated by `\n` (line 119). If content precedes the call, it is separated by `\n\n` (line 114).
- **Tool results** (lines 134-145): `role: "tool"` messages are folded into one user turn: `<|im_start|>user` + `\n<tool_response>\n` + content + `\n</tool_response>` for each consecutive tool message, then `<|im_end|>\n`. There is no tool name or id in the rendered text; results are matched to calls by position.
- **Thinking switch** (lines 150-156): with `add_generation_prompt`, the template writes `<|im_start|>assistant\n` and then `<think>\n` if `enable_thinking is true`, otherwise `<think>\n\n</think>\n\n`. **The default is non-thinking**, and only an explicit `true` enables it, hence the card's warning.
- **`<think>` in history** (lines 67-106): the template locates `last_query_index`, the last user turn whose content is not wholly `<tool_response>...</tool_response>`. Assistant turns *after* it are re-rendered as `<think>\n{reasoning}\n</think>\n\n{content}` (reasoning taken from `reasoning_content`, or split out of the content at `</think>`). Assistant turns *before* it keep only the content, so their reasoning is dropped. Reasoning is therefore preserved inside the current multi-step tool loop and stripped from earlier turns. It raises "No user query found" if every user turn is a tool response, and "System message must be at the beginning" for a later system message.

## 2. QVAC SDK 0.23: how `completion()` handles tools, grammar and thinking

- **Load-time gate.** `modelConfig.tools` is "Enable tool calling via the model's jinja chat template. Default false." (`INF/schemas/llamacpp-config.js:100-103`). In the addon, `tools: "true"` sets `params.use_jinja = true` (`QVAC-SRC/model-interface/LoadFitNormalization.cpp:1289-1298`). Without it, tools passed to `completion()` are dropped from the prompt and from the normalizer (`INF/plugins/builtin/llamacpp-completion/plugin.js:313,362`), while `tool_choice` still reaches the addon. That is bug B1.
- **How tools reach llama.cpp.** The SDK prepends the tool objects (`{type:"function", name, description, parameters}`) right after the system message in the message array (`INF/utils/tool-integration.js:7-13`, `ops/completion-stream.js:24-35,247`). The addon turns them into `common_chat_tool`s and renders them with the model's Jinja template through llama.cpp's `common_chat_templates_apply` (binary symbols `TextLlmContext::tokenizeChat(... common_chat_tool ...)`; `QVAC-SRC/model-interface/TextLlmContext.cpp:332-355`). For BotPsy the template matches llama.cpp's Qwen3-Coder handler (section 3), and the `@qvac/fabric` 0.25 binary contains `Using specialized template: Qwen3-Coder`.
- **History with tool turns.** Assistant `toolCalls: [{id, name, arguments}]`, tool `toolCallId`, `toolName` (`INF/schemas/completion-stream.js:158-213`), forwarded as `tool_calls`, `tool_call_id`, `name` (`ops/completion-stream.js:49-61`). The addon README: "put the call on an assistant turn as `tool_calls` and the result on a `tool` turn; the chat template renders both natively" (`ADDON/README.md:328`).
- **Parsing calls.** Dialects: `hermes`, `pythonic`, `json`, `harmony`, `qwen35`, `gemma4`, `dsml` (`INF/schemas/completion-stream.js:7-30`). Detection order: model name or file name (`/qwen3[._-]?[568]/`, which `botpsy-0.8b-q4_k_m-imat.gguf` does not match), then GGUF `general.architecture` (`qwen35` maps to `qwen35`), then `hermes` (`INF/utils/tools/dialect.js:6-48`). So BotPsy resolves to `qwen35`. Its parser chain is `[parseQwen35Format, parseHermesFormat]` (`INF/utils/tools/parser.js:21-24`). `parseQwen35Format` strips `<think>...</think>`, regex-extracts `<tool_call>`, `<function=...>`, `<parameter=...>`, coerces values by the tool's schema types (accepting `True`/`False`), validates the arguments and *drops* invalid calls into `errors` (`INF/utils/tools/parsers/qwen35.js:54-128`). A call that fails validation comes back as no call, which `port.ts:53` maps to `respond`.
- **`tool_choice`** (`INF/schemas/completion-stream.js:66-70`): `auto` (default) "constrains output to the tool-call grammar only once it starts a call"; `required` forces one; `none` keeps the definitions but no grammar; any other string names a tool. `required` without tools is rejected client-side only if `tools` is absent (`:78-90`), which is why B1 surfaces as a native error. `parallel_tool_calls` defaults to `true` in the SDK op (`ops/completion-stream.js:18-23`); we set `false`.
- **`responseFormat` json_schema** becomes `generationParams.json_schema`, which the addon converts with `json_schema_to_grammar` into an eager OUTPUT_FORMAT grammar from the first generated token. The prefill of the assistant header is explicitly cleared because the JSON grammar cannot accept it (`QVAC-SRC/model-interface/GenerationParamsApply.cpp:63-127`). It cannot be combined with tools (`INF/schemas/completion-stream.js:261-271`), and `required` cannot be combined with `json_schema`/`grammar` (`ADDON/index.js:160-170`). The addon does not hand `json_schema` to the template: "fabric's handlers return a response-format-only parser and exclude tool calls" (`QVAC-SRC/model-interface/TextLlmContext.cpp:335-342`). That is the difference from llama-server, which composes the response format *after* an optional think block (section 3).
- **`reasoning_budget`**: `-1` unrestricted, `0` off, `N` caps the reasoning channel and force-emits the end tag (`INF/schemas/completion-stream.js:59-65`, `ADDON/index.d.ts:274-279`). `enable_thinking` for the template is derived from it: `inputs.enable_thinking = params_.reasoning_budget != 0` (`QVAC-SRC/model-interface/TextLlmContext.cpp:333`). Thinking tags come from the template first, then a family table that includes `qwen35` (`QVAC-SRC/utils/ChatTemplateUtils.cpp:55-60`). The budget sampler is also what keeps a lazy tool grammar from arming inside `<think>` (CHANGELOG lines 878-881).
- **`captureThinking`** registers `<think>`/`</think>` as a thinking frame in the stream normalizer (`INF/utils/completion-normalizer.js:58-63,86-96`). The addon emits a synthetic `<think>\n` opener when the template forced the channel open (`QVAC-SRC/model-interface/TextLlmContext.cpp:868-877`). An unclosed frame stays thinking at `finish()` (`:372-407`). `final.contentText` is content only; `final.raw.fullText` keeps everything.
- **What breaks with `required` plus a thinking budget:** (a) the B1 error if `tools: true` is missing; (b) per the addon changelog, the eager `required` grammar "admits an unbounded `<think>` prefix on a reasoning model, so `n_predict` can be spent before the tool call is reached. Cap the reasoning channel with a positive `reasoning_budget`" (CHANGELOG lines 803-808), so `predict` must cover budget plus call; (c) `required` "fail[s] the request rather than answering in prose when the model cannot honour them", and the binary has `tool_choice demanded a tool call, but the chat template did not render the tool definitions` / `but no tool-call grammar could be applied`; (d) tools named `auto`, `none` or `required`, or names that fold to the same grammar rule, are rejected (CHANGELOG lines 811-826). Our tool names are fine.

## 3. llama.cpp `common/chat.cpp` and parsers: Qwen3, Qwen3.5 and Hermes 2 Pro

- **Template detection.** `common_chat_template_detect_params_init` picks the specialized Qwen3-Coder handler for any template containing `<tool_call>`, `<function=` and `<parameter=` ("Qwen3-Coder XML tool calls, also used by Nemotron Nano 3, Qwen3.5 and StepFun-3.5-Flash"; `LCPP/common/chat.cpp:1444-1452`). BotPsy's template matches. Other templates go to the "differential autoparser" (`:1595-1625`, `LCPP/docs/autoparser.md`). Hermes 2 Pro and Qwen3 (JSON inside `<tool_call>`) are handled there as `JSON_NATIVE` with the `<tool_call>` wrapper (`LCPP/docs/autoparser.md:490`). There is no longer a dedicated Hermes handler in `common/`.
- **Qwen3-Coder / Qwen3.5 handler** (`LCPP/common/parsers/qwen3-coder.cpp`):
  - Thinking support is detected from `<think>` in the template; reasoning ends at `\n</think>`, `</think>` or `<tool_call>` (`:13-30`). `<tool_call>`, `</tool_call>`, `<think>`, `</think>` are preserved tokens.
  - Parser (also the grammar source) = generation prompt + optional `<think>...` reasoning + free content until a tool-call start + tool calls (`:74-187`). Per tool: `<function=NAME>\n` + a *permutation* of required `<parameter=...>` blocks ("Qwen does not always adhere to the order provided") + any optional ones + `</function>\n` (`:104-163`). String params are raw text up to `\n</parameter>\n`; typed params are JSON.
  - `tool_choice: required` sets the minimum calls to 1 (`:165,176`); `parallel_tool_calls` allows repeats (`:175`).
  - **Lazy vs eager:** `grammar_lazy = !has_response_format && has_tools && tool_choice == AUTO` (`:193-205`). Under `auto`, the grammar is dormant until the trigger word `<tool_call>` appears, so the model thinks and writes freely and is only constrained once it commits to a call. Under `required` the grammar is eager but itself admits the think block and leading content.
  - **Response format with this handler** (llama-server path): `generation_prompt + (reasoning << content(schema(json)))` (`:89-96`). Even a JSON response format lets the model finish `<think>...</think>` first ("The answer must be bare JSON, so the think block is consumed").
- **Thinking with tools.** llama-server sets `enable_thinking` from the server default or the `chat_template_kwargs.enable_thinking` override (`LCPP/tools/server/server-common.cpp:1492-1511`) and passes the template's thinking start and end tags to the reasoning-budget sampler (`:1536-1548`). The sampler starts COUNTING when the generation prompt already opened `<think>` (`LCPP/docs/autoparser.md:53-63`). `grammar_should_apply` suspends a *lazy* grammar while the budget sampler is inside reasoning (`LCPP/common/sampling.cpp:461-474`), so a `<tool_call>` written while thinking does not trigger the grammar. When the budget runs out, the forced end tag is replayed and may itself be a trigger (`:483-499`).
- **Key question: whole-output JSON grammar from token 0 vs llama.cpp native tools.** They are different. llama.cpp (and vLLM's `qwen3_xml` parser, which the card uses) lets the model emit its trained prefix (`<think>` reasoning, optional text) unconstrained, and constrains only the tool-call span, in the model's own syntax, either lazily after `<tool_call>` (`auto`) or with a grammar that still admits reasoning first (`required`). Hermit constrains every token from the first, in a JSON envelope the model never saw, with no room to reason. And through QVAC's OUTPUT_FORMAT path, even a "thinking" profile has its JSON forced inside the open think block (bug B2).

## 4. Qwen-Agent

- **Default function-calling prompt is "nous"** (`qwen_agent/llm/function_calling.py:27-37`; README: "tool-call template: default is nous (recommended for qwen3)"). `FN_CALL_TEMPLATE` (`qwen_agent/llm/fncall_prompts/nous_fncall_prompt.py:254-266`): `# Tools\n\nYou may call one or more functions to assist with the user query.\n\nYou are provided with function signatures within <tools></tools> XML tags:\n<tools>\n{one JSON tool per line}\n</tools>\n\nFor each function call, return a json object with function name and arguments within <tool_call></tool_call> XML tags:\n<tool_call>\n{"name": <function-name>, "arguments": <args-json-object>}\n</tool_call>`. It is appended to the existing system message (`:97-100`). This is the Hermes/Qwen3 JSON format, **not** BotPsy's.
- **Calls and results fed back** (`nous_fncall_prompt.py:43-89`): a past call becomes assistant text `<tool_call>\n{"name":...,"arguments":...}\n</tool_call>`; consecutive assistant pieces are merged; a function result becomes `<tool_response>\n...\n</tool_response>` inside a **user** turn, merged with an adjacent user turn. This is the same shape the Qwen3.5 template produces natively.
- **Parsing** (`:103-251`): never parse `<tool_call>` inside `<think>` (`:136-146`); split text before `<tool_call>` into a separate "thought" message; fall back to string extraction on bad JSON.
- **Forcing a choice:** nous raises `NotImplementedError` for any `function_choice` other than `auto` (`:38-39`). The older "qwen" prompt forces a named function by *prefilling* the assistant turn with `✿FUNCTION✿: name` (`qwen_fncall_prompt.py:95-108`) rather than with a grammar. When tools are disabled (`function_choice="none"`), calls and results are rewritten into user text "The tool "X" was called with these arguments..." / "The tool has returned the following result..." (`function_calling.py:83-117`). That is closest to our `Result:` turns, and Qwen-Agent uses it only when it does *not* want tool calls.
- **Qwen3.5 and Qwen3-Coder: use the server's native path.** README: "For Qwen3-Coder, it is recommended to enable both [`--enable-auto-tool-choice --tool-call-parser`] ..., use vLLM's built-in tool parsing, and combine with the `use_raw_api` parameter". The Qwen3.5 demo sets `'use_raw_api': True` and `enable_thinking: True` (`examples/assistant_qwen3.5.py`). With `use_raw_api`, Qwen-Agent skips its own prompt entirely (`function_calling.py:50-51`, `base.py:220-223`). In other words, Qwen's own agent framework does not hand-roll prompts for the XML-format family; it defers to the chat template and the server's parser.
- No small-model-specific guidance in the repo beyond these defaults.

## Appendix A: BotPsy-0.8B `chat_template.jinja`, verbatim key parts

Tools block and system message (lines 45-66):

```jinja
{%- if tools and tools is iterable and tools is not mapping %}
    {{- '<|im_start|>system\n' }}
    {{- "# Tools\n\nYou have access to the following functions:\n\n<tools>" }}
    {%- for tool in tools %}
        {{- "\n" }}
        {{- tool | tojson }}
    {%- endfor %}
    {{- "\n</tools>" }}
    {{- '\n\nIf you choose to call a function ONLY reply in the following format with NO suffix:\n\n<tool_call>\n<function=example_function_name>\n<parameter=example_parameter_1>\nvalue_1\n</parameter>\n<parameter=example_parameter_2>\nThis is the value for the second parameter\nthat can span\nmultiple lines\n</parameter>\n</function>\n</tool_call>\n\n<IMPORTANT>\nReminder:\n- Function calls MUST follow the specified format: an inner <function=...></function> block must be nested within <tool_call></tool_call> XML tags\n- Required parameters MUST be specified\n- You may provide optional reasoning for your function call in natural language BEFORE the function call, but NOT after\n- If there is no function call available, answer the question like normal with your current knowledge and do not tell the user about function calls\n</IMPORTANT>' }}
    {%- if messages[0].role == 'system' %}
        {%- set content = render_content(messages[0].content, false, true)|trim %}
        {%- if content %}
            {{- '\n\n' + content }}
        {%- endif %}
    {%- endif %}
    {{- '<|im_end|>\n' }}
{%- else %}
    {%- if messages[0].role == 'system' %}
        {%- set content = render_content(messages[0].content, false, true)|trim %}
        {{- '<|im_start|>system\n' + content + '<|im_end|>\n' }}
    {%- endif %}
{%- endif %}
```

Last real user query (lines 67-80):

```jinja
{%- set ns = namespace(multi_step_tool=true, last_query_index=messages|length - 1) %}
{%- for message in messages[::-1] %}
    {%- set index = (messages|length - 1) - loop.index0 %}
    {%- if ns.multi_step_tool and message.role == "user" %}
        {%- set content = render_content(message.content, false)|trim %}
        {%- if not(content.startswith('<tool_response>') and content.endswith('</tool_response>')) %}
            {%- set ns.multi_step_tool = false %}
            {%- set ns.last_query_index = index %}
        {%- endif %}
    {%- endif %}
{%- endfor %}
{%- if ns.multi_step_tool %}
    {{- raise_exception('No user query found in messages.') }}
{%- endif %}
```

Assistant turns, reasoning and tool calls (lines 89-133):

```jinja
    {%- elif message.role == "assistant" %}
        {%- set reasoning_content = '' %}
        {%- if message.reasoning_content is string %}
            {%- set reasoning_content = message.reasoning_content %}
        {%- else %}
            {%- if '</think>' in content %}
                {%- set reasoning_content = content.split('</think>')[0].rstrip('\n').split('<think>')[-1].lstrip('\n') %}
                {%- set content = content.split('</think>')[-1].lstrip('\n') %}
            {%- endif %}
        {%- endif %}
        {%- set reasoning_content = reasoning_content|trim %}
        {{- '<|im_start|>' + message.role + '\n' -}}
        {% generation %}
        {%- if loop.index0 > ns.last_query_index %}
            {{- '<think>\n' + reasoning_content + '\n</think>\n\n' + content -}}
        {%- else %}
            {{- content -}}
        {%- endif %}
        {%- if message.tool_calls and message.tool_calls is iterable and message.tool_calls is not mapping %}
            {%- for tool_call in message.tool_calls %}
                {%- if tool_call.function is defined %}
                    {%- set tool_call = tool_call.function %}
                {%- endif %}
                {%- if loop.first %}
                    {%- if content|trim %}
                        {{- '\n\n<tool_call>\n<function=' + tool_call.name + '>\n' }}
                    {%- else %}
                        {{- '<tool_call>\n<function=' + tool_call.name + '>\n' }}
                    {%- endif %}
                {%- else %}
                    {{- '\n<tool_call>\n<function=' + tool_call.name + '>\n' }}
                {%- endif %}
                {%- if tool_call.arguments is defined %}
                    {%- for args_name, args_value in tool_call.arguments|items %}
                        {{- '<parameter=' + args_name + '>\n' }}
                        {%- set args_value = args_value | tojson | safe if args_value is mapping or (args_value is sequence and args_value is not string) else args_value | string %}
                        {{- args_value }}
                        {{- '\n</parameter>\n' }}
                    {%- endfor %}
                {%- endif %}
                {{- '</function>\n</tool_call>' }}
            {%- endfor %}
        {%- endif %}
        {{- '<|im_end|>\n' }}
        {%- endgeneration %}
```

Tool results (lines 134-145):

```jinja
    {%- elif message.role == "tool" %}
        {%- if loop.previtem and loop.previtem.role != "tool" %}
            {{- '<|im_start|>user' }}
        {%- endif %}
        {{- '\n<tool_response>\n' }}
        {{- content }}
        {{- '\n</tool_response>' }}
        {%- if not loop.last and loop.nextitem.role != "tool" %}
            {{- '<|im_end|>\n' }}
        {%- elif loop.last %}
            {{- '<|im_end|>\n' }}
        {%- endif %}
```

Generation prompt and thinking switch (lines 150-157):

```jinja
{%- if add_generation_prompt %}
    {{- '<|im_start|>assistant\n' }}
    {%- if enable_thinking is defined and enable_thinking is true %}
        {{- '<think>\n' }}
    {%- else %}
        {{- '<think>\n\n</think>\n\n' }}
    {%- endif %}
{%- endif %}
```

Lines 1-44 (not shown) are the `render_content` macro for text, image and video parts, plus `raise_exception('No messages provided.')`.

## Appendix B: what BotPsy emits for one call (thinking on)

```
<think>
The user wants a reminder to call mom at 9 pm today. Use remind with text and at.
</think>

<tool_call>
<function=remind>
<parameter=text>
Call mom
</parameter>
<parameter=at>
2026-11-11T21:00:00
</parameter>
</function>
</tool_call>
```

(The `<think>\n` opener is part of the prompt when `enable_thinking` is true; the model generates from the reasoning text onward. With thinking off, the prompt already contains `<think>\n\n</think>\n\n` and the model starts directly at `<tool_call>` or at prose.)
