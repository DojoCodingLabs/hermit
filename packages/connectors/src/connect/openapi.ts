// SL-55 (US-CONN-06, FR-CONN-06): an OpenAPI 3 document (JSON) becomes a connector spec deterministically, with no model.
// GET is a read; everything else starts at remote_write; the money and send guard reads each operation's own text and
// only raises; an `x-hermit-risk` override only raises; an external `$ref` is never fetched (that operation is left out).
// The document is someone else's text: its descriptions never reach a label unless cleaned, and never the menu as written.
import { RISKS, type JsonSchema, type Risk } from "@hermit/core";
import { isObject, parseJsonObject, type JsonObject } from "../mcp/json.ts";
import { parseHttpsUrl } from "../mcp/url.ts";
import { maxRisk, pathParams, validateSpec, type AuthSpec, type ConnectorSpec, type HttpMethod, type OperationSpec } from "../spec.ts";
import { cleanLabel, deriveSafety, snakeId, type OpNote, type Skipped } from "./derive.ts";

export type OpenApiProblem = "not_openapi" | "too_large" | "not_https" | "no_server" | "sign_in_unsupported" | "no_operations";

export type OpenApiImport =
  | { ok: true; spec: ConnectorSpec; ops: OpNote[]; skipped: Skipped[] }
  | { ok: false; problem: OpenApiProblem };

/** Documents above this are refused rather than parsed on the phone. */
export const MAX_OPENAPI_CHARS = 512 * 1024;
/** Operations one import offers; the user picks which to include. */
export const MAX_IMPORTED_OPERATIONS = 40;

const METHODS: ReadonlyArray<[string, HttpMethod]> = [["get", "GET"], ["post", "POST"], ["put", "PUT"], ["patch", "PATCH"], ["delete", "DELETE"]];
const SCALARS = new Set(["string", "integer", "number", "boolean"]);
const ARG = /^[A-Za-z0-9_]{1,64}$/;

class ExternalRef extends Error {}

/** True when anything under `v` points outside the document. */
function hasExternalRef(v: unknown, depth = 0): boolean {
  if (depth > 32) return false;
  if (Array.isArray(v)) return v.some((x) => hasExternalRef(x, depth + 1));
  if (!isObject(v)) return false;
  return Object.entries(v).some(([k, x]) => (k === "$ref" && (typeof x !== "string" || !x.startsWith("#/"))) || hasExternalRef(x, depth + 1));
}

/** Follows internal `#/...` references (a few hops at most); an external one throws, so nothing is fetched. */
function resolve(doc: JsonObject, v: unknown, hops = 0): unknown {
  if (!isObject(v) || typeof v.$ref !== "string") return v;
  if (!v.$ref.startsWith("#/")) throw new ExternalRef();
  if (hops > 5) return undefined;
  let cur: unknown = doc;
  for (const raw of v.$ref.slice(2).split("/")) {
    const key = raw.replace(/~1/g, "/").replace(/~0/g, "~");
    cur = isObject(cur) && Object.hasOwn(cur, key) ? cur[key] : undefined;
  }
  return resolve(doc, cur, hops + 1);
}

function serverUrl(doc: JsonObject, sourceHost: string | undefined): { host: string; basePath: string } | OpenApiProblem {
  const servers = Array.isArray(doc.servers) ? doc.servers.filter(isObject) : [];
  const first = servers[0];
  let raw = first && typeof first.url === "string" ? first.url : "/";
  if (first && isObject(first.variables)) {
    const vars = first.variables;
    raw = raw.replace(/\{([^{}]+)\}/g, (m, name: string) => {
      const v = Object.hasOwn(vars, name) ? vars[name] : undefined;
      return isObject(v) && typeof v.default === "string" ? v.default : m;
    });
  }
  if (raw.startsWith("/")) {
    if (!sourceHost) return "no_server";
    raw = `https://${sourceHost}${raw}`;
  }
  const url = parseHttpsUrl(raw);
  if (!url || url.query || /[{}]/.test(raw)) return "not_https";
  return { host: url.host, basePath: url.path.replace(/\/+$/, "") };
}

function mapScheme(s: unknown): AuthSpec | undefined {
  if (!isObject(s)) return undefined;
  if (s.type === "apiKey" && (s.in === "header" || s.in === "query") && typeof s.name === "string" && /^[A-Za-z0-9-_]{1,64}$/.test(s.name)) {
    if (s.in === "header" && ["cookie", "host", "proxy-authorization", "content-type", "accept"].includes(s.name.toLowerCase())) return undefined;
    return { type: "api_key", in: s.in, name: s.name };
  }
  if (s.type === "http" && typeof s.scheme === "string") {
    if (s.scheme.toLowerCase() === "bearer") return { type: "api_key", in: "header", name: "Authorization", prefix: "Bearer " };
    if (s.scheme.toLowerCase() === "basic") return { type: "basic" };
  }
  // OAuth from an imported spec needs a provider table entry; out of scope here (as for drafted specs, SL-52).
  return undefined;
}

function authOf(doc: JsonObject): AuthSpec[] {
  const components = isObject(doc.components) ? doc.components : {};
  const schemes = isObject(components.securitySchemes) ? components.securitySchemes : {};
  const required = Array.isArray(doc.security) ? doc.security.filter(isObject).flatMap((r) => Object.keys(r)) : [];
  const order = [...new Set([...required, ...Object.keys(schemes)])];
  const out: AuthSpec[] = [];
  for (const name of order) {
    const a = mapScheme(Object.hasOwn(schemes, name) ? schemes[name] : undefined);
    if (a && !out.some((x) => JSON.stringify(x) === JSON.stringify(a))) out.push(a);
  }
  return out;
}

function argSchema(schema: unknown, description: unknown): JsonSchema {
  const s = isObject(schema) ? schema : {};
  const type = typeof s.type === "string" && SCALARS.has(s.type) ? s.type : "string";
  const out: Record<string, unknown> = { type };
  if (typeof description === "string" && description.trim()) out.description = cleanLabel(description, 200);
  if (Array.isArray(s.enum) && s.enum.length <= 50 && s.enum.every((x) => typeof x === "string" || typeof x === "number")) out.enum = s.enum;
  if (type === "string" && typeof s.maxLength === "number" && Number.isInteger(s.maxLength) && s.maxLength > 0) out.maxLength = s.maxLength;
  return out as JsonSchema;
}

const isScalarSchema = (s: unknown) => !isObject(s) || s.type === undefined || (typeof s.type === "string" && SCALARS.has(s.type));

type Built = { op: OperationSpec; note: OpNote } | { skip: Skipped["reason"] };

function buildOperation(doc: JsonObject, pathKey: string, method: HttpMethod, item: JsonObject, raw: JsonObject, basePath: string, taken: Set<string>): Built {
  if (hasExternalRef(raw) || hasExternalRef(item.parameters)) return { skip: "external_ref" };
  const properties: Record<string, JsonSchema> = {};
  const required: string[] = [];
  const inPath = new Set<string>();
  const inQuery = new Set<string>();
  const params = new Map<string, JsonObject>();
  for (const list of [item.parameters, raw.parameters]) {
    for (const p of Array.isArray(list) ? list : []) {
      const r = resolve(doc, p);
      if (isObject(r) && typeof r.name === "string" && typeof r.in === "string") params.set(`${r.in}:${r.name}`, r);
    }
  }
  for (const p of params.values()) {
    const name = p.name as string;
    const isRequired = p.required === true || p.in === "path";
    const schema = resolve(doc, p.schema);
    if (p.in !== "path" && p.in !== "query") {
      if (isRequired) return { skip: "unsupported_param" };
      continue;
    }
    if (!ARG.test(name) || !isScalarSchema(schema)) {
      if (isRequired) return { skip: "unsupported_param" };
      continue;
    }
    properties[name] = argSchema(schema, p.description);
    if (isRequired) required.push(name);
    (p.in === "path" ? inPath : inQuery).add(name);
  }

  const bodyArgs: string[] = [];
  const reqBody = resolve(doc, raw.requestBody);
  if (isObject(reqBody) && method !== "GET") {
    const content = isObject(reqBody.content) ? reqBody.content : {};
    const media = Object.hasOwn(content, "application/json") ? content["application/json"] : undefined;
    const schema = isObject(media) ? resolve(doc, media.schema) : undefined;
    const props = isObject(schema) && isObject(schema.properties) ? schema.properties : undefined;
    if (!props) {
      if (reqBody.required === true) return { skip: "body_too_complex" };
    } else {
      const bodyRequired = isObject(schema) && Array.isArray(schema.required) ? schema.required.filter((x): x is string => typeof x === "string") : [];
      for (const [name, rawProp] of Object.entries(props)) {
        const prop = resolve(doc, rawProp);
        const isRequired = bodyRequired.includes(name);
        if (!ARG.test(name) || !isScalarSchema(prop) || properties[name]) {
          if (isRequired) return { skip: "body_too_complex" };
          continue;
        }
        properties[name] = argSchema(prop, isObject(prop) ? prop.description : undefined);
        if (isRequired) required.push(name);
        bodyArgs.push(name);
      }
    }
  }

  const path = `${basePath}${pathKey}`;
  for (const ph of pathParams(path)) {
    if (!properties[ph]) properties[ph] = { type: "string" };
    if (!required.includes(ph)) required.push(ph);
  }
  let name = snakeId(typeof raw.operationId === "string" ? raw.operationId : `${method}_${pathKey}`, "operation");
  if (taken.has(name)) return { skip: "duplicate" };
  taken.add(name);

  const summary = typeof raw.summary === "string" ? raw.summary : "";
  const description = typeof raw.description === "string" ? raw.description : "";
  const title = cleanLabel(summary || (typeof raw.operationId === "string" ? raw.operationId : "") || `${method} ${pathKey}`, 60) || name;
  const safety = deriveSafety({ method, claimed: [], domain: "other", text: `${summary}\n${description}` });
  const override = raw["x-hermit-risk"];
  const risk: Risk = typeof override === "string" && (RISKS as readonly string[]).includes(override) ? maxRisk(safety.risk, override as Risk) : safety.risk;
  name = name.slice(0, 40);
  const op: OperationSpec = {
    name,
    title,
    // Written by code: the document's own description is someone else's text and never reaches the menu as written.
    description: cleanLabel(`${title}. ${method} ${path}`, 280),
    sideEffects: safety.sideEffects,
    method,
    path,
    inputSchema: { type: "object", properties, required, additionalProperties: false },
    // A body mapping keeps query arguments in the query on a write (the runtime's rule); a DELETE without a body needs none.
    ...(method !== "GET" && (bodyArgs.length || (inQuery.size && method !== "DELETE")) ? { body: Object.fromEntries(bodyArgs.map((a) => [a, a])) } : {}),
    scopes: [],
    effect: safety.effect,
    destructive: safety.destructive,
    idempotent: safety.idempotent,
    domain: "other",
    risk,
  };
  return { op, note: { name, reason: safety.reason, guard: safety.guard } };
}

/**
 * Converts an OpenAPI 3 JSON document. `sourceHost` is the host it was fetched from, for a relative server URL. The
 * result is never trusted: it validates as `untrusted` with origin `openapi`, and the user reviews and picks operations.
 */
export function importOpenApi(text: string, opts: { sourceHost?: string } = {}): OpenApiImport {
  if (text.length > MAX_OPENAPI_CHARS) return { ok: false, problem: "too_large" };
  const doc = parseJsonObject(text);
  if (!doc || typeof doc.openapi !== "string" || !doc.openapi.startsWith("3.") || !isObject(doc.paths)) return { ok: false, problem: "not_openapi" };
  const server = serverUrl(doc, opts.sourceHost);
  if (typeof server === "string") return { ok: false, problem: server };
  const auth = authOf(doc);
  if (!auth.length) return { ok: false, problem: "sign_in_unsupported" };
  const info = isObject(doc.info) ? doc.info : {};
  const title = typeof info.title === "string" ? info.title : server.host;
  const base: ConnectorSpec = {
    id: snakeId(title, "api"),
    version: 1,
    name: cleanLabel(title, 60) || server.host,
    hosts: [server.host],
    auth,
    operations: [],
    transforms: [],
    origin: "openapi",
  };

  const ops: OperationSpec[] = [];
  const notes: OpNote[] = [];
  const skipped: Skipped[] = [];
  const taken = new Set<string>();
  for (const [pathKey, rawItem] of Object.entries(doc.paths)) {
    if (!pathKey.startsWith("/")) continue;
    let item: unknown;
    try {
      item = resolve(doc, rawItem);
    } catch {
      item = undefined;
    }
    if (!isObject(item)) continue;
    for (const [key, method] of METHODS) {
      const raw = Object.hasOwn(item, key) ? item[key] : undefined;
      if (!isObject(raw)) continue;
      const label = `${method} ${pathKey}`;
      if (ops.length >= MAX_IMPORTED_OPERATIONS) {
        skipped.push({ label, reason: "too_many" });
        continue;
      }
      let built: Built;
      try {
        built = buildOperation(doc, pathKey, method, item, raw, server.basePath, taken);
      } catch (e) {
        built = { skip: e instanceof ExternalRef ? "external_ref" : "invalid" };
      }
      if ("skip" in built) {
        skipped.push({ label, reason: built.skip });
        continue;
      }
      if (validateSpec({ ...base, operations: [built.op] }, { trust: "untrusted" }).length) {
        skipped.push({ label, reason: "invalid" });
        continue;
      }
      ops.push(built.op);
      notes.push(built.note);
    }
  }
  if (!ops.length) return { ok: false, problem: "no_operations" };
  return { ok: true, spec: { ...base, operations: ops }, ops: notes, skipped };
}
