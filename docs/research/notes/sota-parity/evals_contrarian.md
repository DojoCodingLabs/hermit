# Evaluating small on-device assistant agents, and contrarian / paradoxical views on small-vs-frontier parity

Scope note: researched 2026-11-12 for Hermit (BotPsy-0.8B, a Qwen3.5-0.8B fine-tune on llama.cpp, with a code-heavy harness). Many secondary sources (tianpan.co, beancount.io, aiwiki, emergentmind) are blogs or aggregators. Where a figure comes from one, it is marked "(secondary)". Primary arXiv and vendor pages are preferred.

## Q1. Which benchmarks and protocols matter for a small tool-using assistant (BFCL, tau/tau2, ToolSandbox, When2Call, etc.)?

### Takeaway
No single public benchmark matches Hermit's product. The useful move is to copy each benchmark's protocol into Hermit's own suite: BFCL's irrelevance and multi-turn splits, tau-bench's pass^k plus a user simulator plus state-diff grading, tau2's dual control, ToolSandbox's "insufficient information" minefields, and When2Call's four-way decision (answer / call / ask / can't). Aggregate accuracy hides the failure modes that matter most at 0.8B: silent wrong trajectories and tool hallucination.

### Cited Findings
- **pass^k vs pass@k.** pass^k is the probability that a model succeeds on all k runs of the same task, averaged over tasks. With uncorrelated failures, a 90% pass^1 model has pass^8 of about 43%. The tau2 paper used a gpt-4.1 user simulator, 4 trials per task, temperature 0 — [aiwiki tau2-bench](https://www.aiwiki.ai/wiki/tau2-bench) (secondary); primary paper is arXiv:2506.07982.
- Anthropic's agent-eval guidance makes the same split: pass@k for best-of-k settings where retries are fine, pass^k when every user interaction must work. It combines code graders, model graders and human graders, with humans periodically calibrating the model judges — [Anthropic, Demystifying evals for AI agents](https://www.anthropic.com/research/demystifying-evals-for-ai-agents) (Jan 2026; the definitions are confirmed via [secondary summary](https://snowan.gitbook.io/study-notes/ai/ai-resources-1/evals/anthropic-demisfy-ai-evals)).
- **tau2 dual control (telecom).** The simulated user also calls tools on their own device. GPT-4.1 falls from about 74% pass^1 on retail/airline to 34% on telecom. Moving from solo to dual control costs 18 points for GPT-4.1 and 25 points for o4-mini — [emergentmind tau2](https://www.emergentmind.com/topics/2-bench) (secondary). Telecom pass^1: o4-mini 42%, GPT-4.1-mini about 50% — [beancount.io research log](https://beancount.io/bean-labs/research-logs/2026/06/18/tau-squared-bench-dual-control-conversational-agents) (secondary).
- **BFCL v4.** Multi-turn is the hard split. One report says the overall leader scores 68.4% on multi-turn and most small models are below 50%, with large single-turn to multi-turn drops (e.g. Haiku 86.5 to 53.6) — [Spheron blog](https://www.spheron.network/blog/tool-calling-benchmarks-bfcl-tau-bench-latency-optimization/) (secondary, unverified). A self-reported 4B fine-tune lists BFCL v4 overall 55.73, multi-turn 43.46, irrelevance 80.63, against a small-model reference of Nanbeige4-3B at 51.40 — [CloudSurf-4B-FC model card](https://huggingface.co/cloudsurf-software/CloudSurf-4B-FC) (self-reported).
- **When2Call (NVIDIA, NAACL 2025).** It scores four behaviours: direct answer, tool call, follow-up question, "unable to answer." Small-model numbers (F1 / tool-hallucination rate / BFCL irrelevance):

  | Model | F1 | Tool hallucination | BFCL irrelevance |
  |---|---|---|---|
  | Qwen2.5-0.5B | 32.0 | 20% | 37.7% |
  | Qwen2.5-1.5B | 29.9 | 23% | 71.9% |
  | Llama-3.2-1B | 21.7 | 43% | 52.9% |
  | Llama-3.2-3B | 17.9 | 52% | 46.6% |

  Frontier models are not immune: GPT-4o 26% and GPT-4o-mini 41% tool hallucination — [When2Call arXiv 2504.18851](https://arxiv.org/html/2504.18851v1).
- When2Call training results:
  - Preference optimization (RPO) on balanced call/no-call data took a 4B model's tool hallucination from 16% to 1.9% and BFCL irrelevance from 41.1% to 77.4%, while recovering AST accuracy.
  - Plain SFT on the same data cost 6.2 AST points.
  - Training on negatives only makes models over-conservative.
  - Multiple-choice log-prob scoring underestimates models trained on When2Call phrasings; LLM-as-judge scored 4B-RPO at 64.3 vs 51.0 under multiple choice.

  — [When2Call](https://arxiv.org/html/2504.18851v1).
- **ToolSandbox (Apple).** 1,032 stateful, conversational scenarios. It includes 224 "insufficient information" scenarios where any tool call is a "minefield" violation (e.g. a timestamp difference asked without the current time). State dependency, canonicalization (e.g. resolving "tomorrow" to a timestamp) and insufficient information are hard even for SOTA models — [ToolSandbox arXiv 2408.04682](https://arxiv.org/pdf/2408.04682); [Apple ML research page](https://machinelearning.apple.com/research/toolsandbox-stateful-conversational-llm-benchmark). Reported scores: GPT-4o about 73% average similarity, proprietary models 60-73%, open models 25-54% — [alphaxiv summary](https://alphaxiv.org/benchmarks/apple/toolsandbox) (secondary).
- **Quantization effects on multi-turn BFCL v4** (six small models; F16, Q8_0, Q5_K_M, Q4_K_M):
  - xLAM-2-3B fell from 58.00% to 51.75% at Q4_K_M.
  - Qwen3-1.7B fell from 14.50% to 8.75%; its wrong-argument rate rose from 20.8% to 26.9%.
  - Degradation increasingly showed up as "error-free but wrong trajectories" that runtime error channels did not catch.
  - The authors recommend reading per-call, per-trajectory and silent-failure rates together, with paired McNemar tests and a floor/format check.

  — [Same Quantization, Different Failures, NeurIPS 2026](https://neurips.cc/virtual/2026/171271).

### Inferences
- **Recommendation: add a "minefield / can't-do" slice to the blind holdout.** Use ToolSandbox-style scenarios where any tool call is a failure (missing info, out-of-scope requests such as "book me a flight"), and report the tool-hallucination rate separately from accuracy. A 95/100 blind score probably under-samples this; When2Call shows it is the dominant small-model weakness even after fine-tuning.
- **Recommendation: grade trajectories by end-state diff, not just call matching.** Compare the reminder DB, calendar and notes after the scenario (tau-bench style), so that "error-free but wrong" runs are caught.
- **Recommendation: report pass^k with k≥4 per seed, plus the gap pass^1 − pass^k, as the headline reliability metric.** At 0.8B, sampling variance across runs is the user-visible problem.
- **Recommendation: run every eval on the exact GGUF quant shipped on the phone.** Test Q4 vs Q8 with a paired McNemar test, because quantization moves wrong-argument rates silently. This matches the existing "phone's GGUF" lab rule.
- **Recommendation: add a light dual-control scenario family.** Example: the user must grant notification permission or change a system setting mid-task. The tau2 drop shows that coordinating with the user is a separate skill.
- Preference optimization (RPO/DPO) on balanced call/ask/refuse pairs is the best-evidenced training fix for over-calling, better than SFT. It is a candidate for the next BotPsy fine-tune.

### Gaps
- Current official BFCL v4 and tau2 leaderboard numbers for sub-1B models were not verified. ACEBench, NESTFUL, MCP-Bench, AppWorld and AndroidWorld were not researched, so their protocols and small-model results are unverified here.
- I found no published pass^k results for sub-1B models on tau2.

## Q2. User simulators, LLM-as-judge pitfalls, and overfitting / holdout hygiene

### Takeaway
Error analysis by a human on real traces comes first. Judges should give binary verdicts and be validated like classifiers against human labels. Any harness that is tuned automatically (or by a person who keeps looking at failures) overfits to the tuning set, so the holdout must stay blind and be refreshed.

### Cited Findings
- Husain & Shankar on evals:
  - Error analysis is "the most important activity in evals," and 60-80% of development time on their projects went to error analysis and evaluation.
  - Manually review 20-50 outputs on every significant change.
  - Use binary pass/fail instead of 1-5 scales, because middle values hide uncertainty.
  - Treat an LLM judge as a classifier: label 100-200 examples per failure mode, split into train/dev/test, and measure agreement with human labels.

  — [Hamel Husain, AI Evals FAQ](https://hamel.dev/blog/posts/evals-faq/); [binary vs Likert](https://hamel.dev/blog/posts/evals-faq/why-do-you-recommend-binary-passfail-evaluations-instead-of-1-5-ratings-likert-scales.html).
- Judge vs deterministic scoring can disagree by a lot: in When2Call the gap was 51.0 vs 64.3 for the same model, depending on whether outputs matched expected phrasing — [When2Call](https://arxiv.org/html/2504.18851v1).
- The tau2 user simulator was GPT-4.1 at temperature 0 — [aiwiki](https://www.aiwiki.ai/wiki/tau2-bench) (secondary). The simulator's own errors are part of measured "agent" failure. This is a known tau-bench caveat (inference from the method).
- Automatic harness evolution overfits: per an O'Reilly summary of a Google paper, an unconstrained self-improving harness got better on its tuning tasks without improving the general job — [O'Reilly Radar](https://www.oreilly.com/radar/?p=20067) (secondary; I did not read the primary paper).

### Inferences
- **Recommendation: track "harness rules added per holdout point" as an anti-overfitting signal.** Every phrase-router entry or normalizer rule added after looking at a failure is a degree of freedom fitted to the eval. Freeze a fresh blind set each wave; the current 95/100 holdout is consumed once you debug against it. Rotate in new paraphrases written by someone who has not seen the router table (or generated by a different model family), and also measure on organic phone logs.
- **Recommendation: use a two-tier judge.**
  - Code graders handle tool names, args and state diffs.
  - A binary LLM judge handles only subjective items (tone, language match, helpfulness of a clarifying question).
  - Validate the judge on 100+ human-labelled Hermit transcripts and report its true-positive and true-negative rates.
- **Recommendation: audit simulator failures separately.** Before blaming the agent for a trajectory failure, check whether the user simulator went off-script; label these "sim error." Use a stronger cloud model as the simulator only on the Mac eval lab.

### Gaps
- I found no rigorous study quantifying user-simulator error rates on tau2. Jason Liu's and Simon Willison's specific eval writings were not read for these notes.

## Q3. Latency- and energy-aware metrics, and measuring "feels as smart as"

### Takeaway
Users feel time-to-first-token (TTFT) and the first useful action. Hard evidence on streaming perception is thin, but cutting the tool set saves both latency and energy on edge hardware. "Feels as smart as" has to be measured with blind side-by-side human preference on matched tasks, and the latency has to be part of what the raters experience.

### Cited Findings
- A controlled study varied TTFT at 2, 9 and 20 s. Logged interaction behaviour stayed fairly stable across latency levels but differed by task type (creation vs advice) — [arXiv 2604.06183](https://arxiv.org/html/2604.06183). I did not retrieve its perceived-quality results.
- Practitioner claims (no primary study cited):
  - Streaming feels 40-60% faster than equal-time batch output.
  - 1-3 s TTFT is acceptable; over 3 s feels sluggish.
  - Tokens faster than reading speed (about 5 tok/s for English prose) make inter-token latency unnoticeable.

  — [tianpan.co TTFT](https://tianpan.co/blog/2026-04-16-streaming-ttft-latency-perception); [insertchat glossary](https://insertchat.com/glossary/time-to-first-token). Treat these as unverified rules of thumb.
- Less-is-More (DATE 2025): dynamically cutting the number of tools exposed per prompt on edge devices reduced execution time by up to 70% and power by up to 40%, and raised success rate, with no fine-tuning — [arXiv 2411.15399](https://arxiv.org/html/2411.15399v1).
- Manus: KV-cache hit rate is the key production metric. Keep prompt prefixes stable, and serialize JSON deterministically, because key-order changes silently break the cache. Mask tools instead of removing them, since tool definitions sit early in the context — [Manus context engineering blog](https://manus.im/blog/Context-Engineering-for-AI-Agents-Lessons-from-Building-Manus).

### Inferences
- **Recommendation: put latency and energy in the score itself.** Report "pass^k at P90 latency ≤ X s," plus TTFT, time-to-action (when a reminder is actually scheduled), mJ or %battery per task, and the thermal state at the end of the run. A pass that takes 9 s on a throttled phone should count as a partial fail for a VA.
- **Recommendation: build a "feels as smart as" protocol.**
  - Use blind A/B on the same 30 scripts: Hermit vs a target (Atomic, Duet, Dots, Grok bot, Instinct, Muse), with screen recordings that include real latency.
  - Raters give a binary preference plus a reason tag (wrong / slow / robotic / asked too much / didn't remember).
  - Report a win/tie/loss rate. This is the parity metric; per-case accuracy is not.
- **Recommendation: guard the KV cache in tests.** Keep the system prompt and tool block byte-identical across turns, and verify it in CI with a hash. This matters directly because Hermit now relies on the QVAC KV cache (Q35).

### Gaps
- I found no peer-reviewed study on streaming vs batch perception for LLM chat, and no published energy-per-task benchmark for phone LLM agents.

## Q4. Known small-model tool-use failure modes, and what fixed them

### Takeaway
Small models fail mostly by omission (not calling when they should) and by bad execution (wrong tool name, invalid JSON, invented or missing args). They also over-call when a tool is present, and drift once tool results come back. The evidence-backed fixes are:
- fewer and shorter tools in context;
- preference training on call/ask/refuse;
- constrained or format-separated decoding;
- deterministic arg normalization;
- not routing tool results back through the model when you don't need to.

### Cited Findings
- 200 failures from Qwen2.5-3B/7B and Functionary-Small: the failures were mainly not starting a tool call at all, plus wrongly executed calls. Malformed calls (wrong tool names, invalid JSON, invented params) were about 32%, and omissions dominated for the smaller models — [arXiv 2601.16280](https://arxiv.org/pdf/2601.16280).
- Qwen2.5-Coder-3B had a 38.48% argument-hallucination rate. Hammer2.1-7B had low incorrect args (17.18%) but 64.26% missing args — [arXiv 2603.05515](https://arxiv.org/pdf/2603.05515).
- Public tool-calling training data is dominated by "call the tool when tools are present," which biases models toward over-calling. Llama models over-call even when a follow-up question is correct; Qwen models rarely say "unable to answer" — [When2Call](https://arxiv.org/html/2504.18851v1).
- Size ladder in one practitioner series (email MCP):
  - 800M never completed a tool call ("assembling tool call" forever).
  - 2B was inconsistent.
  - 4B worked after the tool description was shortened.
  - 9B was always correct.

  The only proposed 800M fix was architectural: render the tool result straight to the user instead of feeding it back to the model — [iunera, "Why an 800M model can't send an email"](https://www.iunera.com/kraken/projects/why-an-800m-model-cant-send-an-email-the-context-confusion-problem/) (single practitioner, small n; the "context confusion" explanation is an untested hypothesis).
- Quantization raises the wrong-argument rate and adds silent wrong trajectories in small models — [NeurIPS 2026](https://neurips.cc/virtual/2026/171271).
- Constrained decoding (strict schema) blocks schema-violating tokens but does not stop fabricated values that the schema accepts — [tianpan.co](https://tianpan.co/blog/2026-04-23-tool-hallucination-rate-probe-suite-agent-eval) (secondary).

### Inferences
- **Recommendation: keep Hermit's choice to render tool confirmations from templates rather than a second model pass.** The 800M evidence supports it. Extend it: tool results go straight to deterministic UI or text, and the model is called again only when synthesis is actually needed (e.g. catch-up summaries).
- **Recommendation: put enum and grammar constraints on arg values where possible** (day names, durations, list IDs), in addition to structure. Schema-valid hallucinations are the remaining risk.
- **Recommendation: add language drift (reply language ≠ user language) and format-break rate as first-class metrics** in every eval report.

### Gaps
- No source specifically measured language drift in sub-1B models for tool use. I did not find studies on Qwen3.5-0.8B specifically.

## Q5. Contrarian views, with evidence for and against, each turned into a recommendation

### Takeaway
The evidence mostly supports Hermit's deterministic-first harness at 0.8B. The bitter-lesson critique is valid at frontier scale and over time. The right synthesis is to keep the harness, but make it removable, measured and versioned against the model, and use preference training to absorb the parts that generalize.

### Cited Findings

**5.1 "The best model call is no model call" (deterministic-first).**
- *For:* routing only the hard 22% of queries to a bigger model costs under 1% quality (Hybrid LLM, ICLR 2024) — [arXiv 2404.14618](https://arxiv.org/pdf/2404.14618.pdf). By extension, the easy majority doesn't need the expensive path.
- *For:* the 800M model cannot reliably complete a round trip — [iunera](https://www.iunera.com/kraken/projects/why-an-800m-model-cant-send-an-email-the-context-confusion-problem/).
- *For:* ToolSandbox's canonicalization failures (e.g. "tomorrow" to a timestamp) are hard even for GPT-4o — [ToolSandbox](https://arxiv.org/pdf/2408.04682). That is exactly what deterministic time parsing removes.

**5.2 "Bitter lesson: harness hacks get washed away."**
- *For:*
  - Practitioners argue the harness should shrink as models improve. Vercel reportedly removed 80% of its agent's tools and got faster, more reliable agents — [Phil Schmid, Agent Harness 2026](https://www.philschmid.de/agent-harness-2026); [Hugo Bowne-Anderson](https://hugobowne.substack.com/p/ai-agent-harness-3-principles-for) (secondary).
  - A quoted claim that scaffolding adds 10-20% and is then "wiped out with the next model" is attributed to Boris Cherny. Unverified — [dyb.mataroa](https://dyb.mataroa.blog/blog/the-bitter-lesson-for-harness-builders-why-i-am-destroying-my-beautiful-machine/).
- *Against:*
  - Complexity "moves" rather than disappears — [Traversal](https://www.traversal.com/blog/ai-agent-architecture-mistakes).
  - Harness distillation trains general scaffolding into the model, and the part tied to your tools, data and users remains — [Arize](https://arize.com/blog/agent-harness-distillation/).
  - NVIDIA's position paper argues that SLMs are "sufficiently powerful, inherently more suitable, and necessarily more economical" for many agentic invocations. It also argues that the size-to-capability curve is steepening and that heterogeneous multi-model systems are the natural design — [arXiv 2506.02153](https://arxiv.org/html/2506.02153v2) (position paper, not empirical).

**5.3 "Thinking hurts small models."**
- *For:* small reasoning models often reach the correct tool call and then overwrite it with a wrong one after more reasoning. With Qwen3-4B-Thinking on BFCL, oracle early stopping raised accuracy from 85.8% to 94.2% with 80-94% fewer tokens. The ThinkBrake heuristic (stop when the logprob margin of `</think>` is small) kept or improved accuracy with up to 25% fewer tokens — [ThinkBrake arXiv 2510.00546](https://arxiv.org/html/2510.00546v1) (NeurIPS 2025).
- *Against:* the oracle is an upper bound, and the result is shown on a 4B model only.

**5.4 "Constraints hurt reasoning."**
- *For:* JSON-mode and format restrictions degraded reasoning (GSM8K, Last Letter), and stricter formats hurt more. Separating free reasoning from formatting ("NL-to-Format") largely kept performance — [Tam et al., Let Me Speak Freely, EMNLP 2024](https://arxiv.org/html/2408.02442v1).
- *Against:*
  - The same paper found JSON mode helps classification.
  - .txt argued the degradation came from poor prompts, and reported structured generation lifting GSM8K across 8 models — [dottxt, Say What You Mean](https://blog.dottxt.ai/say-what-you-mean.html); [dottxt GSM8K](https://blog.dottxt.ai/performance-gsm8k.html).
  - An independent replication found structured output equal or better for Llama-3-8B but not for GPT-4o-mini — [Dylan Castillo](https://dylancastillo.co/posts/say-what-you-mean-sometimes.html).
- *Net:* constraints help selection and classification-like tasks (tool choice, enums) and can hurt open reasoning.

**5.5 "Small models need fewer instructions / fewer tools."**
- *For:*
  - Less-is-More: fewer tools per prompt gave higher success, up to 70% less time and up to 40% less power — [arXiv 2411.15399](https://arxiv.org/html/2411.15399v1).
  - A 4B model was fixed by shortening the tool description — [iunera](https://www.iunera.com/kraken/projects/why-an-800m-model-cant-send-an-email-the-context-confusion-problem/).
  - Vercel's 80% tool cut — [Phil Schmid](https://www.philschmid.de/agent-harness-2026) (secondary).
- *Against (partial):* Manus advises masking tools rather than removing them, to protect the KV cache. That is a cost trade-off against dynamic tool pruning — [Manus](https://manus.im/blog/Context-Engineering-for-AI-Agents-Lessons-from-Building-Manus).

**5.6 "Routers are brittle."**
- *For:* routing decisions are where the engineering is hard ("the handoff is the hard part"). Apple pairs an on-device model with a Private Cloud Compute model — [aiworld.eu](https://aiworld.eu/story/the-handoff-is-the-hard-part) (secondary). When2Call shows the call/no-call decision is unreliable even in GPT-4o (26% tool hallucination) — [When2Call](https://arxiv.org/html/2504.18851v1).
- *Against:* a learned router sent only 22% of traffic to the large model with under 1% quality drop — [Hybrid LLM](https://arxiv.org/pdf/2404.14618.pdf).

**5.7 "Use the cloud for the hard 5%."**
- Token-level routing of 7% of tokens to a cloud LLM gave a 60%+ accuracy gain on CommonsenseQA at 80%+ lower cost — [arXiv 2504.07878](https://arxiv.org/html/2504.07878v1).
- HybridFlow splits queries into subtasks and routes each to edge or cloud under budgets — [arXiv 2512.22137](https://arxiv.org/html/2512.22137v2).
- This conflicts with Hermit's on-device/privacy positioning. It is a product decision, not a research one.

**5.8 "Don't build multi-agents."**
- Cognition: share full context, because subagents misread split subtasks — [Cognition](https://cognition.ai/blog/dont-build-multi-agents).
- Anthropic reported multi-agent setups with 90.2% higher success on research tasks — [Zilliz summary](https://zilliz.com/blog/context-engineering-for-ai-agents) (secondary).
- Manus later added a dedicated planner sub-agent — [Phil Schmid, Context Engineering Part 2](https://www.philschmid.de/context-engineering-part-2).

### Inferences (each contrarian view as a concrete recommendation)
1. **Deterministic-first: keep it, but make every rule pay rent.** Log each rule's hit count and accuracy on organic traffic. Delete rules with zero hits, or rules the model handles on its own on the holdout (run an "ablate-the-harness" eval each model upgrade: model alone vs model + harness, per category).
2. **Answer the bitter lesson with harness distillation.** For each new BotPsy fine-tune, generate training data from the harness's deterministic outputs (router decisions, normalized args, clarifying questions). Then measure which harness layers become removable. Keep permanently what is tied to the device: time parsing, OS APIs, permissions. Distill what is linguistic: intent choice, call/ask/refuse.
3. **Thinking: off by default.** If it is ever enabled for planner or clause cases, cap the thinking budget and accept the first valid tool call (a ThinkBrake-style early stop), and run an A/B with think off vs on per category.
4. **Constraints: grammar-constrain selection and args; leave free text unconstrained.** Use two-pass NL-then-format only where reasoning is needed (e.g. a catch-up summary followed by structured extraction).
5. **Fewer tools per turn.** Pre-filter the tool list with the phrase router (top-3 candidates), but keep the prefix stable: mask with grammar constraints rather than editing the tool block, to protect the KV cache.
6. **Routers: measure the router as its own classifier.** Track a confusion matrix, coverage and precision on a blind paraphrase set, and require a safe fallback (clarify) on low confidence. When2Call-style RPO data can train the model to be the second line of defence.
7. **Cloud for the hard 5%: decide as a product question (logged as an open question, not decided here).** Option: an opt-in cloud escalation for open-ended requests only, with an explicit privacy UI. At minimum, measure what fraction of organic queries fail on-device, which sizes the case.
8. **Multi-agent: stay single-agent plus deterministic workflows.** Evidence at small scale favours shared context and fewer hops.

### Gaps
- I did not find a direct empirical head-to-head of "0.8B + heavy harness vs 3-4B + light harness" on a personal-assistant suite. Hermit's own eval lab could produce one (recommended).

## Q6. Paradoxes: evidence for and against

### Takeaway
Most of the proposed paradoxes have at least partial empirical support. "Do less and the product looks smarter" and "more tools means less capability" are the best supported.

### Cited Findings
- **"Making the model do less makes the product smarter."**
  - *For:* fewer tools raised success and cut time and power — [Less-is-More](https://arxiv.org/html/2411.15399v1).
  - *For:* oracle early stopping of thinking raised accuracy from 85.8 to 94.2 — [ThinkBrake](https://arxiv.org/html/2510.00546v1).
  - *For:* bypassing the model on tool results is the only proposed fix at 800M — [iunera](https://www.iunera.com/kraken/projects/why-an-800m-model-cant-send-an-email-the-context-confusion-problem/).
- **"More tools reduces capability."**
  - *For:* [Less-is-More](https://arxiv.org/html/2411.15399v1); Vercel's 80% cut ([Phil Schmid](https://www.philschmid.de/agent-harness-2026), secondary).
  - *Against:* Traversal argues capability grows with tools and skills when context is managed — [Traversal](https://www.traversal.com/blog/ai-agent-architecture-mistakes).
- **"Slower thinking can feel faster."** I found no direct evidence. Related evidence: logged behaviour was robust to TTFT from 2 to 20 s — [arXiv 2604.06183](https://arxiv.org/html/2604.06183). The streaming-perception claims are unsourced blog figures — [tianpan.co](https://tianpan.co/blog/2026-04-20-latency-perception-gap-ai-interfaces).
- **"Evaluating harder lowers scores but raises quality."**
  - *For:* pass^k math (90% pass^1 gives about 43% pass^8) — [aiwiki](https://www.aiwiki.ai/wiki/tau2-bench).
  - *For:* dual control cuts pass^1 by 18-25 points — [emergentmind](https://www.emergentmind.com/topics/2-bench).
  - *For:* quantization failures are invisible to error channels and only visible to stricter trajectory checks — [NeurIPS 2026](https://neurips.cc/virtual/2026/171271).
- **"Training to refuse makes it more useful."** Mixed. Negatives-only training made models over-conservative, while balanced RPO improved both refusal and AST accuracy — [When2Call](https://arxiv.org/html/2504.18851v1).
- **"Tuning against your eval makes the product worse."** Auto-evolved harnesses overfit — [O'Reilly](https://www.oreilly.com/radar/?p=20067) (secondary).

### Inferences
- **Recommendation: expect and welcome a score drop** when moving the headline metric from pass^1 single-turn to pass^4 trajectory plus minefields plus latency budget. Present it to stakeholders as a stricter ruler, not a regression.
- **Recommendation: for "slower but feels faster," instant acknowledgement plus progressive disclosure is a testable hypothesis, not established fact.** Example: show "Reminder set for 5 pm" from the deterministic path immediately, while the model composes any extra text. A/B it in the human-preference protocol.

### Gaps
- No controlled study found on perceived intelligence vs latency/streaming/proactivity for assistants. "The UX is the intelligence" remains a practitioner intuition here.

## Q7. What prominent practitioners say that applies

### Takeaway
The practitioners converge on four points:
- simplest workable architecture;
- context and KV-cache discipline;
- single-agent with shared context;
- error-analysis-driven, binary, human-validated evals.

All of these fit Hermit's direction.

### Cited Findings
- Hamel Husain / Shreya Shankar: error analysis first, binary labels, judges validated as classifiers on 100-200 labels per failure mode — [AI Evals FAQ](https://hamel.dev/blog/posts/evals-faq/).
- Anthropic (Jan 2026): pass@k vs pass^k chosen by whether retries are acceptable, and mixed code, model and human graders — [Demystifying evals for AI agents](https://www.anthropic.com/research/demystifying-evals-for-ai-agents).
- Manus (Yichao Ji): stable prefixes, deterministic serialization, mask rather than remove tools, KV-cache hit rate as the key metric — [Manus blog](https://manus.im/blog/Context-Engineering-for-AI-Agents-Lessons-from-Building-Manus).
- Cognition (Walden Yan): share full context; avoid multi-agent splits that lose the goal — [Cognition](https://cognition.ai/blog/dont-build-multi-agents).
- Phil Schmid: the harness must be continually simplified as models improve — [Agent Harness 2026](https://www.philschmid.de/agent-harness-2026).
- NVIDIA (Belcak et al.): SLM-first, heterogeneous agent systems — [arXiv 2506.02153](https://arxiv.org/html/2506.02153v2).

### Inferences
- Anthropic's "Building effective agents" (Dec 2024, https://www.anthropic.com/engineering/building-effective-agents) is commonly summarized as: prefer the simplest solution, use deterministic workflows before autonomous agents, and invest in tool and interface design ("ACI"). That matches Hermit's forced-call workflows. *Not re-checked against the source; verify wording before quoting.*

### Gaps
- Karpathy, Simon Willison and Jason Liu were not researched. These notes hold no verified quotes from them, so don't attribute specific claims to them from here.
- ACEBench, NESTFUL, MCP-Bench, AppWorld and AndroidWorld protocols were also not covered (see Q1 gaps).
