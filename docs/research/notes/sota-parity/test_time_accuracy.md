# Test-time (no retraining) accuracy techniques for small LLMs (0.5B-4B) on tool calling and short assistant tasks

Scope note: several key questions had no controlled study at the 0.5B-1B scale. Those are marked in Gaps instead of being filled from memory. Model-size applicability is marked on each finding: [<=1B], [1-4B], [>7B only], [size unknown].

## 1. Constrained / structured decoding (GBNF, XGrammar, llguidance, Outlines), the format tax, think-then-constrain

### Takeaway
On classification-like outputs (choosing a tool, picking a label), constraints help or are neutral. The "format tax" shows up mainly when a strict grammar removes room to reason. The fix with the best evidence is to let the model reason first (free text or a thinking block), then apply the constraint only to the final call. This is CRANE, or "NL-to-Format". Hermit's current setup (thinking, then XML call, then grammar only as a fallback) already matches this pattern.

### Cited Findings
- "Let Me Speak Freely?" (Tam et al., EMNLP 2024 Industry): reasoning accuracy declines significantly under format restrictions, and stricter constraints degrade more. JSON-mode constrained decoding *enhances classification task accuracy* while hurting reasoning. The two-step NL-to-Format approach (answer in natural language, then convert) roughly preserves free-text performance. [size: mixed; mostly 7B+ and API models] — [arXiv 2408.02442](https://arxiv.org/html/2408.02442v3); [ACL Anthology](https://aclanthology.org/2024.emnlp-industry.91.pdf)
- dottxt rebuttal "Say What You Mean" (Will Kurt, Nov 2024) argues the paper conflated JSON-mode with real structured generation and under-prompted the structured runs. With fixed prompts, structured generation matched or beat unstructured output. — [dottxt blog](https://blog.dottxt.ai/say-what-you-mean.html)
- Independent replication (Dylan Castillo): the rebuttal's results held for Llama-3-8B-Instruct but not for GPT-4o-mini, so the outcome depends on the model and the task. [~8B and API] — [dylancastillo.co](https://dylancastillo.co/posts/say-what-you-mean-sometimes.html)
- BoundaryML calls the Tam et al. paper "fundamentally flawed" but still holds that the core claim (structured outputs can degrade quality) stands. This is a vendor opinion. — [BoundaryML](https://boundaryml.com/blog/structured-outputs-create-false-confidence)
- JSONSchemaBench (2025) covers 10K real-world schemas and compares Guidance, Outlines, llama.cpp, XGrammar, OpenAI and Gemini. v1 reports that constrained decoding improves downstream task accuracy by up to 4%, even on GSM8K. It also reports up to 50% faster generation from constrained decoding, and finds Guidance best on efficiency, coverage and quality. I saw the 4% claim only in v1 snippets. — [arXiv 2501.10868](https://arxiv.org/html/2501.10868v2)
- CRANE (Banerjee et al., ICLR/ICML 2025) argues theoretically that a grammar allowing only final answers removes the intermediate steps needed to compute them. Adding a reasoning prefix to the grammar recovers reasoning while keeping outputs valid. It reports up to +10 points over both constrained and unconstrained baselines on GSM-Symbolic and FOLIO. [model sizes not confirmed in my sources] — [arXiv 2502.09061](https://arxiv.org/html/2502.09061v3); [ICML poster](https://icml.cc/virtual/2025/poster/43624)
- Counterpoint for small models: "Small Reasoning Models are Instruction Followers in Function Calling" (Taheri et al., arXiv 2608.22472, 2026 preprint) argues that native tool-call formats (special tags plus rigid JSON) cause formatting errors and hallucinations in small models. Its prompt-based "instruction-followed" framing (IFFC) beat native function calling (NFC) across Qwen3 0.6B-8B and Phi-4-mini. Example: Phi-4-mini went from about 30% (NFC, BFCL Live) to 44.3% (IFFC). [0.6B-8B] — [arXiv 2608.22472](https://arxiv.org/pdf/2608.22472)
- The same paper finds that plain prompt-based function calling (PFC) without its decoupling collapses on complex cases. Gemma-3 4B with PFC drops to near 0% on BFCL "Parallel Multiple". [1-4B] — [arXiv 2608.22472](https://arxiv.org/pdf/2608.22472)

### Inferences
- For Hermit's router-forced calls (a known tool, only arguments to fill), constraining the tool name and argument skeleton is low-risk. It is close to a classification task, which is where Tam et al. found constraints help.
- The risk is concentrated where the model must decide something (recall vs decline, ask vs act). Do not force a grammar there before the model has reasoned. Use reasoning first, then a constrained final, as CRANE and NL-to-Format do.
- The IFFC result suggests an A/B test worth running: a plain instruction prompt ("Answer with one line: TOOL=<name> ARGS=...") against native Qwen XML tool tags, for the 0.8B on router misses. The paper is a preprint with some odd baseline numbers (Claude 4.5 Sonnet at 72.6% on BFCL Simple), so it needs independent confirmation.
- Compute cost on a phone: grammar masking in llama.cpp is cheap per token. Of the papers above, only JSONSchemaBench measured speed, and it found constrained decoding was up to 50% faster. The cost of think-then-constrain is the thinking tokens themselves.

### Gaps
- No controlled study found of the format tax specifically at 0.5B-1B on tool calls.
- No published head-to-head of GBNF (llama.cpp) vs XGrammar vs llguidance accuracy on small models. JSONSchemaBench is the closest, but my sources gave no per-small-model breakdown.

## 2. Self-consistency, best-of-N, voting, logprob confidence, abstention and escalation, verifiers and PRMs

### Takeaway
Majority voting only helps when a single sample is already right more than 50% of the time. On hard cases for a small model it can lower accuracy, and router misses are exactly those hard cases. Token-probability confidence on the tool call is cheap, since it comes free from one forward pass. It is useful for deciding when to abstain, ask, or escalate, especially with a small calibrator on top. I found no paper measuring self-consistency specifically on function calling at small scale.

### Cited Findings
- SLM-MUX (arXiv 2510.05077) gives a binomial argument: self-consistency raises accuracy only when single-sample accuracy p > 0.5, and can lower it when p < 0.5. — [arXiv 2510.05077](https://arxiv.org/pdf/2510.05077)
- "When Self-Consistency Backfires" (COLM 2026 workshop preprint): on GPQA-Diamond, majority vote lowered per-problem accuracy on 56.6% of problems for Qwen2.5-7B and 65.7% for Llama-3-8B. This is science QA, not tool use. [7-8B] — [arXiv 2608.11403](https://arxiv.org/pdf/2608.11403)
- MICE for CATs (arXiv 2504.20168) computes confidence from the product of token probabilities in the generated tool call, excluding formatting tokens, plus model-internal features fed to a learned classifier. It introduces Expected Tool-Calling Utility (ETCU), improves utility in medium- and high-risk settings, and generalizes zero-shot to new APIs. [size not confirmed in my sources] — [arXiv 2504.20168](https://export.arxiv.org/pdf/2504.20168); [review](https://www.themoonlight.io/review/mice-for-cats-model-internal-confidence-estimation-for-calibrating-agents-with-tools)
- Raw-logit baseline: exp(mean log-prob of the generated tokens) used as a tool-call confidence score. — [arXiv 2503.06708](https://arxiv.org/pdf/2503.06708)
- HCMA (hierarchical chains with multi-level abstention) uses model-intrinsic uncertainty, Platt-scaled token probabilities, to delegate queries from small to large models. It targets general QA. — [arXiv 2410.02173](https://ar5iv.labs.arxiv.org/html/2410.02173)
- ThinkBrake (below) tested "Confidence-of-<tool_call>" as a stopping rule on Qwen3-4B-Thinking. Average accuracy dropped from 89.6 to 82.0 (BFCL non-live). Using raw confidence at one point as a hard decision rule was worse than the baseline. [4B] — [arXiv 2510.00546](https://arxiv.org/html/2510.00546v1)
- A practitioner blog says Gusto filters outputs by token log-probability: 76% accuracy for high-confidence outputs vs 45% for low-confidence ones. This is anecdotal and unverified. — [tianpan.co](https://tianpan.co/blog/2026-04-16-llm-confidence-calibration-production)
- Verifier-gated voting ("only verified samples vote") is recommended by practitioners. I found no measured tool-calling results for it. — [understandingdata.com](https://understandingdata.com/context-engineering-dictionary/self-consistency/)

### Inferences
- For Hermit, the cheapest useful signal is the logprob of the tool-name tokens, or of the first decision token (call / ask / decline), from the single greedy pass. Use it as a gate. Below a threshold calibrated on the eval set, fall back to the fixed clarifying question rather than acting. This addresses "asking vs acting" at near-zero cost.
- Choose candidates by scoring, not sampling. Score the K router-shortlisted tool names (teacher-forced logprob of each name after the same prefix, with the KV cache shared). This is cheaper than N full samples and avoids the p<0.5 voting trap. It needs only K short continuations.
- Full self-consistency (N=5 samples with thinking) costs about 5x decode on a phone. Given the p<0.5 argument, it is unlikely to fix router misses, where the model is mostly wrong.
- The 41/100 result from the Intern-Decision-0.8B letter-choice spike fits this picture. A second sub-1B model voting on cases the first one finds hard is the p<0.5 regime.

### Gaps
- No small-model (<4B) measurement found for self-consistency or best-of-N on BFCL or When2Call.
- No small process reward model for tool calls suitable for a phone was found. ToolCritic (section 6) is a trained critic, so it does not count as test-time.
- No published numbers found for "vote on first token only".

## 3. Thinking budgets: does reasoning help or hurt 0.5B-1B on tool use?

### Takeaway
The evidence is mixed but leans positive for the smallest Qwen3 models. Thinking roughly doubled Qwen3-0.6B tool-call accuracy in one 2026 preprint, and made it much more robust to Q4 quantization. Thinking also overthinks: small reasoning models often reach the right call and then overwrite it. A 256-token budget with early stopping is the cheap middle ground.

### Cited Findings
- Taheri et al. (arXiv 2608.22472, 2026 preprint, IFFC framework, BFCL v3): Qwen3-0.6B Live accuracy goes from 22.9% (NoThink) to 57.7% (Think). Qwen3-4B goes from 74.6% to 86.7%. [0.6B, 4B] — [arXiv 2608.22472](https://arxiv.org/pdf/2608.22472)
- Same paper, quantization (Table 1, BFCL v3 Non-Live, FP16 -> Q4_K_M):

  | Model | FP16 | Q4_K_M |
  |---|---|---|
  | Qwen3-0.6B NoThink | 62.3% | 16.8% |
  | Qwen3-0.6B Think | 76.4% | 69.2% |
  | Qwen3-1.7B NoThink | 82.8% | 80.5% |
  | Qwen3-1.7B Think | 82.8% | 82.9% |
  | Qwen3-4B Think | 94.1% | 93.5% |
  | Gemma-3 1B | 23.9% | 8.7% |

  The 1.7B values come from my reading of the extracted table columns and should be re-checked against the PDF. Takeaway: at 0.6B, quantization badly hurts non-thinking mode, and thinking mostly protects it. [<=1B, 1-4B] — [arXiv 2608.22472](https://arxiv.org/pdf/2608.22472)
- ThinkBrake (Oh et al., NeurIPS 2025) studied Qwen3-4B-Thinking-2507 on BFCL single-turn. Small reasoning models reach a correct call, then keep reasoning and overwrite it. Results:
  - Oracle stopping raises accuracy from 85.8% to 94.2% and cuts 80-94% of tokens. This is an upper bound.
  - ThinkBrake (stop when the log-prob margin between </think> and the top token at sentence boundaries is small): non-live 89.6 -> 89.8 with -24.9% tokens; live 82.9 -> 82.4 with -15.3% tokens.
  - NoWait: 87.9 (-54.8% tokens). ThinkLess (no thinking): 87.7 non-live, 75.5 live.
  - The paper's tables are internally inconsistent: the Table 1 and Table 2 baselines differ.

  [4B only; no sub-4B tested] — [arXiv 2510.00546](https://arxiv.org/html/2510.00546v1); [NeurIPS](https://neurips.cc/virtual/2025/126684)
- AgentProcessBench: Qwen3-8B in reasoning mode has +6.1% StepAcc and +5.3% FirstErrAcc over its non-reasoning mode. [>7B only] — [arXiv 2603.14465](https://arxiv.org/pdf/2603.14465)

### Inferences
- For a Qwen3.5-0.8B fine-tune at Q4 on a phone, the IFFC table argues for keeping thinking on for decision-heavy turns (recall vs decline, ask vs act), where the quantization penalty to non-thinking mode is worst.
- Thinking can be skipped where the router already forces a tool and only arguments remain. The deterministic normalizers already cover much of that.
- ThinkBrake's stopping rule is implementable in llama.cpp with a custom sampler. At each sentence boundary, compare logp(</think>) to the top token's logp and inject </think> when the margin is small. It costs one logit lookup per sentence. Expected gain: tokens (latency) rather than accuracy.
- ThinkBrake's live-split data shows ThinkLess losing 7.4 points while NoWait loses less than 1. Short thinking is better than none, which supports the 256-token budget over NoThink.

### Gaps
- No s1-style budget forcing ("Wait" injection) results found for tool calls at <1B.
- No Qwen3.5-0.8B-specific thinking vs non-thinking tool numbers found.
- The 2608.22472 preprint's IFFC setup is not standard BFCL scoring, so its absolute numbers are not leaderboard-comparable.

## 4. Prompting for SLMs: dynamic few-shot, tool descriptions, fewer tools, language pinning

### Takeaway
"Fewer tools" has real evidence (Less-is-More: up to 70% faster execution and 40% less power on edge, plus better success). Hermit's router-based narrowing is the right approach. Dynamic kNN few-shot retrieval of solved exemplars is widely recommended and shows large gains in practitioner reports. I found no rigorous small-model paper on it, and retrieving poor examples can hurt.

### Cited Findings
- Less-is-More (Paramanayakam et al., DATE 2025), fine-tuning-free. The model first states which tools it needs, and similarity search maps that onto real tools, so only a subset is shown. Results on edge devices: up to 70% less execution time, up to 40% less power, and higher agentic success. It is motivated by small or quantized models lacking function-calling ability. — [arXiv 2411.15399](https://arxiv.org/html/2411.15399v1)
- DTDR (Qualcomm, arXiv 2512.17052) uses dynamic tool-dependency retrieval and reports +23% to +104% function-calling success. It retrieves tools, not exemplars. — [arXiv 2512.17052](https://arxiv.org/pdf/2512.17052)
- In SAAG, below 4B, solve rate at a 5/10/15-tool registry is used as a variable (averaged in my source). The direct-inference baselines were 0.615-0.726, which is the cost of choosing among 5-15 tools at about 3B. — [alphaxiv 2607.18245](https://www.alphaxiv.org/abs/2607.18245)
- LangChain tool-calling few-shot experiments, as summarized secondhand: a small model (Claude 3 Haiku) gained a lot from few-shot examples and approached larger models' zero-shot results. Semantically similar examples helped most. — [plushcap summary of LangChain blog](https://www.plushcap.com/content/langchain/blog/langchain-few-shot-prompting-to-improve-tool-calling-performance-1)
- Practitioner blog (Apr 2026) claims 11% -> 75% tool invocation for a smaller model with 3 semantically matched examples. It also reports regressions: back to zero-shot accuracy at 8 shots, and 35% at 2 shots with TF-IDF selection. These figures are unverified and not primary. — [tianpan.co](https://tianpan.co/blog/2026-04-12-dynamic-few-shot-retrieval-static-examples-accuracy)
- Taheri et al. report "context pollution": complex API schemas in a single monolithic prompt interfere with reasoning. Decoupling tool selection into its own short context, without the conversation's long outputs, improved small-model accuracy. — [arXiv 2608.22472](https://arxiv.org/pdf/2608.22472)

### Inferences
- For Hermit's router misses (free-form phrasings), the cheapest high-value add is a bank of solved router-miss cases (phrase -> tool call), retrieved by a small embedding model and injected as 2-3 exemplars. Keep k small, since the reported regressions came at 8 shots and with lexical retrieval.
- Language pinning: no source found, see Gaps. Exemplars in the user's language are plausibly the strongest pin.

### Gaps
- No rigorous paper found on tool-description engineering, schema field ordering, or instruction position for <4B models.
- No measured study found on language pinning or mixing at small scale.
- The original LangChain post's exact numbers were not retrieved (only a secondary summary).

## 5. Embedding / classifier routers vs LLM routing

### Takeaway
Efficient classifiers route about as well as LLMs at a small fraction of the latency. The pattern with the most support is a hybrid: an encoder or SetFit classifier first, escalating to the LLM only when confidence is low. One study puts this within 2% of a pure LLM at 50% less latency. Few-shot SetFit is noticeably weaker than full fine-tuning when there are many intents.

### Cited Findings
- Guarded Query Routing (arXiv 2505.14524): efficient text classifiers perform comparably to LLM-based routing at drastically lower latency. — [arXiv 2505.14524](https://arxiv.org/pdf/2505.14524)
- "Intent Detection in the Age of LLMs" (arXiv 2410.01627): a hybrid where uncertain SetFit predictions go to an LLM comes within 2% of native-LLM accuracy at about 50% less latency. — [arXiv 2410.01627](https://arxiv.org/html/2410.01627v1)
- SetFit at 8 shots per class: 77.9% on BANKING77 (77 intents), 85.9% on CLINC150. Full-data BERT-base reaches about 93-97% on similar intent sets. — [arXiv 2602.18922](https://arxiv.org/pdf/2602.18922); [arXiv 2311.06102](https://arxiv.org/pdf/2311.06102.pdf)
- Fine-tuned BERT-family classifiers beat zero-shot GPT-4o, Llama-3.3-70B and Mistral Small 3 by about 10-25 points on Banking77. [comparison against >7B LLMs] — [ASRJETS](https://www.asrjetsjournal.org/American_Scientific_Journal/article/download/12048/2893/28507)
- vLLM Semantic Router (fine-tuned ModernBERT intent classifier in front of a model) reports +10.2 points on MMLU-Pro, -47.1% latency and -48.5% tokens vs direct inference. This routes between models, not tools. [>7B target models] — [vLLM blog](https://vllm.ai/blog/2025-09-11-semantic-router)
- A practitioner claims raw embedding-similarity routing has an 8-15% error rate vs 2-5% for strong LLM classification. This is unverified with no methodology. — [besthub.dev](https://www.besthub.dev/articles/llm-semantic-routing-explained-model-based-intent-classification-and-three-keyword-matching-pitfalls-94ef5a5ea296)

### Inferences
- Hermit has a small, fixed tool set and an eval corpus of router misses. A SetFit or linear head on a small multilingual encoder (multilingual-e5-small or EmbeddingGemma), trained on phrase -> tool pairs, is the obvious second router stage. It sits between the phrase router (high precision) and the LLM (fallback). This is cheap supervised training of a separate classifier, not retraining the LLM.
- With a handful of intents, few-shot SetFit should beat its 77-intent BANKING77 numbers. This is untested, so verify it on Hermit's router-miss set before trusting it.
- The same embeddings can drive the kNN exemplar retrieval in section 4. One encoder pass serves both uses.
- The encoder's softmax margin gives a calibrated "unsure" signal for ask-vs-act escalation.

### Gaps
- No on-phone latency measurements found for multilingual-e5-small or EmbeddingGemma in my sources. The <20 ms target is plausible for a ~100M encoder but unverified here.
- No head-to-head found of the semantic-router library against SetFit.

## 6. Self-correction / reflection loops for small models

### Takeaway
Self-correction with no external signal does not help small models and can hurt. Loops fed by external, structured feedback (schema or validation errors) raise solve rate meaningfully at about 3B, typically converging in 2-3 iterations. They can reduce precision, because more retries lead to more spurious calls.

### Cited Findings
- SAAG (arXiv 2607.18245) tested Llama-3.2-3B, Ministral-3B and Granite ~3B at temperature 0, on single-tool selection from 5/10/15 tools over 3,000 Glaive queries. Solve rate (direct -> binary feedback -> structured feedback):

  | Model | Direct | Binary feedback | Structured feedback |
  |---|---|---|---|
  | Llama-3.2-3B | 0.615 | 0.768 | 0.802 |
  | Ministral-3B | 0.726 | 0.829 | 0.825 |
  | Granite | 0.694 | 0.816 | 0.771 |

  Precision fell with feedback for Ministral (0.705 -> 0.648/0.661) and Granite (0.747 -> 0.667/0.717). Structured feedback "converges within 2-3 iterations" (up to 15 allowed). Value hallucination fell for Ministral (0.277 -> 0.166). [1-4B] — [alphaxiv 2607.18245](https://www.alphaxiv.org/abs/2607.18245)
- ToolCritic (arXiv 2510.17052): a separate trained critic improves tool-calling accuracy by up to 13% over baselines. The authors state that plain self-correction is not viable here and may degrade performance. — [arXiv 2510.17052](https://arxiv.org/html/2510.17052v1)
- CriticTool (EMNLP 2025) separates internal model errors, which need reflection, from external environment errors, which need retry or skip. Models differ widely in self-critique behavior. — [arXiv 2506.13977](https://arxiv.org/html/2506.13977v1)
- Fission-GRPO: small models fall into repeated invalid tool re-calls after errors. Training-time fix. — [arXiv 2601.15625](https://arxiv.org/html/2601.15625v1)
- PRFC (EMNLP 2026 Findings): recovery plateaus on later attempts, and models repeat similar errors. — [ACL Anthology](https://aclanthology.org/2026.findings-emnlp.1762.pdf)
- PALADIN reports 57-66% relative improvement in recovery rate. It is training-based. — [arXiv 2509.25238](https://arxiv.org/html/2509.25238v1)

### Inferences
- For Hermit, one retry with a precise structured error message (for example "argument `time` missing; expected HH:MM"), capped at 1-2 retries, is worth it on argument and schema failures. Deterministic normalizers already fix many of these before any retry is needed.
- Do not apply reflection to decision errors (recall vs decline, ask vs act). There is no external signal there, and ToolCritic and others report self-correction degrades.
- Watch precision. Feedback loops increase "eventually called something", which Hermit could experience as acting when it should have asked.

### Gaps
- No sub-1B self-correction results found. SAAG's smallest models are about 3B.

## Cross-cutting: When2Call (asking vs acting vs declining) baseline numbers for small models

### Takeaway
Small models over-call tools and rarely admit they cannot answer. The F1 for choosing among answer, call, ask and decline is low (18-32) at 0.5B-3B, and size does not help much in this range. Preference optimization fixed this for 4B and 8B, but that requires training. At test time, the options are confidence gates and explicit decision steps.

### Cited Findings
- When2Call (Ross et al., NVIDIA, NAACL 2025), multiple-choice log-prob evaluation:

  | Model | F1 | Tool hallucination | BFCL Irrelevance |
  |---|---|---|---|
  | Qwen2.5-0.5B | 32.0 | 20% | 37.7% |
  | Qwen2.5-1.5B | 29.9 | 23% | 71.9% |
  | Qwen2.5-3B | 29.8 | 23% | 53.1% |
  | Llama-3.2-1B | 21.7 | 43% | 52.9% |
  | Llama-3.2-3B | 17.9 | 52% | 46.6% |
  | xLAM-1B | 25.6 | 40% | 61.3% |

  Qwen 0.5B matches Qwen 7B on F1 (32.0). The authors say "most community models are unwilling to admit they cannot answer". [<=1B, 1-4B] — [arXiv 2504.18851](https://arxiv.org/html/2504.18851v1)
- RPO preference training (training, not test-time), Mistral-NeMo-Minitron:
  - 4B: F1 29.7 -> 51.0, tool hallucination 16% -> 1.9%, BFCL Irrelevance 41.1% -> 77.4%, at a cost to BFCL AST (57.9 -> 54.0).
  - 8B: F1 31.9 -> 52.4.

  — [arXiv 2504.18851](https://arxiv.org/html/2504.18851v1)

### Inferences
- When2Call's multiple-choice log-prob scoring doubles as a test-time technique. Score the four behaviors (answer / call / ask / decline) as a forced choice using next-token logprobs. Hermit's decision-model spike resembles this. Its 41/100 is consistent with the low small-model F1 above.
- Raising that number at test time likely needs the encoder classifier (section 5) and retrieved exemplars (section 4), not a second sub-1B LLM.
- For Hermit's memory recall vs decline failures, the RPO result shows the real fix is preference data. That is training, so outside this note's scope, but flag it for the fine-tune roadmap.

### Gaps
- When2Call's small-model results use log-prob multiple choice. I found no free-generation numbers for them.
