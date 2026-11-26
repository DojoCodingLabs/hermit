import { describe, expect, it } from "vitest";
import { getChecked, parseHttpsUrl, parseJsonObject, postChecked, resolveRedirect } from "../src/index.ts";
import { fakeNet, json } from "./mcp-fixtures.ts";

describe("parseHttpsUrl: every URL the MCP client touches (FR-CONN-02)", () => {
  it("accepts an exact public HTTPS URL and normalizes it", () => {
    expect(parseHttpsUrl("https://mcp.example.com/mcp")).toEqual({
      href: "https://mcp.example.com/mcp",
      origin: "https://mcp.example.com",
      host: "mcp.example.com",
      path: "/mcp",
      query: "",
    });
    expect(parseHttpsUrl("HTTPS://MCP.Example.com:443")?.href).toBe("https://mcp.example.com/");
    expect(parseHttpsUrl("https://a.example.com/x?y=1&z=%20")?.query).toBe("y=1&z=%20");
  });

  it.each([
    ["plain http", "http://mcp.example.com/mcp"],
    ["another scheme", "javascript:alert(1)"],
    ["a custom scheme", "hermit://oauth"],
    ["localhost", "https://localhost/mcp"],
    ["a private name", "https://router.local/mcp"],
    ["an IPv4 literal", "https://127.0.0.1/mcp"],
    ["a numeric label", "https://0x7f.0.0.1/"],
    ["an IPv6 literal", "https://[::1]/mcp"],
    ["userinfo", "https://good.example.com@evil.example.com/"],
    ["userinfo hidden behind a fragment", "https://good.example.com#@evil.example.com/"],
    ["a backslash", "https://good.example.com\\@evil.example.com/"],
    ["a fragment", "https://mcp.example.com/mcp#x"],
    ["whitespace", "https://mcp.example.com/ mcp"],
    ["a control character", "https://mcp.example.com/\u0000"],
    ["a non-default port", "https://mcp.example.com:8443/mcp"],
    ["a dot segment", "https://mcp.example.com/a/../admin"],
    ["an encoded dot segment", "https://mcp.example.com/a/%2e%2e/admin"],
    ["a protocol-relative URL", "//mcp.example.com/mcp"],
    ["a relative path", "/mcp"],
    ["an internationalized host", "https://exämple.com/"],
    ["a trailing-dot host", "https://mcp.example.com./"],
  ])("refuses %s", (_, url) => {
    expect(parseHttpsUrl(url)).toBeUndefined();
  });

  it("refuses non-strings and very long URLs", () => {
    expect(parseHttpsUrl(42 as unknown as string)).toBeUndefined();
    expect(parseHttpsUrl(`https://mcp.example.com/${"a".repeat(2100)}`)).toBeUndefined();
  });
});

describe("resolveRedirect", () => {
  const base = parseHttpsUrl("https://mcp.example.com/a/b")!;
  it("resolves absolute, protocol-relative and path-absolute locations through the same checks", () => {
    expect(resolveRedirect(base, "https://other.example.org/x")?.href).toBe("https://other.example.org/x");
    expect(resolveRedirect(base, "//other.example.org/x")?.href).toBe("https://other.example.org/x");
    expect(resolveRedirect(base, "/c?d=1")?.href).toBe("https://mcp.example.com/c?d=1");
  });
  it("refuses a redirect to anything the URL check refuses, and relative paths", () => {
    expect(resolveRedirect(base, "http://mcp.example.com/x")).toBeUndefined();
    expect(resolveRedirect(base, "https://192.168.1.1/admin")).toBeUndefined();
    expect(resolveRedirect(base, "c")).toBeUndefined();
  });
});

describe("parseJsonObject: no prototype keys survive", () => {
  it("drops __proto__, constructor and prototype at every depth", () => {
    const o = parseJsonObject('{"a":1,"__proto__":{"polluted":true},"n":{"constructor":{"x":1},"prototype":2,"ok":3}}')!;
    expect(Object.keys(o)).toEqual(["a", "n"]);
    expect(Object.keys(o.n as object)).toEqual(["ok"]);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });
  it("is undefined for anything but an object", () => {
    expect(parseJsonObject("[1]")).toBeUndefined();
    expect(parseJsonObject("nope")).toBeUndefined();
    expect(parseJsonObject("null")).toBeUndefined();
  });
});

describe("getChecked and postChecked: the URL check runs before every hop", () => {
  it("never sends to a URL that fails the check", async () => {
    const net = fakeNet({});
    expect(await getChecked(net, "https://10.0.0.1/.well-known/x", { maxBytes: 1000 })).toEqual({ ok: false, problem: "blocked_url" });
    expect(net.sent).toHaveLength(0);
  });

  it("follows a redirect only after the target passes, up to the limit", async () => {
    const net = fakeNet({
      "GET https://a.example.com/x": () => ({ status: 302, headers: { location: "https://b.example.com/y" }, body: "" }),
      "GET https://b.example.com/y": () => json({ ok: true }),
    });
    const r = await getChecked(net, "https://a.example.com/x", { maxBytes: 1000 });
    expect(r.ok && r.url.href).toBe("https://b.example.com/y");
    expect(net.sent.map((s) => s.url)).toEqual(["https://a.example.com/x", "https://b.example.com/y"]);
  });

  it("refuses a redirect into the private network without requesting it", async () => {
    const net = fakeNet({ "GET https://a.example.com/x": () => ({ status: 307, headers: { location: "https://169.254.169.254/latest" }, body: "" }) });
    expect(await getChecked(net, "https://a.example.com/x", { maxBytes: 1000 })).toEqual({ ok: false, problem: "blocked_redirect" });
    expect(net.sent).toHaveLength(1);
  });

  it("stops a redirect loop", async () => {
    const net = fakeNet({ "GET https://a.example.com/x": () => ({ status: 302, headers: { location: "/x" }, body: "" }) });
    expect(await getChecked(net, "https://a.example.com/x", { maxBytes: 1000, maxRedirects: 3 })).toEqual({ ok: false, problem: "too_many_redirects" });
    expect(net.sent).toHaveLength(4);
  });

  it("fails closed when the platform followed a redirect by itself", async () => {
    const net = fakeNet({ "GET https://a.example.com/x": () => ({ ...json({}), redirected: true, url: "https://a.example.com/elsewhere" }) });
    expect(await getChecked(net, "https://a.example.com/x", { maxBytes: 1000 })).toEqual({ ok: false, problem: "blocked_redirect" });
    const net2 = fakeNet({ "GET https://a.example.com/x": () => ({ ...json({}), url: "https://a.example.com/elsewhere" }) });
    expect(await getChecked(net2, "https://a.example.com/x", { maxBytes: 1000 })).toEqual({ ok: false, problem: "blocked_redirect" });
  });

  it("never follows a redirect on a POST (a token or a call body would go somewhere unchecked)", async () => {
    const net = fakeNet({ "POST https://a.example.com/token": () => ({ status: 307, headers: { location: "https://a.example.com/t2" }, body: "" }) });
    const r = await postChecked(net, { method: "POST", url: "https://a.example.com/token", headers: {}, body: "x", maxResponseBytes: 100 });
    expect(r).toEqual({ ok: false, problem: "blocked_redirect" });
    expect(net.sent).toHaveLength(1);
  });

  it("reports a transport failure as unreachable and lowercases header names", async () => {
    const bad = { async send(): Promise<never> { throw new Error("offline"); } };
    expect(await getChecked(bad, "https://a.example.com/x", { maxBytes: 10 })).toEqual({ ok: false, problem: "unreachable" });
    const net = fakeNet({ "GET https://a.example.com/x": () => ({ status: 200, headers: { "Content-Type": "application/json" }, body: "{}" }) });
    const r = await getChecked(net, "https://a.example.com/x", { maxBytes: 10 });
    expect(r.ok && r.res.headers["content-type"]).toBe("application/json");
  });

  it("cuts the body at the byte cap", async () => {
    const net = fakeNet({ "GET https://a.example.com/x": () => ({ status: 200, headers: {}, body: "x".repeat(50) }) });
    const r = await getChecked(net, "https://a.example.com/x", { maxBytes: 10 });
    expect(r.ok && r.res.body.length).toBe(10);
    expect(net.sent[0]!.maxResponseBytes).toBe(10);
  });
});
