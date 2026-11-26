import { freshOAuthCredential, Secret, type OAuthProvider } from "@hermit/connectors";
import type { MailNetDeps, MailProblem, MailResult } from "./provider.ts";

/** Lists and headers are small; a full message with its HTML can be large, so it gets more room. */
export const LIST_BYTES = 262_144;
export const MESSAGE_BYTES = 1_048_576;

/**
 * One authenticated GET to a fixed mail host. The token comes from the credential store, refreshed when
 * it is about to expire, and travels only as a Secret the app's transport reveals at send time.
 */
export async function getJson(
  deps: MailNetDeps,
  provider: OAuthProvider | undefined,
  credentialId: string,
  url: string,
  opts: { headers?: Record<string, string>; maxBytes?: number } = {},
): Promise<MailResult<unknown>> {
  return callJson(deps, provider, credentialId, "GET", url, opts);
}

/**
 * One authenticated call to a fixed mail host, any method (SL-49 writes: send, draft, modify). A JSON body
 * is serialized here; an empty answer (202, 204) is `null`. A write is never retried: a transport failure is
 * reported as unreachable, and the user decides whether to try again.
 */
export async function callJson(
  deps: MailNetDeps,
  provider: OAuthProvider | undefined,
  credentialId: string,
  method: "GET" | "POST" | "PATCH",
  url: string,
  opts: { headers?: Record<string, string>; maxBytes?: number; json?: unknown } = {},
): Promise<MailResult<unknown>> {
  const fresh = await freshOAuthCredential(deps, provider, credentialId);
  if (!fresh.ok) return { ok: false, problem: fresh.problem };
  let res;
  try {
    res = await deps.transport.send({
      method,
      url,
      headers: { Accept: "application/json", ...(opts.json !== undefined ? { "Content-Type": "application/json" } : {}), ...opts.headers },
      ...(opts.json !== undefined ? { body: JSON.stringify(opts.json) } : {}),
      auth: { in: "header", name: "Authorization", value: new Secret(`Bearer ${fresh.secret.accessToken}`) },
      maxResponseBytes: opts.maxBytes ?? LIST_BYTES,
    });
  } catch {
    return { ok: false, problem: "unreachable" };
  } finally {
    await deps.credentials.markUsed(credentialId, deps.now());
  }
  const problem: MailProblem | undefined =
    res.status === 401 || res.status === 403 ? "sign_in_again" : res.status === 404 ? "not_found" : res.status >= 400 ? "provider_error" : undefined;
  if (problem) return { ok: false, problem };
  if (!res.body.trim()) return { ok: true, value: null };
  try {
    return { ok: true, value: JSON.parse(res.body) as unknown };
  } catch {
    return { ok: false, problem: "provider_error" };
  }
}

/** Query string with every value percent-encoded; keys are fixed by code ("$top", "q"). */
export const query = (entries: Array<[string, string | number]>) => entries.map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`).join("&");

export const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
export const str = (v: unknown) => (typeof v === "string" ? v : "");

/** Runs tasks with at most `limit` in flight, keeping order. */
export async function inBatches<T, R>(items: readonly T[], limit: number, run: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await run(items[i]!);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}
