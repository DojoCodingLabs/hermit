# Decision models as a companion router for Hermit

Research spike, 2026-11-12, on whether a decision model beside the main model would improve Hermit's tool selection. Context (not repeated here): [harness-diagnosis.md](harness-diagnosis.md), [harness-literature.md](harness-literature.md), Q34 in `docs/build/open-questions.md`.

Legend: **[verified]** means I read the primary source (model card, repo code, Hugging Face API listing, merged PR) at the URL given. **[vendor]** means verified that the vendor says it, not that it is true. **[unverified]** means a secondary page claims it or I could not confirm it. **[computed]** means my arithmetic from measured inputs. Nothing here was run; no weights were downloaded.

## Bottom line for Hermit

1. **The category is real.** Since September 2026 there is a family of open "decision models" that copy TypeSafe's hosted Jev API: you send a `state` (text) plus typed questions (`choice` over named options, `noul` yes/no, `score` ordinal), and the model returns a calibrated probability per option from one forward pass, with no generated text. Kev, Intern-Decision, pplx-decider, Strands Decider, THIS/THAT and GLiNER2.5-Decide all exist on Hugging Face. Two of the sources checked are broken or junk: the OpenRouter Kev-4B page returns 404, and the gradually.ai comparison is templated SEO with internal contradictions.
2. **Only one candidate fits Hermit's runtime without new native code: Intern-Decision-0.8B.** It is a full fine-tune of Qwen3.5-0.8B (the same architecture as BotPsy). It answers with the ordinary next-token logits over letter symbols (`A`, `B`, ...), so plain llama.cpp completion can run it, and QVAC can run it through its existing `json_schema` grammar (argmax only, because QVAC exposes no logprobs). A Q8_0 GGUF exists (811.8 MB). It is also the only small candidate with a published tool-selection score (ToolACE 94.5%, self-reported).
3. **Kev-0.8B is the wrong pick, by its own model card:** English only, and "Tool-call routing ... its When2Call accuracy is below chance" (0.133 on test). Kev-4B does better on When2Call (0.660) but is a 3 GB Q4_K_M file. Both need a pointer head that only upstream llama-server's new `/v1/systemone` endpoint runs; QVAC 0.23 does not.
4. **Nothing published targets our actual failure.** The confusion is "add something" with no details, which should be ask_user. That is a When2Call-style decision (call vs ask for missing details), not a tool-selection decision. Kev-0.8B fails it, Intern-Decision was not evaluated on it, and no candidate is trained on Spanish. Expect the decision model to help with *which skill* and to need a second, explicit yes/no question for *are the details there*.
5. **Four ways to place a decision model, with a verdict for each:**
   - (a) A companion on every turn: not justified. It adds a second resident model (about 0.8 GB at Q8_0) and roughly 1 s of prefill per turn on the S26 [computed], for turns the phrase router already gets right at zero cost.
   - (b) Only on phrase-router misses: **the right shape to test first.** The cost is paid only where today we pay about 11 s of thinking.
   - (c) Replacing BotPsy's thinking for the selection step: **this is the real prize** if (b) passes the bar. Decide the skill in about 1 s, then BotPsy fills that one skill's arguments with thinking off and a one-tool grammar, with CT-02 code resolving times. The risk moves to argument quality without thinking (H6 in harness-diagnosis lost points there), so it must be measured separately.
   - (d) Not worth it: possible. Run a free control first: ask **BotPsy itself** the same letter-symbol question with thinking off. If BotPsy as its own decider matches Intern-Decision on the router-miss cases, no second model is needed.
6. **Spike recommendation:** Intern-Decision-0.8B Q8_0 on the Mac with `llama-server`, raw `/completion` with `n_probs`, on exactly the residual cases that `packages/eval/src/embed-check.ts` already isolates (cases where `routeIntent` returns the full menu), with BotPsy in the same prompt as the control arm. The bar stays Q34's: at least 95% precision on the router-miss cases of both blind sets. Exact file and call format are in "Recommended spike" below.
7. **Disk space:** check free space before downloading the 0.8 GB file.

## Candidates

### Kev 0.8B / 4B (Jared Palmer)

- **Exists.** Repo https://github.com/jaredpalmer/kev (Apache-2.0, about 10k stars, Python) **[verified]**. Weights https://huggingface.co/jaredpalmer/kev-0.8b and https://huggingface.co/jaredpalmer/kev-4b **[verified]**.
- **OpenRouter page** https://openrouter.ai/jaredpalmer/kev-4b returns HTTP 404 **[verified]**. There is no hosted Kev on OpenRouter.
- **What it decides:** `choice` (1 to 255 named options with optional descriptions), `noul` (probability of yes), `score` (ordered levels). Many questions per request; each is isolated from the others **[verified, README]**.
- **Architecture, from the code** (`kev/model.py`) **[verified]**:
  - A rank-16 LoRA plus a small "pointer head" on a frozen Qwen3.5 base. Kev-0.8B: base `Qwen/Qwen3.5-0.8B-Base`; adapter 43.3 MB; `head.pt` 2.1 MB.
  - Prompt layout reuses rare Qwen special tokens as delimiters: `SPECIAL = ["<|fim_prefix|>", "<|fim_middle|>", "<|box_start|>", "<|box_end|>", "<|fim_suffix|>"]` stand for `<state>`, `<q>`, `<opt>`, `</opt>`, `<decide>`.
  - Sequence: `<state> state-text` then per question `<q> instructions <opt> option-1 </opt> <opt> option-2 </opt> ... <decide>`. Caller text is escaped so it cannot forge delimiters.
  - The head is two linear layers (hidden size to 256) that score each option's `</opt>` final hidden state (`last_hidden_state`, after the final norm) against the `<decide>` hidden state; softmax, then divide by a fitted temperature (0.8B: 2.35).
  - There is no chat template and no generation. A caller passes options only through the API JSON; the server builds the token sequence.
- **Benchmarks (self-reported, CI-checked against committed reports)** **[vendor]**, from https://github.com/jaredpalmer/kev/blob/main/docs/model-cards/kev-0.8b.md:
  - Kev-0.8B: transfer-v4 locked test 0.697; breadth-v1 test 0.586 (Jev 0.757); coverage at 5% error only 0.14 to 0.27.
  - **When2Call (call a tool, ask for a missing parameter, or decline): 0.167 dev / 0.133 test, below the 0.25 chance rate.** The card lists "Tool-call routing" under out-of-scope uses and says "Do not use it for tool-call routing".
  - Kev-4B: When2Call 0.660 on development (https://github.com/jaredpalmer/kev/blob/main/docs/model-cards/kev-4b.md).
- **Languages:** "English"; "languages other than English" are out of scope (both cards) **[verified]**.
- **Latency:** Kev-4B on an Apple M5, five questions: 721 ms new text, 136 ms cached **[vendor]**. No phone or ARM CPU numbers.
- **Runtime fit:**
  - GGUF: https://huggingface.co/ggml-org/Kev-0.8B-GGUF, `Kev-0.8B-Q8_0.gguf` 812.4 MB (also BF16 1,517.8 MB); https://huggingface.co/ggml-org/Kev-4B-GGUF, `Kev-4B-Q4_K_M.gguf` 3,033.5 MB **[verified, HF API]**.
  - These run only through llama-server's `/v1/systemone`, added by https://github.com/ggml-org/llama.cpp/pull/29818 (merged 2026-10-02; supports laya, julia-1, lev, openjev, kev) **[verified]**. The head lives in the GGUF and is applied in libllama.
  - **QVAC: no.** QVAC 0.23's `completion()` takes chat history plus an optional `json_schema`; it has no systemone path and no per-token hidden states (`apps/mobile/node_modules/@qvac/sdk/dist/src/client/api/completion-stream.d.ts`) **[verified]**. Using Kev on the phone would need QVAC to adopt the new libllama getters.
- **Verdict:** no for Hermit. The 0.8B is English only and fails tool routing by its own measurement; the 4B is too large to sit next to BotPsy.

### Intern-Decision-0.8B (InternLM)

- **The gradually.ai page** https://www.gradually.ai/en/ai-decision-model-comparison/kev-0.8b-vs-intern-decision-0.8b/ exists but is templated SEO content: no model links, and it contradicts itself (Kev leads "5 of 42" subtests in one place and "4 of 37" in another) **[verified]**. Do not cite it.
- **The model exists:** https://huggingface.co/internlm/Intern-Decision-0.8B (Apache-2.0 with Qwen notices; also 2B and 4B), GitHub https://github.com/InternLM/Intern-Decision (Apache-2.0), report https://arxiv.org/abs/2610.22131 **[verified]**.
- **What it is:** a full fine-tune of `Qwen/Qwen3.5-0.8B` (`Qwen3_5ForConditionalGeneration`, 24 layers, hidden 1024, with a vision tower). Same API shape as Jev and Kev: `state` plus 1 to 16 questions of type `choice`, `score` or `noul`, up to 62 options each **[verified, card and `inference.py`]**.
- **How it decides, from `inference.py`** **[verified]**:
  - Options become single-token symbols `A`..`Z`, `a`..`z`, `0`..`9`.
  - A fixed system prompt; a user message `Return one answer for every field using the supplied answer symbols.\n\n## State\n<json.dumps(state)>\n## Decision schema\n<field>: <instructions>\n    A = <value>: <description>\n ...`.
  - An assistant turn that is a JSON skeleton with a new added token `<decision>` (id 248077) in each field, rendered with the checkpoint's chat template and an empty think block.
  - One forward pass; the logits at the position right before each `<decision>` are softmaxed over that field's allowed symbols, then temperature-scaled (T = 2.7478; argmax unchanged).
  - This is ordinary next-token prediction, which is why plain llama.cpp can run it.
- **Benchmarks (self-reported by InternLM, on the card and in the report)** **[vendor]**: average 79.38 across seven suites (Kev 79.56, Jev 88.74). **ToolACE 94.52** (Jev 91.29, Kev 87.42); per the report, ToolACE here is "tool selection": pick the catalog function from candidate tools. Typed Decision 77.35; Jevbench-Hard 52.25. No When2Call or missing-argument evaluation.
- **Languages:** not stated. Training data includes ToolACE, AG News, synthetic data from deepseek-v4.1-flash, WildJailbreak and Chinese sets (Ruozhiba, COIG-CQIA), per the report **[verified via arXiv HTML summary]**. No Spanish evidence. Qwen3.5's base is multilingual, so Spanish may partly carry over **[unverified]**.
- **Latency:** 33.4 ms median on an RTX 4090 **[vendor]**. No CPU or phone numbers.
- **Runtime fit:**
  - GGUF (community, not InternLM): https://huggingface.co/bombdefuser-124/Intern-Decision-0.8B-GGUF, `intern-decision-0.8b-q8_0.gguf` **811.8 MB**, `intern-decision-0.8b-fp16.gguf` 1,516.7 MB, `mmproj-f16.gguf` 205.0 MB (vision, not needed) **[verified, HF API]**. No Q4_K_M is published; one can be made from the fp16 file with `llama-quantize` (expected about 530 MB, like QVAC's `QWEN3_5_0_8B` Q4_K_M at 533 MB) **[unverified]**. The card warns that the temperature was fitted on BF16, so quantization can shift calibration.
  - Other ports: Core ML https://huggingface.co/FluidInference/intern-decision-0.8b-coreml; ONNX FP16 https://huggingface.co/Wortou/Intern-Decision-0.8B-ONNX-FP16 **[verified to exist]**.
  - **QVAC: yes, with limits.** Send the system and user messages, thinking off, and `responseFormat: json_schema` with `{"type":"object","properties":{"skill":{"enum":["A","B",...]}},"required":["skill"]}`. You get the argmax symbol but no probabilities, because QVAC exposes no logprobs and no raw-prompt or assistant-prefill completion. The model also writes the skeleton itself instead of reading a pre-filled one, which is slightly off its training format. Two models resident is supported by QVAC (separate `modelId`s) but costs RAM.
- **Verdict:** the best candidate to spike. It has the right architecture and size, it is the only one QVAC can run today, and it has a tool-selection score. Its Spanish and ask_user behavior are unknown and must be measured.

### GLiNER2.5-Decide (Fastino)

- **Blog** https://fastino.ai/blog/gliner-2-5-decide-open-weight-decision-model exists **[verified]**. It reports 340M parameters, Apache-2.0, CPU-capable, 60.1% average on Fastino's own internal "Fast Decisions" suite, and 167 ms p50 on a 48-vCPU Xeon **[vendor]**.
- **Weights:** https://huggingface.co/fastino/GLiNER2.5-Decide, `model.safetensors` 1,945.8 MB (fp32), English, base `fastino/gliner2-large-v1` (a DeBERTa-v3-style encoder) **[verified]**. A multilingual sibling, https://huggingface.co/fastino/GLiNER2.5-multi-Decide (287M, 1,149.5 MB, tagged "multilingual"), scores 56.7% on the same suite **[verified]**. Its base `fastino/gliner2-multi-v1` lists fr, en, es, de, it, pt **[verified]**.
- **What it decides:** zero-shot classification over label sets passed at call time (`classify_text(text, {"intent": [labels]})`), multi-label, plus entity extraction. Encoder, single forward pass, one score per label marker.
- **Core ML link** https://aiindigo.com/tool/gliner2-5-decide-coreml is a directory listing that rewords the model card and points to https://huggingface.co/FluidInference/gliner2-5-decide-coreml (exists) **[verified]**. iOS only.
- **Runtime fit:**
  - Encoder, not llama.cpp mainline. ONNX: https://huggingface.co/onnx-community/GLiNER2.5-Decide-mobile-ONNX, `onnx/model_q4f16.onnx_data` 344.9 MB (English model) **[verified]**; community multi ONNX `DanKau/gliner2.5-multi-decide-onnx` (not inspected).
  - A llama.cpp GGUF exists at https://huggingface.co/3ntr0py-t4m3r/GLiNER2.5-Decide-GGUF (`gliner2.5-decide-q4_k_m.gguf` 299.5 MB). It claims upstream support via PR 29818, but that PR lists only laya, julia-1, lev, openjev and kev, and the repo ships its own DeBERTa patch. Treat as a fork **[unverified]**.
  - **QVAC: no.** It would need ONNX Runtime as a new React Native native dependency.
  - The same GGUF repo measured that short label keys separate classes 4.6x better than sentence descriptions **[vendor, community]**. That hurts our case: "add something" vs ask_user is not separable by a short label.
- **Verdict:** a reasonable fallback if Hermit ever adds ONNX Runtime (the multilingual 287M version). Not for now.

### Strands Decider (AWS / Strands)

- **Blog** https://strandsagents.com/blog/amazon-saves-millions-replacing-sonnet-with-strands-decider/ exists **[verified]**. It reports a production win over Claude Sonnet 4.6 on Amazon tickets (897 ms vs 4,215 ms per call) with no public accuracy numbers, and the production build is a Gemma 4 E4B variant using about 19 GiB on an A10G **[vendor]**. The "saves millions" headline is not backed by figures on the page.
- **Code** https://github.com/strands-labs/strands-decider (Apache-2.0) **[verified]**. **Weights** https://huggingface.co/StrandsAgents/strands-decider-2B-qwen3.5-v1-2610: LoRA (201.9 MB) plus `head.safetensors` (12.6 MB) on `Qwen/Qwen3.5-2B-Base`, 0 downloads at time of check **[verified]**. Self-reported JevBench public 0.779 **[vendor]**. The training list includes `mteb/amazon_massive_intent` (multilingual intents) and function-calling sets.
- **Runtime fit:** PEFT plus a custom head; no GGUF found; not in PR 29818's list. **QVAC: no.** At 2B it is also larger than BotPsy.
- **Verdict:** no.

### THIS/THAT (FLock.io)

- **Hackernoon page** https://hackernoon.com/flockio-launches-qwen-powered-open-source-decision-model-for-local-edge-deployment is a paid press release (filed under HackerNoon Press Releases, with a media contact) **[verified]**. Its claims (beats Claude Opus 5, sub-31 ms) are company claims.
- **Weights:** https://huggingface.co/flock-io/this-that-model-1.2, MIT, English, 3,763.7 MB, `base_model: decider-2b` (the press release says Qwen3.5-2B) **[verified]**. Benchmark 0.878 on its own public set `limberc/this-that-complex-decisions` (policy-rule decisions over structured states, not intent routing) **[vendor]**.
- **Runtime fit:** "zero output tokens" means a readout head. mradermacher GGUFs exist (https://huggingface.co/mradermacher/this-that-model-1.2-GGUF, Q4_K_M 1,274.4 MB), but a generic conversion probably drops the decision head, so they likely do not reproduce the model **[unverified]**. Over the 1 GB budget anyway.
- **Verdict:** no. Wrong task family, English only, too large.

### Perplexity pplx-decider-flash (4B)

- **The alphasignal page** https://alphasignal.ai/news/perplexity-drops-open-weight-pplx-decider-to-replace-json-parsing-with-typed-ai exists **[verified]**. The model is real: https://huggingface.co/perplexity-ai/pplx-decider-flash-v1.2, Apache-2.0, base `Qwen/Qwen3.5-4B`, distilled from the 27B, two shards totalling about 9.1 GB plus `readout.safetensors` **[verified]**. v1.3 repos also exist.
- **Benchmarks:** Decision Index 0.3 overall 58.88 (joint) / 60.05 (one question per request); **Tools category 76.7 / 80.9** **[vendor]**. Options are shown as codes `A`, `B`, ... and read by a readout head. Languages not stated.
- **Runtime fit:** official GGUF https://huggingface.co/perplexity-ai/pplx-decider-flash-gguf-v1.2, `decider-flash-v1.2-q8_0.gguf` 5,157.8 MB **[verified]**. The card says "The repository is private" while the files are publicly listed, an inconsistency. Not in PR 29818's list, so serving needs Perplexity's code. **QVAC: no.**
- **Verdict:** no. About 6x BotPsy's memory.

### Other routers checked

- **Arch-Router-1.5B (Katanemo):** generative router that outputs `{"route": "<name>"}` given route descriptions and the conversation; base Qwen2.5-1.5B-Instruct; English. Official GGUF https://huggingface.co/katanemo/Arch-Router-1.5B.gguf, `Arch-Router-1.5B-Q4_K_M.gguf` 986.0 MB **[verified]**. It runs in QVAC as plain completion. Against it: the Katanemo Community License (Llama 3.2 style, not Apache) **[verified]**; it is built for routing between LLMs by domain and action, not tools with missing-argument checks; and it is bigger than BotPsy. Not recommended.
- **Kev and pplx derivatives:** many community ports exist (LiteRT, RKNN, Core ML, MLX). Notable: `renlu/intern-decision-4b-tool-gate-v0.22.0-gguf`, a 4B "tool gate" LoRA as GGUF (32.5 MB LoRA on a 4.48 GB Q8_0 base) **[verified to exist, not evaluated]**. It shows people are fine-tuning Intern-Decision for tool gating; too big for us.
- **FunctionGemma 270M and When2Call** are already covered in harness-literature.md. When2Call is the right public benchmark for our ask_user confusion.

## Comparison

| Model | Params | Smallest usable file | Base | License | Spanish | Tool routing evidence | llama.cpp | QVAC 0.23 |
| :---- | :---- | :---- | :---- | :---- | :---- | :---- | :---- | :---- |
| Intern-Decision-0.8B | 0.8B | Q8_0 811.8 MB (community) | Qwen3.5-0.8B (full FT) | Apache-2.0 + Qwen notices | not stated | ToolACE 94.5 [vendor] | yes, plain completion | yes, argmax via json_schema |
| Kev-0.8B | 0.8B + LoRA | Q8_0 812.4 MB | Qwen3.5-0.8B-Base | Apache-2.0 | no (English only) | When2Call 0.133, below chance [vendor] | `/v1/systemone` only | no |
| Kev-4B | 4B + LoRA | Q4_K_M 3,033.5 MB | Qwen3.5-4B-Base | Apache-2.0 | no | When2Call 0.660 [vendor] | `/v1/systemone` only | no |
| GLiNER2.5-multi-Decide | 287M | ONNX (community) | gliner2-multi (encoder) | Apache-2.0 | base lists es | none | fork only | no |
| GLiNER2.5-Decide | 340M | ONNX q4f16 344.9 MB | gliner2-large (encoder) | Apache-2.0 | no | none | fork only | no |
| Strands Decider 2B | 2B + LoRA | adapter 201.9 MB + base | Qwen3.5-2B-Base | Apache-2.0 | not stated | trained on function-calling sets | no | no |
| THIS/THAT 1.2 | 1.88B | Q4_K_M 1,274.4 MB (head likely lost) | "decider-2b" | MIT | no | none | doubtful | no |
| pplx-decider-flash 1.2 | 4B | Q8_0 5,157.8 MB | Qwen3.5-4B | Apache-2.0 | not stated | DI Tools 76.7 to 80.9 [vendor] | no | no |
| Arch-Router-1.5B | 1.5B | Q4_K_M 986.0 MB | Qwen2.5-1.5B | Katanemo community | no | LLM routing only | yes | yes |

## Where a decision model fits Hermit

**Costs on the S26, from numbers we already have.** Measured Qwen3.5-0.8B Q4_K_M prefill on the S26 is 450 to 500 tok/s (device-adaptive-runtime.md). An Intern-Decision prompt with 12 to 15 skill options and one-line bilingual descriptions is roughly 450 to 600 tokens. That is about 1 to 1.3 s of prefill per decision at Q4_K_M, plus a handful of grammar-forced decode tokens [computed]; Q8_0 will be somewhat slower [unverified]. The schema comes after the state in this format, so the static options cannot be cached as a prefix without leaving the trained format. Memory: a second resident 0.8B model adds about 0.8 GB at Q8_0 or about 0.53 GB at a self-made Q4_K_M, plus its own KV cache. That is acceptable on a 12 GB S26 and a real cost on low-end phones.

- **(a) Companion on every turn:** no. The phrase router already decides the easy cases precisely, for free. Adding about 1 s and 0.5 to 0.8 GB to every turn buys nothing there.
- **(b) Only on router misses:** yes, test this first. Today a miss costs about 11 s of BotPsy thinking. A decision model at about 1 s that meets the 95% precision bar would cut that by an order of magnitude on exactly those turns. The model can also be loaded lazily on the first miss.
- **(c) Replacing BotPsy's thinking for selection:** the real payoff, gated on (b). Flow: decision model picks the skill (or ask_user / respond) with a confidence, then BotPsy fills only that skill's arguments with thinking off and a one-tool grammar, and CT-02 code resolves times. Keep BotPsy's thinking path as the fallback when the decision is low-confidence (needs probabilities, so on the phone this needs logprobs from QVAC or an upstream request). Measure argument accuracy separately: harness-diagnosis showed thinking helps filling too.
- **(d) Not worth it:** possible, and cheap to find out. The control arm is BotPsy itself, given the identical letter-symbol prompt with thinking off. It costs no extra memory. If it reaches the bar, the "decision model" is just a prompt format and the second model is unnecessary.

**On the ask_user confusion specifically.** Use two fields in one request rather than hoping the skill field handles it:
- `skill`: which action fits (choice over the skills plus `respond`).
- `details`: noul, "Does the message say what to add or do and enough details to do it?"

Route to ask_user when `skill` is an action and `details` is no. Kev's When2Call failure suggests a single choice field will not learn "missing details" on its own.

## Recommended spike

- **Repo:** https://huggingface.co/bombdefuser-124/Intern-Decision-0.8B-GGUF (community conversion of `internlm/Intern-Decision-0.8B`).
- **File:** `intern-decision-0.8b-q8_0.gguf`, 811.8 MB. Skip `mmproj-f16.gguf`.
- **Download:** `hf download bombdefuser-124/Intern-Decision-0.8B-GGUF intern-decision-0.8b-q8_0.gguf --local-dir <models dir>`.
- **Serve:** `llama-server -m intern-decision-0.8b-q8_0.gguf --port 8092 -c 4096` (no `--jinja` needed; we send a raw prompt).
- **Cases:** the residual filter already in `packages/eval/src/embed-check.ts` (cases where `routeIntent(input, firstWinSkills)` returns the whole menu), over `VA_CASES` and `HOLDOUT_CASES`, plus the holdout2 blind set. Report precision of fired skills and the ask_user recall, overall and for es and en separately.
- **Control arm:** the same prompt string against the BotPsy GGUF already used in the eval lab.

**Prompt (raw `/completion`).** Build it exactly like `compile_row` in Intern-Decision's `inference.py`. `{STATE}` is `json.dumps(utterance)` (a quoted JSON string; for multi-turn context use an object such as `{"previous_assistant": "...", "user": "..."}`, which renders as 2-space-indented JSON). Option lines use four spaces of indentation.

```text
<|im_start|>system
You are a careful decision assistant. Use the state and decision schema in the user message to make the requested decisions. For every field, choose exactly one answer symbol (e.g. A, B, C, ...) from its listed options and return one valid JSON object mapping each field name to its chosen symbol. Use the field names and symbols exactly as given. Do not include explanations, Markdown, or extra text.<|im_end|>
<|im_start|>user
Return one answer for every field using the supplied answer symbols.

## State
{STATE}
## Decision schema
skill: Which action fits the user's latest message? The message may be in Spanish or English.
    A = calendar_add: create a calendar event (agendar, añadir al calendario)
    B = calendar_read: read upcoming events
    C = remind: set a reminder (recuérdame, avísame)
    D = reminders_list: list reminders
    E = reminder_cancel: cancel a reminder
    F = read_messages: read messages from a contact
    G = reply_message: reply to a message
    H = remember: save a fact about the user
    I = recall: answer a question about the user's own life from memory
    J = forget: delete a saved fact
    K = respond: no action; answer in words
details: Does the message say what to do and give enough details to do it?
    A = no: The answer is no (negative, or disagree with the claim).
    B = yes: The answer is yes (affirmative, or align with the claim).<|im_end|>
<|im_start|>assistant
<think>

</think>

{
    "skill": "
```

Notes on the prompt:
- Use the real skill ids and descriptions from `packages/skills/src/catalog.ts`; the list above is illustrative.
- `noul` options are `no` then `yes` with the defaults shown (from `_options` in `inference.py`).
- The skeleton is `json.dumps({"skill": "<decision>", "details": "<decision>"}, indent=4)`. The text above stops right before the first `<decision>`.

**Call 1 (skill):**

```json
POST /completion
{"prompt": "<text above>", "n_predict": 1, "n_probs": 64, "temperature": 0, "cache_prompt": true}
```

Take `completion_probabilities[0]`, keep only the symbols `A` to `K`, and renormalize. Renormalizing the softmax over a subset equals the reference's softmax over the candidate logits. Optionally apply T = 2.7478 to get calibrated confidence.

**Call 2 (details):** the same prompt, continued with the literal `<decision>` token for the first field, as a mixed token array (id 248077 from `added_tokens.json`):

```json
{"prompt": ["<text above>", 248077, "\",\n    \"details\": \""], "n_predict": 1, "n_probs": 64, "temperature": 0, "cache_prompt": true}
```

Keep symbols `A` (no) and `B` (yes), then renormalize. The reference scores all fields with every slot still holding `<decision>`, so feeding the token (not the chosen letter) keeps it on format.

Before trusting results, check two things with `POST /tokenize` (`"with_pieces": true`):
- `<|im_start|>` and the other template markers in the string parse as single special tokens.
- Each symbol `A`..`K` is one token.

**On the phone later (QVAC, no logprobs):** pass the system and user messages as `history`, thinking off, with `responseFormat: { type: "json_schema", json_schema: { name: "decision", schema: { type: "object", properties: { skill: { enum: ["A", ..., "K"] }, details: { enum: ["A", "B"] } }, required: ["skill", "details"] } } }`. This gives argmax only. A confidence threshold would need logprobs, which means a QVAC patch or an upstream request.

## Spike results (2026-11-12, measured on the Mac)

Same prompt for both models (`packages/eval/src/decision-check.ts`). It ran on the 100 cases the phrase router misses, from the VA, dev held-out, messaging and memory sets. The blind held-out 2 set was left out, so it stays blind.

| Model | Accuracy | Precision when forcing a skill | ask_user recall |
| :---- | :---- | :---- | :---- |
| BotPsy-0.8B, letter-choice control, thinking off | 23/100 | 15 to 27% (collapses to option A, "remember") | 1/7 |
| Intern-Decision-0.8B, with the details field | 41/100 | 40 to 50% | 4/7 |
| Intern-Decision-0.8B, skill choice only | 40/100 | 44 to 74% (74% only at confidence 0.9 or above, firing on 27 of 100) | 0/7 |

**Verdict: not adopted.** Neither model reaches the 95% precision bar on these cases. Intern-Decision's "enough details?" field also says "no" to complete requests ("my blood type is O+").

On the cases that matter, BotPsy in its native format with thinking does better than either. The speed path is the fast route instead: no thinking when the phrase router is sure, measured on the S26 at 39/40 with a 7.0 s median, against 11.3 s with full thinking.

Revisit if a decision model with Spanish evidence and a When2Call-style evaluation appears.
