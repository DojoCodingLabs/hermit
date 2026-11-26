// SL-55: what code owns in a connector it did not write (the SL-52 verdict). Effect, flags and risk come from the method
// and a keyword guard over the doc's own words, never from the model or the document's claims; the sign-in is one of a
// fixed list, and a header name or prefix is accepted only when the doc wrote it.
import type { Risk } from "@hermit/core";
import { riskFloor, type AuthSpec, type ConnectorDomain, type HttpMethod, type OperationEffect, type SideEffect } from "../spec.ts";

const unique = <T>(xs: T[]) => [...new Set(xs)];

/** URLs written in the doc, without trailing punctuation or slash. */
export function docUrls(doc: string): string[] {
  return unique([...doc.matchAll(/https?:\/\/[^\s"'`<>()]+/g)].map((m) => m[0].replace(/[.,;:]+$/, "").replace(/\/+$/, "")));
}

/** Path-like tokens outside the doc's URLs: "/tasks", "/repos/{owner}/{repo}/issues". */
export function docPaths(doc: string): string[] {
  const text = doc.replace(/https?:\/\/[^\s"'`<>()]+/g, " ");
  return unique([...text.matchAll(/(?<![\w.])\/[A-Za-z0-9_{}.\-/]*[A-Za-z0-9_}]/g)].map((m) => m[0]));
}

/** Identifier-like words in the doc: the only names the model may give arguments, sign-in headers and prefixes. */
export function docTokens(doc: string): string[] {
  return unique([...doc.matchAll(/[A-Za-z_][A-Za-z0-9_-]*/g)].map((m) => m[0].replace(/-+$/, "")).filter((t) => t.length <= 64));
}

const METHOD_LINE = /^\s*(GET|POST|PUT|PATCH|DELETE)\s+(\S+)/;

/** Every `METHOD /path` line the doc prints. */
export function methodLines(doc: string): Array<{ method: HttpMethod; path: string }> {
  return doc.split("\n").flatMap((l) => {
    const m = METHOD_LINE.exec(l);
    return m ? [{ method: m[1] as HttpMethod, path: (m[2] as string).replace(/[.,;:]+$/, "") }] : [];
  });
}

/** The doc text about one endpoint: its heading, its method line and what follows, up to the next endpoint. */
export function docSection(doc: string, method: string, paths: string[]): string {
  const lines = doc.split("\n");
  const starts = lines.flatMap((l, i) => (METHOD_LINE.test(l) ? [i] : []));
  const k = starts.find((i) => {
    const m = METHOD_LINE.exec(lines[i] as string)!;
    return m[1] === method && paths.includes((m[2] as string).replace(/[.,;:]+$/, ""));
  });
  if (k === undefined) return "";
  const next = starts.find((i) => i > k);
  return lines.slice(Math.max(0, k - 1), next === undefined ? lines.length : next - 1).join("\n");
}

/**
 * The phone drafts from an excerpt only (SL-52 measured 100 to 250 words; the phone's context is 8,192 tokens). A longer
 * page, or one documenting more endpoints than one draft covers, is refused with a clear reason (Boost is a later option).
 */
export const MAX_EXCERPT_CHARS = 4000;
export const MAX_ENDPOINTS = 8;

export function excerptProblem(doc: string): "empty" | "too_long" | undefined {
  const text = doc.trim();
  if (!text) return "empty";
  if (text.length > MAX_EXCERPT_CHARS || methodLines(text).length > MAX_ENDPOINTS) return "too_long";
  return undefined;
}

// The keyword guard (SL-52 v1): English and Spanish words for moving money and for reaching a person.
const MONEY_WORDS = /(?<![\p{L}\p{N}])(charge[sd]?|charging|refunds?|refunded|payments?|pays?|paid|payouts?|transfers?|debit(?:s|ed)?|funds|money|fees?|cobra|cobro|cobros|cobrar|reembols\p{L}*|pagos?|pagar|dinero|debita|transferencias?|fondos)(?![\p{L}\p{N}])/iu;
const SEND_WORDS = /(?<![\p{L}\p{N}])(send|sends|sent|e-?mails?|emailed|sms|texts?|notify|notifies|notifications?|env[ií]a|enviar|env[ií]o|correos?|notifica\p{L}*|aviso)(?![\p{L}\p{N}])/iu;

export interface GuardHit {
  effect: "moves_money" | "sends";
  /** The doc's own word that raised it, for the review card ("the docs say: dinero"). */
  word: string;
}

/** What a doc section says about money and sending. It only ever raises a risk. */
export function guardSideEffects(text: string): GuardHit[] {
  const hits: GuardHit[] = [];
  const money = MONEY_WORDS.exec(text);
  if (money) hits.push({ effect: "moves_money", word: money[0] });
  const send = SEND_WORDS.exec(text);
  if (send) hits.push({ effect: "sends", word: send[0] });
  return hits;
}

export const effectOf = (method: HttpMethod): OperationEffect => (method === "GET" ? "read" : method === "DELETE" ? "delete" : "write");

export interface DerivedSafety {
  effect: OperationEffect;
  sideEffects: SideEffect[];
  destructive: boolean;
  idempotent: boolean;
  risk: Risk;
  /** Why the risk is what it is (riskFloor's reason). */
  reason: string;
  /** What the guard added (writes only, as SL-52 measured it; every connector read asks anyway, Q42). */
  guard: GuardHit[];
}

/**
 * Effect, flags and risk for one operation, by code: the effect from the method; side effects the model or document
 * claimed are kept only as raises; a delete always deletes; a write always changes something; the guard adds money
 * and sending from the operation's own doc text; the risk is the floor of all that (FR-CONN-04).
 */
export function deriveSafety(input: { method: HttpMethod; claimed: readonly SideEffect[]; domain: ConnectorDomain; text: string }): DerivedSafety {
  const effect = effectOf(input.method);
  if (effect === "read") {
    const floor = riskFloor({ effect, sideEffects: [], domain: input.domain });
    return { effect, sideEffects: [], destructive: false, idempotent: true, risk: floor.risk, reason: floor.reason, guard: [] };
  }
  const hits = guardSideEffects(input.text);
  let sideEffects = unique(input.claimed.filter((s) => s !== "uses_credential" || input.domain === "credentials"));
  if (effect === "delete" && !sideEffects.includes("deletes")) sideEffects.push("deletes");
  if (!sideEffects.length) sideEffects = [input.method === "POST" ? "creates" : "updates"];
  const guard = hits.filter((h) => !sideEffects.includes(h.effect));
  sideEffects = [...sideEffects, ...guard.map((h) => h.effect)];
  const floor = riskFloor({ effect, sideEffects, domain: input.domain });
  return {
    effect,
    sideEffects,
    destructive: effect === "delete" || sideEffects.includes("deletes"),
    idempotent: input.method !== "POST" && input.method !== "PATCH",
    risk: floor.risk,
    reason: floor.reason,
    guard,
  };
}

/** SL-52 v0's sign-in word list, which read HTTP Basic right every time; `other` is refused. */
export const SIGN_IN_KINDS = ["bearer", "header_key", "query_key", "basic"] as const;
export type SignInKind = (typeof SIGN_IN_KINDS)[number];

export interface SignInReading {
  kind: SignInKind;
  /** The header or query parameter, for header_key and query_key: a word the doc wrote. */
  name?: string;
  /** The word before the key in that header ("apikey"): a word the doc wrote. */
  prefix?: string;
}

const HEADER_NAME = /^[A-Za-z0-9-]{1,64}$/;
/** Headers the runtime keeps for itself; a key never goes in one (Authorization is allowed, with a prefix or bearer). */
const RESERVED = new Set(["cookie", "set-cookie", "host", "proxy-authorization", "content-length", "transfer-encoding", "content-type", "accept"]);

/** CT-12 auth for a reading, or undefined when the runtime can't do it or the doc never wrote the name or prefix. */
export function signInToAuth(r: SignInReading, docWords: readonly string[]): AuthSpec | undefined {
  const name = r.name?.trim() ?? "";
  const prefix = r.prefix?.trim() ?? "";
  const fromDoc = (w: string) => docWords.includes(w);
  switch (r.kind) {
    case "bearer":
      return { type: "api_key", in: "header", name: "Authorization", prefix: "Bearer " };
    case "basic":
      return { type: "basic" };
    case "header_key":
      if (!name || !HEADER_NAME.test(name) || !fromDoc(name) || RESERVED.has(name.toLowerCase())) return undefined;
      if (prefix && (!fromDoc(prefix) || prefix.length > 19)) return undefined;
      return { type: "api_key", in: "header", name, ...(prefix ? { prefix: `${prefix} ` } : {}) };
    case "query_key":
      if (!name || !HEADER_NAME.test(name) || !fromDoc(name)) return undefined;
      return { type: "api_key", in: "query", name };
    default:
      return undefined;
  }
}

/** The reading behind a CT-12 auth, for the review card. */
export function readingOf(auth: AuthSpec): SignInReading | undefined {
  if (auth.type === "basic") return { kind: "basic" };
  if (auth.type !== "api_key") return undefined;
  if (auth.in === "query") return { kind: "query_key", name: auth.name };
  if (auth.name === "Authorization" && auth.prefix === "Bearer ") return { kind: "bearer" };
  return { kind: "header_key", name: auth.name, ...(auth.prefix ? { prefix: auth.prefix.trim() } : {}) };
}

// eslint-disable-next-line no-control-regex -- control, invisible and bidi characters are exactly what is removed
const UNSAFE = /[\u0000-\u001f\u007f-\u009f\u00ad\u200b-\u200f\u202a-\u202e\u2060-\u2064\u2066-\u2069\ufeff<>`*#[\]]/g;

/** Someone else's words made safe for a label: one line, no markup or invisible characters, capped. */
export function cleanLabel(text: string, max: number): string {
  const one = text.replace(/\s+/g, " ").replace(UNSAFE, "").trim();
  return one.length > max ? `${one.slice(0, max - 1).trimEnd()}…` : one;
}

/** A snake_case identifier for a spec or operation. */
export function snakeId(s: string, fallback: string): string {
  let id = s.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase().normalize("NFD").replace(/\p{M}/gu, "").replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  if (!id) id = fallback;
  if (!/^[a-z]/.test(id)) id = `c_${id}`;
  id = id.slice(0, 40).replace(/_+$/, "");
  return id.length >= 2 ? id : `${id}_x`;
}

/** What code noted about one operation it built, for the review card. */
export interface OpNote {
  name: string;
  /** riskFloor's reason. */
  reason: string;
  guard: GuardHit[];
}

/** Something left out of an import or draft, and why (a code). */
export interface Skipped {
  /** `METHOD /path` as the source wrote it. */
  label: string;
  reason: "external_ref" | "unsupported_param" | "body_too_complex" | "duplicate" | "invalid" | "unreadable" | "too_many";
}
