// SL-57: the network for sign-in relays (HM-CONN-05). packages/connectors checks every relay address first (HTTPS, an
// exact public host, port 443, no userinfo: no private, LAN or loopback host) and reads every answer strictly; this
// only sends. It uses expo/fetch with `redirect: "manual"` (the built-in fetch follows redirects, OkHttp even from
// HTTPS to HTTP), wrapped by `counted` from ./net, the same rule as countedFetch: every host counted for the privacy
// screen, and a URL whose host can't be read is refused. A response from anywhere but the requested address fails.
import { fetch as expoFetch } from "expo/fetch";
import type { ConnectorTransport } from "@hermit/runtime";
import { decodeBody, readCapped } from "../web-body";
import { fetchInit, landedAt } from "../mcp-request";
import { counted } from "./net";

const TIMEOUT_MS = 20_000;
const send = counted(expoFetch as unknown as (url: string, init?: never) => ReturnType<typeof expoFetch>);

export const relayTransport: ConnectorTransport = {
  async send(req) {
    if (!req.url.startsWith("https://")) throw new TypeError("refused: not https");
    // The token request's body (the sealed code and the PKCE verifier) is revealed here, at send time, and nowhere else.
    const { url, init } = fetchInit(req);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const res = await send(url, { ...init, signal: controller.signal } as never);
      if (!landedAt(url, res.url, res.redirected)) throw new TypeError("refused: redirected");
      const reader = res.body?.getReader();
      const { bytes, truncated } = reader ? await readCapped(reader, req.maxResponseBytes) : { bytes: new Uint8Array(), truncated: false };
      if (truncated) controller.abort();
      // decodeBody falls back to a hand decoder where Hermes has no TextDecoder.
      return { status: res.status, body: decodeBody(bytes, "application/json; charset=utf-8") };
    } finally {
      clearTimeout(timer);
    }
  },
};
