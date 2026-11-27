# Hermit sign-in relay

The optional sign-in relay (FR-CONN-07, PDR-022, US-CONN-09) is a reference you can host yourself. Some services demand a client secret. The relay swaps an authorization code for tokens using a secret that never reaches the phone. It returns the tokens encrypted to a key the phone made for that one sign-in. It stores nothing.

The protocol is in [`packages/connectors/src/relay-protocol.ts`](../../packages/connectors/src/relay-protocol.ts). Hermit works without this relay.

## Run

Node 24 or newer, from a checkout of the Hermit repository. No build step.

```sh
node apps/relay/src/main.ts
```

Put the relay behind an HTTPS proxy. TLS ends at that proxy.

## Environment

Secrets go in the environment only. Never put them in a file in the repository or on a command line. Errors name the variable, never its value.

| Variable | Meaning | Default |
| --- | --- | --- |
| `HERMIT_RELAY_PUBLIC_URL` | Public https address of the relay on a public host, with no trailing slash, for example `https://relay.example.org`. The redirect URI is this address plus `/v1/callback`. | none, required |
| `HERMIT_RELAY_SEAL_KEY` | 32 or more random bytes in base64url. Generate them with `openssl rand -base64 32 | tr '+/' '-_' | tr -d '='`. Rotating the key fails sign-ins under way. | none, required |
| `HERMIT_RELAY_PROVIDERS` | Comma-separated allowlist of provider ids that need a secret, for example `slack,notion`. Providers that take a public client from the phone are refused. | none, required |
| `HERMIT_RELAY_<ID>_CLIENT_ID` and `HERMIT_RELAY_<ID>_CLIENT_SECRET` | Your own OAuth app credentials for each listed id. Register `<HERMIT_RELAY_PUBLIC_URL>/v1/callback` as the redirect URI. Use the uppercase provider id for `<ID>`. | none, required for each provider |
| `HERMIT_RELAY_HOST` | Bind address. Put the HTTPS proxy in front. | `127.0.0.1` |
| `HERMIT_RELAY_PORT` | Port, from 1 to 65535. | `8787` |
| `HERMIT_RELAY_TRUST_PROXY` | `1` to rate-limit by the proxy's `X-Forwarded-For` instead of the socket address. | off |
| `HERMIT_RELAY_RATE_PER_MINUTE` | Requests per client per minute, from 1 to 10000. | `30` |

## In Hermit

Open Settings, Sign-in options, My own relay, then paste `HERMIT_RELAY_PUBLIC_URL`.
