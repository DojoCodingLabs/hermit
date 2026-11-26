/*
 * FR-PRIV-02 and FR-MAIL-01: the only hosts mail ever talks to, per provider. The app's mail transport refuses every
 * other address before anything is sent or counted, so a provider answer, a redirect or a bug can't point a token
 * anywhere else. Dependency-free on purpose: the app's Node tests import this file directly ("@hermit/mail/hosts").
 */

/** The provider's API host and its OAuth token and revocation host. The sign-in page itself opens in the browser. */
export const MAIL_HOSTS = {
  gmail: ["gmail.googleapis.com", "oauth2.googleapis.com"],
  outlook: ["graph.microsoft.com", "login.microsoftonline.com"],
} as const;

/** Every host a mail request may reach. */
export const MAIL_API_HOSTS: readonly string[] = [...new Set<string>([...MAIL_HOSTS.gmail, ...MAIL_HOSTS.outlook])];

/**
 * True only for `https://` to one of MAIL_API_HOSTS exactly, on the default port (or an explicit 443), with no
 * userinfo, backslash, whitespace or control character. When the platform has URL, it must read the same host.
 */
export function mailRequestAllowed(url: string, hosts: readonly string[] = MAIL_API_HOSTS): boolean {
  // eslint-disable-next-line no-control-regex -- control characters are exactly what is refused
  if (typeof url !== "string" || /[\\\s\u0000-\u001f\u007f]/.test(url)) return false;
  const m = /^https:\/\/([a-z0-9.-]+)(?::443)?(?=[/?#]|$)/i.exec(url);
  const host = m?.[1]?.toLowerCase();
  if (!host || !hosts.includes(host)) return false;
  const Url = (globalThis as { URL?: new (input: string) => { hostname: string; protocol: string; username: string; password: string; port: string } }).URL;
  if (typeof Url === "function") {
    try {
      const u = new Url(url);
      if (u.protocol !== "https:" || u.hostname.toLowerCase() !== host || u.username || u.password || (u.port !== "" && u.port !== "443")) return false;
    } catch {
      return false;
    }
  }
  return true;
}
