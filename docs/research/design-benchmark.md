# Design benchmark: AI agent apps, for Hermit's design pass

Researched 2026-11-17 with web search and the vendors' own pages. It informs the mockups of the core screens (Q143): chat, approval sheets, onboarding, wallet, web tasks and settings.

- **Reference screenshots:** `docs/research/design-benchmark/index.html` shows them grouped by product and screen type, each with its source URL. The images live in `docs/research/design-benchmark/refs/`, which is gitignored: they are third-party images from public pages (store listings, help centers, docs, press) and are not committed. The `manifest-*.tsv` files that record each image's source sit in that folder too, so they also stay on the machine that took the screenshots.
- **Markers:** (official) means a vendor site, help center, docs or store listing. (secondary) means press, a review or a third-party guide. (unverified) means we could not confirm it. Store screenshots are marketing composites, so they show the intended design, not always a raw capture.
- **Hermit's locked rules this benchmark works within:** `docs/brand/BRANDBOOK.md` and `docs/brand/tokens.json`. The crab is the reference drawing and is never redrawn; it only moves, rotates or swaps its real pieces into the 15 states. Sea glass means Hermit, amber means needs your approval, coral means blocked by the cage. The character never replaces text. The approval sheet shows the exact action, rendered by the app, never by the model. Anything that leaves the phone needs a fingerprint.

## 1. What we found, in one paragraph

Every serious agent app of late 2026 converged on the same skeleton: one ongoing conversation with a character at the top, an inline approval card that names the action with a specific verb, a three-way consent vocabulary (once, always, deny), a separate sheet for passwords that the model never sees, a "has control / Take over" handoff for the browser, and a task list grouped by what the user has to do. All of them run in someone else's cloud. None of them can show you the browser on your own phone, none puts spending caps inside the approval card, none signs its approvals with the phone's own key, and none can show a verifiable log. Hermit should copy the skeleton, which users now expect, and win on the four things nobody else can do.

## 2. Products covered

| # | Product (current name) | Maker | Verified | Why it is here |
|---|---|---|---|---|
| 1 | Muse ("Muse from Meta") | Meta | Yes, official | Named in the PRD |
| 2 | Meta AI (Android) | Meta | Yes; approval, memory and onboarding screens unverified | Mainstream |
| 3 | dots (ChatGPT dots) | OpenAI | Yes via OpenAI's docs; launch post blocked, purchase card not public | Named in the PRD |
| 4 | ChatGPT (Android), incl. "Work" agent mode | OpenAI | Yes; Android onboarding unverified | Mainstream |
| 5 | Claude Duet | Anthropic | Yes, official; first-run and settings screens not public | Named in the PRD |
| 6 | Claude (Android) | Anthropic | Yes; mobile connector prompt wording secondary | Mainstream |
| 7 | Gemini (Android), incl. app automation, Spark, Nano | Google | Yes; Spark progress UI and offline app unverified | Mainstream |
| 8 | Grok Bot | xAI with Cursor | Yes, official docs; its own pay card not public (Stripe's Link sheet shown instead) | Named in the PRD |
| 9 | Instinct | Spear Street Technology | Yes, but mostly from press and reviews; settings panel is a leaked beta | Named in the PRD |
| 10 | Atomic Agent | AtomicBot-ai | Yes, official docs and repo; first-run wizard secondary | Named in the PRD |
| 11 | OpenClaw | OpenClaw Foundation | Yes, official docs and Play listing; official iOS listing unconfirmed | Named in the PRD |
| 12 | Perplexity (Android app and Assistant) | Perplexity | Yes | Mainstream |
| 13 | Comet for Android | Perplexity | Yes; Android password manager unverified | Mainstream, web agent |
| 14 | Manus (2.0) | Manus (Meta) | Yes | Popular now |
| 15 | Cue by Manus | Manus | Yes, invite-only | Popular now; per-agent wallet and caps |
| 16 | Doubao Mobile Assistant | ByteDance on ZTE Nubia | Partly: press and hands-ons, China only, current sale status unconfirmed | Phone-use agent |
| 17 | AutoGLM | Zhipu / Z.ai | App yes; consumer confirm screen not public | Phone-use agent |
| 18 | Qwen app (千问) | Alibaba | Yes; pay confirm sheet not public | Popular now, in-chat payment |
| 19 | Rabby Wallet | DeBank | Yes | Wallet reference: pre-sign simulation and risk labels |
| 20 | 1Password (Android) | 1Password | Yes | Vault reference: scoped fill consent, recovery kit, health view |
| 21 | Android system sheets (Credential Manager, BiometricPrompt, Privacy Dashboard, permissions) | Google | Yes, official docs | The trust baseline on Hermit's only platform |

Considered and not covered: Poke (reportedly no standalone app and acquired, unverified), Alexa+ (Play listing is still the device app), Siri AI (beta, iPhone only), Honor YOYO, Samsung's agent, Rabbit, Opera Neon, Genspark (not researched, no claims made), Phantom and Rainbow (same simulation idea as Rabby, less documented), Bitwarden and Proton Pass (overlap 1Password), Signal (few approval surfaces). Android Protected Confirmation was left out: its deprecation was merged and then reverted, so Hermit should not design around it.

## 3. Comparison tables

### 3.1 Shape of the app

| Product | Platforms | Home | Input | Character | Light/dark |
|---|---|---|---|---|---|
| Muse | Android, iOS, web, WhatsApp, Chrome extension | One main thread, mascot top center, 5-tab bottom bar (Chat, Library, Ideas, Goals, apps) | Pill with +, mic; live voice with animated avatar | Plush beige 3D creature, is the status line and the door to Activity | Light; dark not seen |
| Meta AI | Android, iOS, web, Meta apps, glasses | Chat; Library | Pill with +, Instant/Thinking chip, mic, voice | None (sparkle) | Light |
| dots | ChatGPT mobile/desktop, Slack, Teams, SMS, calls | Dedicated thread, avatar and name pill top center | "Message Alfred", +, mic, call | Customizable blob with eyes and accessories; user bubbles take its color | Light |
| ChatGPT | Android, iOS, web, desktop | Minimal chat, sidebar | "Ask ChatGPT" pill, +, mic, voice orb | None | Both |
| Claude Duet | Android, iOS, claude.ai | One main thread plus channels; Chat, Tasks, Make tabs; morning brief as home | "Message Claude Duet", +, mic, voice | Orange blob mark used as avatar, notification icon, voice visual | Light; dark not seen |
| Claude | Android, iOS, web, desktop | Chat, history drawer | Box with +, model chip, mic, voice | None (asterisk mark) | Both |
| Gemini | Android, iOS, web, Mac | Big greeting under the spark, gradient, no chips | Floating pill: +, mic, Live | None (multicolor spark, gradient glow) | Both |
| Grok Bot | Android, iOS, desktop | Messenger: bots as contacts with status previews | "Ask Chief of staff", +, mic | One blob per bot, user picks shape and color | Light; dark not seen |
| Instinct | iMessage, SMS, WhatsApp, calls; web workspace | The user's own messaging app | Texts and voice notes | None in UI; stickman logo | n/a |
| Atomic Agent | Desktop, CLI, Telegram/Discord remote | Sidebar plus thread | Composer with run-mode, model and "Ask first" chips | Blue 3D mascot in blog art only | Dark default |
| OpenClaw | Self-hosted gateway; Android, iOS, macOS remotes; 20+ chat channels | Overview card "Molty is working" | One button: Talk, Send, Stop | Red space lobster "Molty", molting lore | Dark charcoal, coral-red |
| Perplexity | Android, iOS, web, Mac | Answer threads, Discover | "Ask follow-up" pill, mic | None | Dark in store shots |
| Comet | Android, desktop, iOS | New-tab with widgets and "Ask assistant or navigate" | Bottom address bar with assistant and voice | None | Light |
| Manus | Android, iOS, web, desktop | One input card plus capability chips | +, connectors, computer, mic | None (hand mark) | Light |
| Cue | Android, iOS, web, desktop, Messages, WhatsApp | Row of agent avatars, then a thread list | "Message <agent>", mic | One flat geometric character per agent | Light |
| Doubao | System level on Nubia phones | Voice first | Wake word | Avatar app icon | Light |
| AutoGLM | Android, iOS, web | Persona cards, greeting, suggestion cards | Bottom input, Chat / Phone tabs | 3D personas | Light, orange |
| Qwen | Android, iOS, web | Greeting, suggestion lines, mode chips | Input with camera and +; voice orb | None | Light, blue-violet |

### 3.2 Agent at work, approvals, connections

| Product | Shows work as | Approval surface | Consent words | Secrets | Connections and memory |
|---|---|---|---|---|---|
| Muse | Status line under the mascot; "Browser" card with live thumbnail, Open browser, Take control, Stop; Activity log | Inline card: merchant domain, page screenshot, card, estimated total; Deny / Allow | Allow once, for this task, for this site, Always; See task details | Secure credentials store | Connectors (Available / Connected), per-connector defaults; Memory.md and Soul file |
| dots | Task chips with spinner; Activity groups; "Alfred has control" pill with Take over | Rules decide; pay card not public | Take action without asking / when you say so / Ask before / Hand off to you | Private sign-in sheet, "Save to Passwords" | 4,000+ plugins; computer access off by default |
| ChatGPT Work | Collapsible one-line steps with favicons, live browser screenshot, "Worked for 2m 30s" | Asks before booking or paying; Codex card "Permission requested" with Approve / Always approve / Deny | Always ask, Auto approve, Always allow, per site | Sign-in sheet with reassurance copy | Plugins grid; Saved memories |
| Claude Duet | Tasks tab: Ready for review, Needs input, Working, Resolved; cannot show its browser | Elevated card: question title, one paragraph with amount and comparison, "1 of 3", Not now / Order; email card shows the whole message | Specific verb, Not now defers | Local form the agent never sees | 6,000+ connectors from Claude; memory inherited |
| Claude | Background task list; lock-screen notifications | Drafts handed to Android's own apps to send | Always allow / Needs approval / Blocked per tool | n/a | Customize > Connectors; Your Claude memory with Topics |
| Gemini | "Task in progress" live mirror of the app, caption, Stop task / Take control; undismissable chip; progress notification | Stops before payment: "Finalize this task" card, user taps Place order in the merchant app | Always allow / Only this time / Don't allow per app | n/a | Personal Intelligence > Connected apps, Memory summary |
| Grok Bot | Live view of its cloud computer; Take over | Card with operation and inputs, warning chips, expiry, "Expired, did nothing"; Pay button carries the amount | Allow once / Always allow (saves a rule) / Deny | Vault, 1Password, Secure Form | Connect apps with states Needs auth, Reconnect; memory per bot |
| Instinct | Only messages | Link payment request only; acts without asking elsewhere | Per-group trust | Vault | Web workspace; disconnecting keeps data |
| Atomic Agent | Collapsible reasoning and tool rows; worker rows with time and cost | Inline prompt; receipt "Approved 18:22:41, edit files in this folder" | Approve, deny, grant category; email always asks | n/a | Integrations tab; inspectable memory |
| OpenClaw | "Worked for X, N tools"; agent browser card | Exact command and folder; buttons locked until loaded; first answer wins across devices | Allow Once / Always Allow Here / Don't Allow | n/a | Phone capabilities list with Grant; markdown memory |
| Perplexity | "20 steps", Searching and Reading chip groups | Write-only to email and messages (drafts) | Allow / Always Ask / Deny per connector tool | n/a | Memory toggles; memories shown as sources |
| Comet | Bottom sheet step log over the live page | Purchase confirm is plain chat text, no button, no auth (anti-pattern) | Try without browsing / Allow once / Always allow | Unverified | n/a |
| Manus | Cloud browser live; notification when done | Ask for approval / Approve for me / Full access | Always allow / Never per app | Take Over for credentials and payment | Connectors grid |
| Cue | Collapsible result rows | Inline card that becomes "Allowed"; "S$32 below your limit" next to Book | Allow | n/a | Phone, Wallet, Computer, Mail per agent; "Memory updated" chip |
| Doubao | Screen-edge glow, status-bar pill with the app driven | "Please operate manually" sheet with the reason, Confirm manually, Supplement, Stop | Allow once / Always allow / Deny | Refuses banking and payment apps | Per-app allow list; lock-screen use off by default |
| AutoGLM | 3-stage stepper, chips counting taps, swipes, inputs | Takeover on login, captcha and black (secure) screens | n/a | Cloud phone holds logins | Not public |
| Qwen | Service cards (shop, hotel) | One confirmation, Alipay in chat | n/a | n/a | Taobao, Alipay, Fliggy built in |
| Rabby | n/a | Simulation result first, decoded action, risk chips; Sign disabled until risks acknowledged | Ignore the alert | n/a | Approvals dashboard with batch revoke |
| 1Password | n/a | Fill consent: Allow Once / Always Allow / Cancel | Same | Vault, OTP with countdown ring | Watchtower lists only problems |
| Android | Privacy Dashboard timeline by day | BiometricPrompt with explicit confirm; auth-per-use keys | While using / Only this time / Deny | Credential Manager names the provider | Privacy Dashboard, mic and camera indicators |

## 4. Per-product notes

Each section lists what matters for Hermit's screens, then what to borrow and what to avoid. Sources are linked inline.

### 4.1 Muse (Meta)
- **Platforms:** standalone app ([Play](https://play.google.com/store/apps/details?id=com.facebook.aura), [App Store](https://apps.apple.com/us/app/muse-from-meta/id6760173601)), muse.ai, WhatsApp, a Chrome side-panel extension; US launch Sep 8, 2026 ([Meta newsroom](https://about.fb.com/news/2026/09/introducing-muse-personal-ai-agent/)). Separate from the Meta AI app.
- **Home and chat:** one persistent thread styled like texting, the mascot centered at the top with its name. Composer pill with + and mic. Bottom tabs: Chat, Library, Ideas, Goals, a custom apps grid. The Ideas tab is the empty state: first-person offers with the evidence ("I can follow up on your airline refund. I found an email from the airline...") (store screenshots).
- **Working:** the status line under the mascot reads "Is working", "Is updating memory", "Booking reservation...". Browser work is a "Browser" card with a live thumbnail and Open browser; inside, Take control pauses Muse and Stop ends the task ([Meta help: browsing](https://www.meta.com/help/superintelligence/2124746764949121/)). Tapping the mascot opens the Activity log and Upcoming ([Meta help: approval](https://www.meta.com/help/superintelligence/1385290430137537/)).
- **Approval:** an inline checkout card: "Checkout · Muse wants to place an order at ncvss.com", a warning to verify the merchant's terms, a screenshot of the merchant page with Review order, "Credit Card •••• 1234, Pay with Link", "Estimated total $80", grey Deny and blue Allow (refs meta-muse-2). Scopes: Allow once, Allow for this task, Allow for this site, Always allow, Deny, See task details ([Meta help](https://www.meta.com/help/superintelligence/1385290430137537/)). Payment by Link; Muse never sees the card ([Stripe](https://stripe.com/newsroom/news/stripe-helps-meta-muse-shop-with-link)).
- **Connections and memory:** Connectors screen with Available / Connected segments and Connect links; Settings > Permissions holds defaults ("Ask for some actions" / "Always ask") per connector and for web access, plus Allowed websites with revoke. Memory is an editable "Memory.md" and a "Soul" personality file ([Meta help: data](https://www.meta.com/help/superintelligence/2225571704857152/)).
- **Onboarding:** the mascot greets and walks through what Muse can do ([Android Authority](https://www.androidauthority.com/meta-muse-one-week-later-hands-on-3718233/), secondary). Name and avatar are changed only by chatting ([Clearmud](https://www.clearmud.ai/blog/my-first-impressions-on-muse-ai-by-meta-does-it-earn-a-spot), secondary).
- **Visual language:** white and pale grey, soft blue accent, rounded cards, frosted pill tab bar, emoji list icons. The plush beige creature is always visible.
- **Borrow:** the mascot as live status and as the door to Activity; the approval card that shows the real merchant page and the total; graduated scopes; Ideas that say why.
- **Avoid:** "Help improve our AI models" on by default; editing identity only through chat; raw system files shown to everyday users ([eesel](https://www.eesel.ai/blog/meta-muse-agent-review), secondary).

### 4.2 Meta AI (Android)
- [Play listing](https://play.google.com/store/apps/details?id=com.facebook.stella), updated Nov 12, 2026; general assistant and the glasses companion. Composer has a mode chip whose popover explains each mode in one line ("Answers right away" / "Reasons longer before answering"). Reasoning sits in a collapsed "Show thinking" row. No public approval, memory or onboarding screens (unverified).
- **Borrow:** plain one-line descriptions on mode choices; reasoning collapsed by default. **Avoid:** feed and creator content mixed into answers; too many surfaces in one app.

### 4.3 dots (OpenAI)
- **Platforms:** created in ChatGPT on mobile or desktop, reachable in ChatGPT, Slack, Teams, texting and calls ([OpenAI docs: Meet dots](https://learn.chatgpt.com/docs/dots)). Pro and Business plans; not in the EEA, UK or Switzerland at launch ([Fello AI](https://felloai.com/openai-dots/), secondary).
- **Home and chat:** a dedicated thread with the dot's avatar and name pill at the top; user bubbles take the dot's color (refs openai-dots-1).
- **Working:** task chips with a spinner and an unread badge; Activity grouped In progress, Scheduled, Completed. In the cloud computer a floating pill says "Alfred has control" with a black Take over button; Return control hands it back ([docs: computers](https://learn.chatgpt.com/docs/dots/computers-and-apps)).
- **Approval:** an auto-review decides proceed, ask or hand off; password changes and money transfers always go to the user. Rule levels in plain words: "Take action without asking", "Take action when you say so", "Ask before taking action", "Hand off to you" ([docs: controls](https://learn.chatgpt.com/docs/dots/controls)). Sign-in is a private sheet with the URL, email, masked password, "Save to Passwords", and "Take over to sign in", "Not now", "Sign in" (refs openai-dots-5). The purchase card is not public (unverified).
- **Onboarding:** name the dot, shape its look (shape, color, eyes, accessories), connect plugins (skippable), optionally a computer; the dot introduces itself ([docs: getting started](https://learn.chatgpt.com/docs/dots/getting-started)).
- **Borrow:** the persistent "has control / Take over" pill; secrets in their own sheet; rule levels in plain words. **Avoid:** setup gated to desktop; Pause that doesn't stop delegated tasks.

### 4.4 ChatGPT (Android) and Work
- [Play listing](https://play.google.com/store/apps/details?id=com.openai.chatgpt), updated Nov 16, 2026. The 2026 agent mode is "Work" ([OpenAI docs](https://learn.chatgpt.com/docs/get-started-with-work)).
- **Working:** collapsible one-line steps with favicons ("Opening secure DMV sign-in", "Signing in securely to MyDMV") and an inline live screenshot; finished work reads "Worked for 2m 30s" with a chevron ([docs: browser](https://learn.chatgpt.com/docs/browser), refs chatgpt-3, chatgpt-4).
- **Approval:** asks before booking or payment. Sign-in sheet: "Sign in to continue", lock and URL, email, masked password, reassurance copy, "Sign in manually instead", "Skip". Codex permission card: "Permission requested", the command in monospace, Approve, Always approve, "Tell Codex what to do", Deny ([docs: mobile](https://learn.chatgpt.com/docs/mobile), refs chatgpt-5). Website permission presets "Always ask", "Auto approve", "Always allow", plus per-site exceptions (refs chatgpt-7).
- **Visual language:** white canvas, black primary buttons, pills, very low chrome, gradient orb for voice.
- **Borrow:** quiet collapsible steps; "Worked for" receipts; "Tell it what to do" as a fourth answer to an approval. **Avoid:** Chat, Work, Codex, dots and Pulse as overlapping modes.

### 4.5 Claude Duet (Anthropic)
- **Platforms:** separate Android and iOS app plus claude.ai, research preview from Oct 21, 2026, US Pro, Max and Ultra waitlist ([product page](https://claude.com/product/claude-duet), [announcement](https://claude.com/resources/articles/claude-duet), [Play](https://play.google.com/store/apps/details?id=com.anthropic.aibo), [help](https://support.claude.com/en/articles/17631495)).
- **Home and chat:** one ongoing thread plus topic channels; tabs Chat, Tasks, Make. The morning brief is the home: "Good morning, Elena!", numbered updates with inline task chips. Replies end with outlined quick-reply chips ("See the comparison", "Order 2 weeks") (refs claude-duet-1, claude-duet-2).
- **Working:** the Tasks tab groups by what the user must do: Ready for review, Needs input, Working, Resolved, each row with a colored status line ("Needs input · Approve the $640 health permit"). Only the user can mark a task done. It cannot show its browser; Anthropic states you can't watch or take over ([help](https://support.claude.com/en/articles/17631495)).
- **Approval:** an elevated card over the thread. Payment: source tag, "1 of 3", title as a question ("Order 2 weeks of milk?"), one paragraph with vendor, delivery, amount and a comparison ("It's $3,600, about 8% more than usual"), outlined Not now and black Order (refs claude-duet-3). Email: To, Subject, the whole body, attachment chip, edit and copy, Not now and Send (refs claude-duet-4). The product page shows "Expires in 8 min" and a status that turns into Paid or Sent. Not now lets Duet finish the rest and ask again later. Some actions stay blocked even with approval (trading, moving money between accounts).
- **Secrets:** it never sees passwords; the user types them in a separate local form. One-time cards per purchase.
- **Visual language:** warm off-white, black text, serif display type, coral accent; the orange blob mark is the app icon, chat avatar, notification icon and the voice visual (refs claude-duet-10).
- **Borrow:** question title and specific verb; amount with a comparison; the decision queue; Not now; tasks grouped by what the user must do. **Avoid:** an invisible browser; a separate app that splits the product.

### 4.6 Claude (Android)
- [Play listing](https://play.google.com/store/apps/details?id=com.anthropic.claude). Messages and email are drafted as a preview card; tapping opens the user's own messaging or email app prefilled, so Claude never sends ([help: Android apps](https://support.claude.com/en/articles/11869629-using-claude-with-android-apps)). Per-tool permissions grouped read vs write, each "Always allow", "Needs approval" or "Blocked" ([help: connectors](https://support.claude.com/en/articles/11176164-use-connectors-to-extend-claude-s-capabilities)). Memory under Settings > Your Claude with readable Topics, "Include sensitive topics" off by default, a per-chat Memory switch and incognito ([help: memory](https://support.claude.com/en/articles/11817273-using-claude-s-chat-search-and-memory-to-build-on-previous-context)).
- **Borrow:** read vs write grouping with three levels; memory off per chat in one tap. **Avoid:** everything inside one "+" menu; approvals that look different on each surface.

### 4.7 Gemini (Android)
- **Platforms:** [Play](https://play.google.com/store/apps/details?id=com.google.android.apps.bard), iOS, web, Mac. Gemini replaces Google Assistant on Android from Sep 4, 2026 ([Search Engine Land](https://searchengineland.com/google-assistant-to-be-discontinued-on-android-starting-september-4-484307), secondary; completion unverified). Gemini Nano 4 runs on-device in AICore on a few high-end phones ([Android Developers blog](https://android-developers.googleblog.com/2026/07/android-on-device-inference.html)); the app itself is mainly cloud.
- **Home:** the "Neural Expressive" redesign: a big greeting under the spark, gradient background, no suggestion chips, floating pill input with +, mic and Live; tools moved into + ([Android Authority hands-on](https://www.androidauthority.com/gemini-neural-expressive-android-app-hands-on-3668985/), secondary). While processing the top half glows.
- **Working (app automation):** a "Task in progress" screen with a shrunken live mirror of the app, a highlight frame, a one-line caption ("Selecting Popeyes..."), "Stop task" and "Take control"; a notification with the step and a progress bar; an undismissable status chip at the top of the screen ([Google security blog](https://blog.google/security/android-gemini-intelligence-security-privacy/), [9to5Google](https://9to5google.com/2026/02/25/gemini-automation-android/), refs gemini-7, gemini-8).
- **Approval:** before first use per app: "Allow Google to use screen automation with Tickora?" with "Always allow", "Only this time", "Don't allow" (refs gemini-5). At checkout it stops and hands back: a "Finalize this task" card with "Open Uber Eats", a heads-up "Finish up your task" notification and a strong vibration; the user taps Place order in the merchant app ([9to5Google](https://9to5google.com/2026/03/12/gemini-android-app-automation-galaxy-s26-rollout/), refs gemini-9, gemini-10). Android's Privacy Dashboard will show which assistants acted in which apps.
- **Memory:** Settings > Personal Intelligence > Connected apps (off by default) and Memory summary (edit the text).
- **Borrow:** live mirror plus caption plus Stop / Take control; the undismissable chip; stopping before money and handing the final tap back. **Avoid:** an overstuffed + menu; beauty over utility; onboarding copy that says it "may do things without asking" (the Spark leak, [Wired via mirror](https://wirednews.pages.dev/story/google-gemini-spark-ai-agent-hands-on/), secondary).

### 4.8 Grok Bot (xAI)
- **Platforms:** its own app ([Play](https://play.google.com/store/apps/details?id=ai.x.grok.bot), [App Store](https://apps.apple.com/us/app/grok-bot/id6794501026)) and desktop; beta from Aug 11, 2026 ([Unite.AI](https://www.unite.ai/xai-launches-grok-bot-always-on-ai-teammates-with-their-own-cloud-computers/)).
- **Home:** a messenger: bots are contacts with blob avatars and one-line status previews ("Outreach drafts queued for approval"). You make a bot by choosing its role, shape and color (refs grok-bot-2, grok-bot-5).
- **Approval:** a card with the operation and its inputs; warning chips "This can't be undone", "This shares your data outside this chat"; Allow once, Always allow (saved as a plain-language rule, card says "Saved to Custom Rules"), Deny. Compact on the phone, tap for the full request. Background cards expire after 30 minutes and then say "Expired" and that the bot did nothing. Only the requester can approve in a group ([docs: approvals](https://docs.x.ai/grok-bot/approvals-security-and-privacy)).
- **Payment:** the card shows merchant, items and total; the primary button is "Pay" with the amount on it, plus "Pay another way" and "Deny"; nothing is charged if declined or expired ([docs: vault](https://docs.x.ai/grok-bot/vault)). Stripe's Link sheet adds "Expires in 10 min", the merchant domain with Inspect, the agent's note of what it is buying, the funding card, Decline / Approve ([Stripe](https://stripe.com/blog/giving-agents-the-ability-to-pay), refs grok-bot-9). Trap: a card saved in the vault pays without asking.
- **Secrets:** Vault, then 1Password, then a Secure Form that fills the page without the model seeing values; secret cards are masked and kept out of the transcript.
- **Borrow:** the expired state that says nothing happened; warning chips; the amount on the Pay button; rules in plain words. **Avoid:** saved cards that skip per-payment approval; approvals shown only as prose in marketing.

### 4.9 Instinct (Spear Street Technology)
- No app of its own: you text or call it; group chats from Oct 5, 2026 ([TechCrunch](https://techcrunch.com/2026/10/05/instinct-brings-its-ai-agent-to-group-chats-even-for-friends-without-an-account/)). Web workspace for connections and deletion ([eesel](https://www.eesel.ai/blog/instinct-ai-review), secondary). Payments via a Link request with merchant and amount ([Fintech Brainfood](https://www.fintechbrainfood.com/p/instinct-consumer-agent), secondary). Reviews report it sending emails and changing a seat without asking ([Vellum](https://www.vellum.ai/blog/official-instinct-breakdown), secondary). Personal agents ask before joining a group's agent, with per-group trust and revoke. Visual identity is a hand-drawn stickman and doodles ([instinct.com](https://instinct.com)).
- **Borrow:** a casual tone; per-group consent. **Avoid:** no task view, no progress, one thread for everything, consent buried in terms. This is the gap Hermit's sheets close.

### 4.10 Atomic Agent
- Local-first desktop and CLI agent on llama.cpp, with Telegram and Discord remotes ([README](https://github.com/AtomicBot-ai/atomic-agent), [docs](https://atomicagent.io/docs/)). The composer carries chips for where it runs ("Local models" / "Cloud"), the model and the approval mode ("Ask first"). After a decision the thread keeps a receipt: "Approved 18:22:41, edit files in this folder". Email sends can never be granted for the session. Overnight runs deny anything needing approval and list it in the summary. In Fusion mode the backend chip, composer and bubbles turn orange. First run offers to import from other agents.
- **Borrow:** a visible local/cloud chip where you type; approval receipts in the thread; overnight runs that skip and report instead of acting; color shift when work leaves the device (Hermit's Boost later). **Avoid:** tokens, latencies and raw tool names on a consumer surface.

### 4.11 OpenClaw
- Self-hosted gateway with Android, iOS and macOS remotes and 20+ chat channels; named OpenClaw since Jan 30, 2026 ([README](https://github.com/openclaw/openclaw), [Play](https://play.google.com/store/apps/details?id=ai.openclaw.app)). Overview card "Molty is working". One trailing button that is Talk when empty, Send with text, Stop during a run. Finished turns fold into "Worked for (duration), N tools"; failures stay visible ([docs: Control UI](https://docs.openclaw.ai/web/control-ui)). Approvals show the exact command and folder, Allow Once / Always Allow Here / Don't Allow, buttons locked until the full record loads, first answer wins across devices, timeouts deny ([docs: exec approvals](https://docs.openclaw.ai/tools/exec-approvals), [docs: Android](https://docs.openclaw.ai/platforms/android)). Setup opens with a security notice, then a permissions list with Grant per item (refs openclaw-7 to openclaw-9).
- **Mascot:** Molty, a red space lobster; each rename is a "molt"; copy uses claw puns and "EXFOLIATE!" ([docs: lore](https://docs.openclaw.ai/start/lore)).
- **Borrow:** the morphing Talk / Send / Stop button; "Worked for, N tools" receipts; locked buttons until the request is complete; timeouts that deny. **Avoid:** pairing a gateway by QR for a phone user; settings sprawl; puns in serious moments. Hermit's brand book already bans molting language; stay away from red, lobster and claw wordplay.

### 4.12 Perplexity (Android) and Comet
- **Perplexity:** answer-first threads with source chips; Deep Research shows "20 steps" and alternating Searching and Reading chip groups (refs perplexity-3). Memory toggles and a searchable memory bank; memories used for an answer appear among its sources ([help: memory](https://www.perplexity.ai/help-center/en/articles/10968016-memory)). Its Android Assistant is write-only to email and messages ([help](https://www.perplexity.ai/help-center/en/articles/10452641-which-apps-is-the-perplexity-assistant-able-to-use)).
- **Comet for Android:** the assistant is a bottom sheet over the live page with the task in bold, then Reading and Reasoning groups with site chips; during checkout it logs each step while the page fills underneath (refs perplexity-comet-2, perplexity-comet-3). First-use card: "Let Assistant browse for you?" with "Try without browsing", "Allow once", "Always allow" (refs perplexity-comet-5). The purchase confirm is only chat text ending "Can you confirm that you want me to place this order?", with no card, button or authentication (refs perplexity-comet-6). Guardio got it to buy on a fake store without asking ([BleepingComputer](https://www.bleepingcomputer.com/news/security/perplexitys-comet-ai-browser-tricked-into-buying-fake-items-online/)).
- **Borrow:** memories shown as sources; the step sheet next to the page; "Try without" as a third choice. **Avoid:** prose payment confirmation; no merchant check.

### 4.13 Manus and Cue by Manus
- **Manus 2.0** ([blog](https://manus.im/en/blog/introducing-manus-2-0), [Play](https://play.google.com/store/apps/details?id=tech.butterfly.app)): one input card "Assign a task or ask anything" and capability chips. Three permission modes in the chat box: Ask for approval, Approve for me (default), Full access with a warning ([docs](https://manus.im/docs/features/desktop.md)). Take Over plus a notification for captchas and logins; asks whether to keep the login after a manual sign-in. Pairing shows a verification code. A Sept 2026 report showed a security warning appearing only after an injected action ran (secondary): approvals must come before execution.
- **Cue** ([Play](https://play.google.com/store/apps/details?id=ai.manus.agents), [cue.im](https://cue.im)): a row of agent avatars over a thread list, one flat geometric character per agent. Inline permission card ("Travel Cue would like to make phone calls on your behalf.") whose button turns into a grey "Allowed". A flight card says "S$32 below your limit" next to Book. A "Memory updated" chip appears right after the user states a preference (refs cue-4 to cue-6).
- **Borrow:** budget stated next to the price; memory writes shown as they happen; consent that stays visible in the thread. **Avoid:** a grey "Allowed" that is easy to miss; several mascot agents with wallets, which blurs who is accountable.

### 4.14 Doubao Mobile Assistant and AutoGLM (phone-use agents)
- **Doubao** on Nubia phones (China; press and hands-ons only): a pink-to-violet glow around the screen edge while it drives another app, and a status-bar pill with that app's icon (refs doubao-1). Its handoff sheet: "Please operate manually", the exact reason, "Confirm manually", and two small pills "Supplement" and "Stop". Per-function Allow once / Always allow / Deny; per-app allow list; operation while locked off by default (refs doubao-2; [Xinhua hands-on](https://www.news.cn/tech/20251226/a25b822dd8c545e2b238baa9b37910a1/c.html), secondary). After WeChat, Taobao and Alipay blocked it, it refuses banking and payment apps ([SCMP](https://www.scmp.com/business/china-business/article/3335404/bytedances-agentic-ai-smartphone-dials-digital-backlash-chinas-top-apps), secondary).
- **AutoGLM** ([App Store CN](https://apps.apple.com/cn/app/id6748391183), [Open-AutoGLM](https://github.com/zai-org/Open-AutoGLM)): Chat / Phone tabs; an "execution overview" with a 3-stage stepper and chips counting taps, swipes and inputs ("+61"); takeover on login, captcha and secure (black) screens. A row "requirements confirmed: AI auto-decided" hides a choice (refs autoglm-3).
- **Borrow:** the unmistakable "agent is driving" frame; a handoff that states the reason and always offers add-instructions and Stop; the action tally. **Avoid:** auto-decided requirements; credentials on a cloud phone.

### 4.15 Qwen app (Alibaba)
- Orders and pays in chat through Taobao and Alipay "after explicit user confirmation" ([Alibaba](https://www.alibabagroup.com/document-1948497434959151104)). It states which service and delivery address it will use, with an inline edit link before ordering (refs qwen-4). The confirm sheet is not public (unverified).
- **Borrow:** say which account and address will be used before the sheet, editable. **Avoid:** an ecosystem so wide that the payee gets vague.

### 4.16 Rabby Wallet (wallet reference)
- Pre-sign screen, top to bottom: requesting origin, **Simulation Results** (signed amounts, red out, green in, fiat value), the decoded action, the contract with "Interacted before: Yes/No", gas, signing account, Sign / Cancel. Yellow or red risk chips sit on the offending row and open a one-line reason; Sign is disabled until the user acknowledges each risk ([Rabby help: simulation](https://support.rabby.io/en/articles/14124199-understanding-rabby-s-transaction-simulation), refs rabby-1 to rabby-3). Scam transactions hidden by default in history; an Approvals dashboard with batch revoke ([help: revoke](https://support.rabby.io/en/articles/14150713-how-to-revoke-approvals)).
- **Borrow:** outcome first; risk chips on the row at fault; approve disabled while a risk is open; "first payment to this address". **Avoid:** DeFi density (slippage, gas detail); a one-tap "Ignore All".

### 4.17 1Password (vault reference)
- Fill consent: Allow Once / Always Allow / Cancel when a login isn't yet linked to an app ([help: Android autofill](https://support.1password.com/android-autofill/)); OTP card with a countdown ring (refs 1password-3). Watchtower lists only the categories with problems, each with one fix ([help: Watchtower](https://support.1password.com/watchtower/)). Emergency Kit: a printable sheet with labeled fields and a blank to write what isn't stored ([help: Emergency Kit](https://support.1password.com/emergency-kit/), refs 1password-5). Shares carry expiry and view-once.
- **Borrow:** scoped fill consent; a printable recovery sheet; a health card that lists only problems. **Avoid:** a gamified security score; silent fill on tap (fine for a human, wrong for an agent).

### 4.18 Android system sheets (platform reference)
- **BiometricPrompt** with explicit confirmation is Google's recommended setting for purchases, and its own example is titled "Confirm transaction"; Keystore keys with auth-per-use need a fresh biometric for each use ([Android: biometric auth](https://developer.android.com/identity/sign-in/biometric-auth), refs android-2, android-3). **Credential Manager** names each credential's type and provider ("Passkey · Google Password Manager") (refs android-1). **Privacy Dashboard** is a day-grouped timeline with the app icon, time, "Used in background" and Manage ([Android: explaining access](https://developer.android.com/training/permissions/explaining-access), refs android-4). Runtime permissions offer "Only this time" and can't carry a reason, so the app explains first ([Android: requesting](https://developer.android.com/training/permissions/requesting)).
- **Borrow:** the system prompt as the last gate, never the place for the details; the dashboard timeline for Hermit's activity log; naming the source of every credential.

## 5. Patterns the best apps share

1. **One conversation, a character at the top that carries status.** Muse, dots, Duet and OpenClaw put the agent's face at the top of one ongoing thread, with a status line under it ("Is working", "Molty is working"). Tapping it opens the activity log.
2. **Approvals are cards in the thread, raised when they matter.** The best card has a question as its title, the amount or recipient in the first line, a comparison or reason, and two buttons where the primary one names the action ("Order", "Send", "Pay $80"). Duet, Muse and Grok Bot.
3. **Three-way consent, the same words everywhere.** Allow once / Always allow / Deny shows up independently in Muse, Grok Bot, Gemini, Comet, Doubao, OpenClaw, 1Password and Android itself. Users have learned it.
4. **Deferral is not denial.** Duet's "Not now", Grok Bot's expiry ("Expired, the bot did nothing"), OpenClaw's timeout that denies. Every pending decision ends in a stated outcome.
5. **Secrets never pass through the chat.** dots, ChatGPT, Duet, Grok Bot and Muse all open a separate sign-in surface the model can't read.
6. **Hand control back at the money step.** Gemini stops before Place order; Doubao and AutoGLM hand off on payment and login screens; Manus requires Take Over for payment details.
7. **A visible "agent is driving" state with Stop and Take control.** Gemini's mirror and chip, Doubao's edge glow, dots' "has control" pill, Muse's browser card.
8. **Quiet progress that folds into a receipt.** One-line steps while running; "Worked for 2m 30s, 6 tools" when done; failures stay open. ChatGPT, OpenClaw, Atomic.
9. **Tasks grouped by what the user must do.** Duet's Ready for review / Needs input / Working / Resolved; dots' In progress / Scheduled / Completed.
10. **Memory is readable and its writes are visible.** Muse's Memory.md, Claude's Topics, Cue's "Memory updated" chip, Perplexity listing memories among sources.
11. **Plain-language rules.** dots' four levels, Grok Bot's "When it wants to... it should...", Claude's Always allow / Needs approval / Blocked.
12. **Neutral UI, personality in one place.** Muse, dots, Grok Bot and Cue keep screens plain and let the character carry the warmth.

## 6. Where Hermit should deliberately differ

These are Hermit's edge. The design should make them visible, not just true.

1. **The sheet is rendered by the app and signed on the phone.** Competitors' cards are built from the model's or server's output, and an auto-review model decides when to ask (dots, Grok Bot, Manus "Approve for me"). Hermit's sheet comes from the cage with the exact arguments, and the fingerprint signs that exact `argsHash`. Show it: a small mono line at the foot of every sheet, "Signed on this phone", with the hash on tap.
2. **Caps live inside the sheet.** No benchmarked product shows per-payment and daily caps in the approval (Rabby, 1Password and Android don't either). Hermit puts "Left today after this: 30 of 50 USD₮" under the amount, and a payment over a cap is a blocked (coral) sheet with no override, never a warning to ignore.
3. **Nothing auto-approves money or messages.** No "Always allow" for payments or sends, no saved card that pays silently (Grok Bot's trap), no "Approve for me" default (Manus). "Always" exists only for reads and for a specific site's login fill.
4. **You can watch the browser, because it is on your phone.** Duet can't show its browser at all; others stream a cloud VM. Hermit's web task runs in the in-app browser: show it live, full size, with Stop and Take control.
5. **Hermit never pays on a website.** Following Q121 the user taps Pay on the page. Borrow Gemini's handoff ("Finalize this task") and make it a first-class paused state, not an error.
6. **A log you can verify.** Muse and dots have activity lists; only Hermit has a signed hash chain. "Chain verified" belongs on the Activity header and on every receipt.
7. **On-device stated as a fact, once, not as a slogan.** Atomic's local/cloud chip is the right idea: one small "On this phone" marker in the header, which turns into a different state if Boost ever sends work elsewhere. No banner, no "your data is safe with us" (a banned line).
8. **One crab, no cast.** Cue, Grok Bot and dots give each agent its own character. Hermit is one agent with one locked mascot, used in its 15 drawn states; it is never customized, recolored or multiplied.
9. **No training toggle, no analytics, nothing to opt out of.** Muse turns model training on by default. Hermit's privacy screen can say there is nothing to turn off, and show which connections the app can make.

## 7. Recommendations for Hermit's core screens

Each recommendation names the products it comes from and how it fits the locked brand and the privacy promise. Brand terms: sea glass (Hermit), amber (needs approval), coral (blocked), the 15 mascot states, radius 18 bubbles / 16 cards / 28 sheets, pill buttons, Newsreader for headlines, Instrument Sans for UI, JetBrains Mono for hashes.

### 7.1 Chat

**C1. Put the crab at the top of the conversation, as the status.** Replace the 32 px logo in the header with the mascot centered above the thread at about 56 px, its current state drawn from the 15 (idle, thinking, working, asking, done, error, blocked, offline, listening), with a one-line status under it in Instrument Sans ("Reading your calendar", "Waiting for you"). Tap opens Activity. *From:* Muse, dots, Duet, OpenClaw. *Fit:* uses only the locked rig states; the line of text keeps "text first"; Quiet mode hides the crab and leaves the line.

**C2. Header: one "On this phone" marker, not a sentence.** A small sea-glass dot with "On this phone" next to the crab, tappable for "What stays here" (the honest exceptions). *From:* Atomic's local/cloud chip. *Fit:* states the promise as a fact, uses sea glass as "Hermit", avoids banned slogans.

**C3. Empty state: three things Hermit can do now, each with why.** Replace the three outlined suggestion pills with three cards in Hermit's voice, first person, with the source in a second line ("Remind you to call the bank at 9. You mentioned it yesterday."), plus a fourth generic "What can you do?" chip. When nothing is known yet, use example tasks grouped by skill (Remember, Remind, Reply, Read the web), each with a small line icon. *From:* Muse Ideas, Duet morning brief, Qwen. *Fit:* every suggestion is computed on the phone from local data; the evidence line is the privacy story told quietly. Headline in Newsreader ("What should I take care of?").

**C4. One composer, one morphing button.** A pill with attach (+) on the left, the field, a mic, and a trailing round button that is Talk when empty, Send with text, Stop while Hermit works. No separate "Enviar" text button. *From:* OpenClaw, ChatGPT, Claude. *Fit:* pill shape and radius per brand; listening state of the crab when the mic is on.

**C5. "Working" as quiet steps that fold into a receipt.** While a turn runs, show a step row under Hermit's bubble: skill icon, one line ("Checking WhatsApp for Ana's message"), a small spinner. When done, fold to "Worked for 12 s · 3 steps" with a chevron; failures stay open with what to do. *From:* ChatGPT Work, OpenClaw, Atomic, Perplexity's step counter. *Fit:* each step maps to one typed skill from the menu, so the label is exact, never model prose. Mono for any hash in the expanded view.

**C6. Show memory writes inline.** When Hermit saves something, a small chip under its reply: pearl icon (the "remember" state's prop), "Remembered: shoe size 42", tap to edit or forget. Forgetting shows the bubbles. *From:* Cue "Memory updated", Perplexity memories as sources. *Fit:* uses the remember and forget states; the memory lives only on the phone.

**C7. Reply chips under Hermit's answers.** Two or three outlined chips that do the next obvious thing ("Remind me at 9", "Reply to Ana"). *From:* Duet. *Fit:* talk first, tap if you need to.

**C8. Pending approvals pinned above the composer.** If a decision is waiting, an amber pill above the composer: "1 waiting for you", tap to raise the sheet. *From:* Duet "1 of 3", Grok Bot status previews. *Fit:* amber means needs your approval.

### 7.2 Approval sheets (all three kinds)

Common frame for every sheet (A1 to A6), then the specifics per kind.

**A1. Title is a question with the verb; the primary button repeats the verb.** "Send 20 USD₮ to Ana?" with "Pay 20 USD₮" on the button; "Send this message to Ana?" with "Send"; "Sign in to shop.example.com?" with "Use login". Secondary button "Not now". *From:* Duet, Grok Bot ("Pay" with the amount). *Fit:* pill buttons, sea-glass-deep fill for the primary (contrast rule), sheet radius 28. Replaces today's generic "Approve with fingerprint".

**A2. Outcome first, then who, then why, then details.** First block: the result in large Instrument Sans figures ("20 USD₮ to Ana · balance after 180"). Second: the recipient or site, with a "first time" flag. Third: "Why Hermit suggested this", one line quoting the user's own words ("You said: send Ana 20 dollars"). Then a "Details" disclosure with the full address, network, fee and the args hash in JetBrains Mono. *From:* Rabby simulation first and Interacted before, Duet's paragraph, brand rule "plus why Hermit suggested it". *Fit:* replaces today's flat label/value list where a 42-character address dominates.

**A3. A header strip that marks the sheet as Hermit's, not the model's.** Small asking-state crab (24 px, the envelope pose) and an amber "Needs your OK" label at the top; at the foot a mono line "Shown by Hermit, signed on this phone". *From:* nobody, Hermit's edge. *Fit:* amber meaning; the asking state exists for this; text first, the crab is a 24 px mark, never in the fields.

**A4. Risk and novelty chips on the row at fault.** "First payment to this address", "Not a saved payee", "Page content asked for this" (session tainted), each with a one-line reason on tap. A cage refusal is a coral sheet with the blocked (tucked) crab and the reason, no approve button at all. *From:* Rabby chips, Grok Bot warning chips. *Fit:* coral means blocked; no "Ignore all".

**A5. Fingerprint is the last step, through the system prompt with explicit confirmation.** Hermit's sheet carries all the detail; BiometricPrompt titled with the verb and amount confirms it, bound to an auth-per-use key. *From:* Android BiometricPrompt guidance. *Fit:* "Anything that leaves the phone needs a fingerprint."

**A6. Every sheet ends in a stated outcome.** Not now keeps the task and re-asks later; an expired sheet reads "Expired. Hermit did nothing."; after approval the card in the thread turns into a receipt ("Paid 20 USD₮ · 10:42 · in Activity"), and an unconfirmed payment says "Not confirmed yet" (Q133). Queue counter "1 of 3" when several wait. *From:* Duet, Grok Bot, Atomic receipts. *Fit:* errors don't apologize; the receipt links to the signed log.

**A7. Payment sheet specifics.** Amount, payee (saved name first, short address `0x5aAe…AeD` with full address in Details), network as a plain chip ("Stable testnet"), fee shown on its own line as on top of the amount (Q132), and a caps meter under the amount: "Today: 20 of 50 USD₮ · this payment max 25". Over a cap: coral, no button. For x402 purchases: the site's domain as a verified chip and what you get ("This page, once"). *From:* Cue "below your limit", Grok Bot Pay button, Muse merchant preview. *Fit:* caps are Hermit's edge; no "Always allow" for money.

**A8. Credential sheet specifics.** "Sign in to shop.example.com with Hugo (personal)?" with the login's name, the exact origin in mono, the vault as the named source ("Login · Hermit vault"), and the scope choice Only this time (default) / Always on this site / Not now. Never shows the password, not even masked. The one-time-code variant names where the code came from ("SMS from @shop.example.com") and offers Type it myself. *From:* 1Password fill consent, Credential Manager rows, dots and ChatGPT sign-in sheets. *Fit:* the vault never enters the chat; matches Q137 and Q140.

**A9. Message sheet specifics.** Show the whole message as it will be sent, in a bubble styled like the destination (WhatsApp, email with To and Subject), with Edit. Name the honest exception in one line: "WhatsApp sends this from your account." *From:* Duet's email card, Claude's draft card. *Fit:* brand honest exceptions; the user sees exactly what leaves the phone.

### 7.3 Onboarding

**O1. Three short screens, mascot-led, then the model download.** 1) The crab in idle with "Does everything. Tells no one." and one line on what Hermit is. 2) "What stays on this phone" with the three honest exceptions. 3) "You approve what leaves it" with a mini approval sheet and the fingerprint. Then the download with the crab in the working pose and a real size and progress. *From:* Muse (mascot greets), OpenClaw (security notice first), dots (the agent introduces itself). *Fit:* tagline and exceptions verbatim from the brand book; Newsreader headlines.

**O2. Ask for each permission in context, with Grant per item.** No permission wall at first launch. When a skill first needs access, show Hermit's own one-paragraph reason, then the system dialog; a permissions list in Settings shows each with Granted or Grant. *From:* Android guidance, OpenClaw permissions list, Gemini per-app ask. *Fit:* principled, no surprises.

**O3. Hermit introduces itself in the chat as the first message.** After setup the first thread opens with Hermit's own message and three starter cards (C3). *From:* dots, Duet morning brief. *Fit:* talk first.

**O4. Never customize the mascot, and say so with a choice that is allowed.** Offer Quiet mode (the empty shell) as the only character setting. *From:* contrast with dots and Grok Bot. *Fit:* logo lock.

### 7.4 Wallet

**W1. Balance card with the network named, and the caps beside it.** Big figure ("200.00 USD₮"), "Stable testnet" chip, then two thin meters: "Today 20 of 50" and "Per payment max 25", each tappable to change behind a fingerprint. Receive and Send as two pill buttons. *From:* Rabby balance, Cue budget. *Fit:* JetBrains Mono only for addresses; amber reserved for approval, so meters use sea glass and turn coral at the cap.

**W2. History grouped by day, with who made it.** Rows with a direction icon, counterparty name or short address, amount (no red/green alone: an arrow and a sign too), and a small crab-mark "Made by Hermit" link to the signed log entry (Q128). Unconfirmed rows say so. *From:* Android Privacy Dashboard timeline, Rabby history. *Fit:* the audit link is Hermit's edge.

**W3. Backup as a printable recovery sheet, and a nudge until it's done.** "Write down your 12 words" with a sheet modeled on the Emergency Kit (labeled boxes, the network, the date), and an amber "Back up your wallet" card on the wallet screen until checked. *From:* 1Password Emergency Kit, Rabby backup step. *Fit:* never leaves the phone; no cloud backup by default.

**W4. Saved payees as people, not addresses.** A payee list with names first and short addresses second, added behind a fingerprint (Q131). *From:* Credential Manager rows. *Fit:* a name only resolves to a saved payee.

### 7.5 Web tasks

**B1. Plan: a checklist card before anything runs.** Title ("Reorder coffee on shop.example.com"), the site as a verified chip, numbered steps from the recorded recipe, "Sign in with" picker (Q137), values that will be asked each time, and a clear line "You'll pay on the page yourself". Start and Edit. *From:* AutoGLM stepper, Duet task cards. *Fit:* recipes, not free browsing; Q121.

**B2. Running: the page full size, a frame that says Hermit is driving, Stop and Take control always visible.** A sea-glass frame and a top chip "Hermit is using shop.example.com · step 3 of 7" with the working crab at 24 px; a bottom bar with the current step in one line, Stop and Take control. When the app is in the background, a persistent notification with the step and Stop. *From:* Gemini mirror and chip, Doubao edge glow, dots "has control" pill, Comet step sheet. *Fit:* sea glass for Hermit acting; the browser is local, so this is a live view, not a stream.

**B3. Paused: a handoff sheet that says why and what to do.** Amber, the asking crab, "Your turn: pay on the page", the reason in one line, primary "Show me the page", secondary pills "Tell Hermit something" and "Stop". After the user's own tap, Resume. Codes and captchas use the same sheet with their own reason. *From:* Doubao "Please operate manually" with Supplement and Stop, Gemini "Finalize this task" with a heads-up notification. *Fit:* Q121 and Q138; never an error tone.

**B4. Done: a receipt card back in the chat.** "Done on shop.example.com · 7 steps · 48 s", what changed, "Signed out and cleared" (Q122) or "Stayed signed in", link to Activity. *From:* ChatGPT "Worked for", OpenClaw. *Fit:* states the cookie outcome, the privacy promise in practice.

**B5. Recording a recipe looks like the running state, inverted.** The user drives; a recording chip "Recording · passwords are never saved"; each captured step appears as a line in the bottom bar. *From:* Doubao virtual screen, AutoGLM action tally. *Fit:* text first, honest about what is captured.

### 7.6 Settings, privacy and permissions

**S1. Few top-level groups, by what the user wants.** Hermit (name, Quiet mode, language, appearance), What Hermit can use (connections, phone permissions, sites), Money (wallet, caps, payees), Memory, Activity, Privacy, About. Each row has a line icon and a status on the right. *From:* contrast with OpenClaw's and Atomic's sprawl, Gemini's Personal Intelligence group. *Fit:* About carries the verbatim signature with the three logos.

**S2. "What Hermit can use": one list, three states.** Every connection, phone permission and site in one list with Always / Ask each time / Off, grouped read vs write, with last used ("Used today 9:14") and Disconnect. *From:* Claude's Always allow / Needs approval / Blocked, Doubao per-app list, Perplexity per-tool grid, Muse Allowed websites. *Fit:* writes that leave the phone can't be set to Always.

**S3. Activity as a verified timeline.** Header "Chain verified" with the shield and the count of entries, then a day-grouped timeline with skill icon, one line, time and outcome (Approved, Denied, Blocked, Expired), each opening the entry with its hash in mono. A health card above lists only problems ("Chain broken at entry 412", "2 connections unused for 30 days") with one fix each. *From:* Android Privacy Dashboard, 1Password Watchtower (without a score), Muse Activity. *Fit:* the signed log is Hermit's edge; coral only for a broken chain.

**S4. Privacy screen that lists connections, not promises.** "Hermit has no server." Then the actual hosts the app can contact today (model download, WhatsApp, connected services, Stable RPC), each with why; "Delete everything" at the bottom behind a fingerprint. *From:* Muse's data controls as the contrast; the site's privacy policy (US-SITE-02). *Fit:* "Don't trust us. Read the code."

**S5. Memory as readable entries.** A searchable list of what Hermit remembers, each editable and deletable, with "Forget everything". *From:* Claude Topics, Perplexity memory bank, Muse Memory.md. *Fit:* pearl and bubbles states for remember and forget.

### 7.7 Visual system notes for the mockups

- **Icons:** add one line-icon set (1.5 px stroke, rounded joins) for skills and settings rows; every benchmarked app uses icons to scan lists, and Hermit has none today.
- **Density:** cut the stacked outlined buttons to one primary pill plus text links; use grouped lists (Android tonal containers) instead of long card stacks.
- **Motion:** the crab moves between its drawn states with short transitions; the "driving" frame pulses gently; no glow as a large surface (brand rule on glow).
- **Dark mode:** Deep sea is already defined; most competitors only show light, so a calm dark mode is a small differentiator.

## 8. The ten most important recommendations

1. Make the crab the live status at the top of the chat, drawn from its 15 states, with one line of text under it (C1).
2. Title every approval as a question with the verb, and put the verb and amount on the primary button (A1).
3. Put the outcome first on the sheet and the address, fee and hash behind Details (A2).
4. Show the caps inside the payment sheet, and make an over-cap payment a coral block with no override (A7).
5. Mark every sheet as Hermit's own: amber "Needs your OK", the asking crab small, "Signed on this phone" at the foot (A3).
6. End every decision in a stated outcome: Not now, "Expired. Hermit did nothing.", a receipt in the thread (A6).
7. Show the web task live and full size with a "Hermit is driving" frame, Stop and Take control always visible (B2).
8. Make "pay on the page yourself" a first-class handoff sheet with the reason, Show me the page, Tell Hermit something and Stop (B3).
9. Fold work into quiet steps and a "Worked for, N steps" receipt, with memory writes shown as chips (C5, C6).
10. Merge connections, permissions and sites into one "What Hermit can use" list with Always / Ask / Off, and an Activity timeline headed "Chain verified" (S2, S3).

## 9. Gaps and what we could not verify

- Purchase approval cards for dots, Grok Bot (only Stripe's generic Link sheet is public), AutoGLM and Qwen.
- Dark mode for Muse, dots, Duet and Grok Bot; first-run screens for Duet, Claude, ChatGPT and Gemini.
- Gemini Spark's progress UI; whether the Gemini app works offline; whether Gemini has fully replaced Assistant.
- Instinct's settings (only a leaked beta panel) and Mac app status; Doubao's current sale status; Comet's Android password manager.
- OpenClaw's official iOS listing (look-alikes exist).
- Store screenshots are marketing composites; treat exact spacing and type as indicative.
