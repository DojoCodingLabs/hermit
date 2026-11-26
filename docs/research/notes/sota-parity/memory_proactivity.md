# Memory, personalization and proactivity for a phone-sized assistant (0.5B to 4B)

Scope note: researched 2026-11-12, so many sources are 2026 preprints. Almost every published memory benchmark number uses a big cloud model (GPT-4o, GPT-4o-mini, gpt-5-mini) as the extractor, the answer model and the judge. Each result below says which model it used where the source states it. Treat vendor numbers as self-reported.

## 1. Memory systems: designs, benchmark results, what works with small models

### Takeaway
LoCoMo and LongMemEval scores depend heavily on protocol: judge, answer model, benchmark variant and who ran it. Independent re-runs flip the rankings. The design ideas that hold up across systems are the ones Hermit can do in code: ADD-only or append-plus-invalidate writes instead of LLM UPDATE/DELETE, hybrid retrieval (semantic + BM25 + entity match), timestamps on every fact, and background (sleep-time) consolidation. The few results measured with 1B to 3B models show absolute scores far below the cloud-model numbers, so a small model should not own memory management.

### Cited Findings
**Mem0**
- The original Mem0 paper (Apr 2025) used an LLM to extract facts and to choose ADD, UPDATE, DELETE or NOOP. Under the paper's own LoCoMo LLM-as-judge (J) protocol it reports Zep 76.60, Mem0-graph 75.71 and Mem0 72.93, so the margin is 0.89 points. A compiled leaderboard of the same paper lists Mem0-graph 68.4, Mem0 66.9, Zep 66.0, LangMem 58.1 and A-Mem 48.4 under a different scoring setup. Do not mix the two sets. — [Mem0 paper](https://arxiv.org/html/2504.19413v1); [HF compiled results](https://huggingface.co/datasets/rovemark/locomo-benchmark-results)
- The same paper measured LangMem search latency at p50 17.99 s and p95 59.82 s, which is impractical for an interactive assistant. — [Mem0 paper](https://arxiv.org/html/2504.19413v1)
- Mem0's 2026 algorithm (vendor-reported): LoCoMo 92.5 at about 6,956 tokens per query, LongMemEval 94.4 at about 6,787 tokens, BEAM-1M 64.1 and BEAM-10M 48.6, a roughly 25% drop at 10M. The answer and judge model is not named. — [Mem0 State of Agent Memory 2026](https://mem0.ai/blog/state-of-ai-agent-memory-2026)
- Mem0's 2026 architecture changes:
  - Extraction became **single-pass and ADD-only**; LLM-driven UPDATE and DELETE are no longer described.
  - Retrieval runs **three parallel signals (semantic, BM25, entity match) fused into one score**.
  - External graph stores were replaced by **built-in entity linking**: a parallel entities collection boosts scores at search time, and the `relations` field was removed.
  - Temporal queries gained 29.6 points but are still the hardest category.
  - Decay handles low-relevance memories; staleness in high-relevance memories is called unsolved.
  - Agent-generated facts are stored with the same weight as user-stated facts.
  
  — [Mem0 State of Agent Memory 2026](https://mem0.ai/blog/state-of-ai-agent-memory-2026)
- Other systems as listed by Mem0 (vendor table): Zep LoCoMo 80.32% at 189 ms (single retrieval) and up to 83% in costlier configurations; Zep LongMemEval 71.2 (GPT-4o); Letta LoCoMo 74.0 (gpt-4o-mini); OpenAI Memory LoCoMo 52.9 (sourcing unconfirmed). Mem0 and Zep openly dispute LoCoMo methodology. — [Mem0 2026](https://mem0.ai/blog/state-of-ai-agent-memory-2026); [Mem0 Zep vs Mem0](https://mem0.ai/library/agent-memory/zep-vs-mem0-which-ai-memory-layer-should-you-choose)
- Independent re-run, citing Du et al. 2025: Zep 79.09, LangMem 78.05, Mem0 62.47 on LoCoMo. This reverses the Mem0 paper's ordering. — [Memori paper](https://arxiv.org/pdf/2603.19935); [Memori LoCoMo results](https://memorilabs.ai/docs/memori-cloud/benchmark/results/)
- A third-party re-implementation of A-MEM (GPT-4o-mini) scored well below the published numbers: 40.70 and 32.63 against the original 44.65 and 37.06 on the same columns. — [Membox](https://arxiv.org/pdf/2601.03785)

**Zep / Graphiti (temporal knowledge graph)**
- Zep's Graphiti engine is a bi-temporal knowledge graph, with time modeled through ingestion, storage and retrieval. — [Zep paper](https://arxiv.org/abs/2501.13956v1)
- On LongMemEval it reports up to +18.5% accuracy and −90% response latency against a full-context baseline. Gains are largest on multi-session, temporal reasoning, preference and knowledge-update questions, with minor regressions on assistant-centric queries. — [Zep paper](https://arxiv.org/abs/2501.13956v1)
- A secondary source says conflicting facts get an `invalid_at` timestamp on the old edge instead of being deleted, which keeps history. I did not verify this against the paper text. — [Zep summary](https://signals.aktagon.com/articles/2026/07/zep-a-temporal-knowledge-graph-architecture-for-agent-memory/)

**LongMemEval and other leaderboards**
- There is no official LongMemEval leaderboard. Self-reported scores:
  - Mastra Observational Memory: 94.87% (gpt-5-mini) and 84.23% (gpt-4o).
  - Agent Zero Memory: 95.60%, an unverified preprint.
  - ByteRover: 92.8% on LongMemEval-S.
  - MemPalace: 96.6%, but this is R@5 retrieval recall, not answer accuracy.
  - The original paper's offline-reading GPT-4o oracle scores 0.9184.
  
  — [Mastra](https://mastra.ai/research/observational-memory); [Agent Zero Memory](https://arxiv.org/pdf/2608.29606); [LongMemEval](https://arxiv.org/pdf/2410.10813); [Mem0 benchmarks explainer](https://mem0.ai/blog/ai-memory-benchmarks-in-2026)
- A third-party table in MemReader lists Memobase at 72.40% and Zep at 63.80% on LongMemEval, so Zep scores below its own 71.2% under another setup. — [MemReader](https://arxiv.org/pdf/2604.07877)

**MemoryOS, Letta/MemGPT, A-MEM**
- MemoryOS has three tiers: short-term, mid-term topic "segments" and a long-term persona. A heat score (visit frequency + interaction length + recency with exponential decay) promotes segments above τ=5 into long-term memory. Mid-term grouping uses embedding similarity plus keyword overlap. It reports an average +49% F1 and +46% BLEU-1 over baselines on LoCoMo (GPT-4o-mini). The ablation of the heat mechanism alone was not visible. — [MemoryOS](https://arxiv.org/html/2506.06326v1); [summary](https://chatpaper.com/paper/147313)
- Letta's sleep-time agents split memory management into a second background agent that rewrites the primary agent's in-context memory blocks "anytime". This removes the MemGPT latency of managing memory inside the chat turn. Secondary sources report about 5x fewer test-time tokens with +15% or +18% accuracy; the two write-ups disagree, so the numbers are unverified. Gains depend on future queries being predictable. — [Letta sleep-time compute](https://letta.com/blog/sleep-time-compute); [Letta agent memory](https://www.letta.com/blog/agent-memory)
- A-MEM (Zettelkasten-style linked notes) ran Qwen-1.5B/3B and Llama-3.2-1B/3B locally through Ollama, so small-model rows exist in its tables. — [A-MEM](https://arxiv.org/pdf/2502.12110)

**Small-model-specific memory results**
- SimpleMem: Qwen2.5-3B + SimpleMem reaches **17.98 F1** on LoCoMo against **13.03** for Qwen2.5-3B + Mem0. Full-context approaches use about 16,900 tokens per query. The absolute numbers are low: a 3B reader reaches roughly a fifth of what cloud-model systems report. — [SimpleMem](https://arxiv.org/pdf/2601.02553)
- LightMem (ACL 2026): the memory system is driven by a small language model.
  - Tiers: STM/MTM/LTM, with online retrieval kept separate from offline consolidation.
  - Retrieval runs on a fixed budget in two stages: vector coarse retrieval, then semantic-consistency rerank.
  - Results: median retrieval 83 ms, median end-to-end 581 ms, about +2.5 F1 over A-MEM on LoCoMo.
  - The abstract does not say which steps are model calls and which are code.
  
  — [LightMem](https://arxiv.org/abs/2604.07798)
- Memory-R1 trains an RL memory manager (ADD/UPDATE/DELETE/NOOP) plus an answer agent with only **152 training QA pairs**. It generalizes across LoCoMo, MSC and LongMemEval at 3B to 14B. 3B is the smallest size tested, with nothing below. — [Memory-R1](https://arxiv.org/html/2508.19828)

### Inferences
- **Extraction by code versus LLM:** the field is moving toward fewer LLM decisions at write time. Mem0 dropped LLM UPDATE/DELETE for ADD-only, and Zep invalidates edges by timestamp instead of deleting. For a 0.8B model, Hermit should do this:
  - Code decides storage: append-only facts with `valid_from` and `invalid_at`, plus deterministic contradiction rules such as same subject+slot → invalidate the older fact.
  - The model only fills a narrow slot schema, or the explicit `remember` skill writes verbatim.
- **Write-time versus read-time:** cloud systems spend most of their LLM budget at write time (extraction, consolidation). On a phone, that work belongs in a background "sleep-time" job (charging or idle; Letta pattern). The chat turn itself should do only hybrid retrieval: BM25 + vector + entity boost, fused with RRF, which is cheap in code.
- **Memory heat or decay** (MemoryOS) can be a plain SQL score: frequency, recency and length. No model is needed.
- **Temporal reasoning** is the weakest category everywhere. Normalize every time expression to absolute dates in code at write time, and keep `event_time` separate from `ingest_time`.
- **Agent-generated facts:** Mem0 stores them at the same weight as user statements. Hermit's untrusted-content seal argues the opposite. Tag provenance (user-said, assistant-said, from message) and never promote message-derived facts without user confirmation.

### Gaps
- No memory benchmark result measured with a model of 1B or less as both the extractor and the reader. The smallest found are 1B to 3B rows in A-MEM and SimpleMem, with low absolute F1.
- Cognee and LangMem 2025-2026 benchmark numbers beyond the Mem0-paper and Memori re-runs were not found. LangMem has no published small-model result.
- Exact LightMem model sizes and per-step attribution need the full PDF.

## 2. On-device retrieval: embeddings, vector search, hybrid, latency

### Takeaway
EmbeddingGemma-300M is the best-documented on-device multilingual embedder: 61.15 on MMTEB v2, Q4_0 at 60.62, under 200 MB RAM quantized, Matryoshka down to 128 dimensions. Qwen3-Embedding-0.6B scores higher on MMTEB (64.33) but is twice the size. For a personal fact store of thousands to tens of thousands of rows, brute-force sqlite-vec plus FTS5 fused with RRF is enough. No Android benchmarks were found, so Hermit must measure its own.

### Cited Findings
- EmbeddingGemma-300M (Google model card): MMTEB Multilingual v2 mean 61.15 at 768 dimensions and 58.23 at 128 dimensions. Quantized: Q8_0 60.93, Q4_0 60.62. EmbeddingGemma 2 scores 61.36. — [HF model card](https://huggingface.co/google/embeddinggemma-300m); [Kaggle](https://www.kaggle.com/models/google/embeddinggemma/); [Google blog](https://developers.googleblog.com/en/introducing-embeddinggemma/); [paper](https://arxiv.org/pdf/2509.20354)
- Third-party claims: under 200 MB RAM quantized and under 22 ms on EdgeTPU. These are not from a Google latency table. — [Mixpeek](https://mixpeek.com/model/google/embeddinggemma-300m)
- Qwen3-Embedding-0.6B: MMTEB mean (task) 64.33, MMTEB-R retrieval 64.64, English MTEB v2 70.70. A comparison table lists bge-m3 at 59.56 and multilingual-e5-large-instruct at 63.22, but that table is third-party and should be verified. — [Qwen3 Embedding report](https://arxiv.org/pdf/2506.05176); [Qwen blog](https://qwenlm.github.io/blog/qwen3-embedding)
- sqlite-vec:
  - Brute-force KNN in the stable release; ANN indexes are alpha.
  - Hybrid search with FTS5 is SQL you write yourself (keyword-first, or RRF).
  - It runs on mobile, Raspberry Pi and WASM.
  - Limits appear around 1M vectors.
  
  — [sqlite-vec v0.1.0](https://alexgarcia.xyz/blog/2024/sqlite-vec-stable-release/index.html); [hybrid post](https://alexgarcia.xyz/blog/2024/sqlite-vec-hybrid-search/index.html); [Infino](https://infino.ai/blog/embedded-full-text-and-vector-search/)
- Developer write-up, platform unstated: 50,000 vectors took 81 ms p50 for an exact scan, about 25 ms of it I/O. A binary-quantized scan took 2.6 ms, followed by exact float32 rerank. — [DEV write-up](https://dev.to/arinaymay/37500-reads-per-search-what-memory-mapping-fixed-in-sqlite-vec-and-what-it-couldnt-256b)
- Desktop i9 numbers (240k chunks, 128 dimensions): FTS5 query 18 ms, full hybrid query 63 ms. — [scrydb paper](https://arxiv.org/pdf/2608.24060)
- Apple's MicroNN is an on-device, disk-resident, updatable vector DB, which shows the pattern is used in production research. — [MicroNN](https://arxiv.org/pdf/2504.05573)

### Inferences
- A personal fact store will have thousands of facts, far under the scale where brute force hurts. Store 256- or 128-dimension Matryoshka EmbeddingGemma vectors (Q4 or Q8 GGUF via llama.cpp, which Hermit already ships). Shortlist with a binary-quantized scan or exact float32, then fuse with FTS5 BM25 via RRF and add an entity-name boost (Mem0 2026 pattern).
- BM25 matters for a small model: names, numbers and places are exactly what dense embeddings miss and what users ask about.
- Embedding at write time is a background job. At query time there is one embedding call, roughly tens of ms on a phone NPU or CPU (not measured here).

### Gaps
- No measured Android latency for EmbeddingGemma, Qwen3-Embedding-0.6B or sqlite-vec on a real phone.
- No reliable MMTEB score found for multilingual-e5-small.
- ObjectBox and usearch mobile benchmarks were not found.

## 3. Proactive assistants: research, products, triggers, not being annoying

### Takeaway
Shipping proactive assistants work as a deterministic trigger layer over personal data (calendar, mail, messages, screenshots) with a small model on top. Pixel Magic Cue uses Gemini Nano, and Samsung Now Brief uses its Personal Data Engine. Suggestions appear inline or as time-of-day briefs, not interruptions. Research shows proactivity prediction is hard: GPT-4o reaches about 65% F1 on ProactiveBench, and fine-tuned 7-8B models reach about 66%. Timing aligned to user state raises acceptance from 0.44 to 0.68.

### Cited Findings
- ProactiveBench (ICLR 2025; Tsinghua/Huawei) has 6,790 training events and 233 test events across 12 scenarios. F1 results:
  - LLaMA-3.1-8B-Instruct: 55.06%.
  - GPT-4o: about 64.60%.
  - Fine-tuned LLaMA-3.1-8B: 66.25%.
  - Fine-tuned Qwen2-7B: 66.47%.
  
  Fine-tuning reduced false alarms. — [Proactive Agent paper](https://arxiv.org/html/2410.12361v2)
- ContextAgent: sensory context plus a persona from history feeds a "need help?" prediction, which then makes tool calls. Its benchmark ContextAgentBench has 1,000 samples, 9 scenarios and 20 tools. It reports up to +8.5% proactive-prediction accuracy and +6.0% tool-call accuracy against baselines. — [ContextAgent](https://arxiv.org/abs/2505.14668)
- Proactive Agent Research Environment, with simulated users: acceptance ranges from 78.2% (Claude as user) to 17.6% (Gemma as user). The authors track proposal rate alongside acceptance because too many proposals annoy users. — [PARE](https://arxiv.org/html/2604.00842v1)
- Timing (N=32 within-subject): Aligned-Adaptive timing reached a mean acceptance of 0.676 against 0.444 for Random-Adaptive, and also improved workload and perceived dependability. — [Sensing What Surveys Miss](https://arxiv.org/html/2602.00880v2)
- In a CHI'25 study of proactive coding assistants, users called a constantly suggesting variant "distracting" and "annoying". Lighter suggestion-style variants were rated better. — [Need Help? CHI'25](https://dl.acm.org/doi/10.1145/3706598.3714002)
- An LLM's interruptibility rating correlated with annoyance slightly more strongly than self-reported interruptibility did. — [LLM notification timing](https://dl.acm.org/doi/10.1145/3795011.3795067)
- Pixel 10 Magic Cue:
  - Runs Gemini Nano on Tensor G5.
  - Reads Gmail, Calendar, Keep, Messages and Screenshots, with the user choosing which sources.
  - Shows suggestions inline in Messages, Phone, Weather, notifications and the Gboard strip. Example: a friend asks for an address and a Smart-Reply-like chip appears.
  - The initial index takes up to 24 h.
  - Some explainers say parts use cloud Private AI Compute.
  - An unverified APK teardown says it is being rebranded "Gemini Proactive Assistance".
  
  — [9to5Google](https://9to5google.com/2025/08/20/pixel-10-magic-cue-launch/); [Google blog](https://blog.google/products-and-platforms/devices/pixel/google-pixel-magic-cue-ai-feature/); [GadgetBond](https://gadgetbond.com/google-magic-cue-contextual-ai-suggestions-explained/); [HashLytics](https://hashlytics.io/google-rebrands-pixel-magic-cue-as-gemini-proactive-assistance/)
- Samsung Now Brief and the Personal Data Engine (PDE):
  - Personal data is processed on device and encrypted with Knox Vault keys.
  - Now Brief content changes by time of day and covers schedule, travel, health, events/tasks and memories.
  - Samsung says the data does not go to the cloud.
  - The full experience needs Snapdragon 8 Elite-class hardware.
  - No "knowledge graph" claim was found.
  
  — [Samsung Newsroom](https://news.samsung.com/uk/the-first-step-towards-true-ai-companion); [SamMobile](https://www.sammobile.com/news/now-brief-galaxy-s25-one-ui-7-feature/)

### Inferences
- The reliable recipe is code-generated candidates plus a small model that phrases or ranks them:
  - Triggers: calendar event in N minutes, a message asking a question that a stored fact answers, a reminder due, a morning brief at a learned time.
  - A 0.8B model should not decide *whether* to interrupt. Even GPT-4o is at about 65% F1.
- Anti-annoyance controls, all in code:
  - Cap the proposal rate per day.
  - Prefer passive surfaces (brief card, inline chip) over notifications.
  - Learn per-trigger acceptance and suppress triggers the user keeps dismissing.
  - Gate on interruptibility proxies: screen on, not driving, not in a meeting.
- A Magic-Cue-style "answer the question in an incoming message from my facts" maps directly onto Hermit's messaging read/reply + recall. Retrieved message text must stay behind the untrusted seal.

### Gaps
- No public acceptance or dismissal metrics for Magic Cue, Now Brief, Apple Intelligence, or the parity products (Atomic, Duet, Dots, Grok bot, Instinct, Muse).
- Apple Intelligence personal context and Siri on-device semantic index details were not researched.
- No proactivity benchmark result for models under 7B.

## 4. Context engineering for small windows

### Takeaway
The evidence favors compressed, retrieved memory over full context: full context costs about 16.9k to 26k tokens, Mem0's 2026 retrieval uses about 6.8k to 7k, and Zep cuts latency 90%. Tiered designs (short-term window, mid-term summaries, long-term profile/persona) are the common structure. A small window is better served by a fixed-budget profile card plus top-k facts than by more raw history.

### Cited Findings
- Full-context LoCoMo baselines cost about 16,900 tokens per query (SimpleMem) or about 26,000 tokens per conversation (Mem0 2025). Mem0 2026 retrieval uses about 6,800 to 7,000 tokens per query. — [SimpleMem](https://arxiv.org/pdf/2601.02553); [Mem0 2026](https://mem0.ai/blog/state-of-ai-agent-memory-2026)
- The three-tier STM/MTM/LTM pattern with a fixed retrieval budget shows up in LightMem (SLM-driven) and MemoryOS (LTM holds a user persona or profile). — [LightMem](https://arxiv.org/abs/2604.07798); [MemoryOS](https://arxiv.org/html/2506.06326v1)
- Letta and MemGPT keep editable "core memory blocks" (persona, human) always in context, and a background agent rewrites them. — [Letta](https://www.letta.com/blog/agent-memory)
- Mastra's Observational Memory, which keeps observations compressed rather than raw history, reports 84.23% on LongMemEval with gpt-4o. — [Mastra](https://mastra.ai/research/observational-memory)

### Inferences
- For a 0.8B model with a few-thousand-token budget:
  - A profile card capped at about 150 to 300 tokens, rebuilt in the background from top-heat facts.
  - Top-k (3 to 5) retrieved facts with absolute dates.
  - The last 2 to 4 turns verbatim.
  - A one-line rolling summary.
- Rolling summaries are best written during sleep-time, not mid-turn.

### Gaps
- No ablation found that measures profile-card size against accuracy for models under 4B.

## 5. Privacy-preserving personalization (on-device, federated, local LoRA)

### Takeaway
On-device LoRA personalization is an active research area: DP-FedLoRA, proxy-LoRA (Prada), model reuse with 83% faster personalization, and LoRA on phone NPUs. However, no shipping consumer assistant has been shown to personalize by training weights. Products personalize through retrieval over local data (Magic Cue, Now Brief PDE). For Hermit, retrieval memory is the shippable path. Local LoRA is optional and for later.

### Cited Findings
- "Never Start from Scratch" (MobiSys'25) reuses cached personalized models: 83% faster personalization and 51% better data efficiency. — [arXiv 2504.13938](https://arxiv.org/pdf/2504.13938v1)
- DP-FedLoRA: each client clips LoRA matrices and adds Gaussian noise for (ε,δ)-DP. — [arXiv 2509.09097](https://arxiv.org/abs/2509.09097v1)
- Prada: on-device LoRA tuning of a proxy model that keeps both data and the large model private. — [arXiv 2503.14932](https://arxiv.org/abs/2503.14932)
- First-order LoRA training on Snapdragon phone NPUs was found only through an aggregator and should be verified. — [summary](https://book.st-hakky.com/en/news/first-order-lora-training-phone-npu)
- Federated LoRA that exchanges only LoRA deltas (2024). — [arXiv 2404.09753](https://arxiv.org/pdf/2404.09753)
- Samsung PDE keeps personal data on device under Knox Vault keys with post-quantum crypto. — [Samsung](https://news.samsung.com/uk/the-first-step-towards-true-ai-companion)

### Inferences
- Memory-R1 needed only 152 QA pairs to train a memory manager at 3B. This suggests a small offline (on-Mac) fine-tune of BotPsy for narrow memory slot-filling is feasible. That is not per-user LoRA, and was not tested at 0.8B.

### Gaps
- No evidence of per-user LoRA in any shipping phone assistant.
- No quality or latency numbers for on-phone LoRA training of a sub-1B model.
