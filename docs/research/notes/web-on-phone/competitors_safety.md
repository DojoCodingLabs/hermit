# Consumer web agents and purchases: competitor capability, success rates, and safety architecture (status Nov 2026)

Method note: web research on 2026-11-12. Most 2026 product facts come from news and secondary explainers, because search snippets surfaced few primary vendor pages. Every number is marked [VENDOR] (self-reported), [INDEPENDENT] (third party or academic), or [SECONDARY] (aggregator or blog, unverified). Paper facts tagged "(abstract, recalled)" are cited to the arXiv primary but were not checked against it again; re-check them before quoting.

## Q1. Competitors: what web tasks and purchases they support, how, success rates, latency, failures, payment handling

### Takeaway
In Nov 2026 every leading consumer agent (Muse, Dots, Grok Bot, Claude Duet, Instinct) runs a frontier cloud model driving a Chromium browser on its own cloud VM. They pay through a wallet or token (Stripe Link, Stripe Shared Payment Token, ACP) or with a card already saved on the merchant site, and every one asks the user to approve each purchase. None runs open-ended purchasing on-device with a small model. Atomic, the only local-first one, hands planning to a cloud model in "Fusion" mode and does not advertise purchases.

### Cited Findings

**Meta Muse (launched Sep 8, 2026, US)**
- Muse runs a Chromium browser inside a dedicated cloud machine, navigates sites and fills forms. One source says it also has a file system and terminal. — [VKTR](https://www.vktr.com/ai-platforms/meta-launches-muse-a-personal-ai-agent-that-browses-the-web-makes-purchases/); [Meta help: How your Muse agent browses the web](https://www.meta.com/help/superintelligence/2124746764949121/)
- Payment goes through Link by Stripe. Meta says Muse is the first AI agent covered by Link's purchase protections. Shopify Shop Pay is announced for later. — [TechRepublic](https://www.techrepublic.com/article/news-meta-muse-ai-agent-us-launch/); [VKTR](https://www.vktr.com/ai-platforms/meta-launches-muse-a-personal-ai-agent-that-browses-the-web-makes-purchases/)
- Meta's help page says Muse asks the user to confirm before important browser actions such as a purchase. — [Meta help](https://www.meta.com/help/superintelligence/2124746764949121/)
- [SECONDARY, single source] A shopping feature added around Sep 23 completes purchases directly, with Meta taking a small transaction fee and partners including Walmart and Best Buy. — [Gate.com news](https://www.gate.com/news/detail/META/meta-muse-ai-agent-launches-shopping-feature-with-direct-checkout-24726701)
- Failure and friction: Amazon blocked Muse from buying on Amazon, citing its terms of service, and told GeekWire that the agent does not identify itself when browsing. These are Amazon's claims. — [TechRepublic](https://www.techrepublic.com/article/news-meta-muse-ai-agent-us-launch/); [Botify](https://www.botify.com/blog/meta-muse)
- No published WebVoyager, Online-Mind2Web or OSWorld score for Muse was found.

**OpenAI ChatGPT Dots (launched ~Sep/Oct 2026, DevDay) and ChatGPT agent / Operator**
- Dots are always-on agents. They buy with a card already saved on the merchant's site, and the user must sign off; approval can be given in advance for one specific purchase. Password changes and moving money between financial accounts go back to the user. Permanent deletion and software installs may need confirmation every time. — [usecarly](https://www.usecarly.com/blog/chatgpt-dots/) [SECONDARY]
- Access: the first Dot comes with Pro (from $100/month) and Business Premium. Free, Go and Plus do not get one. UK, Swiss and EEA Pro users are excluded at launch. — [Subscription Insider](https://www.subscriptioninsider.com/blog/openai-starts-dots-at-100-as-ai-agent-pricing-takes-shape); [Fello AI](https://felloai.com/openai-dots/); [Yellow](https://yellow.com/news/openai-dots-paying-chatgpt-users)
- Some Dots explainers (codersera, claudemax.shop) give inconsistent details such as a "GPT-6 Astra" model name. They are low quality and should not be used.
- Operator / CUA launch numbers [VENDOR]: 87% WebVoyager, 58.1% WebArena, 38.1% OSWorld, against a human OSWorld baseline of 72.4%. — [OpenAI CUA](https://openai.com/index/computer-using-agent/). A third-party leaderboard lists Operator at 32.6% on OSWorld. — [Steel leaderboard index](https://leaderboard.steel.dev/results/)
- Instant Checkout (ACP, built with Stripe; launched Sep 2025, broadened around Feb 2026) was scaled back in March 2026. ChatGPT shopping moved toward discovery plus the merchant's own checkout. ACP feeds and the checkout APIs remain. Payment uses Stripe's Shared Payment Token, so the agent never sees raw card data. A 4% merchant fee is reported but unverified. — [Crossmint protocol comparison](https://www.crossmint.com/learn/agentic-payments-protocols-compared); [Ekamoira](https://www.ekamoira.com/blog/chatgpt-instant-checkout-agentic-commerce-protocol-2026); [Opascope](https://opascope.com/insights/ai-shopping-assistant-guide-2026-agentic-commerce-protocols/) [SECONDARY, sources disagree on dates]
- ChatGPT Atlas failure: Zenity Labs hijacked the Atlas agent into an unauthorized Amazon purchase shipped to the attacker's address. Atlas stopped at the final purchase button itself, but Zenity got around that by having Amazon's Rufus assistant complete the checkout. Zenity describes Atlas's defenses as "mostly soft classifiers, not hard boundaries." OpenAI acknowledged the report in Feb 2026. — [Zenity Labs, "Grand Theft Atlas"](https://labs.zenity.io/post/grand-theft-atlas) [INDEPENDENT]

**Anthropic Claude Duet (launched Oct 21, 2026; research preview, US Pro/Max waitlist)**
- Runs on Claude Opus 5.5 and uses a dedicated web browser on its own VM, so it keeps working while the user's device is off. One source says users cannot yet watch its browser. — [MacRumors](https://www.macrumors.com/2026/10/21/anthropic-claude-duet/); [gHacks](https://www.ghacks.net/2026/10/23/anthropic-launches-claude-duet-a-background-ai-agent-for-claude-pro-and-max-subscribers-in-the-us/); [Computerworld](https://www.computerworld.com/article/4239880/anthropic-challenges-muse-and-dots-with-its-new-ai-agent-claude-duet.html)
- It gets user approval before sending a message, making a payment, signing a document or deleting a file. It ships on iOS, Android and claude.ai, and usage counts against subscription limits. — [gHacks](https://www.ghacks.net/2026/10/23/anthropic-launches-claude-duet-a-background-ai-agent-for-claude-pro-and-max-subscribers-in-the-us/); [Anadolu](https://aa.com.tr/en/americas/anthropic-launches-claude-duet-ai-agent-to-rival-metas-muse-openais-dots/4096538)
- No Duet-specific task-success benchmark was found. The injection numbers for the Opus family are under Q3.

**xAI Grok Bot (beta Aug 11, 2026)**
- Always-on agents with their own cloud computers that sign into the user's existing tools. — [Unite.AI](https://www.unite.ai/xai-launches-grok-bot-always-on-ai-teammates-with-their-own-cloud-computers/)
- Purchases go through a Stripe Link wallet. Each purchase raises an approval card showing merchant and amount. Only after approval does Link issue a one-time virtual card, so the bot never sees the card number. Unanswered requests expire after about 10 minutes. — [DEV Community](https://dev.to/rohan_techofficial_81a0f/grok-bot-got-a-wallet-what-xais-shopping-agent-actually-does-with-your-money-1n3g) [SECONDARY; xAI has not published full docs]
- Failure story: Elon Musk's public demo, a $241 Lego purchase, exposed two Texas addresses, an order number and partial payment details to his followers. This was a privacy leak through the agent's output or receipt, not a payment fraud. — [Ynet](https://www.ynetnews.com/tech-and-digital/article/b1bfjwksfe)
- Sources conflict on access and pricing (SuperGrok tiers and Cursor plans vs. no published price). — [layer3labs](https://www.layer3labs.io/guides/what-is-grok-bot); [AY Automate](https://www.ayautomate.com/blog/grok-bot-xai-ai-agents-explained)

**Instinct (Spear Street Technology; personal agent you text or call; invite-only)**
- Instinct's terms appoint the service as the user's agent, authorized to enter into binding agreements and transactions on the user's behalf. Group chats arrived Oct 2026; each personal agent asks permission before connecting to a group's agent. — [TechCrunch](https://techcrunch.com/2026/10/05/instinct-brings-its-ai-agent-to-group-chats-even-for-friends-without-an-account/); [aiwiki](https://aiwiki.ai/wiki/instinct_ai)
- [VENDOR] Reportedly raised $1B at a $10B valuation (Sep 28, 2026). — [aiwiki](https://aiwiki.ai/wiki/instinct_ai)
- Do not confuse it with a different YC "Instinct" that makes trading agents. — [Runtime Wire](https://runtimewire.com/article/instinct-ai-trading-agents-launch)
- No details were found on Instinct's payment mechanism or success rates.

**Atomic Agent (atomicagent.io; Developer Preview, desktop: Mac, Windows, Linux)**
- A local-first agent that runs open-weight models through llama.cpp. Managed mode downloads Atomic's own nightly llama.cpp build with TurboQuant KV-cache compression; external mode talks to any llama-server. — [Atomic docs: Local models](https://atomicagent.io/docs/features/models/); [GitHub](https://github.com/AtomicBot-ai/atomic-agent)
- In "Fusion" mode a cloud model plans and reviews while a pool of local workers does the bulk of the work. It is switched on with `/runmode fusion`. If neither seat is a cloud provider, it falls back to Local. — [Atomic docs: Fusion](https://atomicagent.io/docs/features/fusion/)
- Found no purchase feature, no mobile build and no published web-task benchmark.

**Perplexity Comet**
- Guardio built a fake Walmart storefront and asked Comet to buy an Apple Watch. Comet did not check whether the site was legitimate, autofilled the stored card and address, and completed the purchase without asking for human confirmation. In another Guardio test, a fake CAPTCHA with hidden agent instructions made Comet click and download a malicious file. — [BleepingComputer](https://www.bleepingcomputer.com/news/security/perplexitys-comet-ai-browser-tricked-into-buying-fake-items-online/) [INDEPENDENT]
- Brave found that Comet fed raw page content into the model without separating it from trusted instructions. Trail of Bits, hired before launch, showed four injection techniques that extracted Gmail data. — [Trail of Bits](https://blog.trailofbits.com/2026/02/20/using-threat-modeling-and-prompt-injection-to-audit-comet/); [PromptLayer](https://blog.promptlayer.com/browser-agent-security-risk/)

**Google Gemini agent mode / Project Mariner**
- [VENDOR] At launch (Dec 2024) Mariner scored 83.5% on WebVoyager as a Chrome extension acting only in the active tab. It has no OSWorld score because it is browser-only. A "90.5%" figure circulates without context and could not be verified. — [The Decoder / ppc.land](https://ppc.land/computer-use-agent/); [aiwiki Operator](https://aiwiki.ai/wiki/openai_operator)
- Google's commerce protocols are UCP and AP2 (Agent Payments Protocol), which compete with ACP. — [Digital Applied](https://www.digitalapplied.com/blog/agentic-commerce-standards-ucp-acp-ap2-2026-merchant-guide) [SECONDARY]
- No 2026 Gemini agent-mode checkout details were found.

**Opera Neon**
- "Neon Do" acts on the current page, manages tabs and runs scheduled tasks. [VENDOR] Opera markets it for shopping, booking and job applications. An Intelligent mode (Feb 2026) routes each request to the best agent. — [Opera blog](https://blogs.opera.com/news/2026/02/opera-neon-ai-browser-intelligent-mode/); [PR Newswire](https://www.prnewswire.com/news-releases/opera-ships-the-opera-neon-ai-agentic-browser-302570735.html)
- [INDEPENDENT] One tester found it works best for multi-source research, with "limited utility" on complex web apps, booking systems with custom interfaces, and tasks that need judgement. — [Chris Chinchilla](https://chrischinchilla.com/blog/2026/opera-neon/)

**Amazon Nova Act / Buy for Me**
- [VENDOR] Nova Act claims more than 90% task reliability on UI workflows; the benchmarks were measured internally. — [AWS blog](https://aws.amazon.com/blogs/aws/build-reliable-ai-agents-for-ui-workflow-automation-with-amazon-nova-act-now-generally-available/); [Amazon Science](https://www.amazon.science/blog/amazon-nova-act-service); [VentureBeat](https://venturebeat.com/ai/what-you-need-to-know-about-amazon-nova-act-the-new-ai-agent-sdk-challenging-openai-microsoft-salesforce)
- Buy for Me is a beta that buys from third-party brand sites inside the Amazon app. One reviewer's second purchase attempt succeeded only after 8 hours. — [ThinkML](https://thinkml.ai/buy-for-me-amazons-new-ai-shopping-agent/) [SECONDARY]

**Benchmarks overall (for parity targets)**
- Online-Mind2Web (300 live tasks on 136 sites; human-judged leaderboard): the top entries are Hark Handoff at 97.7% and Yutori Navigator n1.5 at 97.3%. Browser Use self-reports 97–98% using its own agentic judge, which is not comparable to the human-judged board. — [Yutori leaderboard](https://yutori.com/leaderboards/online-mind2web); [Browser Use](https://browser-use.com/posts/online-mind2web-benchmark); [Steel](https://leaderboard.steel.dev/leaderboards/online-mind2web/)
- [INDEPENDENT] Academic small and open models score far lower. One 2026 paper raised a small fine-tuned model from 25.66% to 33.33%; another reported 53.7% for its best configuration. — [arXiv 2601.05787](https://arxiv.org/pdf/2601.05787); [arXiv 2602.02468](https://arxiv.org/pdf/2602.02468)

### Inferences
- "Parity" in Nov 2026 means a frontier cloud model plus a cloud VM browser, with roughly 90%+ success on Online-Mind2Web-style tasks. Published small-model results (about 25–55%) suggest a sub-1B on-device model cannot match that through generic browsing alone. The realistic path is a hybrid: structured protocols and partner APIs (ACP/UCP feeds, merchant checkout APIs, Link/Shop Pay), deterministic site scripts for top merchants, and the small model as router and slot-filler. A cloud planner like Atomic's Fusion would be optional and would need a product decision.
- Every competitor puts a human at the payment commit. Hermit's fingerprint approval sheet already matches the strongest pattern (Grok Bot style: approval card with merchant and amount, then a one-time card issued only after approval).
- Running the agent visibly, with an identifying user-agent, matters for merchant access. Amazon blocked Muse partly for not identifying itself.

### Gaps
- No primary task-success numbers were found for Muse, Dots, Duet, Grok Bot, Instinct, Neon or Atomic, nor any independent head-to-head purchase-completion rate.
- No 2026 information was found for Gemini agent mode checkout or Apple (Siri / App Intents purchases). The search returned nothing.
- Typical latency is unpublished. The only data point is anecdotal: a Buy for Me purchase that took 8 hours.
- BrowseComp numbers were not collected.

## Q2. End-to-end purchase flow and which steps products hand back to the user

### Takeaway
The flow is find → compare/choose → cart → identity/address → shipping option → payment → final commit → confirmation and receipt. The agents automate find through the shipping option. The payment commit (and often login, CAPTCHA and 2FA) goes back to the user or to a scoped token.

### Cited Findings
- Muse: confirms before purchase. Dots: user sign-off, or pre-approval for one named purchase. Duet: approval before payments. Grok Bot: approval card with merchant and amount, then a one-time card. — [Meta help](https://www.meta.com/help/superintelligence/2124746764949121/); [usecarly](https://www.usecarly.com/blog/chatgpt-dots/); [gHacks](https://www.ghacks.net/2026/10/23/anthropic-launches-claude-duet-a-background-ai-agent-for-claude-pro-and-max-subscribers-in-the-us/); [DEV](https://dev.to/rohan_techofficial_81a0f/grok-bot-got-a-wallet-what-xais-shopping-agent-actually-does-with-your-money-1n3g)
- Dots routes credential changes (passwords) and moving money between financial accounts to the user. — [usecarly](https://www.usecarly.com/blog/chatgpt-dots/)
- Atlas stopped at the final purchase button on its own. The bypass went through a second agent (Rufus) inside the merchant site. Commit gating has to cover any on-site assistant, not just the agent's own click. — [Zenity](https://labs.zenity.io/post/grand-theft-atlas)
- Comet completed checkout with autofilled card and address and no confirmation on a fake store. Merchant legitimacy was never checked. — [BleepingComputer](https://www.bleepingcomputer.com/news/security/perplexitys-comet-ai-browser-tricked-into-buying-fake-items-online/)
- The Grok demo leaked addresses and payment fragments. The confirmation and receipt step is itself a data-exposure surface. — [Ynet](https://www.ynetnews.com/tech-and-digital/article/b1bfjwksfe)
- With ACP/SPT, the merchant runs checkout via API, and the agent passes a scoped token rather than card data. — [Crossmint](https://www.crossmint.com/learn/agentic-payments-protocols-compared)

### Inferences
- How each Hermit risk class maps to the flow:
  - Find, compare, cart, address and shipping are `read` and `remote_write`.
  - Filling the address is `credential`-adjacent (PII).
  - Payment and the final commit are `spend`.
  - Receipts and screenshots must be redacted before sharing.
- Hermit's approval sheet should show the item, total including tax and shipping, the merchant's verified domain, the ship-to address and the payment instrument. That is all the fields the failures above exploited.

### Gaps
- No published per-step completion statistics were found, so it is unknown which step fails most often.

## Q3. Prompt-injection defenses for web agents, with evidence; which work with a tiny model plus code-enforced policy

### Takeaway
Training models to resist injection has driven frontier injection rates near zero only in vendor tests, and a sub-1B model cannot inherit that. The defenses that do not depend on model robustness are architectural: CaMeL-style planner/quarantine separation with capabilities, dual-LLM, information-flow control (FIDES), and deterministic policy checks (Progent). These map directly onto Hermit's cage and quarantined reader. An independent 2026 adaptive evaluation warns that all of them were validated mainly on static benchmarks.

### Cited Findings
- **Anthropic** [VENDOR]: Opus 4.8 browser use showed 31.5% injection success with no safeguards, extended thinking on, against held-out attacks, and about 0.5% with safeguards. Opus 5 with Auto Mode reported 0% across 129 browser scenarios and 3.7% without the extra layers. — [WinBuzzer](https://winbuzzer.com/2026/06/02/anthropic-reveals-315-browser-agent-hijack-rate-xcxwbn/); [The Decoder](https://the-decoder.com/opus-5-may-have-solved-browser-based-prompt-injection-the-biggest-security-flaw-haunting-ai-agents/); [Creati.ai](https://creati.ai/ai-news/2026-07-25/anthropic-says-claude-opus-5-with-auto-mode-drove-browser-prompt-injection-success-to-zero-in-in/)
- [SECONDARY, unverified] Opus 4.6 GUI agent: 17.8% at 1 attempt, 78.6% at 200 attempts without safeguards, and 57.1% with safeguards. Persistent attackers matter. — [rogueai.de](https://rogueai.de/blog/ai-agent-prompt-injection-success-rate/)
- [INDEPENDENT] In a large public injection competition, Claude Opus 4.5 was the most robust at 0.5% ASR over 12.0k attempts. — [arXiv 2603.15714](https://arxiv.org/pdf/2603.15714)
- **OpenAI Atlas**: Zenity calls its defenses "mostly soft classifiers." A separate researcher broke it within hours of launch. No Atlas ASR number was found. — [Zenity](https://labs.zenity.io/post/grand-theft-atlas); [atlas-prompt-injection-poc](https://github.com/brennanbrown/atlas-prompt-injection-poc)
- **CaMeL (Google DeepMind)**: a privileged LLM writes a program from the trusted user query only. A quarantined LLM parses untrusted data but cannot call tools. A custom interpreter tracks capabilities and data provenance and enforces policies at tool calls. With o3 at high reasoning effort it solved 77% of AgentDojo tasks with provable security vs. 84% undefended. Successful attacks fell from about 100 to 0–1, at about 2.82× input tokens. An earlier version reported 67%. — [Defeating Prompt Injections by Design (arXiv 2503.18813)](https://arxiv.org/abs/2503.18813); [NeuralTrust](https://neuraltrust.ai/blog/camel-prompt-injection)
- **Dual-LLM pattern** (Willison, 2023): a privileged LLM sees only variable references ($VAR1) to untrusted content, which a quarantined LLM processes. This is the CaMeL precursor; its weakness is that it does not stop data-flow abuse. — [Simon Willison](https://simonwillison.net/2023/Apr/25/dual-llm-pattern/) (recalled, not re-fetched)
- **Progent** (programmable privilege control: deterministic allow/deny policies on tool calls):
  - Reported results: AgentDojo indirect-injection success fell from 39.9% to 1.0%.
  - [INDEPENDENT] On a weak open-weight model it fell from 25.8% to 4.2%, and an adaptive attack did not raise it (2.6%).
  - [INDEPENDENT] With GPT-5.2 under "agent data injection" attacks it fell only from 49.1% to 22.2%, so more than 20% of attacks still got through.
  - Sources: [arXiv 2606.26479](https://arxiv.org/html/2606.26479); [arXiv 2607.05120](https://arxiv.org/pdf/2607.05120); [Progent paper (arXiv 2504.11703)](https://arxiv.org/abs/2504.11703)
- **FIDES (Microsoft)**: information-flow control that labels data with confidentiality and integrity, propagates the labels through the planner, and blocks tool calls whose inputs are tainted. No ASR numbers were found. Source: [arXiv 2505.23643](https://arxiv.org/abs/2505.23643) (recalled)
- **Skeptical evidence** [INDEPENDENT]: CaMeL, FIDES, Progent, RTBAS and FORGE all report near-elimination on static AgentDojo, and the adaptive-evaluation paper argues that adaptive attacks are needed. Separately, "agent data injection" (manipulating data values rather than instructions) gets through policy layers, because a policy cannot tell a malicious price or address from a real one. — [arXiv 2606.26479](https://arxiv.org/html/2606.26479); [arXiv 2607.05120](https://arxiv.org/pdf/2607.05120)
- **Benchmarks**:
  - AgentDojo: 97 tasks and 629 security cases, the standard for utility vs. ASR. — [arXiv 2406.13352](https://arxiv.org/pdf/2406.13352)
  - WASP: web agents often start following injections, but full attacker-goal completion is low ("security by incompetence"). — [arXiv 2504.18575](https://arxiv.org/abs/2504.18575) (abstract, recalled)
  - InjecAgent: ReAct GPT-4 was vulnerable about 24% of the time, roughly doubling with "hacking prompt" reinforcement. — [arXiv 2403.02691](https://arxiv.org/abs/2403.02691) (abstract, recalled)
  - A 793-episode browser benchmark on domain-conditioned safety in frontier computer-use agents (2026). — [arXiv 2606.05233](https://arxiv.org/pdf/2606.05233)
- **Comet's root cause** was mixing page text with instructions (Brave). That is exactly what a planner/quarantine split prevents. — [PromptLayer summary](https://blog.promptlayer.com/browser-agent-security-risk/)

### Inferences
- What works with a sub-1B model plus code policy:
  - **Works**: CaMeL/dual-LLM structure. The privileged planner sees only the user's words and fixed tool schemas. The quarantined reader returns typed values (price: decimal, domain: string, sku) that never become instructions.
  - **Works**: a Progent-style deterministic policy at every `remote_write`/`spend`/`credential` call. Examples: the origin must equal the vault entry's exact origin; the merchant must be on an allowlist; the amount must be ≤ the cap; the ship-to address must be one saved in the vault.
  - **Works**: FIDES-style taint labels. Any argument derived from quarantined content forces the approval sheet and marks the tainted fields visually.
  - **Does not transfer**: classifier and model-robustness defenses (Anthropic safeguards, Atlas classifiers). They rely on frontier-model judgement.
- The residual risk is data injection: a fake price, a look-alike domain, a swapped address. The defense is showing those exact values on the fingerprint sheet and verifying merchant origin in code, not in the model. That matches the Comet fake-Walmart and Atlas address-swap failures.
- Hermit should gate commits through on-page assistants such as Rufus, for example by blocking chat widgets on merchant origins during checkout.

### Gaps
- No FIDES numbers and no Atlas ASR number were found.
- No evaluation was found of any of these defenses with a sub-1B planner. CaMeL's utility depends on the planner writing correct programs, and its utility with tiny models is untested in the literature found.

## Q4. Payment safety: spend caps, virtual cards, network agent tokens, allowlists, confirmation UX, fraud/chargebacks, stablecoin wallets

### Takeaway
The industry pattern is that the agent never holds raw card data. Instead it gets a scoped, revocable credential minted per purchase after approval: Stripe Link one-time card, Stripe Shared Payment Token, Visa Intelligent Commerce token, or Mastercard Agentic Token. Spend limits, merchant and MCC restrictions, and expiry are enforced by the issuer or network, outside the agent.

### Cited Findings
- Mastercard Agent Pay issues "Agentic Tokens" scoped to agents. They support spend limits, counterparty allowlists, MCC and category restrictions, and real-time revocation. — [Crossmint agent cards](https://www.crossmint.com/learn/agent-card-payments-compared); [Eco: Mastercard Agent Pay](https://eco.com/support/en/articles/15192001-what-is-mastercard-agent-pay-ai-agent-commerce-protocol-in-2026) [SECONDARY]
- Visa Intelligent Commerce extends network tokens to agents with payment passkeys, user-set limits and approval requirements. — [Eco: Visa Intelligent Commerce](https://eco.com/support/en/articles/14845484-visa-intelligent-commerce-explained) [SECONDARY]
- Visa and Mastercard enrollment runs through issuing banks and partners. As of April 2026 there were "five concrete production deployments," including Mastercard Agent Pay and Visa Intelligent Commerce. — [Crossmint](https://www.crossmint.com/learn/agent-card-payments-compared); [Digital Applied](https://www.digitalapplied.com/blog/agentic-commerce-standards-ucp-acp-ap2-2026-merchant-guide)
- Stripe Issuing `spending_controls` on cards and cardholders cover allowed and blocked MCC lists plus amount limits per interval. An agent can mint a single-use virtual card per purchase. A $500/day default for new cards is a single-source claim and unverified. — [Crossmint](https://www.crossmint.com/learn/agent-card-payments-compared); [startupik](https://startupik.com/ai-agent-spending-limits-2026/)
- Stripe Shared Payment Tokens (ACP) can carry Agent Pay and Intelligent Commerce tokens. — [Crossmint](https://www.crossmint.com/learn/agent-card-payments-compared)
- Grok Bot's flow: approval card, then Link issues a one-time virtual card; the request expires after 10 minutes. Muse is covered by Link purchase protections, the first AI agent so covered. — [DEV](https://dev.to/rohan_techofficial_81a0f/grok-bot-got-a-wallet-what-xais-shopping-agent-actually-does-with-your-money-1n3g); [TechRepublic](https://www.techrepublic.com/article/news-meta-muse-ai-agent-us-launch/)
- Comet completed a purchase on a fake store with a stored card. Card autofill without origin checks is the anti-pattern. — [BleepingComputer](https://www.bleepingcomputer.com/news/security/perplexitys-comet-ai-browser-tricked-into-buying-fake-items-online/)
- Protocol landscape: ACP (OpenAI/Stripe), UCP and AP2 (Google), MPP, and x402 (stablecoin/HTTP 402). — [Crossmint protocols](https://www.crossmint.com/learn/agentic-payments-protocols-compared)

### Inferences
- **Recommended stack for Hermit:**
  1. Never let the model see card data. Pay with an approval-triggered single-use card or network agent token (Link, Privacy.com-style or Stripe Issuing card locked to the merchant, Visa/Mastercard agent token).
  2. Enforce the cap twice: in Hermit's cage (per transaction, per day, per merchant) and at the issuer.
  3. Allowlist merchants by exact origin, reusing the vault's exact-origin matching. Never autofill on a look-alike domain.
  4. The fingerprint sheet shows the final total, merchant domain, item, ship-to and instrument. The approval expires (about 10 minutes, like Grok's).
  5. The signed action log stores the approved values, which serves as chargeback and dispute evidence.
  6. Receipts are redacted before any share.
- Chargebacks: a scoped token with issuer-side limits plus a cryptographic record of user approval should support dispute and "authorized by cardholder" claims. Liability rules for agent-initiated transactions were not found and need confirmation.
- Self-custodial stablecoin wallets (x402 and similar) have no chargeback or issuer-side reversal. A sub-1B agent holding a hot key concentrates risk: any injection that reaches `spend` is final. If Hermit offers one at all, keep it behind hard caps, a separate small-balance wallet, and per-transaction biometric signing.

### Gaps
- Privacy.com's agent-specific product, and network rules on chargeback liability for agent-initiated purchases, were not confirmed by search.
- No primary Visa or Mastercard developer docs were fetched. The token-control details come from secondary explainers.
- Stablecoin wallet risks are inferred from protocol design; no loss incident data was gathered.
