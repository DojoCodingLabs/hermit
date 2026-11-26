import { describe, expect, it } from "vitest";
import { Secret } from "@hermit/connectors";
import { SmtpAuthError } from "../src/imap.ts";
import { binaryString, type MailSocket, type MailSocketPort } from "../src/mail-socket.ts";
import { utf8Encode } from "../src/mime.ts";
import { createSmtpPort, dataBytes } from "../src/smtp-client.ts";

const LOGIN = { username: "ana@example.com", password: new Secret("app-pass") };
const ENVELOPE = { from: "ana@example.com", to: ["luis@example.com", "eva@example.com"] };
const MESSAGE = "Subject: hi\r\n\r\nline one\r\n.hidden\r\n";

/** A scripted SMTP server; `tls` says whether the connection is encrypted yet when each line arrives. */
function server(opts: { starttls?: boolean; auth?: string; refuse?: number } = {}) {
  const opened: string[] = [];
  const lines: Array<{ line: string; tls: boolean }> = [];
  let tls = false;
  let data = false;
  let buffer = "";
  const queue: Uint8Array[] = [utf8Encode("220 smtp.example.com ready\r\n")];
  let waiting: ((c: Uint8Array | undefined) => void) | undefined;
  const say = (text: string) => {
    const chunk = utf8Encode(text);
    if (waiting) {
      const w = waiting;
      waiting = undefined;
      w(chunk);
    } else queue.push(chunk);
  };
  const answer = (line: string) => {
    if (data) {
      if (line === ".") {
        data = false;
        say("250 queued\r\n");
      }
      return;
    }
    const cmd = line.toUpperCase();
    if (cmd.startsWith("EHLO")) say(`250-smtp.example.com\r\n${opts.starttls && !tls ? "250-STARTTLS\r\n" : ""}250 AUTH ${opts.auth ?? "PLAIN LOGIN"}\r\n`);
    else if (cmd === "STARTTLS") say("220 go ahead\r\n");
    else if (cmd.startsWith("AUTH PLAIN")) say(opts.refuse ? `${opts.refuse} no\r\n` : "235 ok\r\n");
    else if (cmd.startsWith("MAIL FROM") || cmd.startsWith("RCPT TO")) say("250 ok\r\n");
    else if (cmd === "DATA") {
      data = true;
      say("354 go\r\n");
    } else if (cmd === "QUIT") say("221 bye\r\n");
    else say("500 what\r\n");
  };
  const socket: MailSocket = {
    async write(bytes) {
      buffer += binaryString(bytes);
      for (let i = buffer.indexOf("\r\n"); i >= 0; i = buffer.indexOf("\r\n")) {
        const line = buffer.slice(0, i);
        buffer = buffer.slice(i + 2);
        lines.push({ line, tls });
        answer(line);
      }
    },
    read: () => (queue.length ? Promise.resolve(queue.shift()) : new Promise((r) => (waiting = r))),
    async startTls() {
      tls = true;
    },
    close() {
      waiting?.(undefined);
    },
  };
  const sockets: MailSocketPort = {
    async open(host, port) {
      opened.push(`tls ${host}:${port}`);
      tls = true;
      return socket;
    },
    async openPlain(host, port) {
      opened.push(`plain ${host}:${port}`);
      return socket;
    },
  };
  return { sockets, opened, lines };
}

describe("SMTP submission for IMAP accounts (SL-49)", () => {
  it("465: implicit TLS, AUTH PLAIN, the exact envelope, the message dot-stuffed", async () => {
    const s = server();
    await createSmtpPort({ sockets: s.sockets }).send({ host: "smtp.example.com", port: 465, security: "tls" }, LOGIN, ENVELOPE, MESSAGE);
    expect(s.opened).toEqual(["tls smtp.example.com:465"]);
    const sent = s.lines.map((l) => l.line);
    expect(sent.filter((l) => /^(MAIL|RCPT)/.test(l))).toEqual(["MAIL FROM:<ana@example.com>", "RCPT TO:<luis@example.com>", "RCPT TO:<eva@example.com>"]);
    expect(sent).toContain("..hidden");
    expect(sent.at(-1)).toBe("QUIT");
  });

  it("587: STARTTLS first, and nothing secret is written before TLS", async () => {
    const s = server({ starttls: true });
    await createSmtpPort({ sockets: s.sockets }).send({ host: "smtp.example.com", port: 587, security: "starttls" }, LOGIN, ENVELOPE, MESSAGE);
    expect(s.opened).toEqual(["plain smtp.example.com:587"]);
    const before = s.lines.filter((l) => !l.tls).map((l) => l.line);
    expect(before).toEqual(["EHLO [127.0.0.1]", "STARTTLS"]);
    expect(s.lines.find((l) => l.line.startsWith("AUTH"))?.tls).toBe(true);
  });

  it("587 without STARTTLS on offer: no password, no message, an error", async () => {
    const s = server({ starttls: false });
    await expect(createSmtpPort({ sockets: s.sockets }).send({ host: "smtp.example.com", port: 587, security: "starttls" }, LOGIN, ENVELOPE, MESSAGE)).rejects.toThrow(/STARTTLS/);
    expect(s.lines.map((l) => l.line)).toEqual(["EHLO [127.0.0.1]"]);
  });

  it("a refused login is SmtpAuthError, so the account says sign in again", async () => {
    const s = server({ refuse: 535 });
    await expect(createSmtpPort({ sockets: s.sockets }).send({ host: "smtp.example.com", port: 465, security: "tls" }, LOGIN, ENVELOPE, MESSAGE)).rejects.toBeInstanceOf(SmtpAuthError);
  });

  it("refuses before connecting: another port, a mismatched security, or an address that could break the envelope", async () => {
    const s = server();
    const port = createSmtpPort({ sockets: s.sockets });
    await expect(port.send({ host: "smtp.example.com", port: 25, security: "tls" }, LOGIN, ENVELOPE, MESSAGE)).rejects.toThrow(/465 or STARTTLS on 587/);
    await expect(port.send({ host: "smtp.example.com", port: 465, security: "starttls" }, LOGIN, ENVELOPE, MESSAGE)).rejects.toThrow();
    for (const bad of ["luis@example.com>\r\nRCPT TO:<evil@x.com", "luis@example.com> NOTIFY=x", "no-at-sign", "a@b"]) {
      await expect(port.send({ host: "smtp.example.com", port: 465, security: "tls" }, LOGIN, { from: ENVELOPE.from, to: [bad] }, MESSAGE)).rejects.toThrow(/envelope/);
    }
    expect(s.opened).toEqual([]);
  });

  it("dot-stuffs every line that starts with a dot and ends with CRLF.CRLF", () => {
    expect(binaryString(dataBytes(".a\nb\r\n.c"))).toBe("..a\r\nb\r\n..c\r\n.\r\n");
  });
});
