# Hermit: connector framework research (Composio, AIsa, Instinct, alternatives)

Research date: 2026-11-11. Web sources only, nothing installed. Each claim is marked **V** (Verified, with URL) or **U** (Unverified: secondary source or inference).

## 1. Composio

- **How it works.** Composio holds each user's credentials and runs the tool call on its own servers. Quote: "Composio stores each connected account's credentials encrypted at rest", and it "adds the credential to the provider request server-side". Tokens cannot be read back. **V** https://docs.composio.dev/docs/authentication
- **Auth configs.** An auth config is a per-toolkit template (auth method, scopes, which OAuth app). It can use Composio's managed OAuth app or your own client ID and secret. Even with your own app, Composio still holds the tokens. **V** https://docs.composio.dev/docs/auth-configuration/custom-auth-configs
- **Self-hosting.** Composio's docs mention self-hosted, private VPC and customer-managed-key deployments (V, same authentication page). Third-party sources say these are Enterprise-only. A public GitHub request to self-host has had no maintainer answer since 2024 (V, https://github.com/ComposioHQ/composio/discussions/1037). That self-hosting is Enterprise-only and paid is **U**.
- **License.** The SDK monorepo is MIT. It holds the SDKs, a CLI and provider adapters; I found no tool schemas in it. **V** https://github.com/ComposioHQ/composio. The SDK fetches schemas at runtime with an API key. **U** (inferred from the README).
- **Reusing the catalog offline.** The Terms of Service exclude "any derivative use of the platform or its contents" and "data mining, robots, or similar data gathering and extraction tools". **V** https://composio.dev/terms. Scraping Composio's schemas to ship in Hermit is therefore a legal risk. Shipping them without Composio's runtime would also be useless.
- **Privacy fit: does not fit.** Every token and every response passes through Composio's cloud, which breaks "no backend, tokens on the phone". Use it only as design inspiration (its auth config model).

## 2. AIsa (aisa.one)

- **What it is.** A hosted data layer for agents: company, person, SEO, "GEO" (AI answer mentions), commerce and social data under one schema. Access is through an MCP server (OAuth), a REST API (bearer key) or installable skills. Pricing is pay-as-you-go from $0.001 per result, with $1 of free credit each month. **V** https://aisa.one/
- **Self-hosting or on-device.** None mentioned, and the page says nothing about data retention. **V** (absence), same URL.
- **Privacy fit: fits with caveats, as an optional, off-by-default skill only.** It is a data vendor, not a connector framework. Every query goes to AIsa, so in Hermit it would be a "network, external" skill holding the user's own API key, with the query shown before it is sent. It does not help with connecting the user's own accounts.

## 3. Instinct (Spear Street Technology)

- **Product.** You text or call it, and it "can use a phone and computer in the same way that you do". **V** https://instinct.com/
- **Credentials.** Its privacy policy says users may provide "your username and password for third-party accounts so that the personal assistant can sign into these accounts". Disconnecting an integration "does not automatically delete data collected". **V** https://instinct.com/privacy
- **Mechanism (best evidence).** Instinct does not publish how it works. Secondary sources describe a persistent cloud computer with browser access and cached credentials. In one reported case it reset a user's password on a shopping site to finish a purchase. Browser work is reportedly limited by CAPTCHAs and 2FA. **U** https://www.usecarly.com/blog/what-is-instinct-ai/ , https://www.eesel.ai/blog/instinct-ai
  - Other reported features: a Vault for credentials and TOTP secrets, and a 1Password partnership (announced 2026-09). **U**, the sources conflict: https://explainx.ai/blog/instinct-1password-ai-agent-account-vaults-2026
  - A developer guide for building an Instinct-like agent says the agent "start[s] a connection itself over its built-in Composio tools and text[s] the user the link, which is how Instinct connects apps". **U**, third-party: https://www.agent37.com/docs/agents-api/instinct
- **Conclusion.** "Connectors on the fly" most likely means three paths, not code generation:
  - Composio (or a similar service) for apps it supports.
  - Browser automation with the user's stored password for everything else.
  - Long-term memory of how it did it.

  No source describes runtime code generation. **U**
- **Privacy fit: does not fit as built** (cloud computer, server-held passwords). The user experience is worth copying.

## 4. Other approaches

| Approach | Tokens held by | Fit for Hermit |
|---|---|---|
| Pipedream Connect | Pipedream; it recommends server-side calls. **V** https://pipedream.com/docs/connect | Does not fit |
| Arcade.dev | Arcade manages tokens; self-host with Helm. **V** https://docs.arcade.dev/en/home | Does not fit (needs a server) |
| Nango | Free self-hosted tier covers API authorization only; license reported as Elastic 2.0. **V** https://nango.dev/docs/guides/platform/free-self-hosting, license **U** | Does not fit (needs a server) |
| Official MCP Registry | Metadata only, open API. **V** https://registry.modelcontextprotocol.io/ | Fits as a discovery source. Remote MCP servers are third parties, so their output is untrusted |
| OpenAPI-to-tool generation | Generated tools call APIs directly from the device | **Fits.** This is the core of the recommendation below |
| Browser login (WebView with the user's own session) | Cookies stay on the device | Fits with caveats: fragile, CAPTCHAs, may break site terms |

**OAuth from a phone with no backend.**
- **Google.** The client secret "is not applicable" to Android and iOS clients, and PKCE is required. Custom URI schemes "are no longer supported on Android", so redirects go through Google's Android client type. **V** https://developers.google.com/identity/protocols/oauth2/native-app
- **Google verification.** An unverified app using sensitive scopes is capped at 100 users for its whole lifetime. **V** https://support.google.com/cloud/answer/7454865
- **Gmail read access** is a restricted scope and needs an annual security assessment. **V** https://support.google.com/cloud/answer/13465431. Third parties say the CASA assessment applies only when data reaches a server, which would exempt on-device Hermit. **U**, ask Google before relying on it.
- **Other providers.** Many (Microsoft, GitHub device flow, Spotify, Dropbox) support PKCE public clients. Some (Slack, Notion, LinkedIn) require a client secret, so they need a token-exchange server or personal tokens. **U**, check each provider.

## 5. Recommended Hermit connector framework

1. **The connector is a declarative spec, not code.** It is a signed JSON document with:
   - `origin` (an exact host allowlist)
   - `auth` (`oauth_pkce` | `api_key` | `basic` | `cookie_session` | `none`)
   - `operations[]`, each with: method, path template, JSON Schema for inputs, response projection (JSONPath), `risk` (`read` | `write` | `send` | `spend` | `credential`), and rate limit.

   A fixed, audited runtime in Hermit runs specs. The model never runs code.
2. **Three tiers of trust.**
   - (a) **Bundled specs**, written and reviewed by the project.
   - (b) **Imported specs**, generated on the device from a provider's published OpenAPI document, or listed in the MCP Registry and converted to a spec.
   - (c) **"Make one" specs**, drafted by the on-device model from the API docs the user points to.

   Tiers (b) and (c) start with every operation that is not a GET set to `risk >= write`. The model may never lower a risk level.
3. **Approval of the spec.** Before a connector is installed, the cage shows a plain-language card: the hosts, every operation and its risk level, and the scopes. The user approves each operation or the whole spec. The spec is hashed (that hash is the fingerprint), so any change means a new approval.
4. **Credentials.** OAuth uses PKCE with the system browser and tokens in the vault, tied to `origin`. For API keys and passwords, the user types them into a vault screen, never into the chat. The runtime adds the credential at send time, so the model never sees it.
5. **Fallback for services with no API.** Use a cookie-session WebView flow: the user logs in by hand, and Hermit keeps the session in the vault. Its actions run as an "assisted browse" with step-by-step approval. Do not store passwords to replay automatically in V1.
6. **Every response is untrusted text**, wrapped as such before it reaches the model.
7. **Per-user memory** stores only which spec and which account were used, never generated code.
8. **Providers that need a client secret** are out of scope for V1 (use personal access tokens instead), or need an opt-in relay the user hosts.

## Open questions

- Does Hermit ship its own Google OAuth client (verification work and a possible assessment) or rely on user-supplied clients?
- Is a user-hosted token relay acceptable for secret-only providers?
- Does the model-drafted spec tier ("make one") ship in V1?
