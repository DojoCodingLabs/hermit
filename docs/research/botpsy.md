# BotPsy-0.8B: Tether's on-device tool-calling model, and what it means for Hermit

Read 2026-11-11 from the announcement (https://tether.io/news/tethers-800m-ai-agent-beats-models-2-5x-its-size-on-everyday-phone-tasks/), the model card (https://huggingface.co/qvac/BotPsy-0.8B) and the blog post (https://huggingface.co/blog/qvac/botpsy).

## Facts (Verified from the model card unless marked)

- **What:** a 0.8B model post-trained from Qwen3.5-0.8B (hybrid Gated DeltaNet plus gated attention, used text-only) for function calling and agentic workflows: SFT, multi-teacher on-policy distillation, two rounds of RL.
- **License:** Apache 2.0. Training code and data are not released.
- **Files:** BF16 safetensors; GGUF in BF16, Q8_0 and Q4_K_M (`botpsy-0.8b-q4_k_m-imat.gguf`, 529,296,960 bytes) "for llama.cpp and the QVAC SDK" (https://huggingface.co/qvac/BotPsy-0.8B-GGUFs).
- **Domains it was trained for:** web search and research, travel, commerce and finance, customer operations, device control, files, calendar, email and messaging. Almost exactly Hermit's skill menu.
- **Scores (thinking mode, BF16 on vLLM):** BFCL v4 44.0 (base 23.4, Qwen3.5-2B 37.7); ACEBench 58.7; τ-bench 51.5; ToolSandbox 64.6; BFCL multi-turn 46.1 (base 7.5); BFCL hallucination (declining when no tool fits) 86.1, best tested; IFEval 90.8.
- **Weak spots:** open-ended search (BrowseComp-Plus 4.5, BFCL web search 14.0), BFCL memory 16.3, knowledge (MMLU-Pro 48.9).
- **Languages:** the card says "English (recommended)". The blog reports multilingual instruction following of 72 to 80 for English, Chinese, French, Spanish, Italian and Portuguese, with Hindi and Russian far lower.
- **Usage:** thinking mode must be on (`enable_thinking=True`); temperature 0.3, top_p 0.95, top_k 20, presence penalty 1.5; evaluated with up to 32,768 new tokens. The blog says RL cut runs hitting the 32k limit from 28.3% to 0.2% and repetitive loops from 22.9% to 1.4%.
- **Vision (blog):** a phone as the interface, delegating heavy work to a home PC or trusted P2P nodes. This is Hermit's Boost (ADR-010).

## What it means for Hermit

1. **It is the lead candidate for OQ-03.** Same vendor and runtime as ADR-003, Apache 2.0, about 530 MB at Q4_K_M, trained on Hermit's domains, and strongest where the cage needs it most: knowing when not to call a tool (Hermit's `ask_user` and `respond`).
2. **Two risks to measure, not assume:**
   - **Spanish:** "English recommended", while PDR-003 requires at least 85% correct in es and en. The W2 eval decides (ASM-25).
   - **Latency:** it was trained to think first, and thinking tokens count against the 15-second bar (PDR-003). The eval tries a capped thinking budget and thinking off, and compares accuracy (FR-MODEL-05).
3. **Runtime check:** Qwen3.5's Gated DeltaNet layers need a llama.cpp new enough to support them; the pinned QVAC 0.23 must load it (ASM-24, spike S1).
4. **Format:** BotPsy was trained on native tool calls through its chat template. The eval compares Hermit's two-stage decoding (ADR-004) with the model's own tool-call format under the same grammar and keeps whichever scores better; FR-LOOP-01 stays the contract either way.
5. **Device floor:** a 0.8B model at about 530 MB could lower NFR-05's 8 GB floor; revisit after spike S1 measures memory.
6. **Fine-tuning path (PDR-009):** if the bar is missed, BotPsy is a better starting point than its base, and Tether's recipe (SFT, distillation, RL) is documented.
