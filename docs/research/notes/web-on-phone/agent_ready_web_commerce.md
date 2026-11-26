# The agent-ready web: structured paths for agents to act and pay (status Nov 2026)

Research date: 2026-11-12. Labels used: SHIPPED (generally available), TRIAL/BETA (origin trial, preview, private beta, waitlist), ANNOUNCED (press or spec only, no confirmed production use). Many sources in this space are vendor blogs and SEO trackers; primary sources are marked "(primary)". Where only secondary sources exist, that is stated.

## 1. WebMCP (navigator.modelContext / document.modelContext): spec, browser support, sites, WebView use

### Takeaway
WebMCP is a W3C Web Machine Learning Community Group draft (not standards-track), live only as a Chrome origin trial (Chrome 149 onward, opened June 9, 2026) plus an experimental flag in Edge. Real-world adoption is close to zero, and no mainstream agent was confirmed to call it as of mid-2026. Android WebView is listed as an origin-trial platform in the Blink intent, with a shipping target of WebView 157. So a react-native WebView could in principle call registered tools through injected JS, but only on sites that register tools and enrol in the trial. That is not a coverage path in 2026.

### Cited Findings
- Spec: W3C Draft Community Group Report from the Web Machine Learning CG, "not on the standards track yet." Editors are Brandon Walderman (Microsoft), Khushal Sagar and Dominic Farolino (Google). Microsoft's Patrick Brosset proposed it on 28 Aug 2025. First Draft CG Report: 10 Feb 2026. — [Spronta, State of WebMCP July 2026](https://www.spronta.com/blog/state-of-webmcp-july-2026/); spec at [webmachinelearning.github.io/webmcp](https://webmachinelearning.github.io/webmcp/)
- API: tools are registered with `registerTool()`, which takes a name, description, JSON input schema and an `execute` callback. The 21 July 2026 spec draft moved the getter from `navigator.modelContext` to `document.modelContext`. Chrome 150 deprecates `navigator.modelContext`, but the origin trial still serves it. Recommendation: feature-detect `document.modelContext` and fall back to `navigator.modelContext`. — [Spronta](https://www.spronta.com/blog/state-of-webmcp-july-2026/). The sources disagree on the date: one says the move happened in a May 27, 2026 draft ([mcpplaygroundonline](https://mcpplaygroundonline.com/blog/what-is-webmcp)). Both API names are tracked on [web-features explorer: navigator.modelContext](https://web-platform-dx.github.io/web-features-explorer/features/navigator-modelcontext) and [document.modelContext](https://web-platform-dx.github.io/web-features-explorer/features/document-modelcontext/)
- Chrome: the origin trial opened in Chrome 149, announced June 9, 2026 (primary). The page names no platforms or partners. Its stated goal: "APIs that any browser with agentic capabilities can implement." — [Chrome for Developers, WebMCP origin trial](https://developer.chrome.com/blog/ai-webmcp-origin-trial) (primary)
- History: a Chrome 146 Canary preview shipped behind a flag on 10 Feb 2026. The trial was announced at Google I/O (18–19 May 2026) and runs Chrome 149 to 156. — [Spronta](https://www.spronta.com/blog/state-of-webmcp-july-2026/). One unverified blog says the trial was extended to Chrome 162 on Oct 31, 2026 ([search summary; LLMagnet](https://llmagnet.com/2026/10/09/webmcp-is-now-in-chrome-origin-trial-heres-what-it-means-for-how-ai-agents-interact-with-your-website/)). I could not confirm this from a primary source.
- Edge: experimental flag in Edge 147 (June 2026), per [Spronta](https://www.spronta.com/blog/state-of-webmcp-july-2026/). Another secondary source says Edge has run an origin trial since Edge 150 (July 2026), ending March 30, 2027. The sources conflict here.
- Firefox and Safari: taking part in discussions, with no implementation commitment. Playwright notes that WebKit does not implement it. — [Spronta](https://www.spronta.com/blog/state-of-webmcp-july-2026/); [Playwright WebMCP class](https://playwright.dev/python/docs/api/class-webmcp)
- Android and WebView: the Blink-dev "Intent to Experiment: WebMCP" thread (May 2026) answers "Yes" to running on all six Blink platforms, including Android WebView. It lists WebView origin-trial milestones of 149 to 156 and a WebView shipping target of 157. — [blink-dev Intent to Experiment](https://groups.google.com/a/chromium.org/g/blink-dev/c/gmYffo5WOE8/m/OJxuQRP3AAAJ) (primary, read via search summary). The web-features explorer still showed Chrome Android as unsupported at fetch time ([web-features](https://web-platform-dx.github.io/web-features-explorer/features/document-modelcontext/)).
- The WebMCP proposal says tool calls need a browsing context, either a browser tab or a webview. — [webmcp proposal.md (mirror)](https://1clonegithubbyxjn.1934672944.workers.dev/webmachinelearning/webmcp/blob/main/docs/proposal.md)
- Example sites: Google named origin-trial participants at I/O: Expedia, Booking.com, Shopify, Credit Karma, TurboTax, Redfin, Etsy, Instacart and Target. As of July 2026, "none has confirmed deployment." Spronta's crawls found registered tools at roughly zero outside demos and checker sites. — [Spronta](https://www.spronta.com/blog/state-of-webmcp-july-2026/)
- Shopify documents WebMCP checkout tools for agents that run in the shopper's browser. Those agents must sign browser requests with Web Bot Auth, and Shopify verifies only registered keys. — [shopify.dev agents/checkout](https://shopify.dev/docs/agents/checkout) (primary, via search summary)
- Agents consuming WebMCP: a May 2026 independent audit found no mainstream agent calling modelContext tools. Claude, ChatGPT Agent, Perplexity and Gemini still read pages through the DOM or screenshots. Google says Gemini in Chrome will consume WebMCP tools first. — [Spronta](https://www.spronta.com/blog/state-of-webmcp-july-2026/), citing [StudioMeyer reality check](https://studiomeyer.io/en/blog/webmcp-reality-check-may-2026)
- Declarative API: planned HTML attributes on existing forms. The spec section is still marked TODO, and Lighthouse already has an informational `webmcp-form-coverage` audit. — [Spronta](https://www.spronta.com/blog/state-of-webmcp-july-2026/)
- Security: tools run with the user's logged-in session, behind a permissions policy and a secure-context requirement. `requestUserInteraction()` forces human confirmation. Remaining risks: prompt injection, misleading tool descriptions and cross-site confused-deputy chains. — [Spronta](https://www.spronta.com/blog/state-of-webmcp-july-2026/); [Chrome secure-tools guidance](https://developer.chrome.com/docs/ai/webmcp/secure-tools)
- Polyfill and earlier work: MCP-B showed that sites could expose tools to extensions. The WebMCP-org npm packages provide polyfills. — [WebMCP-org/npm-packages](https://github.com/WebMCP-org/npm-packages); [Arcade interview with Alex Nahas](https://www.arcade.dev/blog/web-mcp-alex-nahas-interview/)

### Inferences
- Mechanically, react-native-webview runs on Android System WebView (Chromium). If the WebView build and the site's origin-trial token both enable the API, JS injected through `injectedJavaScript` can enumerate tools, if the spec exposes enumeration to page script. It can call `execute` callbacks only if Hermit wraps `registerTool` before the page runs (`injectedJavaScriptBeforeContentLoaded`), capturing each tool's descriptor and callback. Hermit would then act as the "agent" through a bridge (postMessage to RN). This hook-the-registration trick works even without native browser support (polyfill style), because the page calls `registerTool` on whatever object exists. This is an inference; I found no tested report of it.
- For a small model, WebMCP tools are ideal: typed JSON schemas with short descriptions. But coverage in Nov 2026 is close to nil, so WebMCP is a 2027+ bet, not a V1 path.

### Gaps
- No primary confirmation of the Chrome trial extension to 162, the Edge trial dates, or whether WebView actually exposes the API under a trial token today.
- I found no documentation on whether embedded WebViews (not Chrome) can be the "agent" side, or whether the spec gates tool invocation to browser-provided agents only (for example, through permissions policy).

## 2. MCP servers for commerce, travel and food; remote MCP auth from a mobile client

### Takeaway
Shopify is the one platform-scale, third-party-usable path. Shop MCP (Oct 13, 2026) gives any MCP client catalog search across more than a billion products without credentials, carts, and Shop Pay checkout after the shopper signs in with Shop through a device flow, with `complete_checkout` called only after the shopper confirms. Instacart and Uber have official remote OAuth MCP servers. DoorDash, OpenTable, Expedia and Booking.com have no confirmed official public MCP servers, only scrapers and aggregators.

### Cited Findings
- Shop MCP (SHIPPED, flagged "New", Oct 13, 2026): one MCP connection to search Shopify Catalog (more than a billion products), build carts and complete Shop Pay checkout. Tools: `search_catalog`, `lookup_catalog`, `get_product`, `complete_checkout`, `get_checkout`, `search_orders`. Search needs no credentials. Shoppers can "sign in with Shop" for preferences, saved addresses and Shop Pay. MCP clients such as Claude and ChatGPT handle sign-in, and custom code can use the device flow. `complete_checkout` is called only after the shopper confirms the total and payment method. There are no webhooks at launch, so status is polled with `get_checkout`. An API key comes from the Shopify Dev Dashboard. — [Shopify changelog: Shop MCP](https://shopify.dev/changelog/add-shopping-and-shop-pay-checkout-to-any-agent-with-shop-mcp) (primary)
- Shopify's UCP agent stack: Global Catalog (cross-merchant search), Storefront Catalog (one merchant), Cart MCP, Checkout MCP ("completes purchases for trusted agents"), Order MCP (`get_order`) and order webhooks. Agents publish a profile at a well-known URL that is referenced on every UCP request. Trust tiers set rate limits and tool access, and higher tiers unlock direct checkout completion. Otherwise buyers are handed off through a checkout permalink or "continue link." Tooling: `@shopify/ucp-cli`. — [shopify.dev/docs/agents](https://shopify.dev/docs/agents) (primary)
- The Catalog MCP `get_global_product_details` returns a `checkoutUrl`. The Checkout MCP exposes `create_checkout`, `update_checkout` and `complete_checkout`, though one tutorial page labelled the Checkout MCP tools "coming soon." — [shopify.dev agents/checkout (search summary)](https://shopify.dev/docs/agents/checkout); [shopify.dev agents/checkout/mcp](https://shopify.dev/docs/agents/checkout/mcp)
- A secondary claim says Shopify's Spring '26 Edition opened the Catalog API and UCP to every developer without approval. — [Stellagent](https://stellagent.ai/insights/shopify-spring-26-agentic-commerce-developers). This is consistent with Shop MCP's credential-free search, but not verified against a primary source.
- Instacart: official Instacart Developer Platform MCP (Dec 2025) using OAuth. Instacart was the first grocery partner with an app inside ChatGPT. — [ChatForest food/restaurant MCP guide](https://chatforest.com/guides/mcp-food-restaurant/) (secondary)
- Uber: a hosted remote endpoint where the MCP client opens a browser to sign in and authorize on first connect. There is also an unofficial community server ([AriOliv/uber-mcp](https://github.com/AriOliv/uber-mcp)). — [search summary; mcp.so Uber](https://mcp.so/servers/uber) (secondary; I did not verify the official Uber endpoint on an uber.com page)
- DoorDash, Uber Eats and Grubhub: "no official MCP servers" per a 2026 guide. Only third-party scrapers exist (for example, @striderlabs/mcp-doordash). — [ChatForest](https://chatforest.com/guides/mcp-food-restaurant/); [Strider Labs](https://striderlabs.ai/)
- OpenTable: no official server found. There is an Apify scraper (data only) and community booking servers. — [Apify OpenTable MCP](https://apify.com/shahidirfan/opentable-scraper/api/mcp)
- Expedia and Booking.com: no official public remote MCP server found. Both were named as WebMCP origin-trial participants ([Spronta](https://www.spronta.com/blog/state-of-webmcp-july-2026/)).

### Inferences
- Remote MCP auth from a phone: these servers use OAuth 2.1 with authorization-server metadata (MCP auth spec). On Android, Hermit can run the standard PKCE flow through Custom Tabs plus an app-link redirect, or the device flow (which Shop explicitly supports). Tokens belong in the Android Keystore or vault. Network calls are needed anyway, so on-device inference is unaffected.
- Shop MCP is the best V1 target for "buy a physical product." It has a small, fixed tool menu (about six tools), credential-free search, and confirmation-gated checkout. That suits a 0.8B router plus Hermit's approval sheet. Payment goes through Shop Pay, which means cards, not USDT.

### Gaps
- Exact Shop MCP eligibility (all Shopify merchants or opted-in only), the role of the API key, and rate limits for unregistered agents.
- No primary pages confirmed official Uber, DoorDash, OpenTable, Expedia or Booking MCP status. Amazon has no public agent MCP or checkout path in my results (not searched in depth).

## 3. Agentic commerce and payment protocols: who a third-party client can use, requirements, self-custodial fit

### Takeaway
Card-network and platform protocols (ACP, UCP checkout completion, Visa TAP/VIC, Mastercard Agent Pay) all need agent registration or onboarding and are built around card tokens. A small third-party agent can join, but only through onboarding, and it pays with cards. x402 is the only open, permissionless rail where a self-custodial stablecoin wallet pays directly. Tether's WDK documents being a drop-in x402 signer with USD₮0. But x402 merchants are mostly APIs, content and MCP tools, not retail goods.

### Cited Findings
**OpenAI and Stripe ACP / Instant Checkout**
- ACP was released Sep 29, 2025 (Apache 2.0) by OpenAI and Stripe. Instant Checkout launched in ChatGPT. — [OpenAI: Buy it in ChatGPT](https://openai.com/index/buy-it-in-chatgpt/) (primary)
- March 2026: OpenAI scaled back in-chat Instant Checkout. Checkout moved to the retailer's site or app, or into ChatGPT apps. Spokesperson: "We're prioritizing making ChatGPT search and product discovery great, with ACP serving as the infrastructure that connects users to merchants across the full shopping journey." Forrester reportedly counted about 30 Shopify merchants in Instant Checkout as of Feb 2026. Another report says about 12 went live. — [Modern Retail, Mar 27 2026](https://www.modernretail.co/technology/what-went-wrong-with-chatgpts-instant-checkout/); [Retail Gazette](https://www.retailgazette.co.uk/blog/2026/03/openai-pulls-back-from-in-chat-shopping-as-ecommerce-reality-bites); [Spree Commerce](https://spreecommerce.org/openai-just-blinked-nobody-seems-to-want-to-shop-inside-chatgpt/)
- Non-Stripe processors can join through Stripe's Shared Payment Token API or the ACP Delegated Payments Spec. The Agentic Commerce Suite is offered through Wix, WooCommerce, BigCommerce, Squarespace and commercetools. — [search summary; agenticcommerceprotocol.info](https://agenticcommerceprotocol.info/standards/acp) (secondary)
- Third-party usability: ACP is an open spec, but the agent side assumes a payment-token provider (Stripe SPT) and merchant opt-in. I found no evidence of a public directory of ACP merchant endpoints that an arbitrary client could call.

**Google AP2 and UCP**
- AP2 was announced in Sep 2025 with more than 60 partners. It uses cryptographically signed "mandates" (intent and cart) and can run as an extension to A2A or MCP. Its x402 extension for stablecoins was built with Coinbase, the Ethereum Foundation and MetaMask. The Lowe's demo was a proof of concept. — [Coinbase: Google AP2 + x402](https://www.coinbase.com/developer-platform/discover/launches/google_x402) (primary); [Decrypt](https://decrypt.co/339752/google-reveals-ai-agent-payments-protocol-coinbase-ethereum-foundation). I found no 2026 primary status update for AP2.
- UCP was announced Jan 11, 2026 (NRF) by Google and Shopify. Named co-developers include Etsy, Wayfair, Target and Walmart. The March 19, 2026 update added Cart, Catalog and Identity Linking. Shopify merchants are UCP-enabled by default through Agentic Storefronts. Native checkout in Google AI Mode and Gemini is rolling out for select merchants only (US). — [Shopify Engineering: Building UCP](https://shopify.engineering/UCP) (primary); [Shopify news: AI commerce at scale](https://www.shopify.com/news/ai-commerce-at-scale) (primary); [search summary and secondary guides](https://www.hypotenuse.ai/blog/google-ucp-what-it-is-and-why-it-matters-for-ecommerce)
- A tracker reports more than 8,000 verified UCP stores by mid-June 2026, about 99% on Shopify. This is unverified and single-source ([eco.com UCP explainer](https://eco.com/support/en/articles/14839408-universal-commerce-protocol-ucp-explained)).

**Visa, Mastercard and Cloudflare (agent identity)**
- Web Bot Auth: proposed by Cloudflare in May 2025 as a profile of HTTP Message Signatures (RFC 9421). Agents sign requests with a key published in a directory. It is an IETF WG draft, not an RFC. — [Cloudflare: Securing agentic commerce](https://blog.cloudflare.com/secure-agentic-commerce) (primary); [PPC Land](https://ppc.land/agent-identity/)
- Visa Trusted Agent Protocol (Oct 2025) and Mastercard Agent Pay both use Web Bot Auth as the authentication layer for agents registered with the network. A tag in `Signature-Input` marks intent (for example, `agent-payer-auth`). — [Cloudflare blog](https://blog.cloudflare.com/secure-agentic-commerce) (primary); [Digital Transactions](https://www.digitaltransactions.net/visa-launches-trusted-agent-an-agentic-commerce-protocol/)
- Visa Intelligent Commerce: agents must be onboarded to the VIC platform and are provisioned agent-specific payment tokens. "Intelligent Commerce Connect" offers a single integration for agent builders, with broader rollout later in 2026. Visa reports "hundreds of controlled, agent-initiated transactions in live environments" and first live agentic payments on European merchant sites. — [Visa Developer: VIC overview](https://developer.visa.com/capabilities/visa-intelligent-commerce/overview) (primary); [TechInformed](https://techinformed.com/visa-opens-one-integration-for-ai-agent-payments/); [Payment Expert, Jul 2 2026](https://paymentexpert.com/2026/07/02/visa-agentic-payments-merchants-eu/)
- Mastercard Agent Pay (launched Apr 2025) has a "Know Your Agent" registration step before an agent may transact. Reported live authenticated agentic transactions in Hong Kong and Thailand used tokenized credentials and Payment Passkeys. — [eco.com comparison](https://eco.com/support/en/articles/15192003-mastercard-agent-pay-vs-visa-trusted-agent-2026-compared) (secondary; no Mastercard primary page found)
- Critique: small agent builders not registered with Cloudflare, Visa or Mastercard "will be treated as bots by default." Web Bot Auth has no revocation beyond key removal and cache expiry. — [PPC Land: Agent identity](https://ppc.land/agent-identity/); [anybiz](https://www.anybiz.io/blogs/ai-agent-identity-and-payments/)
- Shopify also requires Web Bot Auth with registered keys for its browser-side WebMCP checkout tools. — [shopify.dev agents/checkout](https://shopify.dev/docs/agents/checkout)

**x402 and stablecoins**
- x402 was introduced by Coinbase in May 2025. A vendor guide says it was donated to the Linux Foundation (x402 Foundation) in April 2026. — [Aurpay guide](https://aurpay.net/aurspace/x402-protocol-ai-agents-pay-apis-crypto-2026/) (secondary)
- Stripe machine payments: x402 preview in Feb 2026 (US businesses), USDC on Base, later also Solana and Tempo. Stripe and Tempo released the Machine Payments Protocol in March 2026. Stripe's purl CLI tests endpoints. — [The Block](https://www.theblock.co/post/389352/stripe-adds-x402-integration-usdc-agent-payments)
- Cloudflare: Pay Per Crawl entered private beta on Jul 1, 2025 and settles through traditional rails with Cloudflare as merchant of record. A Monetization Gateway waitlist (Jul 1, 2026) adds x402 per-request charging for pages, APIs, datasets and MCP tools. "Wallets for agents" was announced Aug 4, 2026, with funding and merchant support described as future plans. — [InfoQ, Jul 2026](https://infoq.com/news/2026/07/cloudflare-aws-x402-micropayment/); [Search Engine Journal](https://searchenginejournal.com/cloudflare-gives-ai-agents-wallets-that-pay-for-what-they-access/584959); [Stablecoin Insider](https://stablecoininsider.org/cloudflare-opens-waitlist-for-stablecoin-powered-monetization-gateway-built-on-the-x402-protocol/)
- x402 volume: a vendor reports about 69k active agents, 165M transactions and about $50M cumulative by late April 2026. Unverified. — [eco.com](https://eco.com/support/en/articles/14839404-stablecoin-payments-for-ai-agents)
- USDT on x402: Utexo announced USDT compatibility for x402 on Apr 16, 2026 (press release, ANNOUNCED). — [PR Newswire](http://www.prnewswire.com/news-releases/utexo-and-x402-enable-usdt-payments-for-the-agent-economy-with-near-instant-settlement-302745083.html). A TRON/B.AI x402 variant with USDT on TRON is described secondhand ([Stablecoin Insider](https://stablecoininsider.org/agentic-payments-and-stablecoins-how-ai-agents-are-revolutionizing-autonomous-machine-to-machine-transactions-in-2026/)).
- Tether WDK: the docs describe WDK wallets as drop-in x402 client signers on any EVM chain where USD₮0 is deployed, recommending Plasma and Stable. There are also WDK "agent skills" for wallets, transfers, swaps and bridges across more than 20 chains. WDK was open-sourced in Oct 2025, and keys are generated and stored locally. — [docs.wdk.tether.io/ai/x402](https://docs.wdk.tether.io/ai/x402) (primary); [WDK agent skills](https://docs.wdk.tether.io/ai/agent-skills) (primary); [The Block, Oct 2025](https://www.theblock.co/post/375125/tether-open-sources-wallet-kit-humans-ai-agents-bitcoin-ethereum-beyond)
- Spending-control concern with unlocked agent wallets. — [CryptoSlate](https://cryptoslate.com/paolo-ardoino-wants-ai-agents-to-hold-tether-but-developers-are-left-on-the-hook-for-overspending/)

**PayPal agent toolkit**: not researched separately. PayPal was an AP2 launch partner ([Decrypt](https://decrypt.co/339752/google-reveals-ai-agent-payments-protocol-coinbase-ethereum-foundation)), and a July 2026 trade piece groups PayPal with Visa and Mastercard AI-commerce moves ([Digital Transactions](https://www.digitaltransactions.net/ai-commerce-gets-a-boost-from-visa-paypal-and-mastercard/)).

### Inferences
- Usability matrix for a third-party, self-custodial client like Hermit:
  - x402 + WDK/USD₮0: usable now, with no onboarding. The fit is exact: 402 response, then sign an ERC-3009 authorization with the local key, then the approval sheet and fingerprint gate the signature. Merchants are limited to APIs, data and MCP tools (Cloudflare gateway, Stripe-billed endpoints), not retail goods. Watch the chain: Stripe settles USDC on Base, Solana and Tempo, while WDK x402 targets USD₮0 chains. A merchant must accept that asset and chain, and USDT acceptance is announced, not shown to be widespread.
  - Shop MCP: usable now with the shopper's Shop account. Payment is Shop Pay (card), not USDT.
  - UCP direct checkout, Visa VIC/TAP, Mastercard Agent Pay: these need agent registration, a trust tier or Know Your Agent, and Web Bot Auth keys. They are feasible for a registered company but are card-token rails. Hermit's USDT wallet does not plug in unless a card is issued against it (for example, a stablecoin-funded card); none was found in this research.
  - ACP: an open spec, but in practice tied to Stripe SPT and merchant enrolment, and its main consumer (ChatGPT checkout) retreated in March 2026.
- AP2's x402 extension is the conceptual bridge: the signed mandate maps onto Hermit's approval sheet, and x402 handles settlement. But I found no 2026 evidence of AP2 in production outside demos.

### Gaps
- No primary 2026 status for AP2, the PayPal agent toolkit, or Mastercard's developer onboarding.
- No count of x402 merchants accepting USDT specifically, and no data on retail (physical goods) merchants accepting x402.

## 4. NLWeb, llms.txt, schema.org and OpenAPI discovery: coverage numbers

### Takeaway
llms.txt is on roughly 6–9% of top sites, inflated by Shopify auto-generating it for every store since about May 2026. NLWeb's largest footprint is Wix shipping a `/_api/nlweb/mcp` endpoint by default (March 2026), but there is no verified site count. llms.txt helps reading, not acting. NLWeb gives a query and MCP endpoint but no transactions.

### Cited Findings
- llms.txt in the top 1,000: 8.7% (June 2026). A stricter September 2026 method found 93 of 1,000 (9.3%). — [Rankability](https://www.rankability.com/data/llms-txt-adoption/)
- Top 10,000: 5.61% to 7.4% depending on method (June 2026). A May 6, 2026 crawl of the Tranco top 10k found 586 valid files (5.86%). — [Chris Humphrey](https://chrishumphrey.ai/research/state-of-llms-txt-2026); [search summary](https://caseyrb.com/blog/state-of-llms-txt-adoption/)
- Top 100,000: 8,598 domains (8.6%) on Sep 13, 2026. Nearly a third were auto-generated by platforms. — [SEOmator](https://seomator.com/blog/llms-txt-adoption)
- Shopify pushed llms.txt to every store by default in late April or early May 2026. News, social, reference and government sites showed zero adopters in one 78-site sample. — [search summary; Rankability](https://www.rankability.com/blog/llms-txt-adoption/); [DEV 22 of 78](https://dev.to/_6614b04c8831704fcf9b2/llmstxt-adoption-22-of-78-big-sites-2gd2)
- Shopify publishes an agents.txt for its developer docs. — [shopify.dev/docs/agents.txt](https://shopify.dev/docs/agents.txt)
- NLWeb: announced by Microsoft at Build 2025. Every instance can act as an MCP server (`/ask`, `/mcp`). Launch collaborators included Chicago Public Media and Common Sense Media. — [Microsoft Source](https://news.microsoft.com/source/?p=20799) (primary)
- Wix shipped NLWeb by default in March 2026 at `/_api/nlweb/mcp`. One blog found premium sites returning HTTP 401. Yoast Premium has had an implementation since Nov 2025. There is no verified total of NLWeb sites. — [Presenc AI NLWeb adoption 2026](https://presenc.ai/research/nlweb-adoption-2026); [Wix NLWeb blog](https://hidden-layer-blogs.pages.dev/post/wix-nlweb-platform-shift)
- schema.org Product/Offer/Action and OpenAPI discovery: no 2026 coverage numbers were found in this research (searched, nothing returned).

### Inferences
- Read-only discovery (llms.txt, NLWeb, schema.org Product/Offer in JSON-LD) helps a small model extract price and availability without navigating. None of it gives a purchase action. Purchases still need checkout MCP/UCP, a merchant API or UI automation.
- Web Data Commons and HTTP Archive Almanac publish schema.org stats. They were not fetched for these notes, so check them before citing.

### Gaps
- Current schema.org Product/Offer prevalence (HTTP Archive Web Almanac 2025 or Web Data Commons). Not fetched.
- OpenAPI or `.well-known` API discovery prevalence. No data found.

## 5. Coverage reality by late 2026 and the long-tail fallback

### Takeaway
Structured agent-actionable coverage in Nov 2026 is concentrated in one platform, Shopify (UCP by default, Shop MCP, Catalog of more than a billion products), plus a few official MCP servers (Instacart, Uber) and Wix NLWeb (read-only). WebMCP is close to zero in production. Card-network agent rails are in early live pilots. For most top merchants (Amazon, food delivery, airlines, hotels), a third-party agent still has no open structured purchase path. The long tail needs UI automation or a handoff to the user.

### Cited Findings
- WebMCP adoption "approximately zero" (July 2026). Checker tools outnumber implementations. — [Spronta](https://www.spronta.com/blog/state-of-webmcp-july-2026/)
- Shopify merchants are UCP-enabled by default. Shop MCP searches more than a billion products across Shopify merchants. — [Shopify news](https://www.shopify.com/news/ai-commerce-at-scale); [Shop MCP changelog](https://shopify.dev/changelog/add-shopping-and-shop-pay-checkout-to-any-agent-with-shop-mcp)
- In-chat checkout demand was weak: about 12–30 Shopify merchants used ChatGPT Instant Checkout before the March 2026 pullback. — [Modern Retail](https://www.modernretail.co/technology/what-went-wrong-with-chatgpts-instant-checkout/)
- Food delivery: no official MCP from DoorDash, Uber Eats or Grubhub (about 96% of the US market combined, per the same guide). — [ChatForest](https://chatforest.com/guides/mcp-food-restaurant/)
- Visa reports "hundreds" of live agent-initiated transactions, which is pilot scale. — [search summary; Visa/Crowdfund Insider](https://www.crowdfundinsider.com/?p=256706)
- Unregistered agents are treated as bots by default on Cloudflare-protected sites. — [PPC Land](https://ppc.land/agent-identity/)

### Inferences
- A tiered strategy for Hermit (inference):
  1. A typed connector menu (Shop MCP, Instacart, Uber, x402 endpoints), with a handful of fixed tools each. This is the sweet spot for BotPsy-0.8B.
  2. Read-only structured extraction (JSON-LD Product/Offer, llms.txt, NLWeb `/mcp`) for comparing and answering.
  3. A WebMCP hook in Hermit's WebView (wrap `registerTool` before page load), opportunistic and future-proof.
  4. Fallback: open the merchant page or `checkoutUrl` and continue link in a Custom Tab for the human to finish. Do not attempt long-horizon UI automation with a sub-1B model.
- Hermit as an unregistered client will hit bot defenses on Cloudflare-protected merchant sites when it fetches pages directly. Registering a Web Bot Auth key directory is cheap and probably worth doing. Visa and Mastercard registration is a business-development track.
- The USDT wallet fits x402 (APIs, data, pay-per-use tools) today. Retail purchases in 2026 run on card and Shop Pay rails, so "Hermit buys with USDT at a normal store" is not supported by any shipped protocol found here.

### Gaps
- No systematic measurement of what share of the top 100 or 1,000 merchants expose any agent-actionable interface (MCP, UCP, ACP, WebMCP). The figures here are platform-level, not merchant-share.
- Amazon's stance and status (blocking agents, its own Buy for Me / Rufus) was not researched.
