import { createHash } from "node:crypto";
import type { ConnectorTransport } from "@hermit/connectors";
import { loadConfig, type RelayConfig } from "../src/config.ts";
import { createRelay, type RelayDeps, type UpstreamFetch } from "../src/relay.ts";

export const PUBLIC_URL = "https://relay.example.org";
export const SEAL_KEY = "c2VhbC1rZXktZm9yLXRlc3RzLW9ubHktMzItYnl0ZXMtbG9uZw"; // 37 bytes, test only
export const SLACK_SECRET = "slack-client-secret-value-123";
export const NOTION_SECRET = "notion-client-secret-value-456";

export const ENV = {
  HERMIT_RELAY_PUBLIC_URL: PUBLIC_URL,
  HERMIT_RELAY_SEAL_KEY: SEAL_KEY,
  HERMIT_RELAY_PROVIDERS: "slack,notion",
  HERMIT_RELAY_SLACK_CLIENT_ID: "123.456",
  HERMIT_RELAY_SLACK_CLIENT_SECRET: SLACK_SECRET,
  HERMIT_RELAY_NOTION_CLIENT_ID: "notion-client-1",
  HERMIT_RELAY_NOTION_CLIENT_SECRET: NOTION_SECRET,
};

export function config(over: Record<string, string | undefined> = {}): RelayConfig {
  const loaded = loadConfig({ ...ENV, ...over });
  if (!loaded.ok) throw new Error(loaded.errors.join("; "));
  return loaded.config;
}

export interface UpstreamCall {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string;
}

/** A provider token endpoint: records what the relay sent, answers what the test says. */
export function upstream(answer: (call: UpstreamCall) => { status: number; body: string } | Promise<never> = () => ({ status: 200, body: JSON.stringify({ ok: true, access_token: "xoxb-real-token", token_type: "bot", scope: "chat:write", team: { name: "Acme" } }) })) {
  const calls: UpstreamCall[] = [];
  const fetch: UpstreamFetch = async (url, init) => {
    const call = { url, method: init.method, headers: { ...init.headers }, body: init.body };
    calls.push(call);
    const a = await answer(call);
    return { status: a.status, text: async () => a.body };
  };
  return { calls, fetch };
}

let seed = 1;
/** Deterministic bytes for tests (the server uses node:crypto's randomBytes). */
export function random(n: number): Uint8Array {
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i += 32) out.set(createHash("sha256").update(`seed-${seed++}`).digest().subarray(0, Math.min(32, n - i)), i);
  return out;
}

export function relay(over: Partial<RelayDeps> & { config?: RelayConfig } = {}) {
  const logs: Array<Record<string, unknown>> = [];
  const up = upstream();
  let now = 1_800_000_000_000;
  const deps: RelayDeps = { fetch: up.fetch, now: () => now, random, log: (l) => logs.push(l), ...over };
  const handle = createRelay(over.config ?? config(), deps);
  /** The phone's transport, straight into the handler (the HTTP layer has its own test). */
  const transport: ConnectorTransport = {
    async send(req) {
      const path = req.url.slice(PUBLIC_URL.length);
      const body = typeof req.body === "string" ? req.body : (req.body?.reveal() ?? "");
      const res = await handle({ method: req.method, url: path, headers: Object.fromEntries(Object.entries(req.headers).map(([k, v]) => [k.toLowerCase(), v])), body, clientKey: "phone" });
      return { status: res.status, body: res.body };
    },
  };
  return { handle, transport, logs, upstream: up, advance: (ms: number) => void (now += ms), now: () => now };
}
