import { argsHash, validateArgs, type CredentialStorePort, type Risk, type SessionState, type SkillDef } from "@hermit/core";
import { Secret } from "../secret.ts";
import { maxRisk } from "../spec.ts";
import type { ConnectorRequest } from "../transport.ts";
import { McpClient } from "./client.ts";
import { postChecked, type McpTransport } from "./http.ts";
import { isObject, type JsonObject } from "./json.ts";
import { beginMcpSignIn, completeMcpSignIn, freshMcpToken, SIGN_IN_TTL_MS, type McpPendingSignIn } from "./sign-in.ts";
import { mcpToolDef, mcpToolRisk, toolHash, type McpTool, type McpToolRisk, type SkippedTool } from "./tools.ts";
import { parseHttpsUrl } from "./url.ts";
import { KNOWN_MCP_SERVERS } from "../connect/known.ts";

/** Q77: the redirect every MCP sign-in uses. The app-link domain does not resolve yet; the custom scheme does. */
export const MCP_REDIRECT_URI = "hermit://oauth/mcp";

/** MCP tools offered to the model in one turn, whatever is installed: the menu stays small for the phone's model. */
export const MAX_MCP_TOOLS_PER_TURN = 3;

/**
 * Where the server's address came from. Only the user's own typing or pasting on HM-CONN-03 can add a server;
 * nothing Hermit read (a page, a message, a tool result) ever does, and no skill can call `begin`. `suggested` (SL-55)
 * is an address from the bundled list of official servers that HM-CONN-04 prefilled; the user still taps to add it.
 */
export type McpUrlOrigin = "typed" | "pasted" | "suggested";

export interface McpToolRecord {
  /** The definition the user approved. Its text is the server's: never on a sheet. */
  tool: McpTool;
  /** `toolHash` of that definition; any other hash disables the tool until the user approves it again. */
  hash: string;
  /** What code derived from the name and the hints (FR-CONN-05). */
  risk: McpToolRisk;
  enabled: boolean;
  /** The user confirmed the server's read-only claim (only meaningful when code proposed `network`). */
  readConfirmed: boolean;
  /** A risk the user raised. A lower one never applies. */
  raised?: Risk;
  /** The server now describes the tool differently; kept for a re-approval, never used until then. */
  changed?: { tool: McpTool; hash: string; risk: McpToolRisk };
  lastUsedAt?: number;
}

export type McpServerAuth =
  | { kind: "none" }
  | { kind: "oauth"; credentialId: string; resource: string; issuer: string; tokenEndpoint: string; revocationEndpoint?: string; clientId: string; scopes: string[] };

/** An installed MCP server. Holds no secret: tokens live only in the credential store under `credentialId`. */
export interface McpServerRecord {
  id: string;
  serverUrl: string;
  host: string;
  origin: McpUrlOrigin;
  addedAt: number;
  auth: McpServerAuth;
  tools: McpToolRecord[];
  skipped: SkippedTool[];
}

/** Where install records persist (the runtime keeps them in the encrypted database's settings). */
export interface McpServerStorePort {
  load(): Promise<McpServerRecord[]>;
  save(records: McpServerRecord[]): Promise<void>;
}

export class MemoryMcpServerStore implements McpServerStorePort {
  #json = "[]";
  async load(): Promise<McpServerRecord[]> {
    return JSON.parse(this.#json) as McpServerRecord[];
  }
  async save(records: McpServerRecord[]): Promise<void> {
    this.#json = JSON.stringify(records);
  }
}

export interface McpServersDeps {
  transport: McpTransport;
  credentials: CredentialStorePort;
  store: McpServerStorePort;
  now(): number;
  random(bytes: number): Uint8Array;
  clientVersion: string;
}

/**
 * The risk the cage sees for an MCP tool. Code's floor always holds and hints only raise it; the server's read-only
 * claim lowers a tool to `network` only after the user confirmed it on the sheet; the user can raise, never lower.
 */
export function mcpToolEffectiveRisk(t: { risk: McpToolRisk; readConfirmed: boolean; raised?: Risk }): Risk {
  const base = t.risk.proposed === "network" && t.readConfirmed ? "network" : maxRisk("remote_write", t.risk.floor, t.risk.proposed);
  return t.raised ? maxRisk(base, t.raised) : base;
}

/** One tool on the review sheet (HM-CONN-03): its name and what code says, never the server's text. */
export interface McpReviewTool {
  name: string;
  /** The risk if the user changes nothing. */
  risk: Risk;
  /** What code proposes; `network` only for a read claim the user may confirm. */
  proposed: Risk;
  readProposal: boolean;
  destructive: boolean;
  reasons: string[];
  conflicts: string[];
}

export interface McpReview {
  draftId: string;
  serverUrl: string;
  /** The host Hermit reached over HTTPS after the strict URL check, the one the tokens are for. */
  host: string;
  auth: "oauth" | "none";
  /** Where the user signed in, when the server needs it. */
  signInHost?: string;
  scopes: string[];
  tools: McpReviewTool[];
  skipped: SkippedTool[];
}

export type McpAddProblem =
  | "not_user_entered"
  | "bad_url"
  | "already_added"
  | "unreachable"
  | "not_mcp"
  | "sign_in_unsupported"
  | "needs_client_secret"
  | "redirect_refused"
  | "sign_in_failed"
  | "expired"
  | "unknown_draft"
  | "no_tools";

export type McpBegin =
  | { kind: "sign_in"; draftId: string; host: string; signInHost: string; scopes: string[]; authorizationUrl: string }
  | { kind: "review"; review: McpReview }
  | { kind: "refused"; problem: McpAddProblem };

export type McpReviewResult = { kind: "review"; review: McpReview } | { kind: "refused"; problem: McpAddProblem };

/** What the servers list shows (HM-CONN-03): no secrets and no server text. */
export interface McpServerView {
  id: string;
  serverUrl: string;
  host: string;
  auth: "oauth" | "none";
  scopes: string[];
  addedAt: number;
  tools: Array<{ name: string; enabled: boolean; risk: Risk; proposed: Risk; readProposal: boolean; readConfirmed: boolean; destructive: boolean; changed: boolean; reasons: string[] }>;
}

/** Shaped like the agent's SkillResult. */
export interface McpSkillResult {
  ok: boolean;
  modelText: string;
  untrusted: boolean;
  reply?: string;
}

export interface McpSkillContext {
  session: SessionState;
  approvedArgsHash?: string;
  approvedBinding?: string;
  userText?: string;
  /** The quarantined reader (FR-WEB-03): a model call with no tools, for the tool's free text. */
  read?(input: { question: string; text: string }): Promise<string | undefined>;
  /** Copy for the answers code writes (`HM-CONN-03.result.*`). */
  say?(key: string): string;
}

/** Shaped like the agent's SkillRuntime: the loop runs it through the cage like any other skill. */
export interface McpSkill {
  def: SkillDef;
  serverId: string;
  tool: string;
  execute(args: Record<string, unknown>, ctx: McpSkillContext): Promise<McpSkillResult>;
}

type Draft = {
  id: string;
  serverUrl: string;
  host: string;
  origin: McpUrlOrigin;
  createdAt: number;
  pending?: McpPendingSignIn;
  credentialId?: string;
  listed?: { tools: McpTool[]; skipped: SkippedTool[] };
};

const ORIGINS: ReadonlySet<string> = new Set<McpUrlOrigin>(["typed", "pasted", "suggested"]);
const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
const enc = encodeURIComponent;

const SIGN_IN_PROBLEMS: Partial<Record<string, McpAddProblem>> = {
  blocked_url: "bad_url",
  unreachable: "unreachable",
  not_mcp: "not_mcp",
  needs_client_secret: "needs_client_secret",
  redirect_refused: "redirect_refused",
};

const STOP = new Set(["the", "and", "for", "get", "set", "list", "mcp", "www", "api", "app", "com", "org", "net", "dev", "tool", "tools", "from", "with", "una", "los", "las", "del", "por", "para", "que", "mis", "con"]);
const fold = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
const wordsOf = (s: string) => fold(s.replace(/([a-z0-9])([A-Z])/g, "$1 $2")).split(/[^a-z0-9]+/).filter((w) => w.length >= 3 && !STOP.has(w));
const same = (a: string, b: string) => a === b || (a.length >= 4 && b.length >= 4 && (a.startsWith(b) || b.startsWith(a)));

export interface RoutableTool {
  serverId: string;
  host: string;
  name: string;
  lastUsedAt?: number;
}

/**
 * Which MCP tools the model sees this turn (model-first: the model picks; this only keeps the menu small). Tools
 * whose name, or whose server's host, shares a word with the user's own words come first; the rest by most recent
 * use, then install order; at most `cap`. Only code-known text is matched: never a description, which is the
 * server's and could be written to win every turn.
 */
export function routeMcpTools<T extends RoutableTool>(userText: string, tools: readonly T[], cap = MAX_MCP_TOOLS_PER_TURN): T[] {
  const said = wordsOf(userText);
  const score = (t: T) => {
    const host = wordsOf(t.host.split(".").slice(0, -1).join(" "));
    const name = wordsOf(t.name);
    return 2 * host.filter((h) => said.some((w) => same(w, h))).length + name.filter((n) => said.some((w) => same(w, n))).length;
  };
  return tools
    .map((t, i) => ({ t, i, s: score(t) }))
    .sort((a, b) => b.s - a.s || (b.t.lastUsedAt ?? 0) - (a.t.lastUsedAt ?? 0) || a.i - b.i)
    .slice(0, Math.max(0, cap))
    .map((x) => x.t);
}

// eslint-disable-next-line no-control-regex -- control, invisible and bidi characters are exactly what is removed
const UNSAFE = /[\u0000-\u001f\u007f-\u009f\u00ad\u200b-\u200f\u202a-\u202e\u2060-\u2064\u2066-\u2069\ufeff<>`]/g;
const KEY = /^[A-Za-z0-9_-]{1,40}$/;
const MAX_FACTS = 20;
const MAX_FACT_VALUE = 80;

/**
 * The structured content of a tool result as short `path: value` lines, read by code (SL-54): scalars only, at
 * most three levels deep, keys from a safe charset, values on one line with markup and invisible characters
 * removed and capped. These are the only words of a result the main model sees; the values are still the
 * server's, so the loop keeps them wrapped as untrusted.
 */
export function mcpFacts(value: JsonObject): string[] {
  const out: string[] = [];
  const walk = (v: unknown, path: string, depth: number) => {
    if (out.length >= MAX_FACTS) return;
    if (v === null || typeof v === "number" || typeof v === "boolean") return void out.push(`${path}: ${String(v)}`);
    if (typeof v === "string") {
      const clean = v.replace(/\s+/g, " ").replace(UNSAFE, "").trim();
      return void out.push(`${path}: ${clean.length > MAX_FACT_VALUE ? `${clean.slice(0, MAX_FACT_VALUE)}…` : clean}`);
    }
    if (depth >= 3) return;
    if (Array.isArray(v)) return v.slice(0, 10).forEach((x, i) => walk(x, `${path}.${i}`, depth + 1));
    if (isObject(v)) for (const [k, x] of Object.entries(v)) if (KEY.test(k)) walk(x, path ? `${path}.${k}` : k, depth + 1);
  };
  walk(value, "", 0);
  return out.map((l) => l.replace(/^\./, ""));
}

const REVOKE_BYTES = 4096;

/**
 * MCP servers the user added (US-CONN-03, FR-CONN-05, HM-CONN-03): the add flow (the user's URL, discovery and
 * sign-in, the review sheet), the installed records with per-tool toggles and risks, removal with revocation, and
 * the tools offered to the model each turn. Every request goes through the SL-51 client's strict HTTPS checks.
 */
export class McpServers {
  readonly #deps: McpServersDeps;
  readonly #drafts = new Map<string, Draft>();
  /** Servers whose tool list was checked against the approved hashes, per session. */
  readonly #checked = new Map<string, string>();

  constructor(deps: McpServersDeps) {
    this.#deps = deps;
  }

  /** Step 1: the address the user typed or pasted. Discovers how it signs in; a server with no sign-in goes to review. */
  async begin(input: { url: string; origin: McpUrlOrigin }): Promise<McpBegin> {
    if (!ORIGINS.has(input.origin as string)) return { kind: "refused", problem: "not_user_entered" };
    const url = parseHttpsUrl(String(input.url ?? "").trim());
    // A suggestion is only ever an address Hermit ships; anything else must be the user's own typing or pasting.
    if (input.origin === "suggested" && !KNOWN_MCP_SERVERS.some((k) => parseHttpsUrl(k.url)?.href === url?.href)) return { kind: "refused", problem: "not_user_entered" };
    if (!url) return { kind: "refused", problem: "bad_url" };
    await this.#sweep();
    if ((await this.#deps.store.load()).some((r) => r.serverUrl === url.href)) return { kind: "refused", problem: "already_added" };
    const draft: Draft = { id: `d${hex(this.#deps.random(6))}`, serverUrl: url.href, host: url.host, origin: input.origin, createdAt: this.#deps.now() };
    const begun = await beginMcpSignIn(this.#deps, { serverUrl: url.href, redirectUri: MCP_REDIRECT_URI });
    if (!begun.ok) {
      if (begun.problem !== "no_auth_needed") return { kind: "refused", problem: SIGN_IN_PROBLEMS[begun.problem] ?? "sign_in_unsupported" };
      const listed = await this.#list(draft.serverUrl, undefined);
      if (!listed.ok) return { kind: "refused", problem: listed.problem };
      draft.listed = listed;
      this.#drafts.set(draft.id, draft);
      return { kind: "review", review: this.#review(draft) };
    }
    draft.pending = begun.pending;
    this.#drafts.set(draft.id, draft);
    const signInHost = parseHttpsUrl(begun.authorizationUrl.split("?")[0] as string)?.host ?? "";
    return { kind: "sign_in", draftId: draft.id, host: draft.host, signInHost, scopes: [...begun.pending.scopes], authorizationUrl: begun.authorizationUrl };
  }

  /** Step 2: the browser handed the redirect back. Verifies it, stores the tokens, lists the tools for review. */
  async finishSignIn(draftId: string, callbackUrl: string): Promise<McpReviewResult> {
    const draft = await this.#draft(draftId);
    if (!draft?.pending) return { kind: "refused", problem: draft ? "sign_in_failed" : "unknown_draft" };
    const credentialId = `mcp-${hex(this.#deps.random(8))}`;
    const done = await completeMcpSignIn(this.#deps, draft.pending, callbackUrl, credentialId);
    if (!done.ok) return { kind: "refused", problem: done.problem === "expired" ? "expired" : "sign_in_failed" };
    draft.credentialId = credentialId;
    const listed = await this.#list(draft.serverUrl, { tokenEndpoint: draft.pending.tokenEndpoint, resource: draft.pending.resource, credentialId });
    if (!listed.ok) {
      await this.cancel(draftId);
      return { kind: "refused", problem: listed.problem };
    }
    draft.listed = listed;
    return { kind: "review", review: this.#review(draft) };
  }

  /**
   * Step 3: the user's yes on the review sheet. Only the tools in `enabled` are on; `confirmRead` confirms a
   * read-only claim code allowed. Until this call nothing of the server reaches the model.
   */
  async approve(draftId: string, choice: { enabled: readonly string[]; confirmRead: readonly string[]; raised?: Partial<Record<string, Risk>> }): Promise<{ ok: true; server: McpServerView } | { ok: false; problem: McpAddProblem }> {
    const draft = await this.#draft(draftId);
    if (!draft?.listed) return { ok: false, problem: draft ? "sign_in_failed" : "unknown_draft" };
    const p = draft.pending;
    const auth: McpServerAuth = p && draft.credentialId
      ? {
          kind: "oauth", credentialId: draft.credentialId, resource: p.resource, issuer: p.issuer, tokenEndpoint: p.tokenEndpoint,
          ...(p.revocationEndpoint ? { revocationEndpoint: p.revocationEndpoint } : {}), clientId: p.clientId,
          scopes: (await this.#deps.credentials.get(draft.credentialId))?.scopes ?? p.scopes,
        }
      : { kind: "none" };
    const record: McpServerRecord = {
      id: `m${hex(this.#deps.random(3))}`,
      serverUrl: draft.serverUrl,
      host: draft.host,
      origin: draft.origin,
      addedAt: this.#deps.now(),
      auth,
      tools: draft.listed.tools.map((tool) => {
        const raised = choice.raised?.[tool.name];
        return {
          tool, hash: toolHash(tool), risk: mcpToolRisk(tool, { installedByUser: true }),
          enabled: choice.enabled.includes(tool.name), readConfirmed: choice.confirmRead.includes(tool.name),
          ...(raised ? { raised } : {}),
        };
      }),
      skipped: draft.listed.skipped,
    };
    this.#drafts.delete(draftId);
    const all = await this.#deps.store.load();
    await this.#deps.store.save([...all, record]);
    return { ok: true, server: view(record) };
  }

  /** The user backed out: the draft goes, and so does any token its sign-in stored. */
  async cancel(draftId: string): Promise<void> {
    const draft = this.#drafts.get(draftId);
    this.#drafts.delete(draftId);
    if (draft?.credentialId) {
      const secret = await this.#deps.credentials.reveal(draft.credentialId);
      await this.#deps.credentials.delete(draft.credentialId);
      if (draft.pending?.revocationEndpoint && secret?.kind === "oauth2") await this.#revoke(draft.pending.revocationEndpoint, draft.pending.clientId, secret.refreshToken ?? secret.accessToken);
    }
  }

  async list(): Promise<McpServerView[]> {
    return (await this.#deps.store.load()).map(view);
  }

  /** A per-tool toggle on HM-CONN-03. A changed tool can't be turned on before `reapprove`. */
  async setTool(serverId: string, name: string, change: { enabled?: boolean; readConfirmed?: boolean; raised?: Risk }): Promise<boolean> {
    return this.#update(serverId, name, (t) => {
      if (change.enabled !== undefined) t.enabled = change.enabled && !t.changed;
      if (change.readConfirmed !== undefined) t.readConfirmed = change.readConfirmed;
      if (change.raised !== undefined) t.raised = change.raised;
    });
  }

  /** The user approves a tool's new definition: it replaces the old one and stays off until turned on. */
  async reapprove(serverId: string, name: string): Promise<boolean> {
    return this.#update(serverId, name, (t) => {
      if (!t.changed) return;
      t.tool = t.changed.tool;
      t.hash = t.changed.hash;
      t.risk = t.changed.risk;
      t.readConfirmed = false;
      t.enabled = false;
      delete t.changed;
    });
  }

  /**
   * Removes a server: its tokens are deleted on the phone first, then revoked at its authorization server where it
   * supports revocation (RFC 7009); a failed revocation still leaves nothing on the phone. Its tools leave the menu.
   */
  async remove(serverId: string): Promise<{ removed: boolean; revoked: "yes" | "unsupported" | "failed" }> {
    const all = await this.#deps.store.load();
    const record = all.find((r) => r.id === serverId);
    if (!record) return { removed: false, revoked: "unsupported" };
    let revoked: "yes" | "unsupported" | "failed" = "unsupported";
    if (record.auth.kind === "oauth") {
      const secret = await this.#deps.credentials.reveal(record.auth.credentialId);
      await this.#deps.credentials.delete(record.auth.credentialId);
      const token = secret?.kind === "oauth2" ? (secret.refreshToken ?? secret.accessToken) : undefined;
      if (record.auth.revocationEndpoint && token) revoked = await this.#revoke(record.auth.revocationEndpoint, record.auth.clientId, token);
    }
    await this.#deps.store.save(all.filter((r) => r.id !== serverId));
    this.#checked.delete(serverId);
    return { removed: true, revoked };
  }

  /** The MCP tools on the model's menu this turn: enabled, unchanged, routed by the user's words, capped. */
  async skillsForTurn(input: { userText: string; cap?: number }): Promise<McpSkill[]> {
    const records = await this.#deps.store.load();
    const candidates = records.flatMap((r) => r.tools.filter((t) => t.enabled && !t.changed).map((t) => ({ serverId: r.id, host: r.host, name: t.tool.name, ...(t.lastUsedAt !== undefined ? { lastUsedAt: t.lastUsedAt } : {}), record: r, t })));
    return routeMcpTools(input.userText, candidates, input.cap ?? MAX_MCP_TOOLS_PER_TURN).map((c) => this.#skill(c.record, c.t));
  }

  #skill(record: McpServerRecord, t: McpToolRecord): McpSkill {
    const risk = mcpToolEffectiveRisk(t);
    const binding = `mcp:${record.id}:${t.hash}:${t.tool.name}`;
    const def = mcpToolDef({ serverId: record.id, host: record.host, tool: t.tool, risk, binding });
    return { def, serverId: record.id, tool: t.tool.name, execute: (args, ctx) => this.#execute(record.id, t.tool.name, t.hash, binding, args, ctx) };
  }

  async #execute(serverId: string, name: string, hash: string, binding: string, args: Record<string, unknown>, ctx: McpSkillContext): Promise<McpSkillResult> {
    const fail = (modelText: string): McpSkillResult => ({ ok: false, modelText, untrusted: false });
    const record = (await this.#deps.store.load()).find((r) => r.id === serverId);
    const t = record?.tools.find((x) => x.tool.name === name);
    if (!record || !t || !t.enabled || t.changed || t.hash !== hash) return fail("That MCP tool is no longer available. Nothing was sent.");
    const errors = validateArgs(args, t.tool.inputSchema);
    if (errors.length) return fail(`Arguments for ${name}: ${errors.join("; ")}.`);
    // Defense in depth: the cage asks for every MCP call (none is `read`); nothing runs without the user's yes to
    // these exact arguments for this exact definition.
    if (ctx.approvedArgsHash !== argsHash(args) || ctx.approvedBinding !== binding) return fail("Not approved. Nothing was sent.");

    const auth = record.auth;
    const token = auth.kind === "oauth" ? await freshMcpToken(this.#deps, auth, auth.credentialId) : undefined;
    if (token && !token.ok) return fail(`${record.host} needs the user to sign in again: remove it and add it again in MCP servers.`);
    const client = this.#client(record.serverUrl, token?.ok ? token.token : undefined);

    // Once per session, the tool list is compared with what the user approved (a changed definition is a rug pull).
    if (this.#checked.get(serverId) !== ctx.session.id) {
      const listed = await client.listTools();
      if (!listed.ok) return fail(`Couldn't reach ${record.host}. Tell the user plainly.`);
      const changed = await this.#markChanged(serverId, listed.tools);
      this.#checked.set(serverId, ctx.session.id);
      if (changed.includes(name)) return fail(`${name} on ${record.host} changed since the user approved it, so it is off until they approve it again. Nothing was sent.`);
    }

    const r = await client.callToolParts(name, args);
    await this.#update(serverId, name, (x) => void (x.lastUsedAt = this.#deps.now()));
    await client.close();
    if (r.problem) return fail(r.problem === "needs_sign_in" ? `${record.host} needs the user to sign in again.` : `Couldn't reach ${record.host}. Tell the user plainly.`);
    const facts = r.structured ? mcpFacts(r.structured) : [];
    const factText = facts.length ? `Facts ${name} returned (read by code; the values are the server's):\n${facts.join("\n")}` : "";
    const say = ctx.say ?? ((k: string) => k);
    if (!r.text) return { ok: r.ok, modelText: factText || (r.ok ? "Done." : `${name} reported an error.`), untrusted: true };
    // Free text is someone else's words: the quarantined reader answers from it; the main model never reads it.
    let answer: string | undefined;
    try {
      answer = ctx.read ? await ctx.read({ question: ctx.userText ?? "", text: r.text }) : undefined;
    } catch {
      answer = undefined;
    }
    const reply = answer ?? say(r.ok ? "HM-CONN-03.result.unread" : "HM-CONN-03.result.error");
    const note = `${name} answered in text; the quarantined reader summarized it for the user.`;
    return { ok: r.ok, modelText: factText ? `${factText}\n${note}` : note, untrusted: true, reply };
  }

  #client(serverUrl: string, token: Secret | undefined): McpClient {
    return new McpClient({ transport: this.#deps.transport, serverUrl, clientVersion: this.#deps.clientVersion, ...(token ? { token: async () => token } : {}) });
  }

  async #list(serverUrl: string, auth: { tokenEndpoint: string; resource: string; credentialId: string } | undefined): Promise<{ ok: true; tools: McpTool[]; skipped: SkippedTool[] } | { ok: false; problem: McpAddProblem }> {
    const token = auth ? await freshMcpToken(this.#deps, auth, auth.credentialId) : undefined;
    if (token && !token.ok) return { ok: false, problem: "sign_in_failed" };
    const client = this.#client(serverUrl, token?.ok ? token.token : undefined);
    const r = await client.listTools();
    await client.close();
    if (!r.ok) return { ok: false, problem: r.problem === "unreachable" ? "unreachable" : r.problem === "needs_sign_in" ? "sign_in_failed" : "not_mcp" };
    if (!r.tools.length) return { ok: false, problem: "no_tools" };
    return { ok: true, tools: r.tools, skipped: r.skipped };
  }

  #review(draft: Draft): McpReview {
    const listed = draft.listed as NonNullable<Draft["listed"]>;
    return {
      draftId: draft.id,
      serverUrl: draft.serverUrl,
      host: draft.host,
      auth: draft.pending ? "oauth" : "none",
      ...(draft.pending ? { signInHost: parseHttpsUrl(draft.pending.issuer)?.host ?? "" } : {}),
      scopes: draft.pending ? [...draft.pending.scopes] : [],
      tools: listed.tools.map((tool) => {
        const risk = mcpToolRisk(tool, { installedByUser: true });
        return {
          name: tool.name, risk: mcpToolEffectiveRisk({ risk, readConfirmed: false }), proposed: risk.proposed,
          readProposal: risk.proposed === "network", destructive: risk.destructive, reasons: [...risk.reasons], conflicts: [...risk.conflicts],
        };
      }),
      skipped: listed.skipped,
    };
  }

  async #markChanged(serverId: string, fresh: McpTool[]): Promise<string[]> {
    const changed: string[] = [];
    const all = await this.#deps.store.load();
    const record = all.find((r) => r.id === serverId);
    if (!record) return changed;
    for (const t of record.tools) {
      const now = fresh.find((x) => x.name === t.tool.name);
      const nowHash = now ? toolHash(now) : undefined;
      if (nowHash === t.hash) continue;
      changed.push(t.tool.name);
      t.enabled = false;
      // A tool that disappeared stays off; one that changed waits for the user's re-approval.
      if (now && nowHash) t.changed = { tool: now, hash: nowHash, risk: mcpToolRisk(now, { installedByUser: true }) };
    }
    if (changed.length) await this.#deps.store.save(all);
    return changed;
  }

  async #update(serverId: string, name: string, edit: (t: McpToolRecord) => void): Promise<boolean> {
    const all = await this.#deps.store.load();
    const t = all.find((r) => r.id === serverId)?.tools.find((x) => x.tool.name === name);
    if (!t) return false;
    edit(t);
    await this.#deps.store.save(all);
    return true;
  }

  async #revoke(endpoint: string, clientId: string, token: string): Promise<"yes" | "failed"> {
    const req: ConnectorRequest = {
      method: "POST",
      url: endpoint,
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new Secret(`token=${enc(token)}&token_type_hint=refresh_token&client_id=${enc(clientId)}`),
      maxResponseBytes: REVOKE_BYTES,
    };
    const r = await postChecked(this.#deps.transport, req);
    return r.ok && r.res.status < 400 ? "yes" : "failed";
  }

  async #draft(id: string): Promise<Draft | undefined> {
    await this.#sweep();
    return this.#drafts.get(id);
  }

  /** Drafts older than the sign-in window go, with any token they stored. */
  async #sweep(): Promise<void> {
    for (const d of [...this.#drafts.values()]) if (this.#deps.now() - d.createdAt > SIGN_IN_TTL_MS) await this.cancel(d.id);
  }
}

function view(r: McpServerRecord): McpServerView {
  return {
    id: r.id,
    serverUrl: r.serverUrl,
    host: r.host,
    auth: r.auth.kind,
    scopes: r.auth.kind === "oauth" ? [...r.auth.scopes] : [],
    addedAt: r.addedAt,
    tools: r.tools.map((t) => ({
      name: t.tool.name, enabled: t.enabled, risk: mcpToolEffectiveRisk(t), proposed: t.risk.proposed, readProposal: t.risk.proposed === "network",
      readConfirmed: t.readConfirmed, destructive: t.risk.destructive, changed: t.changed !== undefined, reasons: [...t.risk.reasons],
    })),
  };
}
