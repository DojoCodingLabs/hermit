import type { CredentialSource } from "@hermit/core";
import { oauthProviders, type OAuthProvider } from "./oauth-providers.ts";
import { parseRelayBase } from "./relay.ts";
import type { ConnectorSpec } from "./spec.ts";

/** What the user chose on HM-CONN-05. Stored by the app; never holds a secret. */
export interface SignInSettings {
  /** The user's own OAuth client ID per provider (US-CONN-08, PDR-021). */
  ownClientIds: Record<string, string>;
  /** The user's own relay for providers that need a client secret (US-CONN-09). */
  ownRelayUrl?: string;
  /** Dojo's relay, off by default (US-CONN-10, PDR-022). */
  dojoRelayOptIn: boolean;
}

export const defaultSignInSettings: SignInSettings = Object.freeze({ ownClientIds: Object.freeze({}) as Record<string, string>, dojoRelayOptIn: false });

/** Build-time configuration the app supplies: Dojo's registered client IDs and relay, when they exist. */
export interface SignInConfig {
  dojoClientIds: Record<string, string>;
  dojoRelayUrl?: string;
}

export type UnavailableReason = "needs_client_id" | "no_own_relay" | "dojo_relay_off" | "no_dojo_relay" | "unknown_provider";

export interface SignInOption {
  method: "oauth_pkce" | "relay" | "api_key" | "basic";
  provider?: string;
  available: boolean;
  unavailable?: UnavailableReason;
  /** Where the tokens come from, recorded on the credential (CredentialMeta.source). */
  source?: CredentialSource;
  clientId?: string;
  /** The relay the code passes through; the privacy screen lists it when used (US-CONN-10). */
  relayUrl?: string;
}

/**
 * The ways this connector can sign in with the current settings, in the spec's order (HM-CONN-01, HM-CONN-05).
 * Unavailable options say why, so the screen can point to the fix.
 */
export function signInOptions(
  spec: ConnectorSpec,
  settings: SignInSettings,
  config: SignInConfig,
  providers: Record<string, OAuthProvider> = oauthProviders,
): SignInOption[] {
  const out: SignInOption[] = [];
  for (const auth of spec.auth) {
    switch (auth.type) {
      case "oauth2_pkce": {
        if (!providers[auth.provider]) {
          out.push({ method: "oauth_pkce", provider: auth.provider, available: false, unavailable: "unknown_provider" });
          break;
        }
        const own = settings.ownClientIds[auth.provider];
        const dojo = config.dojoClientIds[auth.provider];
        if (own) out.push({ method: "oauth_pkce", provider: auth.provider, available: true, source: "own_client", clientId: own });
        else if (dojo) out.push({ method: "oauth_pkce", provider: auth.provider, available: true, source: "dojo_client", clientId: dojo });
        else out.push({ method: "oauth_pkce", provider: auth.provider, available: false, unavailable: "needs_client_id" });
        break;
      }
      case "relay": {
        out.push(
          settings.ownRelayUrl
            ? { method: "relay", provider: auth.provider, available: true, source: "own_relay", relayUrl: settings.ownRelayUrl }
            : { method: "relay", provider: auth.provider, available: false, unavailable: "no_own_relay", source: "own_relay" },
        );
        if (!config.dojoRelayUrl) out.push({ method: "relay", provider: auth.provider, available: false, unavailable: "no_dojo_relay", source: "dojo_relay" });
        else if (!settings.dojoRelayOptIn) out.push({ method: "relay", provider: auth.provider, available: false, unavailable: "dojo_relay_off", source: "dojo_relay", relayUrl: config.dojoRelayUrl });
        else out.push({ method: "relay", provider: auth.provider, available: true, source: "dojo_relay", relayUrl: config.dojoRelayUrl });
        break;
      }
      case "api_key":
        out.push({ method: "api_key", available: true, source: "user_entered" });
        break;
      case "basic":
        out.push({ method: "basic", available: true, source: "user_entered" });
        break;
      case "oauth2_dcr":
        // MCP servers with dynamic client registration arrive with SL-54.
        break;
    }
  }
  return out;
}

/** Checks a pasted client ID before it is saved (US-CONN-08). */
export function validateClientId(provider: string, clientId: string, providers: Record<string, OAuthProvider> = oauthProviders): boolean {
  if (!/^[\x21-\x7e]{1,200}$/.test(clientId)) return false;
  const pattern = providers[provider]?.clientIdPattern;
  return pattern ? new RegExp(pattern).test(clientId) : true;
}

/**
 * A relay URL must be HTTPS on an exact public host, port 443, with no user info or query (US-CONN-09). The same
 * check the relay client runs before any request (`parseRelayBase`), so a private, LAN or loopback host is refused.
 */
export function validateRelayUrl(url: string): boolean {
  return parseRelayBase(url) !== undefined;
}
