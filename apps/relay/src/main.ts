// Hermit's sign-in relay (FR-CONN-07, PDR-022, US-CONN-09), the reference you can host yourself. It swaps an
// authorization code for tokens using a client secret that never reaches the phone, returns the tokens encrypted to a
// key the phone made for that one sign-in, and stores nothing. Protocol: packages/connectors/src/relay-protocol.ts.
//
// Run (Node 24 or newer, from a checkout of the Hermit repository; no build step):
//   node apps/relay/src/main.ts
//
// Environment (secrets only here, never in a file in the repository or on a command line):
//   HERMIT_RELAY_PUBLIC_URL      the public https address, e.g. https://relay.example.org (TLS ends at your proxy)
//   HERMIT_RELAY_SEAL_KEY        32 or more random bytes, base64url: openssl rand -base64 32 | tr '+/' '-_' | tr -d '='
//   HERMIT_RELAY_PROVIDERS       the allowlist, e.g. slack,notion (providers in Hermit's table that need a secret)
//   HERMIT_RELAY_<ID>_CLIENT_ID and HERMIT_RELAY_<ID>_CLIENT_SECRET for each, from your own OAuth app, whose
//                                redirect URI is <HERMIT_RELAY_PUBLIC_URL>/v1/callback
//   HERMIT_RELAY_HOST            bind address, default 127.0.0.1 (put the HTTPS proxy in front)
//   HERMIT_RELAY_PORT            default 8787
//   HERMIT_RELAY_TRUST_PROXY     "1" to rate-limit by the proxy's X-Forwarded-For instead of the socket address
//   HERMIT_RELAY_RATE_PER_MINUTE requests per client per minute, default 30
//
// Then in Hermit: Settings, Sign-in options, My own relay, and paste HERMIT_RELAY_PUBLIC_URL.
import { randomBytes } from "node:crypto";
import process from "node:process";
import { loadConfig } from "./config.ts";
import { startRelay } from "./server.ts";

const loaded = loadConfig(process.env);
if (!loaded.ok) {
  for (const e of loaded.errors) process.stderr.write(`hermit-relay: ${e}\n`);
  process.exit(1);
}
const { config } = loaded;
const server = startRelay(config, {
  // Never follows a redirect: a token endpoint that redirects is treated as unavailable.
  fetch: (url, init) => fetch(url, { ...init, redirect: "manual", signal: AbortSignal.timeout(10_000) }),
  now: Date.now,
  random: (n) => new Uint8Array(randomBytes(n)),
  log: (line) => process.stdout.write(`${JSON.stringify(line)}\n`),
});
server.on("listening", () => process.stdout.write(`${JSON.stringify({ at: new Date().toISOString(), listening: `${config.host}:${config.port}`, providers: [...config.providers.keys()] })}\n`));
for (const signal of ["SIGINT", "SIGTERM"] as const) process.on(signal, () => server.close(() => process.exit(0)));
