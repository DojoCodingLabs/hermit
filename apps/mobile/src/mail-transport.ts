// SL-48 and SL-49: the network for Gmail and Outlook (FR-PRIV-02, FR-CONN-03). packages/mail builds every request
// (fixed provider URLs, the token as a Secret); this checks the address against the providers' exact hosts before
// anything else, so nothing else is ever counted or contacted, then counts it for the privacy screen and sends it with
// `redirect: "manual"` (a redirect is never followed) and no cookies, revealing the token only into the request, and
// stops reading at the request's cap. Pure, so it runs on Node with a fake fetch; ./adapters/mail.ts gives it expo/fetch.
import { mailRequestAllowed } from "@hermit/mail/hosts";
import { fetchInit, landedAt, type McpRequestLike } from "./mcp-request.ts";
import { decodeBody, readCapped, type ChunkReader } from "./web-body.ts";

/** The part of a fetch response the transport reads. */
export interface MailFetchResponse {
  status: number;
  url?: string | null;
  redirected: boolean;
  body: { getReader(): ChunkReader } | null;
}

export type MailFetch = (url: string, init: ReturnType<typeof fetchInit>["init"] & { signal?: AbortSignal }) => Promise<MailFetchResponse>;

export interface MailTransportLike {
  send(req: McpRequestLike): Promise<{ status: number; body: string }>;
}

export function createMailTransport(deps: { fetch: MailFetch; count(url: string): void; timeoutMs: number }): MailTransportLike {
  return {
    async send(req) {
      if (!mailRequestAllowed(req.url)) throw new TypeError("refused: not a mail provider's host");
      // Counted by the address as built, before a credential is revealed into it (the counter keeps only the host).
      deps.count(req.url);
      const { url, init } = fetchInit(req);
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), deps.timeoutMs);
      try {
        const res = await deps.fetch(url, { ...init, signal: controller.signal });
        if (!landedAt(url, res.url, res.redirected)) throw new TypeError("refused: redirected");
        const reader = res.body?.getReader();
        const { bytes, truncated } = reader ? await readCapped(reader, req.maxResponseBytes) : { bytes: new Uint8Array(), truncated: false };
        if (truncated) controller.abort();
        return { status: res.status, body: decodeBody(bytes, "application/json; charset=utf-8") };
      } finally {
        clearTimeout(timer);
      }
    },
  };
}
