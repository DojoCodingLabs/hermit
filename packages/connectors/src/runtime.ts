import { utf8ToBytes } from "@noble/hashes/utils.js";
import {
  argsHash,
  skillId,
  validateArgs,
  type CredentialMeta,
  type CredentialSecret,
  type CredentialSource,
  type CredentialStorePort,
  type Risk,
  type SessionState,
  type SkillDef,
} from "@hermit/core";
import { specTrust } from "./catalog.ts";
import { needsRefresh, refreshOAuthCredential, revokeRequest } from "./oauth.ts";
import { oauthProviders, type OAuthProvider } from "./oauth-providers.ts";
import { base64, scrub, Secret } from "./secret.ts";

const utf8ToBase64 = (text: string) => base64(utf8ToBytes(text));
import { effectiveRisk, pathParams, specHash, validateSpec, type ConnectorSpec, type OperationSpec, type Transform } from "./spec.ts";
import type { ConnectorRequest, ConnectorTransport } from "./transport.ts";

/** A connector the user approved and connected (FR-CONN-08, FR-CONN-09). */
export interface InstalledConnector {
  spec: ConnectorSpec;
  /** The spec hash the user approved with a fingerprint; any other hash disables the connector. */
  approvedHash: string;
  /** Operations the user enabled. The rest never reach the model. */
  enabled: string[];
  /** Raised risks per operation. A lower value is ignored. */
  riskOverrides?: Partial<Record<string, Risk>>;
  credentialId: string;
}

/** Shaped like the agent's SkillResult. */
export interface ConnectorSkillResult {
  ok: boolean;
  modelText: string;
  untrusted: boolean;
}

/** Shaped like the agent's SkillRuntime, so the loop runs it like any other skill: through the cage. */
export interface ConnectorSkill {
  def: SkillDef;
  connectorId: string;
  operation: string;
  execute(args: Record<string, unknown>, ctx: { session: SessionState; approvedArgsHash?: string; approvedBinding?: string }): Promise<ConnectorSkillResult>;
}

export interface RuntimeDeps {
  credentials: CredentialStorePort;
  transport: ConnectorTransport;
  now(): number;
  providers?: Record<string, OAuthProvider>;
  /** Raw response bytes read from the service (default 64 KB). */
  maxResponseBytes?: number;
  /** Characters of the result handed to the model (default 4000). */
  maxModelChars?: number;
  /** Dojo Coding's Ed25519 public key, for specs that ship as data (FR-CONN-01). */
  dojoPublicKey?: Uint8Array;
}

export interface ConnectionInfo {
  credentialId: string;
  connectorId: string;
  service: string;
  account?: string;
  scopes: string[];
  lastUsedAt?: number;
  source: CredentialSource;
}

export interface ConnectorDetails {
  id: string;
  name: string;
  hosts: string[];
  signIn: ConnectorSpec["auth"][number]["type"][];
  operations: Array<{ name: string; title: string; risk: Risk; effect: OperationSpec["effect"]; destructive: boolean; scopes: string[] }>;
}

/** What a test call found (SL-55). */
export type ProbeResult = "ok" | "refused" | "error" | "unreachable" | "no_key" | "not_testable";

/** An operation a test call may run: a GET with no required argument. */
export function isProbe(op: OperationSpec): boolean {
  const required = (op.inputSchema as { required?: unknown }).required;
  return op.method === "GET" && op.effect === "read" && (!Array.isArray(required) || required.length === 0);
}

/** Risks the cage always asks about; the runtime refuses them without an approval of these exact arguments. */
const ALWAYS_ASK: ReadonlySet<Risk> = new Set(["remote_write", "send", "credential", "spend"]);

/**
 * A connector operation's skill id, namespaced like MCP's `mcp_`, so no connector can take a built-in's name
 * (an operation called reply_message is `conn_<spec>_reply_message`). Clashes between connectors are refused at install.
 */
export function skillIdFor(spec: ConnectorSpec, op: OperationSpec): string {
  return `conn_${spec.id}_${op.name}`;
}

const fail = (modelText: string): ConnectorSkillResult => ({ ok: false, modelText, untrusted: false });
const show = (v: unknown) => (typeof v === "string" ? v : JSON.stringify(v));

function getPath(value: unknown, path: string): unknown {
  let cur = value;
  for (const key of path.split(".")) {
    if (typeof cur !== "object" || cur === null) return undefined;
    cur = (cur as Record<string, unknown>)[key];
  }
  return cur;
}

/** Keys that reach an object's prototype; a body path never writes them (validated in spec.ts too). */
export const FORBIDDEN_PATH_KEYS: ReadonlySet<string> = new Set(["__proto__", "prototype", "constructor"]);

function setPath(target: Record<string, unknown>, path: string, value: unknown): void {
  const keys = path.split(".");
  if (keys.some((k) => FORBIDDEN_PATH_KEYS.has(k))) throw new Error(`refused body path ${path}`);
  let cur = target;
  for (const key of keys.slice(0, -1)) {
    const next = Object.hasOwn(cur, key) ? cur[key] : undefined;
    if (typeof next !== "object" || next === null) {
      const fresh = Object.create(null) as Record<string, unknown>;
      cur[key] = fresh;
      cur = fresh;
    } else cur = next as Record<string, unknown>;
  }
  cur[keys.at(-1) as string] = value;
}

function pick(item: unknown, fields: string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of fields) {
    const v = getPath(item, f);
    if (v !== undefined) out[f] = v;
  }
  return out;
}

/** Applies a pick_fields transform; returns the raw text when the body isn't the JSON the spec expects. */
function project(body: string, t: Extract<Transform, { kind: "pick_fields" }> | undefined): string {
  if (!t) return body;
  let json: unknown;
  try {
    json = JSON.parse(body);
  } catch {
    return body;
  }
  const target = t.list ? getPath(json, t.list) : json;
  if (Array.isArray(target)) return JSON.stringify(target.map((i) => pick(i, t.fields)));
  if (typeof target === "object" && target !== null) return JSON.stringify(pick(target, t.fields));
  return body;
}

function cap(text: string, max: number): string {
  const suffix = " [cut]";
  return text.length <= max ? text : text.slice(0, max - suffix.length) + suffix;
}

const hasControl = (v: string) => [...v].some((c) => c.charCodeAt(0) < 0x20 || c.charCodeAt(0) === 0x7f);

/** A value that could change which endpoint a path reaches, before or after one round of percent-decoding. */
function unsafeSegmentValue(value: string): boolean {
  const forms = [value];
  try {
    forms.push(decodeURIComponent(value));
  } catch {
    return true;
  }
  return forms.some((v) => v === "" || v === "." || v === ".." || v.includes("/") || v.includes("\\") || hasControl(v));
}

/**
 * Fills a path template with percent-encoded argument values (FR-CONN-02). Undefined when a value could
 * move the request to another endpoint ("..", "/", "\\", control characters) or when the result no longer
 * keeps the template's literal segments, in which case nothing is sent.
 */
export function resolvePath(template: string, args: Record<string, unknown>): string | undefined {
  let unsafe = false;
  const resolved = template.replace(/\{([^{}]+)\}/g, (_, p: string) => {
    const value = show(args[p]);
    if (args[p] === undefined || unsafeSegmentValue(value)) unsafe = true;
    return encodeURIComponent(value);
  });
  if (unsafe) return undefined;
  const want = template.split("/");
  const got = resolved.split("/");
  if (want.length !== got.length) return undefined;
  for (let i = 0; i < want.length; i++) {
    const w = want[i] as string;
    if (!w.includes("{") && w !== got[i]) return undefined;
    if (got[i] === "." || got[i] === "..") return undefined;
  }
  return resolved;
}

const queryString = (entries: Array<[string, unknown]>) =>
  entries.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(show(v))}`).join("&");

/**
 * Runs connector specs (FR-CONN-01): one fixed runtime turns each enabled operation into a skill the agent
 * loop puts through `decide()`, injects the credential at send time, and hands back the result as
 * untrusted, capped text.
 */
export class ConnectorRuntime {
  readonly #deps: RuntimeDeps;
  readonly #providers: Record<string, OAuthProvider>;

  constructor(deps: RuntimeDeps) {
    this.#deps = deps;
    this.#providers = deps.providers ?? oauthProviders;
  }

  skillsFor(installed: InstalledConnector): { skills: ConnectorSkill[]; problem?: "invalid_spec" | "spec_changed" } {
    const { spec } = installed;
    const trust = specTrust(spec, this.#deps.dojoPublicKey);
    if (validateSpec(spec, { trust, providers: this.#providers }).length) return { skills: [], problem: "invalid_spec" };
    const hash = specHash(spec);
    if (hash !== installed.approvedHash) return { skills: [], problem: "spec_changed" };
    const skills = spec.operations
      .filter((op) => installed.enabled.includes(op.name))
      .map((op) => this.#skill(installed, op, hash));
    return { skills };
  }

  #skill(installed: InstalledConnector, op: OperationSpec, hash: string): ConnectorSkill {
    const { spec } = installed;
    const risk = effectiveRisk(op, installed.riskOverrides?.[op.name]);
    const host = op.host ?? (spec.hosts[0] as string);
    const binding = `${spec.id}:${hash}:${op.name}`;
    const def: SkillDef = {
      id: skillId(skillIdFor(spec, op)),
      version: spec.version,
      menuLine: `${spec.name}: ${op.description}`.slice(0, 300),
      args: op.inputSchema,
      risk,
      // Every connector result is someone else's text (FR-CAGE-04).
      producesUntrusted: true,
      describeAction: (args) => ({
        title: `${spec.name}: ${op.title}`,
        lines: [
          { label: "Host", labelKey: "host", value: host },
          { label: "Request", labelKey: "request", value: `${op.method} ${this.#fillPath(op.path, args)}` },
          ...Object.entries(args).filter(([, v]) => v !== undefined).map(([k, v]) => ({ label: k, value: show(v) })),
        ],
        binding,
      }),
    };
    return {
      def,
      connectorId: spec.id,
      operation: op.name,
      execute: (args, ctx) => this.#execute(installed, op, { risk, host, binding }, args, ctx),
    };
  }

  /** For the approval sheet only: the template with the raw values, so the user reads what the model asked. */
  #fillPath(path: string, args: Record<string, unknown>): string {
    return path.replace(/\{([^{}]+)\}/g, (_, p: string) => show(args[p]));
  }

  async #execute(
    installed: InstalledConnector,
    op: OperationSpec,
    bound: { risk: Risk; host: string; binding: string },
    args: Record<string, unknown>,
    ctx: { approvedArgsHash?: string; approvedBinding?: string },
  ): Promise<ConnectorSkillResult> {
    const { spec } = installed;
    const errors = validateArgs(args, op.inputSchema);
    if (errors.length) return fail(`Arguments for ${op.name}: ${errors.join("; ")}.`);
    const path = resolvePath(op.path, args);
    if (path === undefined) return fail(`Arguments for ${op.name}: a path value can't contain "/", "\\", control characters, or be "." or "..". Nothing was sent.`);
    // Defense in depth: the cage asked for these risks; nothing runs without the user's yes to these exact args.
    if (ALWAYS_ASK.has(bound.risk) && ctx.approvedArgsHash !== argsHash(args)) return fail("Not approved. Nothing was sent.");
    if (ctx.approvedBinding !== undefined && ctx.approvedBinding !== bound.binding) return fail(`${spec.name} changed since the approval. Nothing was sent.`);

    const { credentials, transport, now } = this.#deps;
    const notConnected = fail(`${spec.name} is not connected. Tell the user to connect it in Connections.`);
    const meta = await credentials.get(installed.credentialId);
    let secret = await credentials.reveal(installed.credentialId);
    if (!meta || !secret) return notConnected;

    if (this.#needsRefresh(meta, secret)) {
      const refreshed = await this.#refresh(spec, meta, secret);
      if (!refreshed) return fail(`${spec.name} needs the user to sign in again in Connections.`);
      secret = refreshed.secret;
    }

    const auth = this.#inject(spec, secret);
    if (!auth) return notConnected;
    const secrets = [...Object.values(secret).filter((v): v is string => typeof v === "string" && v !== secret.kind), auth.value.reveal()];

    const request = this.#request(spec, op, bound.host, path, args, auth);
    let response;
    try {
      response = await transport.send(request);
    } catch {
      return fail(`Couldn't reach ${spec.name}. Tell the user plainly.`);
    } finally {
      await credentials.markUsed(installed.credentialId, now());
    }
    if (response.status === 401 || response.status === 403) return fail(`${spec.name} refused the request: the user needs to sign in to ${spec.name} again in Connections.`);
    if (response.status >= 400) return fail(`${spec.name} answered with an error (HTTP ${response.status}).`);

    const raw = scrub(response.body.slice(0, request.maxResponseBytes), secrets);
    const pickT = spec.transforms.find((t): t is Extract<Transform, { kind: "pick_fields" }> => t.kind === "pick_fields" && t.operation === op.name);
    const text = raw.trim() ? project(raw, pickT) : "Done.";
    return { ok: true, modelText: cap(scrub(text, secrets), this.#deps.maxModelChars ?? 4000), untrusted: true };
  }

  #request(spec: ConnectorSpec, op: OperationSpec, host: string, path: string, args: Record<string, unknown>, auth: NonNullable<ConnectorRequest["auth"]>): ConnectorRequest {
    const inPath = new Set(pathParams(op.path));
    const rest = Object.entries(args).filter(([k, v]) => !inPath.has(k) && v !== undefined);
    const headers: Record<string, string> = { Accept: "application/json" };
    for (const t of spec.transforms) if (t.kind === "static_header") headers[t.name] = t.value;

    let query: Array<[string, unknown]> = [];
    let body: string | undefined;
    if (op.body) {
      const mapped = new Set(Object.values(op.body));
      const obj: Record<string, unknown> = {};
      for (const [path, arg] of Object.entries(op.body)) if (args[arg] !== undefined) setPath(obj, path, args[arg]);
      body = JSON.stringify(obj);
      query = rest.filter(([k]) => !mapped.has(k));
    } else if (op.method === "GET" || op.method === "DELETE") {
      query = rest;
    } else if (rest.length) {
      body = JSON.stringify(Object.fromEntries(rest));
    }
    if (body !== undefined) headers["Content-Type"] = "application/json";
    const qs = query.length ? `?${queryString(query)}` : "";
    return {
      method: op.method,
      url: `https://${host}${path}${qs}`,
      headers,
      ...(body !== undefined ? { body } : {}),
      auth,
      maxResponseBytes: this.#deps.maxResponseBytes ?? 65_536,
    };
  }

  /** The credential as the service expects it, wrapped so it never prints (FR-CONN-03). */
  #inject(spec: ConnectorSpec, secret: CredentialSecret): ConnectorRequest["auth"] | undefined {
    switch (secret.kind) {
      case "oauth2":
        return { in: "header", name: "Authorization", value: new Secret(`Bearer ${secret.accessToken}`) };
      case "api_key": {
        const a = spec.auth.find((x) => x.type === "api_key");
        if (!a || a.type !== "api_key") return undefined;
        return { in: a.in, name: a.name, value: new Secret(`${a.prefix ?? ""}${secret.key}`) };
      }
      case "basic":
        if (!spec.auth.some((x) => x.type === "basic")) return undefined;
        return { in: "header", name: "Authorization", value: new Secret(`Basic ${utf8ToBase64(`${secret.username}:${secret.password}`)}`) };
    }
  }

  #oauthProvider(spec: ConnectorSpec): OAuthProvider | undefined {
    for (const a of spec.auth) if (a.type === "oauth2_pkce" || a.type === "relay" || a.type === "oauth2_dcr") return this.#providers[a.provider];
    return undefined;
  }

  #needsRefresh(meta: CredentialMeta, secret: CredentialSecret): boolean {
    return needsRefresh(meta, secret, this.#deps.now());
  }

  /** Refreshes from the phone for public clients. Relay-issued tokens are not refreshed: the relay only swaps codes (FR-CONN-07, SL-57, Q116), so sign in again. */
  #refresh(spec: ConnectorSpec, meta: CredentialMeta, secret: CredentialSecret): Promise<{ meta: CredentialMeta; secret: CredentialSecret } | undefined> {
    return refreshOAuthCredential(this.#deps, this.#oauthProvider(spec), meta, secret);
  }

  /**
   * SL-55: the test call before install. One read that needs no arguments, with the key the user entered, so a wrong
   * sign-in fails closed (401 or 403) on the review card instead of on first use. Never a write; never marks the key used.
   */
  async probe(installed: InstalledConnector, operation: string): Promise<ProbeResult> {
    const { spec } = installed;
    const op = spec.operations.find((o) => o.name === operation);
    if (!op || !isProbe(op)) return "not_testable";
    const secret = await this.#deps.credentials.reveal(installed.credentialId);
    if (!secret) return "no_key";
    const auth = this.#inject(spec, secret);
    if (!auth) return "no_key";
    const path = resolvePath(op.path, {});
    if (path === undefined) return "not_testable";
    try {
      const res = await this.#deps.transport.send(this.#request(spec, op, op.host ?? (spec.hosts[0] as string), path, {}, auth));
      if (res.status === 401 || res.status === 403) return "refused";
      return res.status < 300 ? "ok" : "error";
    } catch {
      return "unreachable";
    }
  }

  /** Every connected account for the Connections screen (US-CONN-02). No secrets. */
  async connections(specs: readonly ConnectorSpec[]): Promise<ConnectionInfo[]> {
    const metas = await this.#deps.credentials.list();
    return metas.map((m) => ({
      credentialId: m.id,
      connectorId: m.connectorId,
      service: specs.find((s) => s.id === m.connectorId)?.name ?? m.connectorId,
      ...(m.account !== undefined ? { account: m.account } : {}),
      scopes: m.scopes,
      ...(m.lastUsedAt !== undefined ? { lastUsedAt: m.lastUsedAt } : {}),
      source: m.source,
    }));
  }

  /**
   * Deletes the tokens, then revokes them at the provider where it supports revocation (US-CONN-02).
   * Local deletion never waits on the provider: a failed revocation still leaves nothing on the phone.
   */
  async disconnect(credentialId: string, specs: readonly ConnectorSpec[]): Promise<{ deleted: boolean; revoked: "yes" | "unsupported" | "failed" }> {
    const { credentials, transport } = this.#deps;
    const meta = await credentials.get(credentialId);
    if (!meta) return { deleted: false, revoked: "unsupported" };
    const secret = await credentials.reveal(credentialId);
    const deleted = await credentials.delete(credentialId);
    const spec = specs.find((s) => s.id === meta.connectorId);
    const provider = spec && this.#oauthProvider(spec);
    const token = secret?.kind === "oauth2" ? (secret.refreshToken ?? secret.accessToken) : undefined;
    const request = provider && token ? revokeRequest(provider, token) : undefined;
    if (!request) return { deleted, revoked: "unsupported" };
    try {
      const res = await transport.send(request);
      return { deleted, revoked: res.status < 400 ? "yes" : "failed" };
    } catch {
      return { deleted, revoked: "failed" };
    }
  }

  /** What HM-CONN-02 shows before connecting: every host, and each operation with its risk. */
  details(spec: ConnectorSpec, overrides?: InstalledConnector["riskOverrides"]): ConnectorDetails {
    return {
      id: spec.id,
      name: spec.name,
      hosts: [...spec.hosts],
      signIn: spec.auth.map((a) => a.type),
      operations: spec.operations.map((op) => ({
        name: op.name,
        title: op.title,
        risk: effectiveRisk(op, overrides?.[op.name]),
        effect: op.effect,
        destructive: op.destructive,
        scopes: [...op.scopes],
      })),
    };
  }
}
