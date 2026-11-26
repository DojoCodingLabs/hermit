// The relay on node:http, no framework. It listens on plain HTTP on a private address (127.0.0.1 by default) and
// expects an HTTPS proxy in front (Caddy, nginx, a platform's load balancer) that terminates TLS for the public
// address in HERMIT_RELAY_PUBLIC_URL.
import { createServer, type IncomingHttpHeaders, type Server } from "node:http";
import type { RelayConfig } from "./config.ts";
import { createRelay, type RelayDeps } from "./relay.ts";

const MAX_BODY = 8192;

/** Who the rate limit counts. Behind a trusted proxy, the last X-Forwarded-For entry (the one the proxy appended). */
export function clientKeyOf(headers: IncomingHttpHeaders, remote: string | undefined, trustProxy: boolean): string {
  const forwarded = headers["x-forwarded-for"];
  const last = trustProxy && typeof forwarded === "string" ? forwarded.split(",").at(-1)?.trim() : undefined;
  return last || remote || "unknown";
}

export function startRelay(config: RelayConfig, deps: RelayDeps, opts: { port?: number } = {}): Server {
  const handle = createRelay(config, deps);
  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let refused = false;
    const declared = Number(req.headers["content-length"] ?? 0);
    const tooLarge = () => {
      refused = true;
      res.writeHead(413, { "content-type": "text/plain; charset=utf-8", connection: "close", "cache-control": "no-store" });
      res.end("Too large");
      req.destroy();
    };
    if (declared > MAX_BODY) return tooLarge();
    req.on("data", (c: Buffer) => {
      size += c.length;
      if (size > MAX_BODY) return refused || tooLarge();
      chunks.push(c);
    });
    req.on("end", () => {
      if (refused) return;
      const headers: Record<string, string | undefined> = {};
      for (const [k, v] of Object.entries(req.headers)) headers[k.toLowerCase()] = Array.isArray(v) ? v.join(", ") : v;
      handle({ method: req.method ?? "GET", url: req.url ?? "/", headers, body: Buffer.concat(chunks).toString("utf8"), clientKey: clientKeyOf(req.headers, req.socket.remoteAddress, config.trustProxy) })
        .then((r) => {
          res.writeHead(r.status, r.headers);
          res.end(r.body);
        })
        .catch(() => {
          res.writeHead(500, { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" });
          res.end("Error");
        });
    });
  });
  server.headersTimeout = 10_000;
  server.requestTimeout = 15_000;
  server.keepAliveTimeout = 5_000;
  server.listen(opts.port ?? config.port, config.host);
  return server;
}
