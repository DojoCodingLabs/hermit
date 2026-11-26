/**
 * Hermit's own OAuth provider table (FR-CONN-10, Apache 2.0). The field set follows Nango's providers file,
 * but every value here is written from the provider's own docs (cited in `docs`); Nango's file is under the
 * Elastic License and is not vendored.
 */
export interface OAuthProvider {
  id: string;
  name: string;
  authorizationUrl: string;
  tokenUrl: string;
  /** RFC 7009 revocation endpoint, when the provider has one (US-CONN-02). */
  revocationUrl?: string;
  /** Dynamic client registration endpoint (MCP servers, SL-54). */
  registrationUrl?: string;
  scopeSeparator: " " | ",";
  /** Supports PKCE (S256). */
  pkce: boolean;
  /** Issues tokens to a client without a secret, so the phone can sign in alone. False means a relay (PDR-022). */
  publicClient: boolean;
  /** Extra query parameters on the authorization URL. */
  authorizationParams?: Record<string, string>;
  /**
   * For providers that need a relay (SL-57): how the relay sends its client secret to the token endpoint (HTTP Basic
   * or in the body, the default) and the body's format (form, the default, or JSON).
   */
  clientSecretIn?: "basic" | "body";
  tokenRequestFormat?: "form" | "json";
  /** Shape of a client ID, checked before the user's own one is saved (HM-CONN-05). */
  clientIdPattern?: string;
  docs: string;
}

export const oauthProviders: Readonly<Record<string, OAuthProvider>> = {
  google: {
    id: "google",
    name: "Google",
    authorizationUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: "https://oauth2.googleapis.com/token",
    revocationUrl: "https://oauth2.googleapis.com/revoke",
    scopeSeparator: " ",
    pkce: true,
    publicClient: true,
    // Without these Google returns no refresh token.
    authorizationParams: { access_type: "offline", prompt: "consent" },
    clientIdPattern: "^[0-9A-Za-z-]+\\.apps\\.googleusercontent\\.com$",
    docs: "https://developers.google.com/identity/protocols/oauth2/native-app",
  },
  microsoft: {
    id: "microsoft",
    name: "Microsoft",
    authorizationUrl: "https://login.microsoftonline.com/common/oauth2/v2.0/authorize",
    tokenUrl: "https://login.microsoftonline.com/common/oauth2/v2.0/token",
    scopeSeparator: " ",
    pkce: true,
    publicClient: true,
    clientIdPattern: "^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$",
    docs: "https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth2-auth-code-flow",
  },
  spotify: {
    id: "spotify",
    name: "Spotify",
    authorizationUrl: "https://accounts.spotify.com/authorize",
    tokenUrl: "https://accounts.spotify.com/api/token",
    scopeSeparator: " ",
    pkce: true,
    publicClient: true,
    clientIdPattern: "^[0-9a-f]{32}$",
    docs: "https://developer.spotify.com/documentation/web-api/tutorials/code-pkce-flow",
  },
  github: {
    id: "github",
    name: "GitHub",
    authorizationUrl: "https://github.com/login/oauth/authorize",
    tokenUrl: "https://github.com/login/oauth/access_token",
    scopeSeparator: " ",
    pkce: false,
    publicClient: false,
    docs: "https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps",
  },
  notion: {
    id: "notion",
    name: "Notion",
    authorizationUrl: "https://api.notion.com/v1/oauth/authorize",
    tokenUrl: "https://api.notion.com/v1/oauth/token",
    scopeSeparator: " ",
    pkce: false,
    publicClient: false,
    authorizationParams: { owner: "user" },
    // Notion's token endpoint takes the client ID and secret as HTTP Basic, with a JSON body.
    clientSecretIn: "basic",
    tokenRequestFormat: "json",
    docs: "https://developers.notion.com/docs/authorization",
  },
  slack: {
    id: "slack",
    name: "Slack",
    authorizationUrl: "https://slack.com/oauth/v2/authorize",
    tokenUrl: "https://slack.com/api/oauth.v2.access",
    scopeSeparator: ",",
    pkce: false,
    publicClient: false,
    docs: "https://api.slack.com/authentication/oauth-v2",
  },
};
