import { canonicalJson, sha256Hex, skillId, type ApprovalSummary, type JsonSchema, type Risk, type SkillDef } from "@hermit/core";
import { maxRisk } from "../spec.ts";
import { isObject, type JsonObject } from "./json.ts";

/** The four MCP hints. All of them are claims by the server, never facts (MCP spec, ToolAnnotations). */
export interface McpAnnotations {
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
  idempotentHint?: boolean;
  openWorldHint?: boolean;
}

export interface McpTool {
  name: string;
  /** Server text: never shown on the approval sheet. */
  title?: string;
  /** Server text: untrusted, capped, never shown on the approval sheet. */
  description: string;
  inputSchema: JsonSchema;
  annotations: McpAnnotations;
}

export type SkippedTool = { name: string; reason: "name" | "schema" | "duplicate" };

const NAME = /^[A-Za-z0-9_.-]{1,64}$/;
const MAX_SCHEMA_CHARS = 16_384;
const MAX_DESCRIPTION = 1000;

/** A `$ref` that leaves the schema (a URL or a file) would make the client fetch or trust someone else's schema. */
function hasExternalRef(v: unknown): boolean {
  if (Array.isArray(v)) return v.some(hasExternalRef);
  if (!isObject(v)) return false;
  return Object.entries(v).some(([k, x]) => (k === "$ref" && (typeof x !== "string" || !x.startsWith("#"))) || hasExternalRef(x));
}

const MAX_SCHEMA_DEPTH = 8;
const MAX_PROPERTIES = 50;
const MAX_SCHEMA_STRING = 200;
const MAX_ENUM = 50;
/**
 * Keys a server's schema may not keep. `pattern` and `patternProperties` are regular expressions the server wrote:
 * compiled in JavaScript's backtracking engine, one like `(a+)+$` hangs the phone (ReDoS). `format` can mean a
 * regex too. Length caps stay; the cage and the sheet, not a server's regex, decide what runs.
 */
const FORBIDDEN = new Set(["__proto__", "constructor", "prototype"]);
const DROPPED = new Set(["pattern", "patternProperties", "format", "__proto__", "constructor", "prototype"]);

/**
 * A server's input schema made safe to validate (SL-54): no regex of the server's, at most `MAX_SCHEMA_DEPTH` deep and
 * `MAX_PROPERTIES` per object, strings and enums capped. Undefined when it is too deep or too wide to keep.
 */
export function safeToolSchema(v: unknown, depth = 0): unknown {
  if (depth > MAX_SCHEMA_DEPTH) throw new RangeError("schema too deep");
  if (typeof v === "string") return v.slice(0, MAX_SCHEMA_STRING);
  if (Array.isArray(v)) return v.slice(0, MAX_ENUM).map((x) => safeToolSchema(x, depth + 1));
  if (!isObject(v)) return v;
  if (isObject(v.properties) && Object.keys(v.properties).length > MAX_PROPERTIES) throw new RangeError("schema too wide");
  const out: Record<string, unknown> = {};
  for (const [k, x] of Object.entries(v)) {
    if (DROPPED.has(k)) continue;
    // Under `properties` the keys are argument names (one may well be called "format"); only their schemas are cleaned.
    if (k === "properties" && isObject(x)) {
      const props: Record<string, unknown> = {};
      for (const [name, p] of Object.entries(x)) if (!FORBIDDEN.has(name)) props[name] = safeToolSchema(p, depth + 1);
      out[k] = props;
    } else out[k] = safeToolSchema(x, depth + 1);
  }
  return out;
}

function safeOrUndefined(v: unknown): JsonSchema | undefined {
  try {
    return safeToolSchema(v) as JsonSchema;
  } catch {
    return undefined;
  }
}

function readAnnotations(v: unknown): McpAnnotations {
  const out: McpAnnotations = {};
  if (!isObject(v)) return out;
  for (const k of ["readOnlyHint", "destructiveHint", "idempotentHint", "openWorldHint"] as const) if (typeof v[k] === "boolean") out[k] = v[k];
  return out;
}

/** The `tools` of a tools/list page, keeping only well-formed tools with a local, bounded object schema. */
export function parseTools(result: JsonObject, seen: Set<string>): { tools: McpTool[]; skipped: SkippedTool[] } {
  const tools: McpTool[] = [];
  const skipped: SkippedTool[] = [];
  const list = Array.isArray(result.tools) ? result.tools : [];
  for (const t of list) {
    if (!isObject(t)) continue;
    const name = typeof t.name === "string" ? t.name : "";
    if (!NAME.test(name)) {
      skipped.push({ name: name.slice(0, 64), reason: "name" });
      continue;
    }
    const raw = t.inputSchema;
    const schema = isObject(raw) && raw.type === "object" && JSON.stringify(raw).length <= MAX_SCHEMA_CHARS && !hasExternalRef(raw) ? safeOrUndefined(raw) : undefined;
    if (!schema) {
      skipped.push({ name, reason: "schema" });
      continue;
    }
    if (seen.has(name)) {
      skipped.push({ name, reason: "duplicate" });
      continue;
    }
    seen.add(name);
    tools.push({
      name,
      ...(typeof t.title === "string" ? { title: t.title.slice(0, 100) } : {}),
      description: typeof t.description === "string" ? t.description.slice(0, MAX_DESCRIPTION) : "",
      inputSchema: schema,
      annotations: readAnnotations(t.annotations),
    });
  }
  return { tools, skipped };
}

/** The hash an install approves. Any change to a tool's definition (rug pull) disables it until re-approved. */
export function toolHash(tool: McpTool): string {
  const { name, title, description, inputSchema, annotations } = tool;
  return sha256Hex(canonicalJson({ name, ...(title !== undefined ? { title } : {}), description, inputSchema, annotations }));
}

const SEND = new Set(["send", "email", "mail", "message", "messages", "post", "publish", "reply", "invite", "share", "notify", "sms", "tweet", "dm", "forward"]);
const SPEND = new Set(["pay", "payment", "payments", "purchase", "buy", "charge", "transfer", "refund", "checkout", "order", "subscribe", "invoice", "payout", "withdraw"]);
const CREDENTIAL = new Set(["password", "passwords", "secret", "secrets", "token", "tokens", "credential", "credentials", "apikey", "passkey"]);
const DESTRUCTIVE = new Set(["delete", "remove", "destroy", "drop", "purge", "archive", "revoke", "erase", "wipe", "cancel", "reset", "overwrite"]);

/** "postMessage", "send-email" and "get_api_token" as words; never a word inside another word. */
const words = (name: string) => name.replace(/([a-z0-9])([A-Z])/g, "$1 $2").toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);

export interface McpToolRisk {
  /** What the install sheet proposes; the user confirms or raises it. */
  proposed: Risk;
  /** The lowest risk code allows, whatever the server or the user says. */
  floor: Risk;
  destructive: boolean;
  reasons: string[];
  /** Hints the code overruled. */
  conflicts: Array<keyof McpAnnotations>;
}

/**
 * The risk of an MCP tool, assigned by code (FR-CONN-05). Every tool starts at `remote_write` and
 * destructive. Words in the tool's name raise it (send, spend, credential, destructive) and beat any hint.
 * The one hint that can lower anything is `readOnlyHint: true`, and only from a server the user installed,
 * only to `network` (a read still leaves the phone), and only as a proposal the user confirms. Every other
 * hint can only raise.
 */
export function mcpToolRisk(tool: McpTool, opts: { installedByUser: boolean }): McpToolRisk {
  const w = words(tool.name);
  const reasons: string[] = [];
  const conflicts: McpToolRisk["conflicts"] = [];
  let floor: Risk = "network";
  const raise = (words: Set<string>, risk: Risk, reason: string) => {
    if (!w.some((x) => words.has(x))) return;
    floor = maxRisk(floor, risk);
    reasons.push(reason);
  };
  raise(SEND, "send", "its name says it sends");
  raise(SPEND, "spend", "its name says it moves money");
  raise(CREDENTIAL, "credential", "its name says it touches credentials");
  const nameDestructive = w.some((x) => DESTRUCTIVE.has(x));

  const claimsRead = tool.annotations.readOnlyHint === true;
  const readProposal = claimsRead && opts.installedByUser && floor === "network";
  if (claimsRead && floor !== "network") conflicts.push("readOnlyHint");
  const proposed = maxRisk(readProposal ? "network" : "remote_write", floor);
  if (readProposal) reasons.push("the server says it only reads");
  else if (proposed === "remote_write") reasons.push("an MCP tool may change something off the phone");

  let destructive: boolean;
  if (nameDestructive) {
    destructive = true;
    if (tool.annotations.destructiveHint === false) conflicts.push("destructiveHint");
  } else destructive = readProposal ? false : tool.annotations.destructiveHint !== false;
  return { proposed, floor, destructive, reasons, conflicts };
}

/** The risk the cage sees: the proposal, or the user's choice, never below what code allows. */
export function effectiveMcpRisk(r: McpToolRisk, userChoice?: Risk): Risk {
  if (userChoice === undefined) return r.proposed;
  return maxRisk(userChoice, r.proposed === "network" ? r.floor : r.proposed);
}

// eslint-disable-next-line no-control-regex -- control, invisible and bidi characters are exactly what is removed
const INVISIBLE = /[\u0000-\u001f\u007f-\u009f\u00ad\u200b-\u200f\u202a-\u202e\u2060-\u2064\u2066-\u2069\ufeff<>]/g;

/**
 * The line the model's menu shows for an MCP tool. The description is someone else's text, so it is one plain
 * line with no markup, invisible or bidi characters, capped, and labeled as untrusted with its origin.
 */
export function mcpMenuLine(host: string, tool: McpTool): string {
  const desc = tool.description.replace(/\s+/g, " ").replace(INVISIBLE, "").trim();
  return `${tool.name} (MCP tool from ${host}, untrusted description): ${desc}`.slice(0, 300);
}

const show = (v: unknown) => (typeof v === "string" ? v : JSON.stringify(v));

/** The approval sheet: host, tool name and the exact arguments. Never the server's title or description. */
export function mcpApprovalSummary(host: string, tool: McpTool, args: Record<string, unknown>, binding: string): ApprovalSummary {
  return {
    title: `${host}: ${tool.name}`,
    lines: [
      { label: "Server", labelKey: "server", value: host },
      { label: "Tool", labelKey: "tool", value: tool.name },
      ...Object.entries(args).filter(([, v]) => v !== undefined).map(([k, v]) => ({ label: k, value: show(v) })),
    ],
    binding,
  };
}

/** A tool as a menu entry. Its output always taints the session (FR-CAGE-04); its risk comes from code. */
export function mcpToolDef(input: { serverId: string; host: string; tool: McpTool; risk: Risk; binding: string }): SkillDef {
  const { serverId, host, tool, risk, binding } = input;
  return {
    id: skillId(`mcp_${serverId}_${tool.name.toLowerCase().replace(/[^a-z0-9]+/g, "_")}`),
    version: 1,
    menuLine: mcpMenuLine(host, tool),
    args: tool.inputSchema,
    risk,
    producesUntrusted: true,
    describeAction: (args) => mcpApprovalSummary(host, tool, args, binding),
  };
}
