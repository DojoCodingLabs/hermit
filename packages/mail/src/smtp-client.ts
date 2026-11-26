/*
 * SMTP submission (RFC 6409) for SmtpPort, SL-49 over IMAP accounts: implicit TLS on 465, or STARTTLS on 587 that
 * must succeed before anything else (RFC 3207). The app password goes only inside TLS, as AUTH PLAIN or AUTH LOGIN.
 * The envelope is exactly the approved From, To and Cc; the message is sent as buildMime made it, dot-stuffed.
 */
import type { SmtpServer } from "./accounts.ts";
import { SmtpAuthError, type ImapLogin, type SmtpPort } from "./imap.ts";
import { asciiBytes, createSocketReader, MailProtocolError, type MailSocket, type MailSocketPort, type SocketReader } from "./mail-socket.ts";
import { bytesToBase64, utf8Encode } from "./mime.ts";

const MAX_LINE = 4096;
const MAX_LINES = 200;
const MAX_MESSAGE = 4 * 1_048_576;
const BUDGET = 262_144;

/** A plain address Hermit can put in MAIL FROM or RCPT TO: one @, no spaces, brackets or control characters. */
// eslint-disable-next-line no-control-regex -- an address with a control character (CR, LF) is exactly what is refused
const ADDRESS = /^[^\s<>()[\]\\,;:"@\x00-\x1f\x7f]{1,64}@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$/;

interface Reply {
  code: number;
  lines: string[];
}

async function reply(reader: SocketReader): Promise<Reply> {
  const lines: string[] = [];
  for (;;) {
    const line = await reader.line();
    const m = /^(\d{3})([ -])(.*)$/.exec(line) ?? /^(\d{3})()$/.exec(line);
    if (!m) throw new MailProtocolError("a reply Hermit can't read");
    lines.push(m[3] ?? "");
    if (lines.length > MAX_LINES) throw new MailProtocolError("too many reply lines");
    if (m[2] !== "-") return { code: Number(m[1]), lines };
  }
}

/** The message with CRLF line ends and every line that starts with a dot doubled, then the end-of-data line. */
export function dataBytes(message: string): Uint8Array {
  const body = message.replace(/\r?\n/g, "\r\n").replace(/(^|\r\n)\./g, "$1..");
  return utf8Encode(`${body}${body.endsWith("\r\n") ? "" : "\r\n"}.\r\n`);
}

export function createSmtpPort(deps: { sockets: MailSocketPort; deadlineMs?: number }): SmtpPort {
  const deadline = deps.deadlineMs ?? 60_000;
  return {
    async send(server: SmtpServer, login: ImapLogin, envelope, message) {
      const tls = server.port === 465 && server.security === "tls";
      const starttls = server.port === 587 && server.security === "starttls";
      if (!tls && !starttls) throw new MailProtocolError("SMTP goes over TLS on 465 or STARTTLS on 587 only");
      const recipients = [...new Set(envelope.to)];
      if (!ADDRESS.test(envelope.from) || !recipients.length || recipients.length > 100 || !recipients.every((r) => ADDRESS.test(r))) {
        throw new MailProtocolError("an address Hermit can't put in the envelope");
      }
      if (message.length > MAX_MESSAGE) throw new MailProtocolError("the message is too large");
      const password = login.password.reveal();
      if (!login.username || /[\0\r\n]/.test(login.username) || password.includes("\0")) throw new SmtpAuthError("a username or password Hermit can't send");
      let socket: MailSocket | undefined;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          socket?.close();
          reject(new MailProtocolError("the server took too long"));
        }, deadline);
      });
      const run = async () => {
        if (starttls && !deps.sockets.openPlain) throw new MailProtocolError("this phone can't use STARTTLS");
        socket = tls ? await deps.sockets.open(server.host, 465) : await deps.sockets.openPlain!(server.host, 587);
        const s = socket;
        const reader = createSocketReader(s, { maxLine: MAX_LINE, budget: BUDGET });
        const say = async (line: string, expect: number[]) => {
          reader.budget(BUDGET);
          await s.write(asciiBytes(`${line}\r\n`));
          const r = await reply(reader);
          if (!expect.includes(r.code)) throw r.code === 535 || r.code === 534 ? new SmtpAuthError() : new MailProtocolError(`the server answered ${r.code}`);
          return r;
        };
        if ((await reply(reader)).code !== 220) throw new MailProtocolError("the server didn't greet with 220");
        let ehlo = await say("EHLO [127.0.0.1]", [250]);
        if (starttls) {
          // Nothing secret before TLS: a server that doesn't offer STARTTLS gets no password at all.
          if (!ehlo.lines.some((l) => /^STARTTLS\b/i.test(l))) throw new MailProtocolError("the server doesn't offer STARTTLS");
          await say("STARTTLS", [220]);
          if (!s.startTls) throw new MailProtocolError("this phone can't use STARTTLS");
          await s.startTls();
          ehlo = await say("EHLO [127.0.0.1]", [250]);
        }
        const auth = ehlo.lines.find((l) => /^AUTH[ =]/i.test(l))?.toUpperCase().slice(5).split(/\s+/) ?? [];
        if (auth.includes("PLAIN")) {
          await say(`AUTH PLAIN ${bytesToBase64(utf8Encode(`\0${login.username}\0${password}`))}`, [235]);
        } else if (auth.includes("LOGIN")) {
          await say("AUTH LOGIN", [334]);
          await say(bytesToBase64(utf8Encode(login.username)), [334]);
          await say(bytesToBase64(utf8Encode(password)), [235]);
        } else {
          throw new MailProtocolError("the server offers no way to sign in with a password");
        }
        await say(`MAIL FROM:<${envelope.from}>`, [250]);
        for (const r of recipients) await say(`RCPT TO:<${r}>`, [250, 251]);
        await say("DATA", [354]);
        reader.budget(BUDGET);
        await s.write(dataBytes(message));
        const done = await reply(reader);
        if (done.code !== 250) throw new MailProtocolError(`the server didn't accept the message (${done.code})`);
        await say("QUIT", [221]).catch(() => undefined);
      };
      try {
        await Promise.race([run(), timeout]);
      } finally {
        if (timer !== undefined) clearTimeout(timer);
        socket?.close();
      }
    },
  };
}
