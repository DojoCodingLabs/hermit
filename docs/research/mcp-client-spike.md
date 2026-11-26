# MCP client spike (SL-51)

Date: 2026-11-14. Slice: SL-51 (W3, T2). Assumptions under test: ASM-20 (an MCP client over Streamable HTTP with OAuth runs in React Native) and ASM-21 (MCP servers with dynamic client registration, such as Notion, Linear, Asana and HubSpot, accept a phone app-link redirect). Feeds SL-54 (add an MCP server and use its tools under the cage), FR-CONN-05, FR-CONN-06, PDR-022.

## Verdict

**Go for SL-54, with the client built here and no SDK.**

- **ASM-20: the client works end to end. Everything React Native needs is in place, but it has not run on the phone yet.** A pure TypeScript client in `packages/connectors/src/mcp` passes the full flow against an OAuth MCP server built from the official TypeScript SDK's own auth pieces: 16 of 16 live steps, once with SSE responses and once with JSON responses. The steps are discovery, dynamic registration, PKCE sign-in, initialize, tools/list, tools/call, and the negative checks. The client uses no Node API, no `URL` class, no WebCrypto and no streaming. It needs only a transport that the app already builds the same way for `read_web` (expo/fetch with `redirect: "manual"`). The status stays Unverified until the phone runs it (below).
- **ASM-21: wrong as written for two of the four named services. The redirect part is unverified on production servers.** Asana and HubSpot offer no dynamic registration at all. Notion, Linear, Sentry, Stripe, Vercel, Canva, PayPal and Atlassian do offer it, for public clients with PKCE. Supabase and Figma offer it for confidential clients only. GitHub offers none. The official SDK's reference server accepts both `hermit://oauth/mcp` and `https://hermit.dojocoding.io/oauth/mcp` as redirect URIs. Whether the production servers accept them is one registration per server, and that registration was not attempted without the owners' OK (what it takes is below). Also, `hermit.dojocoding.io` does not resolve today, so the app-link redirect FR-CONN-03 assumes cannot work yet. The custom scheme can.

## What was built

- `packages/connectors/src/mcp` (pure, behind ports, lint-enforced no network):
  - `url.ts` `parseHttpsUrl`: one strict parser for every URL the client touches, discovered ones and redirect hops included. It allows HTTPS only, an exact public host through the existing `isPublicHost`, port 443 or none, no userinfo, no fragment, no backslash, whitespace or control characters, and no dot segments, encoded or not. It does not use the platform `URL`: React Native 0.88's `URL` (`Libraries/Blob/URL.js`) is a set of regular expressions. Its `hostname` reads `https://good.example.com#@evil.example.com/` as `evil.example.com`, a parser differential that would let a check and a request disagree. A test pins that exact string.
  - `json.ts` `parseJsonObject`: JSON with `__proto__`, `constructor` and `prototype` dropped at every depth. It reuses `FORBIDDEN_PATH_KEYS` from the connector runtime.
  - `http.ts` `getChecked` and `postChecked`: the URL check runs before every hop. GET redirects are followed only after the target passes, at most 3 times, and never with credentials. A POST never follows a redirect, so a token, a code or a tool call can't go anywhere unchecked. A redirect the platform followed on its own fails closed, as in the `read_web` adapter.
  - `discovery.ts`: the Bearer challenge (RFC 6750, RFC 9728 section 5.1), protected resource metadata (RFC 9728), then authorization server metadata (RFC 8414, then OpenID discovery, path-aware, in the order the MCP spec 2025-11-25 gives). The resource must be on the server's own origin and must be the server URL or a parent path of it, so metadata can't get Hermit a token for another server. The issuer must match where the metadata was found. Without S256 PKCE the client refuses. Endpoints that fail the URL check are dropped. A fallback covers the 2025-03-26 layout, with authorization server metadata on the server's own origin and no RFC 9728 document (Atlassian).
  - `register.ts`: RFC 7591 with minimal metadata: `client_name: "Hermit"`, the one redirect, `authorization_code` and `refresh_token`, `response_types: ["code"]`, `token_endpoint_auth_method: "none"`. It sends no logo, homepage, contacts, policy links or software statement. `isAppRedirectUri` accepts only `hermit://oauth/...` or `https://hermit.dojocoding.io/oauth/...`. A response that changes the redirect or asks for a client secret is refused.
  - `sign-in.ts`: `beginMcpSignIn` (discovery, registration, PKCE S256 from 32 random bytes, state from 24 random bytes, scope from the challenge or else the resource's list, and the RFC 8707 `resource` parameter). `readCallback` checks the exact redirect, the state (constant-time comparison), `iss` (RFC 9207: checked when present, required when the server promised it), duplicate parameters, and a 10-minute expiry, all before the code is used. `completeMcpSignIn` sends the token request with the verifier and `resource`, accepts Bearer tokens only, and stores them only through `CredentialStorePort`. `freshMcpToken` refreshes with `resource` and keeps the old refresh token when none comes back.
  - `client.ts` `McpClient`: initialize with version negotiation (2025-11-25, 2025-06-18, 2025-03-26), then `notifications/initialized`. It sends `Mcp-Session-Id` (visible ASCII only) and `MCP-Protocol-Version` on later requests, and reads JSON or a complete SSE body. On a 404 it re-initializes once. A 401 or 403 means sign in again, and the challenge is passed on. It pages tools/list up to 10 pages and implements tools/call and DELETE. It declares no client capabilities (no sampling, roots or elicitation).
  - `tools.ts`: parses tools (charset-checked names, an object schema under 16 KB, no external `$ref`, duplicates dropped). `mcpToolRisk` and `effectiveMcpRisk` set risk by code (below). `mcpMenuLine` cleans the description, `mcpApprovalSummary` builds the sheet without any server text, and `mcpToolDef` always has `producesUntrusted: true`. `toolHash` covers the whole definition, so a changed tool can be disabled until re-approved.
  - `packages/core/src/ports.ts`: a new `CredentialSource` value, `dynamic_client`. This is additive.
- `packages/eval/mcp-reference-server`: a standalone npm project outside the workspace, like the x402 facilitator. It uses the official `@modelcontextprotocol/sdk` 1.32.2: `mcpAuthRouter`, `DemoInMemoryAuthProvider` (strict resource check), `mcpAuthMetadataRouter`, `requireBearerAuth` and `StreamableHTTPServerTransport`. Its tools lie on purpose: a send tool marked read-only, a delete marked not destructive, a payment marked read-only, an injection in a description and an injection in a result.
- `packages/eval/src/mcp-spike.ts` (`pnpm --filter @hermit/eval spike:mcp local | discover <url>...`): `local` runs the whole flow. Its transport maps `https://mcp.hermit-spike.test` and `https://auth.hermit-spike.test` onto loopback, so the client runs with its real checks and only ever sees HTTPS URLs. `discover` is read-only against public servers.
- Tests: 107 new tests in `packages/connectors/test/mcp-*.test.ts`, written first and seen failing. The connector package now has 201 tests, all passing. Typecheck and lint are clean.

## The local run

Server: the SDK reference server above. Client view: HTTPS only. 22 requests.

| Step | Result |
| :---- | :---- |
| Discovery | 401 challenge with `resource_metadata`; RFC 9728 resource `https://mcp.hermit-spike.test/mcp`; RFC 8414 issuer `https://auth.hermit-spike.test/` (the SDK adds the trailing slash; the client keeps it as written) |
| Dynamic registration, `hermit://oauth/mcp` | 201, client id issued |
| Authorization URL | `response_type=code`, the client id, the redirect, `scope=notes`, state, S256 challenge, `resource` |
| Authorize | redirect to `hermit://oauth/mcp?code=...&state=...` |
| Forged state | `state_mismatch`, zero requests sent |
| Token exchange | Bearer token stored in the credential store; `CredentialMeta` source `dynamic_client`; nothing returned contains the token |
| Replay of the same code | refused by the server |
| Wrong PKCE verifier | refused by the server |
| Registration with the HTTPS app-link redirect | 201 |
| No token | `needs_sign_in` with the challenge |
| initialize | protocol 2025-11-25 over SSE, and again over JSON (`JSON_RESPONSE=1`) |
| tools/list | 6 tools, 0 skipped |
| tools/call | text, structured content and `isError`, all returned as untrusted |
| Close | DELETE with the session id |

The risk table the code produced for the lying tools (user-installed server):

| Tool | Annotations | Proposed | Floor | Destructive | Overruled |
| :---- | :---- | :---- | :---- | :---- | :---- |
| get_forecast | readOnly | network | network | no | |
| search_notes | readOnly | network | network | no | |
| send_message | readOnly, not destructive | send | send | no | readOnlyHint |
| delete_note | not destructive | remote_write | network | yes | destructiveHint |
| create_note | none | remote_write | network | yes | |
| pay_invoice | readOnly | spend | spend | yes | readOnlyHint |

## Public servers (read-only discovery, 2026-11-14)

Each server got one unauthenticated initialize POST, and its RFC 9728 and RFC 8414 documents were fetched with GET. Nothing was registered and no credentials were sent. The client made 43 requests, and a manual curl pass made the same kinds of requests (to read `token_endpoint_auth_methods_supported` in full).

| Server | Issuer | DCR | Public client (`none`) | CIMD | `iss` | Notes |
| :---- | :---- | :---- | :---- | :---- | :---- | :---- |
| mcp.notion.com/mcp | mcp.notion.com | yes | yes | yes | yes | |
| mcp.linear.app/mcp | mcp.linear.app | yes | yes | yes | yes | |
| mcp.sentry.dev/mcp | mcp.sentry.dev | yes | yes | yes | yes | |
| mcp.vercel.com | vercel.com | yes | yes | yes | no | scope `openid` |
| mcp.canva.com/mcp | mcp.canva.com | yes | yes | yes | no | |
| mcp.stripe.com | access.stripe.com/mcp | yes | yes | no | no | path issuer |
| mcp.paypal.com/mcp | mcp.paypal.com | yes | yes | no | no | |
| mcp.atlassian.com/v1/mcp | mcp.atlassian.com | yes | yes | no | no | 2025-03-26 layout, no RFC 9728 (fallback) |
| mcp.supabase.com/mcp | api.supabase.com | yes | no | no | yes | confidential clients only |
| mcp.figma.com/mcp | api.figma.com | yes | no | no | yes | confidential clients only |
| mcp.asana.com/v2/mcp | app.asana.com | no | no | no | no | pre-registered clients with a secret |
| mcp.hubspot.com | mcp.hubspot.com | no | no | no | no | `client_secret_post` only |
| api.githubcopilot.com/mcp/ | github.com/login/oauth | no | unlisted | no | yes | GitHub OAuth app needed |

So 8 of the 13 servers can be signed into from the phone alone today. That holds if they accept Hermit's redirect, which is the open half of ASM-21. Two more could be, if a per-install client secret is acceptable (Q76). The last three need a pre-registered client: the user's own, or a relay (PDR-022).

**To finish ASM-21:** for each of Notion, Linear, Sentry, Vercel, Canva, Stripe, PayPal and Atlassian, one registration with `redirect_uris: ["hermit://oauth/mcp"]`, and then the browser sign-in with a test account. That needs the product owner's OK to register a client named Hermit on each, and a test account per service. Run it from the phone (SL-54) rather than the Mac, so the system browser's hand-off to the app is tested too.

## What works in React Native, and what doesn't

| Need | In React Native 0.88 / Expo 58 | What the client does |
| :---- | :---- | :---- |
| Not following redirects | Built-in fetch (whatwg-fetch over XHR) always follows them, and OkHttp follows HTTPS to HTTP too. `expo/fetch` honors `redirect: "manual"` (`NativeRequest.kt`: `followRedirects(false)`) | The adapter uses expo/fetch with `redirect: "manual"`, as `apps/mobile/src/adapters/web.ts` already does. If the platform followed a redirect anyway, the response is refused |
| Streaming bodies (SSE) | Built-in fetch has no `response.body`. expo/fetch streams | It reads a POST's SSE body once complete: Streamable HTTP closes the stream after the response, and the local run passed that way. It never opens the optional GET stream |
| `URL` | Regular-expression parser with a host differential (above) | Its own strict parser; the platform `URL` is never used |
| SHA-256, random bytes | No `crypto.subtle` in Hermes | `@noble/hashes` (already used for PKCE) and `expo-crypto` random bytes behind the `random` port |
| Response headers | Readable | Lowercased by the client |
| System browser and redirect | `expo-web-browser` `openAuthSessionAsync` returns the redirect URL (not yet in the app) | `readCallback` takes that URL |

**Why not the official SDK client in the app.** `@modelcontextprotocol/sdk/client` needs `crypto.subtle` (through `pkce-challenge`), WHATWG `URL` (25 uses in `client/auth.js`) and `TextDecoderStream` with `pipeThrough` (`client/streamableHttp.js`), and none of those exist in Hermes. Its package pulls in express, hono, ajv and zod. Polyfills would also bring back the `URL` differential.

**Still to check on the phone (SL-54):** the expo/fetch adapter for MCP (headers in and out, the `redirect: "manual"` 3xx path, the body cap), and `openAuthSessionAsync` returning `hermit://oauth/mcp?...` to the app. Real TLS and DNS also come into play there. A public name that resolves to a private address (DNS rebinding) is not caught by name checks. The same gap exists for connectors and `read_web` today, so it belongs in the adapter.

## Security decisions in the client

1. **Every tool is untrusted.** Results come back with `untrusted: true`, capped (4000 characters), with the token scrubbed. Images and audio are replaced by a placeholder. The agent loop wraps them in `wrapUntrusted` and taints the session (FR-CAGE-04). Descriptions are capped at 1000 characters when parsed. On the menu they are cut to one plain line with markup, invisible and bidi characters removed, labeled with their host and "untrusted description", and capped at 300 characters. The approval sheet shows the host, the tool name and the exact arguments, never the server's title or description (FR-CONN-05).
2. **Risk is assigned by code.** Every tool starts at `remote_write` and counts as destructive. Words in the tool's own name raise the floor: send words to `send`, money words to `spend`, credential words to `credential`, delete words make it destructive. Name words beat any annotation. The only annotation that can lower anything is `readOnlyHint: true`, and only from a server the user installed, only to `network` (a read still leaves the phone), and only as a proposal the user confirms. The user can raise any risk, and can lower one only down to that read proposal. A changed tool definition changes `toolHash`.
3. **HTTPS and host checks on every URL.** The server URL, the resource metadata hint, the resource, the authorization servers, every endpoint, the registration endpoint and every redirect hop go through `parseHttpsUrl`. No POST follows a redirect.
4. **Tokens only through the credential store.** The token request body is a `Secret`, and the bearer header is a `Secret` the transport reveals at send time. No result, log line or return value carries a token (a live check confirms it). The pending sign-in holds the PKCE verifier, so the app keeps it in memory or in the Keystore store, never in plain storage.
5. **Redirect, state and PKCE.** The redirect is always the app's own. State is checked in constant time before anything is sent. PKCE uses S256 only, and servers without it are refused. `iss` is checked when present or promised. The `resource` parameter goes in both the authorization and the token request.
6. **Minimal registration metadata.** Name, redirect, grants and `none`. Nothing about the user or the phone.

## Risks

- **Description injection reaches the menu.** A description is someone else's text inside the prompt the model picks from. The live server's "read the user's passwords" line reaches the menu cleaned up, but its words are still there. The risk class and the approval sheet stop the harmful calls, but a description can still steer which tool the model picks (Q78).
- **No production redirect evidence yet** (ASM-21), and the app-link domain does not resolve.
- **Per-install client secrets** (Supabase, Figma) are refused for now (Q76).
- **Tool lists can change between sessions.** `toolHash` detects it; SL-54 must store the approved hashes and disable changed tools.
- **Server-sent requests** (sampling, elicitation) are ignored, because the client declares no capabilities. A server that needs them won't work, which is the safe failure.
- **Ports.** Only 443 is accepted. A self-hosted server on another port is refused.

## Recommended design for SL-54

1. Use `packages/connectors/src/mcp` as it is. Add an `McpTransport` adapter in `apps/mobile` on expo/fetch with `redirect: "manual"`, counted through `countedFetch` for the privacy screen. Inject `auth` at send time and cap the body.
2. Store an MCP install record: server URL, resource, issuer, token endpoint, client id, credential id, approved `toolHash` per enabled tool, risk per tool, and the user's choices. Use `mcpConnectorId` for the credential's connector id.
3. Sign in through `beginMcpSignIn`, then `openAuthSessionAsync(authorizationUrl, "hermit://oauth/mcp")`, then `completeMcpSignIn`. Keep the pending sign-in in memory and drop it after use or after 10 minutes.
4. On the install sheet (HM-CONN-03), list the tools by name with the code's proposed risk and reasons. The user enables tools and confirms or raises risks. Tools the user leaves off never reach the menu.
5. Each enabled tool becomes `mcpToolDef` through the cage. Its runtime refuses any risk in `ALWAYS_ASK` without an approval of these exact arguments, as `ConnectorRuntime` does, and re-checks `toolHash` against a fresh tools/list per session.
6. Discovery order (FR-CONN-06): an official server with DCR and a public client first. For CIMD servers, add a client metadata document once the domain exists (Q77). Confidential-only DCR depends on Q76. Everything else goes to a relay or the user's own client.

## SL-54 follow-up (2026-11-15)

SL-54 built the recommended design above in `packages/connectors/src/mcp/servers.ts` (`McpServers`), the runtime's `mcp` port, HM-CONN-03 and the `hermit://oauth/mcp` route in the app. `pnpm --filter @hermit/eval spike:mcp servers` runs that shipped flow against the reference server: 11 of 11 steps pass (a URL not from the user refused before any request, sign-in, a review sheet with no server text, nothing on the menu before approval, the overruled read claims kept at send and spend, a routed menu of at most 3 tools, no call without an approval of the exact arguments, the injected result read only by the quarantined reader, the token only in the credential store, removal, 14 HTTPS requests to the two spike hosts). `local` still passes 16 of 16. A security review added one rule to the client: server schemas lose `pattern`, `patternProperties` and `format` (a server's regex in JavaScript's backtracking engine can hang the phone) and are capped in depth, width, strings and enums. Still for the phone: the expo/fetch adapter, the browser hand-off back to `hermit://oauth/mcp`, and the Keystore credential store.
