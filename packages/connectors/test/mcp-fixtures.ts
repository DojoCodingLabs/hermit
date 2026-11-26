import type { ConnectorRequest, McpResponse, McpTransport } from "../src/index.ts";

export type Handler = (req: ConnectorRequest) => McpResponse | Promise<McpResponse>;

/** A scripted network: "METHOD url" to a handler. Anything unscripted is a 404, and every request is recorded. */
export function fakeNet(routes: Record<string, Handler>): McpTransport & { sent: ConnectorRequest[] } {
  const sent: ConnectorRequest[] = [];
  return {
    sent,
    async send(req) {
      sent.push(req);
      const h = routes[`${req.method} ${req.url}`];
      return h ? h(req) : { status: 404, headers: {}, body: "" };
    },
  };
}

export const json = (body: unknown, status = 200, headers: Record<string, string> = {}): McpResponse => ({
  status,
  headers: { "content-type": "application/json", ...headers },
  body: JSON.stringify(body),
});

export const SERVER = "https://mcp.example.com/mcp";
export const ISSUER = "https://auth.example.com";
export const REDIRECT = "hermit://oauth/mcp";

export const prm = (over: Record<string, unknown> = {}) => ({
  resource: SERVER,
  authorization_servers: [ISSUER],
  scopes_supported: ["read", "write"],
  ...over,
});

export const asMeta = (over: Record<string, unknown> = {}) => ({
  issuer: ISSUER,
  authorization_endpoint: `${ISSUER}/authorize`,
  token_endpoint: `${ISSUER}/token`,
  registration_endpoint: `${ISSUER}/register`,
  response_types_supported: ["code"],
  code_challenge_methods_supported: ["S256"],
  token_endpoint_auth_methods_supported: ["none"],
  ...over,
});

export const challenge401 = (extra = ""): McpResponse => ({
  status: 401,
  headers: { "www-authenticate": `Bearer realm="OAuth", resource_metadata="https://mcp.example.com/.well-known/oauth-protected-resource/mcp"${extra}` },
  body: "",
});

/** A server that needs OAuth and has everything at the usual places. */
export function authRoutes(over: Partial<Record<string, Handler>> = {}): Record<string, Handler> {
  return {
    [`POST ${SERVER}`]: () => challenge401(', scope="read"'),
    "GET https://mcp.example.com/.well-known/oauth-protected-resource/mcp": () => json(prm()),
    "GET https://auth.example.com/.well-known/oauth-authorization-server": () => json(asMeta()),
    [`POST ${ISSUER}/register`]: (req) => {
      const body = JSON.parse(String(req.body)) as { redirect_uris: string[] };
      return json({ client_id: "dyn-client-1", redirect_uris: body.redirect_uris, token_endpoint_auth_method: "none" }, 201);
    },
    ...over,
  } as Record<string, Handler>;
}

export const bytes = (n: number, fill = 7) => new Uint8Array(n).fill(fill);
