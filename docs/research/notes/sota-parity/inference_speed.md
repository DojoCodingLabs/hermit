# Inference speed for small agent LLMs on Android flagships (Hermit: BotPsy-0.8B, Qwen3.5 hybrid, QVAC/llama.cpp, Galaxy S26)

Research date: 2026-11-12. Primary sources are llama.cpp merged PRs (read via `gh`), the Qwen3.5-0.8B config on Hugging Face, Google LiteRT-LM docs, QVAC docs, and one Qualcomm GenieX issue with on-device measurements. Several areas in scope (MLC-LLM, ExecuTorch, MNN, Genie numbers, PowerInfer-2, llm.npu, HeteroLLM) were not covered and are listed as gaps.

Baseline arithmetic for Hermit (inference, not a source): a ~1,800-token system prompt at ~200 tok/s prefill is ~9 s by itself, which matches the 7 to 11 s median turn. Prefill on an uncached prefix is the dominant cost, so caching the static prefix matters more than any kernel or decode change.

## Q1. Prefill: why it is slow on CPU and what helps (repacking, threads, ubatch, Hexagon NPU, OpenCL Adreno, Vulkan, other runtimes), with 8 Elite numbers

### Takeaway
On Snapdragon 8 Elite class CPUs, llama.cpp prefill for ~1B Q4_K_M models sits around 170 to 200 tok/s, which matches Hermit's measurement. The GPU (OpenCL Adreno) gives about 4x prefill, and the NPU gives more, but both have op-coverage and quant-format limits. The gated DeltaNet ops and Q4_K matmul are the risks for Hermit. Q4_0 with online repacking is the cheapest CPU-side win to test.

### Cited Findings
- Snapdragon 8 Elite (SM8750 QRD), Gemma-3 1B Q4_K_M, `llama-bench -p 128 -n 64`: CPU 8 threads prefill 171 to 173 tok/s, decode 62 to 64 tok/s. GPU (OpenCL) prefill 717 to 723 tok/s, decode 41.5 to 42.5 tok/s. The author recommends OpenCL for prefill and CPU for decode. Vulkan is reported broken for quantized inference on this chip. llama.cpp commit 8e8681e (2026-07-27) — [alpharomercoma/snapdragon-vs-mediatek](https://github.com/alpharomercoma/snapdragon-vs-mediatek)
- Snapdragon 8 Elite Gen 5 (Qualcomm Device Cloud, llama.cpp b10549, issue dated 2026-11-11): NPU (Hexagon backend) prefill was the fastest prefill pairing for every model tested (0.6B to 4B). Gemma 3 1B: NPU prefill + CPU decode took 80% of CPU-only time (decode 53.1 tok/s), NPU prefill + NPU decode 91% (46.8 tok/s). LFM2.5 1.2B: NPU prefill + CPU decode 86% of CPU-only time (50.4 tok/s), all-NPU 106%. GPU decode was never fastest. CPU decode beat NPU decode for the ~1B models. Absolute prefill tok/s not reported. The Hexagon backend does not implement `offload_op`, so mixed pairings had to run each phase in separate contexts — [qualcomm/GenieX #1666](https://github.com/qualcomm/GenieX/issues/1666)
- Snapdragon 8 Elite, Qwen3-4B Q4_0 decode: llama.cpp Hexagon about 12 tok/s vs about 26 tok/s for Qualcomm's own HTP engine (April 2026). A user reported that the Hexagon matmul path does not support Q4_K, and that using Q4_K loses the Hexagon speedup — [llama.cpp discussion #21702](https://github.com/ggml-org/llama.cpp/discussions/21702)
- Hexagon backend in upstream llama.cpp is under very active development in 2026: Q4_0 and MXFP4 repack fixes (merged 2026-03-14, #20527), HMX flash attention (2026-05-02, #22347), flash-attention rework (2026-07-01, #25085), device discovery and on-demand sessions (2026-08-30, #27785), `GGML_HEXAGON_VTCM_SIZE` (2026-10-26, #31221), multicore HMX FA (2026-10-24, #31055), Q5_0/Q5_1 support (2026-11-12, #32094) — [llama.cpp PR search, merged](https://github.com/ggml-org/llama.cpp/pulls?q=is%3Apr+is%3Amerged+hexagon) (titles and dates read via `gh search prs`)
- An older fork of ggml-hexagon reported 8 Elite prefill of only 35 to 37 tok/s (fork, not upstream, inconsistent) — [zhouwg/ggml-hexagon discussion #18](https://github.com/zhouwg/ggml-hexagon/discussions/18) (search snippet only)
- Online repacking of Q4_0 for aarch64 GEMM/GEMV (PR #9921, merged 2024-11-15): on Graviton 3, phi-2 Q4_0, 4 threads, prefill pp512 went from 38.0 to 110.8 tok/s (2.9x) and decode from 16.95 to 39.42 tok/s (2.3x) with repacking on — [llama.cpp #9921](https://github.com/ggml-org/llama.cpp/pull/9921)
- IQ4_NL also has a runtime repack (IQ4_NL_4_4, merged 2024-11-28) — [llama.cpp #10541](https://github.com/ggml-org/llama.cpp/pull/10541). `llama-bench` gained a `--repack` switch (2026-09-26) for A/B testing — [llama.cpp #28968](https://github.com/ggml-org/llama.cpp/pull/28968)
- KleidiAI (Arm micro-kernels) in llama.cpp: SME2 Q4_K and Q6_K matmul support merged 2026-10-13, Q8_0 SVE 256-bit kernels 2026-10-22 — [llama.cpp #29219](https://github.com/ggml-org/llama.cpp/pull/29219); [llama.cpp #30808](https://github.com/ggml-org/llama.cpp/pull/30808)
- Thread pinning on Android was broken in llama.cpp until 2026-08-10: `-C/--cpu-mask` and `--cpu-strict` were silently ignored on Android, because the affinity code was guarded by `__gnu_linux__`, which Android clang does not define. Every thread kept the full CPU set. Fixed in #26838 — [llama.cpp #26838](https://github.com/ggml-org/llama.cpp/pull/26838)
- Google LiteRT-LM on Samsung S26 Ultra: Gemma4-E2B CPU prefill 557 tok/s, decode 47; GPU prefill 3,808 tok/s, decode 52, TTFT 0.3 s vs 1.8 s on CPU. Gemma4-E4B: CPU 195/18, GPU 1,293/22. Other rows: Qwen2.5-1.5B on S25 Ultra CPU 298/34, GPU 1,668/31. FunctionGemma (270M) on S25 Ultra CPU 2,238/154. Qwen3-0.6B on Vivo X300 Pro CPU 165/9, GPU 580/21. Gemma3-1B on S24 Ultra CPU 177/33, GPU 1,191/24. Prompt lengths not stated. NPU listed as supported on Android — [LiteRT-LM overview](https://developers.google.com/edge/litert-lm/overview)
- LiteRT on the Snapdragon 8 Elite Gen 5 NPU: FastVLM over 11,000 tok/s prefill and over 100 tok/s decode — [Google Developers Blog](https://developers.googleblog.com/unlocking-peak-performance-on-qualcomm-npu-with-litert/) (search snippet). Open LiteRT-LM bug: on Qualcomm NPU, Gemma 3 270M/1B bundles lose every prefill chunk after the first — [LiteRT-LM #3508](https://github.com/google-ai-edge/LiteRT-LM/issues/3508)
- Qwen3.5-0.8B architecture: 24 layers, hidden 1,024, pattern of 3 `linear_attention` (Gated DeltaNet) layers per 1 `full_attention` layer (6 full-attention layers, 2 KV heads, head_dim 256), vocab 248,320, tied embeddings, `mtp_num_hidden_layers: 1` — [Qwen/Qwen3.5-0.8B config.json](https://huggingface.co/Qwen/Qwen3.5-0.8B/raw/main/config.json)

### Inferences
- Hermit's ~200 tok/s prefill is normal for llama.cpp CPU Q4_K_M at this size on 8 Elite class (Gemma-3 1B: 171 tok/s). The CPU path has little headroom left except Q4_0 repack and KleidiAI kernels, so expect gains in the 1.2x to 2x range at most, not 10x. The 2.9x from #9921 was vs a non-repacked Q4_0 baseline on Graviton, not vs Q4_K_M on Oryon.
- Prefill is compute-bound (big GEMMs over all prompt tokens), decode is memory-bandwidth-bound (GEMV). That is why GPU/NPU help prefill a lot (4x to 20x) but help decode little or not at all at 1B, which the 8 Elite data shows (OpenCL decode 42 vs CPU 63; NPU decode slower than CPU for ~1B models).
- For a 0.8B model, a large share of compute sits in the 248k-vocab output head. For prefill, llama.cpp only computes logits for the last token by default, so this matters mainly for decode. Worth checking that QVAC does not request all logits during prefill.
- Best-case hardware path for Hermit: NPU or GPU for prefill, CPU for decode. But Hermit's blockers are (a) Q4_K_M is not supported by Hexagon matmul (needs Q4_0 or similar), (b) the Gated DeltaNet / SSM ops must be implemented on Hexagon or OpenCL, otherwise layers fall back to CPU with tensor copies. I did not confirm Gated DeltaNet op support on OpenCL or Hexagon (only WebGPU has a fused gated_delta_net op, #28976).
- Check which llama.cpp commit QVAC Fabric pins. If it predates 2026-08-10, the device-adaptive runtime's `cpu-mask` is a no-op on Android (#26838), and threads may land on efficiency cores or contend with UI threads.
- LiteRT-LM GPU numbers on S26 Ultra (3,808 tok/s prefill for E2B) show what a production GPU path achieves. A 1,800-token prompt would take ~0.5 s instead of ~9 s. Hermit cannot use this without converting BotPsy to LiteRT format, and LiteRT-LM support for the Qwen3.5 hybrid architecture is not confirmed.

### Gaps
- No absolute Hexagon prefill tok/s on 8 Elite or 8 Elite Gen 5 for a ~1B model from upstream llama.cpp. The GenieX issue gives relative times only.
- No data on whether Oryon (8 Elite / 8 Elite Gen 5) exposes SVE or SME2 to userspace, which decides whether KleidiAI SVE/SME2 kernels apply. Not verified.
- Did not confirm whether aarch64 Q4_K has an i8mm repack path in current llama.cpp (searched `q4_K repack aarch64`, no merged PR found).
- No measured ubatch-size sweep for small hybrid models on phone.
- MLC-LLM, ExecuTorch, MNN, Qualcomm Genie / AI Hub numbers, and the PowerInfer-2 / llm.npu / HeteroLLM papers were not covered.

## Q2. Prompt caching: persistent prefix KV, slot reuse, cache_reuse / KV shifting, keeping tool schemas cached; hybrid recurrent caveats

### Takeaway
For hybrid DeltaNet models, any change before the end of the cached prefix forces a full re-prefill, unless a context checkpoint exists at or before the divergence point. `cache_reuse` / KV shifting does not work. QVAC's tool-block handling (the tool block near the start of the prompt, rotated or trimmed per turn) is the likely cause of Hermit's re-prefill on tool-call turns. The fix is a byte-stable, append-only prefix (system + all tool schemas first, nothing variable before them) plus checkpoints, saved to disk once.

### Cited Findings
- llama.cpp PR #16382 (merged 2025-10-03) generalized SWA checkpointing to recurrent and hybrid models. `--swa-checkpoints` became `--ctx-checkpoints`, and the flag `LLAMA_STATE_SEQ_FLAGS_CHECKPOINT_ONLY` was added. It "removes the need to re-process the entire context in the majority of cases" — [llama.cpp #16382](https://github.com/ggml-org/llama.cpp/pull/16382)
- A recurrent state cannot be rewound. Without a checkpoint at or before the divergence point, the server logs "forcing full prompt re-processing due to lack of cache data", even when the new prompt shares a long prefix. Checkpoints were not part of slot save files until PR #26004 (merged 2026-10-08), which appends them to the `llama_state_seq_save_file` payload. Its test: a divergent re-prompt after restore processed 31 tokens with the fix vs 210 (full) without — [llama.cpp #26004](https://github.com/ggml-org/llama.cpp/pull/26004)
- Checkpoints are host-side copies of the state. Example log: one checkpoint of `size = 90.030 MiB` for gpt-oss-120b — [llama.cpp #18471](https://github.com/ggml-org/llama.cpp/pull/18471). Checkpoints became reference-counted instead of deep-copied (2026-11-05) — [llama.cpp #30137](https://github.com/ggml-org/llama.cpp/pull/30137). Fix for checkpoint eviction on prompts shorter than `checkpoint_min_step` (2026-09-08) — [llama.cpp #28302](https://github.com/ggml-org/llama.cpp/pull/28302)
- Known failure reports: `cache-reuse` is not effective on qwen3-next ([llama.cpp #18497](https://github.com/ggml-org/llama.cpp/issues/18497)). Qwen 3.6 forces full re-processing ([#22746](https://github.com/ggml-org/llama.cpp/issues/22746)). `/slots` restore gives no reuse on hybrid models ([#28194](https://github.com/ggml-org/llama.cpp/issues/28194), addressed by #26004). ik_llama.cpp checkpoints never restored for qwen3next ([ik_llama.cpp #1762](https://github.com/ikawrakow/ik_llama.cpp/issues/1762)). Agent harnesses that edit the request tail force re-prefill every step on hybrid models ([QwenLM/qwen-code #14203](https://github.com/QwenLM/qwen-code/issues/14203))
- Third-party guide summary (search snippet, page paywalled): checkpoints on by default (`--ctx-checkpoints 32`). In its test, a hybrid Qwen3.5 chat reprocessed a few dozen tokens per turn with checkpoints vs the full prompt with `--ctx-checkpoints 0`. KV shifting (`--cache-reuse`) is what SWA and recurrent memory cannot do. Advice: keep prompts strictly append-only — [7minai guide](https://7minai.com/llama-server-context-checkpoints-hybrid-swa-models/); [Big Iron guide](https://www.bigiron.cc/guides/llama-server-keeps-reprocessing-the-whole-prompt-on-hybrid-and-swa-models)
- QVAC: the `kvCache` option takes a string key or `true` (auto key). The docs state "The tool block sits near the start of the prompt", and that after a deferred tool load the next turn "re-processes most or all of the prompt instead of reusing the cached prefix." Deferred tools put only name + description in a `tool_search` catalog. The text-generation page does not mention saving or loading the cache to or from disk — [QVAC text generation docs](https://docs.qvac.tether.io/ai-capabilities/text-generation.md)
- QVAC v0.10.0 release notes (via search snippet): each completion call can pass a different tools array, and "the addon trims the previous tool block from the KV cache so rotation is free". A QVAC blog describes "dynamic compaction" that removes transient tool definitions and raw tool outputs after the final answer. SDK 0.12.0 adds opt-in TurboQuant KV compression (16-bit to ~3 bits/value) — [QVAC release notes](https://docs.qvac.tether.io/sdk/release-notes/); [QVAC API v0.12.x](https://docs.qvac.tether.io/reference/api.md)
- QVAC is built on QVAC Fabric, a fork of llama.cpp — [QVAC API reference](https://docs.qvac.tether.io/reference/api/) (search snippet)

### Inferences
- Likely root cause of Hermit's "QVAC rolls the cache back on tool-call turns": trimming the tool block or compacting tool outputs removes tokens from the middle of the sequence. On a pure-attention model that is a cheap KV edit. On Qwen3.5 the 18 DeltaNet layers hold a single running state that already absorbed those tokens, so the runtime has to restore a checkpoint from before the edit, or re-prefill from scratch. With the tool block near the start, that means re-prefilling almost all of the ~1,800 tokens (~9 s).
- Concrete fixes for Hermit, in order of expected gain:
  1. Make the prefix byte-stable: system prompt + full tool schemas in a fixed order, then nothing variable (no timestamps, no memory snippets, no per-turn tool subsets) before the conversation. Pass the same tools array every call and turn off tool rotation, deferred tools and compaction for the hot path.
  2. Make the conversation append-only: never rewrite earlier turns, tool outputs or reasoning. Summarise only at session boundaries, accepting one full re-prefill there.
  3. Save the post-prefix state to disk once per app version / prompt version (`llama_state_seq_save_file` plus checkpoints, per #26004), and restore it at startup. Then a cold app start skips the ~9 s prefill too. This needs QVAC to expose state save/load, or a patch to the Fabric fork.
  4. Make sure a checkpoint is taken exactly at the end of the static prefix (and ideally at the end of each assistant turn). Then any divergence after it (a retried call, or a second model call in the same turn with a different suffix) only re-processes the suffix. In llama.cpp, checkpoints are created after processed prompts or at ubatch boundaries, so splitting the prefix decode into its own call is the reliable way to put one there.
- Multiple model calls per turn (planner, then tool call, then answer) should share one sequence and only append. A planner call whose output is discarded before the next call forces a rollback past the DeltaNet state, which costs a checkpoint restore at best. Alternative: keep two slots (sequences), each with its own stable prefix, one per call type. Each slot then only ever appends. Cost: memory of two states, which is small at 0.8B (6 attention layers x 2 KV heads x 256 dim).
- Expected gain: tool-call turns go from ~9 s of prefill to a few hundred new tokens (~1 to 2 s), possibly the single largest latency win available.

### Gaps
- Did not read QVAC Fabric source to confirm exactly how tool-block trimming interacts with the recurrent state, or whether it creates checkpoints. Needs a code read or a log (look for "forcing full prompt re-processing").
- Per-checkpoint memory size for Qwen3.5-0.8B not measured. Estimate from config: 18 DeltaNet layers x 16 heads x 128 x 128 float32 state, roughly 19 MB plus conv state (inference, unverified).

## Q3. Speculative decoding on device: draft models, n-gram / prompt lookup, EAGLE-3, Qwen3.5 MTP; llama.cpp status; value for short outputs

### Takeaway
Upstream llama.cpp now supports MTP (May 2026), EAGLE-3 for Qwen3.5 (June 2026), several n-gram drafters, and draft verification with recurrent-state rollback snapshots. QVAC exposes `spec_type` with MTP and DFlash. Qwen3.5-0.8B ships with one MTP layer. For Hermit's short outputs, decode is a minor share of turn time, so this is a second-tier lever behind prefix caching. Gains are only certain if BotPsy's MTP head survived fine-tuning.

### Cited Findings
- MTP support merged in llama.cpp on 2026-05-16 (#22673). The MTP head loads from the same GGUF with its own context. About 75% steady-state acceptance with 3 draft tokens, "more than >2x speed-up over baseline" on Qwen3.6 27B / 35B-A3B. Caveat: "Prompt processing (PP) speed typically takes a negative hit when MTP is enabled mainly due to Device-To-Host (D2H) embedding transfers." — [llama.cpp #22673](https://github.com/ggml-org/llama.cpp/pull/22673). Follow-ups: qwen35 post-norm hidden state for MTP (2026-06-03, #24025), save/restore MTP hidden state (2026-11-03, #30141), store MTP conv snapshots for recurrent models (2026-11-05, #31660) — [llama.cpp #24025](https://github.com/ggml-org/llama.cpp/pull/24025); [#30141](https://github.com/ggml-org/llama.cpp/pull/30141); [#31660](https://github.com/ggml-org/llama.cpp/pull/31660)
- EAGLE-3 drafts for Qwen3.5 / 3.6 supported since 2026-06-19 (`--spec-type draft-eagle3`) — [llama.cpp #24593](https://github.com/ggml-org/llama.cpp/pull/24593). Current `--spec-type` options: `none|draft-simple|draft-eagle3|draft-dflash|draft-dspark|draft-mtp|ngram-cache|ngram-simple|ngram-map-k|ngram-map-k4v|ngram-mod` — [llama.cpp docs/speculative.md](https://github.com/ggml-org/llama.cpp/blob/master/docs/speculative.md)
- Self-speculative / n-gram drafting (no draft model), merged 2026-01-28: on a favourable translation-of-code task, decode went from 181 to 446 tok/s with 77% acceptance — [llama.cpp #18471](https://github.com/ggml-org/llama.cpp/pull/18471). Speculative decoding with recurrent models through checkpoints (2026-04-19). This is slower than `seq_rm`, because a partially accepted draft must go back to a checkpoint and re-run a shorter batch — [llama.cpp #19493](https://github.com/ggml-org/llama.cpp/pull/19493)
- Recurrent models now roll back rejected draft tails through per-token state snapshots (up to `n_rs_seq`). A guard (2026-10-30) refuses rollbacks deeper than the last ubatch actually wrote, after a bug produced silently corrupted output — [llama.cpp #31368](https://github.com/ggml-org/llama.cpp/pull/31368); [#31350](https://github.com/ggml-org/llama.cpp/pull/31350)
- Third-party MTP attempts for Qwen3.5-27B before upstream support: the best adaptive variant reached ~0.78x of plain decode (slower) on an M4 Max — [quivent/qwen-mtp-optimizations](https://github.com/quivent/qwen-mtp-optimizations) (search snippet)
- QVAC: speculative decoding via `modelConfig.spec_type`, with MTP layers (own or external head) or a DFlash draft model as drafters. Output keeps the distribution of plain decoding — [QVAC text generation docs](https://docs.qvac.tether.io/ai-capabilities/text-generation.md)
- Qwen3.5-0.8B config has `mtp_num_hidden_layers: 1` — [config.json](https://huggingface.co/Qwen/Qwen3.5-0.8B/raw/main/config.json)

### Inferences
- Hermit turn budget: with ~40 to 80 output tokens at ~40 to 60 tok/s on CPU, decode is ~1 to 2 s per call vs ~9 s uncached prefill. Speculation can cut that share by ~1.5 to 2x at best. It matters more once prefix caching is fixed and decode becomes the bigger share, and with multiple calls per turn.
- MTP for BotPsy: the fine-tune must keep and ideally co-train the MTP layer. If the SFT pipeline dropped or froze `mtp.*` tensors, acceptance on BotPsy's output style (tool JSON, Spanish/English replies) will be low. Check that the GGUF conversion kept the nextn/MTP tensors (#30097 shares nextn flags across models). Also watch the PP penalty that #22673 reports. On a CPU-only phone, extra MTP compute during prefill could cancel the decode gain. A/B on device before enabling.
- n-gram drafting (`ngram-simple`, `ngram-map-k`) is almost free and suits tool calls that copy arguments verbatim from the user message or from earlier tool outputs (names, dates, IDs). With a hybrid model, every rejected draft costs a snapshot rollback, so keep `draft-n-max` small (e.g. 4 to 8) rather than the 48 to 64 used in server examples.
- A separate draft model (e.g. a 0.1B to 0.3B model) is a poor fit at 0.8B target size. The target is already small, and the drafter's memory and compute compete on the same CPU cores.

### Gaps
- No on-phone measurement of MTP or n-gram speculation for a sub-1B hybrid model. All published llama.cpp numbers are on desktop or datacenter GPUs.
- Unknown whether QVAC's `spec_type` path is based on upstream llama.cpp after the recurrent rollback fixes (#31350/#31368, Oct 2026).
- Lookahead decoding was not researched.

## Q4. Shrinking prompts: tool schema compression, dynamic tool loading, prompt distillation, soft prompts

### Takeaway
Schema compression typically halves tool-schema tokens. Retrieval-based tool selection cut one agent's prompt by ~40%. On a hybrid model, though, dynamic tool loading breaks the cached prefix, so for Hermit a compact but static schema block, cached once, beats per-turn tool selection. Distilling tool knowledge into BotPsy's weights is the long-term option.

### Cited Findings
- TinyAgent (2024): a tool-retrieval step cut the prompt from ~2,762 to ~1,674 tokens, with tool recall 0.949 — [TinyAgent, arXiv 2409.00608](https://arxiv.org/pdf/2409.00608) (search snippet)
- TSCG (May 2026): converting JSON tool schemas into compact structured text saved 44 to 50% of schema tokens (conservative profile). A related paper reports average schemas going from ~393 to ~197 tokens — [arXiv 2605.04107](https://arxiv.org/pdf/2605.04107); [arXiv 2605.26165](https://arxiv.org/pdf/2605.26165) (search snippets)
- CAMPHOR (REALM 2025): an on-device multi-agent system with SLMs compresses tool definitions, reportedly encoding each function definition into a single token in the SLM embedding space (soft-prompt style) — [REALM 2025 paper](https://preview.aclanthology.org/display_plenaries/2025.realm-1.3.pdf) (search snippet)
- arXiv 2511.03728: a minimalist serialization for tool schemas, loading full definitions only after a tool is selected — [awesomepapers summary](https://awesomepapers.io/papers/2511.03728) (search snippet)
- Google's FunctionGemma (270M) runs at 2,238 tok/s prefill and 154 tok/s decode on CPU on an S25 Ultra (LiteRT-LM). It is an example of trading model capacity for edge speed — [LiteRT-LM overview](https://developers.google.com/edge/litert-lm/overview)
- QVAC deferred tools keep schemas out of the prompt, but per QVAC's own docs, the next turn after a tool load re-processes most or all of the prompt — [QVAC text generation docs](https://docs.qvac.tether.io/ai-capabilities/text-generation.md)

### Inferences
- For Hermit: compress schemas (short param names, no JSON-schema boilerplate, one-line descriptions, a TypeScript-signature style) into one static block, then cache it (Q2). This reduces both cold prefill and per-checkpoint cost. Compression must be paired with an eval on the blind set, because a 0.8B model is sensitive to format drift (anti-overfitting rules in the eval lab apply).
- Because BotPsy is already fine-tuned, the strongest option is to train with the exact compressed schema block, or with tools implied by the system prompt (prompt distillation). Then the runtime prompt can shrink to a short tool index. Every token removed from the static prefix still matters for cold starts and cache misses.
- Dynamic tool loading or retrieval only pays off on a hybrid model if the selected subset is appended after the stable prefix (never inserted before it), and if the number of distinct subsets is small enough to keep a saved state per subset.

### Gaps
- No full-text verification of the TSCG, CAMPHOR or 2511.03728 numbers (snippets only).
- No source measuring accuracy loss from schema compression specifically on sub-1B models.

## Q5. Quantization (Q4_0, Q4_K_M, Q8_0, IQ4_NL, KV quantization) and thermal / burst vs sustained

### Takeaway
On phones, the format that matters most for speed is the one with optimized kernels on the target unit. That means Q4_0 (CPU repack, Adreno OpenCL, Hexagon) and IQ4_NL (CPU repack), not Q4_K_M. Thermal throttling on 8 Elite Gen 5 can collapse CPU decode to near zero at 4 to 8 threads, while 2 threads keep ~37%. So the thread count must drop under heat.

### Cited Findings
- Q4_0 has aarch64 online repack with optimized GEMM/GEMV (2.9x prefill, 2.3x decode vs non-repacked on Graviton 3) — [llama.cpp #9921](https://github.com/ggml-org/llama.cpp/pull/9921). IQ4_NL has runtime repack — [llama.cpp #10541](https://github.com/ggml-org/llama.cpp/pull/10541)
- Hexagon matmul did not support Q4_K as of April 2026 (user report) — [llama.cpp discussion #21702](https://github.com/ggml-org/llama.cpp/discussions/21702). The Hexagon backend has Q4_0 / MXFP4 repack (#20527) and gained Q5_0 / Q5_1 on 2026-11-12 (#32094) — [llama.cpp #20527](https://github.com/ggml-org/llama.cpp/pull/20527); [#32094](https://github.com/ggml-org/llama.cpp/pull/32094)
- The Adreno OpenCL backend has a dedicated Q4_0 path (refactor 2026-05-05) — [llama.cpp #22335](https://github.com/ggml-org/llama.cpp/pull/22335)
- KleidiAI SME2 kernels now cover Q4_K and Q6_K (2026-10-13) — [llama.cpp #29219](https://github.com/ggml-org/llama.cpp/pull/29219)
- QVAC 0.12.0 offers TurboQuant KV-cache compression to ~3 bits/value (opt-in). QVAC's own memory figures are planning numbers, not benchmarks — [QVAC release notes](https://docs.qvac.tether.io/sdk/release-notes/) (search snippet)
- Thermal (Snapdragon 8 Elite Gen 5, Qwen3 4B, llama.cpp-based engine): at a 78 °C skin/XO temperature, CPUs 2 to 7 are taken out of use, leaving two. Under that throttle, CPU decode at 4 threads fell to 0.28 tok/s vs 10.2 unpaused (2.8%), and at 8 threads to 0.5%. At 2 threads it kept 37 to 38%. A scheduler trace suggested spin-waiting threads. Prompt processing took 265 to 417 s when throttled vs medians of 65 to 268 s. NPU decode under throttle slowed to about two-thirds but did not stall — [qualcomm/GenieX #1666](https://github.com/qualcomm/GenieX/issues/1666)

### Inferences
- For a 0.8B model, the accuracy gap between Q4_0 and Q4_K_M is likely larger than at 7B, because small models are more sensitive to quantization. Test Q4_0 (with repack), IQ4_NL and Q8_0 on the blind eval. Q8_0 at 0.8B is only ~0.8 GB of weights. Its decode is slower (more bytes per token), but it may cost little on prefill, which is compute-bound, and it has KleidiAI SVE kernels (#30808). Pick on measured turn time plus accuracy, not file size.
- Keep the output head and embeddings (248k vocab, tied) at Q6_K or Q8_0 if quantizing the body to Q4_0. They are a large share of a 0.8B model's parameters, and quality there matters (inference, standard llama.cpp quant-mix practice; not sourced here).
- KV-cache quantization matters little for Hermit: only 6 of 24 layers have KV (2 heads x 256 dim), so the KV cache at ~2k tokens is tiny. The DeltaNet state is fixed-size and stored as float32 (`mamba_ssm_dtype: float32` in config).
- Thermal: the device-adaptive runtime should read Android's thermal status / headroom (PowerManager thermal APIs) and drop to 2 threads on the prime cores when throttling starts, instead of keeping 4 to 8. Spin-waiting threads on parked cores explain the near-stall. Sustained eval runs on the phone should add cooldown gaps and log thermal status per turn. Otherwise p90 latency measures the thermal state, not the harness. (The Android API names are from general knowledge, not a source fetched here.)

### Gaps
- No published accuracy comparison of Q4_0 vs Q4_K_M vs IQ4_NL for Qwen3.5-0.8B.
- No battery / energy-per-turn data found for 8 Elite class phones.

## Q6. Perceived latency tricks (streaming, early intent display, speculative UI)

### Takeaway
This area was not researched with sources. QVAC's event stream already supports the primitives needed (typed `toolCall`, `contentDelta` and `thinkingDelta` events).

### Cited Findings
- QVAC `completion()` exposes an ordered `events` async iterable (`contentDelta`, `thinkingDelta`, `toolCall`, `toolError`, `completionStats`, `completionDone`, `rawDelta`) plus an aggregated `final` promise. `emitRawDeltas: true` emits every raw token — [QVAC text generation docs](https://docs.qvac.tether.io/ai-capabilities/text-generation.md)

### Inferences
- With `rawDelta`, Hermit can parse the tool name as soon as it is emitted (the first few tokens of the tool call) and show intent ("Setting a reminder...") or pre-warm the tool before the arguments finish. It can also start the tool as soon as the JSON closes, without waiting for `completionDone`.
- Start prefill of the static prefix (or restore the saved state) when the app or chat opens, not when the user sends. Then the user's typing time hides any residual cold-start cost.
- Stream the final answer's `contentDelta` straight to the UI. For multi-call turns, show an intermediate status per call.

### Gaps
- No sourced UX studies or mobile-assistant latency perception data were collected, so this section holds unsourced design suggestions.
