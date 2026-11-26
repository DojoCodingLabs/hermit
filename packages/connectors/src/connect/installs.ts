// SL-55 (US-CONN-04, US-CONN-05, US-CONN-06, HM-CONN-04): "connect me to X". Discovery tries, in order, a bundled
// catalog connector, an MCP server the service publishes, an OpenAPI document (no model), and last a draft the phone
// model writes from a short doc excerpt (the SL-52 verdict). Whatever the source, the user reviews it on HM-CONN-04,
// enters the key, passes a test call, and installs it with a fingerprint; the spec hash goes to the signed log. Nothing
// read can install: only these screen calls change the installed list, and no skill reaches them.
import { RISKS, type CredentialSecret, type CredentialStorePort, type Risk } from "@hermit/core";
import { builtInCatalog } from "../catalog.ts";
import { getChecked, postChecked, type McpTransport } from "../mcp/http.ts";
import { routeMcpTools, MAX_MCP_TOOLS_PER_TURN } from "../mcp/servers.ts";
import { parseHttpsUrl, type HttpsUrl } from "../mcp/url.ts";
import { ConnectorRuntime, isProbe, skillIdFor, type ConnectorSkill, type InstalledConnector, type ProbeResult } from "../runtime.ts";
import { effectiveRisk, pathParams, riskFloor, specHash, validateSpec, type AuthSpec, type ConnectorSpec } from "../spec.ts";
import type { ConnectorTransport } from "../transport.ts";
import { docUrls, excerptProblem, readingOf, signInToAuth, type GuardHit, type OpNote, type SignInReading, type Skipped } from "./derive.ts";
import { draftFromDocs, type DraftEngine } from "./draft.ts";
import { KNOWN_MCP_SERVERS, type KnownMcpServer } from "./known.ts";
import { importOpenApi } from "./openapi.ts";

/**
 * Where the request came from: the user's typing or pasting on HM-CONN-04, or the chat's offer the user tapped (the
 * service name in the user's own words). Never a page, a message, a tool result or the model on its own.
 */
export type ConnectOrigin = "typed" | "pasted" | "chat";
export type ConnectSource = "catalog" | "openapi" | "drafted";

export type ConnectProblem =
  | "not_user_entered" | "bad_url" | "unreachable" | "empty" | "too_long" | "too_large" | "drafting_unavailable" | "unreadable"
  | "not_https" | "no_server" | "sign_in_unsupported" | "no_operations" | "invalid" | "unknown_draft";

export type InstallProblem = "unknown_draft" | "sign_in_unavailable" | "no_key" | "not_tested" | "skill_id_clash" | "not_confirmed";

/** The longest skill id a connector operation may have on the menu. */
const MAX_SKILL_ID = 64;

export interface ReviewOp {
  name: string;
  title: string;
  method: string;
  path: string;
  args: Array<{ name: string; in: "path" | "query" | "body"; type: string; required: boolean }>;
  /** Code's risk; the user may raise it, never lower it. */
  risk: Risk;
  reason: string;
  destructive: boolean;
  /** The doc's own words that raised the risk (money or sending). */
  guard: GuardHit[];
}

/** HM-CONN-04: everything the user approves. Labels the source wrote are cleaned by code; the rest is code's. */
export interface ConnectReview {
  draftId: string;
  source: ConnectSource;
  name: string;
  hosts: string[];
  /** A drafted spec is "Made by Hermit" until the user has used it. */
  madeByHermit: boolean;
  /** Where the docs came from: someone else's text, read by a quarantined model call. */
  docHost?: string;
  /** A connector with this id is installed; installing replaces it (a new fingerprint, a new hash in the log). */
  replaces: boolean;
  signIn: {
    reading?: SignInReading;
    /** False when this connector only signs in in a way HM-CONN-04 can't do yet (OAuth from the catalog, Q43). */
    available: boolean;
    /** Drafted specs only: the user may pick another sign-in kind, with a name or prefix from `words`. */
    changeable: boolean;
    words: string[];
    needs: "key" | "basic" | "none";
  };
  operations: ReviewOp[];
  /** Reads the test call can run (a GET with no required argument). Empty: no test call is possible (Q119). */
  testable: string[];
  keySaved: boolean;
  tested?: { operation: string; result: ProbeResult };
  skipped: Skipped[];
  /** How many fixes code made to the model's draft. */
  repairs: number;
  specHash: string;
}

export type ConnectStep =
  | { kind: "review"; review: ConnectReview }
  /** Step 2: hand the address to HM-CONN-03, where the user adds it. */
  | { kind: "mcp"; name: string; serverUrl: string }
  /** Nothing known by that name: ask for a docs link or an excerpt; with no API, the vault and the browser (US-CONN-07). */
  | { kind: "need_docs" }
  | { kind: "refused"; problem: ConnectProblem };

export type ConnectReviewResult = { kind: "review"; review: ConnectReview } | { kind: "refused"; problem: ConnectProblem | "sign_in_not_in_doc" | "not_changeable" | "bad_key" };

/** An installed connector, as stored. Holds no secret: the key lives only in the credential store. */
export interface InstalledRecord extends InstalledConnector {
  source: ConnectSource;
  installedAt: number;
  docHost?: string;
  tested: "ok" | "untested";
  usedAt?: number;
  lastUsedAt?: number;
}

export interface InstalledStorePort {
  load(): Promise<InstalledRecord[]>;
  save(records: InstalledRecord[]): Promise<void>;
}

export class MemoryInstalledStore implements InstalledStorePort {
  #json = "[]";
  async load(): Promise<InstalledRecord[]> {
    return JSON.parse(this.#json) as InstalledRecord[];
  }
  async save(records: InstalledRecord[]): Promise<void> {
    this.#json = JSON.stringify(records);
  }
}

export interface InstalledView {
  id: string;
  name: string;
  hosts: string[];
  source: ConnectSource;
  madeByHermit: boolean;
  /** The stored spec no longer matches the approved hash: off until approved again. */
  changed: boolean;
  enabled: string[];
  tested: "ok" | "untested";
  installedAt: number;
  lastUsedAt?: number;
  operations: Array<{ name: string; title: string; method: string; path: string; risk: Risk; destructive: boolean; enabled: boolean }>;
}

export interface ConnectDeps {
  /** The app's HTTPS adapter (counted for the privacy screen); every address passes the strict checks here first. */
  transport: McpTransport;
  credentials: CredentialStorePort;
  store: InstalledStorePort;
  now(): number;
  random(bytes: number): Uint8Array;
  /** The phone model, for step 4. Without it, drafting is refused. */
  engine?: DraftEngine;
  /** A fetched page's readable text (HTML to text). */
  pageText(body: string, contentType: string): string;
  /** The fingerprint the install needs. False: nothing is installed. */
  confirm(): Promise<boolean>;
  /** The signed log: the spec hash on install and removal (codes and a hash only). */
  log(entry: { reason: "connector.installed" | "connector.removed"; specHash: string }): Promise<void>;
  catalog?: readonly ConnectorSpec[];
  knownMcp?: readonly KnownMcpServer[];
  /** Skill ids already on the menu (the built-ins): no connector operation may take one. */
  reservedSkillIds?(): Iterable<string>;
}

type Draft = {
  id: string;
  createdAt: number;
  source: ConnectSource;
  spec: ConnectorSpec;
  notes: OpNote[];
  skipped: Skipped[];
  repairs: number;
  docHost?: string;
  /** Drafted only: the doc's words, the only names and prefixes a sign-in may use. */
  docWords?: string[];
  credentialId?: string;
  tested?: { hash: string; operation: string; result: ProbeResult };
};

const ORIGINS: ReadonlySet<string> = new Set<ConnectOrigin>(["typed", "pasted", "chat"]);
/** A docs page or OpenAPI document read for a draft. */
export const MAX_FETCH_BYTES = 600 * 1024;
const DRAFT_TTL_MS = 30 * 60_000;
const MAX_KEY = 4096;
const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
const fold = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
const words = (s: string) => fold(s).split(/[^a-z0-9]+/).filter(Boolean);
const domainOf = (host: string) => host.split(".").slice(-2).join(".");

/** Whether the words of `phrase` appear together, in order, in `text`. */
function says(text: string, phrase: string): boolean {
  const t = words(text);
  const p = words(phrase);
  if (!p.length) return false;
  return t.some((_, i) => p.every((w, j) => t[i + j] === w)) || (p.length > 1 && t.includes(p.join("")));
}

/** Runs installed connectors over the strict HTTPS checks: no redirect is ever followed and every address is checked. */
export function checkedTransport(transport: McpTransport): ConnectorTransport {
  return {
    async send(req) {
      const r = await postChecked(transport, req);
      if (!r.ok) throw new Error(r.problem);
      return { status: r.res.status, body: r.res.body };
    },
  };
}

export class ConnectorInstalls {
  readonly #deps: ConnectDeps;
  readonly #runtime: ConnectorRuntime;
  readonly #drafts = new Map<string, Draft>();
  /** The chat's offers (connect_service), in memory only: a one-time id for the user's own words that turn. */
  readonly #offers = new Map<string, { request: string; at: number }>();

  /**
   * Records what the chat offered, for the one tap that opens HM-CONN-04 from it. Only the runtime's connect_service
   * calls this, with a service already checked against the user's own words.
   */
  offer(request: string): string {
    const id = `o${hex(this.#deps.random(12))}`;
    this.#offers.set(id, { request: request.trim(), at: this.#deps.now() });
    // Keep only the newest few: an offer is used right away or not at all.
    while (this.#offers.size > 10) this.#offers.delete(this.#offers.keys().next().value as string);
    return id;
  }

  /** Skill ids taken by the built-in menu and installed connectors, other than `exceptSpec`'s own. */
  async #takenIds(exceptSpec?: string): Promise<Set<string>> {
    const taken = new Set(this.#deps.reservedSkillIds?.() ?? []);
    for (const rec of await this.#deps.store.load()) {
      if (rec.spec.id === exceptSpec) continue;
      for (const op of rec.spec.operations ?? []) taken.add(skillIdFor(rec.spec, op));
    }
    return taken;
  }

  constructor(deps: ConnectDeps) {
    this.#deps = deps;
    this.#runtime = new ConnectorRuntime({ credentials: deps.credentials, transport: checkedTransport(deps.transport), now: deps.now });
  }

  /**
   * HM-CONN-04's one input: a service name, a docs or OpenAPI link, or a pasted excerpt. Tries the four sources in order
   * and stops at the first that answers. Nothing is stored and no key is asked for yet.
   */
  async start(input: { text: string; origin: ConnectOrigin; offerId?: string }): Promise<ConnectStep> {
    if (!ORIGINS.has(input.origin as string)) return { kind: "refused", problem: "not_user_entered" };
    if (input.origin === "chat") {
      // Chat provenance is only ever an offer this runtime made, for exactly those words, used once. A deep link
      // (hermit://connect?request=...) carries no such id, so the screen treats it as the user's own typing.
      const offered = input.offerId !== undefined ? this.#offers.get(input.offerId) : undefined;
      if (input.offerId !== undefined) this.#offers.delete(input.offerId);
      if (!offered || offered.request !== String(input.text ?? "").trim() || this.#deps.now() - offered.at > DRAFT_TTL_MS) return { kind: "refused", problem: "not_user_entered" };
    }
    await this.#sweep();
    const text = String(input.text ?? "").trim();
    if (!text) return { kind: "refused", problem: "empty" };
    const oneToken = !/\s/.test(text);
    if (oneToken && /^[a-z][a-z0-9+.-]*:\/\//i.test(text)) {
      const url = parseHttpsUrl(text);
      return url ? this.#fromUrl(url) : { kind: "refused", problem: "bad_url" };
    }
    if (text.includes("\n") || text.length > 200) return this.#fromExcerpt(text);
    return this.#byName(text) ?? { kind: "need_docs" };
  }

  /** Drafted specs: the user picks another sign-in kind; a header name or prefix must be words the doc wrote. */
  async setSignIn(draftId: string, reading: SignInReading): Promise<ConnectReviewResult> {
    const d = await this.#draft(draftId);
    if (!d) return { kind: "refused", problem: "unknown_draft" };
    if (d.source !== "drafted" || !d.docWords) return { kind: "refused", problem: "not_changeable" };
    const auth = signInToAuth(reading, d.docWords);
    if (!auth) return { kind: "refused", problem: "sign_in_not_in_doc" };
    const before = signInOf(d.spec);
    d.spec = { ...d.spec, auth: [auth] };
    delete d.tested;
    // A key saved for another kind (a key versus a user name and password) no longer fits.
    if (d.credentialId && before.needs !== needsOf(auth)) await this.#dropKey(d);
    return { kind: "review", review: this.#review(d) };
  }

  /** The key the user typed, kept only in the credential store. A new key needs a new test call. */
  async saveKey(draftId: string, secret: { key: string } | { username: string; password: string }): Promise<ConnectReviewResult> {
    const d = await this.#draft(draftId);
    if (!d) return { kind: "refused", problem: "unknown_draft" };
    const s = signInOf(d.spec);
    let value: CredentialSecret;
    if (s.needs === "key" && "key" in secret && secret.key.trim() && secret.key.length <= MAX_KEY) value = { kind: "api_key", key: secret.key.trim() };
    else if (s.needs === "basic" && "username" in secret && secret.username && secret.username.length + secret.password.length <= MAX_KEY) value = { kind: "basic", username: secret.username, password: secret.password };
    else return { kind: "refused", problem: "bad_key" };
    const id = d.credentialId ?? `conn-${hex(this.#deps.random(8))}`;
    await this.#deps.credentials.save({ id, connectorId: d.spec.id, kind: value.kind, source: "user_entered", scopes: [], createdAt: this.#deps.now() }, value);
    d.credentialId = id;
    delete d.tested;
    return { kind: "review", review: this.#review(d) };
  }

  /** The test call: one read with the user's key. A wrong sign-in fails closed and shows here. */
  async testCall(draftId: string, operation?: string): Promise<{ result: ProbeResult | "unknown_draft" }> {
    const d = await this.#draft(draftId);
    if (!d) return { result: "unknown_draft" };
    const op = operation ?? testable(d.spec)[0];
    if (!op || !testable(d.spec).includes(op)) return { result: "not_testable" };
    if (!d.credentialId) return { result: "no_key" };
    const hash = specHash(d.spec);
    const result = await this.#runtime.probe({ spec: d.spec, approvedHash: hash, enabled: [op], credentialId: d.credentialId }, op);
    d.tested = { hash, operation: op, result };
    return { result };
  }

  /**
   * The user's yes: the operations they turned on, risks they raised. Needs the key, a passing test call when one is
   * possible, and a fingerprint. Only then is the spec stored and its hash signed into the log.
   */
  async install(draftId: string, choice: { enabled: readonly string[]; raised?: Partial<Record<string, Risk>> }): Promise<{ ok: true; connector: InstalledView } | { ok: false; problem: InstallProblem }> {
    const d = await this.#draft(draftId);
    if (!d) return { ok: false, problem: "unknown_draft" };
    if (!signInOf(d.spec).available) return { ok: false, problem: "sign_in_unavailable" };
    if (!d.credentialId) return { ok: false, problem: "no_key" };
    const hash = specHash(d.spec);
    const canTest = testable(d.spec).length > 0;
    if (canTest && !(d.tested && d.tested.hash === hash && d.tested.result === "ok")) return { ok: false, problem: "not_tested" };
    // No operation may take a skill id another skill already has: it would shadow it on the menu.
    const taken = await this.#takenIds(d.spec.id);
    const ids = d.spec.operations.map((op) => skillIdFor(d.spec, op));
    if (ids.some((id) => taken.has(id) || id.length > MAX_SKILL_ID)) return { ok: false, problem: "skill_id_clash" };
    if (!(await this.#deps.confirm())) return { ok: false, problem: "not_confirmed" };

    const names = new Set(d.spec.operations.map((o) => o.name));
    const riskOverrides: Partial<Record<string, Risk>> = {};
    for (const [name, r] of Object.entries(choice.raised ?? {})) if (names.has(name) && r && (RISKS as readonly string[]).includes(r)) riskOverrides[name] = r;
    const record: InstalledRecord = {
      spec: d.spec,
      approvedHash: hash,
      enabled: choice.enabled.filter((n) => names.has(n)),
      riskOverrides,
      credentialId: d.credentialId,
      source: d.source,
      installedAt: this.#deps.now(),
      ...(d.docHost ? { docHost: d.docHost } : {}),
      tested: canTest ? "ok" : "untested",
    };
    const all = await this.#deps.store.load();
    const old = all.find((r) => r.spec.id === d.spec.id);
    if (old && old.credentialId !== record.credentialId) await this.#deps.credentials.delete(old.credentialId);
    await this.#deps.store.save([...all.filter((r) => r.spec.id !== d.spec.id), record]);
    this.#drafts.delete(d.id);
    await this.#deps.log({ reason: "connector.installed", specHash: hash });
    return { ok: true, connector: view(record) };
  }

  /** The user backed out: the draft goes, and so does any key it saved. */
  async cancel(draftId: string): Promise<void> {
    const d = this.#drafts.get(draftId);
    this.#drafts.delete(draftId);
    if (d) await this.#dropKey(d);
  }

  async list(): Promise<InstalledView[]> {
    return (await this.#deps.store.load()).map(view);
  }

  /** Turns one operation on or off. Off takes it off the menu at once. */
  async setOperation(id: string, name: string, enabled: boolean): Promise<boolean> {
    const all = await this.#deps.store.load();
    const rec = all.find((r) => r.spec.id === id);
    if (!rec || !rec.spec.operations.some((o) => o.name === name)) return false;
    rec.enabled = enabled ? [...new Set([...rec.enabled, name])] : rec.enabled.filter((n) => n !== name);
    await this.#deps.store.save(all);
    return true;
  }

  /** Removes a connector: its key is deleted from the phone, its record goes, and the log says so. */
  async remove(id: string): Promise<boolean> {
    const all = await this.#deps.store.load();
    const rec = all.find((r) => r.spec.id === id);
    if (!rec) return false;
    await this.#deps.credentials.delete(rec.credentialId);
    await this.#deps.store.save(all.filter((r) => r !== rec));
    await this.#deps.log({ reason: "connector.removed", specHash: rec.approvedHash });
    return true;
  }

  /**
   * The installed operations on the model's menu this turn: enabled, unchanged, routed by the user's words, capped.
   * Each runs through the cage like any skill; its result is untrusted.
   */
  async skillsForTurn(input: { userText: string; cap?: number }): Promise<ConnectorSkill[]> {
    const records = await this.#deps.store.load();
    const reserved = new Set(this.#deps.reservedSkillIds?.() ?? []);
    const seen = new Set<string>();
    const candidates = records.flatMap((rec) => {
      const { skills } = this.#runtime.skillsFor(rec);
      // Defense in depth: an id a built-in or an earlier connector already has never reaches the menu.
      const usable = skills.filter((s) => {
        const id = s.def.id as string;
        if (reserved.has(id) || seen.has(id)) return false;
        seen.add(id);
        return true;
      });
      return usable.map((skill) => ({ serverId: rec.spec.id, host: rec.spec.hosts[0] ?? "", name: skill.operation, ...(rec.lastUsedAt !== undefined ? { lastUsedAt: rec.lastUsedAt } : {}), skill }));
    });
    return routeMcpTools(input.userText, candidates, input.cap ?? MAX_MCP_TOOLS_PER_TURN).map(({ skill, serverId }) => ({
      ...skill,
      execute: async (args, ctx) => {
        const r = await skill.execute(args, ctx);
        if (r.ok) await this.#markUsed(serverId);
        return r;
      },
    }));
  }

  async #markUsed(id: string): Promise<void> {
    const all = await this.#deps.store.load();
    const rec = all.find((r) => r.spec.id === id);
    if (!rec) return;
    rec.lastUsedAt = this.#deps.now();
    rec.usedAt ??= rec.lastUsedAt;
    await this.#deps.store.save(all);
  }

  // Step 1 and 2 by name: the catalog, then a known MCP server.
  #byName(text: string): ConnectStep | undefined {
    const spec = (this.#deps.catalog ?? builtInCatalog).find((s) => says(text, s.name));
    if (spec) return this.#catalogReview(spec);
    const mcp = (this.#deps.knownMcp ?? KNOWN_MCP_SERVERS).find((s) => s.words.some((w) => says(text, w)));
    if (mcp) return { kind: "mcp", name: mcp.name, serverUrl: mcp.url };
    return undefined;
  }

  // Step 1 and 2 by a host: a link the user pasted, or the base URL a pasted excerpt names.
  #byHost(host: string): ConnectStep | undefined {
    const domain = domainOf(host);
    const spec = (this.#deps.catalog ?? builtInCatalog).find((s) => s.hosts.some((h) => h === host || domainOf(h) === domain));
    if (spec) return this.#catalogReview(spec);
    const mcp = (this.#deps.knownMcp ?? KNOWN_MCP_SERVERS).find((s) => s.domains.includes(domain));
    if (mcp) return { kind: "mcp", name: mcp.name, serverUrl: mcp.url };
    return undefined;
  }

  async #fromUrl(url: HttpsUrl): Promise<ConnectStep> {
    const known = this.#byHost(url.host);
    if (known) return known;
    const page = await this.#fetch(url.href);
    if (!page.ok) return { kind: "refused", problem: page.problem };
    // Step 3: the link itself is an OpenAPI document, or the host publishes one at /openapi.json.
    const asApi = this.#openApi(page.body, url.host);
    if (asApi) return asApi;
    if (url.path !== "/openapi.json") {
      const probe = await this.#fetch(`${url.origin}/openapi.json`);
      if (probe.ok) {
        const found = this.#openApi(probe.body, url.host);
        if (found && found.kind === "review") return found;
      }
    }
    // Step 4: the page's text, drafted by the phone model if it is short enough.
    const text = /html/i.test(page.contentType) ? this.#deps.pageText(page.body, page.contentType) : page.body;
    return this.#draftStep(text, url.host);
  }

  async #fromExcerpt(text: string): Promise<ConnectStep> {
    for (const u of docUrls(text)) {
      const url = parseHttpsUrl(u);
      const known = url && this.#byHost(url.host);
      if (known) return known;
    }
    const asApi = this.#openApi(text, undefined);
    if (asApi) return asApi;
    return this.#draftStep(text, undefined);
  }

  /** A review when `body` is an OpenAPI 3 document; a refusal when it is one Hermit can't use; else undefined. */
  #openApi(body: string, sourceHost: string | undefined): ConnectStep | undefined {
    if (!body.trimStart().startsWith("{")) return undefined;
    const r = importOpenApi(body, sourceHost ? { sourceHost } : {});
    if (!r.ok) return r.problem === "not_openapi" ? undefined : { kind: "refused", problem: r.problem };
    return { kind: "review", review: this.#review(this.#newDraft({ source: "openapi", spec: r.spec, notes: r.ops, skipped: r.skipped, repairs: 0, ...(sourceHost ? { docHost: sourceHost } : {}) })) };
  }

  async #draftStep(text: string, docHost: string | undefined): Promise<ConnectStep> {
    const problem = excerptProblem(text);
    if (problem) return { kind: "refused", problem };
    if (!this.#deps.engine) return { kind: "refused", problem: "drafting_unavailable" };
    const r = await draftFromDocs(this.#deps.engine, text);
    if (!r.ok) return { kind: "refused", problem: r.problem };
    const d = this.#newDraft({ source: "drafted", spec: r.spec, notes: r.ops, skipped: r.skipped, repairs: r.repairs.length, docWords: r.docWords, ...(docHost ? { docHost } : {}) });
    return { kind: "review", review: this.#review(d) };
  }

  #catalogReview(spec: ConnectorSpec): ConnectStep {
    const notes = spec.operations.map((op) => ({ name: op.name, reason: riskFloor(op).reason, guard: [] }));
    return { kind: "review", review: this.#review(this.#newDraft({ source: "catalog", spec, notes, skipped: [], repairs: 0 })) };
  }

  #newDraft(d: Omit<Draft, "id" | "createdAt">): Draft {
    const draft: Draft = { ...d, id: `c${hex(this.#deps.random(6))}`, createdAt: this.#deps.now() };
    this.#drafts.set(draft.id, draft);
    return draft;
  }

  async #fetch(url: string): Promise<{ ok: true; body: string; contentType: string } | { ok: false; problem: "bad_url" | "unreachable" }> {
    const r = await getChecked(this.#deps.transport, url, { maxBytes: MAX_FETCH_BYTES, accept: "application/json, text/html;q=0.9, text/plain;q=0.8" });
    if (!r.ok) return { ok: false, problem: r.problem === "blocked_url" ? "bad_url" : "unreachable" };
    if (r.res.status >= 300) return { ok: false, problem: "unreachable" };
    return { ok: true, body: r.res.body, contentType: r.res.headers["content-type"] ?? "" };
  }

  #review(d: Draft): ConnectReview {
    const s = signInOf(d.spec);
    const reading = s.auth ? readingOf(s.auth) : undefined;
    return {
      draftId: d.id,
      source: d.source,
      name: d.spec.name,
      hosts: [...d.spec.hosts],
      madeByHermit: d.source === "drafted",
      ...(d.docHost ? { docHost: d.docHost } : {}),
      replaces: this.#installedIds.has(d.spec.id),
      signIn: {
        ...(reading ? { reading } : {}),
        available: s.available,
        changeable: d.source === "drafted",
        words: d.source === "drafted" ? signInWords(d.docWords ?? []) : [],
        needs: s.needs,
      },
      operations: d.spec.operations.map((op) => {
        const note = d.notes.find((n) => n.name === op.name);
        const inPath = new Set(pathParams(op.path));
        const inBody = new Set(Object.values(op.body ?? {}));
        const schema = op.inputSchema as { properties?: Record<string, { type?: string }>; required?: string[] };
        return {
          name: op.name,
          title: op.title,
          method: op.method,
          path: op.path,
          args: Object.entries(schema.properties ?? {}).map(([name, p]) => ({
            name,
            in: inPath.has(name) ? "path" as const : inBody.has(name) || (!op.body && op.method !== "GET" && op.method !== "DELETE") ? "body" as const : "query" as const,
            type: typeof p.type === "string" ? p.type : "string",
            required: (schema.required ?? []).includes(name),
          })),
          risk: effectiveRisk(op),
          reason: note?.reason ?? riskFloor(op).reason,
          destructive: op.destructive,
          guard: note?.guard ?? [],
        };
      }),
      testable: testable(d.spec),
      keySaved: d.credentialId !== undefined,
      ...(d.tested && d.tested.hash === specHash(d.spec) ? { tested: { operation: d.tested.operation, result: d.tested.result } } : {}),
      skipped: d.skipped,
      repairs: d.repairs,
      specHash: specHash(d.spec),
    };
  }

  /** Ids installed now, refreshed before each review is built (see #draft). */
  #installedIds = new Set<string>();

  async #draft(id: string): Promise<Draft | undefined> {
    await this.#sweep();
    return this.#drafts.get(id);
  }

  async #dropKey(d: Draft): Promise<void> {
    if (!d.credentialId) return;
    await this.#deps.credentials.delete(d.credentialId);
    delete d.credentialId;
  }

  /** Drafts older than half an hour go, with any key they saved; the installed ids are refreshed for `replaces`. */
  async #sweep(): Promise<void> {
    for (const d of [...this.#drafts.values()]) if (this.#deps.now() - d.createdAt > DRAFT_TTL_MS) await this.cancel(d.id);
    this.#installedIds = new Set((await this.#deps.store.load()).map((r) => r.spec.id));
  }
}

const needsOf = (a: AuthSpec | undefined): "key" | "basic" | "none" => (a?.type === "api_key" ? "key" : a?.type === "basic" ? "basic" : "none");

/** The sign-in HM-CONN-04 can do for a spec: the first API key or Basic entry (OAuth catalog connectors need Q43). */
function signInOf(spec: ConnectorSpec): { auth?: AuthSpec; available: boolean; needs: "key" | "basic" | "none" } {
  const auth = spec.auth.find((a) => a.type === "api_key" || a.type === "basic");
  return { ...(auth ? { auth } : {}), available: auth !== undefined, needs: needsOf(auth) };
}

/** Header-like words from the doc the user may pick as a name or prefix (short, letters, digits and dashes). */
function signInWords(docWords: readonly string[]): string[] {
  return docWords.filter((w) => /^[A-Za-z][A-Za-z0-9_-]{1,40}$/.test(w)).slice(0, 200);
}

function testable(spec: ConnectorSpec): string[] {
  return spec.operations.filter(isProbe).map((o) => o.name);
}

function view(r: InstalledRecord): InstalledView {
  const valid = validateSpec(r.spec, { trust: r.source === "catalog" ? "bundled" : "untrusted" }).length === 0;
  return {
    id: r.spec.id,
    name: r.spec.name,
    hosts: [...r.spec.hosts],
    source: r.source,
    madeByHermit: r.source === "drafted" && r.usedAt === undefined,
    changed: !valid || specHash(r.spec) !== r.approvedHash,
    enabled: [...r.enabled],
    tested: r.tested,
    installedAt: r.installedAt,
    ...(r.lastUsedAt !== undefined ? { lastUsedAt: r.lastUsedAt } : {}),
    operations: r.spec.operations.map((op) => ({
      name: op.name, title: op.title, method: op.method, path: op.path, risk: effectiveRisk(op, r.riskOverrides?.[op.name]), destructive: op.destructive, enabled: r.enabled.includes(op.name),
    })),
  };
}
