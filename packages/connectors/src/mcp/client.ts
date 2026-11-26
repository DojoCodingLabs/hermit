import { scrub, Secret } from "../secret.ts";
import type { ConnectorRequest } from "../transport.ts";
import { parseBearerChallenge, type BearerChallenge } from "./discovery.ts";
import { postChecked, type McpTransport } from "./http.ts";
import { isObject, parseJsonObject, type JsonObject } from "./json.ts";
import { parseTools, type McpTool, type SkippedTool } from "./tools.ts";
import { parseHttpsUrl, type HttpsUrl } from "./url.ts";

/** The version Hermit asks for, and the ones it accepts back (MCP lifecycle, version negotiation). */
export const MCP_PROTOCOL_VERSION = "2025-11-25";
export const MCP_SUPPORTED_VERSIONS: readonly string[] = ["2025-11-25", "2025-06-18", "2025-03-26"];

const MAX_PAGES = 10;
const SESSION_ID = /^[\x21-\x7e]{1,256}$/;

/**
 * The `data` of each message event in a complete SSE body. React Native's built-in fetch has no streaming
 * body, so the client reads a POST's event stream once the server has closed it (the server closes it after
 * the response, per Streamable HTTP); expo/fetch streams, but nothing here depends on it.
 */
export function parseSse(text: string): string[] {
  const out: string[] = [];
  for (const block of text.replace(/\r\n?/g, "\n").split("\n\n")) {
    let event = "message";
    const data: string[] = [];
    for (const line of block.split("\n")) {
      if (!line || line.startsWith(":")) continue;
      const i = line.indexOf(":");
      const field = i === -1 ? line : line.slice(0, i);
      const value = i === -1 ? "" : line.slice(i + 1).replace(/^ /, "");
      if (field === "event") event = value;
      else if (field === "data") data.push(value);
    }
    if (data.length && event === "message") out.push(data.join("\n"));
  }
  return out;
}

export type McpProblem = "needs_sign_in" | "blocked_url" | "unreachable" | "protocol" | "http_error";
export type McpFailure = { ok: false; problem: McpProblem; challenge?: BearerChallenge };
export type ConnectResult = { ok: true; protocolVersion: string; serverName: string } | McpFailure;
export type ListToolsResult = { ok: true; tools: McpTool[]; skipped: SkippedTool[] } | McpFailure;

/** A tool call's answer in parts: both are someone else's data. `problem` when the call never reached the tool. */
export interface McpCallParts {
  ok: boolean;
  text: string;
  structured?: JsonObject;
  problem?: McpProblem;
}

/** Shaped like a connector skill result: always someone else's text. */
export interface McpCallResult {
  ok: boolean;
  modelText: string;
  untrusted: true;
}

export interface McpClientDeps {
  transport: McpTransport;
  serverUrl: string;
  /** The access token, fetched (and refreshed) per request; see `freshMcpToken`. */
  token?: () => Promise<Secret | undefined>;
  clientVersion: string;
  maxResponseBytes?: number;
  /** Characters of a tool result handed to the model (default 4000). */
  maxModelChars?: number;
}

type Rpc = { ok: true; result: JsonObject } | { ok: false; problem: McpProblem; challenge?: BearerChallenge; rpcError?: string };

/**
 * A minimal MCP client over Streamable HTTP, platform-free: initialize, tools/list and tools/call, as POSTs
 * of single JSON-RPC messages, answered as JSON or as an SSE stream. It declares no client capabilities
 * (no sampling, roots or elicitation), so a server has no reason to send it requests. Every request goes
 * through `postChecked`; the token is injected by the transport at send time and scrubbed from results.
 */
export class McpClient {
  readonly #deps: McpClientDeps;
  readonly #url: HttpsUrl | undefined;
  #session: string | undefined;
  #version: string | undefined;
  #nextId = 1;
  #secrets: string[] = [];

  constructor(deps: McpClientDeps) {
    this.#deps = deps;
    this.#url = parseHttpsUrl(deps.serverUrl);
  }

  async connect(): Promise<ConnectResult> {
    this.#session = undefined;
    this.#version = undefined;
    const r = await this.#rpc("initialize", { protocolVersion: MCP_PROTOCOL_VERSION, capabilities: {}, clientInfo: { name: "Hermit", version: this.#deps.clientVersion } }, false);
    if (!r.ok) return this.#fail(r);
    const version = r.result.protocolVersion;
    if (typeof version !== "string" || !MCP_SUPPORTED_VERSIONS.includes(version)) return { ok: false, problem: "protocol" };
    this.#version = version;
    const sent = await this.#post({ jsonrpc: "2.0", method: "notifications/initialized" });
    if (!sent.ok) return this.#fail(sent);
    if (sent.res.status >= 300) return { ok: false, problem: "protocol" };
    const info = isObject(r.result.serverInfo) ? r.result.serverInfo : {};
    return { ok: true, protocolVersion: version, serverName: typeof info.name === "string" ? info.name.slice(0, 100) : "" };
  }

  async listTools(): Promise<ListToolsResult> {
    const ready = await this.#ready();
    if (ready) return ready;
    const seen = new Set<string>();
    const tools: McpTool[] = [];
    const skipped: SkippedTool[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < MAX_PAGES; page++) {
      const r = await this.#rpc("tools/list", cursor ? { cursor } : {});
      if (!r.ok) return this.#fail(r);
      const p = parseTools(r.result, seen);
      tools.push(...p.tools);
      skipped.push(...p.skipped);
      const next = r.result.nextCursor;
      if (typeof next !== "string" || !next || next.length > 1024) break;
      cursor = next;
    }
    return { ok: true, tools, skipped };
  }

  /** Runs one tool. The cage has already decided; this only sends and quarantines what comes back. */
  async callTool(name: string, args: Record<string, unknown>): Promise<McpCallResult> {
    const r = await this.callToolParts(name, args);
    const text = r.text || (r.structured !== undefined ? JSON.stringify(r.structured) : "");
    return this.#text(r.ok, text || "Done.");
  }

  /**
   * The same call, with the free text and the structured content kept apart (SL-54): free text goes to the
   * quarantined reader, structured fields become facts code reads. Both are someone else's data, the token
   * scrubbed; the text is capped like `callTool`'s.
   */
  async callToolParts(name: string, args: Record<string, unknown>): Promise<McpCallParts> {
    const ready = await this.#ready();
    if (ready) return { ok: false, text: "The MCP server could not be reached or needs the user to sign in again.", problem: ready.problem };
    const r = await this.#rpc("tools/call", { name, arguments: args });
    if (!r.ok) return { ok: false, text: this.#text(false, r.rpcError ? `The MCP server refused the call: ${r.rpcError}` : `The MCP call failed (${r.problem}).`).modelText, problem: r.problem };
    const parts: string[] = [];
    for (const c of Array.isArray(r.result.content) ? r.result.content : []) {
      if (!isObject(c)) continue;
      if (c.type === "text" && typeof c.text === "string") parts.push(c.text);
      else if (c.type === "image" || c.type === "audio") parts.push(`[${c.type} omitted]`);
      else if (c.type === "resource" && isObject(c.resource) && typeof c.resource.text === "string") parts.push(c.resource.text);
      else if (c.type === "resource_link" && typeof c.uri === "string") parts.push(`[link: ${c.uri}]`);
      else parts.push("[content omitted]");
    }
    const text = parts.join("\n");
    const structured = isObject(r.result.structuredContent) ? (parseJsonObject(scrub(JSON.stringify(r.result.structuredContent), this.#secrets)) ?? undefined) : undefined;
    return { ok: r.result.isError !== true, text: text ? this.#text(true, text).modelText : "", ...(structured ? { structured } : {}) };
  }

  /** Ends the session (Streamable HTTP DELETE). Failures are ignored: the server expires it anyway. */
  async close(): Promise<void> {
    if (!this.#url || !this.#session) return;
    await postChecked(this.#deps.transport, { ...(await this.#base()), method: "DELETE" }).catch(() => undefined);
    this.#session = undefined;
  }

  #text(ok: boolean, raw: string): McpCallResult {
    const max = this.#deps.maxModelChars ?? 4000;
    const clean = scrub(raw, this.#secrets);
    return { ok, modelText: clean.length > max ? `${clean.slice(0, max)}…` : clean, untrusted: true };
  }

  #fail(r: { problem: McpProblem; challenge?: BearerChallenge }): McpFailure {
    return { ok: false, problem: r.problem, ...(r.challenge ? { challenge: r.challenge } : {}) };
  }

  async #ready(): Promise<McpFailure | undefined> {
    if (this.#version) return undefined;
    const c = await this.connect();
    return c.ok ? undefined : c;
  }

  async #base(): Promise<ConnectorRequest> {
    const headers: Record<string, string> = { "Content-Type": "application/json", Accept: "application/json, text/event-stream" };
    if (this.#version) headers["MCP-Protocol-Version"] = this.#version;
    if (this.#session) headers["Mcp-Session-Id"] = this.#session;
    const req: ConnectorRequest = { method: "POST", url: (this.#url as HttpsUrl).href, headers, maxResponseBytes: this.#deps.maxResponseBytes ?? 262_144 };
    const token = await this.#deps.token?.();
    if (token) {
      const raw = token.reveal();
      if (!this.#secrets.includes(raw)) this.#secrets.push(raw);
      req.auth = { in: "header", name: "Authorization", value: new Secret(`Bearer ${raw}`) };
    }
    return req;
  }

  async #post(message: JsonObject) {
    if (!this.#url) return { ok: false as const, problem: "blocked_url" as const };
    const r = await postChecked(this.#deps.transport, { ...(await this.#base()), body: JSON.stringify(message) });
    if (!r.ok) return { ok: false as const, problem: r.problem === "unreachable" ? ("unreachable" as const) : ("blocked_url" as const) };
    if (r.res.status === 401 || r.res.status === 403) {
      const challenge = parseBearerChallenge(r.res.headers["www-authenticate"]);
      return { ok: false as const, problem: "needs_sign_in" as const, ...(challenge ? { challenge } : {}) };
    }
    return r;
  }

  async #rpc(method: string, params: JsonObject, retry = true): Promise<Rpc> {
    const id = this.#nextId++;
    const sent = await this.#post({ jsonrpc: "2.0", id, method, params });
    if (!sent.ok) return sent;
    const { res } = sent;
    // The server forgot the session: start a new one, once.
    if (res.status === 404 && this.#session && retry) {
      const c = await this.connect();
      return c.ok ? this.#rpc(method, params, false) : c;
    }
    if (res.status >= 400) return { ok: false, problem: "http_error" };
    if (method === "initialize") {
      const session = res.headers["mcp-session-id"];
      if (session !== undefined && !SESSION_ID.test(session)) return { ok: false, problem: "protocol" };
      this.#session = session;
    }
    const type = (res.headers["content-type"] ?? "").toLowerCase();
    const candidates = type.startsWith("text/event-stream") ? parseSse(res.body) : [res.body];
    for (const c of candidates) {
      const m = parseJsonObject(c);
      if (!m || m.jsonrpc !== "2.0" || m.id !== id) continue;
      if (isObject(m.error)) return { ok: false, problem: "protocol", rpcError: typeof m.error.message === "string" ? m.error.message.slice(0, 300) : "error" };
      if (isObject(m.result)) return { ok: true, result: m.result };
    }
    return { ok: false, problem: "protocol" };
  }
}
