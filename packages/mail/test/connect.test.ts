import { describe, expect, it } from "vitest";
import { createPkce, defaultSignInSettings, MemoryCredentialStore, Secret } from "@hermit/connectors";
import {
  connectImap,
  disconnectMail,
  MailDrafts,
  finishMailOAuth,
  MailCache,
  mailSignInOption,
  MemoryMailAccountStore,
  startMailOAuth,
  suggestMailSetup,
  type ImapPort,
} from "../src/index.ts";
import { FakeTransport, gmailAccount, json, NOW, oauthMeta } from "./fixtures.ts";

const RANDOM = new Uint8Array(48).map((_, i) => (i * 37 + 11) % 256);
const REDIRECT = "https://hermit.dojocoding.io/oauth/callback";
const config = { dojoClientIds: { google: "123-dojo.apps.googleusercontent.com" } };

function deps(transport = new FakeTransport(), imap?: ImapPort) {
  let n = 0;
  return { credentials: new MemoryCredentialStore(), accounts: new MemoryMailAccountStore(), transport, now: () => NOW, newId: () => `id${++n}`, ...(imap ? { imap } : {}) };
}

describe("connecting Gmail and Outlook with OAuth in the system browser (US-MAIL-01, FR-MAIL-01)", () => {
  it("the sign-in option follows HM-CONN-05: the user's own client first, Dojo's next, or says a client ID is missing", () => {
    expect(mailSignInOption("gmail", defaultSignInSettings, config)).toMatchObject({ available: true, source: "dojo_client", clientId: "123-dojo.apps.googleusercontent.com" });
    expect(mailSignInOption("gmail", { ...defaultSignInSettings, ownClientIds: { google: "9-mine.apps.googleusercontent.com" } }, config)).toMatchObject({ source: "own_client", clientId: "9-mine.apps.googleusercontent.com" });
    expect(mailSignInOption("outlook", defaultSignInSettings, config)).toMatchObject({ available: false, unavailable: "needs_client_id" });
  });

  it("starts PKCE with only the read scopes and a fresh state", () => {
    const option = mailSignInOption("gmail", defaultSignInSettings, config);
    const { url, pending } = startMailOAuth("gmail", option, { redirectUri: REDIRECT, random: RANDOM });
    const u = new URL(url);
    expect(u.origin + u.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(u.searchParams.get("scope")).toBe("https://www.googleapis.com/auth/gmail.modify");
    expect(u.searchParams.get("code_challenge")).toBe(createPkce(RANDOM.slice(0, 32)).challenge);
    expect(u.searchParams.get("client_id")).toBe("123-dojo.apps.googleusercontent.com");
    expect(u.searchParams.get("state")).toBe(pending.state);
    expect(pending.state.length).toBeGreaterThanOrEqual(16);
    expect(url).not.toContain(pending.verifier);

    const outlook = startMailOAuth("outlook", { method: "oauth_pkce", provider: "microsoft", available: true, source: "own_client", clientId: "00000000-0000-0000-0000-000000000001" }, { redirectUri: REDIRECT, random: RANDOM });
    expect(new URL(outlook.url).searchParams.get("scope")).toBe("offline_access https://graph.microsoft.com/User.Read https://graph.microsoft.com/Mail.ReadWrite https://graph.microsoft.com/Mail.Send");
  });

  it("refuses an unavailable option and weak randomness", () => {
    expect(() => startMailOAuth("outlook", mailSignInOption("outlook", defaultSignInSettings, config), { redirectUri: REDIRECT, random: RANDOM })).toThrow();
    expect(() => startMailOAuth("gmail", mailSignInOption("gmail", defaultSignInSettings, config), { redirectUri: REDIRECT, random: new Uint8Array(32) })).toThrow();
  });

  it("finishes: exchanges the code, learns the address, stores the tokens in the credential store and the account without secrets", async () => {
    const t = new FakeTransport()
      .on("https://oauth2.googleapis.com/token", () => json({ access_token: "ya29.new-access-token-1", refresh_token: "1//new-refresh-token-2", expires_in: 3599, scope: "https://www.googleapis.com/auth/gmail.modify" }))
      .on("https://gmail.googleapis.com/gmail/v1/users/me/profile", () => json({ emailAddress: "ana@gmail.com", messagesTotal: 10 }));
    const d = deps(t);
    const { pending } = startMailOAuth("gmail", mailSignInOption("gmail", defaultSignInSettings, config), { redirectUri: REDIRECT, random: RANDOM });
    const r = await finishMailOAuth(d, pending, { code: "4/code-xyz", state: pending.state });
    expect(r).toEqual({ ok: true, account: { id: "id1", provider: "gmail", address: "ana@gmail.com", credentialId: "id2", createdAt: NOW } });
    expect(t.sent[0]!.body).toBeInstanceOf(Secret);
    expect(t.sent[1]!.auth?.value.reveal()).toBe("Bearer ya29.new-access-token-1");
    expect(await d.credentials.get("id2")).toEqual({
      id: "id2", connectorId: "gmail", kind: "oauth2", source: "dojo_client", account: "ana@gmail.com", clientId: "123-dojo.apps.googleusercontent.com",
      scopes: ["https://www.googleapis.com/auth/gmail.modify"], createdAt: NOW, expiresAt: NOW + 3_599_000,
    });
    expect(await d.credentials.reveal("id2")).toEqual({ kind: "oauth2", accessToken: "ya29.new-access-token-1", refreshToken: "1//new-refresh-token-2" });
    expect(JSON.stringify(await d.accounts.list())).not.toMatch(/ya29|1\/\//);
  });

  it("a second account is listed separately; signing in again to the same address replaces its tokens in place (US-MAIL-08)", async () => {
    let address = "ana@gmail.com";
    const t = new FakeTransport()
      .on("https://oauth2.googleapis.com/token", () => json({ access_token: "ya29.a-token-0000001", expires_in: 3600 }))
      .on("https://gmail.googleapis.com/gmail/v1/users/me/profile", () => json({ emailAddress: address }));
    const d = deps(t);
    const start = () => startMailOAuth("gmail", mailSignInOption("gmail", defaultSignInSettings, config), { redirectUri: REDIRECT, random: RANDOM }).pending;
    const first = start();
    await finishMailOAuth(d, first, { code: "c", state: first.state });
    address = "ana.work@gmail.com";
    const second = start();
    await finishMailOAuth(d, second, { code: "c", state: second.state });
    address = "ana@gmail.com";
    const again = start();
    const r = await finishMailOAuth(d, again, { code: "c", state: again.state });
    expect((await d.accounts.list()).map((a) => a.address)).toEqual(["ana@gmail.com", "ana.work@gmail.com"]);
    expect(r.ok && r.account.id).toBe("id1");
    expect((await d.credentials.list()).length).toBe(2);
  });

  it("a sign-in that didn't grant the scopes Hermit asked for stores nothing and says so (Google lets the user untick one)", async () => {
    const t = new FakeTransport()
      .on("https://oauth2.googleapis.com/token", () => json({ access_token: "ya29.partial-access-token", expires_in: 3600, scope: "openid https://www.googleapis.com/auth/gmail.readonly" }))
      .on("https://gmail.googleapis.com/gmail/v1/users/me/profile", () => json({ emailAddress: "ana@gmail.com" }));
    const d = deps(t);
    const { pending } = startMailOAuth("gmail", mailSignInOption("gmail", defaultSignInSettings, config), { redirectUri: REDIRECT, random: RANDOM });
    expect(await finishMailOAuth(d, pending, { code: "c", state: pending.state })).toEqual({ ok: false, problem: "missing_scopes" });
    // The token was never used: no profile call, nothing stored.
    expect(t.urls()).toEqual(["https://oauth2.googleapis.com/token"]);
    expect(await d.credentials.list()).toEqual([]);
    expect(await d.accounts.list()).toEqual([]);
  });

  it("Microsoft's granted scopes match with or without the Graph prefix, in any case; no scope field means no check", async () => {
    for (const scope of ["Mail.ReadWrite Mail.Send User.Read", "https://graph.microsoft.com/mail.readwrite https://graph.microsoft.com/mail.send https://graph.microsoft.com/user.read", undefined]) {
      const t = new FakeTransport()
        .on("https://login.microsoftonline.com/common/oauth2/v2.0/token", () => json({ access_token: "EwB-token-0001", refresh_token: "M.R3-refresh", expires_in: 3600, ...(scope ? { scope } : {}) }))
        .on("https://graph.microsoft.com/v1.0/me", () => json({ mail: "ana@outlook.com", userPrincipalName: "ana@outlook.com" }));
      const d = deps(t);
      const option = { method: "oauth_pkce" as const, provider: "microsoft", available: true, source: "own_client" as const, clientId: "00000000-0000-0000-0000-000000000001" };
      const { pending } = startMailOAuth("outlook", option, { redirectUri: REDIRECT, random: RANDOM });
      expect((await finishMailOAuth(d, pending, { code: "c", state: pending.state })).ok, String(scope)).toBe(true);
    }
    const t = new FakeTransport().on("https://login.microsoftonline.com/common/oauth2/v2.0/token", () => json({ access_token: "EwB-token-0002", expires_in: 3600, scope: "User.Read Mail.Read" }));
    const option = { method: "oauth_pkce" as const, provider: "microsoft", available: true, source: "own_client" as const, clientId: "00000000-0000-0000-0000-000000000001" };
    const { pending } = startMailOAuth("outlook", option, { redirectUri: REDIRECT, random: RANDOM });
    expect(await finishMailOAuth(deps(t), pending, { code: "c", state: pending.state })).toEqual({ ok: false, problem: "missing_scopes" });
  });

  it("a wrong state, a cancelled sign-in or a refused exchange stores nothing", async () => {
    const t = new FakeTransport().on("https://oauth2.googleapis.com/token", () => json({ error: "invalid_grant" }, 400));
    const d = deps(t);
    const { pending } = startMailOAuth("gmail", mailSignInOption("gmail", defaultSignInSettings, config), { redirectUri: REDIRECT, random: RANDOM });
    expect(await finishMailOAuth(d, pending, { code: "c", state: "forged" })).toEqual({ ok: false, problem: "state_mismatch" });
    expect(t.sent).toEqual([]);
    expect(await finishMailOAuth(d, pending, { error: "access_denied", state: pending.state })).toEqual({ ok: false, problem: "cancelled" });
    expect(await finishMailOAuth(d, pending, { code: "c", state: pending.state })).toEqual({ ok: false, problem: "exchange_failed" });
    expect(await d.credentials.list()).toEqual([]);
    expect(await d.accounts.list()).toEqual([]);
  });
});

describe("connecting any other provider with IMAP, SMTP and an app password (US-MAIL-01)", () => {
  const imapOk = (result: Awaited<ReturnType<ImapPort["verify"]>> = "ok"): ImapPort & { logins: unknown[] } => {
    const logins: unknown[] = [];
    return { logins, verify: async (server, login) => (logins.push([server, login]), result), search: async () => [], fetch: async () => undefined };
  };
  const input = { address: "ana@fastmail.com", password: "app-password-xyz", imap: { host: "imap.fastmail.com" }, smtp: { host: "smtp.fastmail.com" } };

  it("suggests OAuth for Gmail and Outlook addresses, and known servers for others", () => {
    expect(suggestMailSetup("ana@gmail.com")).toEqual({ provider: "gmail" });
    expect(suggestMailSetup("ana@hotmail.com")).toEqual({ provider: "outlook" });
    expect(suggestMailSetup("ana@fastmail.com")).toEqual({ provider: "imap", imap: { host: "imap.fastmail.com", port: 993 }, smtp: { host: "smtp.fastmail.com", port: 465, security: "tls" } });
    expect(suggestMailSetup("ana@empresa.cr")).toEqual({ provider: "imap" });
  });

  it("verifies the login over TLS first, then stores the password in the credential store and the servers on the account", async () => {
    const imap = imapOk();
    const d = deps(new FakeTransport(), imap);
    const r = await connectImap(d, input);
    expect(r).toEqual({
      ok: true,
      account: { id: "id1", provider: "imap", address: "ana@fastmail.com", credentialId: "id2", createdAt: NOW, imap: { host: "imap.fastmail.com", port: 993 }, smtp: { host: "smtp.fastmail.com", port: 465, security: "tls" } },
    });
    const [, login] = imap.logins[0] as [unknown, { username: string; password: Secret }];
    expect(login.username).toBe("ana@fastmail.com");
    expect(login.password.reveal()).toBe("app-password-xyz");
    expect(await d.credentials.get("id2")).toMatchObject({ connectorId: "imap_mail", kind: "basic", source: "user_entered", account: "ana@fastmail.com" });
    expect(await d.credentials.reveal("id2")).toEqual({ kind: "basic", username: "ana@fastmail.com", password: "app-password-xyz" });
    expect(JSON.stringify(await d.accounts.list())).not.toContain("app-password-xyz");
  });

  it("refuses private hosts, plain-text ports and bad addresses before connecting; a failed login stores nothing", async () => {
    const imap = imapOk();
    const d = deps(new FakeTransport(), imap);
    expect(await connectImap(d, { ...input, address: "not an address" })).toEqual({ ok: false, problem: "invalid_address" });
    expect(await connectImap(d, { ...input, imap: { host: "192.168.1.10" } })).toEqual({ ok: false, problem: "invalid_host" });
    expect(await connectImap(d, { ...input, imap: { host: "mail.local" } })).toEqual({ ok: false, problem: "invalid_host" });
    expect(await connectImap(d, { ...input, imap: { host: "imap.fastmail.com", port: 143 } })).toEqual({ ok: false, problem: "invalid_port" });
    expect(await connectImap(d, { ...input, smtp: { host: "smtp.fastmail.com", port: 25 } })).toEqual({ ok: false, problem: "invalid_port" });
    expect(await connectImap(d, { ...input, password: "" })).toEqual({ ok: false, problem: "missing_password" });
    expect(imap.logins).toEqual([]);
    expect(await connectImap(deps(new FakeTransport(), imapOk("auth_failed")), input)).toEqual({ ok: false, problem: "auth_failed" });
    expect(await connectImap(deps(new FakeTransport(), imapOk("unreachable")), input)).toEqual({ ok: false, problem: "unreachable" });
    expect(await connectImap(deps(new FakeTransport()), input)).toEqual({ ok: false, problem: "unreachable" });
    expect(await d.credentials.list()).toEqual([]);
  });

  it("SMTP on 587 is STARTTLS", async () => {
    const r = await connectImap(deps(new FakeTransport(), imapOk()), { ...input, smtp: { host: "smtp.fastmail.com", port: 587 } });
    expect(r.ok && r.account.smtp).toEqual({ host: "smtp.fastmail.com", port: 587, security: "starttls" });
  });
});

describe("disconnecting a mail account (US-CONN-02, FR-MAIL-05)", () => {
  it("deletes the tokens, the account and its cached messages, then revokes at Google", async () => {
    const t = new FakeTransport().on("https://oauth2.googleapis.com/revoke", () => json({}));
    const d = deps(t);
    await d.accounts.save(gmailAccount);
    await d.credentials.save(oauthMeta(), { kind: "oauth2", accessToken: "ya29.x-token-1234567", refreshToken: "1//r-token-1234567" });
    const cache = new MailCache();
    cache.put({ id: "a1", accountId: "acc-g", from: "x", subject: "y", at: 1, preview: "", unread: true });
    const drafts = new MailDrafts();
    drafts.add({ accountId: "acc-g", from: "ana@gmail.com", to: [], cc: [], subject: "", body: "x", savedAt: 1 });
    const r = await disconnectMail({ ...d, cache, drafts }, "acc-g");
    expect(r).toEqual({ deleted: true, revoked: "yes" });
    expect(drafts.get("d1")).toBeUndefined();
    expect(await d.accounts.list()).toEqual([]);
    expect(await d.credentials.list()).toEqual([]);
    expect(cache.get("m1")).toBeUndefined();
    expect(t.sent[0]!.body).toBeInstanceOf(Secret);
    expect(await disconnectMail({ ...d, cache }, "acc-g")).toEqual({ deleted: false, revoked: "unsupported" });
  });
});
