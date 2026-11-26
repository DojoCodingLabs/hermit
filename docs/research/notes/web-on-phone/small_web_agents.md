# Small (0.5B to ~8B) open web and GUI agents: state of the art and harness techniques (as of Nov 2026)

Scope note: numbers are from the primary paper or vendor page unless marked. "Vendor claim" means self-reported by the model's developer and not independently reproduced. Benchmarks use different judges and step limits, so cross-paper numbers are only roughly comparable.

## Q1. Best published small web agents and their scores

### Takeaway
By late 2026 the small-model frontier is at 4B, not 8B. Fara1.5-4B (Microsoft, Qwen3.5-4B base, screenshot input) reports 80.8% on WebVoyager and 57.3% on Online-Mind2Web. That roughly matches OpenAI Operator (58.3% OM2W) and is far above the 2024-25 7-9B agents (Fara-7B 34.1%, UI-TARS-1.5-7B 31.3%). On text and AX-tree benchmarks (WebArena, WebArena-Lite), the best numbers are 3B at 33.9% (WebAgent-R1), 4B at 36.4% (skill-centric MiniWebAgent) and 9B at 41.5-43% (WebRL GLM-4-9B; Agent-as-Annotators). No published web-navigation result was found for any model under 2B.

### Cited findings

**Vision and screenshot agents on real-web benchmarks (pass@1)**
- Fara1.5 (published 21 May 2026, MIT weights on HF 22 Jul 2026, base Qwen3.5, SFT only, no RL). Scores are averages of 3 runs and are vendor claims: [Microsoft Research](https://www.microsoft.com/en-us/research/articles/fara1-5-computer-use-agent/)
  - Fara1.5-4B: WebVoyager 80.8, Online-Mind2Web 57.3.
  - Fara1.5-9B: WebVoyager 86.6, Online-Mind2Web 63.4.
  - Fara1.5-27B: WebVoyager 88.6, Online-Mind2Web 72.3.
  - Comparisons on the same page: Operator 87.0 / 58.3, Gemini 2.5 Computer Use 57.3 on OM2W, Yutori n1 64.7 on OM2W, and the GPT-5.4 teacher ("FaraGen1.5 solver") 93.4 / 83.4.
  - No variant smaller than 4B is mentioned.
- Same-size peers listed on that page: MolmoWeb-8B 78.2 / 35.3, Holo2-8B 80.2 on WebVoyager (no OM2W), GUI-Owl-1.5-8B 78.1 / 48.6, Holo2-30B-A3B 83.0 on WebVoyager. [Microsoft Research](https://www.microsoft.com/en-us/research/articles/fara1-5-computer-use-agent/)
- Fara-7B (Nov 2025): WebVoyager 73.5, Online-Mind2Web 34.1 (vendor). Browserbase's independent human-annotated run gave 62% on WebVoyager. [arXiv 2511.19663](https://arxiv.org/html/2511.19663v1); [HF card](https://huggingface.co/microsoft/Fara-7B)
- MolmoWeb (AI2, Apr 2026), screenshot-only, fully open data. Table 4, pass@1, 100 steps, in the order WebVoyager / Online-Mind2Web / DeepShop / WebTailBench. [arXiv 2604.08516](https://arxiv.org/html/2604.08516v1)
  - MolmoWeb-4B: 75.2 / 31.3 / 35.6 / 43.8.
  - MolmoWeb-8B: 78.2 / 35.3 / 42.3 / 49.5.
  - UI-TARS-1.5-7B: 66.4 / 31.3 / 11.6 / 19.5.
  - GLM-4.1V-9B-Thinking: 66.8 / 33.9 / 32.0 / 22.4.
  - Holo1-7B: 55.4 on WebVoyager.
  - SoM GPT-4o: 65.1 / 34.6. SoM GPT-5: 90.6 / 57.7.
  - AX-tree agent with Gemini-3-flash: 85.6 / 44.8 / 55.3 / 63.5.
- MolmoWeb training data: 278.5K trajectories and 2.2M steps. About 70K of these are synthetic trajectories from an AX-tree (text-only) teacher agent, and 36K are human trajectories. [arXiv 2604.08516](https://arxiv.org/html/2604.08516v1)
- Surfer-H + Holo1-7B reaches 92.2% on WebVoyager, but with up to 10 attempts and a GPT-4o validator, so it is not a pass@1 figure. [Steel WebVoyager leaderboard](https://leaderboard.steel.dev/leaderboards/webvoyager/); [alphaXiv 2506.02865](https://www.alphaxiv.org/fr/abs/2506.02865)
- No published Holo1.5 WebVoyager or OM2W score was found. Holo1.5-7B appears only as the localizer inside a "Surfer 2" configuration. [Steel WebVoyager leaderboard](https://leaderboard.steel.dev/leaderboards/webvoyager/)

**Text and AX-tree agents on WebArena and WebArena-Lite**
- WebRL (self-evolving online curriculum RL plus an outcome reward model), on WebArena-Lite:
  - GLM-4-9B: 6.1% to 43.0%. Per site: Reddit 57.9, GitLab 50.0, CMS 48.6, Map 36.7, OSS 37.8.
  - Llama-3.1-8B: 4.8% to 42.4%.
  - Sources: [arXiv 2411.02337](https://arxiv.org/pdf/2411.02337); [HF webrl-glm-4-9b](https://huggingface.co/THUDM/webrl-glm-4-9b/blame/main/README.md)
- WebAgent-R1 (end-to-end multi-turn RL), on WebArena-Lite: Qwen-2.5-3B goes from 6.1% to 33.9%, and Llama-3.1-8B reaches 44.8%. [arXiv 2505.16421](https://arxiv.org/html/2505.16421v1)
- Skill-centric "MiniWebAgent" (Univ. Utah, 26 Oct 2026, arXiv 2610.35823): an untrained Qwen3.5-4B planner plus a Qwen3.5-4B executor trained on 3,128 skill-level trajectories. [alphaXiv](https://www.alphaxiv.org/abs/2610.skill-centric-generalist-web-agents)
  - Benchmarks: WebArena-Lite 36.4% (+9.3pp), Online-Mind2Web 33.9% (+16.1pp), WebVoyager 65.5% (+20.0pp).
  - On unseen MiniWeb sites it scores 58.1% vs 48.4% for Fara1.5-4B.
- Agent-as-Annotators (Lù and Reddy, Apr 2026): a 9B student trained by SFT on 2,322 filtered Gemini-3-Pro trajectories scores 41.5% on WebArena. Comparisons: Claude 3.5 Sonnet 36.0%, GPT-4o 31.5%, and the previous best open-weight model 21.7%. [arXiv 2604.07776](https://arxiv.org/abs/2604.07776)
- Go-Browse (CMU, Jun 2025): Qwen-2.5-7B goes from 8.3% to 21.7% on WebArena (GPT-4o-mini scores 19.3%). The model trained on NNetNav data scores 18.8%. The data is about 10K successful and 17K failed trajectories from 100 URLs. [arXiv 2506.03533](https://arxiv.org/pdf/2506.03533); [GitHub](https://github.com/ApGa/Go-Browse)
  - WebOperator lists Go-Browse at 22.6%, a version or setup discrepancy. [arXiv 2512.12692](https://arxiv.org/pdf/2512.12692)
- Other 2024-25 data-synthesis agents on WebArena: AgentTrek-32B 22.4% (self-reported) and NNetNav Llama-3.1-8B 16.3%. OpAgent's table shows NNetNav at 7.2 under a different setup. [Steel WebArena leaderboard](https://leaderboard.steel.dev/leaderboards/webarena/); [OpAgent 2602.13559](https://arxiv.org/html/2602.13559v1)

**Small mobile and GUI agents (not web, but shows what 2-3B can do over multiple steps)**
- AndroidWorld success: UI-Venus-1.5-2B 55.6, MAI-UI-2B 49.1, Qwen3-VL-2B 36.4, GUI-Owl-1.5-8B-Thinking 71.6. These come from an aggregator leaderboard, so verify against the original papers. [SOTA2](https://www.sota2.com/research/sota/end-to-end-gui-navigation-on-androidworld); [Mobile-Agent-v3.5](https://arxiv.org/html/2602.16855v1)
- Older 2B baselines on AndroidWorld were about 0.07 to 0.09 success: ShowUI-2B and InfiGUIAgent-2B. [pith review](https://pith.science/paper/2501.04575)
- Apple Ferret-UI Lite 3B (on-device, RL-trained):
  - Navigation: AndroidWorld 28.0%, OSWorld 19.8%.
  - Grounding: ScreenSpot-V2 91.6%, ScreenSpot-Pro 53.3%.
  - OSWorld-G is 55.3% in some sources and 61.2% on Apple's page (conflict).
  - [arXiv 2509.26539](https://arxiv.org/html/2509.26539v1)

### Inferences
- The progress from 2025 to 2026 at fixed size is very large. At about 4-9B, OM2W went from about 34% (Fara-7B, MolmoWeb-8B) to 57-63% (Fara1.5). The main driver was a much better teacher (GPT-5.4 at 83% OM2W), verifier-filtered data, and around 2M SFT samples, with no RL. This recipe is distillation and is cheap to copy at smaller sizes if you have a strong teacher.
- Fara1.5-4B and MiniWebAgent both use the same Qwen3.5 family as BotPsy (Qwen3.5-0.8B). The tokenizer, chat template and pretraining distribution are shared, so the FaraGen-style recipe could in principle be distilled down to 0.8B. The scaling slope Fara reports (+15pp OM2W from 4B to 27B) is not steep. Extrapolating downward is speculative, but it suggests 0.8B is not hopeless on easy tasks.
- The earlier repo conclusion ("WebRL 8B reaches 42%, not viable on device") is outdated. A 3B reached 33.9% on WebArena-Lite with RL in 2025, and a 4B reached 57% on live-web OM2W in 2026.

### Gaps
- No published Holo1.5 or Holo2 small (≤4B) web scores. No UI-TARS-2 small web scores. No OpenCUA ≤4B web scores.
- WebDancer and WebSailor are deep-research or BrowseComp agents (search plus read), not GUI agents. Their small-model numbers were not collected.
- No small-model numbers on AssistantBench, WebLINX or BrowseComp were found.
- The Qwen-UI-Agent tech report (arXiv 2607.28227) was not read, so its sizes and scores are unverified.
- Not verified: whether MiniWebAgent's executor uses AX-tree or screenshot input.

## Q2. Harness techniques with measured gains

### Takeaway
The biggest measured harness levers fall into four groups. All are cheap at inference except best-of-N, which costs N times the compute.
- Change the action space so the model does less: APIs over browsing (+24pp absolute), programmatic skills or macros (+11 to 23% relative, 10-15% fewer steps), and planner plus skill-executor decomposition (+12.9pp for a 4B).
- Prune the observation (AgentOccam: 37.2 to 43.1%).
- Use workflow memory (AWM: +24.6% / +51.1% relative).
- Use best-of-N with a learned verifier or PRM (Web-Shepherd: 23.6 to 34.6% on WebArena-Lite; MolmoWeb-8B pass@4: OM2W 35.3 to 60.5%).

Most of these gains were measured on GPT-4-class models. The planner/executor and parallel-rollout results are the ones measured on 4-8B.

### Cited findings
- **Use APIs instead of browsing.** Beyond Browsing (CMU) on WebArena, GPT-4o: [arXiv 2410.16464](https://arxiv.org/html/2410.16464v3)
  - Browsing-only (AX tree): 14.8%.
  - API-only: 29.2%.
  - Hybrid: 35.8% in v1 and 38.9% in v3 (more than 24pp absolute over browsing).
- **Prune observations and reduce the action space.** AgentOccam aligned the observation and action spaces with what the LLM handles well. WebArena went from 37.2% to 43.1% (+15.8% relative), with about one third fewer steps than the simple-action baseline. [arXiv 2410.13825](https://arxiv.org/pdf/2410.13825)
- **Agent Workflow Memory (AWM).** It induces reusable workflows from past trajectories and injects them into the prompt. The paper reports 24.6% and 51.1% relative gains in task success on Mind2Web and WebArena; the sentence order is ambiguous, so check the paper. [arXiv 2409.07429](https://arxiv.org/pdf/2409.07429)
- **Agent Skill Induction (ASI, COLM 2025).** The agent induces Playwright-style program skills, verifies them by executing them, and keeps only those that pass. On WebArena it beats the static baseline by 23.5% and text-skill AWM-style memory by 11.3%, with 10.7-15.3% fewer steps. [arXiv 2504.06821](https://arxiv.org/abs/2504.06821)
- **SkillWeaver.** The agent explores a site and turns what it learns into executable API functions. Reported gains (secondary summary, verify against arXiv 2504.07079): [GitHub issue summary](https://github.com/jjakimoto/research-issues/issues/1418)
  - WebArena: 22.6 to 29.8.
  - Four live sites: 40.2 to 56.2.
  - Gains hold for both GPT-4o and GPT-4o-mini.
- **Planner plus skill executor at 4B.** On MiniWeb held-out tasks: [alphaXiv 2610.35823](https://www.alphaxiv.org/abs/2610.skill-centric-generalist-web-agents)
  - A single trained agent reaches only 39.2% (vs 38.7% before training).
  - Planner plus trained executor reaches 58.1% (vs 45.2% before training).
  - Training raises single-primitive success from 55.3% to 80.3%.
  - With equal data, skill-centric traces beat task-centric traces on all four benchmarks (OM2W 33.9 vs 23.2).
  - Drag and gesture skills stay unsolved, at 12.4% pooled.
- **Best-of-N with a process reward model.** Web-Shepherd PRM-guided best-of-n reaches 34.55% on WebArena-Lite vs 23.64%. With GPT-4o-mini as the policy, it gains 10.9 points at one tenth the cost of using GPT-4o-mini as the verifier. [arXiv 2505.15277](https://arxiv.org/html/2505.15277)
- **Parallel rollouts with selection (small model).** For MolmoWeb-8B: [arXiv 2604.08516](https://arxiv.org/html/2604.08516v1)
  - pass@4: WebVoyager 78.2 to 94.7, OM2W 35.3 to 60.5.
  - Three parallel 30-step runs reach 86.2% on WebVoyager vs 78.2% for one 100-step run. Several short tries beat one long try.
- **Retries with a stronger validator.** Surfer-H + Holo1-7B reaches 92.2% on WebVoyager with up to 10 attempts and a GPT-4o validator. [Steel](https://leaderboard.steel.dev/leaderboards/webvoyager/)
- **World-model planning (WebDreamer).** The LLM simulates the outcome of candidate actions before committing. On VisualWebArena, GPT-4o goes from 17.6% to 23.6% (+34.1% relative). With Qwen2-VL-7B as the world model it scores 17.2, so the gain does not clearly transfer to small models. [arXiv 2411.06559](https://arxiv.org/pdf/2411.06559); [GitHub](https://github.com/OSU-NLP-Group/WebDreamer)

### Inferences
- For a 0.8B on a phone, the most transferable levers make each step a short multiple-choice decision.
  - Prefer site APIs or recorded recipes wherever they exist (Beyond Browsing, SkillWeaver, ASI), and fall back to AX-tree browsing only on the long tail.
  - Use aggressive AX-tree pruning to a short candidate list (AgentOccam).
  - Use a fixed library of skill primitives (search, add-to-cart, fill-form, checkout-step) chosen by a planner (MiniWebAgent).
- Best-of-N and PRMs give the largest jumps but multiply on-device latency. At about 200 tok/s prefill and an 1,800-token prompt, each step costs about 9 s of prefill alone, so N=4 per step is costly. Trajectory-level retries ("3 short runs beat 1 long run") are more practical than per-step search.
- The verification step (ASI keeps only skills that pass on execution) matters because small models cannot repair bad skills at runtime.

### Gaps
- SteP (stacked LLM policies), ICAL, workflow-use (browser-use record-replay) and WebSynthesis/Explorer/Synatra numbers were not re-checked against their sources.
- No paper measured these harness techniques specifically with a sub-2B policy.

## Q3. How small can you go

### Takeaway
No published evidence was found of a sub-1B (or even sub-2B) model doing multi-step open-web navigation. The smallest credible multi-step results are:
- 2B on Android: UI-Venus-1.5-2B at 55.6% on AndroidWorld.
- 3B on WebArena-Lite: 33.9% (WebAgent-R1, Qwen2.5-3B).
- 4B on live web: Fara1.5-4B at 57.3% on OM2W; MiniWebAgent-4B at 33.9% on OM2W.

What a 0.8B could realistically do per step is pick among K pre-filtered candidates inside a skill. That is supported indirectly: a trained 4B executor reaches 80% single-primitive success, while long-horizon composition needs a planner.

### Cited findings
- Searches for Qwen 0.5B, 0.6B and 0.8B web-navigation fine-tunes (MiniWoB, Mind2Web, BrowserGym) returned nothing. The smallest web-specific models found are 3B, such as WebGUM-era work. [WebGUM arXiv 2305.11854](https://arxiv.org/html/2305.11854)
- Untrained small models score near zero on WebArena-Lite (Qwen2.5-3B 6.1%, GLM-4-9B 6.1%, Llama-3.1-8B 4.8%), and RL takes them to 34-43%. [WebAgent-R1](https://arxiv.org/html/2505.16421v1); [WebRL](https://arxiv.org/pdf/2411.02337)
- 2B GUI agents went from about 7-9% (ShowUI-2B and InfiGUIAgent-2B, early 2025) to 49-56% (MAI-UI-2B, UI-Venus-1.5-2B) on AndroidWorld within about a year. [SOTA2](https://www.sota2.com/research/sota/end-to-end-gui-navigation-on-androidworld); [pith](https://pith.science/paper/2501.04575)
- At 4B, a single agent trained on whole tasks barely improves (38.7 to 39.2%), while decomposition into skills with a planner improves by 12.9pp. This shows that small-model limits are mostly about long-horizon composition, not single-step choice. [alphaXiv 2610.35823](https://www.alphaxiv.org/abs/2610.skill-centric-generalist-web-agents)

### Inferences
- A realistic split for Hermit:
  - The 0.8B does per-step selection ("which of these 5-15 numbered refs, or type X into ref N") within a recipe or skill.
  - Deterministic code handles AX-tree pruning, the skill state machine and the verification checks.
  - Purchases should go through recorded or verified per-site recipes or APIs with human confirmation, not free-form exploration.
- Open-ended, unseen-site, long-horizon tasks remain unproven below 3-4B. Open web tasks fully on the phone with a sub-1B model are plausible only for (a) a curated set of sites with recipes or skills, and (b) short tasks (fewer than about 10 steps) on unseen sites, with best-of-few retries.
- A second small model could act as a PRM or judge (Web-Shepherd-style) to catch errors, at extra latency cost.

### Gaps
- No measured per-step accuracy for a sub-1B model on element selection from AX-tree candidates. Hermit would need its own eval, for example on Mind2Web element-selection (offline step accuracy) with Qwen3.5-0.8B.

## Q4. Cheap synthetic-trajectory and RL recipes for small web agents

### Takeaway
The 2026 consensus recipe is teacher distillation with verifier filtering, plus optional on-policy RL:
1. A frontier teacher (GPT-5.4, Gemini 3 Pro) solves generated tasks on live or synthetic sites.
2. An LLM judge or verifier filters the trajectories.
3. The student is fine-tuned with SFT on thoughts and actions. A few thousand good trajectories already yield 9B SOTA on WebArena, and about 2M samples yield Fara1.5.

RL (WebRL, WebAgent-R1) adds about 25-37pp on WebArena-Lite for 3-9B models. Exploration-based data (Go-Browse, NNetNav) is the cheaper, teacher-light alternative but gives smaller gains.

### Cited findings
- **Fara1.5.** Pure SFT on about 2M samples from FaraGen1.5 (environments, GPT-5.4 solver with a user simulator, and verifiers for correctness, efficiency and user interaction). Base model is Qwen3.5 at 4B, 9B and 27B. [Microsoft Research](https://www.microsoft.com/en-us/research/articles/fara1-5-computer-use-agent/)
  - Mix: web trajectories 60%, synthetic environments 12.8%, forms and user interaction 12.5%, grounding 8.8%, VQA 4.9%.
  - Synthetic replicas of sites improve transfer: WebVoyager domains go from 73.4 to 83.4 with synth-replica, and the full model reaches 89.8.
- **Agent-as-Annotators.** Task Designer, Annotator and Supervisor LLM roles produce 3,000 trajectories, 2,322 kept after judge filtering. Pure SFT on these brings a 9B to 41.5% on WebArena. Judge filtering, evaluation hints and reasoning traces each help in ablations. [arXiv 2604.07776](https://arxiv.org/abs/2604.07776)
- **MiniWebGen.** 3,128 verified skill-centric trajectories on 52 synthetic sites are enough to train a 4B executor. [alphaXiv 2610.35823](https://www.alphaxiv.org/abs/2610.skill-centric-generalist-web-agents)
- **MolmoWeb.** About 70K synthetic AX-tree-teacher trajectories, 35K multi-agent trajectories, 5.5K atomic-skill trajectories, 16K node-traversal trajectories and 36K human trajectories, all released openly. [arXiv 2604.08516](https://arxiv.org/html/2604.08516v1)
- **Go-Browse.** Unsupervised graph exploration of 100 URLs produced about 27K trajectories. Training on them takes Qwen2.5-7B from 8.3% to 21.7% on WebArena. [GitHub](https://github.com/ApGa/Go-Browse)
- **WebRL.** Self-evolving curriculum from failed tasks plus an outcome reward model plus adaptive RL: 8-9B goes from about 5% to about 43% on WebArena-Lite. **WebAgent-R1.** End-to-end multi-turn RL takes Qwen2.5-3B from 6.1% to 33.9%. [WebRL](https://arxiv.org/pdf/2411.02337); [WebAgent-R1](https://arxiv.org/html/2505.16421v1)
- **Web-Shepherd.** A 40K-sample step-level PRM dataset, usable both for best-of-n and as an RL reward. [arXiv 2505.15277](https://arxiv.org/html/2505.15277); [GitHub](https://github.com/kyle8581/Web-Shepherd)

### Inferences
- The cheapest path for Hermit is to distill a dedicated Qwen3.5-0.8B "web step" model from a frontier teacher operating over Hermit's own AX-tree-with-refs format. MolmoWeb shows an AX-tree teacher transfers well. Steps:
  1. Generate tasks on target shopping and booking sites plus synthetic replicas (FaraEnvs-style, safe for checkout flows).
  2. Filter with a judge.
  3. Train on skill-level segments (MiniWebGen finding), not whole tasks.
  4. Optionally finish with WebAgent-R1-style RL on synthetic replicas.
- Hermit can reuse released open datasets (Go-Browse-WA, MolmoWebMix AX-tree subset, Web-Shepherd), but would need to convert them to its own observation format.

### Gaps
- No public report distilling these recipes to under 2B, so the size-versus-score curve below 4B is unknown.
- Training cost (GPU-hours) for Fara1.5 and Agent-as-Annotators was not found.
