import { oauthProviders } from "@hermit/connectors";
import { systemLabel } from "@hermit/skills";
import type { MailAccount } from "./accounts.ts";
import { callJson, getJson, inBatches, isObj, LIST_BYTES, MESSAGE_BYTES, query, str } from "./http.ts";
import { buildMime, bytesToBase64, utf8Encode } from "./mime.ts";
import type { MailHeader, MailMessage, MailNetDeps, MailProvider, MailQuery, MailResult, OutgoingMail } from "./provider.ts";
import { decodeBase64Text, decodeEntities, htmlToText, plainText, splitAddresses } from "./text.ts";

/** Gmail API v1 (https://developers.google.com/gmail/api/reference/rest). gmail.modify covers read, send, drafts and labels (SL-49). */
export const GMAIL_BASE = "https://gmail.googleapis.com/gmail/v1/users/me";
const GMAIL_ID = /^[A-Za-z0-9_-]{1,128}$/;
const PARALLEL = 5;

/** A Gmail search query from the model's words and sender; grouping characters it wrote are removed. */
export function gmailQuery(q: MailQuery & { unreadOnly?: boolean }): string {
  const clean = (v: string | undefined) => (v ?? "").replace(/"/g, "").replace(/[(){}]/g, " ").replace(/\s+/g, " ").trim();
  const from = clean(q.from);
  return [from ? `from:(${from})` : "", clean(q.words), q.unreadOnly ? "is:unread" : ""].filter(Boolean).join(" ");
}

type Part = { mimeType?: unknown; headers?: unknown; body?: unknown; parts?: unknown };

function header(payload: unknown, name: string): string {
  const headers = isObj(payload) && Array.isArray(payload.headers) ? payload.headers : [];
  const h = headers.find((x) => isObj(x) && str(x.name).toLowerCase() === name.toLowerCase());
  return isObj(h) ? str(h.value) : "";
}

function toHeader(m: unknown, accountId: string): MailHeader | undefined {
  if (!isObj(m) || !GMAIL_ID.test(str(m.id))) return undefined;
  const labels = Array.isArray(m.labelIds) ? m.labelIds : [];
  const at = Number(str(m.internalDate));
  return {
    id: str(m.id),
    accountId,
    from: header(m.payload, "From"),
    subject: header(m.payload, "Subject"),
    at: Number.isFinite(at) ? at : 0,
    preview: plainText(decodeEntities(str(m.snippet))),
    unread: labels.includes("UNREAD"),
  };
}

/** The body as text: the first text/plain part, else the first text/html part converted. */
function bodyText(payload: unknown): string {
  const find = (p: unknown, type: string, depth = 0): string | undefined => {
    if (!isObj(p) || depth > 8) return undefined;
    const part = p as Part;
    const data = isObj(part.body) ? str(part.body.data) : "";
    if (str(part.mimeType).toLowerCase() === type && data) return decodeBase64Text(data);
    for (const child of Array.isArray(part.parts) ? part.parts : []) {
      const hit = find(child, type, depth + 1);
      if (hit !== undefined) return hit;
    }
    return undefined;
  };
  const plain = find(payload, "text/plain");
  if (plain !== undefined) return plainText(plain);
  const html = find(payload, "text/html");
  return html !== undefined ? htmlToText(html) : "";
}

export function createGmailProvider(deps: MailNetDeps, account: MailAccount): MailProvider {
  const google = oauthProviders.google;
  const get = (url: string, maxBytes = LIST_BYTES) => getJson(deps, google, account.credentialId, url, { maxBytes });
  const post = (url: string, json: unknown) => callJson(deps, google, account.credentialId, "POST", url, { json });

  /** The raw message (base64url) and, for a reply, the thread it joins with the original's Message-ID. */
  const rawFor = async (mail: OutgoingMail): Promise<MailResult<{ raw: string; threadId?: string }>> => {
    let thread: { threadId?: string; messageId?: string; references?: string } = {};
    if (mail.inReplyTo !== undefined) {
      if (!GMAIL_ID.test(mail.inReplyTo)) return { ok: false, problem: "not_found" };
      const r = await get(`${GMAIL_BASE}/messages/${mail.inReplyTo}?${query([["format", "metadata"], ["metadataHeaders", "Message-ID"], ["metadataHeaders", "References"]])}`);
      if (!r.ok) return r;
      const threadId = isObj(r.value) ? str(r.value.threadId) : "";
      const payload = isObj(r.value) ? r.value.payload : undefined;
      thread = { ...(GMAIL_ID.test(threadId) ? { threadId } : {}), messageId: header(payload, "Message-ID"), references: header(payload, "References") };
    }
    const mime = buildMime({ ...mail, at: deps.now(), ...(thread.messageId ? { inReplyTo: thread.messageId } : {}), ...(thread.references ? { references: thread.references } : {}) });
    return { ok: true, value: { raw: bytesToBase64(utf8Encode(mime), true), ...(thread.threadId ? { threadId: thread.threadId } : {}) } };
  };

  /**
   * A user label's id by name (case-insensitive); created when it doesn't exist yet, as the user asked for it.
   * Only labels of type "user" count, and a name that collides with a system label is refused: "label as
   * trash" must never add TRASH (or SPAM, or remove nothing from INBOX) through a remote_write.
   */
  const labelId = async (name: string): Promise<MailResult<string>> => {
    if (systemLabel(name)) return { ok: false, problem: "reserved_label" };
    const listed = await get(`${GMAIL_BASE}/labels`);
    if (!listed.ok) return listed;
    const labels = isObj(listed.value) && Array.isArray(listed.value.labels) ? listed.value.labels : [];
    const hit = labels.find((l) => isObj(l) && l.type === "user" && str(l.name).toLowerCase() === name.toLowerCase());
    if (isObj(hit) && str(hit.id)) return { ok: true, value: str(hit.id) };
    const made = await post(`${GMAIL_BASE}/labels`, { name, labelListVisibility: "labelShow", messageListVisibility: "show" });
    if (!made.ok) return made;
    return isObj(made.value) && str(made.value.id) ? { ok: true, value: str(made.value.id) } : { ok: false, problem: "provider_error" };
  };

  const headersFor = async (q: string, max: number): Promise<MailResult<MailHeader[]>> => {
    const listed = await get(`${GMAIL_BASE}/messages?${query([["q", q], ["maxResults", max]])}`);
    if (!listed.ok) return listed;
    const ids = (isObj(listed.value) && Array.isArray(listed.value.messages) ? listed.value.messages : [])
      .map((m) => (isObj(m) ? str(m.id) : ""))
      .filter((id) => GMAIL_ID.test(id))
      .slice(0, max);
    const metaQuery = query([["format", "metadata"], ["metadataHeaders", "From"], ["metadataHeaders", "Subject"], ["metadataHeaders", "Date"]]);
    const fetched = await inBatches(ids, PARALLEL, (id) => get(`${GMAIL_BASE}/messages/${id}?${metaQuery}`));
    const out: MailHeader[] = [];
    for (const r of fetched) {
      // A message deleted between the list and the fetch is skipped; an auth failure fails the whole call.
      if (!r.ok) {
        if (r.problem === "not_found") continue;
        return r;
      }
      const h = toHeader(r.value, account.id);
      if (h) out.push(h);
    }
    return { ok: true, value: out };
  };

  return {
    list: ({ unreadOnly, max }) => headersFor(unreadOnly ? "in:inbox is:unread" : "in:inbox", max),
    search: (q, max) => headersFor(gmailQuery(q), max),
    async read(id) {
      if (!GMAIL_ID.test(id)) return { ok: false, problem: "not_found" };
      const r = await get(`${GMAIL_BASE}/messages/${id}?format=full`, MESSAGE_BYTES);
      if (!r.ok) return r;
      const h = toHeader(r.value, account.id);
      if (!h || !isObj(r.value)) return { ok: false, problem: "provider_error" };
      const payload = r.value.payload;
      const message: MailMessage = {
        ...h,
        to: splitAddresses(header(payload, "To")),
        cc: splitAddresses(header(payload, "Cc")),
        text: bodyText(payload),
      };
      return { ok: true, value: message };
    },
    async authResults(id) {
      if (!GMAIL_ID.test(id)) return { ok: false, problem: "not_found" };
      const r = await get(`${GMAIL_BASE}/messages/${id}?${query([["format", "metadata"], ["metadataHeaders", "Authentication-Results"]])}`);
      if (!r.ok) return r;
      const headers = isObj(r.value) && isObj(r.value.payload) && Array.isArray(r.value.payload.headers) ? r.value.payload.headers : [];
      // Gmail keeps the message's header order: the first is the one Gmail added on receipt.
      return { ok: true, value: headers.filter((x) => isObj(x) && str(x.name).toLowerCase() === "authentication-results").map((x) => str((x as { value?: unknown }).value)) };
    },
    async send(mail) {
      const r = await rawFor(mail);
      if (!r.ok) return r;
      const sent = await post(`${GMAIL_BASE}/messages/send`, r.value);
      return sent.ok ? { ok: true, value: undefined } : sent;
    },
    async saveDraft(mail) {
      const r = await rawFor(mail);
      if (!r.ok) return r;
      const saved = await post(`${GMAIL_BASE}/drafts`, { message: r.value });
      return saved.ok ? { ok: true, value: undefined } : saved;
    },
    async modify(ids, change) {
      const valid = ids.filter((id) => GMAIL_ID.test(id));
      if (!valid.length) return { ok: true, value: 0 };
      let labels: { addLabelIds?: string[]; removeLabelIds?: string[] };
      if (change.kind === "archive") labels = { removeLabelIds: ["INBOX"] };
      else if (change.kind === "mark_read") labels = { removeLabelIds: ["UNREAD"] };
      else {
        const id = await labelId(change.label);
        if (!id.ok) return id;
        labels = { addLabelIds: [id.value] };
      }
      // One call for up to 1000 ids (FR-MAIL-03 caps a request at 200).
      const r = await post(`${GMAIL_BASE}/messages/batchModify`, { ids: valid, ...labels });
      return r.ok ? { ok: true, value: valid.length } : r;
    },
  };
}

/** The signed-in address, right after the token exchange (gmail.readonly covers the profile). */
export const GMAIL_PROFILE_URL = `${GMAIL_BASE}/profile`;
export const gmailAddress = (profile: unknown) => (isObj(profile) ? str(profile.emailAddress) : "");
