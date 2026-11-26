import { describe, expect, it } from "vitest";
import { Secret } from "@hermit/connectors";
import {
  gmailQuery,
  graphSearch,
  imapCriteria,
  ImapAuthError,
  mailProviderFor,
  type ImapFetched,
  type ImapPort,
} from "../src/index.ts";
import {
  b64url, FakeTransport, gmailAccount, gmailMeta, GMAIL_TOKEN, GRAPH_TOKEN, imapAccount, json, NOW, oauthMeta, outlookAccount, stores,
} from "./fixtures.ts";

const GMAIL = "https://gmail.googleapis.com/gmail/v1/users/me";
const GRAPH = "https://graph.microsoft.com/v1.0/me";

async function gmail(transport: FakeTransport, meta = oauthMeta()) {
  const s = await stores([{ account: gmailAccount, meta, secret: { kind: "oauth2", accessToken: GMAIL_TOKEN, refreshToken: "1//refresh-token-abc" } }]);
  return { ...s, provider: mailProviderFor({ ...s, transport, now: () => NOW }, gmailAccount) };
}

describe("Gmail through the connector transport (FR-MAIL-01, FR-MAIL-02)", () => {
  it("lists unread inbox mail: ids first, then each message's headers, with the token injected only as a Secret", async () => {
    const t = new FakeTransport()
      .on(`${GMAIL}/messages?`, () => json({ messages: [{ id: "a1" }, { id: "a2" }] }))
      .on(`${GMAIL}/messages/a1?`, () => json(gmailMeta("a1", { at: NOW - 60_000 })))
      .on(`${GMAIL}/messages/a2?`, () => json(gmailMeta("a2", { from: "Banco <avisos@banco.com>", subject: "Estado de cuenta", unread: false })));
    const { provider } = await gmail(t);
    const r = await provider.list({ unreadOnly: true, max: 20 });
    expect(t.urls()[0]).toBe(`${GMAIL}/messages?q=in:inbox is:unread&maxResults=20`);
    expect(t.urls()[1]).toBe(`${GMAIL}/messages/a1?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date`);
    expect(r).toEqual({
      ok: true,
      value: [
        { id: "a1", accountId: "acc-g", from: "Avianca <noreply@avianca.com>", subject: "Confirmación de vuelo", at: NOW - 60_000, preview: "Tu vuelo AV 123 está confirmado. Mañana '7:00' & puerta 4", unread: true },
        { id: "a2", accountId: "acc-g", from: "Banco <avisos@banco.com>", subject: "Estado de cuenta", at: NOW - 3_600_000, preview: "Tu vuelo AV 123 está confirmado. Mañana '7:00' & puerta 4", unread: false },
      ],
    });
    for (const req of t.sent) {
      expect(req.method).toBe("GET");
      expect(new URL(req.url).host).toBe("gmail.googleapis.com");
      expect(req.auth?.value).toBeInstanceOf(Secret);
      expect(req.auth?.value.reveal()).toBe(`Bearer ${GMAIL_TOKEN}`);
      expect(JSON.stringify(req)).not.toContain(GMAIL_TOKEN);
    }
  });

  it("an empty inbox is an empty list, with no further requests", async () => {
    const t = new FakeTransport().on(`${GMAIL}/messages?`, () => json({ resultSizeEstimate: 0 }));
    const { provider } = await gmail(t);
    expect(await provider.list({ unreadOnly: false, max: 5 })).toEqual({ ok: true, value: [] });
    expect(t.urls()).toEqual([`${GMAIL}/messages?q=in:inbox&maxResults=5`]);
  });

  it("searches with Gmail's own query language", async () => {
    expect(gmailQuery({ words: "flight confirmation", from: "Avianca" })).toBe("from:(Avianca) flight confirmation");
    // Parentheses and quotes from the model can't break out of the from group.
    expect(gmailQuery({ from: 'x) OR (label:"secret' })).toBe("from:(x OR label:secret)");
    const t = new FakeTransport().on(`${GMAIL}/messages?`, () => json({ messages: [] }));
    const { provider } = await gmail(t);
    await provider.search({ words: "renta", from: "hacienda" }, 10);
    expect(t.urls()).toEqual([`${GMAIL}/messages?q=from:(hacienda) renta&maxResults=10`]);
  });

  it("reads one message: the plain text part, or the HTML part as text", async () => {
    const full = (payload: unknown) => json({ ...gmailMeta("a1"), payload });
    const headers = [
      { name: "From", value: "Avianca <noreply@avianca.com>" },
      { name: "To", value: "Ana <ana@gmail.com>, Luis <luis@x.com>" },
      { name: "Cc", value: "ops@avianca.com" },
      { name: "Subject", value: "Confirmación" },
    ];
    const t = new FakeTransport().on(`${GMAIL}/messages/a1?format=full`, () => full({
      mimeType: "multipart/alternative", headers,
      parts: [
        { mimeType: "text/plain", body: { data: b64url("Hola Ana,\nTu vuelo sale a las 7:00.") } },
        { mimeType: "text/html", body: { data: b64url("<p>ignored</p>") } },
      ],
    }));
    const { provider } = await gmail(t);
    expect(await provider.read("a1")).toMatchObject({ ok: true, value: { id: "a1", to: ["Ana <ana@gmail.com>", "Luis <luis@x.com>"], cc: ["ops@avianca.com"], subject: "Confirmación", text: "Hola Ana,\nTu vuelo sale a las 7:00." } });

    const html = new FakeTransport().on(`${GMAIL}/messages/a1?format=full`, () => full({
      mimeType: "multipart/mixed", headers,
      parts: [{ mimeType: "multipart/alternative", parts: [{ mimeType: "text/html", body: { data: b64url("<style>p{}</style><p>Hola&nbsp;Ana</p><script>x()</script><br>Puerta <b>4</b>") } }] }],
    }));
    const r = await (await gmail(html)).provider.read("a1");
    expect(r.ok && r.value.text).toBe("Hola Ana\nPuerta 4");
  });

  it("refuses a message id that isn't one Gmail would issue, before any request", async () => {
    const t = new FakeTransport();
    const { provider } = await gmail(t);
    expect(await provider.read("../profile")).toEqual({ ok: false, problem: "not_found" });
    expect(t.sent).toEqual([]);
  });

  it("refreshes an expiring token first; a 401 means sign in again; a 5xx or a throw is a provider problem", async () => {
    const t = new FakeTransport()
      .on("https://oauth2.googleapis.com/token", () => json({ access_token: "ya29.fresh-token-777777", expires_in: 3600 }))
      .on(`${GMAIL}/messages?`, () => json({ messages: [] }));
    const { provider } = await gmail(t, oauthMeta({ expiresAt: NOW - 1 }));
    await provider.list({ unreadOnly: true, max: 1 });
    expect(t.sent.map((r) => new URL(r.url).host)).toEqual(["oauth2.googleapis.com", "gmail.googleapis.com"]);
    expect(t.sent[1]!.auth?.value.reveal()).toBe("Bearer ya29.fresh-token-777777");

    for (const [status, problem] of [[401, "sign_in_again"], [403, "sign_in_again"], [500, "provider_error"], [429, "provider_error"]] as const) {
      const r = await (await gmail(new FakeTransport().on(GMAIL, () => json({}, status)))).provider.list({ unreadOnly: true, max: 1 });
      expect(r, String(status)).toEqual({ ok: false, problem });
    }
    const down = new FakeTransport();
    down.send = async () => { throw new Error("offline"); };
    expect(await (await gmail(down)).provider.list({ unreadOnly: true, max: 1 })).toEqual({ ok: false, problem: "unreachable" });
  });

  it("no credential is not connected", async () => {
    const s = await stores([{ account: gmailAccount }]);
    const p = mailProviderFor({ ...s, transport: new FakeTransport(), now: () => NOW }, gmailAccount);
    expect(await p.list({ unreadOnly: true, max: 1 })).toEqual({ ok: false, problem: "not_connected" });
  });
});

describe("Outlook through Microsoft Graph", () => {
  async function graph(t: FakeTransport) {
    const s = await stores([{ account: outlookAccount, meta: oauthMeta({ id: "cred-o", connectorId: "outlook_mail" }), secret: { kind: "oauth2", accessToken: GRAPH_TOKEN } }]);
    return mailProviderFor({ ...s, transport: t, now: () => NOW }, outlookAccount);
  }
  const item = { id: "AAMkAGI2=", from: { emailAddress: { name: "Contoso HR", address: "hr@contoso.com" } }, subject: "Payroll", receivedDateTime: "2026-11-14T13:00:00Z", bodyPreview: "Your payslip  is\r\nready", isRead: false };

  it("lists the inbox newest first, unread through a filter that Graph accepts with the ordering", async () => {
    const t = new FakeTransport().on(`${GRAPH}/mailFolders/inbox/messages`, () => json({ value: [item] }));
    const r = await (await graph(t)).list({ unreadOnly: true, max: 20 });
    expect(t.urls()[0]).toBe(`${GRAPH}/mailFolders/inbox/messages?$top=20&$select=id,from,subject,receivedDateTime,bodyPreview,isRead&$orderby=receivedDateTime desc&$filter=receivedDateTime ge 1900-01-01T00:00:00Z and isRead eq false`);
    expect(t.sent[0]!.auth?.value.reveal()).toBe(`Bearer ${GRAPH_TOKEN}`);
    expect(r).toEqual({ ok: true, value: [{ id: "AAMkAGI2=", accountId: "acc-o", from: "Contoso HR <hr@contoso.com>", subject: "Payroll", at: Date.UTC(2026, 10, 14, 13), preview: "Your payslip is ready", unread: true }] });
  });

  it("searches with $search, with quotes removed from what the model wrote", async () => {
    expect(graphSearch({ words: 'payroll" OR "x', from: "hr@contoso.com" })).toBe('"from:hr@contoso.com payroll OR x"');
    const t = new FakeTransport().on(`${GRAPH}/messages?`, () => json({ value: [] }));
    await (await graph(t)).search({ words: "payroll" }, 10);
    expect(t.urls()[0]).toBe(`${GRAPH}/messages?$search="payroll"&$top=10&$select=id,from,subject,receivedDateTime,bodyPreview,isRead`);
  });

  it("reads a message as text, with the id percent-encoded in the path", async () => {
    const t = new FakeTransport().on(`${GRAPH}/messages/`, () => json({
      ...item, toRecipients: [{ emailAddress: { name: "Ana", address: "ana@contoso.com" } }], ccRecipients: [], body: { contentType: "text", content: "Your payslip is ready.\r\nHR" },
    }));
    const r = await (await graph(t)).read("AAMk/AGI2=");
    expect(t.sent[0]!.url).toMatch(/\/messages\/AAMk%2FAGI2%3D\?/);
    expect(t.urls()[0]).toBe(`${GRAPH}/messages/AAMk/AGI2=?$select=id,from,toRecipients,ccRecipients,subject,receivedDateTime,body,isRead`);
    expect(t.sent[0]!.headers.Prefer).toBe('outlook.body-content-type="text"');
    expect(r).toMatchObject({ ok: true, value: { to: ["Ana <ana@contoso.com>"], cc: [], text: "Your payslip is ready.\nHR" } });
  });
});

describe("IMAP through the app's IMAP port (app password)", () => {
  const fetched: ImapFetched = { uid: "41", from: "Fastmail <hi@fastmail.com>", to: ["ana@fastmail.com"], cc: [], subject: "Welcome", at: NOW - 5000, seen: false, text: "Welcome aboard" };

  function port(over: Partial<ImapPort> = {}): ImapPort & { calls: unknown[][] } {
    const calls: unknown[][] = [];
    return {
      calls,
      verify: async () => "ok",
      search: async (...a) => (calls.push(a), [fetched]),
      fetch: async (...a) => (calls.push(a), fetched),
      ...over,
    };
  }

  async function imap(p: ImapPort) {
    const s = await stores([{ account: imapAccount, meta: oauthMeta({ id: "cred-i", connectorId: "imap_mail", kind: "basic", source: "user_entered" }), secret: { kind: "basic", username: "ana@fastmail.com", password: "app-password-xyz" } }]);
    return mailProviderFor({ ...s, transport: new FakeTransport(), now: () => NOW, imap: p }, imapAccount);
  }

  it("builds SEARCH criteria from typed parts, with control characters removed so a value can't end the command", () => {
    expect(imapCriteria({ unreadOnly: true })).toEqual([{ key: "UNSEEN" }]);
    expect(imapCriteria({ words: "flight  confirmation", from: "Avianca\r\nA1 DELETE INBOX" })).toEqual([
      { key: "FROM", value: "AviancaA1 DELETE INBOX" },
      { key: "TEXT", value: "flight" },
      { key: "TEXT", value: "confirmation" },
    ]);
    expect(imapCriteria({})).toEqual([{ key: "ALL" }]);
  });

  it("lists and reads through the port with the password only as a Secret", async () => {
    const p = port();
    const provider = await imap(p);
    const r = await provider.list({ unreadOnly: true, max: 7 });
    const [server, login, req] = p.calls[0] as [unknown, { username: string; password: Secret }, unknown];
    expect(server).toEqual({ host: "imap.fastmail.com", port: 993 });
    expect(login.username).toBe("ana@fastmail.com");
    expect(login.password).toBeInstanceOf(Secret);
    expect(String(login.password)).toBe("[secret]");
    expect(req).toEqual({ mailbox: "INBOX", criteria: [{ key: "UNSEEN" }], limit: 7 });
    expect(r).toEqual({ ok: true, value: [{ id: "41", accountId: "acc-i", from: "Fastmail <hi@fastmail.com>", subject: "Welcome", at: NOW - 5000, preview: "Welcome aboard", unread: true }] });
    expect(await provider.read("41")).toMatchObject({ ok: true, value: { text: "Welcome aboard", to: ["ana@fastmail.com"] } });
  });

  it("a refused login means sign in again; anything else thrown is unreachable", async () => {
    expect(await (await imap(port({ search: async () => { throw new ImapAuthError(); } }))).list({ unreadOnly: true, max: 1 })).toEqual({ ok: false, problem: "sign_in_again" });
    expect(await (await imap(port({ search: async () => { throw new Error("tls"); } }))).list({ unreadOnly: true, max: 1 })).toEqual({ ok: false, problem: "unreachable" });
    expect(await (await imap(port({ fetch: async () => undefined }))).read("9")).toEqual({ ok: false, problem: "not_found" });
  });
});
