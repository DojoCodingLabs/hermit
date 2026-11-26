import type { HttpMethod } from "./spec.ts";
import type { Secret } from "./secret.ts";

/**
 * One HTTPS request the runtime built. The URL's host is always one of the spec's hosts or the provider's
 * OAuth endpoints; the adapter must not follow redirects to other hosts.
 */
export interface ConnectorRequest {
  method: HttpMethod;
  url: string;
  headers: Record<string, string>;
  /** A string, or a Secret when the body holds one (token exchange, refresh). */
  body?: string | Secret;
  /** Credential to inject at send time (FR-CONN-03): the adapter calls `value.reveal()` and nothing else does. */
  auth?: { in: "header" | "query"; name: string; value: Secret };
  /** Stop reading the response after this many bytes (FR-CONN-02). */
  maxResponseBytes: number;
}

export interface ConnectorResponse {
  status: number;
  body: string;
}

/**
 * The network, implemented by the app (packages never touch it). The adapter goes through the one fetch
 * wrapper that counts hosts for the privacy screen (FR-PRIV-02), refuses anything but HTTPS, and does not
 * follow cross-host redirects.
 */
export interface ConnectorTransport {
  send(request: ConnectorRequest): Promise<ConnectorResponse>;
}
