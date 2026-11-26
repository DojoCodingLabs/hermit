import {
  beginAppSignIn,
  finishAppSignIn,
  isPublicHost,
  oauthProviders,
  revokeRequest,
  Secret,
  type AppRedirect,
  type AppSignInProblem,
  type ConnectorTransport,
  type PendingAppSignIn,
  type SignInConfig,
  type SignInOption,
  type SignInSettings,
} from "@hermit/connectors";
import type { CredentialStorePort } from "@hermit/core";
import { MAIL_CONNECTOR_IDS, type ImapServer, type MailAccount, type MailAccountStore, type SmtpServer } from "./accounts.ts";
import type { MailCache } from "./cache.ts";
import type { MailDrafts } from "./drafts.ts";
import { gmailAddress, GMAIL_PROFILE_URL } from "./gmail.ts";
import { graphAddress, GRAPH_PROFILE_URL } from "./graph.ts";
import type { ImapPort } from "./imap.ts";

export type OAuthMailKind = "gmail" | "outlook";

/**
 * Only what the mail skills use (FR-CONN-03). SL-49 adds writing: Gmail's gmail.modify covers reading, sending,
 * drafts, labels and archiving in one scope; Graph needs Mail.ReadWrite (drafts, move, flags) and Mail.Send.
 * Accounts connected with the read-only scopes of SL-48 get "sign in again" on their first write.
 */
export const MAIL_OAUTH: Readonly<Record<OAuthMailKind, { provider: string; scopes: readonly string[]; profileUrl: string; address(profile: unknown): string }>> = {
  gmail: { provider: "google", scopes: ["https://www.googleapis.com/auth/gmail.modify"], profileUrl: GMAIL_PROFILE_URL, address: gmailAddress },
  outlook: {
    provider: "microsoft",
    // offline_access is what makes Microsoft return a refresh token; User.Read gives the address.
    scopes: ["offline_access", "https://graph.microsoft.com/User.Read", "https://graph.microsoft.com/Mail.ReadWrite", "https://graph.microsoft.com/Mail.Send"],
    profileUrl: GRAPH_PROFILE_URL,
    address: graphAddress,
  },
};

export interface MailConnectDeps {
  credentials: CredentialStorePort;
  accounts: MailAccountStore;
  transport: ConnectorTransport;
  /** IMAP accounts only. */
  imap?: ImapPort;
  now(): number;
  newId(): string;
}

/** How this mail provider signs in with the current settings (HM-CONN-05): the user's own client ID, else Dojo's. */
export function mailSignInOption(kind: OAuthMailKind, settings: SignInSettings, config: SignInConfig): SignInOption {
  const provider = MAIL_OAUTH[kind].provider;
  const own = settings.ownClientIds[provider];
  const dojo = config.dojoClientIds[provider];
  if (own) return { method: "oauth_pkce", provider, available: true, source: "own_client", clientId: own };
  if (dojo) return { method: "oauth_pkce", provider, available: true, source: "dojo_client", clientId: dojo };
  return { method: "oauth_pkce", provider, available: false, unavailable: "needs_client_id" };
}

/**
 * What the app keeps (in memory) between opening the system browser and the redirect coming back: the shared phone
 * sign-in's pending state (it holds the PKCE verifier) and which mail provider it is for.
 */
export type PendingMailOAuth = PendingAppSignIn & { kind: OAuthMailKind };

/**
 * The URL for the system browser (FR-CONN-03): PKCE S256 with a fresh state, through `beginAppSignIn` from
 * @hermit/connectors with the mail scopes. `random` is at least 48 bytes from the platform's secure random source: 32
 * for the verifier, 16 for the state. The redirect is the provider's (`appRedirectUri`) unless one is given.
 */
export function startMailOAuth(kind: OAuthMailKind, option: SignInOption, input: { redirectUri?: string; random: Uint8Array; now?: number }): { url: string; pending: PendingMailOAuth } {
  const provider = oauthProviders[MAIL_OAUTH[kind].provider]!;
  const { url, pending } = beginAppSignIn(provider, option, { scopes: MAIL_OAUTH[kind].scopes, random: input.random, ...(input.now !== undefined ? { now: input.now } : {}), ...(input.redirectUri ? { redirectUri: input.redirectUri } : {}) });
  return { url, pending: { ...pending, kind } };
}

export type MailConnectProblem = AppSignInProblem | "profile_failed"
  | "invalid_address" | "missing_password" | "invalid_host" | "invalid_port" | "auth_failed" | "unreachable";

export type MailConnectResult = { ok: true; account: MailAccount } | { ok: false; problem: MailConnectProblem };

/**
 * The redirect came back: `finishAppSignIn` checks the state, the expiry and the cancel before any request, swaps the
 * code for tokens from the phone and checks the granted scopes; then the address is learned, and only then are the
 * tokens stored in the credential store and the account (without secrets). Signing in again to an address already
 * connected replaces its tokens in place (US-MAIL-08 keeps accounts apart).
 */
export async function finishMailOAuth(deps: MailConnectDeps, pending: PendingMailOAuth, callback: AppRedirect): Promise<MailConnectResult> {
  const spec = MAIL_OAUTH[pending.kind];
  const provider = oauthProviders[spec.provider]!;
  const done = await finishAppSignIn(deps, provider, pending, callback);
  if (!done.ok) return done;
  const parsed = done.token;

  // Nothing is stored until the address is known: a failed profile call leaves no half-connected account.
  let address = "";
  try {
    const res = await deps.transport.send({
      method: "GET",
      url: spec.profileUrl,
      headers: { Accept: "application/json" },
      auth: { in: "header", name: "Authorization", value: new Secret(`Bearer ${parsed.secret.accessToken}`) },
      maxResponseBytes: 16_384,
    });
    if (res.status < 400) address = spec.address(JSON.parse(res.body) as unknown).trim().toLowerCase();
  } catch {
    address = "";
  }
  if (!ADDRESS.test(address)) return { ok: false, problem: "profile_failed" };
  const meta = {
    connectorId: MAIL_CONNECTOR_IDS[pending.kind], kind: "oauth2" as const, source: pending.source, clientId: pending.clientId,
    scopes: parsed.scopes ?? [...spec.scopes], createdAt: deps.now(), ...(parsed.expiresAt ? { expiresAt: parsed.expiresAt } : {}),
  };

  const existing = (await deps.accounts.list()).find((a) => a.provider === pending.kind && a.address === address);
  const account: MailAccount = existing ?? { id: deps.newId(), provider: pending.kind, address, credentialId: deps.newId(), createdAt: deps.now() };
  await deps.credentials.save({ id: account.credentialId, ...meta, account: address }, parsed.secret);
  await deps.accounts.save(account);
  return { ok: true, account };
}

/** Servers for providers whose IMAP settings are well known; Gmail and Outlook sign in with OAuth instead. */
const PRESETS: Record<string, { imap: ImapServer; smtp: SmtpServer }> = {
  "fastmail.com": { imap: { host: "imap.fastmail.com", port: 993 }, smtp: { host: "smtp.fastmail.com", port: 465, security: "tls" } },
  "icloud.com": { imap: { host: "imap.mail.me.com", port: 993 }, smtp: { host: "smtp.mail.me.com", port: 587, security: "starttls" } },
  "me.com": { imap: { host: "imap.mail.me.com", port: 993 }, smtp: { host: "smtp.mail.me.com", port: 587, security: "starttls" } },
  "yahoo.com": { imap: { host: "imap.mail.yahoo.com", port: 993 }, smtp: { host: "smtp.mail.yahoo.com", port: 465, security: "tls" } },
};
const GMAIL_DOMAINS = new Set(["gmail.com", "googlemail.com"]);
const OUTLOOK_DOMAINS = new Set(["outlook.com", "hotmail.com", "live.com", "msn.com"]);
const ADDRESS = /^[^\s@<>()",;]{1,64}@([a-z0-9-]+(\.[a-z0-9-]+)+)$/i;

/** HM-MAIL-01: which way to connect an address, with known IMAP servers filled in. */
export function suggestMailSetup(address: string): { provider: "gmail" | "outlook" } | { provider: "imap"; imap?: ImapServer; smtp?: SmtpServer } {
  const domain = ADDRESS.exec(address.trim())?.[1]?.toLowerCase() ?? "";
  if (GMAIL_DOMAINS.has(domain)) return { provider: "gmail" };
  if (OUTLOOK_DOMAINS.has(domain)) return { provider: "outlook" };
  const preset = PRESETS[domain];
  return preset ? { provider: "imap", imap: { ...preset.imap }, smtp: { ...preset.smtp } } : { provider: "imap" };
}

export interface ImapConnectInput {
  address: string;
  /** The app password the user typed on HM-MAIL-01, never in the chat. */
  password: string;
  /** Defaults to the address. */
  username?: string;
  imap: { host: string; port?: number };
  smtp: { host: string; port?: number };
}

/**
 * An IMAP account with an app password (FR-MAIL-01): implicit TLS for IMAP (993), TLS (465) or STARTTLS
 * (587) for SMTP, public hosts only. The login is checked before anything is stored.
 */
export async function connectImap(deps: MailConnectDeps, input: ImapConnectInput): Promise<MailConnectResult> {
  const address = input.address.trim().toLowerCase();
  if (!ADDRESS.test(address)) return { ok: false, problem: "invalid_address" };
  if (!input.password) return { ok: false, problem: "missing_password" };
  const imapHost = input.imap.host.trim().toLowerCase();
  const smtpHost = input.smtp.host.trim().toLowerCase();
  if (!isPublicHost(imapHost) || !isPublicHost(smtpHost)) return { ok: false, problem: "invalid_host" };
  const imapPort = input.imap.port ?? 993;
  const smtpPort = input.smtp.port ?? 465;
  if (imapPort !== 993 || (smtpPort !== 465 && smtpPort !== 587)) return { ok: false, problem: "invalid_port" };
  const imap: ImapServer = { host: imapHost, port: imapPort };
  const smtp: SmtpServer = { host: smtpHost, port: smtpPort, security: smtpPort === 465 ? "tls" : "starttls" };
  const username = (input.username ?? address).trim();

  if (!deps.imap) return { ok: false, problem: "unreachable" };
  let checked: Awaited<ReturnType<ImapPort["verify"]>>;
  try {
    checked = await deps.imap.verify(imap, { username, password: new Secret(input.password) });
  } catch {
    checked = "unreachable";
  }
  if (checked !== "ok") return { ok: false, problem: checked };

  const existing = (await deps.accounts.list()).find((a) => a.provider === "imap" && a.address === address);
  const account: MailAccount = { ...(existing ?? { id: deps.newId(), credentialId: deps.newId(), createdAt: deps.now() }), provider: "imap", address, imap, smtp };
  await deps.credentials.save(
    { id: account.credentialId, connectorId: MAIL_CONNECTOR_IDS.imap, kind: "basic", source: "user_entered", account: address, scopes: [], createdAt: deps.now() },
    { kind: "basic", username, password: input.password },
  );
  await deps.accounts.save(account);
  return { ok: true, account };
}

/**
 * Disconnect (US-CONN-02, FR-MAIL-05): the account, its cached messages and its tokens go first; then the
 * token is revoked where the provider supports it (Google). Local deletion never waits on the provider.
 */
export async function disconnectMail(deps: MailConnectDeps & { cache?: MailCache; drafts?: MailDrafts }, accountId: string): Promise<{ deleted: boolean; revoked: "yes" | "unsupported" | "failed" }> {
  const account = await deps.accounts.get(accountId);
  if (!account) return { deleted: false, revoked: "unsupported" };
  const secret = await deps.credentials.reveal(account.credentialId);
  await deps.accounts.delete(accountId);
  deps.cache?.clearAccount(accountId);
  deps.drafts?.clearAccount(accountId);
  const deleted = await deps.credentials.delete(account.credentialId);
  const provider = account.provider === "imap" ? undefined : oauthProviders[MAIL_OAUTH[account.provider].provider];
  const token = secret?.kind === "oauth2" ? (secret.refreshToken ?? secret.accessToken) : undefined;
  const request = provider && token ? revokeRequest(provider, token) : undefined;
  if (!request) return { deleted, revoked: "unsupported" };
  try {
    const res = await deps.transport.send(request);
    return { deleted, revoked: res.status < 400 ? "yes" : "failed" };
  } catch {
    return { deleted, revoked: "failed" };
  }
}
