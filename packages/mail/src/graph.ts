import { oauthProviders } from "@hermit/connectors";
import { systemLabel } from "@hermit/skills";
import type { MailAccount } from "./accounts.ts";
import { callJson, getJson, inBatches, isObj, MESSAGE_BYTES, query, str } from "./http.ts";
import type { MailHeader, MailNetDeps, MailProvider, MailQuery, MailResult, OutgoingMail } from "./provider.ts";
import { htmlToText, plainText } from "./text.ts";

/** Microsoft Graph v1.0 mail (https://learn.microsoft.com/en-us/graph/api/user-list-messages). */
export const GRAPH_BASE = "https://graph.microsoft.com/v1.0/me";
const SELECT = "id,from,subject,receivedDateTime,bodyPreview,isRead";
const SELECT_FULL = "id,from,toRecipients,ccRecipients,subject,receivedDateTime,body,isRead";
// Graph only orders by a property that the filter names first (otherwise "InefficientFilter").
const UNREAD_FILTER = "receivedDateTime ge 1900-01-01T00:00:00Z and isRead eq false";

/** A $search value (KQL): the model's quotes and backslashes are removed so they can't end the phrase. */
export function graphSearch(q: MailQuery): string {
  const clean = (v: string | undefined) => (v ?? "").replace(/["\\]/g, " ").replace(/\s+/g, " ").trim();
  const from = clean(q.from).replace(/\s+/g, "");
  return `"${[from ? `from:${from}` : "", clean(q.words)].filter(Boolean).join(" ")}"`;
}

const address = (v: unknown): string => {
  const e = isObj(v) && isObj(v.emailAddress) ? v.emailAddress : undefined;
  if (!e) return "";
  const name = str(e.name);
  const addr = str(e.address);
  return name && addr && name !== addr ? `${name} <${addr}>` : addr || name;
};

function toHeader(m: unknown, accountId: string): MailHeader | undefined {
  if (!isObj(m) || !str(m.id)) return undefined;
  const at = Date.parse(str(m.receivedDateTime));
  return {
    id: str(m.id),
    accountId,
    from: address(m.from),
    subject: str(m.subject),
    at: Number.isFinite(at) ? at : 0,
    preview: plainText(str(m.bodyPreview)).replace(/\s+/g, " "),
    unread: m.isRead === false,
  };
}

export function createGraphProvider(deps: MailNetDeps, account: MailAccount): MailProvider {
  const microsoft = oauthProviders.microsoft;
  const get = (url: string, opts?: Parameters<typeof getJson>[4]) => getJson(deps, microsoft, account.credentialId, url, opts);
  const call = (method: "POST" | "PATCH", url: string, json: unknown) => callJson(deps, microsoft, account.credentialId, method, url, { json });
  const many = async (url: string) => {
    const r = await get(url);
    if (!r.ok) return r;
    const items = isObj(r.value) && Array.isArray(r.value.value) ? r.value.value : [];
    return { ok: true as const, value: items.map((m) => toHeader(m, account.id)).filter((h): h is MailHeader => h !== undefined) };
  };
  return {
    list: ({ unreadOnly, max }) =>
      many(`${GRAPH_BASE}/mailFolders/inbox/messages?${query([["$top", max], ["$select", SELECT], ["$orderby", "receivedDateTime desc"], ...(unreadOnly ? [["$filter", UNREAD_FILTER] as [string, string]] : [])])}`),
    // $search can't be combined with $orderby; Graph returns the best matches.
    search: (q, max) => many(`${GRAPH_BASE}/messages?${query([["$search", graphSearch(q)], ["$top", max], ["$select", SELECT]])}`),
    async read(id) {
      if (!id || id.length > 512) return { ok: false, problem: "not_found" };
      const r = await get(`${GRAPH_BASE}/messages/${encodeURIComponent(id)}?${query([["$select", SELECT_FULL]])}`, {
        headers: { Prefer: 'outlook.body-content-type="text"' },
        maxBytes: MESSAGE_BYTES,
      });
      if (!r.ok) return r;
      const h = toHeader(r.value, account.id);
      if (!h || !isObj(r.value)) return { ok: false, problem: "provider_error" };
      const body = isObj(r.value.body) ? r.value.body : {};
      const content = str(body.content);
      const list = (v: unknown) => (Array.isArray(v) ? v.map(address).filter(Boolean) : []);
      return {
        ok: true,
        value: { ...h, to: list(r.value.toRecipients), cc: list(r.value.ccRecipients), text: str(body.contentType).toLowerCase() === "html" ? htmlToText(content) : plainText(content) },
      };
    },
    async authResults(id) {
      if (!validId(id)) return notFound;
      const r = await get(`${GRAPH_BASE}/messages/${encodeURIComponent(id)}?${query([["$select", "internetMessageHeaders"]])}`);
      if (!r.ok) return r;
      const headers = isObj(r.value) && Array.isArray(r.value.internetMessageHeaders) ? r.value.internetMessageHeaders : [];
      // In the message's order: the first is the one Exchange Online added on receipt.
      return { ok: true, value: headers.filter((x) => isObj(x) && str(x.name).toLowerCase() === "authentication-results").map((x) => str((x as { value?: unknown }).value)) };
    },
    async send(mail) {
      // A reply goes through Graph's reply action so it joins the thread; the recipients and subject are the
      // ones the sheet showed, never Graph's own pick (it would follow a Reply-To header).
      const r = mail.inReplyTo !== undefined
        ? validId(mail.inReplyTo)
          ? await call("POST", `${GRAPH_BASE}/messages/${encodeURIComponent(mail.inReplyTo)}/reply`, { message: { subject: mail.subject, ...recipientsOf(mail) }, comment: mail.text })
          : notFound
        : await call("POST", `${GRAPH_BASE}/sendMail`, { message: newMessage(mail), saveToSentItems: true });
      return r.ok ? { ok: true, value: undefined } : r;
    },
    async saveDraft(mail) {
      const r = mail.inReplyTo !== undefined
        ? validId(mail.inReplyTo)
          ? await call("POST", `${GRAPH_BASE}/messages/${encodeURIComponent(mail.inReplyTo)}/createReply`, { message: { subject: mail.subject, ...recipientsOf(mail) }, comment: mail.text })
          : notFound
        : await call("POST", `${GRAPH_BASE}/messages`, newMessage(mail));
      return r.ok ? { ok: true, value: undefined } : r;
    },
    async modify(ids, change) {
      // A category doesn't move mail, but the same rule holds everywhere: a well-known folder's name (Deleted
      // Items, Junk Email, Inbox) is never a label, so no sheet or provider ever treats it as one.
      if (change.kind === "label" && systemLabel(change.label)) return { ok: false, problem: "reserved_label" };
      const valid = ids.filter(validId);
      const one =async (id: string): Promise<MailResult<number>> => {
        const url = `${GRAPH_BASE}/messages/${encodeURIComponent(id)}`;
        let r: MailResult<unknown>;
        if (change.kind === "archive") r = await call("POST", `${url}/move`, { destinationId: "archive" });
        else if (change.kind === "mark_read") r = await call("PATCH", url, { isRead: true });
        else {
          // Graph's categories are the labels; PATCH replaces the list, so the current ones are kept.
          const current = await get(`${url}?${query([["$select", "categories"]])}`);
          if (!current.ok) return current;
          const have = isObj(current.value) && Array.isArray(current.value.categories) ? current.value.categories.filter((c): c is string => typeof c === "string") : [];
          if (have.some((c) => c.toLowerCase() === change.label.toLowerCase())) return { ok: true, value: 1 };
          r = await call("PATCH", url, { categories: [...have, change.label] });
        }
        return r.ok ? { ok: true, value: 1 } : r;
      };
      const results = await inBatches(valid, 5, one);
      // A message deleted meanwhile is skipped; any other failure is the call's answer.
      const failed = results.find((r) => !r.ok && r.problem !== "not_found");
      if (failed) return failed;
      return { ok: true, value: results.filter((r) => r.ok).length };
    },
  };
}

const notFound = { ok: false as const, problem: "not_found" as const };
const validId = (id: string) => Boolean(id) && id.length <= 512;
const recipient = (address: string) => ({ emailAddress: { address } });
const recipientsOf = (mail: OutgoingMail) => ({ toRecipients: mail.to.map(recipient), ccRecipients: mail.cc.map(recipient) });
const newMessage = (mail: OutgoingMail) => ({ subject: mail.subject, body: { contentType: "Text", content: mail.text }, ...recipientsOf(mail) });

/** The signed-in address (User.Read). */
export const GRAPH_PROFILE_URL = `${GRAPH_BASE}?$select=mail,userPrincipalName`;
export const graphAddress = (profile: unknown) => (isObj(profile) ? str(profile.mail) || str(profile.userPrincipalName) : "");
