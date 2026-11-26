import { afterEach, describe, expect, it } from "vitest";
import type { Server } from "node:http";
import { request } from "node:http";
import type { AddressInfo } from "node:net";
import { clientKeyOf, startRelay } from "../src/server.ts";
import { config, random, upstream } from "./helpers.ts";

let server: Server | undefined;
afterEach(() => new Promise<void>((done) => (server ? server.close(() => done()) : done())));

function call(method: string, path: string, body = "", headers: Record<string, string> = {}): Promise<{ status: number; headers: Record<string, string | string[] | undefined>; body: string }> {
  const { port } = server!.address() as AddressInfo;
  return new Promise((resolve, reject) => {
    const req = request({ host: "127.0.0.1", port, method, path, headers }, (res) => {
      let text = "";
      res.on("data", (c: Buffer) => (text += c.toString("utf8")));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: text }));
    });
    req.on("error", reject);
    req.end(body);
  });
}

async function listen(over: Record<string, string> = {}) {
  const logs: string[] = [];
  server = startRelay(config({ HERMIT_RELAY_PORT: "1", ...over }), { fetch: upstream().fetch, now: Date.now, random, log: (l) => logs.push(JSON.stringify(l)) }, { port: 0 });
  await new Promise<void>((r) => server!.once("listening", () => r()));
  return logs;
}

describe("the relay over HTTP (node:http, no framework)", () => {
  it("serves discovery on loopback with the security headers and no CORS", async () => {
    const logs = await listen();
    const res = await call("GET", "/v1/providers");
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body).providers).toHaveLength(2);
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    expect(res.headers["access-control-allow-origin"]).toBeUndefined();
    expect(logs).toHaveLength(1);
    expect(JSON.parse(logs[0]!)).toMatchObject({ method: "GET", route: "/v1/providers", status: 200 });
  });

  it("refuses a body over 8 KB before reading the rest", async () => {
    await listen();
    const res = await call("POST", "/v1/token", "x".repeat(9000), { "content-type": "application/json" });
    expect(res.status).toBe(413);
  });

  it("the query string never reaches the log", async () => {
    const logs = await listen();
    await call("GET", "/v1/callback?code=provider-code-xyz&state=nonsense");
    expect(logs.join()).not.toContain("provider-code-xyz");
    expect(logs.join()).toContain('"route":"/v1/callback"');
  });
});

describe("the client a rate limit counts", () => {
  it("is the socket's address, unless the relay is told it sits behind a proxy", () => {
    expect(clientKeyOf({ "x-forwarded-for": "1.1.1.1" }, "10.0.0.2", false)).toBe("10.0.0.2");
    // Behind a proxy, the last hop the proxy appended (a client can forge earlier entries).
    expect(clientKeyOf({ "x-forwarded-for": "6.6.6.6, 2.2.2.2" }, "10.0.0.2", true)).toBe("2.2.2.2");
    expect(clientKeyOf({}, "10.0.0.2", true)).toBe("10.0.0.2");
  });
});
