/**
 * FR-PRIV-02: every outbound request goes through here, so the privacy screen (HM-SET-02) can list each
 * destination host with a count. Hosts reach the encrypted database once the runtime is up; anything
 * contacted before that waits in memory. Only hosts are kept, never paths or queries.
 */
import { hostOf } from "@hermit/core";

type Sink = (url: string) => Promise<void>;

let sink: Sink | undefined;
const waiting: string[] = [];

/** Records one outbound request to `url`. Never throws: counting must not break the request. */
export function countOutbound(url: string): void {
  if (!sink) {
    if (waiting.length < 500) waiting.push(url);
    return;
  }
  void sink(url).catch(() => {});
}

/** Called once the runtime is ready: flushes what was counted before. */
export function setOutboundSink(next: Sink): void {
  sink = next;
  for (const url of waiting.splice(0)) countOutbound(url);
}

/**
 * Wraps another fetch implementation (expo/fetch for MCP, SL-54) so every request is counted, with the same rule as
 * countedFetch: a URL whose host the counter can't read is refused, so nothing is contacted without being counted.
 */
export function counted<F extends (url: string, init?: never) => Promise<unknown>>(impl: F): F {
  return ((url: string, init?: never) => {
    if (!hostOf(url)) return Promise.reject(new TypeError("refused: unreadable host"));
    countOutbound(url);
    return impl(url, init);
  }) as F;
}

/**
 * The one fetch wrapper for adapters that use fetch (connectors, mail, the browser, the relay). A URL whose host can't
 * be read the same way by the counter and by fetch is refused, so nothing is contacted without being counted.
 */
export const countedFetch: typeof fetch = (input, init) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  if (!hostOf(url)) return Promise.reject(new TypeError("refused: unreadable host"));
  countOutbound(url);
  return fetch(input, init);
};
