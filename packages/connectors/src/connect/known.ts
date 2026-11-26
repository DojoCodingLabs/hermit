/**
 * SL-55, discovery step 2: official MCP servers the services themselves publish, bundled with the app (data checked
 * when Dojo ships it, like the catalog). From the SL-51 survey: servers that register a phone as a public client with
 * PKCE. A match only suggests the address; the user still adds it on HM-CONN-03, which signs in and reviews every tool.
 * A live MCP Registry lookup is not here (Q118).
 */
export interface KnownMcpServer {
  name: string;
  /** Words the user may say for it, folded (no accents, lowercase). */
  words: string[];
  /** Registrable domains of the service, for a link the user pastes. */
  domains: string[];
  url: string;
}

export const KNOWN_MCP_SERVERS: readonly KnownMcpServer[] = [
  { name: "Notion", words: ["notion"], domains: ["notion.so", "notion.com"], url: "https://mcp.notion.com/mcp" },
  { name: "Linear", words: ["linear"], domains: ["linear.app"], url: "https://mcp.linear.app/mcp" },
  { name: "Sentry", words: ["sentry"], domains: ["sentry.io", "sentry.dev"], url: "https://mcp.sentry.dev/mcp" },
  { name: "Vercel", words: ["vercel"], domains: ["vercel.com"], url: "https://mcp.vercel.com/" },
  { name: "Canva", words: ["canva"], domains: ["canva.com"], url: "https://mcp.canva.com/mcp" },
  { name: "Stripe", words: ["stripe"], domains: ["stripe.com"], url: "https://mcp.stripe.com/" },
  { name: "PayPal", words: ["paypal"], domains: ["paypal.com"], url: "https://mcp.paypal.com/mcp" },
  { name: "Atlassian", words: ["atlassian", "jira", "confluence"], domains: ["atlassian.com", "atlassian.net"], url: "https://mcp.atlassian.com/v1/mcp" },
];
