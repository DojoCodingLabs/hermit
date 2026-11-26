// SL-48 and SL-49 (FR-PRIV-02, FR-CONN-03): the mail transport refuses every host but the providers' own before anything is
// counted or sent, counts every request it sends, reveals the token only into the request, follows no redirect and stops
// reading at the cap.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createMailTransport, type MailFetch } from "./mail-transport.ts";

const secret = (v: string) => ({ reveal: () => v, toString: () => "[secret]", toJSON: () => "[secret]" });

function world(answer: { status?: number; url?: string; redirected?: boolean; body?: string } = {}) {
  const counted: string[] = [];
  const fetched: Array<{ url: string; init: Record<string, unknown> }> = [];
  const fetch: MailFetch = async (url, init) => {
    fetched.push({ url, init: init as unknown as Record<string, unknown> });
    const bytes = new TextEncoder().encode(answer.body ?? '{"ok":true}');
    let sent = false;
    return {
      status: answer.status ?? 200,
      url: answer.url ?? url,
      redirected: answer.redirected ?? false,
      body: { getReader: () => ({ read: async () => (sent ? { done: true } : ((sent = true), { done: false, value: bytes })), cancel: async () => {} }) },
    };
  };
  return { counted, fetched, transport: createMailTransport({ fetch, count: (u) => counted.push(u), timeoutMs: 1000 }) };
}

const req = (url: string) => ({ method: "GET" as const, url, headers: { Accept: "application/json" }, auth: { in: "header" as const, name: "Authorization", value: secret("Bearer ya29.token") }, maxResponseBytes: 1024 });

test("a provider host is counted once, sent once, with the token only in the header and no redirect followed", async () => {
  const w = world();
  const r = await w.transport.send(req("https://gmail.googleapis.com/gmail/v1/users/me/profile"));
  assert.deepEqual(r, { status: 200, body: '{"ok":true}' });
  assert.deepEqual(w.counted, ["https://gmail.googleapis.com/gmail/v1/users/me/profile"]);
  assert.equal(w.fetched.length, 1);
  assert.equal(w.fetched[0]!.init.redirect, "manual");
  assert.equal(w.fetched[0]!.init.credentials, "omit");
  assert.deepEqual(w.fetched[0]!.init.headers, { Accept: "application/json", Authorization: "Bearer ya29.token" });
});

test("any other host, plain http, another port or userinfo is refused before it is counted or sent", async () => {
  for (const url of ["https://evil.example.com/x", "http://gmail.googleapis.com/x", "https://gmail.googleapis.com:8443/x", "https://a@graph.microsoft.com/v1.0/me", "https://accounts.google.com/o/oauth2/v2/auth", "https://gmail.googleapis.com.evil.com/"]) {
    const w = world();
    await assert.rejects(w.transport.send(req(url)), /refused/, url);
    assert.deepEqual(w.counted, [], url);
    assert.equal(w.fetched.length, 0, url);
  }
});

test("an answer from anywhere but the requested address is refused, even when the platform followed a redirect", async () => {
  await assert.rejects(world({ redirected: true }).transport.send(req("https://graph.microsoft.com/v1.0/me")), /redirected/);
  await assert.rejects(world({ url: "https://evil.example.com/" }).transport.send(req("https://graph.microsoft.com/v1.0/me")), /redirected/);
});

test("the body is cut at the request's cap", async () => {
  const w = world({ body: "x".repeat(5000) });
  const r = await w.transport.send({ ...req("https://graph.microsoft.com/v1.0/me/messages"), maxResponseBytes: 100 });
  assert.equal(r.body.length, 100);
});
