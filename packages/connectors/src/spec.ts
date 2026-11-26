import { ed25519 } from "@noble/curves/ed25519.js";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils.js";
import { canonicalJson, RISKS, sha256Hex, type JsonSchema, type Risk } from "@hermit/core";
import { oauthProviders, type OAuthProvider } from "./oauth-providers.ts";

export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
export type OperationEffect = "read" | "write" | "delete";
/** What a call changes, from a fixed list, so code can derive a risk floor (FR-CONN-04). */
export type SideEffect = "creates" | "updates" | "deletes" | "sends" | "moves_money" | "uses_credential";
export type ConnectorDomain =
  | "calendar" | "files" | "email" | "messaging" | "music" | "tasks" | "notes" | "contacts" | "code" | "payments" | "credentials" | "other";
export type SpecOrigin = "shipped" | "registry" | "openapi" | "drafted";

/**
 * How a connector signs in (CT-12 `auth`). A spec lists every type it accepts, in order of preference
 * (Notion: a relay sign-in or an integration token).
 */
export type AuthSpec =
  | { type: "oauth2_pkce"; provider: string }
  | { type: "oauth2_dcr"; provider: string }
  | { type: "relay"; provider: string }
  | { type: "api_key"; in: "header" | "query"; name: string; prefix?: string }
  | { type: "basic" };

/** The fixed transform set (CT-12): specs shape requests and results with these, never with code. */
export type Transform =
  | { kind: "static_header"; name: string; value: string }
  | { kind: "pick_fields"; operation: string; list?: string; fields: string[] };

export interface OperationSpec {
  /** snake_case; the skill id is `<connector id>_<name>`. */
  name: string;
  /** Short label for the approval sheet and the details screen. */
  title: string;
  /** What the model sees: when to use it and what it changes (whether a retry duplicates). */
  description: string;
  sideEffects: SideEffect[];
  method: HttpMethod;
  /** Required when the spec has more than one host. */
  host?: string;
  /** Path template, `{arg}` placeholders filled from required arguments and URL-encoded. */
  path: string;
  inputSchema: JsonSchema;
  /**
   * Where body arguments go: dotted body path to argument name. Without it, arguments not used in the path
   * are the JSON body (writes) or the query string (reads).
   */
  body?: Record<string, string>;
  scopes: string[];
  effect: OperationEffect;
  destructive: boolean;
  idempotent: boolean;
  domain: ConnectorDomain;
  risk: Risk;
}

/** CT-12. The hash of the canonical spec (without the signature) is its identity (FR-CONN-08). */
export interface ConnectorSpec {
  id: string;
  version: number;
  name: string;
  hosts: string[];
  auth: AuthSpec[];
  operations: OperationSpec[];
  transforms: Transform[];
  origin: SpecOrigin;
  /** Dojo Coding's Ed25519 signature over the spec hash, hex (FR-CONN-01). */
  signature?: string;
}

const RANK: Record<Risk, number> = { read: 0, local_write: 1, network: 2, remote_write: 3, send: 4, credential: 5, spend: 6 };

export function maxRisk(...risks: Risk[]): Risk {
  return risks.reduce((a, b) => (RANK[b] > RANK[a] ? b : a), "read");
}

export function riskAtLeast(risk: Risk, floor: Risk): boolean {
  return RANK[risk] >= RANK[floor];
}

/**
 * The lowest risk an operation may carry, from its own effect, side effects and domain (FR-CONN-04).
 * A read still leaves the phone, so it is `network` (the risk matrix lists connector reads there).
 */
export function riskFloor(op: Pick<OperationSpec, "effect" | "sideEffects" | "domain">): { risk: Risk; reason: string } {
  const floors: Array<[Risk, string]> = [op.effect === "read" ? ["network", "it reads from the network"] : ["remote_write", "it changes something off the phone"]];
  if (op.sideEffects.includes("sends")) floors.push(["send", "it sends in the user's name"]);
  if (op.sideEffects.includes("moves_money")) floors.push(["spend", "it moves money"]);
  if (op.sideEffects.includes("uses_credential")) floors.push(["credential", "it uses a credential"]);
  if (op.domain === "payments" && op.effect !== "read") floors.push(["spend", "it changes payments"]);
  if (op.domain === "credentials") floors.push(["credential", "it touches credentials"]);
  const [risk, reason] = floors.reduce((a, b) => (RANK[b[0]] > RANK[a[0]] ? b : a));
  return { risk, reason };
}

/** The risk the cage sees: the spec's, never below the floor, raised (never lowered) by the user's override. */
export function effectiveRisk(op: OperationSpec, override?: Risk): Risk {
  return maxRisk(op.risk, riskFloor(op).risk, ...(override ? [override] : []));
}

const ID = /^[a-z][a-z0-9_]{1,39}$/;
const HOST_LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const PRIVATE_SUFFIXES = [".local", ".internal", ".localhost", ".lan", ".home.arpa"];
const METHODS: readonly HttpMethod[] = ["GET", "POST", "PUT", "PATCH", "DELETE"];
const EFFECTS: readonly OperationEffect[] = ["read", "write", "delete"];
const SIDE_EFFECTS: readonly SideEffect[] = ["creates", "updates", "deletes", "sends", "moves_money", "uses_credential"];
const DOMAINS: readonly ConnectorDomain[] = ["calendar", "files", "email", "messaging", "music", "tasks", "notes", "contacts", "code", "payments", "credentials", "other"];
const ORIGINS: readonly SpecOrigin[] = ["shipped", "registry", "openapi", "drafted"];
/** Headers a spec may never set: credentials are injected by the runtime only. */
const FORBIDDEN_HEADERS = new Set(["authorization", "cookie", "set-cookie", "host", "proxy-authorization", "content-length", "transfer-encoding"]);
const HEADER_NAME = /^[A-Za-z0-9-]{1,64}$/;

/** A label some URL parsers read as a number (decimal, octal, hex): "127.1" or "0x7f.0.0.1" can mean an IP. */
const NUMERIC_LABEL = /^(0x[0-9a-f]*|[0-9]+)$/i;
const TLD = /^[a-z]{2,63}$/;

type UrlCtor = new (input: string) => { hostname: string };

/**
 * An exact public DNS name, written the one way every parser agrees on (FR-CONN-02): lowercase letters,
 * digits and hyphens, an alphabetic top-level label, no label that could be read as a number, nothing a
 * URL parser would rewrite, and no local or private name.
 */
export function isPublicHost(host: string): boolean {
  if (host.length > 253 || !host.includes(".")) return false;
  const labels = host.split(".");
  if (!labels.every((l) => HOST_LABEL.test(l))) return false;
  if (labels.some((l) => NUMERIC_LABEL.test(l))) return false;
  if (!TLD.test(labels.at(-1) as string)) return false;
  if (host === "localhost" || PRIVATE_SUFFIXES.some((s) => host.endsWith(s))) return false;
  // Where a WHATWG URL parser exists (Node, the app), the host must survive it unchanged.
  const URLImpl = (globalThis as { URL?: UrlCtor }).URL;
  if (URLImpl) {
    try {
      if (new URLImpl(`https://${host}/`).hostname !== host) return false;
    } catch {
      return false;
    }
  }
  return true;
}

/**
 * Where a spec's trust comes from, decided by the caller and never by the spec's own fields:
 * bundled in the app's catalog, or signed by Dojo Coding's key (FR-CONN-01). Anything else is untrusted,
 * whatever its `origin` says.
 */
export type SpecTrust = "bundled" | "signed" | "untrusted";

export interface ValidateOptions {
  trust?: SpecTrust;
  providers?: Record<string, OAuthProvider>;
}

/** `{name}` placeholders in a path template. */
export function pathParams(path: string): string[] {
  return [...path.matchAll(/\{([^{}]+)\}/g)].map((m) => m[1] as string);
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isStrArr = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === "string");

function validateAuth(auth: unknown, i: number, providers: Record<string, OAuthProvider>, errors: string[]): void {
  const at = `auth[${i}]`;
  if (!isObj(auth)) return void errors.push(`${at} must be an object`);
  switch (auth.type) {
    case "oauth2_pkce":
    case "oauth2_dcr":
    case "relay": {
      const p = typeof auth.provider === "string" ? providers[auth.provider] : undefined;
      if (!p) return void errors.push(`${at} provider "${String(auth.provider)}" is not in the provider table`);
      if (auth.type === "oauth2_pkce" && !(p.publicClient && p.pkce)) errors.push(`${at} provider "${p.id}" needs a client secret: sign in through a relay (PDR-022)`);
      if (auth.type === "oauth2_dcr" && !p.registrationUrl) errors.push(`${at} provider "${p.id}" has no registration URL`);
      if (auth.type === "relay" && p.publicClient) errors.push(`${at} provider "${p.id}" allows PKCE from the phone: no relay needed`);
      return;
    }
    case "api_key":
      if (auth.in !== "header" && auth.in !== "query") errors.push(`${at} in must be header or query`);
      if (typeof auth.name !== "string" || !HEADER_NAME.test(auth.name)) errors.push(`${at} name is invalid`);
      else if (auth.in === "header" && FORBIDDEN_HEADERS.has(auth.name.toLowerCase()) && auth.name.toLowerCase() !== "authorization")
        errors.push(`${at} can't put a key in the ${auth.name} header`);
      if (auth.prefix !== undefined && (typeof auth.prefix !== "string" || auth.prefix.length > 20)) errors.push(`${at} prefix is invalid`);
      return;
    case "basic":
      return;
    default:
      errors.push(`${at} type "${String(auth.type)}" is not a sign-in type`);
  }
}

function validateOperation(op: unknown, i: number, trusted: boolean, hosts: string[], errors: string[]): void {
  const at = `operations[${i}]`;
  if (!isObj(op)) return void errors.push(`${at} must be an object`);
  const name = typeof op.name === "string" && ID.test(op.name) ? op.name : undefined;
  if (!name) errors.push(`${at} name must be snake_case`);
  const o = `operation ${name ?? i}`;
  if (typeof op.title !== "string" || !op.title.trim() || op.title.length > 60) errors.push(`${o}: title must be 1 to 60 characters`);
  if (typeof op.description !== "string" || !op.description.trim() || op.description.length > 280) errors.push(`${o}: description must be 1 to 280 characters`);
  if (!METHODS.includes(op.method as HttpMethod)) errors.push(`${o}: method must be one of ${METHODS.join(", ")}`);
  if (!EFFECTS.includes(op.effect as OperationEffect)) errors.push(`${o}: effect must be read, write or delete`);
  if (!DOMAINS.includes(op.domain as ConnectorDomain)) errors.push(`${o}: domain is not known`);
  if (!RISKS.includes(op.risk as Risk)) errors.push(`${o}: risk is not a risk class`);
  if (typeof op.destructive !== "boolean" || typeof op.idempotent !== "boolean") errors.push(`${o}: destructive and idempotent must be booleans`);
  if (!isStrArr(op.scopes)) errors.push(`${o}: scopes must be a list of strings`);
  const sideEffects = isStrArr(op.sideEffects) && op.sideEffects.every((s) => SIDE_EFFECTS.includes(s as SideEffect)) ? (op.sideEffects as SideEffect[]) : undefined;
  if (!sideEffects) errors.push(`${o}: side effects must come from ${SIDE_EFFECTS.join(", ")}`);

  // Host.
  if (op.host !== undefined) {
    if (typeof op.host !== "string" || !hosts.includes(op.host)) errors.push(`${o}: host must be one of the spec's hosts`);
  } else if (hosts.length > 1) errors.push(`${o}: host is required when the spec has several hosts`);

  // Input schema.
  const schema = op.inputSchema;
  const props = isObj(schema) && isObj(schema.properties) ? schema.properties : undefined;
  const required = isObj(schema) && isStrArr(schema.required ?? []) ? ((schema.required ?? []) as string[]) : [];
  if (!isObj(schema) || schema.type !== "object" || !props) errors.push(`${o}: inputSchema must be an object schema with properties`);
  else if (schema.additionalProperties !== false) errors.push(`${o}: inputSchema must set additionalProperties to false`);

  // Path: a concrete endpoint on the spec's host, never a generic one (FR-CONN-09).
  if (typeof op.path !== "string" || !op.path.startsWith("/") || /[?#\s]|:\/\/|\.\./.test(op.path)) {
    errors.push(`${o}: path must be a plain path starting with "/" (no query, fragment, scheme or "..")`);
  } else {
    const literal = op.path.replace(/\{[^{}]*\}/g, "").replace(/\//g, "");
    if (!literal) errors.push(`${o}: path must name a concrete endpoint, not only placeholders`);
    for (const p of pathParams(op.path)) {
      const prop = props?.[p];
      if (!isObj(prop) || !required.includes(p)) errors.push(`${o}: path parameter ${p} must be a required argument`);
      else if (!["string", "integer", "number"].includes(prop.type as string)) errors.push(`${o}: path parameter ${p} must be a string or a number`);
    }
  }

  // Body mapping.
  if (op.body !== undefined) {
    if (!isObj(op.body) || op.method === "GET") errors.push(`${o}: body mapping is only for writes`);
    else for (const [path, arg] of Object.entries(op.body)) {
      if (typeof arg !== "string" || !props?.[arg]) errors.push(`${o}: body ${path} maps from unknown argument ${String(arg)}`);
      if (!/^[A-Za-z0-9_]+(\.[A-Za-z0-9_]+)*$/.test(path)) errors.push(`${o}: body path ${path} is invalid`);
      // Prototype pollution: no segment may name the prototype chain.
      if (path.split(".").some((k) => k === "__proto__" || k === "prototype" || k === "constructor")) errors.push(`${o}: body path ${path} names the prototype chain`);
    }
  }

  // Effect must agree with the method and the flags (FR-CONN-04).
  // A read over POST (search endpoints) only in a spec the caller vouches for: bundled or signed by Dojo.
  const readByPost = op.method === "POST" && trusted;
  if (op.effect === "read" && op.method !== "GET" && !readByPost) errors.push(`${o}: effect read needs GET (only bundled or signed specs may read over POST)`);
  if (op.method === "GET" && op.effect !== "read") errors.push(`${o}: a GET must have effect read`);
  if (op.method === "DELETE" && op.effect !== "delete") errors.push(`${o}: a DELETE must have effect delete`);
  if (sideEffects) {
    if (op.effect === "read" && sideEffects.length) errors.push(`${o}: a read can't have side effects`);
    if (op.effect !== "read" && !sideEffects.length) errors.push(`${o}: a write or delete must list its side effects`);
  }
  if (op.effect === "read" && op.destructive === true) errors.push(`${o}: a read can't be destructive`);
  if (op.effect === "delete" && op.destructive !== true) errors.push(`${o}: a delete must be destructive`);
  if (sideEffects?.includes("deletes") && op.destructive !== true) errors.push(`${o}: deleting must be marked destructive`);

  if (sideEffects && EFFECTS.includes(op.effect as OperationEffect) && DOMAINS.includes(op.domain as ConnectorDomain) && RISKS.includes(op.risk as Risk)) {
    const floor = riskFloor({ effect: op.effect as OperationEffect, sideEffects, domain: op.domain as ConnectorDomain });
    if (!riskAtLeast(op.risk as Risk, floor.risk)) errors.push(`${o}: risk ${String(op.risk)} is below ${floor.risk}, because ${floor.reason}`);
  }
}

/**
 * Checks a connector spec against CT-12 and FR-CONN-02, 04 and 09. Returns every problem; empty means valid.
 * Every spec goes through the same checks. Trust comes only from `options.trust`, which the caller decides
 * (see `specTrust`); the spec's own `origin` and `signature` fields prove nothing by themselves.
 */
export function validateSpec(spec: unknown, options: ValidateOptions = {}): string[] {
  const providers = options.providers ?? oauthProviders;
  const trusted = options.trust === "bundled" || options.trust === "signed";
  const errors: string[] = [];
  if (!isObj(spec)) return ["spec must be an object"];
  if (typeof spec.id !== "string" || !ID.test(spec.id)) errors.push("id must be snake_case, 2 to 40 characters");
  if (typeof spec.version !== "number" || !Number.isInteger(spec.version) || spec.version < 1) errors.push("version must be a positive integer");
  if (typeof spec.name !== "string" || !spec.name.trim() || spec.name.length > 60) errors.push("name must be 1 to 60 characters");
  if (!ORIGINS.includes(spec.origin as SpecOrigin)) errors.push(`origin must be one of ${ORIGINS.join(", ")}`);
  // "shipped" is a claim only the caller can confirm (bundled or signed); a spec can't vouch for itself.
  if (spec.origin === "shipped" && !trusted) errors.push("origin shipped needs a spec bundled with the app or signed by Dojo Coding");
  if (spec.signature !== undefined && (typeof spec.signature !== "string" || !/^[0-9a-f]+$/.test(spec.signature))) errors.push("signature must be hex");

  const hosts = isStrArr(spec.hosts) ? spec.hosts : [];
  if (!isStrArr(spec.hosts) || !hosts.length) errors.push("hosts must list at least one host");
  for (const h of hosts) if (!isPublicHost(h)) errors.push(`hosts: "${h}" is not an exact public host name`);
  if (new Set(hosts).size !== hosts.length) errors.push("hosts: duplicate host");

  if (!Array.isArray(spec.auth) || !spec.auth.length) errors.push("auth must list at least one sign-in type");
  else spec.auth.forEach((a, i) => validateAuth(a, i, providers, errors));
  const keyHeaders = Array.isArray(spec.auth) ? spec.auth.filter((a) => isObj(a) && a.type === "api_key" && typeof a.name === "string").map((a) => String((a as { name: string }).name).toLowerCase()) : [];

  const ops = Array.isArray(spec.operations) ? spec.operations : undefined;
  if (!ops || !ops.length) errors.push("operations must list at least one operation");
  const names = new Set<string>();
  ops?.forEach((op, i) => {
    validateOperation(op, i, trusted, hosts, errors);
    const n = isObj(op) ? op.name : undefined;
    if (typeof n === "string") {
      if (names.has(n)) errors.push(`operations: duplicate operation ${n}`);
      names.add(n);
    }
  });

  if (!Array.isArray(spec.transforms)) errors.push("transforms must be a list");
  else spec.transforms.forEach((t, i) => {
    if (!isObj(t)) return void errors.push(`transforms[${i}] must be an object`);
    if (t.kind === "static_header") {
      if (typeof t.name !== "string" || !HEADER_NAME.test(t.name) || typeof t.value !== "string" || t.value.length > 200) errors.push(`transforms[${i}]: static_header needs a name and a short value`);
      else if (FORBIDDEN_HEADERS.has(t.name.toLowerCase()) || keyHeaders.includes(t.name.toLowerCase())) errors.push(`transforms[${i}]: a spec can't set the ${t.name} header`);
    } else if (t.kind === "pick_fields") {
      if (typeof t.operation !== "string" || !names.has(t.operation)) errors.push(`transforms[${i}]: pick_fields names unknown operation ${String(t.operation)}`);
      if (!isStrArr(t.fields) || !t.fields.length) errors.push(`transforms[${i}]: pick_fields needs fields`);
      if (t.list !== undefined && typeof t.list !== "string") errors.push(`transforms[${i}]: list must be a path`);
    } else errors.push(`transforms[${i}]: "${String(t.kind)}" is not a built-in transform`);
  });
  return errors;
}

/** The spec's identity: SHA-256 of its canonical JSON without the signature (FR-CONN-08). */
export function specHash(spec: ConnectorSpec): string {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { signature, ...rest } = spec;
  return sha256Hex(canonicalJson(rest));
}

/** Dojo's release tooling signs specs that ship as data (FR-CONN-01). */
export function signSpec(spec: ConnectorSpec, seed: Uint8Array): ConnectorSpec {
  return { ...spec, signature: bytesToHex(ed25519.sign(hexToBytes(specHash(spec)), seed)) };
}

export function verifySpecSignature(spec: ConnectorSpec, publicKey: Uint8Array): boolean {
  if (!spec.signature) return false;
  try {
    return ed25519.verify(hexToBytes(spec.signature), hexToBytes(specHash(spec)), publicKey);
  } catch {
    return false;
  }
}
