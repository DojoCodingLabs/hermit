// Q46, Q158: the app's mail sockets open only what IMAP and SMTP need, count each one, and only to public names.
import assert from "node:assert/strict";
import { test } from "node:test";
import { createMailSockets, mailServerName, type TlsNative } from "./mail-sockets.ts";

function native() {
  const calls: string[] = [];
  const n: TlsNative = {
    async open(host, port, _t, tls) {
      calls.push(`open ${host}:${port} ${tls ? "tls" : "plain"}`);
      return 7;
    },
    async startTls(id) {
      calls.push(`startTls ${id}`);
    },
    async write(id, b64) {
      calls.push(`write ${id} ${b64}`);
    },
    async read(id) {
      calls.push(`read ${id}`);
      return null;
    },
    close(id) {
      calls.push(`close ${id}`);
    },
  };
  return { n, calls };
}

const codec = { toBase64: (b: Uint8Array) => Buffer.from(b).toString("base64"), fromBase64: (s: string) => new Uint8Array(Buffer.from(s, "base64")) };

test("993 and 465 open over TLS, 587 plain for STARTTLS; each is counted before it opens", async () => {
  const { n, calls } = native();
  const counted: string[] = [];
  const sockets = createMailSockets(n, { count: (u) => counted.push(u), timeoutMs: 30_000, ...codec });
  const imap = await sockets.open("IMAP.Example.com", 993);
  await sockets.open("smtp.example.com", 465);
  const plain = await sockets.openPlain!("smtp.example.com", 587);
  assert.deepEqual(counted, ["imaps://imap.example.com:993", "smtps://smtp.example.com:465", "smtp://smtp.example.com:587"]);
  assert.deepEqual(calls.slice(0, 3), ["open imap.example.com:993 tls", "open smtp.example.com:465 tls", "open smtp.example.com:587 plain"]);
  assert.equal(imap.startTls, undefined);
  await plain.startTls!();
  await imap.write(new Uint8Array([104, 105]));
  assert.equal(await imap.read(), undefined);
  imap.close();
  imap.close();
  assert.deepEqual(calls.slice(3), ["startTls 7", "write 7 aGk=", "read 7", "close 7"]);
});

test("any other port, a plain 993, an address or a local name is refused before it is counted or opened", async () => {
  const { n, calls } = native();
  const counted: string[] = [];
  const sockets = createMailSockets(n, { count: (u) => counted.push(u), timeoutMs: 30_000, ...codec });
  for (const [host, port, tls] of [["imap.example.com", 143, true], ["imap.example.com", 993, false], ["10.0.0.1", 993, true], ["localhost", 993, true], ["mail", 993, true], ["printer.local", 993, true], ["imap.example.com:993", 993, true]] as const) {
    await assert.rejects(tls ? sockets.open(host, port) : sockets.openPlain!(host, port));
  }
  assert.deepEqual(counted, []);
  assert.deepEqual(calls, []);
});

test("without the module in the build, nothing opens", async () => {
  await assert.rejects(createMailSockets(null, { count: () => {}, timeoutMs: 1, ...codec }).open("imap.example.com", 993), /no TLS sockets/);
  assert.equal(mailServerName("imap.fastmail.com"), true);
});
