# Small-model open-web information agents (0.5B-4B): methods, harness, providers, phone design

Scope note: these notes cover small search agents trained with RL or distillation, code-driven harness techniques (retrieval, reranking, structured extraction), search providers, comparison shopping data, and phone latency. Research date: 2026-11-12. Numbers are self-reported by the papers and vendors unless noted. Benchmarks differ in metric (EM vs F1 vs String-F1 vs LLM-judge accuracy) and retrieval setup (local Wikipedia 2018/2021 dump vs live web), so scores across papers are NOT directly comparable.

## 1. Small search agents trained with RL or distillation: what scores do 0.5B-4B models reach?

### Takeaway
Below 4B, the strongest lever is not more reasoning. It is making the model always search and ground the answer in evidence. The 2026 "Always-Search Policy" paper reports a Qwen3-1.7B at near teacher level on Wikipedia multi-hop QA, and even a Qwen3-0.6B improves a lot (HotpotQA String-F1 19.4 -> 47.0). On open-web "hard browsing" benchmarks (BrowseComp, FRAMES), sub-2B models stay in single digits to the low 20s. Only 4B agents trained with heavy RL (Jan-nano, AgentCPM-Explore, MiroThinker-4B) get usable SimpleQA/GAIA numbers. Retrieval quality, not the small model's reasoning, is the main bottleneck.

### Cited Findings

**Always-Search Policy (ASP), "Search, Do not Guess" (Liu et al., arXiv 2604.04651, Apr 2026). This is the most relevant paper for Hermit.**
- Central failure mode: SLMs (<4B) "invoke search tools less frequently and are more prone to hallucinations" (parametric hallucination), even though they know less. — [arXiv 2604.04651](https://arxiv.org/abs/2604.04651)
- Naively distilling Qwen3-32B agent trajectories into Qwen3-1.7B gives little gain (Bamboogle F1 50.6 -> 53.2). The teacher's trajectories rely on parametric knowledge the student lacks. — [arXiv 2604.04651](https://arxiv.org/pdf/2604.04651)
- Distilled Qwen3-1.7B scores 47.9 vs the teacher's 60.3 on HotpotQA, with 1.89 search calls per question. When the 1.7B gets the teacher's retrieved evidence, accuracy rises to 74.7%, "indicating that the primary performance bottleneck" is retrieval. — [arXiv 2604.04651](https://arxiv.org/pdf/2604.04651)
- ASP recipe: SFT on teacher trajectories filtered by String-F1 >= 0.65. It drops trajectories that answer from memory (for example, "I remember"), adds a system prompt to always search, and then optionally runs on-policy distillation (OPD). Retriever: Qwen3-Embedding-8B over a Wikipedia dump. — [arXiv 2604.04651](https://arxiv.org/pdf/2604.04651); code at github.com/yizhou0409/Agentic-Rag
- Table 1 (String-F1: HotpotQA / 2Wiki / Bamboogle / MuSiQue / BrowseComp(-Plus) / Frames / LongSeAL) — [arXiv 2604.04651](https://arxiv.org/pdf/2604.04651):
  - Vanilla Qwen3-0.6B: 19.4 / 26.0 / 34.4 / 8.7 / 4.6 / 8.9 / 7.4
  - Vanilla Qwen3-1.7B: 42.3 / 39.8 / 50.6 / 22.9 / 3.2 / 15.2 / 9.0
  - Vanilla Qwen3-4B: 53.4 / 54.7 / 69.1 / 28.7 / 7.0 / 28.4 / 8.2
  - Vanilla Qwen3-8B: 58.2 / 58.1 / 71.5 / 32.0 / 16.0 / 30.2 / 10.8
  - Vanilla Qwen3-32B: 60.3 / 69.9 / 73.1 / 32.5 / 21.0 / 36.6 / 13.5
  - ASP SFT-Qwen3-0.6B: 47.0 / 47.4 / 62.9 / 22.7 / 9.0 / 21.0 / 7.0
  - ASP SFT-Qwen3-1.7B: 57.6 / 58.5 / 70.6 / 29.2 / 10.0 / 25.2 / 10.1
  - ASP SFT-Llama-3.2-1B: 44.5 / 48.2 / 64.6 / 22.3 / 8.2 / 18.6 / 9.3
- Adaptive search (letting the model skip search on its top-P% most confident queries) hurts small models. On HotpotQA, SFT-Qwen3-1.7B drops 4.8 points at P=5% and 15.0 at P=10%, while Qwen3-32B drops 0.3 and 0.6. Authors: "the best policy for SLMs is to always search." — [arXiv 2604.04651](https://arxiv.org/pdf/2604.04651)

**Search-R1 (Jin et al., arXiv 2503.09516)**
- PPO/GRPO RL with interleaved `<search>` calls over a 2018 Wikipedia E5 retriever, about 170k training examples (per s3's comparison). v4 table, Qwen2.5-3B EM: Search-R1-base NQ 0.406, TriviaQA 0.587, PopQA 0.435, HotpotQA 0.284, 2Wiki 0.273, MuSiQue 0.049, Bamboogle 0.088, avg 0.303. Search-R1-instruct 3B: NQ 0.341, HotpotQA 0.324. 3B direct inference (no search): NQ 0.106, HotpotQA 0.149. — [Search-R1 v4](https://arxiv.org/html/2503.09516v4); [Search-R1 v3](https://arxiv.org/html/2503.09516v3)
- Caveat: numbers changed between arXiv revisions. Cite the version explicitly. — [Search-R1 v1](https://arxiv.org/html/2503.09516)

**DGPO (OMRON SINIC X, arXiv 2508.20324)**: targets 0.5-1B models that get no reward signal in plain RL. It rewards correct answers and applies a KL pull toward a 3B teacher only on wrong answers. Reported result: a Qwen2.5-0.5B student reaches 44.6 EM on HotpotQA vs 43.5 for the 3B teacher. Checkpoint DGPO-qwen2.5-0.5b is Apache-2.0. — [arXiv 2508.20324](https://arxiv.org/pdf/2508.20324v2); [project page](https://omron-sinicx.github.io/dgpo/); [model listing](https://featherless.ai/models/omron-sinicx/DGPO-qwen2.5-0.5b)

**Orion / "Think Before You Retrieve" (arXiv 2511.07581, Nov 2025)**: trains 350M-1.2B models for iterative retrieval. It uses synthetic-trajectory SFT, RL that rewards query refinement and backtracking, and beam search at inference. — [arXiv 2511.07581](https://arxiv.org/abs/2511.07581v1)

**s3 (Jiang et al., EMNLP 2025, arXiv 2505.14146)**: trains ONLY the searcher with RL and keeps the generator frozen. The reward is "Gain Beyond RAG" (generator accuracy improvement over naive top-k RAG). It uses 2.4k training samples (NQ + HotpotQA cases where naive RAG fails) vs Search-R1's ~170k and DeepRetrieval's ~70k, and claims to beat baselines trained on 70x more data across 6 general and 5 medical QA sets. Searcher Qwen2.5-7B-Instruct; generator Qwen2.5-14B-Instruct (GPTQ-Int4). — [arXiv 2505.14146](https://arxiv.org/html/2505.14146v2); [ACL Anthology](https://aclanthology.org/2025.emnlp-main.1095)

**ZeroSearch (arXiv 2505.04588)**: RL with an LLM that simulates the search engine (no real API cost during training). Average EM: 40.93 for ZeroSearch-base on Qwen2.5-7B and 36.07 on LLaMA-3.2-3B. The simulator ablation with Qwen2.5-3B-Base ranges from 8.82 (no RL) to 31.50 (14B prompt-based simulator). An aggregator lists Qwen2.5-3B averages of 32.66 (base) and 31.72 (inst), provenance unverified. — [ZeroSearch PDF](https://arxiv.org/pdf/2505.04588); [Liner review](https://liner.com/review/zerosearch-incentivize-search-capability-llms-without-searching); [benchmarklist (aggregator)](https://benchmarklist.com/models/zerosearch-base-2/)
- A ZeroSearch-trained Qwen2.5-3B transfers to real SERPER search with a 40.1 average (best CuSearch variant 45.2), in a different setup. — [CuSearch arXiv 2605.11611](https://arxiv.org/pdf/2605.11611)

**StepSearch (EMNLP 2025, arXiv 2505.15107)**: step-wise PPO with information-gain and redundancy-penalty rewards per search step. It reports +11.2% absolute F1 for 3B and +4.2% for 7B over prior search-RL methods on HotpotQA/2Wiki/MuSiQue/Bamboogle (Qwen2.5-3B-Base). — [StepSearch](https://arxiv.org/html/2505.15107v2); [GitHub](https://github.com/IsFaqq/StepSearch)

**R1-Searcher (arXiv 2503.05592)**: two-stage outcome-based RL. Headline numbers are for 7B (beats a GPT-4o-mini ReARTeR baseline by up to 48.22% on HotpotQA and 21.72% on 2Wiki), not small models. — [R1-Searcher](https://arxiv.org/html/2503.05592v2)

**DeepResearcher (arXiv 2504.03160)**: RL in real web environments. It reports up to +28.9 points over prompt-based baselines (7B scale). — [DeepResearcher](https://arxiv.org/pdf/2504.03160v1)

**Jan-nano (Menlo, 4B, arXiv 2506.22760)**: Qwen3-4B trained with multi-stage RLVR and no SFT, on MuSiQue with a local RAG server simulating search. SimpleQA with MCP: 83.2% vs 59.2% for base Qwen3-4B with MCP. 80.7% with a LangGraph ReAct harness vs 76.2% with a smolagents CodeAgent, which the authors attribute to matching the JSON tool-call template used in training. Non-thinking model; recommended temperature 0.7, top-p 0.8, top-k 20. Context reported as 128K in the paper but 40,960 on one host listing. — [arXiv 2506.22760](https://arxiv.org/abs/2506.22760v1); [HF model card](https://huggingface.co/Menlo/Jan-nano); [Featherless](https://featherless.ai/models/Menlo/Jan-nano/readme)

**AgentCPM-Explore (OpenBMB, 4B)**: GAIA (text-only) 63.9%, BrowseComp 25.0%, BrowseComp-ZH 29.0%, xbench-DeepSearch 70.0% (avg@k sampling; different settings from other papers). — [HF README](https://huggingface.co/openbmb/AgentCPM-Explore/blob/main/README.md)

**MiroThinker**: 4B checkpoints (MiroThinker-4B-SFT/DPO-v0.2 on Qwen3-4B) exist. v0.2 figures (BrowseComp-EN 17.2%, BrowseComp-ZH 29.4%, xbench-DeepSearch 56.0%) do not clearly state model size. The v1.0 30B reports GAIA 81.9% and BrowseComp 47.1%. — [GitHub](https://github.com/MiroMindAI/MiroThinker); [arXiv 2511.11793](https://arxiv.org/pdf/2511.11793)

**ASearcher (arXiv 2508.07976, NeurIPS 2025)**: fully asynchronous RL (AReaL) for long-horizon search, with more than 40 to more than 100 tool turns depending on version. Training starts from Qwen2.5-7B/14B base. The flagship QwQ-32B agent's Avg@4 is reported as xBench 51.1 / GAIA 58.1 in one version and 42.1 / 52.8 in a later version (versions conflict). Not a small-model result. — [arXiv 2508.07976 v3](https://arxiv.org/html/2508.07976v3); [NeurIPS page](https://neurips.cc/virtual/2025/128035)

### Inferences
- For BotPsy-0.8B, ASP's 0.6B and 1.7B rows (HotpotQA F1 47-58 after SFT) are a realistic ceiling estimate for Wikipedia-style multi-hop factoid QA with a good retriever. Hard browsing (BrowseComp, Frames) stays poor (about 9-25 F1) even at 1.7B. "Open-ended deep research" on device should be scoped to factoid and lookup tasks, not BrowseComp-style puzzles.
- Three cheap, transferable recipes fit Hermit's eval-lab approach: (a) ASP-style SFT (always search, reject memory-based trajectories, filter by answer F1); (b) DGPO-style teacher-guided RL for sub-1B models; (c) s3-style training of only the query/search component with a tiny dataset (2.4k), which suits a small fine-tune budget.
- Jan-nano's 80.7 vs 76.2 gap shows that harness/template mismatch alone costs about 4.5 points at 4B. Hermit's tool-call format should exactly match the fine-tune template.
- Because the 1.7B jumps to 74.7% when given better evidence, Hermit should spend compute on code-side retrieval (query expansion, reranking, structured extraction) before spending it on more LLM turns.

### Gaps
- No verified 0.5B/1.5B numbers for Search-R1, ZeroSearch, R1-Searcher, or StepSearch were found. Most of these papers report only at 3B/7B+.
- II-Search (4B) scores were not found. Qwen3-0.6B/1.7B results on live-web benchmarks (SimpleQA/GAIA) outside the ASP paper were not found.
- No Spanish or LatAm benchmark for small search agents was found. All results above are English (plus some Chinese).
- WebThinker's headline is 32B. No small-model numbers were found.

## 2. Harness designs where code does the crawling (retrieval, reranking, structured extraction, map-reduce, citations)

### Takeaway
Small models can only stay within a small context budget if code does the heavy lifting. Code should handle query expansion, fetching, boilerplate removal, schema.org/JSON-LD parsing, and embedding-based chunk selection plus a 0.6B reranker, so the LLM sees only a few hundred tokens of high-signal evidence. Qwen3-Reranker-0.6B is the strongest small multilingual reranker found, well ahead of bge-reranker-v2-m3 at the same size, but its GGUF/llama.cpp path has known breakage to test first.

### Cited Findings
- Qwen3-Reranker-0.6B (0.6B, 32K context, 100+ languages): MTEB-R 65.80, CMTEB-R 71.31, MMTEB-R 66.36, MLDR 67.28, MTEB-Code 73.42. Comparisons: bge-reranker-v2-m3 (0.6B) MTEB-R 57.03 / MMTEB-R 58.36. gte-multilingual-reranker-base (0.3B) 59.51 / 59.44. Jina-multilingual-reranker-v2-base (0.3B) 58.22 / 63.73. Qwen3-Reranker-4B 69.76 / 72.74. Scores rerank the top-100 candidates from Qwen3-Embedding-0.6B. — [Qwen3-Reranker-0.6B model card](https://huggingface.co/Qwen/Qwen3-Reranker-0.6B)
- Qwen3-Embedding-0.6B MTEB-R as first-stage retriever is 61.82 per a third-party copy of Qwen's table (unverified). — [Mungert GGUF repo](https://hface.pages.dev/Mungert/Qwen3-Embedding-0.6B-GGUF); [Qwen3 Embedding paper](https://arxiv.org/html/2506.05176v1); [Qwen blog](https://qwenlm.github.io/blog/qwen3-embedding)
- GGUF caveats: an official ggml-org Q8_0 conversion exists. One repo says the 0.6B reranker needed an unmerged llama.cpp fix and that other quants fail in mainline. Another reports early conversions returning scores near zero on `/v1/rerank` and offers a fixed Q8_0. Run with `llama-server --reranking --pooling rank --embedding`. — [ggml-org Q8_0](https://huggingface.co/ggml-org/Qwen3-Reranker-0.6B-Q8_0-GGUF); [cicaba fixed](https://huggingface.co/cicaba/Qwen3-Reranker-0.6B-GGUF-llamacpp-fixed); [Voodisss](https://huggingface.co/Voodisss/Qwen3-Reranker-0.6B-GGUF-llama_cpp)
- s3's design (searcher trained separately, frozen generator, reward = gain over naive RAG) formalizes "search/retrieval is a separable component" that can be swapped for code plus a tiny model. — [s3](https://arxiv.org/html/2505.14146v2)
- Structured data coverage: JSON-LD is used by 70% of websites that annotate structured data (WDC Oct 2024 crawl). WDC publishes class-specific subsets for about 50 schema.org classes, including Product and LocalBusiness. — [WDC 2024 release](https://www.uni-mannheim.de/dws/news/wdc-json-ld-microdata-rdfa-data-corpus-2024-published)
- 51.25% of 2.4B HTML pages in the Oct 2024 Common Crawl contained some structured data (secondary summary). HTTP Archive 2024 mobile pages show LocalBusiness on 3.97%. — [SearchLab summary](https://searchlab.nl/statistieken/structured-data-rich-results-statistieken-2026); [HTTP Archive Almanac 2024 structured data](https://almanac.httparchive.org/en/2024/structured-data)
- Main-content extraction quality: MinerU-HTML reports 81.8% ROUGE-N F1 vs 63.6% for trafilatura on its 7,887-page MainWebBench. Classic heuristic extractors lose about 20 points vs a learned extractor on that benchmark. — [via fugumt summary](https://fugumt.com/fugumt/paper_check/2503.01151v1_enmode)
- ReaderLM-v2 (Jina, 1.5B, Qwen2.5-1.5B-Instruct base, up to 512K tokens) converts HTML to Markdown/JSON. Markdown ROUGE-L 0.86, claimed about 24.6% above GPT-4o. License CC-BY-NC-4.0 (not usable commercially without a license). — [alphaxiv overview](https://alphaxiv.org/overview/2503.01151v1); [Jina model page](https://jina.ai/models/ReaderLM-v2/); [HF](https://huggingface.co/jinaai/ReaderLM-v2)

### Inferences
- Proposed code-first pipeline per hop: (1) code-side query expansion (the user query plus 1-3 template rewrites, for example adding "horario", the city, or "precio"; or a short LLM rewrite at about 30 output tokens); (2) parallel search API calls; (3) snippet-level rerank with Qwen3-Reranker-0.6B to choose 2-4 URLs; (4) parallel fetch; (5) extract JSON-LD/microdata first (Product/Offer price, priceCurrency, availability; LocalBusiness openingHoursSpecification, address, telephone). If the needed field exists, answer from code-rendered facts with no reader LLM pass; (6) otherwise run Readability-style boilerplate removal, chunk into about 256-token passages, embed and rerank against the question, and pass the top 2-3 chunks to the quarantined reader (map step). Each reader call returns a typed `{claim, value, quote, url}` record; (7) the planner LLM reduces records into an answer with numbered citations rendered by code.
- "Read less" heuristics that fall out of this: stop after the first source whose structured field answers the question (hours, price). Require two agreeing sources only for numeric or contested claims. Cap pages per hop at 3.
- Since ASP shows small models benefit from mandatory retrieval, the harness should force at least one search for any web-intent turn, not let BotPsy decide whether to search.
- The reranker and embedder could share the llama.cpp runtime. Running a 0.6B reranker over about 10 snippets x 100 tokens is about 1k prompt tokens, roughly 5 s at Hermit's ~200 tok/s if run on the same backend. Batch carefully, or use a smaller embedder for the snippet stage. This estimate assumes the 0.6B runs at a similar speed to BotPsy-0.8B, which is unmeasured.

### Gaps
- Page-level prevalence of Product/Offer/openingHours JSON-LD (especially on LatAm sites) was not found. The WDC class-subset statistics page would need to be queried.
- No head-to-head of Qwen3-Reranker-0.6B vs bge-reranker-v2-m3 on Spanish specifically was found (MMTEB-R is multilingual in aggregate).
- No measured on-phone latency for Qwen3-Reranker-0.6B or Qwen3-Embedding-0.6B was found.

## 3. Search providers for a privacy-first client, and on-device page extraction

### Takeaway
Brave Search API (own index, about $5 per 1k requests with $5 in monthly credit) is the best-documented privacy-oriented paid option. Exa and Tavily are AI-oriented and cost more per query. SearXNG self-hosting has no API fee but adds a server and inherits the upstream engines' terms. On device, Kotlin ports of Mozilla Readability (Readability4J, Readability4K) are the practical extractors. No trafilatura JVM port was found.

### Cited Findings
- Brave Search API: per-request billing. Search about $5 per 1,000 requests; Answers about $4 per 1,000 plus $5 per million tokens; $5 free monthly credit. The older 2,000-queries/month free plan reportedly ended in Feb 2026. Sources are third-party and conflict, so confirm on Brave's pricing page. — [Activepieces](https://www.activepieces.com/blog/brave-search-api-pricing-plans-limits-cost-2026); [apiserpent](https://apiserpent.com/blog/free-brave-search-api); [CostBench](https://www.costbench.com/software/ai-search-apis/brave-search-api/)
- Brave Search plan: $5 per 1,000 requests, 50 QPS limit. — [ecorpit comparison](https://ecorpit.com/agent-web-search-api-cost-comparison-2026/)
- Exa: Auto search $7 per 1,000 requests (up to 10 results, +$1 per 1k per extra result). A "lite" tier at $4 per 1,000 with about 450 ms latency was added 2026-10-19. Prepaid credits, no subscription. — [ecorpit comparison](https://ecorpit.com/agent-web-search-api-cost-comparison-2026/); [apicostcalc Exa](https://apicostcalc.com/exa.html)
- Tavily: basic search 1 credit, advanced 2 credits. About $0.008 per credit pay-as-you-go (~$8 per 1k basic). Plans run $30-$500 per month, with the lowest rate about $5 per 1k on the $500 plan. — [codenote comparison](https://codenote.net/en/posts/tavily-alternatives-cost-comparison-search-extract-api/); [ecorpit](https://ecorpit.com/agent-web-search-api-cost-comparison-2026/)
- Parallel and Perplexity Search "fast" modes are listed at about $1 per 1k. — [ecorpit](https://ecorpit.com/agent-web-search-api-cost-comparison-2026/)
- SearXNG: self-hosted, no API fee, about $5-10 per month VPS. — [ecorpit](https://ecorpit.com/agent-web-search-api-cost-comparison-2026/)
- Note from one analysis: page-text extraction can cost more than the search call itself for agents. — [beri.net](https://www.beri.net/article/tavily-vs-exa-vs-brave-vs-perplexity-search-api-agent-cost-2026)
- Mojeek: independent crawler and index, no tracking, API lets you control snippet length and mix results with LLMs. One listing gives API pricing "from £2" (possibly outdated). — [Mojeek blog](https://blog.mojeek.com/2023/03/reasons-to-use-the-mojeek-search-api.html); [europeanstack](https://europeanstack.pages.dev/software/mojeek)
- Kagi uses its own index plus Mojeek and other APIs. DuckDuckGo results rely largely on Bing, and no public DDG web-search API was found. — [Kagi help](https://help.kagi.com/kagi/why-kagi/kagi-vs-duckduckgo.html); [alwilde comparison 2026](https://com-alwilde.pages.dev/blog/2026/03/comparing-search-engines-2026/)
- On-device extraction:
  - Readability4J is a Kotlin port of Mozilla Readability.js, Apache-2.0, v1.0.8, last updated about 4 years ago, used by F-Droid apps.
  - Readability4K is a KMP port (Android API 26+).
  - Klead is a KMP extractor used experimentally in FeedFlow.
  - Crux (Chimbori) is a plugin-based Kotlin extractor.
  - No trafilatura JVM port was found.
  — [Readability4J](https://github.com/dankito/Readability4J); [Readability4K](https://github-users.yhajoa.workers.dev/Sermilion/readability4k); [Klead](https://klibs.io/project/prof18/klead); [Crux](https://github.com/readwise/crux)

### Inferences
- Privacy posture options: (a) the phone calls Brave directly (the provider sees the query and IP; simplest); (b) a thin Hermit relay strips identifiers and holds the API key (the provider sees the relay, not the user, but Hermit's server sees queries); (c) a self-hosted SearXNG relay (no API fee, but it scrapes upstream engines, which brings ToS and blocking risk). A key embedded in the APK would be extractable, so a relay is likely needed anyway for key protection.
- Page fetching from the phone exposes the user's IP to every site read. That is the same as browsing, but should be stated in the privacy copy.
- ReaderLM-v2 is non-commercial and 1.5B (bigger than BotPsy). Use Readability4J plus JSON-LD parsing on device instead.

### Gaps
- Kagi Search API current pricing and terms, Mojeek current API pricing, and DuckDuckGo API availability were not verified from primary pages.
- No Spanish or LatAm result-quality comparison across Brave, Exa, Tavily, Mojeek, or SearXNG was found. This should be measured in Hermit's eval lab with a Spanish query set.
- Provider terms on storing or caching results and showing them in an AI answer were not reviewed.

## 4. Comparison shopping and price tasks: structured product data sources

### Takeaway
Production shopping assistants such as Perplexity do not rely on reading pages with an LLM. They combine merchant feeds (Google Merchant Center format) with crawled product pages, and both carry structured price, availability, and seller fields. For Hermit, the phone-feasible analog is to parse schema.org Product/Offer JSON-LD in code and only fall back to the reader.

### Cited Findings
- Perplexity Shopping retrieves product candidates from two sources: enrolled Merchant Program brands and its crawler indexing public product pages. — [Everything PR](https://everything-pr.com/how-perplexity-shopping-works-for-brands-the-answer-layer-that-skips-the-category-page)
- The Perplexity Merchant Program is free and uses Google Shopping / Merchant-Center-compatible feeds. Feeds carry pricing, specs, availability, reviews, and seller ratings. — [Productsup](https://www.productsup.com/blog/what-is-perplexity-ai-shopping-key-features-pricing-and-use-cases/); [alhena.ai guide](https://alhena.ai/blog/perplexity-shopping-merchants-setup-guide/); [BigCommerce](https://www.bigcommerce.com/blog/perplexity-shopping/)
- Shopify Catalog syndicates product data automatically to connected AI platforms including Perplexity. BigCommerce/Feedonomics also partner with Perplexity. — [Shopify](https://www.shopify.com/blog/perplexity-shopping); [ChannelX](https://channelx.world/2025/06/bigcommerce-and-feedonomics-team-up-with-perplexity/)
- Checkout runs through PayPal; the merchant fulfills. The ranking method is unpublished. — [MediaPost](https://www.mediapost.com/publications/article/401224/perplexity-takes-on-google-intros-shopping-for-u.html); [Shopify](https://www.shopify.com/blog/perplexity-shopping)

### Inferences
- "Find me the cheapest X" on device: search with shopping-intent query templates (product plus "precio", country TLD or site filters for major LatAm retailers). Fetch the top N product pages in parallel. Parse JSON-LD `Product.offers` (price, priceCurrency, availability, seller) in code. Normalize currency and units in code. Sort in code. The LLM only writes the final sentence. This avoids asking a 0.8B model to compare numbers, which is a known weak spot.
- Marketplace pages (for example, regional marketplaces) may block bots or render prices with JS. Expect failures. Report "could not verify price on site X" rather than guessing.

### Gaps
- No evidence was gathered on a Google Shopping API usable by third-party clients, or on LatAm retailer JSON-LD coverage. Both need verification.
- No published architecture details for Perplexity's ranking or price-freshness logic. Most sources are vendor marketing.

## 5. Latency budget for multi-hop research on a phone, and making it feel fast

### Takeaway
At about 200 tok/s prompt processing, every 1k tokens the LLM reads costs about 5 s, so LLM reading time dominates the budget, not network time. A 2-hop task is feasible in roughly 20-40 s only if code reduces each page to a few hundred tokens and network calls run in parallel. Streaming structured partial findings ("Found 3 stores; Store A: 9:00-18:00...") is the main perceived-speed lever.

### Cited Findings
- Exa lite search is about 450 ms per call. — [ecorpit comparison](https://ecorpit.com/agent-web-search-api-cost-comparison-2026/)
- Brave allows up to 50 QPS on the Search plan, so parallel query fan-out is not rate-limited in practice for one user. — [ecorpit comparison](https://ecorpit.com/agent-web-search-api-cost-comparison-2026/)
- The distilled 1.7B averaged 1.89 search calls per HotpotQA question. Small agents need only about 2 searches for 2-hop questions. — [arXiv 2604.04651](https://arxiv.org/pdf/2604.04651)
- ASearcher-style long-horizon agents use more than 40 to more than 100 tool turns and 150k-400k generated tokens, far beyond any phone budget. — [arXiv 2508.07976](https://arxiv.org/html/2508.07976v3)

### Inferences (estimates, not measurements)
- Illustrative 2-hop budget with Hermit's ~200 tok/s prompt processing:
  - Search x2 in parallel: about 0.5-1 s each.
  - Fetch 3 pages in parallel: about 1-3 s on mobile.
  - Readability plus JSON-LD in code: under 0.5 s.
  - Reranking snippets and chunks: unknown (see section 2).
  - Reader passes: 3 x about 600 tokens in = about 9 s prefill, plus short typed outputs.
  - Planner context: about 1.5k tokens = about 7.5 s.
  - Answer generation: not estimated (no decode speed figure).
  - Total: roughly 20-30 s per hop pair. Structured-data hits (hours, price) skip the reader entirely and could land in under 5 s.
- Tricks:
  - Start searches while the planner is still decoding (speculative query from code templates).
  - Fetch in parallel.
  - Stream each typed reader record to the UI as it arrives.
  - Show sources first.
  - Cache by URL and ETag.
  - Reuse the KV cache for the fixed system prompt (Hermit already has QVAC KV cache on).
  - Cap hops at 2-3 and fail gracefully with partial findings.

### Gaps
- No published on-device (Android) end-to-end latency measurements for a small-model web agent were found.
- No measured mobile page-fetch latency distribution for LatAm sites was found.
