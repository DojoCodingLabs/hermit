# Training-side methods for small (0.5B-4B) models to match frontier models on narrow VA tool use (ES-LatAm + EN)

Scope: Hermit runs BotPsy-0.8B (Tether Qwen3.5-0.8B fine-tune, GGUF Q4_K_M) through llama.cpp on a phone. It has about 430 eval cases (with a blind holdout) and 30 multi-turn trajectory scenarios run through the real runtime. These notes cover what to do if the team trains a Hermit-specific model or LoRA. The research ran 2026-11-12. Numbers come from primary papers and blogs unless a line says otherwise.

---

## 1. Synthetic data generation for tool use (APIGen-MT, ToolACE, Hammer, When2Call, Magnet) and executable verification

### Takeaway
Every strong small tool-calling model from 2025 used the same recipe. A frontier teacher generates calls against a fixed API set, rule and execution checks filter the output, and a judge filters it again. On top of that, negative and no-call data teach when not to call. Multi-turn data built from verified blueprints (APIGen-MT) or dependency graphs (Magnet) is what lifts multi-turn scores. Hermit's domain has a small, fixed, executable tool set (reminders, calendar, messaging, memory), which is the ideal case for this recipe: every sample can be checked against a simulated state.

### Cited Findings
- **APIGen-MT (Salesforce, NeurIPS 2025 D&B).** Phase 1 builds verified task "blueprints" (intent plus ground-truth actions). Phase 2 simulates agent-human interplay to turn them into full multi-turn trajectories. Resulting tau-bench pass@1 (mean of 5 or more trials): xLAM-2-8B scored 58.2 Retail / 35.2 Airline / 46.7 overall, and xLAM-2-3B scored 44.4 / 32.0 / 38.2. BFCL v3 multi-turn accuracy: 8B 69.25%, 3B 56.00%, 1B 43.12%. The 70B and 32B models took the top two BFCL v3 spots (78.19 / 75.83). — [APIGen-MT arXiv 2504.03601](https://arxiv.org/pdf/2504.03601)
- The xLAM-2 weights are licensed cc-by-nc-4.0, so they are research-only and cannot ship. The method can be reused; the weights cannot. — [HF model card Llama-xLAM-2-8b-fc-r](https://huggingface.co/Salesforce/Llama-xLAM-2-8b-fc-r)
- **ToolACE (ICLR 2025).** It builds a self-evolved pool of 26,507 APIs, then generates dialogs through multi-agent interplay guided by a complexity evaluator. Each sample passes dual-layer verification: (a) a rule checker for syntax and structural compliance with the API schema, and (b) LLM "expert agents" that check for hallucination, consistency and tool-response quality. The authors say an 8B model trained on this data is "comparable to the latest GPT-4 models" on BFCL. — [ToolACE arXiv 2409.00920](https://arxiv.org/html/2409.00920v2); [ToolACE-8B card](https://huggingface.co/Team-ACE/ToolACE-8B)
- **Hammer (function masking, on-device focus).** During training it masks or randomizes function and parameter names, so the model must read the descriptions. This reduces errors when names are misleading. The Hammer paper's BFCL v2 table lists xLAM-1.3B-fc at 74.90 and Hammer-1.5B at 73.04, against xLAM-7B-fc at 79.41. — [Hammer arXiv 2410.04587](https://arxiv.org/html/2410.04587v2)
- **When2Call (NVIDIA/Harvard, NAACL 2025).** It targets three failure modes: answering directly when a tool is needed, calling a tool when none fits, and calling a tool while required parameters are missing (where the model should ask a follow-up). BFCL barely tests these. The training data was synthesized with Mixtral 8x22B. Training with reward-aware preference optimization (RPO) on the multiple-choice format "substantially increases" When2Call and BFCL Irrelevance scores while keeping the should-call part competitive. A third-party summary cites a tool-hallucination rate as low as 1.2%, but this was not verified against the paper. — [When2Call arXiv 2504.18851](https://arxiv.org/html/2504.18851v1); [ACL Anthology PDF](https://preview.aclanthology.org/fix-sig-urls/2025.naacl-long.174.pdf)
- **Magnet (ACL 2025).** It models tools as a local dependency graph, where edges are input-to-output dependencies. Random walks plus Insert, Merge and Split node operations produce multi-turn function sequences. The teacher receives reference call sequences as positive hints and incorrect calls as negative hints. Positive trajectories feed SFT and negative ones feed preference optimization (mDPO). Magnet-14B-mDPO scored 68.01 on BFCL-v3 and 73.30 on ToolQuery, beating its teacher Gemini-1.5-pro-002. — [Magnet arXiv 2503.07826](https://arxiv.org/pdf/2503.07826); [ACL 2025](https://aclanthology.org/2025.acl-long.1566)
- **The data mix ToolRL used for RL is a reusable public blend:** 2K ToolACE, 1K Hammer-masked and 1K xLAM samples (4K total). — [ToolRL arXiv 2504.13958](https://arxiv.org/html/2504.13958)
- **Translation rules for multilingual tool data.** A multilingual BFCL extension (ES, FR, IT, NL, HI) keeps function names, argument names and enum constants in English and translates only user-facing argument values. — [arXiv 2506.23394](https://www.arxiv.org/pdf/2506.23394)
- **Bilingual LoRA precedent (TUCAN, Bulgarian).** LoRA on 10,035 bilingual function-calling examples. Fine-tuning helped smaller models proportionally more, and its effect shrank as model size grew. — [arXiv 2506.23394 / TUCAN](https://www.arxiv.org/pdf/2506.23394)

### Inferences
- **Recommended Hermit data pipeline**, combining APIGen-MT, ToolACE, Magnet and When2Call:
  1. Write Hermit's real tool schemas (reminder create/list/cancel, calendar, message, memory) plus a deterministic state simulator. The simulator already exists in effect, since the runtime runs the 30 trajectories.
  2. Have a frontier teacher write blueprints: intent, ES-LatAm or EN utterance, ground-truth call sequence and final state. Vary persona, country (MX/CO/AR/CR/CL slang, voseo, 12h/24h time, "pasado mañana", "el lunes que viene") and code-switching.
  3. Verify by execution. Replay the calls in the simulator and keep only samples where the final state matches the blueprint. Then run a schema and rule check, then a judge pass.
  4. Make roughly 20-30% of samples negatives: missing slot (ask), no matching tool (decline or answer), ambiguous (clarify), and chit-chat (no call). This is the When2Call split. Also build Magnet-style negative or "almost right" trajectories as rejected samples for DPO.
  5. Apply Hammer-style name masking on a fraction of samples if tool names may change. Keep argument keys and enums in English and values in the user's language. Never let the eval-set or holdout templates leak into generation prompts.
- Published recipes are useful at about 4K examples for RL (ToolRL) and about 10K for bilingual LoRA SFT (TUCAN). With 4-5 tools, a narrow VA domain should saturate at roughly 5K-30K verified samples. This is an extrapolation, not a measured figure.

### Gaps
- ToolFlow was not researched.
- No found source reports the absolute yield of APIGen-MT or ToolACE verification (pass or reject rates), and none reports teacher token cost per verified sample.
- The exact When2Call figures for small models (sizes trained, F1) were not verified from the primary paper.
- **Citation caveat:** the claims for the translation rules (ES/FR/IT/NL/HI BFCL extension), TUCAN (10,035 bilingual examples) and ITC came from one search-result summary that grouped several papers. Their mapping to arXiv 2506.23394 is uncertain, because 2506.23394 may be only the TUCAN paper. Check each before citing.

---

## 2. Distillation: response vs logit, on-policy (GKD / Thinking Machines), distilling the harness, reasoning-trace length

### Takeaway
On-policy distillation is the most compute-efficient published way to push a small student toward a teacher. The student samples, and the teacher scores every token with reverse KL. Thinking Machines reports 9-30x less compute than SFT and about 10x less than RL for equal quality, and it also repairs catastrophic forgetting after domain fine-tuning. It needs the teacher's logits on the student's tokenizer, so the teacher must be an open model with the same tokenizer, such as Qwen3.5-9B or 27B for a Qwen3.5-0.8B student. A closed frontier model cannot be the logit teacher; it can only produce SFT data.

### Cited Findings
- **Method.** The student samples a trajectory, the teacher runs one forward pass (`compute_logprobs`), and the per-token advantage is the negative reverse KL. Training uses the RL importance-sampling loss with discount 0. No reward model is needed. RL provides O(1) bits per episode, whereas distillation provides O(N), where N is the token count. Default setup: 64 prompts × 4 samples = 256 rollouts per batch. — [Thinking Machines, On-Policy Distillation](https://www.thinkingmachines.ai/blog/on-policy-distillation/)
- **Qwen3 report numbers (8B student, Table 21).** Off-policy distillation scored 55.0% on AIME'24. Adding RL raised it to 67.6% at 17,920 GPU-hours. On-policy distillation instead raised it to 74.4% at 1,800 GPU-hours, about 10x less compute and a better score. — [Thinking Machines blog citing Qwen3 tech report](https://www.thinkingmachines.ai/blog/on-policy-distillation/)
- **Thinking Machines' own replication.** SFT on 400K prompts reached 60% AIME'24, and extrapolating SFT to about 2M prompts gives about 70%. On-policy distillation from the 400K checkpoint reached 70% in about 150 steps (about 77K prompts × 4 samples). That is 9-30x cheaper than SFT-2M in FLOPs: 8.4e19 teacher and 8.2e19 student, versus 3.4e21 and 1.5e21. — [same](https://www.thinkingmachines.ai/blog/on-policy-distillation/)
- **LoRA plus distillation.** LoRA rank 32 trails full fine-tuning by 13 points after SFT but by only 6 points after on-policy distillation. — [same](https://www.thinkingmachines.ai/blog/on-policy-distillation/)
- **Personalization and forgetting (Qwen3-8B, internal-assistant experiment).** Mid-training on documents raised internal QA from 18% to 43% but crashed IF-eval from 85% to 45%. A 70/30 docs/chat mix gave 36% / 79%. Adding on-policy distillation from the original Qwen3-8B on Tulu3 prompts gave 41% / 83%, recovering most of the chat ability while keeping the knowledge. Even SFT on the model's own samples degraded IF-eval at any practical learning rate. — [same](https://www.thinkingmachines.ai/blog/on-policy-distillation/)
- **Self-distillation from an RL-trained teacher** (LoRA rank 128) matched the RL policy in 7-10x fewer gradient steps. The blog says this is 50-100x compute efficiency. Training on a single prompt with 20 steps × 256 rollouts roughly matched the teacher. — [same](https://www.thinkingmachines.ai/blog/on-policy-distillation/)
- **Tinker's cookbook has moved to Qwen3.5.** It now uses Qwen3.5-9B-Base as student and Qwen3.5-9B as teacher, after the Qwen3 models were retired in June 2026. This shows the recipe already exists for Hermit's model family. — [same](https://www.thinkingmachines.ai/blog/on-policy-distillation/)
- **An independent 2026 follow-up** reports replicating the Qwen3 on-policy recipe at a fraction of RL compute. — [arXiv 2604.13016](https://arxiv.org/pdf/2604.13016v1)
- **Reasoning length for tool calls.** In ToolRL, rewarding longer reasoning (target 512 tokens) cut Qwen2.5-1.5B BFCL from 46.20% to 33.23%, and a dynamic length reward also failed. The authors conclude that longer reasoning is not necessarily better for tool use. — [ToolRL arXiv 2504.13958](https://arxiv.org/html/2504.13958)

### Inferences
- **Distilling the harness into weights.** Hermit's router, normalizers and clause planner are deterministic functions of the input. Run the full harness over generated utterances and record the final canonical call sequence as the SFT target. The model then learns the post-normalization output directly. Keep the harness as a validator at runtime, at first anyway: route, then the model, then the normalizer check. This way regressions show up as normalizer corrections, which can be counted with the existing eval set.
- **Recommended staging for a 0.8B student:**
  1. Response distillation (SFT) on verified frontier-teacher data, as in section 1.
  2. On-policy distillation from Qwen3.5-9B or 27B, which shares the tokenizer, after that teacher is itself SFT'd on the same Hermit data or prompted with the full harness context. Use general chat prompts (Tulu3-style, ES and EN) mixed in to fix forgetting.
  3. Optionally, short GRPO with verifiable rewards (section 3).
- **Use a no-think or short-think output for tool calls.** The ToolRL length result and the phone's latency budget both point the same way. If thinking is kept, cap it with a token-budget penalty rather than a target length.
- The GKD paper (Agarwal et al., the generalized on-policy distillation framework) was not read for these notes. Its specific claims are not cited here.

### Gaps
- No found source gives on-policy distillation results specifically at 0.5B-1B or specifically for function calling. All cited on-policy numbers are 8B students on math or chat.
- There was no direct published comparison of logit vs response distillation for tool calling.

---

## 3. RL for tool calling on small models (GRPO/DAPO, verifiable rewards, ask/act/decline)

### Takeaway
GRPO with rule-based tool-call rewards works at 1.5B-3B, and it gives the largest relative gains at the smallest size. In ToolRL, Qwen2.5-1.5B went from 19.4% to 46.2% on BFCL v3, against 40.7% for SFT. Cold-start GRPO (no SFT first) generalized better than SFT followed by GRPO. Fine-grained rewards (tool name, parameter names, parameter values) helped stability. Tool-N1 found that strict binary rewards generalized better on "Live" data. For multilingual argument problems, SFT gets most of the gain and RL adds incremental robustness.

### Cited Findings
- **ToolRL (NeurIPS 2025).**
  - Base models were Qwen2.5-Instruct 1.5B, 3B and 7B, plus Llama-3.2-3B. RL used 4K samples, and SFT used 400 or 4K.
  - Reward: R = R_format (0 or 1) + R_correct, where R_correct ∈ [-3, 3] combines Jaccard overlap on tool names, Jaccard overlap on parameter names and exact match on values. There is no KL penalty.
  - Settings: GRPO with 4 rollouts per query, batch size 512, LR 1e-6, 15 epochs, max response length 1024, on 2× A100-80GB per run with veRL.
  - BFCL v3 overall:

    | Model | Raw | SFT4k | PPO | GRPO cold start |
    |---|---|---|---|---|
    | Qwen2.5-1.5B | 19.41 | 40.67 | 38.32 | 46.20 |
    | Qwen2.5-3B | 33.04 | 41.97 | 51.15 | 52.98 |
    | Qwen2.5-7B | 41.97 | 36.53 | 46.68 | 58.38 |

  - API-Bank at 1.5B: 30.65 raw, 63.15 with GRPO.
  - Cold-start GRPO beat SFT400 followed by GRPO for every model (3B: 52.98 vs 46.42; 7B: 58.38 vs 39.25). The authors attribute this to SFT memorization.
  - Fine-grained linear reward scaling gave small gains (3B: 53.81). A coarse two-stage schedule hurt.

  — [ToolRL arXiv 2504.13958](https://arxiv.org/html/2504.13958)
- **SFT can hurt a larger model on tool use.** In ToolRL, Qwen2.5-7B's Bamboogle score fell from 69.6 raw to 28.8-30.4 after SFT, while GRPO raised it to 72.0. This shows how narrow SFT can damage general ability. — [ToolRL](https://arxiv.org/html/2504.13958)
- **Nemotron-Research-Tool-N1 (ICLR 2026).** GRPO with a binary reward on format validity and functional correctness only, with no curated reasoning traces. The checker accepts argument dicts regardless of key order. Tool-N1-7B scored 84.82 BFCL overall and Tool-N1-14B scored 85.97, against GPT-4o at 83.97. A secondary summary reports that strict binary rewards generalized better than partial credit on Live data. — [Tool-N1 arXiv 2505.00024](https://arxiv.org/html/2505.00024v1); [ICLR 2026](https://proceedings.iclr.cc/paper_files/paper/2026/hash/93b3d975f9a2448964a906199db98a9d-Abstract-Conference.html)
- **Conflict on reward granularity.** ToolRL found that fine-grained decomposition gives more stable learning; Tool-N1 reports that binary rewards generalize better. Both results are from GRPO on Qwen2.5. — [ToolRL](https://arxiv.org/html/2504.13958) vs [Tool-N1](https://arxiv.org/html/2505.00024v1)
- **Multilingual argument language (Amazon, Aug 2026).** The paper names a failure called "Argument Language Mismatch" (ALM), where the model picks the right tool but writes argument values in the wrong language. Its example is a Spanish user getting `to_currency='dólares'` when the API expects `'dollars'`. SFT resolves "a large fraction" of ALM errors and is comparable to, sometimes better than, RL. GRPO with gated argument-aware rewards (tool ID, then tool-schema alignment, then argument correctness, with argument-value tokens upweighted) gives incremental gains, mostly in generalization and in preserving general reasoning. — [arXiv 2608.11715](https://arxiv.org/pdf/2608.11715)
- **When2Call uses preference optimization (RPO), not GRPO,** for the ask/decline decision, with gains on irrelevance detection that do not hurt should-call accuracy. — [When2Call](https://arxiv.org/html/2504.18851v1)

### Inferences
- **Reward design for Hermit, ask vs act vs decline.** Use one verifiable reward with gates:
  1. Format and parse. If this fails, the reward is -1.
  2. Decision class: act, ask_clarification, decline/no-tool or chit-chat answer. A wrong class gets a large penalty, with acting when it should ask or decline penalized more than over-asking, because a wrong reminder costs more than one extra question.
  3. If acting, check correctness by executing in the simulator and comparing final state. This captures "binary functional correctness" in Tool-N1's sense and is order-invariant.
  4. Add a small partial credit for name and keys (ToolRL style) only if training stalls.
  5. Language-consistency check on free-text values (reminder title in the user's language; enums canonical).
  6. A length or latency penalty on any thinking tokens.
- Hermit's 30 trajectory scenarios can become a multi-turn RL environment, but keep them for evaluation. Generate separate training environments from blueprints so the holdout stays clean.
- Expect the largest relative gains at 0.8B, as ToolRL's 1.5B row shows. GRPO at 0.8B fits on a single 24-80GB GPU (see section 6). DAPO was not specifically researched. Its known tricks (clip-higher, dynamic sampling, token-level loss) are not cited here.

### Gaps
- No published GRPO tool-calling results at exactly 0.5B-0.8B were found. The smallest is ToolRL's 1.5B.
- ReTool and NVIDIA "Nemotron tool RL" beyond Tool-N1 were not fetched.
- No paper found evaluates ask-vs-act-vs-decline as a 3-way RL reward. This design is inferred from When2Call plus ToolRL.

---

## 4. LoRA adapters on device (hot-swap, per-skill, aLoRA), merging, QAT

### Takeaway
llama.cpp can load GGUF LoRA adapters, and work exists to support activated LoRA (aLoRA). aLoRA adapts only the tokens after an invocation point, so adapters can be swapped without recomputing the KV cache. That matters for Hermit, which already relies on a KV cache (Q35). QAT is the most-cited way to recover Q4 losses. Google says Gemma 3 QAT cut the Q4_0 perplexity penalty by 54% with about 5,000 QAT steps that distill from the bf16 checkpoint's probabilities.

### Cited Findings
- **aLoRA (NeurIPS 2025).** The adapter weights apply only to tokens after an activation sequence, so the base model's KV cache for the prior context is reused. Adapters can be invoked mid-conversation without re-prefill. — [Activated LoRA arXiv 2504.12397](https://arxiv.org/html/2504.12397v5); [NeurIPS 2025](https://proceedings.nips.cc/paper_files/paper/2025/hash/4d0b6303d4a4811445f69f357bf6def5-Abstract-Conference.html)
- **llama.cpp PR #15327** adds aLoRA support to llama-server and to the GGUF LoRA format. Its stated benefit is hot-swapping adapters without clearing the cache, with a Granite 3.2 8B example. Its merge status was not confirmed. Source: [llama.cpp PR 15327](https://worker-github.zxx930427.workers.dev/ggml-org/llama.cpp/pull/15327)
- **llama.cpp limits.** It processes only same-adapter requests concurrently (EdgeLoRA paper), and issue #10374 asks for per-request adapter switching without merging. — [EdgeLoRA arXiv 2507.01438](https://arxiv.org/html/2507.01438v1); [llama.cpp issue 10374](https://github.com/ggml-org/llama.cpp/issues/10374)
- **One Android blog (anecdotal, unverified)** claims a swap of a roughly 2 MB adapter takes about 70 ms, and warns of native memory leaks if adapters are not detached. — [DEV Community](https://dev.to/software_mvp-factory/quantized-lora-adapters-for-on-device-llms-hot-swapping-task-specific-behaviors-on-android-without-44hb)
- **Tether/QVAC Fabric** published an edge-first LoRA fine-tuning framework for heterogeneous GPUs. This is relevant because BotPsy and the QVAC runtime come from Tether. — [HF blog qvac/fabric-llm-finetune](https://huggingface.co/blog/qvac/fabric-llm-finetune)
- **Gemma 3 QAT.** About 5,000 QAT steps using the non-quantized checkpoint's probabilities as targets (a distillation-style QAT) cut the Q4_0 perplexity drop by 54% in llama.cpp's perplexity eval. Community numbers: BF16 PPL 8.4276, QAT-BF16 8.2021, QAT-Q4_0 8.2500. There is no non-QAT Q4_0 baseline in that report, so the 54% has no independent check. Google's Gemma 4 QAT release cites the Gemma 3 figure as precedent. — [Google Developers Blog](https://developers.googleblog.com/en/gemma-3-quantized-aware-trained-state-of-the-art-ai-to-consumer-gpus/); [Hardware Corner](https://www.hardware-corner.net/smarter-local-llm-lower-vram-20250419)

### Inferences
- **Recommended for Hermit:**
  1. Start with one merged full fine-tune or merged LoRA (single GGUF), not per-skill adapters. With 4-5 tools and a 0.8B base, one model covers the domain. Merging avoids adapter overhead and the llama.cpp concurrency limits.
  2. Consider aLoRA-style adapters only for rarely used "intrinsics" (for example a summarizer or a safety or uncertainty check), invoked after the main turn so the cache is reused.
  3. QAT or a QAT-like final stage. After the task fine-tune, do a short distillation pass in which the bf16 fine-tuned model is the teacher and the student runs with fake-quantized Q4 weights. This mirrors Gemma's roughly 5K-step recipe. Measure Q4_K_M vs bf16 on the 430-case set before investing, since the gap may already be small.
- Model merging (TIES, DARE, SLERP of a Hermit SFT with the original BotPsy or Qwen3.5-0.8B-Instruct) is a cheap way to trade task skill against general chat retention. No 2025-2026 small-model tool-use merging result was found.

### Gaps
- It was not confirmed whether llama.cpp mainline has merged aLoRA, nor whether the QVAC runtime exposes LoRA hot-swap.
- No published QAT result was found for Qwen3.5-0.8B or for tool calling specifically.
- No sourced merging results for small tool-calling models were found.

---

## 5. Functional tokens (Octopus v2), vocabulary tricks, small-model pitfalls (forgetting, multilingual drop)

### Takeaway
Functional tokens turn tool selection into a single-token classification. Octopus v2 (Gemma-2B) claimed better-than-GPT-4 accuracy and lower latency on a fixed Android API set, but this is vendor-reported only. The bigger risks for a 0.8B Hermit model are catastrophic forgetting of chat and instruction following after narrow SFT, and argument-language mismatch in Spanish. The documented fixes are mixing in chat data, on-policy distillation to recover, and language-consistent argument training.

### Cited Findings
- **Octopus v2.** Gemma-2B fine-tune that adds special tokens (`<nexa_0>`, and so on), one per function, so picking a function is one token. Vendor claims: function-call accuracy 31% above "Llama-7B + RAG" and 168% faster than GPT-4-turbo. A 35x latency figure circulates only in secondary summaries. A Nexa partner page describing a 0.5B model with 98%+ accuracy conflicts with the 2B paper. License listings also conflict (Apache-2.0 vs CC-BY-NC). No independent replication was found. — [Octopus v2 arXiv 2404.01744](https://arxiv.org/html/2404.01744v5); [HF card](https://huggingface.co/NexaAIDev/Octopus-v2); [Nexa partner page](https://partners.nexa.ai/octopus-v2)
- **Forgetting.** Domain mid-training dropped Qwen3-8B IF-eval from 85% to 45%. A 30% chat mix kept it at 79%. On-policy distillation from the original model restored 83%. LoRA "learned less and still forgot." — [Thinking Machines](https://www.thinkingmachines.ai/blog/on-policy-distillation/)
- SFT on tool data collapsed Qwen2.5-7B's Bamboogle QA score from 69.6 to about 29-30, while GRPO kept it at 72.0. — [ToolRL](https://arxiv.org/html/2504.13958)
- **Unsloth's Qwen3.5 docs, via a secondary summary** (unverified): to preserve reasoning ability, keep at least 75% reasoning examples in the mix. — [Unsloth Qwen3.5 fine-tune docs](https://unsloth.ai/docs/jp/moderu/qwen3.5/fine-tune); [news.hada.io summary](https://news.hada.io/topic?id=27225)
- **Multilingual post-training (Apr 2026).** 220 SFT runs on Qwen3 0.6B-8B with parallel translated data, including Spanish, covering math and API calling. It introduces mAPICall-Bank (11 languages). Small amounts of language substitution help multilingual performance, but larger substitutions give diminishing returns and degrade English. — [arXiv 2604.13286](https://arxiv.org/pdf/2604.13286)
- **Argument Language Mismatch.** A Spanish user ("dólares", "libras") gets wrong-language enum values. SFT fixes most of it, and GRPO with argument-value token upweighting adds incremental gains. — [arXiv 2608.11715](https://arxiv.org/pdf/2608.11715)
- The ITC benchmark reports that fine-tuning yields significant improvements, particularly for non-English queries. — [search summary of ITC, arXiv 2506.23394 context](https://www.arxiv.org/pdf/2506.23394)

### Inferences
- Functional tokens fit Hermit's small fixed tool set (fewer than 10 functions). They save output tokens and make routing a single-token decision. They require resizing the embeddings and training the new rows. With GGUF and llama.cpp, that means shipping a custom tokenizer, which breaks drop-in compatibility with BotPsy and QVAC tooling. A cheaper variant is to fine-tune on short canonical tool names that are already single tokens, plus GBNF grammar-constrained decoding. This is an inference; it was not benchmarked.
- **Pitfall checklist for a Hermit fine-tune:**
  - Keep 20-40% general ES and EN chat or instruction data in the mix.
  - Track IF-eval-style and general chat probes next to the 430-case set.
  - Keep keys and enums in English and values in the user's language.
  - Use native LatAm Spanish generation rather than machine translation of English samples.
  - Balance ES and EN so English does not degrade (2604.13286).

### Gaps
- No sourced numbers were found on Qwen3.5-0.8B's own ES vs EN tool-calling gap.
- Spanish-specific per-language results inside 2604.13286 and 2608.11715 were not extracted (only the abstracts were read).

---

## 6. Costs and tooling (Unsloth, TRL, Axolotl), data and GPU size for 0.8B

### Takeaway
A 0.8B model is very cheap to train. Unsloth lists about 3 GB of VRAM for bf16 LoRA on Qwen3.5-0.8B (5 GB at 2B, 10 GB at 4B), and free Colab notebooks run 0.8B-4B. Qwen3.5 GRPO works in Unsloth with `fast_inference=False`, because vLLM does not support it there. Published tool-RL recipes use about 4K prompts on 2× A100. The real cost is teacher inference for data generation and verification, not student training.

### Cited Findings
- **Unsloth Qwen3.5 bf16 LoRA VRAM:** 0.8B 3 GB, 2B 5 GB, 4B 10 GB, 9B 22 GB, 27B 56 GB. 0.8B, 2B and 4B can run in free Colab notebooks. — [Unsloth Qwen3.5 fine-tune docs (FR)](https://unsloth.ai/docs/fr/modeles/qwen3.5/fine-tune); [DE](https://unsloth.ai/docs/de/modelle/qwen3.5/fine-tune)
- **Qwen3.5 RL in Unsloth.** GRPO and GSPO are supported. vLLM fast inference does not support Qwen3.5, so set `fast_inference=False`. — [Unsloth docs (JP)](https://unsloth.ai/docs/jp/moderu/qwen3.5/fine-tune)
- **4-bit QLoRA on Qwen3.5 small** needs under 2 GB of VRAM (DataCamp tutorial). — [DataCamp](https://www.datacamp.com/th/tutorial/fine-tuning-qwen3-5-small)
- **ToolRL compute:** 2× A100-80GB per run with veRL, 4K prompts, 4 rollouts, 15 epochs, max 1024 tokens. Total GPU-hours were not reported. — [ToolRL](https://arxiv.org/html/2504.13958)
- **On-policy distillation scale (8B student):** about 77K prompts × 4 samples (150 steps) reached the target. Total FLOPs were about 1.7e20, versus about 4.9e21 for an SFT-only path. — [Thinking Machines](https://www.thinkingmachines.ai/blog/on-policy-distillation/)
- **TUCAN bilingual LoRA** used 10,035 examples. — [arXiv 2506.23394](https://www.arxiv.org/pdf/2506.23394)
- **Gemma QAT** used about 5,000 steps. — [Google](https://developers.googleblog.com/en/gemma-3-quantized-aware-trained-state-of-the-art-ai-to-consumer-gpus/)
- **Tinker (Thinking Machines' training API)** hosts on-policy distillation recipes on Qwen3.5-9B student and teacher. — [Thinking Machines](https://www.thinkingmachines.ai/blog/on-policy-distillation/)

### Inferences
- **Sizing for a Hermit 0.8B run.** These are extrapolated from the sources above, not measured.

  | Stage | Data | Hardware |
  |---|---|---|
  | SFT | 10K-30K verified ES/EN samples, ≤ 2K tokens each (≤ 60M tokens per epoch) | Single 24 GB consumer GPU or one A100 with LoRA or full fine-tune at 0.8B |
  | GRPO | 2K-5K prompts × 4-8 rollouts | Single A100 or H100 (0.8B policy plus a simulator reward; no reward model) |
  | On-policy distillation | About 20K-80K prompts | Needs teacher logprob passes: Qwen3.5-9B on one 80 GB GPU, or 27B on 1-2 GPUs |
  | QAT pass | About 5K steps at small batch | Same as SFT |

- **Tooling choice:**
  - Unsloth for SFT/LoRA/GRPO on a single GPU (it already supports Qwen3.5).
  - TRL for DPO, GRPO and GKD (TRL has a GKDTrainer; not verified).
  - veRL for multi-turn RL at scale.
  - Export to GGUF with llama.cpp `convert_hf_to_gguf.py` and quantize to Q4_K_M.
  - Re-run the 430-case set and the 30 trajectories on the phone GGUF, per the team's harness eval lab rule.
- The Hermit dev Mac cannot train; this needs a rented or cloud GPU. Teacher data generation via frontier APIs dominates the budget.

### Gaps
- No GPU-hour totals published for 0.5B-1B tool-calling SFT or RL were found.
- Axolotl-specific Qwen3.5 support was not checked.
- No source was found for BotPsy-0.8B's training recipe or license terms for derivative fine-tunes. Verify with Tether/QVAC before fine-tuning BotPsy rather than base Qwen3.5-0.8B.
- ToolFlow, DAPO, ReTool and GKD (the original paper) were in scope but not read.
