// MCP client spike (SL-51, desktop dev tool, never bundled into the app). Findings in
// docs/research/mcp-client-spike.md. Two modes:
//
//   local     the full OAuth and tools flow against the reference server in packages/eval/mcp-reference-server
//             (official TypeScript SDK auth router and demo provider):
//               (cd packages/eval/mcp-reference-server && npm ci --ignore-scripts && node server.mjs) &
//               pnpm --filter @hermit/eval spike:mcp local
//   servers   SL-54: the shipped add-a-server flow (McpServers) against the same reference server
//               pnpm --filter @hermit/eval spike:mcp servers
//   discover  read-only discovery against public servers: one unauthenticated initialize POST (the 401 is the
//             point), then the GETs for RFC 9728 and RFC 8414 metadata. It never registers a client.
//               pnpm --filter @hermit/eval spike:mcp discover https://mcp.notion.com/mcp ...
//
// The client under test is @hermit/connectors' MCP module with its real checks. In local mode the transport
// plays DNS and TLS termination: https://mcp.hermit-spike.test and https://auth.hermit-spike.test go to the
// loopback ports; everything else is refused, so nothing in local mode reaches the internet.
import { randomBytes } from "node:crypto";
import { argsHash } from "../../core/src/index.ts";
import {
  beginMcpSignIn,
  completeMcpSignIn,
  discoverMcpAuth,
  effectiveMcpRisk,
  freshMcpToken,
  McpClient,
  McpServers,
  MemoryMcpServerStore,
  mcpMenuLine,
  mcpToolRisk,
  MemoryCredentialStore,
  postChecked,
  registrationRequest,
  type ConnectorRequest,
  type McpResponse,
  type McpTransport,
} from "../../connectors/src/index.ts";

const LOCAL: Record<string, string> = {
  "mcp.hermit-spike.test": `http://127.0.0.1:${process.env.MCP_PORT ?? 3100}`,
  "auth.hermit-spike.test": `http://127.0.0.1:${process.env.AUTH_PORT ?? 3101}`,
};

/** What the app's expo/fetch adapter does: redirect "manual", auth injected at send time, body capped. */
function nodeTransport(mode: "local" | "public", log: string[]): McpTransport {
  return {
    async send(req: ConnectorRequest): Promise<McpResponse> {
      const m = /^https:\/\/([^/?#]+)(.*)$/.exec(req.url);
      if (!m) throw new Error("not https");
      const [, host, rest] = m as unknown as [string, string, string];
      const target = mode === "local" ? (LOCAL[host] ? `${LOCAL[host]}${rest}` : undefined) : req.url;
      if (!target) throw new Error(`local mode refuses ${host}`);
      log.push(`${req.method} ${req.url}`);
      const headers: Record<string, string> = { ...req.headers };
      if (req.auth?.in === "header") headers[req.auth.name] = req.auth.value.reveal();
      const body = req.body === undefined ? undefined : typeof req.body === "string" ? req.body : req.body.reveal();
      const res = await fetch(target, { method: req.method, headers, body, redirect: "manual", signal: AbortSignal.timeout(15_000) });
      const text = (await res.text()).slice(0, req.maxResponseBytes);
      return { status: res.status, headers: Object.fromEntries(res.headers.entries()), body: text, redirected: res.redirected };
    },
  };
}

/** The system browser, for the demo provider that approves at once: follow the authorize URL to the app redirect. */
async function browser(authorizationUrl: string): Promise<string> {
  const m = /^https:\/\/([^/?#]+)(.*)$/.exec(authorizationUrl)!;
  const res = await fetch(`${LOCAL[m[1]!]}${m[2]}`, { redirect: "manual" });
  const location = res.headers.get("location");
  if (!location) throw new Error(`authorize answered ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return location;
}

const random = (n: number) => new Uint8Array(randomBytes(n));
const step = (name: string, pass: boolean, detail: unknown) => {
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${detail === undefined ? "" : `  ${typeof detail === "string" ? detail : JSON.stringify(detail)}`}`);
  if (!pass) process.exitCode = 1;
};

async function local(): Promise<void> {
  const log: string[] = [];
  const transport = nodeTransport("local", log);
  const credentials = new MemoryCredentialStore();
  const now = () => Date.now();
  const server = "https://mcp.hermit-spike.test/mcp";
  const redirectUri = "hermit://oauth/mcp";

  const d = await discoverMcpAuth(transport, server);
  step("discovery: 401 challenge, RFC 9728, RFC 8414", d.ok && d.auth === "oauth", d.ok && d.auth === "oauth" ? { resource: d.resource, issuer: d.as.issuer, registration: d.as.registrationEndpoint, scopes: d.scopesSupported } : d);

  const begin = await beginMcpSignIn({ transport, now, random }, { serverUrl: server, redirectUri });
  if (!begin.ok) return step("begin sign-in", false, begin);
  step("dynamic registration with the app's own scheme, then PKCE S256 authorization URL", true, { clientId: begin.pending.clientId, url: begin.authorizationUrl.replace(/code_challenge=[^&]+/, "code_challenge=...").replace(/state=[^&]+/, "state=...") });

  const callback = await browser(begin.authorizationUrl);
  step("authorize redirects to hermit://oauth/mcp with code and state", callback.startsWith(`${redirectUri}?`), callback.replace(/code=[^&]+/, "code=...").replace(/state=[^&]+/, "state=..."));

  const before = log.length;
  const forged = await completeMcpSignIn({ transport, credentials, now }, begin.pending, callback.replace(/state=[^&]+/, "state=forged"), "ref");
  step("a forged state is refused before any request", !forged.ok && forged.problem === "state_mismatch" && log.length === before, forged);

  const done = await completeMcpSignIn({ transport, credentials, now }, begin.pending, callback, "ref");
  step("token exchange with verifier and resource; tokens only in the credential store", done.ok, done.ok ? { meta: done.meta } : done);

  const replay = await completeMcpSignIn({ transport, credentials: new MemoryCredentialStore(), now }, begin.pending, callback, "replay");
  step("replaying the same code is refused by the server", !replay.ok && replay.problem === "token_failed", replay);

  const second = await beginMcpSignIn({ transport, now, random }, { serverUrl: server, redirectUri, clientId: begin.pending.clientId });
  if (second.ok) {
    const cb2 = await browser(second.authorizationUrl);
    const wrong = await completeMcpSignIn({ transport, credentials: new MemoryCredentialStore(), now }, { ...second.pending, verifier: "x".repeat(43) }, cb2, "wrong");
    step("a wrong PKCE verifier is refused by the server", !wrong.ok && wrong.problem === "token_failed", wrong);
  }

  const appLink = await postChecked(transport, registrationRequest("https://auth.hermit-spike.test/register", "https://hermit.dojocoding.io/oauth/mcp"));
  step("registration also accepts the HTTPS app-link redirect", appLink.ok && appLink.res.status === 201, appLink.ok ? appLink.res.status : appLink);

  const anonymous = new McpClient({ transport, serverUrl: server, clientVersion: "spike" });
  const anon = await anonymous.connect();
  step("without a token the server asks for sign-in", !anon.ok && anon.problem === "needs_sign_in", anon);

  const record = { tokenEndpoint: begin.pending.tokenEndpoint, resource: begin.pending.resource };
  const token = async () => {
    const t = await freshMcpToken({ transport, credentials, now }, record, "ref");
    return t.ok ? t.token : undefined;
  };
  const client = new McpClient({ transport, serverUrl: server, token, clientVersion: "spike" });
  const c = await client.connect();
  step(`initialize (${process.env.JSON_RESPONSE === "1" ? "JSON" : "SSE"} responses)`, c.ok, c);

  const tools = await client.listTools();
  if (!tools.ok) return step("tools/list", false, tools);
  step("tools/list", tools.tools.length === 6, { tools: tools.tools.map((t) => t.name), skipped: tools.skipped });
  console.log("\n  tool            annotations                              proposed      floor     destructive  conflicts");
  for (const t of tools.tools) {
    const r = mcpToolRisk(t, { installedByUser: true });
    console.log(`  ${t.name.padEnd(15)} ${JSON.stringify(t.annotations).padEnd(40)} ${effectiveMcpRisk(r).padEnd(13)} ${r.floor.padEnd(9)} ${String(r.destructive).padEnd(12)} ${r.conflicts.join(",")}`);
  }
  const search = tools.tools.find((t) => t.name === "search_notes")!;
  console.log(`\n  menu line: ${mcpMenuLine("mcp.hermit-spike.test", search)}\n`);

  const call = await client.callTool("get_forecast", { city: "Lima" });
  step("tools/call result comes back untrusted (the loop wraps it, FR-CAGE-04)", call.ok && call.untrusted, call);
  const structured = await client.callTool("search_notes", { q: "x" });
  step("tools/call with text and structuredContent", structured.ok, structured);
  const err = await client.callTool("pay_invoice", { id: "1" });
  step("an isError result is a failure, still untrusted", !err.ok && err.untrusted, err);
  const leaked = JSON.stringify([d, begin.ok && begin.authorizationUrl, done, tools, call]);
  const secret = await credentials.reveal("ref");
  step("no token in anything returned", secret?.kind === "oauth2" && !leaked.includes(secret.accessToken), undefined);
  await client.close();
  step("session closed with DELETE", log.at(-1)?.startsWith("DELETE") === true, log.at(-1));
  console.log(`\n${log.length} requests, all https:// in the client's view.`);
}

/**
 * SL-54: the add-a-server flow Hermit ships (McpServers) against the reference server: the user's URL, the sign-in,
 * the review sheet, the approval, the routed menu, one approved call, the injection kept from the main model, removal.
 */
async function servers(): Promise<void> {
  const log: string[] = [];
  const transport = nodeTransport("local", log);
  const credentials = new MemoryCredentialStore();
  const store = new MemoryMcpServerStore();
  const mcp = new McpServers({ transport, credentials, store, now: () => Date.now(), random, clientVersion: "spike" });
  const url = "https://mcp.hermit-spike.test/mcp";

  const refused = await mcp.begin({ url, origin: "tool_result" as never });
  step("a URL that didn't come from the user is refused before any request", refused.kind === "refused" && log.length === 0, refused);
  const begun = await mcp.begin({ url, origin: "typed" });
  if (begun.kind !== "sign_in") return step("begin", false, begun);
  step("sign-in step: verified host, sign-in host, scopes", true, { host: begun.host, signInHost: begun.signInHost, scopes: begun.scopes });
  const reviewed = await mcp.finishSignIn(begun.draftId, await browser(begun.authorizationUrl));
  if (reviewed.kind !== "review") return step("review", false, reviewed);
  step("review sheet: each tool with its code-derived risk, no server text", !/IMPORTANT|Totally harmless|Weather forecast|passwords/.test(JSON.stringify(reviewed.review)), reviewed.review.tools.map((t) => `${t.name}:${t.risk}${t.readProposal ? "(read?)" : ""}${t.destructive ? "!" : ""}`));
  step("nothing on the menu before approval", (await mcp.skillsForTurn({ userText: "forecast" })).length === 0, undefined);
  const approved = await mcp.approve(reviewed.review.draftId, { enabled: ["get_forecast", "send_message", "pay_invoice"], confirmRead: ["get_forecast", "send_message", "pay_invoice"] });
  if (!approved.ok) return step("approve", false, approved);
  step("approved: a read claim code overruled stays send or spend", true, approved.server.tools.map((t) => `${t.name}:${t.enabled ? t.risk : "off"}`));
  const menu = await mcp.skillsForTurn({ userText: "what's the forecast for Lima?" });
  step("routed and capped menu, the forecast first", menu[0]?.tool === "get_forecast" && menu.length <= 3, menu.map((s) => `${s.def.id}:${s.def.risk}`));
  const forecast = menu[0]!;
  const args = { city: "Lima" };
  const unapproved = await forecast.execute(args, { session: { id: "s", taint: [], unattended: false } });
  step("no call without an approval of these exact arguments", !unapproved.ok, unapproved.modelText);
  const readerSaw: string[] = [];
  const r = await forecast.execute(args, {
    session: { id: "s", taint: [], unattended: false },
    userText: "what's the forecast for Lima?",
    approvedArgsHash: argsHash(args),
    approvedBinding: forecast.def.describeAction(args, {} as never).binding,
    read: async ({ text }) => (readerSaw.push(text), "Sunny in Lima, 24 C."),
  });
  step("the injection reaches only the quarantined reader, never the main model", r.ok && readerSaw[0]?.includes("IGNORE") === true && !r.modelText.includes("IGNORE"), { modelText: r.modelText, reply: r.reply });
  const tokenBefore = await credentials.list();
  step("the token lives only in the credential store", tokenBefore.length === 1 && !JSON.stringify(await store.load()).includes("Bearer"), tokenBefore.map((m) => m.source));
  const removed = await mcp.remove(approved.server.id);
  step("remove: token deleted, server and tools gone", removed.removed && (await credentials.list()).length === 0 && (await mcp.skillsForTurn({ userText: "forecast" })).length === 0, removed);
  step("every request was HTTPS to the two spike hosts", log.every((l) => / https:\/\/(mcp|auth)\.hermit-spike\.test\//.test(l)), `${log.length} requests`);
}

async function discover(urls: string[]): Promise<void> {
  const log: string[] = [];
  const transport = nodeTransport("public", log);
  for (const url of urls) {
    const d = await discoverMcpAuth(transport, url);
    const row = !d.ok
      ? { server: url, problem: d.problem }
      : d.auth === "none"
        ? { server: url, auth: "none" }
        : {
            server: url,
            resource: d.resource,
            issuer: d.as.issuer,
            dcr: !!d.as.registrationEndpoint,
            cimd: d.as.clientIdMetadataDocuments,
            iss: d.as.issParameter,
            publicClient: d.as.tokenAuthMethods.length === 0 ? "unlisted" : d.as.tokenAuthMethods.includes("none"),
            scope: d.challengeScope ?? d.scopesSupported.join(" "),
            ...(d.legacy ? { layout: "2025-03-26 (no RFC 9728)" } : {}),
          };
    console.log(JSON.stringify(row));
  }
  console.log(`${log.length} requests (no registration, no credentials).`);
}

const [mode, ...rest] = process.argv.slice(2);
if (mode === "local") await local();
else if (mode === "servers") await servers();
else if (mode === "discover") await discover(rest);
else console.log("usage: mcp-spike.ts local | servers | discover <url>...");
