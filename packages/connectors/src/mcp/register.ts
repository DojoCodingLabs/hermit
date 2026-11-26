import type { ConnectorRequest } from "../transport.ts";
import { parseJsonObject, str, strArr } from "./json.ts";
import { parseHttpsUrl } from "./url.ts";

/** The app's own scheme (`apps/mobile/app.json` "scheme") and its app-link origin (FR-CONN-03). */
export const APP_SCHEME = "hermit";
export const APP_LINK_ORIGIN = "https://hermit.dojocoding.io";

const OWN_SCHEME = new RegExp(`^${APP_SCHEME}://oauth(/[a-z0-9-]+)*$`);

/**
 * A redirect URI that can only land in Hermit: the app's private scheme under `oauth`, or an HTTPS app link
 * on Hermit's own domain under `/oauth`. No query, no fragment, nothing on another host or on loopback.
 */
export function isAppRedirectUri(uri: string): boolean {
  if (OWN_SCHEME.test(uri)) return true;
  const u = parseHttpsUrl(uri);
  return !!u && u.origin === APP_LINK_ORIGIN && !u.query && /^\/oauth(\/[a-z0-9-]+)*$/.test(u.path) && u.href === uri;
}

/**
 * RFC 7591 registration with the least the server needs: a name, the one redirect, the code and refresh
 * grants, and no client secret. No logo, homepage, contacts, policy links or software statement: nothing
 * that identifies the user or the phone.
 */
export function registrationRequest(registrationEndpoint: string, redirectUri: string): ConnectorRequest {
  if (!isAppRedirectUri(redirectUri)) throw new Error("the redirect URI must be the app's own");
  return {
    method: "POST",
    url: registrationEndpoint,
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      client_name: "Hermit",
      redirect_uris: [redirectUri],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    }),
    maxResponseBytes: 16_384,
  };
}

export type Registration =
  | { ok: true; clientId: string }
  | { ok: false; problem: "registration_failed" | "redirect_refused" | "needs_client_secret" };

/** The registration response: a client id for exactly our redirect, issued to a public client. */
export function parseRegistration(body: string, redirectUri: string): Registration {
  const o = parseJsonObject(body);
  if (!o) return { ok: false, problem: "registration_failed" };
  const error = str(o, "error");
  if (error) return { ok: false, problem: error === "invalid_redirect_uri" ? "redirect_refused" : "registration_failed" };
  const clientId = str(o, "client_id");
  if (!clientId || clientId.length > 512) return { ok: false, problem: "registration_failed" };
  const uris = strArr(o, "redirect_uris");
  if (uris && !(uris.length === 1 && uris[0] === redirectUri)) return { ok: false, problem: "redirect_refused" };
  const method = str(o, "token_endpoint_auth_method");
  if ((method && method !== "none") || str(o, "client_secret")) return { ok: false, problem: "needs_client_secret" };
  return { ok: true, clientId };
}
