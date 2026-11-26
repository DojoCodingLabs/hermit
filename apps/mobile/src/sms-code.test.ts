// SL-56b (Q138): the SMS code source over Android's SMS User Consent API (no SMS permission). Started at the sign-in
// click; the system dialog that shows the one message is opened only at the code step; only the code and the message
// come back, for the sheet; a declined dialog is "refused".
import assert from "node:assert/strict";
import { test } from "node:test";
import { createSmsCodeSource, type SmsConsentNative, type SmsNext } from "./sms-code.ts";

function fakeNative(next: SmsNext | (() => Promise<SmsNext>), started = true) {
  const calls: string[] = [];
  const native: SmsConsentNative = {
    async start() {
      calls.push("start");
      return started;
    },
    async next(timeoutMs) {
      calls.push(`next ${timeoutMs}`);
      return typeof next === "function" ? next() : next;
    },
    stop() {
      calls.push("stop");
    },
  };
  return { native, calls };
}

const NOW = 1_000;
const signal = () => new AbortController().signal;

test("armed at the click, the dialog opens only when the task asks; only the code and the message come back", async () => {
  const { native, calls } = fakeNative({ kind: "message", text: "Your Example code is 482913", receivedAt: NOW + 5_000 });
  const w = createSmsCodeSource(native, () => NOW + 10_000).arm({ origin: "https://shop.example.com", since: NOW })!;
  await Promise.resolve();
  assert.deepEqual(calls, ["start"]);
  const got = await w.take({ until: NOW + 300_000, signal: signal() });
  assert.deepEqual(got, { via: "sms", code: "482913", at: NOW + 5_000, text: "Your Example code is 482913" });
  assert.deepEqual(calls, ["start", "next 290000", "stop"]);
});

test("a WebOTP line gives its own code", async () => {
  const { native } = fakeNative({ kind: "message", text: "Use 4417 for nothing.\n@shop.example.com #482913", receivedAt: NOW + 1 });
  const w = createSmsCodeSource(native, () => NOW).arm({ origin: "https://shop.example.com", since: NOW })!;
  assert.equal(((await w.take({ until: NOW + 300_000, signal: signal() })) as { code: string }).code, "482913");
});

test("declined dialog, no message, no Play services, an earlier message or no code: nothing", async () => {
  const cases: Array<[SmsNext, boolean, unknown]> = [
    [{ kind: "refused" }, true, "refused"],
    [{ kind: "none" }, true, undefined],
    [{ kind: "message", text: "Your code is 482913", receivedAt: NOW + 1 }, false, undefined],
    [{ kind: "message", text: "Your code is 482913", receivedAt: NOW - 1 }, true, undefined],
    [{ kind: "message", text: "See you at 8", receivedAt: NOW + 1 }, true, undefined],
  ];
  for (const [next, started, want] of cases) {
    const { native } = fakeNative(next, started);
    const w = createSmsCodeSource(native, () => NOW).arm({ origin: "https://shop.example.com", since: NOW })!;
    assert.deepEqual(await w.take({ until: NOW + 300_000, signal: signal() }), want, JSON.stringify(next));
  }
});

test("cancel and the task's stop end the listener", async () => {
  const { native, calls } = fakeNative(() => new Promise(() => {}));
  const w = createSmsCodeSource(native, () => NOW).arm({ origin: "https://shop.example.com", since: NOW })!;
  const ctl = new AbortController();
  const p = w.take({ until: NOW + 300_000, signal: ctl.signal });
  ctl.abort();
  assert.equal(await p, undefined);
  w.cancel();
  assert.ok(calls.includes("stop"));
});
