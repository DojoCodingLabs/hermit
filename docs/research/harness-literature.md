# Harness effects on small-model tool calling: literature review

Researched 2026-11-11 for Hermit's on-device agent (BotPsy-0.8B, llama.cpp, GBNF grammar). Tags: **[vendor]** = reported by the people who built the model or product; **[indep]** = third party (academic or neutral); **[preprint]** = not peer reviewed, often single author, treat as directional. Numbers come from the cited page; where a page was read only through an abstract it says so.

## Bottom line

1. The harness moves scores as much as the model does. Same model, different scaffold: up to 34 points on SWE-bench Verified Mini, and harness variance exceeded model variance in a controlled grid (https://arxiv.org/html/2605.23950) [indep, preprint].
2. Our harness differs from Tether's on every axis that matters: thinking ON (we run OFF), native Qwen3.5 XML tool calls through the chat template (we use a custom JSON grammar), vLLM BF16 (we run GGUF on llama.cpp), up to 32k new tokens (we cap at 256 when thinking). Tether's numbers do not transfer to our 21/40.
3. A 256-token thinking budget is the worst possible setting for a model trained to think up to 32k: truncated reasoning plus a forced answer. A 1.5B study found 256-token CoT fell to 25% vs 44% with none and 64% with 32 tokens (https://arxiv.org/abs/2604.02155) [preprint]. Our 6/40 fits this pattern.
4. Hard schema constraints can halve small-model tool-call accuracy while keeping 100% validity: Qwen2.5-1.5B went from 91.5% (prompt-only JSON) to 48.0% (hard tool-call schema) (https://arxiv.org/abs/2605.26128) [preprint]. Our full-output grammar is a prime suspect.
5. Constrained decoding mostly repairs syntax; it does not add judgment, and it hurt tool-call abstention by up to 29.5 points on 0.6B to 4B models (https://arxiv.org/abs/2608.13959) [preprint].
6. Highest-expected-impact fix: run BotPsy in its native format (Qwen3.5 chat template, `tools` passed natively, `<tool_call>` XML, tool results in the `tool` role), let it reason, and constrain only the call (lazy grammar or post-hoc validation), not the whole output.
7. Fewer, better-described tools matter for small models: description edits alone shifted tool choice over 10x (https://arxiv.org/abs/2505.18135) [indep, preprint]; tool retrieval let TinyAgent-1.1B reach 80% (https://arxiv.org/html/2409.00608v2) [vendor-academic].
8. 40 cases cannot separate 53% from 70%: 21/40 has a 95% CI of 37.5% to 67.1%. Detecting a 17-point gain needs about 127 independent cases per arm, or about 52 to 106 paired cases (same cases, both harnesses) depending on how often the two disagree.
9. Score each failure by type (wrong tool, wrong args, malformed, wrong abstention, timeout) so harness changes can be attributed; validity alone hides semantic losses.
10. Use BFCL-style AST matching plus irrelevance, When2Call-style abstention and τ-bench pass^k on our own Spanish/English cases; public leaderboards are only a sanity check.

## 1. What Tether's numbers were measured with

Sources: model card https://huggingface.co/qvac/BotPsy-0.8B and blog https://huggingface.co/blog/qvac/botpsy, both [vendor].

| Setting | Tether eval | Hermit harness today |
|---|---|---|
| Thinking | ON for all models ("thinking mode", `enable_thinking=True`; template defaults to non-thinking) | OFF (best) or 256-token budget |
| Max new tokens | Up to 32,768 in evaluation (card); examples use 4096 (Transformers) and 8192 (vLLM) | 256 thinking budget, short answer |
| Engine and weights | vLLM, BF16 safetensors | llama.cpp, GGUF (quantized) |
| Tool format | OpenAI-style schemas through the chat template; Qwen3.5 XML calls (`<tool_call><function=NAME><parameter=NAME>`); vLLM flags `--enable-auto-tool-choice --tool-call-parser qwen3_xml --reasoning-parser qwen3` | Custom `{"choice": skill, "args": {...}}` JSON via GBNF anyOf |
| Tool results | Native template (not described further) | User turn starting "Result:" |
| Sampling | temp 0.3, top_p 0.95, top_k 20, presence_penalty 1.5 | (per our runs) |
| Repeats | Mean of 3 runs (BFCL v4, τ-bench, Claw-Eval), 2 runs (ACEBench, FC mode) | Single run, 40 cases |

Other vendor facts: training ended with RL that rewards format first, then partial credit for tool name, argument names and argument values. RL cut reasoning loops from 22.9% to 1.4% of IFBench attempts and 32k-limit hits from 28.3% to 0.2%, meaning the model is trained to finish its own thinking, not to be cut off. Multilingual instruction following is 72 to 80 for English, Spanish and others; English is "recommended". The card notes benchmarks were not run on GGUF.

Implication: our harness is out of distribution in four ways at once (thinking, format, tool-result role, quantization). Any one could explain part of the gap; an ablation must change one at a time.

## 2. Evidence that the same model scores very differently under different harnesses

**Agent scaffolds (large models, but the cleanest evidence).**
- "Stop Comparing LLM Agents Without Disclosing the Harness" (https://arxiv.org/html/2605.23950) [indep, preprint, position paper] collects: Claude Opus 4.5 on SWE-bench Pro 45.9% (SEAL scaffold) vs 55.4% (Claude Code); Sonnet 4.5 68% vs 34% on SWE-bench Verified Mini (SWE-Agent vs HAL Generalist, from the Holistic Agent Leaderboard); Terminal-Bench 2 GPT-5.4 69.7% to 77.0% from harness evolution only; Epoch AI scaffold-only variation up to 11 points (GPT-5) and 15 points (Kimi K2 Thinking). In their own factorial on 100 SWE-bench Verified tasks, harness H1 to H3 moved each model 8.5 to 13 points while swapping models within a harness moved 2.5 to 5 points, with six ranking reversals in nine comparisons.
- Vercel cut an internal agent from 17 tools to a bash tool plus SQL: 4/5 to 5/5 success, 3.5x faster (https://vercel.com/blog/we-removed-80-percent-of-our-agents-tools) [vendor, n=5, anecdotal].

**Function-calling mode.**
- BFCL lists FC (native tool calling) and Prompt (text workaround) as separate rows for the same model, and scores differ (https://gorilla.cs.berkeley.edu/leaderboard.html) [indep]. Example: Qwen2.5-3B-Instruct 91.5% Prompt vs 96.0% FC on one simple subset, as reported in the Bielik 11B v2 report (https://arxiv.org/pdf/2505.02410) [indep].
- BFCL v4 format sensitivity (26 variants, 39 models): smaller models scored higher with Python or JSON output than XML; JSON function docs scored highest for nearly all models; requiring `<TOOLCALL>` tags hurt small models significantly; some tool-tuned 70B models collapsed to near zero under a non-native format (https://gorilla.cs.berkeley.edu/blogs/17_bfcl_v4_prompt_variation.html) [indep]. Lesson: tool-tuned models are brittle outside the format they were tuned on.

**Format restrictions and constrained decoding.**
- "Let Me Speak Freely?" found reasoning drops under format restrictions, JSON-mode worst, while classification can improve; NL-then-format kept near-unrestricted accuracy (https://arxiv.org/abs/2408.02442) [indep].
- dottxt's rebuttal argues the prompts differed between conditions and that structured generation done properly matches or beats unstructured (https://blog.dottxt.ai/say-what-you-mean.html) [vendor: dottxt sells Outlines]. Both are frontier-ish models on reasoning tasks, not sub-1B tool calling.
- JSONSchemaBench (10K real schemas; Guidance, Outlines, llama.cpp, XGrammar, OpenAI, Gemini): constrained decoding can speed generation about 50% and slightly raised GSM8K (LM-only 80.1%, llama.cpp 82.4%, Guidance 83.8%); engines differ in schema coverage (https://arxiv.org/abs/2501.10868) [indep, Guidance authors involved].
- Grammar-Aligned Decoding: standard grammar-constrained decoding distorts the model's distribution, producing grammatical outputs with likelihoods not proportional to the model's (https://arxiv.org/abs/2405.21047) [indep, NeurIPS 2024].
- The Constraint Tax (Qwen2.5-0.5B, 1.5B, SmolLM2-1.7B): hard schema raised validity 61.5% to 100% but cut answer accuracy 19.7% to 11.0%; on a calendar tool-call task Qwen2.5-1.5B fell 91.5% to 48.0% under a hard tool-call schema, both 100% valid. Recommends "reason free, constrain late" (https://arxiv.org/abs/2605.26128) [preprint, single author].
- Constrained decoding on 0.6B to 4B models (Outlines, XGrammar, 14 tasks): validity 78.6 to 92.9% rose to 100%, but multi-step function calling stayed a semantic failure (https://arxiv.org/abs/2609.23742) [preprint, single author].
- Repair, Not Improvement (0.6B to 4B, English and Korean): grammar plus stop-at-first-line hurt abstention accuracy in 4 of 6 cells, worst -29.5 points; on items that need a tool the effect was positive. "What the restriction gives back is readable output, not judgment" (https://arxiv.org/abs/2608.13959) [preprint, single author].
- Thinking Before Constraining: let the model reason freely, then switch to constrained decoding at a trigger token; reports large gains with few extra tokens (https://arxiv.org/abs/2601.07525) [indep, gains not verified beyond summaries].
- XGrammar-2 reports grammar-constrained decoding raising BFCL results for most models, mainly by eliminating invalid outputs (https://arxiv.org/pdf/2601.04426) [vendor: XGrammar authors].

**Thinking budgets.**
- Brief Is Better (Qwen2.5-1.5B, 200 BFCL v3 Multiple tasks): 0 tokens 44.0%, 32 tokens 64.0%, 256 tokens 25.0% (p < 0.001). At 256 tokens wrong-function selection rose to 28% and hallucinated functions to 18%. 88.6% of solvable tasks need at most 32 reasoning tokens. A structured brief CoT ("Function: name / Key args: ...") matched 32-token CoT with 0% hallucinated functions (https://arxiv.org/abs/2604.02155) [preprint, single author]. Caveat: Qwen2.5 is not a trained thinker; BotPsy is, so its curve may differ.
- Small Qwen3 and Qwen3.5 thinking variants sometimes never close the think tag; a report calls them hard to deploy in thinking mode without a cap (https://arxiv.org/pdf/2605.31268) [indep, Mellum2 report]. Budget-dependent rankings: truncation distorts accuracy and model order (https://arxiv.org/pdf/2608.12150) [preprint].
- llama.cpp exposes `--reasoning-budget` (-1 unrestricted, 0 immediate end, N tokens) (https://github.com/ggml-org/llama.cpp/blob/master/tools/server/README.md) [indep]. A hard cut leaves the model mid-thought; it was never trained to answer from there.

**Chat template and serving stack.**
- vLLM's Kimi K2 debugging found most tool-call failures came from template application bugs, not the model (https://vllm.ai/blog/Kimi-K2-Accuracy) [indep engine team].
- Qwen docs: "We recommend using Hermes-style tool use for Qwen3 to maximize function calling performance"; avoid stopword templates like ReAct for reasoning models because stopwords can appear in thoughts; malformed calls still happen, so parse defensively (https://qwen.readthedocs.io/en/latest/framework/function_call.html) [vendor]. Note BotPsy (Qwen3.5) uses the XML `qwen3_xml` format, not Hermes JSON (model card).
- llama.cpp: native tool-call handlers per family, generic fallback "may consume more tokens and be less efficient", and aggressive KV quantization (e.g. `-ctk q4_0`) "can substantially degrade" tool calling (https://github.com/ggml-org/llama.cpp/blob/master/docs/function-calling.md) [indep].
- Serving-stack confounds (server refusing a tool request recorded as model declining) are a known eval pitfall (https://agentpatterns.ai/patterns/anti-patterns/serving-stack-confound-tool-call-evaluation/) [indep blog].

**Tool count and descriptions.**
- Tool-DC: tool-calling accuracy on BFCL and ACEBench falls as candidate tools grow; a training-free try-check-retry split gives up to +25.1% average (https://arxiv.org/abs/2603.11495) [indep, abstract only].
- Editing only tool descriptions raised a tool's selection over 10x (GPT-4.1, Qwen2.5-7B) (https://arxiv.org/abs/2505.18135) [indep]. Learned description rewriting cut degradation at 150+ tools (https://arxiv.org/html/2602.20426) [preprint]. EASYTOOL: concise standardized tool docs help (https://arxiv.org/pdf/2401.06201) [indep].

**Few-shot vs zero-shot.**
- Small Models, Big Tasks (xLAM data, 1.3B to 3.8B base/instruct models not tuned for tools): Deepseek-coder-1.3B task accuracy 1.1% zero-shot, 55.7% with 3 examples, 85.4% fine-tuned; Phi-3-mini 0% zero- and few-shot, 87.3% fine-tuned (https://arxiv.org/html/2504.19277v1) [indep]. Few-shot helps untuned models a lot but inconsistently; for a tool-tuned model like BotPsy the main value is showing the native format and Spanish phrasing, not teaching the skill.

**Retries and repair.**
- After a tool error, small models often loop on repeated invalid calls instead of reading the feedback (Fission-GRPO, https://arxiv.org/html/2601.15625v1) [preprint]; recovery plateaus in later attempts (PRFC, https://aclanthology.org/2026.findings-emnlp.1762.pdf) [indep]. A single invalid call dropped a student SLM from 73.2% to 43.4% (MENTOR, https://arxiv.org/pdf/2510.18383) [preprint]. Implication: one structured retry with a short, specific error is worth testing; open-ended retry loops are not.

## 3. Small models and on-device agents

- **TinyAgent (Berkeley):** LLMCompiler planning plus a learned Tool RAG classifier; TinyAgent-1.1B 80.06% success vs GPT-4-Turbo 79.08% on its Mac task set, base TinyLlama 12.71%; tool RAG recall 0.998 with shorter prompts (https://arxiv.org/html/2409.00608v2, https://huggingface.co/squeeze-ai-lab/TinyAgent-1.1B) [authors, academic]. Lesson: fine-tune plus fewer tools in the prompt.
- **Octopus v2 (Nexa):** functional tokens make tool choice a single-token decision and cut context by over 95%; claims 98%+ accuracy (https://arxiv.org/html/2404.01744v5) [vendor]. Lesson: for a fixed skill menu, choosing the skill can be a classification step.
- **FunctionGemma 270M / Mobile Actions:** base 58%, fine-tuned 85% on Mobile Actions (https://deepmind.google/models/gemma/functiongemma/) [vendor]; Google frames fine-tuning as the path to "consistent, deterministic behavior" over zero-shot (https://ai.google.dev/gemma/docs/functiongemma) [vendor].
- **Hammer (1.5B to 7B):** function masking (randomizing names so the model reads descriptions) plus 7,500 irrelevance examples improves robustness across benchmarks (https://arxiv.org/abs/2410.04587) [indep, ICLR 2025]. Lesson: small models over-rely on names; clear descriptions and irrelevance data matter.
- **xLAM-2 1B and 3B fc-r** (Qwen2.5 based, on-device "Tiny Giant") (https://www.salesforce.com/blog/xlam-large-action-models-v2/) [vendor]. TinyLLM's BFCL run: xLAM-2-3b-fc-r 65.74% overall, Qwen3-4B (Prompt) 62.04%, 1.1B models about 19.7% with zero multi-turn (https://huggingface.co/papers/2511.22138) [indep, internal inconsistencies noted].
- **CPU reliability of sub-2B tool calling:** no rigorous public study found. Artificial Analysis runs a mobile benchmark set with a 640-task BFCL subset (https://artificialanalysis.ai/methodology/mobile-device-benchmark-set) [indep]. Anecdotes (e.g. a 26M model beating Qwen3-0.6B on 50 CPU queries, https://aiweekly.co/alerts/needle-26m-beats-qwen3-06b-on-cpu-tool-calling) are not evidence.

## 4. Evals that measure harness quality

| Eval | Measures | Use for Hermit |
|---|---|---|
| BFCL v3/v4 (https://gorilla.cs.berkeley.edu/leaderboard.html) | AST match on function name, arg names, arg values (type-aware); multi-turn; irrelevance (decline when no tool fits); v4 adds web search, memory, format sensitivity | Copy the AST scorer and irrelevance category for our cases; run a BFCL subset once for both harnesses as an external check |
| τ-bench / τ²-bench (https://arxiv.org/abs/2406.12045, https://arxiv.org/abs/2506.07982) | End-state DB match after a simulated-user conversation; pass^k = succeeds on all k trials. gpt-4o retail about 61% pass^1, under 25% pass^8 | Report pass^3 on our cases at temp 0.3: reliability, not peak |
| When2Call (https://arxiv.org/abs/2504.18851) | Choice among tool call, follow-up question, "can't answer", direct answer; macro F1 | Our `ask_user` / `respond` decisions |
| ToolSandbox (https://arxiv.org/html/2408.04682v1) | Stateful tools, implicit dependencies, user simulator | Multi-step reminder and settings flows |
| ACEBench (https://arxiv.org/html/2501.12851v8) | Normal, Special (ambiguous or incomplete), Agent | "Special" category mirrors missing-argument cases |
| NESTFUL (https://arxiv.org/pdf/2409.03797v3) | Nested calls where outputs feed inputs | Chained skills |
| JSONSchemaBench (https://arxiv.org/abs/2501.10868) | Engine coverage and efficiency of constrained decoding | Check our GBNF engine handles our schemas |

**Metrics to record per case:** tool name exact match; argument exact match (normalized, per argument); full-call exact match; abstention correctness (precision and recall on "should not call"); format validity; wrong-but-valid rate (validity can hide semantic loss, per the Constraint Tax); pass^k; latency to first token and to finished call; tokens generated; loop or truncation rate.

**Running a harness ablation properly.**
- Change one factor at a time from a fixed base, same cases, same GGUF, same seed list; log the full prompt string actually sent (template bugs are a top failure source, per the vLLM Kimi post).
- Disclose the harness (template, tool schema style, grammar, budget, retries, sampling) as the Harness Card proposes (https://arxiv.org/html/2605.23950).
- Compare harnesses with paired per-question differences and clustered standard errors when cases share a template or skill; resample answers to reduce variance; plan sample size with a power analysis (Anthropic, "Adding Error Bars to Evals", https://arxiv.org/abs/2411.00640) [vendor-academic]. For two harnesses on the same 40 cases use McNemar's test on discordant cases.

**Sample size, computed for our numbers (Wilson 95% intervals; two-sided alpha 0.05, power 0.8).**
- 21/40 = 52.5%, CI 37.5% to 67.1%. 6/40 = 15%, CI 7.1% to 29.1%. The thinking-256 drop is real; small differences are not.
- 28/40 (70%) has CI 54.6% to 81.9%, overlapping 21/40. 40 cases cannot tell 53% from 70%.
- Independent samples: about 127 cases per arm to detect 53% vs 70%.
- Paired (same cases, both harnesses), McNemar: about 52 cases if 20% of cases flip between harnesses, 65 at 25%, 79 at 30%, 106 at 40%.
- Practical target: 120 to 200 cases, stratified by skill, language (es/en) and "should not call", run 3 times each at the recommended sampling; report pass^1, pass^3 and per-stratum counts.

## 5. Best practices for a sub-1B tool-calling model, ranked by expected impact

1. **Use the model's native format end to end.** Chat template from the GGUF with tools passed natively, Qwen3.5 `<tool_call>` XML, tool results in the `tool` role (rendered by the template), not "Result:" user turns. Evidence: BFCL v4 format sensitivity collapses for tool-tuned models off-format; BotPsy's RL rewarded its own format; Qwen docs; vLLM template bugs. Expected impact: large.
2. **Do not constrain the whole output; constrain late or validate after.** Let the model emit free text or thinking, then enforce the grammar only inside the tool call (lazy grammar triggered at `<tool_call>`; verify your llama.cpp build supports it for this template) or parse and validate post hoc. Evidence: Constraint Tax (91.5% to 48.0%), Repair Not Improvement (abstention -29.5), Grammar-Aligned Decoding, Thinking Before Constraining. Expected impact: large.
3. **Fix thinking: never truncate mid-thought.** Test thinking OFF vs thinking ON with a generous cap (e.g. the vendor's 4096 to 8192, with a wall-clock timeout) vs a short structured pre-call line ("skill: X / args: ..."). Evidence: Brief Is Better (256 tokens worst); BotPsy trained to finish its own thinking; Mellum2 on unclosed think tags. Latency is the real constraint; measure tokens per case. Expected impact: large, direction uncertain for BotPsy.
4. **Use the vendor sampling** (temp 0.3, top_p 0.95, top_k 20, presence_penalty 1.5), especially with thinking ON, where the penalty fights loops. Evidence: model card [vendor]. Also avoid aggressive KV-cache quantization (llama.cpp docs). Expected impact: medium.
5. **Offer fewer tools per turn.** Route to a small candidate set (keyword or embedding tool retrieval, or a first-stage skill classifier) before argument filling. Evidence: TinyAgent Tool RAG, Tool-DC, Octopus functional tokens, Vercel. Expected impact: medium to large as the skill menu grows.
6. **Write tool descriptions for the model.** One-line purpose, when to use and when not to, argument formats with examples, Spanish trigger phrases; distinct names for similar skills. Evidence: 10x selection shift from descriptions alone; Hammer function masking; EASYTOOL. Expected impact: medium.
7. **Add an explicit abstain path and measure it.** `respond` and `ask_user` as real tools, plus irrelevance cases in the eval. Evidence: BFCL irrelevance, When2Call, Hammer irrelevance data; BotPsy reports strong hallucination scores in its native setup. Expected impact: medium.
8. **One structured retry, then stop.** On invalid name or missing required argument, return a short specific error in the tool role and allow one more attempt; never loop. Evidence: Fission-GRPO, PRFC, MENTOR (small models loop on errors). Expected impact: small to medium.
9. **Few-shot only to show format or language, kept short.** For a tool-tuned model, 1 to 3 native-format examples (one Spanish) at most; they cost context and latency on a phone. Evidence: Small Models, Big Tasks (helps untuned models). Expected impact: small for BotPsy, test it.
10. **Fine-tune if the harness ceiling is too low.** FunctionGemma 58% to 85%, Small Models Big Tasks 1% to 85%, TinyAgent 13% to 80%. Expected impact: large, highest cost.

## 6. Suggested ablation order for Hermit (one factor per run, same cases)

A. Current harness (baseline, 21/40). B. Native template and native tool format, thinking OFF, no grammar, post-hoc parse. C. B plus lazy grammar inside the call. D. B with thinking ON and a large cap. E. Best of B to D with tool results in the `tool` role vs "Result:". F. Best so far with tool retrieval to top-k skills. G. Best so far with rewritten descriptions. Each on 120+ stratified cases, 3 runs, paired McNemar against the previous winner, with latency recorded.

## Gaps

- No controlled study of BotPsy or Qwen3.5-0.8B with thinking budgets between 0 and 32k; the 1.5B curve is from a non-thinking base model.
- No rigorous public CPU or GGUF reliability study for sub-2B tool calling; quantization effects on BotPsy are unmeasured (Tether evaluated BF16 only).
- Several key constrained-decoding results are recent single-author preprints read at abstract level; replicate on our cases before relying on them.
