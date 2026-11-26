/**
 * HM-SITE-02: every outbound connection the Hermit app can make, by kind. The host names come from the
 * app's own sources; `test/connections.test.ts` reads those sources and fails when the app can reach a host this
 * list doesn't name, so the policy can't fall behind the code.
 */
export interface Connection {
  /** Copy keys: `HM-SITE-02.conn<Id>`, `...Where`, `...When`. */
  id: "Model" | "Search" | "Web" | "Mail" | "Services" | "Mcp" | "Relay" | "Wallet";
  /** Placeholder name to host names, filled into the `Where` copy. */
  hosts: Readonly<Record<string, readonly string[]>>;
}

export const CONNECTIONS: readonly Connection[] = [
  { id: "Model", hosts: { hosts: ["huggingface.co"] } },
  { id: "Search", hosts: { hosts: ["html.duckduckgo.com"] } },
  { id: "Web", hosts: {} },
  {
    id: "Mail",
    hosts: {
      googleHosts: ["gmail.googleapis.com", "www.googleapis.com", "accounts.google.com", "oauth2.googleapis.com"],
      microsoftHosts: ["graph.microsoft.com", "login.microsoftonline.com"],
    },
  },
  {
    id: "Services",
    hosts: {
      hosts: [
        "www.googleapis.com",
        "accounts.google.com",
        "oauth2.googleapis.com",
        "graph.microsoft.com",
        "login.microsoftonline.com",
        "api.spotify.com",
        "accounts.spotify.com",
        "api.github.com",
        "github.com",
        "api.notion.com",
        "slack.com",
      ],
    },
  },
  { id: "Mcp", hosts: {} },
  { id: "Relay", hosts: {} },
  { id: "Wallet", hosts: { hosts: ["rpc.testnet.stable.xyz"] } },
];

/** Every named host on the policy. */
export const NAMED_HOSTS: ReadonlySet<string> = new Set(CONNECTIONS.flatMap((c) => Object.values(c.hosts).flat()));

/** The `{placeholder}` values for one row's `Where` copy. */
export function hostVars(c: Connection): Record<string, string> {
  return Object.fromEntries(Object.entries(c.hosts).map(([k, v]) => [k, v.join(", ")]));
}
