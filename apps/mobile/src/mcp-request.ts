// SL-54: how one MCP request (packages/connectors builds it and checks its address) becomes a platform fetch. Pure,
// tested under Node: the token and secret bodies are revealed here and nowhere else, at send time (FR-CONN-03).

interface Revealable {
  reveal(): string;
}

/** The shape of @hermit/connectors' ConnectorRequest that the adapter reads. */
export interface McpRequestLike {
  method: string;
  url: string;
  headers: Record<string, string>;
  body?: string | Revealable;
  auth?: { in: "header" | "query"; name: string; value: Revealable };
  maxResponseBytes: number;
}

export interface McpFetchInit {
  method: string;
  headers: Record<string, string>;
  body?: string;
  /** Redirects come back as 3xx for the client to check; it never follows one for a POST. */
  redirect: "manual";
  /** No cookies: the bearer token is the only credential, and only the server it was issued for gets it. */
  credentials: "omit";
}

export function fetchInit(req: McpRequestLike): { url: string; init: McpFetchInit } {
  const headers = { ...req.headers };
  let url = req.url;
  if (req.auth?.in === "header") headers[req.auth.name] = req.auth.value.reveal();
  if (req.auth?.in === "query") url += `${url.includes("?") ? "&" : "?"}${encodeURIComponent(req.auth.name)}=${encodeURIComponent(req.auth.value.reveal())}`;
  const body = req.body === undefined ? undefined : typeof req.body === "string" ? req.body : req.body.reveal();
  return { url, init: { method: req.method, headers, ...(body !== undefined ? { body } : {}), redirect: "manual", credentials: "omit" } };
}

/**
 * Whether the answer came from the address that was requested. A platform that followed a redirect by itself, or
 * reports another address, sent the request somewhere no check saw. No reported address is no evidence either way;
 * the client's own check (`redirected`, `url`) runs on what the adapter passes on.
 */
export function landedAt(requested: string, reported: string | null | undefined, redirected: boolean): boolean {
  if (redirected) return false;
  return !reported || reported === requested;
}
