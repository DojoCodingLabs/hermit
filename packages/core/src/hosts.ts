import type { SqlPort } from "./ports.ts";

/** ENT-HostCounter: one row per destination host Hermit contacted (FR-PRIV-02). */
export interface HostCount {
  host: string;
  count: number;
  lastAt: number;
}

/**
 * The host of an http or https URL, lowercased, without user info, port, path or query; undefined for
 * anything else. A regular expression, so it behaves the same in Node and on the phone, refusing what parsers read
 * differently (backslashes, whitespace, control characters, a second "@"). Where `URL` exists, its hostname must
 * agree, so the host counted is the host fetch contacts; a disagreement is undefined and the caller refuses.
 */
export function hostOf(url: string): string | undefined {
  // eslint-disable-next-line no-control-regex -- control characters are exactly what is refused
  if (/[\\\s\u0000-\u001f\u007f]/.test(url)) return undefined;
  const m = /^https?:\/\/(?:[^@/?#]*@)?(\[[0-9a-f:.]+\]|[^:/?#[\]@]+)(?=[:/?#]|$)/i.exec(url);
  const host = m?.[1]?.toLowerCase().replace(/\.$/, "");
  if (!host) return undefined;
  // core is built without the DOM library, so URL is read from globalThis with its one used field typed.
  const Url = (globalThis as { URL?: new (input: string) => { hostname: string } }).URL;
  if (typeof Url === "function") {
    let parsed: string;
    try {
      parsed = new Url(url).hostname.toLowerCase().replace(/\.$/, "");
    } catch {
      return undefined;
    }
    if (parsed !== host) return undefined;
  }
  return host;
}

/**
 * The privacy screen's local counter. The app's one fetch wrapper calls record() for every outbound
 * request; only the host is stored, never the path or query, and nothing ever leaves the phone.
 */
export function createHostCounter(sql: SqlPort, now: () => number = Date.now) {
  return {
    /** Counts the URL's host; returns it, or undefined when the URL has none (nothing is stored). */
    async record(url: string): Promise<string | undefined> {
      const host = hostOf(url);
      if (!host) return undefined;
      await sql.exec(
        "INSERT INTO host_counters (host, count, last_at) VALUES (?, 1, ?) ON CONFLICT(host) DO UPDATE SET count = count + 1, last_at = excluded.last_at",
        [host, now()],
      );
      return host;
    },
    /** Most contacted first. */
    async list(): Promise<HostCount[]> {
      const rows = await sql.query<{ host: string; count: number; last_at: number }>("SELECT host, count, last_at FROM host_counters ORDER BY count DESC, host");
      return rows.map((r) => ({ host: r.host, count: Number(r.count), lastAt: Number(r.last_at) }));
    },
  };
}

export type HostCounter = ReturnType<typeof createHostCounter>;
