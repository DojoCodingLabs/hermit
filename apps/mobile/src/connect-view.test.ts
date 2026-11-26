import { test } from "node:test";
import assert from "node:assert/strict";
import { defaultEnabled, inputOrigin, installBlocker, signInSentence, startFrom } from "./connect-view.ts";

const review = (over: Record<string, unknown> = {}) => ({ signIn: { available: true, needs: "key" as const }, testable: ["list_tasks"], keySaved: true, ...over });

test("HM-CONN-04: Install waits for the sign-in, the key and a passing test call, in that order", () => {
  assert.equal(installBlocker(review({ signIn: { available: false, needs: "none" } })), "sign_in_unavailable");
  assert.equal(installBlocker(review({ keySaved: false })), "no_key");
  assert.equal(installBlocker(review()), "not_tested");
  assert.equal(installBlocker(review({ tested: { result: "refused" } })), "test_failed");
  assert.equal(installBlocker(review({ tested: { result: "ok" } })), undefined);
  // No read to test with: the key is enough, and the screen says no test call was possible.
  assert.equal(installBlocker(review({ testable: [] })), undefined);
});

test("HM-CONN-04: the sign-in reads as one sentence with the doc's own words", () => {
  assert.deepEqual(signInSentence({ kind: "header_key", name: "Authorization", prefix: "apikey" }), { key: "HM-CONN-04.signIn.headerPrefix", vars: { name: "Authorization", prefix: "apikey" } });
  assert.deepEqual(signInSentence({ kind: "query_key", name: "appid" }), { key: "HM-CONN-04.signIn.query", vars: { name: "appid" } });
  assert.equal(signInSentence({ kind: "basic" }).key, "HM-CONN-04.signIn.basic");
  assert.equal(signInSentence(undefined).key, "HM-CONN-04.signIn.none");
});

test("HM-CONN-04: a deep link is never chat provenance; only the chat's one-time offer id is (security review)", () => {
  assert.deepEqual(startFrom({ request: "Todoist", offer: "o123" }), { text: "Todoist", origin: "chat", offerId: "o123" });
  // hermit://connect?request=... with no offer id: prefilled, but the user's own typing, confirmed by their tap.
  assert.deepEqual(startFrom({ request: "https://evil.example.com/api" }), { text: "https://evil.example.com/api", origin: "typed" });
  assert.deepEqual(startFrom({}), { text: "", origin: "typed" });
  assert.deepEqual(startFrom({ request: ["a", "b"] as never, offer: "o1" }), { text: "", origin: "typed" });
});

test("HM-CONN-04: a paste is told from typing, and nothing is on until the user turns it on", () => {
  assert.equal(inputOrigin("", "https://docs.example.com"), "pasted");
  assert.equal(inputOrigin("Tod", "Todo"), "typed");
  assert.deepEqual(defaultEnabled(), []);
});
