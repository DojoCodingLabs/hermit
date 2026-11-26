import { describe, expect, it } from "vitest";
import { binaryString } from "../src/mail-socket.ts";
import { utf8Encode } from "../src/mime.ts";
import { decodeHeader, mailHeaderDate, quotedPrintable, readMessage } from "../src/mime-read.ts";

/** A message as IMAP hands it over: bytes, here as a binary string. */
const raw = (text: string) => binaryString(utf8Encode(text.replace(/\n/g, "\r\n")));

describe("reading a raw message (FR-MAIL-02, IMAP accounts)", () => {
  it("decodes encoded words (B and Q, any case), joins adjacent ones, and reads 8-bit UTF-8 headers", () => {
    expect(decodeHeader("=?UTF-8?B?wqFIb2xhIQ==?= =?utf-8?q?_qu=C3=A9_tal?=")).toBe("¡Hola! qué tal");
    expect(decodeHeader("=?ISO-8859-1?Q?Jos=E9?= <jose@example.com>")).toBe("José <jose@example.com>");
    expect(decodeHeader(binaryString(utf8Encode("Pérez <p@example.com>")))).toBe("Pérez <p@example.com>");
    expect(decodeHeader("one\r\n two\tthree\x00")).toBe("one two three");
  });

  it("takes the first text/plain of a multipart/alternative, out of quoted-printable and Windows-1252", () => {
    const m = readMessage(raw([
      "From: Ana <ana@example.com>",
      "To: Luis <luis@example.com>, \"Pérez, Hugo\" <hugo@example.com>",
      "Cc: team@example.com",
      "Subject: =?UTF-8?Q?Reuni=C3=B3n?=",
      "Date: Tue, 1 Jul 2025 10:52:37 +0200",
      "Message-ID: <abc@example.com>",
      "References: <r1@example.com>\n <r2@example.com>",
      "Content-Type: multipart/alternative; boundary=\"b1\"",
      "",
      "preamble",
      "--b1",
      "Content-Type: text/plain; charset=windows-1252",
      "Content-Transfer-Encoding: quoted-printable",
      "",
      "Ma=F1ana a las 10=",
      " en punto =93OK=94",
      "--b1",
      "Content-Type: text/html; charset=utf-8",
      "",
      "<p>Mañana</p>",
      "--b1--",
      "",
    ].join("\n")));
    expect(m.from).toBe("Ana <ana@example.com>");
    expect(m.to).toEqual(["Luis <luis@example.com>", "\"Pérez, Hugo\" <hugo@example.com>"]);
    expect(m.cc).toEqual(["team@example.com"]);
    expect(m.subject).toBe("Reunión");
    expect(m.date).toBe(Date.UTC(2025, 6, 1, 8, 52, 37));
    expect(m.messageId).toBe("<abc@example.com>");
    expect(m.references).toBe("<r1@example.com> <r2@example.com>");
    expect(m.text).toBe("Mañana a las 10 en punto “OK”");
    // The plain text is what Hermit reads, so the walk stops there; an HTML-only message gives its HTML.
    expect(m.html).toBeUndefined();
    expect(readMessage(raw("Content-Type: text/html; charset=utf-8\n\n<p>Mañana</p>")).html).toBe("<p>Mañana</p>");
  });

  it("skips attachments, reads nested parts, and keeps a boundary from matching a longer one", () => {
    const m = readMessage(raw([
      "Content-Type: multipart/mixed; boundary=a",
      "",
      "--a",
      "Content-Type: text/plain; name=notes.txt",
      "Content-Disposition: attachment; filename=notes.txt",
      "",
      "not the body",
      "--a",
      "Content-Type: multipart/alternative; boundary=ab",
      "",
      "--ab",
      "Content-Type: text/plain; charset=utf-8",
      "Content-Transfer-Encoding: base64",
      "",
      "w6lsIGN1ZXJwbw==",
      "--ab--",
      "--a--",
    ].join("\n")));
    expect(m.text).toBe("él cuerpo");
  });

  it("reads what arrived of a message cut short by a partial fetch", () => {
    const m = readMessage(raw("Subject: long\nContent-Type: multipart/mixed; boundary=z\n\n--z\nContent-Type: text/plain\n\nthe start of a long bo"));
    expect(m.subject).toBe("long");
    expect(m.text).toBe("the start of a long bo");
    expect(readMessage(raw("Subject: only headers, cut")).subject).toBe("only headers, cut");
  });

  it("a hostile structure costs no more than the caps: deep nesting, many parts, a bad boundary", () => {
    let deep = "x";
    for (let i = 0; i < 200; i++) deep = `Content-Type: multipart/mixed; boundary=b${i}\r\n\r\n--b${i}\r\n${deep}\r\n--b${i}--`;
    expect(readMessage(deep).text).toBeUndefined();
    const many = `Content-Type: multipart/mixed; boundary=m\r\n\r\n${"--m\r\nContent-Type: image/png\r\n\r\nx\r\n".repeat(5000)}--m\r\nContent-Type: text/plain\r\n\r\nlate\r\n--m--`;
    expect(readMessage(many).text).toBeUndefined();
    expect(readMessage("Content-Type: multipart/mixed; boundary=\"bad\rboundary\"\r\n\r\n--x").text).toBeUndefined();
  });

  it("Message-ID and References keep only <id> tokens, so nothing else reaches a reply's headers", () => {
    const m = readMessage(raw("Message-ID: <a@x> Bcc: evil@x.com\nReferences: junk <b@x> \"<c@x>\"\n\nbody"));
    expect(m.messageId).toBe("<a@x>");
    expect(m.references).toBe("<b@x> <c@x>");
  });

  it("dates: RFC 5322 with a zone or a name, two-digit years, and nothing for a date that isn't one", () => {
    expect(mailHeaderDate("1 Jul 2025 10:52 -0500")).toBe(Date.UTC(2025, 6, 1, 15, 52));
    expect(mailHeaderDate("Wed, 02 Jul 25 00:00:00 GMT")).toBe(Date.UTC(2025, 6, 2));
    expect(mailHeaderDate("yesterday")).toBeUndefined();
    expect(mailHeaderDate("31 Foo 2025 10:00 +0000")).toBeUndefined();
  });

  it("quoted-printable keeps a stray = and drops soft line breaks", () => {
    expect(binaryString(quotedPrintable("a=3Db=\r\nc = d=ZZ"))).toBe("a=bc = d=ZZ");
  });
});
