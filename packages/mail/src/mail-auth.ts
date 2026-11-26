import { registrableDomain } from "@hermit/core";
import type { MailProviderKind } from "./accounts.ts";

/**
 * SL-56b (security review, Q141, Q142): whether the receiving mail provider checked an email's sender, read by code
 * from its Authentication-Results header (RFC 8601). The header is untrusted input: a sender can write its own, so
 * - only the topmost Authentication-Results header counts (the receiving provider adds its own on top of the message);
 * - it must start with the provider's own receiving authserv-id. Only Gmail's (`mx.google.com`) is known. Microsoft
 *   writes no authserv-id, so a header there can't be told from one the sender wrote: Outlook mail is never verified
 *   until this is checked on a real message (Q141), and neither is IMAP mail;
 * - a small lexer splits on `;` and whitespace only outside quoted strings and comments, turns a quoted string into
 *   one value and drops comments; a stray quote or parenthesis, a bare word in a result, a method name inside a
 *   property value, or any method that appears twice makes the whole header untrusted;
 * - verified means `dmarc=pass` with `header.from` on the site's registrable domain, or else `dkim=pass` whose
 *   `header.d` (or `header.i`'s domain) is on it; the message's From domain must itself be on it.
 * Anything else (no header, another authserv-id, SPF alone) is not verified: fail closed.
 */

/** Each provider's receiving authserv-id; undefined when Hermit trusts no verdict from it (Outlook until checked, IMAP). */
export const AUTHSERV_IDS: Readonly<Record<MailProviderKind, string | undefined>> = { gmail: "mx.google.com", outlook: undefined, imap: undefined };

export type MailAuthVerdict = "dmarc" | "dkim";

/**
 * The header as segments (split on `;`) of tokens (split on whitespace), outside quoted strings and comments. A quoted
 * string joins the token it is part of, unquoted; comments are dropped. Undefined for a stray quote or parenthesis.
 */
export function lexAuthResults(value: string): string[][] | undefined {
  const segments: string[][] = [[]];
  let token: string | undefined;
  let depth = 0;
  const end = () => {
    if (token !== undefined) segments[segments.length - 1]!.push(token);
    token = undefined;
  };
  for (let i = 0; i < value.length; i++) {
    const c = value[i]!;
    if (depth > 0) {
      if (c === "\\") i++;
      else if (c === "(") depth++;
      else if (c === ")") depth--;
      continue;
    }
    if (c === "(") {
      end();
      depth = 1;
    } else if (c === ")") return undefined;
    else if (c === '"') {
      let s = "";
      let closed = false;
      for (i++; i < value.length; i++) {
        const q = value[i]!;
        if (q === "\\" && i + 1 < value.length) s += value[++i];
        else if (q === '"') {
          closed = true;
          break;
        } else s += q;
      }
      if (!closed) return undefined;
      token = (token ?? "") + s;
    } else if (c === ";") {
      end();
      segments.push([]);
    } else if (/\s/.test(c)) end();
    else token = (token ?? "") + c;
  }
  if (depth > 0) return undefined;
  end();
  return segments;
}

const METHOD_IN_VALUE = /(?:^|[^a-z0-9-])(?:dkim|spf|dmarc|arc|iprev|auth|bimi|compauth|dkim-adsp|smime|vbr|rrvs|x-[a-z0-9-]+)\s*=/i;

interface Result {
  result: string;
  props: Record<string, string>;
}

const domainOfValue = (v: string | undefined) => (v === undefined ? undefined : registrableDomain(v.slice(v.lastIndexOf("@") + 1)));

/** The provider's verdict for this message, or undefined when it isn't verified. `values`: the headers, topmost first. */
export function mailAuthVerdict(values: readonly string[], opts: { authservId: string | undefined; domain: string; fromDomain: string }): MailAuthVerdict | undefined {
  if (opts.authservId === undefined || !values.length) return undefined;
  const site = registrableDomain(opts.domain);
  if (!site || registrableDomain(opts.fromDomain) !== site) return undefined;
  const segments = lexAuthResults(values[0]!);
  if (!segments) return undefined;
  const [id, ...rest] = segments;
  // The authserv-id, optionally followed by a version number.
  if (!id || id[0]?.toLowerCase() !== opts.authservId || id.length > 2 || (id[1] !== undefined && !/^\d+$/.test(id[1]))) return undefined;
  const methods = new Map<string, Result>();
  for (const seg of rest) {
    if (!seg.length) continue;
    const head = /^([a-z0-9-]+)(?:\/\d+)?=([a-z]+)$/i.exec(seg[0]!);
    if (!head) return undefined;
    const method = head[1]!.toLowerCase();
    if (methods.has(method)) return undefined;
    const props: Record<string, string> = {};
    for (const t of seg.slice(1)) {
      const m = /^([a-z0-9-]+(?:\.[a-z0-9-]+)?)=(.*)$/i.exec(t);
      if (!m || METHOD_IN_VALUE.test(m[2]!)) return undefined;
      props[m[1]!.toLowerCase()] = m[2]!.toLowerCase();
    }
    methods.set(method, { result: head[2]!.toLowerCase(), props });
  }
  const dmarc = methods.get("dmarc");
  if (dmarc) return dmarc.result === "pass" && domainOfValue(dmarc.props["header.from"]) === site ? "dmarc" : undefined;
  const dkim = methods.get("dkim");
  return dkim?.result === "pass" && (domainOfValue(dkim.props["header.d"]) === site || domainOfValue(dkim.props["header.i"]) === site) ? "dkim" : undefined;
}
