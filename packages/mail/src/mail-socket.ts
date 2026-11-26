/*
 * The byte stream under IMAP and SMTP (FR-MAIL-01, Q46). Raw sockets are not HTTP, so this is not the connector
 * transport: the app opens them with its own TLS module (`apps/mobile/modules/hermit-tls`, Q158), which checks the
 * certificate chain against the phone's roots and the server's host name before `open` resolves, and counts each
 * connection (FR-PRIV-02). Everything above it is pure and platform-free: no Buffer, atob or TextDecoder.
 */

/** One connection to a mail server: bytes in and out. */
export interface MailSocket {
  write(bytes: Uint8Array): Promise<void>;
  /** The next bytes the server sent; undefined once it closed. Rejects on a timeout or a broken connection. */
  read(): Promise<Uint8Array | undefined>;
  /** SMTP on 587 only: turns this plain connection into TLS, checked exactly as `open` checks it. */
  startTls?(): Promise<void>;
  close(): void;
}

export interface MailSocketPort {
  /** Implicit TLS: nothing is readable or writable before the certificate and the host name checked out. */
  open(host: string, port: number): Promise<MailSocket>;
  /** A plain connection for SMTP's STARTTLS on 587 only. Nothing secret is written on it before `startTls` resolves. */
  openPlain?(host: string, port: number): Promise<MailSocket>;
}

/** The server broke the protocol, sent more than the caps allow, or closed early. Never an auth problem. */
export class MailProtocolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MailProtocolError";
  }
}

const LF = 10;
const CR = 13;

/** Bytes as a binary string (one char per byte, 0 to 255), so protocol text is matched without decoding it. */
export function binaryString(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i += 8192) out += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return out;
}

/** A protocol line Hermit wrote (ASCII only) as bytes. */
export function asciiBytes(text: string): Uint8Array {
  const out = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c > 0x7e || (c < 0x20 && c !== CR && c !== LF)) throw new MailProtocolError("a command can only hold printable ASCII");
    out[i] = c;
  }
  return out;
}

export interface SocketReader {
  /** The next line without its line break, as a binary string. Throws past `maxLine` bytes or when the server closed. */
  line(): Promise<string>;
  /** Exactly `n` bytes (an IMAP literal). */
  bytes(n: number): Promise<Uint8Array>;
  /** Starts a new budget: a command may read at most `max` bytes in all. */
  budget(max: number): void;
}

/** Buffers what the socket gives, with a cap per line and a byte budget per command, so a server can't fill the phone. */
export function createSocketReader(socket: MailSocket, caps: { maxLine: number; budget: number }): SocketReader {
  let data = new Uint8Array(16_384);
  let start = 0;
  let end = 0;
  let read = 0;
  let budget = caps.budget;
  const more = async () => {
    const chunk = await socket.read();
    if (!chunk) throw new MailProtocolError("the server closed the connection");
    read += chunk.length;
    if (read > budget) throw new MailProtocolError("the server sent more than Hermit reads");
    if (end + chunk.length > data.length) {
      const live = end - start;
      const next = live + chunk.length > data.length ? new Uint8Array(Math.max(data.length * 2, live + chunk.length)) : data;
      next.set(data.subarray(start, end), 0);
      data = next;
      start = 0;
      end = live;
    }
    data.set(chunk, end);
    end += chunk.length;
  };
  return {
    async line() {
      let from = start;
      for (;;) {
        const at = data.subarray(from, end).indexOf(LF);
        if (at >= 0) {
          const lf = from + at;
          const stop = lf > start && data[lf - 1] === CR ? lf - 1 : lf;
          if (stop - start > caps.maxLine) throw new MailProtocolError("a line was too long");
          const text = binaryString(data.subarray(start, stop));
          start = lf + 1;
          return text;
        }
        if (end - start > caps.maxLine) throw new MailProtocolError("a line was too long");
        from = end;
        await more();
      }
    },
    async bytes(n) {
      while (end - start < n) await more();
      const out = data.slice(start, start + n);
      start += n;
      return out;
    },
    budget(max) {
      read = end - start;
      budget = max;
    },
  };
}
