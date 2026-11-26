// read_web's network (SL-22, FR-WEB-01): one HTTPS GET per call, capped at maxBytes received and timeoutMs. The pure
// side (packages/agent fetchReadable) checks every hop's scheme, host and domain and counts redirects; this only
// fetches, and reports honestly where a page came from. SL-41: it may carry the one x402 payment header, and reports
// only the x402 response headers.
import { hostOf, isReadableType, type WebFetchPort, type WebHop } from "@hermit/core";
import { bodyWanted, decodeBody, readCapped, requestHeaders, transportFor, x402Headers } from "../web-body";
import { phoneFacts } from "./device";
import { fetch as expoFetch } from "expo/fetch";
import { counted, countedFetch, countOutbound } from "./net";

const ACCEPT = "text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.1";
const offline = async () => (await phoneFacts().catch(() => undefined))?.network === "none";
const tooLarge: WebHop = { kind: "error", reason: "too_large" };
type FetchImpl = (url: string, init: RequestInit) => Promise<Response>;
/** expo/fetch honours `redirect: "manual"` on Android (OkHttp's followRedirects off): the only transport a paid read uses. */
const paidFetch = counted(expoFetch as unknown as (url: string, init?: never) => Promise<Response>) as unknown as FetchImpl;

/** Streaming bodies (fetch with a ReadableStream) let the cap hold on received bytes; without them, XHR progress does. */
const canStream = () => typeof ReadableStream !== "undefined" && typeof Response !== "undefined" && "body" in Response.prototype;

/**
 * Where a page came from. A redirect the platform followed by itself was requested before any check could run, so it
 * is refused (fail closed), never read: only redirects that come back to the caller as 3xx get checked hop by hop.
 * An unknown landing (no reported URL) counts as followed.
 */
function landing(requested: string, reported: string | null | undefined): { url: string } | undefined {
  const final = reported ?? "";
  return final === requested ? { url: final } : undefined;
}

export const webFetch: WebFetchPort = {
  async get(url, { maxBytes, timeoutMs, payment }): Promise<WebHop> {
    if (!url.startsWith("https://")) return { kind: "error", reason: "failed" };
    // SL-41: Accept, plus at most the one x402 payment header after the user approved; anything else is refused.
    let headers: Record<string, string>;
    try {
      headers = requestHeaders(ACCEPT, payment);
    } catch {
      return { kind: "error", reason: "failed" };
    }
    // Airplane mode answers at once with a clear "offline" (US-WEB-02), not after a timeout.
    if (await offline()) return { kind: "error", reason: "offline" };
    // A paid request goes only through expo/fetch, which really sends redirects back unfollowed (security review).
    const transport = transportFor(payment !== undefined, canStream());
    const hop =
      transport === "expo" ? await viaFetch(url, maxBytes, timeoutMs, headers, paidFetch)
      : transport === "fetch" ? await viaFetch(url, maxBytes, timeoutMs, headers, countedFetch as FetchImpl)
      : await viaXhr(url, maxBytes, timeoutMs, headers);
    if (hop.kind === "error" && hop.reason === "failed" && (await offline())) return { kind: "error", reason: "offline" };
    return hop;
  },
};

async function viaFetch(url: string, maxBytes: number, timeoutMs: number, headers: Record<string, string>, send: FetchImpl): Promise<WebHop> {
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  try {
    // Counted for the privacy screen (FR-PRIV-02, HM-SET-02): every page read shows there by host.
    const res = await send(url, {
      method: "GET",
      // Redirects come back to the caller, which checks each one (https, same site, at most 5). Where the platform
      // follows them anyway, the page is refused: the request to the new address already left unchecked.
      redirect: "manual",
      // No cookies or saved logins: a page is read as a stranger would see it.
      credentials: "omit",
      signal: controller.signal,
      headers,
    });
    const location = res.headers.get("location");
    if (res.status >= 300 && res.status < 400) {
      controller.abort();
      return location ? { kind: "redirect", status: res.status, location } : { kind: "error", reason: "failed" };
    }
    const contentType = res.headers.get("content-type") ?? "";
    const where = res.redirected ? undefined : landing(url, res.url);
    if (!where) {
      controller.abort();
      return { kind: "error", reason: "failed" };
    }
    // SL-41: only the x402 headers are passed on. A 402's body is read whatever its type (v1 terms are JSON).
    const x402 = x402Headers((n) => res.headers.get(n));
    // A file that won't be read (PDF, image, video) is never downloaded.
    if (!bodyWanted(res.status, isReadableType(contentType))) {
      controller.abort();
      return { kind: "page", ...where, status: res.status, contentType, body: "", truncated: false, x402 };
    }
    const declared = Number(res.headers.get("content-length") ?? NaN);
    if (Number.isFinite(declared) && declared > maxBytes) {
      controller.abort();
      return tooLarge;
    }
    const reader = res.body?.getReader();
    if (!reader) {
      controller.abort();
      // A paid retry is never sent twice: the payment header went out once already.
      if (headers["PAYMENT-SIGNATURE"] || headers["X-PAYMENT"]) return { kind: "error", reason: "failed" };
      return viaXhr(url, maxBytes, timeoutMs, headers);
    }
    // The cap holds on bytes received: past it the stream is cancelled, never read to its end.
    const { bytes, truncated } = await readCapped(reader, maxBytes);
    if (truncated) controller.abort();
    return { kind: "page", ...where, status: res.status, contentType, body: decodeBody(bytes, contentType), truncated, x402 };
  } catch {
    return { kind: "error", reason: timedOut ? "timeout" : "failed" };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Without streaming: XMLHttpRequest, aborted as soon as the declared size or the bytes received pass the cap (a body
 * that can't be cut while arriving is refused, not truncated). XHR always follows redirects, so any page whose
 * `responseURL` differs from the request (or is unknown) is refused.
 */
function viaXhr(url: string, maxBytes: number, timeoutMs: number, headers: Record<string, string>): Promise<WebHop> {
  return new Promise((resolve) => {
    const xhr = new XMLHttpRequest();
    let settled = false;
    const done = (hop: WebHop) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(hop);
    };
    const stop = (hop: WebHop) => {
      done(hop);
      xhr.abort();
    };
    const timer = setTimeout(() => stop({ kind: "error", reason: "timeout" }), timeoutMs);
    // responseURL is "" where the platform doesn't report it: then the landing is unknown and refused.
    const refused: WebHop = { kind: "error", reason: "failed" };
    // Same rule as countedFetch: a host the counter can't read is never contacted, so nothing leaves uncounted.
    if (!hostOf(url)) return done(refused);
    xhr.open("GET", url);
    xhr.withCredentials = false;
    for (const [name, value] of Object.entries(headers)) xhr.setRequestHeader(name, value);
    const x402 = () => x402Headers((n) => xhr.getResponseHeader(n));
    xhr.onreadystatechange = () => {
      if (xhr.readyState !== XMLHttpRequest.HEADERS_RECEIVED) return;
      const contentType = xhr.getResponseHeader("content-type") ?? "";
      const declared = Number(xhr.getResponseHeader("content-length") ?? NaN);
      const where = landing(url, xhr.responseURL);
      if (!where) stop(refused);
      else if (!bodyWanted(xhr.status, isReadableType(contentType))) stop({ kind: "page", ...where, status: xhr.status, contentType, body: "", truncated: false, x402: x402() });
      else if (Number.isFinite(declared) && declared > maxBytes) stop(tooLarge);
    };
    xhr.onprogress = (e) => {
      if (e.loaded > maxBytes) stop(tooLarge);
    };
    xhr.onload = () => {
      const where = landing(url, xhr.responseURL);
      if (!where) return done(refused);
      const body = xhr.responseText;
      if (body.length > maxBytes) return done(tooLarge);
      done({ kind: "page", ...where, status: xhr.status, contentType: xhr.getResponseHeader("content-type") ?? "", body, truncated: false, x402: x402() });
    };
    xhr.onerror = () => done({ kind: "error", reason: "failed" });
    xhr.ontimeout = () => done({ kind: "error", reason: "timeout" });
    countOutbound(url);
    xhr.send();
  });
}
