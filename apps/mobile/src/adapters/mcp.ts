// SL-54: the network for MCP servers. packages/connectors checks every address (HTTPS, an exact public host, port 443,
// no userinfo) before it asks for it and refuses any POST redirect; this only sends, through expo/fetch with
// `redirect: "manual"` (OkHttp followRedirects(false)), counted for the privacy screen, and stops reading at the cap.
import { fetch as expoFetch } from "expo/fetch";
import type { McpTransport } from "@hermit/runtime";
import { readCapped } from "../web-body";
import { fetchInit, landedAt } from "../mcp-request";
import { counted } from "./net";

const TIMEOUT_MS = 30_000;
const send = counted(expoFetch as unknown as (url: string, init?: never) => ReturnType<typeof expoFetch>);

export const mcpTransport: McpTransport = {
  async send(req) {
    const { url, init } = fetchInit(req);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const res = await send(url, { ...init, signal: controller.signal } as never);
      const headers: Record<string, string> = {};
      res.headers.forEach((value, name) => {
        headers[name.toLowerCase()] = value;
      });
      const redirected = !landedAt(url, res.url, res.redirected);
      const reader = res.body?.getReader();
      const { bytes, truncated } = reader ? await readCapped(reader, req.maxResponseBytes) : { bytes: new Uint8Array(), truncated: false };
      if (truncated) controller.abort();
      return { status: res.status, headers, body: new TextDecoder().decode(bytes), ...(res.url ? { url: res.url } : {}), redirected };
    } finally {
      clearTimeout(timer);
    }
  },
};
