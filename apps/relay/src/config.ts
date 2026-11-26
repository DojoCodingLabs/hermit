// The relay's configuration, from the environment only (never a file, never a command-line argument: a process
// listing would show it). Errors name the variable, never its value.
import { oauthProviders, type OAuthProvider } from "@hermit/connectors/oauth-providers";
import { fromBase64url, RELAY_PATHS, RELAY_PROVIDER_ID } from "@hermit/connectors/relay-protocol";

export interface RelayProviderConfig {
  provider: OAuthProvider;
  clientId: string;
  clientSecret: string;
}

export interface RelayConfig {
  /** Where the phone and the browser reach the relay, behind the HTTPS proxy. No trailing slash. */
  publicUrl: string;
  /** `publicUrl` + `/v1/callback`: the redirect URI registered with each provider. */
  callback: string;
  /** Seals codes in flight. Rotating it only fails sign-ins under way. */
  sealKey: Uint8Array;
  /** The allowlist, in the order given. */
  providers: Map<string, RelayProviderConfig>;
  port: number;
  host: string;
  /** Behind a proxy that appends X-Forwarded-For: rate-limit by its last entry instead of the socket address. */
  trustProxy: boolean;
  ratePerMinute: number;
}

type Env = Record<string, string | undefined>;

const PRINTABLE = /^[\x21-\x7e]{1,512}$/;
const PRIVATE_HOST = /^(localhost|.*\.(local|internal|localhost|lan|home\.arpa))$/;

function publicUrl(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return undefined;
  }
  const host = u.hostname.toLowerCase();
  if (u.protocol !== "https:" || u.username || u.password || u.search || u.hash || (u.port && u.port !== "443")) return undefined;
  // An exact public name: no IP literal, no private suffix.
  if (!host.includes(".") || /^[0-9.]+$/.test(host) || host.startsWith("[") || PRIVATE_HOST.test(host)) return undefined;
  const path = u.pathname.replace(/\/+$/, "");
  return `https://${host}${path}`;
}

const int = (raw: string | undefined, fallback: number) => (raw === undefined || raw === "" ? fallback : /^\d+$/.test(raw) ? Number(raw) : NaN);

export function loadConfig(env: Env): { ok: true; config: RelayConfig } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  const base = publicUrl(env.HERMIT_RELAY_PUBLIC_URL);
  if (!base) errors.push("HERMIT_RELAY_PUBLIC_URL must be the relay's public https address on a public host");
  const sealKey = env.HERMIT_RELAY_SEAL_KEY ? fromBase64url(env.HERMIT_RELAY_SEAL_KEY) : undefined;
  if (!sealKey || sealKey.length < 32) errors.push("HERMIT_RELAY_SEAL_KEY must be at least 32 random bytes, base64url");

  const providers = new Map<string, RelayProviderConfig>();
  const ids = (env.HERMIT_RELAY_PROVIDERS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  if (!ids.length) errors.push("HERMIT_RELAY_PROVIDERS must list at least one provider");
  for (const id of ids) {
    const provider = RELAY_PROVIDER_ID.test(id) && Object.hasOwn(oauthProviders, id) ? oauthProviders[id] : undefined;
    if (!provider) {
      errors.push(`${id} is not a provider Hermit knows`);
      continue;
    }
    if (provider.publicClient) {
      errors.push(`${id} takes a public client from the phone: it needs no relay`);
      continue;
    }
    const name = `HERMIT_RELAY_${id.toUpperCase()}`;
    const clientId = env[`${name}_CLIENT_ID`];
    const clientSecret = env[`${name}_CLIENT_SECRET`];
    if (!clientId || !PRINTABLE.test(clientId) || clientId.length > 200) errors.push(`${name}_CLIENT_ID is missing or not printable`);
    if (!clientSecret || !PRINTABLE.test(clientSecret)) errors.push(`${name}_CLIENT_SECRET is missing or not printable`);
    if (clientId && clientSecret) providers.set(id, { provider, clientId, clientSecret });
  }

  const port = int(env.HERMIT_RELAY_PORT, 8787);
  if (!(port >= 1 && port <= 65_535)) errors.push("HERMIT_RELAY_PORT must be 1 to 65535");
  const ratePerMinute = int(env.HERMIT_RELAY_RATE_PER_MINUTE, 30);
  if (!(ratePerMinute >= 1 && ratePerMinute <= 10_000)) errors.push("HERMIT_RELAY_RATE_PER_MINUTE must be 1 to 10000");
  const host = env.HERMIT_RELAY_HOST || "127.0.0.1";

  if (errors.length || !base || !sealKey) return { ok: false, errors };
  return {
    ok: true,
    config: { publicUrl: base, callback: `${base}${RELAY_PATHS.callback}`, sealKey, providers, port, host, trustProxy: env.HERMIT_RELAY_TRUST_PROXY === "1", ratePerMinute },
  };
}
