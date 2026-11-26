// Q46, Q158: IMAP's and SMTP's sockets over the hermit-tls module (Android's TLS, the chain and the host name checked
// before a byte moves). Only what the protocols need opens: 993 (IMAP) and 465 (SMTP) over TLS, 587 plain for SMTP's
// STARTTLS. Each connection is counted for the privacy screen (FR-PRIV-02) before it opens, and the host must be a
// public name: no IP address, no localhost, no single label. Without the module in the build every open fails, so an
// IMAP account says it can't reach the server.
import type { MailSocket, MailSocketPort } from "@hermit/mail/mail-socket";

/** The native module's surface (apps/mobile/modules/hermit-tls). */
export interface TlsNative {
  open(host: string, port: number, timeoutMs: number, tls: boolean): Promise<number>;
  startTls(id: number): Promise<void>;
  write(id: number, base64: string): Promise<void>;
  read(id: number, max: number): Promise<string | null>;
  close(id: number): void;
}

const NAME = /^(?=.{1,253}$)(?!-)[a-z0-9-]{1,63}(?<!-)(\.(?!-)[a-z0-9-]{1,63}(?<!-))+$/;
const LOCAL = /(^|\.)(localhost|local|internal|lan|home|arpa)$/;

/** A server name Hermit opens a socket to: a public DNS name, never an address or a local name. */
export function mailServerName(host: string): boolean {
  const h = host.toLowerCase();
  return NAME.test(h) && !LOCAL.test(h) && !/^[0-9.]+$/.test(h);
}

const SCHEME: Record<number, string> = { 993: "imaps", 465: "smtps", 587: "smtp" };

export function createMailSockets(
  native: TlsNative | null,
  deps: { count(url: string): void; timeoutMs: number; toBase64(bytes: Uint8Array): string; fromBase64(text: string): Uint8Array },
): MailSocketPort {
  const connect = async (host: string, port: number, tls: boolean): Promise<MailSocket> => {
    if (!native) throw new Error("this build has no TLS sockets");
    if (!mailServerName(host)) throw new Error("not a public server name");
    if (tls ? port !== 993 && port !== 465 : port !== 587) throw new Error("a port mail doesn't use this way");
    deps.count(`${SCHEME[port]}://${host.toLowerCase()}:${port}`);
    const id = await native.open(host.toLowerCase(), port, deps.timeoutMs, tls);
    let closed = false;
    return {
      write: (bytes) => (closed ? Promise.reject(new Error("closed")) : native.write(id, deps.toBase64(bytes))),
      async read() {
        if (closed) return undefined;
        const b64 = await native.read(id, 65_536);
        return b64 === null ? undefined : deps.fromBase64(b64);
      },
      ...(tls ? {} : { startTls: () => native.startTls(id) }),
      close() {
        if (closed) return;
        closed = true;
        native.close(id);
      },
    };
  };
  return {
    open: (host, port) => connect(host, port, true),
    openPlain: (host, port) => connect(host, port, false),
  };
}
