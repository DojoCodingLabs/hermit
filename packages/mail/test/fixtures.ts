import { MemoryCredentialStore, type ConnectorRequest, type ConnectorResponse } from "@hermit/connectors";
import type { CredentialMeta, CredentialSecret } from "@hermit/core";
import { MemoryMailAccountStore, type MailAccount } from "../src/index.ts";

export const NOW = Date.UTC(2026, 10, 14, 15, 0);
export const GMAIL_TOKEN = "ya29.gmail-access-token-123456";
export const GRAPH_TOKEN = "EwB-graph-access-token-654321";

type Route = [string | RegExp, (req: ConnectorRequest) => ConnectorResponse];

/** Answers by URL; anything unrouted is a 404. Records every request. */
export class FakeTransport {
  sent: ConnectorRequest[] = [];
  constructor(public routes: Route[] = []) {}
  on(match: string | RegExp, reply: (req: ConnectorRequest) => ConnectorResponse): this {
    this.routes.push([match, reply]);
    return this;
  }
  async send(req: ConnectorRequest): Promise<ConnectorResponse> {
    this.sent.push(req);
    const hit = this.routes.find(([m]) => (typeof m === "string" ? req.url.startsWith(m) : m.test(req.url)));
    return hit ? hit[1](req) : { status: 404, body: "{}" };
  }
  urls(): string[] {
    return this.sent.map((r) => decodeURIComponent(r.url));
  }
}

export const json = (body: unknown, status = 200): ConnectorResponse => ({ status, body: JSON.stringify(body) });
export const b64url = (text: string) => Buffer.from(text, "utf8").toString("base64url");

export function oauthMeta(over: Partial<CredentialMeta> = {}): CredentialMeta {
  return { id: "cred-g", connectorId: "gmail", kind: "oauth2", source: "dojo_client", clientId: "c.apps.googleusercontent.com", scopes: [], createdAt: NOW - 1000, expiresAt: NOW + 3_600_000, ...over };
}

export async function stores(accounts: Array<{ account: MailAccount; meta?: CredentialMeta; secret?: CredentialSecret }>) {
  const credentials = new MemoryCredentialStore();
  const store = new MemoryMailAccountStore();
  for (const a of accounts) {
    await store.save(a.account);
    if (a.meta) await credentials.save(a.meta, a.secret ?? { kind: "oauth2", accessToken: GMAIL_TOKEN });
  }
  return { credentials, accounts: store };
}

export const gmailAccount: MailAccount = { id: "acc-g", provider: "gmail", address: "ana@gmail.com", credentialId: "cred-g", createdAt: NOW - 1000 };
export const outlookAccount: MailAccount = { id: "acc-o", provider: "outlook", address: "ana@contoso.com", label: "work", credentialId: "cred-o", createdAt: NOW - 900 };
export const imapAccount: MailAccount = {
  id: "acc-i", provider: "imap", address: "ana@fastmail.com", credentialId: "cred-i", createdAt: NOW - 800,
  imap: { host: "imap.fastmail.com", port: 993 }, smtp: { host: "smtp.fastmail.com", port: 465, security: "tls" },
};

/** A Gmail metadata message, as messages.get?format=metadata returns it. */
export function gmailMeta(id: string, over: { from?: string; subject?: string; at?: number; snippet?: string; unread?: boolean } = {}) {
  return {
    id,
    threadId: `t${id}`,
    labelIds: ["INBOX", ...(over.unread === false ? [] : ["UNREAD"])],
    snippet: over.snippet ?? "Tu vuelo AV 123 est&aacute; confirmado. Ma&ntilde;ana &#39;7:00&#39; &amp; puerta 4",
    internalDate: String(over.at ?? NOW - 3_600_000),
    payload: {
      headers: [
        { name: "From", value: over.from ?? "Avianca <noreply@avianca.com>" },
        { name: "Subject", value: over.subject ?? "Confirmación de vuelo" },
        { name: "Date", value: "Sat, 14 Nov 2026 08:00:00 -0600" },
      ],
    },
  };
}
