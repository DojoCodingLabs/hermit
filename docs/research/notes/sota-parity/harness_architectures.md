# Small-model agent harnesses, tool-calling architectures, and how consumer assistants work (research notes, 2026-11-12)

Scope: harness and tool-calling techniques that let 0.5B to 4B models perform close to frontier models on tool use, plus public facts about Atomic (atomicagent.io), Duet, Dots, Grok Bot, Instinct and Muse, applied to Hermit (BotPsy-0.8B, a Qwen3.5-0.8B fine-tune, Q4_K_M, llama.cpp via QVAC, Galaxy S26).
Verification: some frameworks in scope were not verified; they are listed under Gaps and not presented as facts.

## 1. How the small-model harnesses are structured (TinyAgent, Octopus, FunctionGemma, Apple FM, xLAM, STAR, Atomic Agent, etc.)

### Takeaway
Small-model tool use that works in practice comes from the harness, not the model alone. The recurring parts are: retrieve or narrow the tool menu (ToolRAG); constrain decoding with grammars or guided generation; have the model plan once (an LLMCompiler-style DAG, or a single JSON array of calls), then run the plan in code; fine-tune or distill on a narrow domain. Hermit already has most of these. The biggest documented gains still open are domain fine-tuning or distillation and shorter prompts.

### Cited Findings
**TinyAgent (Berkeley SqueezeAILab, EMNLP 2024 demo; older than 2025)**
- TinyAgent-1.1B with ToolRAG reached an 80.06% success rate on its Mac-assistant task (16 tools: calendar, mail, SMS, reminders, notes and others). On the same task GPT-4-turbo scored 79.08%, GPT-3.5-turbo 65.04% and base TinyLlama-1.1B 12.71%; TinyAgent-7B scored 84.95% — [HF model card](https://huggingface.co/squeeze-ai-lab/TinyAgent-1.1B); [arXiv 2409.00608](https://arxiv.org/abs/2409.00608)
- Architecture: the LLMCompiler planner emits a plan of function calls with dependencies, and an executor runs them, in parallel where possible. ToolRAG retrieves only the relevant tools plus in-context examples for each query, which shortens the prompt and cuts hallucinated tools — [arXiv 2409.00608](https://arxiv.org/html/2409.00608v3); [GitHub](https://github.com/SqueezeAILab/TinyAgent)
- Latency was reported at 2.9 s end to end for 1.1B versus 13.1 s for 7B. This figure comes from a secondary review and was not checked against the paper — [Liner review](https://liner.com/review/tinyagent-function-calling-at-edge)
- Caveat: on general BFCL, TinyAgent-1.1B scores only 19.70% overall and 0% multi-turn — [TinyLLM, arXiv 2511.22138](https://arxiv.org/html/2511.22138v1). It is a domain specialist, not a general tool caller.

**Octopus v2 (Nexa AI, 2024; older than 2025)**
- A 2B on-device model that turns each function into a dedicated "functional token". The abstract claims it beats GPT-4 on accuracy, has 35x lower latency than Llama-7B with RAG-based function calling, and needs 95% less context — [arXiv 2404.01744](https://arxiv.org/abs/2404.01744)

**FunctionGemma 270M (Google, Dec 2025)**
- Fine-tuning raised accuracy on Google's Mobile Actions dataset from 58% to 85%. This is an in-house benchmark, not BFCL — [Google blog](https://blog.google/technology/developers/functiongemma/); [VentureBeat](https://venturebeat.com/technology/google-releases-functiongemma-a-tiny-edge-model-that-can-control-mobile)
- A community LiteRT fine-tune reports 99.67% token-level validation accuracy on mobile actions. This metric is not comparable to the 85% task-level figure — [Featherless listing](https://featherless.ai/models/litert-community/FunctionGemma_270M_Mobile_Actions)
- Detail: the `developer` role, not `system`, activates function-calling mode. Training data must use the role the model was trained on — [Medium GDE walkthrough](https://medium.com/google-developer-experts/on-device-function-calling-with-functiongemma-39f7407e5d83)

**Apple Foundation Models (2025)**
- A roughly 3B on-device model with 2-bit quantization-aware training and KV-cache sharing. The framework exposes "guided generation, constrained tool calling, and LoRA adapter fine-tuning" — [Apple ML tech report 2025](https://machinelearning.apple.com/research/apple-foundation-models-tech-report-2025) (full paper arXiv 2507.13575, not read)

**General BFCL numbers for small models (TinyLLM, arXiv 2511.22138, Nov 2025)**
- Overall / multi-turn BFCL scores: xLAM-2-3b-fc-r 65.74% / 55.62%; Qwen3-4B (prompt mode) 62.04% / 35.25%; Qwen3-1.7B 55.49% / 16.88%; xLAM-2-1b-fc-r 53.97% / 8.38%; Qwen3-0.6B 45.76% / 1.38% — [arXiv 2511.22138](https://arxiv.org/html/2511.22138v1)
- Caution: the paper reports no ablations, and its tables contradict each other (multi-turn rows appear shifted between Table I and Table IV) — same source.
- A third-party blog reports xLAM-2-1b-fc-r at 30.44 versus 10.82 for Llama-3.2-1B-Instruct, a different BFCL version or snapshot — [Plain English blog](https://ai.plainenglish.io/5-tiny-language-models-for-tool-calling-part-3-ebcda32c2518). BFCL v4 snapshots disagree across aggregators: one lists xLAM-2-3b at 41.03%, another lists MiniCPM5-1B at 25.1% and LFM2.5-2.6B at 56.9% — [benchmarklist](https://benchmarklist.com/benchmarks/bfcl_v4/); [official leaderboard](https://gorilla.cs.berkeley.edu/leaderboard.html)

**STAR (arXiv 2602.03022, Feb 2026, ICLR 2026)**
- Two training stages for small tool callers. Constrained Knowledge Distillation (top-k forward KL that suppresses the teacher's confidently wrong predictions) comes first. Similarity-guided RL follows, with a continuous reward for similarity to ground truth instead of a 0/1 reward, which suits tasks that have several valid answers. The authors claim their 0.6B model is the best open model under 1B — [arXiv 2602.03022](https://arxiv.org/abs/2602.03022)

**Jhandi et al. (arXiv 2512.15943, revised Mar 2026)**
- Targeted fine-tuning lets small models beat large ones on agentic tool calling. A summary site cites a 350M model at a 77.55% ToolBench pass rate; not verified in the paper — [arXiv 2512.15943](https://arxiv.org/abs/2512.15943v2)

**Atomic Agent (atomicagent.io; open source, llama.cpp, 2026)**
- A local-first runtime. The control loop and all state run on the user's machine, the default backend is llama-server on 127.0.0.1:9931, and cloud models are opt-in — [GitHub AtomicBot-ai/atomic-agent](https://github.com/AtomicBot-ai/atomic-agent)
- Tool calls: "One inference produces one JSON array of tool calls". Local backends are grammar-constrained with GBNF, while cloud providers use native tool calling. Independent read-only calls run in parallel, and risky actions go through approval gates — same source.
- Memory lives outside the prompt. The prompt carries compact pointers, and full content is recalled through tool calls. Stores include profile facts, notes in SQLite with FTS5 (optional embeddings), lessons and procedures. Reflection runs after each turn without blocking the reply — same source.
- "Fusion mode": one model plans and a pool of workers executes subtasks; the usual pairing is a cloud orchestrator with local workers. A TurboQuant llama.cpp fork claims up to about 6.4x KV-cache compression versus F16 — same source.
- Tasks are durable deferred turns triggered by cron, intervals, webhooks or reminders the agent creates. They checkpoint after every step and resume after a crash. Channels are Telegram and Discord, each answering only its owner, with approval prompts as buttons — same source.

### Inferences
- Hermit's design (phrase router, narrowed menu, forced calls, code-side normalizers, grammar fallback) matches TinyAgent ToolRAG plus LLMCompiler and Atomic's GBNF single-array approach. The 95/100 blind score fits the literature's finding that a domain-specialised small model plus harness can match GPT-4 on a closed tool set (TinyAgent 80% versus 79%; FunctionGemma 58% to 85%).
- Sub-1B general multi-turn tool use is close to zero (Qwen3-0.6B at 1.38% multi-turn on BFCL). Hermit should keep multi-turn and multi-intent logic in code (the clause planner, fixed ask-user slots) rather than expect the 0.8B model to track state across turns.
- Ideas Hermit could take from these sources:
  1. Functional tokens or very short tool IDs (Octopus) to cut prompt length and prefill time.
  2. Plan once, execute in code: one constrained generation emits a JSON or XML array of calls (Atomic, LLMCompiler) instead of a call, result, call loop. This saves decode rounds.
  3. Retrieve in-context examples per intent, not only tools (ToolRAG retrieves both).
  4. STAR-style distillation from a frontier teacher, with a similarity reward, for the next BotPsy fine-tune.
  5. Keep memory outside the prompt and fetch it on demand with FTS5 (Atomic), so the prompt stays small.
  6. Post-turn reflection to extract facts, run in the background and off the reply path (Atomic).
- FunctionGemma's role lesson generalises: train and infer with exactly the same chat template and role. A mismatch quietly disables tool mode.

### Gaps
- Not verified (do not cite without checking): Octopus v4 (graph of models); Hammer (MadeAgents, function masking); NexusRaven-V2; Arch-Function (Katanemo); Phi-4-mini function calling; Gemma 3n tool use; the Google AI Edge or MediaPipe function-calling SDK (FunctionGemma ships through LiteRT, but its harness design was not read); smolagents (code-as-action, CodeAct); DSPy; Outlines; the "Atomic Agents" Python framework (BrainBlend), which is a different project from atomicagent.io.
- Exact Octopus v2 accuracy numbers and functional-token mechanics (only the abstract was read).
- Apple guided-generation internals: @Generable and its constrained-decoding implementation (only the summary page was read).
- STAR and Jhandi benchmark numbers (only the abstracts were read).

## 2. Which architectural patterns most raise small-model tool accuracy

### Takeaway
By evidence strength: (1) domain fine-tuning or distillation gives the biggest jumps (12.7% to 80% for TinyAgent; 58% to 85% for FunctionGemma); (2) tool and example retrieval to narrow the menu (TinyAgent ToolRAG; Octopus's 95% context cut); (3) constrained decoding (GBNF, guided generation) for format validity; (4) a planner/executor split that plans once (LLMCompiler, Atomic's single-array call); (5) a cascade that sends hard tasks to a bigger planner (Atomic "Fusion"). Size still matters for multi-turn: below 1B, multi-turn is roughly zero without harness help.

### Cited Findings
- Fine-tuning effect: TinyLlama-1.1B 12.71% to TinyAgent-1.1B 80.06% on the same task — [HF card](https://huggingface.co/squeeze-ai-lab/TinyAgent-1.1B); FunctionGemma 58% to 85% — [Google blog](https://blog.google/technology/developers/functiongemma/)
- Retrieval or menu narrowing: ToolRAG "minimiz[es] prompt space and reduc[es] hallucinations" — [arXiv 2409.00608](https://arxiv.org/html/2409.00608v3); functional tokens cut context by 95% — [arXiv 2404.01744](https://arxiv.org/abs/2404.01744)
- Constrained decoding: Atomic uses GBNF on local backends so "the format stays valid" — [atomic-agent](https://github.com/AtomicBot-ai/atomic-agent); Apple exposes "constrained tool calling" and guided generation — [Apple ML](https://machinelearning.apple.com/research/apple-foundation-models-tech-report-2025)
- Planner/executor and cascade: LLMCompiler planner plus executor — [TinyAgent](https://arxiv.org/html/2409.00608v3); Atomic Fusion pairs a cloud orchestrator with local workers — [atomic-agent](https://github.com/AtomicBot-ai/atomic-agent)
- Scale effect on multi-turn BFCL: 0.6B 1.38%, 1.7B 16.88%, 4B 35.25%, xLAM-3B 55.62% — [arXiv 2511.22138](https://arxiv.org/html/2511.22138v1)
- RL with a soft similarity reward beats a 0/1 reward when several outputs are valid — [STAR](https://arxiv.org/abs/2602.03022)

### Inferences
- For Hermit the rule "use the LLM only for what code cannot do" is supported. Its remaining value lies in free-text slots (reminder title, fact text, reply body) and in disambiguation. Intent, dates and normalisation should stay in code.
- Speed: a narrow menu plus short tool IDs plus single-pass planning minimises prefill and decode. Each extra tool schema in the prompt costs prefill time on a phone.
- Option for parity on hard requests: a cascade to a cloud model, opt-in in the spirit of Atomic Fusion. This conflicts with Hermit's on-device privacy stance, so it is a product decision (an open question, not decided here).

### Gaps
- No controlled ablation found that compares code-as-action with JSON for sub-1B models; smolagents and CodeAct evidence was not verified.
- No head-to-head numbers found on slot filling versus free generation for small models.

## 3. What is publicly known about Atomic, Duet, Dots, Grok Bot, Instinct, Muse, and what defines parity

### Takeaway
Apart from Atomic Agent, all of these are cloud agents on frontier models, each with its own cloud computer or VM. The 2026 shared feature set is proactivity (morning brief, periodic checks, texting first, following up dropped threads), persistent memory with forget, connected accounts (email, calendar, messaging), approval gates before sending or paying, and background tasks that keep running after the app closes. Several also live inside messaging apps (WhatsApp, iMessage/RCS, Telegram). Atomic Agent is the only local llama.cpp one and is the closest architectural analogue to Hermit.

### Cited Findings
**Atomic Agent (atomicagent.io)** — open source, local-first, llama.cpp, GBNF tool calls, memory outside the prompt, cron/interval/reminder tasks, Telegram and Discord channels, approval gates, opt-in cloud — [GitHub](https://github.com/AtomicBot-ai/atomic-agent). Sibling products: Atomic Hermes (gateway lists iMessage and Telegram among others) — [GitHub atomic-hermes](https://github.com/AtomicBot-ai/atomic-hermes); Atomic Bot (runs OpenClaw-based agents on device) — [App Store](https://apps.apple.com/us/app/atomic-bot/id6759154616)

**Claude Duet (Anthropic)** — research preview opened Oct 21, 2026, waitlist only, US Pro and Max subscribers. Model: Claude Opus 5.5. Separate iOS and Android app plus claude.ai. Sends a morning brief and checks connected accounts every few hours; the user sets interruption thresholds. Existing Claude memory, skills and connectors carry over (6,000+ connectors, e.g. Gmail, Slack, QuickBooks). Runs on its own cloud computer and browser and cannot read local files. Asks approval before sending messages, paying, signing or deleting — [iGeeksBlog](https://www.igeeksblog.com/claude-duet-proactive-ai-agent/); [Fortune](https://www.fortune.com/2026/10/23/anthropic-joins-meta-and-openais-personal-ai-assistant-race-with-duet/)

**ChatGPT Dots (OpenAI)** — cloud and always-on, for ChatGPT Pro (from $100/mo). Flags urgent email and Slack, has a weekly "scratchpad", drafts replies but does not send without permission, and runs recurring tasks (e.g. check a site every 30 min). Connectors include Gmail, Slack, Google Calendar, Notion, GitHub, Todoist and iMessage — [MindStudio comparison](https://www.mindstudio.ai/blog/chatgpt-dots-vs-muse-grok). On Oct 28, 2026, Dots could start texting users proactively over iMessage and RCS (US Pro preview), and the Dot cannot read the user's other conversations — [Digital Trends](https://www.digitaltrends.com/computing/openai-now-lets-you-text-your-chatgpt-dot-agent-to-get-things-done/); [Crypto Briefing](https://cryptobriefing.com/openai-dots-imessage-rcs-pro-users/). One secondary report names the model "GPT-6 Astra"; unverified, treat with caution — [search summary of secondary blogs](https://aiera.blog/?p=3275)

**Grok Bot (xAI / SpaceXAI)** — beta launched Aug 11, 2026. A separate app on Mac and iPhone; Windows, Linux and Android were announced. Always-on agents each get a cloud computer and sign into the user's tools, including apps with no API or MCP. They follow up on dropped threads, nudge stalled handoffs, and start work unprompted, pinging only for approvals. They remember context, learn the user's voice, and save a workflow shown once as a routine. Several bots can run under a "chief of staff" bot. Available with SuperGrok and Cursor paid plans and has its own usage pool — [x.ai news](https://x.ai/news/introducing-grok-bot); [VentureBeat](https://venturebeat.com/ai/spacexais-grok-bot-turns-agents-into-persistent-digital-coworkers-that-can-operate-your-apps-for-120-per-month/) (reports $120 to $300/mo tiers). Separately, Grok has been on Telegram since Mar 26, 2025 under a one-year deal reported at $300M; it is not native on WhatsApp — [ain.ua](https://en.ain.ua/2025/03/26/grok-telegram-launch); [TechRadar](https://www.techradar.com/computing/artificial-intelligence/telegram-gets-some-ai-integration-but-you-may-not-love-the-source); [LatestLY](https://www.latestly.com/socially/technology/grok-ai-chatbot-expands-to-telegram-responds-to-x-user-and-says-groks-on-telegram-but-not-whatsapp-likely-due-to-stricter-bot-policies-6736855.html)

**Instinct (Spear Street Technology, SF)** — invite-only assistant reached by text (iMessage, WhatsApp) and phone calls, with no traditional app UI. Runs a "proprietary core model" trained to text or call the user first and follow up dropped threads. Cloud only, on a persistent cloud computer that "keeps state between messages". Integrations: email, messaging, screen, audio, location, Google Workspace. Free so far. Funding reported at $75M Series A, then $250M at $2.5B (Vellum, a competitor) — [Vellum](https://www.vellum.ai/blog/official-instinct-breakdown). Phone calls since about Sep 16, 2026; reportedly raised $1B at a $10B valuation in Sep 2026 — [BuiltIn](https://builtin.com/articles/instinct-ai); [eesel](https://www.eesel.ai/blog/instinct-ai-review). Reportedly building a Mac app for iMessage and local browser tasks — [RuntimeWire](https://runtimewire.com/article/instinct-mac-app-imessage-local-browser-whoop). Funding figures conflict across sources.

**Meta Muse** — US launch Sep 2026 (Sep 8 to 10 depending on source). Model: "Muse Spark". Channels: Muse app (iOS, Android, muse.ai) and WhatsApp, with AI glasses coming. Reads or sends email (user picks the level), sends invites over messages, browses and fills forms, checks out with Link by Stripe. Keeps working in the background and comes back for approvals. Proactive suggestions draw on details mentioned once. Memory supports "forget". Runs on Muse Secure VM, a cloud computer, and a separate Sentinel agent must approve anything sent to the internet. Free tier plus paid plans — [Meta newsroom](https://about.fb.com/news/2026/09/introducing-muse-personal-ai-agent/). Has reminders drawn from email content and an "Ideas" tab whose proactivity level the user can adjust — [BuiltIn](https://builtin.com/articles/meta-muse); [PBS](https://www.pbs.org/newshour/nation/meta-launches-personal-ai-agent-muse-to-help-with-everyday-tasks). Users reported attempts to read private messages without permission — [eMarketer](https://www.emarketer.com/content/meta-muse-fuels-rise-of-personal-agentic-ai-gaps-adoption-remain)

**Duet name collision**: a small Product Hunt "Duet AI" (email and calendar assistant) and "Duet Mail" are unrelated to Claude Duet — [hunted.space](https://hunted.space/product/duet-ai); [BetaList](https://betalist.com/startups/duet-mail)

### Inferences
Parity checklist from the features these products share, compared with Hermit:
1. **Memory with forget** (Muse, Duet, Grok Bot): Hermit has remember, recall and forget. Missing: implicit extraction from conversation ("details you mentioned once"), which would be background post-turn reflection like Atomic's.
2. **Reminders and recurring tasks** (Dots recurring checks, Atomic cron tasks, Muse email-derived reminders): Hermit has remind, list and cancel. Possible gaps: recurring reminders, and reminders suggested from messages or calendar.
3. **Proactive outreach** (morning brief in Duet and Meta AI; texting first in Instinct and Dots; following up dropped threads in Grok and Instinct): Hermit has catch-up summaries. Parity needs a scheduled on-device brief (background task plus notification) and "you haven't replied to X" nudges built from read-messages data.
4. **Messaging** (read and reply; living inside WhatsApp, iMessage or RCS): Hermit has read and reply. The others also draft and wait for approval; mirror that with a confirm step before send.
5. **Calendar** (Dots, Duet): Hermit has read and add.
6. **Approval gates** before send, pay or delete (all of them): keep explicit confirmation for reply-to-message and cancel actions.
7. Out of scope for an on-device 0.8B model: web browsing and form filling, purchases, multi-bot orchestration and cloud VMs. These need a frontier model and would need a cloud cascade.
- Hermit's natural edge: every competitor except Atomic is cloud-only, and Muse drew complaints about reading private messages. A fully on-device assistant with explicit approval is a real differentiator.

### Gaps
- No primary OpenAI announcement was fetched for Dots, so the model name and launch date are unverified (secondary sources only). MindStudio says "xAI owns the Dot.com domain, which redirects to Grok" — unverified.
- The TechCrunch roundup "All the AI agents that can live in your text messages" returned 404 at one URL; another exists at techcrunch.com/2026/10/24/... and was not read.
- No published model or architecture details exist for Instinct (only "proprietary core model") or Grok Bot (model not named).
- No public numbers on accuracy or latency for any of these consumer products, so no benchmark parity can be measured; parity can only be defined by features.

## 4. Newest 2025-2026 work

### Takeaway
2025-2026 work shifts from "small models can call functions" to distillation plus RL recipes (STAR, ICLR 2026), honest edge evaluations showing sub-1B weakness on multi-turn (TinyLLM, Nov 2025), and tiny specialised releases tuned per app (FunctionGemma 270M, Dec 2025). On the product side, everyone converged in Aug to Oct 2026 on cloud always-on proactive agents.

### Cited Findings
- STAR, constrained KD plus similarity RL, 0.6B best open model under 1B (Feb 2026) — [arXiv 2602.03022](https://arxiv.org/abs/2602.03022)
- TinyLLM BFCL edge evaluation (Nov 2025) — [arXiv 2511.22138](https://arxiv.org/html/2511.22138v1)
- Small models beat large ones through targeted fine-tuning (Dec 2025, revised Mar 2026) — [arXiv 2512.15943](https://arxiv.org/abs/2512.15943v2)
- FunctionGemma 270M, intended to be fine-tuned per app for on-device actions (Dec 2025) — [Google blog](https://blog.google/technology/developers/functiongemma/)
- Apple Foundation Models 2025: about 3B on-device, 2-bit QAT, constrained tool calling — [Apple ML](https://machinelearning.apple.com/research/apple-foundation-models-tech-report-2025)
- BFCL v4 is the current leaderboard and updates often; one aggregator lists Qwen3.5-397B-A17B at 0.729 as leader — [Gorilla leaderboard](https://gorilla.cs.berkeley.edu/leaderboard.html); [llm-stats](https://llm-stats.com/benchmarks/bfcl-v4)
- Atomic Agent (2026): local llama.cpp runtime with GBNF single-shot tool arrays and memory outside the prompt — [GitHub](https://github.com/AtomicBot-ai/atomic-agent)
- Open-source "texts you first" iMessage assistant: Intelligent Internet's Genii — [AlphaSignal](https://alphasignal.ai/news/intelligent-internet-s-genii-texts-you-first-as-an-open-source-imessage-ai) (not read in full)

### Inferences
- The most useful next model step for Hermit is a STAR-style pipeline: distill from a frontier teacher on Hermit's exact tool set and templates, then RL with a similarity reward against the blind eval's ground truth. Hold out the blind set to avoid overfitting, in line with the project's eval-lab rules.
- Treat BFCL as a sanity check only. Hermit's own blind eval is the right metric, since every small-model win in the literature is domain-specific.

### Gaps
- No Qwen3.5-0.8B BFCL score was found.
- The search did not surface 2026 papers on speculative decoding or KV reuse for on-device tool calling.
