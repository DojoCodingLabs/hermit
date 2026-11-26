import { NativeModule, requireOptionalNativeModule } from "expo";
import type { TlsNative } from "../../src/mail-sockets";

declare class HermitTlsNative extends NativeModule implements TlsNative {
  /** Q158: connects; with `tls`, the handshake with the certificate chain and the host name checked. The connection's id. */
  open(host: string, port: number, timeoutMs: number, tls: boolean): Promise<number>;
  /** SMTP's STARTTLS on a plain connection, with the same checks as `open`. */
  startTls(id: number): Promise<void>;
  write(id: number, base64: string): Promise<void>;
  /** Up to `max` bytes as base64; null once the server closed. */
  read(id: number, max: number): Promise<string | null>;
  close(id: number): void;
}

/** TLS sockets for IMAP and SMTP (Q46, Q158). Null on an APK built without the module. Android only. */
export const HermitTls = requireOptionalNativeModule<HermitTlsNative>("HermitTls");
