import assert from "node:assert/strict";
import { test } from "node:test";
import { fetchInit, landedAt } from "./mcp-request.ts";

const secret = (v: string) => ({ reveal: () => v, toString: () => "[secret]", toJSON: () => "[secret]" });

test("the token and a secret body are revealed only into the request the platform sends", () => {
  const { url, init } = fetchInit({
    method: "POST",
    url: "https://mcp.example.com/mcp",
    headers: { "Content-Type": "application/json" },
    body: secret("code=abc&code_verifier=xyz"),
    auth: { in: "header", name: "Authorization", value: secret("Bearer tok-1") },
    maxResponseBytes: 10,
  });
  assert.equal(url, "https://mcp.example.com/mcp");
  assert.equal(init.method, "POST");
  assert.equal(init.redirect, "manual");
  assert.equal(init.credentials, "omit");
  assert.equal(init.body, "code=abc&code_verifier=xyz");
  assert.deepEqual(init.headers, { "Content-Type": "application/json", Authorization: "Bearer tok-1" });
});

test("a query credential goes on the address, encoded", () => {
  const { url } = fetchInit({ method: "GET", url: "https://a.example.com/x?y=1", headers: {}, auth: { in: "query", name: "key", value: secret("a b") }, maxResponseBytes: 1 });
  assert.equal(url, "https://a.example.com/x?y=1&key=a%20b");
});

test("a response from anywhere but the requested address counts as a followed redirect", () => {
  assert.equal(landedAt("https://a.example.com/x", "https://a.example.com/x", false), true);
  assert.equal(landedAt("https://a.example.com/x", "https://evil.example.com/", false), false);
  assert.equal(landedAt("https://a.example.com/x", "https://a.example.com/x", true), false);
  assert.equal(landedAt("https://a.example.com/x", "", false), true);
});
