import type { ConnectorRequest } from "../transport.ts";
import { parseHttpsUrl, resolveRedirect, type HttpsUrl } from "./url.ts";

/**
 * What the app's adapter returns for an MCP request. Unlike connector calls, MCP needs the response headers
 * (session id, protocol challenge, content type).
 */
export interface McpResponse {
  status: number;
  /** Header names in any case; the client lowercases them. */
  headers: Record<string, string>;
  body: string;
  /** Where the response really came from, when the platform reports it. */
  url?: string;
  /** The platform followed a redirect on its own (`redirect: "manual"` not honored). */
  redirected?: boolean;
}

/**
 * The network for the MCP client, implemented in the app (packages never touch it). The adapter must send
 * with `redirect: "manual"` (expo/fetch honors it on Android through OkHttp `followRedirects(false)`), inject
 * `auth` at send time, count the host for the privacy screen, and stop reading at `maxResponseBytes`.
 */
export interface McpTransport {
  send(request: ConnectorRequest): Promise<McpResponse>;
}

export type Checked =
  | { ok: true; res: McpResponse; url: HttpsUrl }
  | { ok: false; problem: "blocked_url" | "blocked_redirect" | "too_many_redirects" | "unreachable" };

const lower = (h: Record<string, string>) => Object.fromEntries(Object.entries(h).map(([k, v]) => [k.toLowerCase(), v]));

async function sendOnce(transport: McpTransport, req: ConnectorRequest, url: HttpsUrl): Promise<Checked> {
  let res: McpResponse;
  try {
    res = await transport.send({ ...req, url: url.href });
  } catch {
    return { ok: false, problem: "unreachable" };
  }
  // A redirect the platform followed by itself reached an address no check saw: fail closed.
  if (res.redirected || (res.url !== undefined && res.url !== url.href)) return { ok: false, problem: "blocked_redirect" };
  return { ok: true, res: { ...res, headers: lower(res.headers), body: res.body.slice(0, req.maxResponseBytes) }, url };
}

/**
 * A GET (metadata discovery) where every hop, the first one included, passes `parseHttpsUrl` before it is
 * requested. Redirects are followed only that way, at most `maxRedirects` times, and never carry `auth`.
 */
export async function getChecked(
  transport: McpTransport,
  rawUrl: string,
  opts: { maxBytes: number; maxRedirects?: number; accept?: string },
): Promise<Checked> {
  let url = parseHttpsUrl(rawUrl);
  if (!url) return { ok: false, problem: "blocked_url" };
  const req: ConnectorRequest = { method: "GET", url: url.href, headers: { Accept: opts.accept ?? "application/json" }, maxResponseBytes: opts.maxBytes };
  for (let hop = 0; ; hop++) {
    const r = await sendOnce(transport, req, url);
    if (!r.ok || r.res.status < 300 || r.res.status >= 400) return r;
    if (hop >= (opts.maxRedirects ?? 3)) return { ok: false, problem: "too_many_redirects" };
    const next = resolveRedirect(url, r.res.headers.location ?? "");
    if (!next) return { ok: false, problem: "blocked_redirect" };
    url = next;
  }
}

/** A POST (or DELETE) to a checked URL. A 3xx is refused: a token, a code or a tool call never follows one. */
export async function postChecked(transport: McpTransport, req: ConnectorRequest): Promise<Checked> {
  const url = parseHttpsUrl(req.url);
  if (!url) return { ok: false, problem: "blocked_url" };
  const r = await sendOnce(transport, req, url);
  if (r.ok && r.res.status >= 300 && r.res.status < 400) return { ok: false, problem: "blocked_redirect" };
  return r;
}
