import { describe, expect, it } from "vitest";
import { Secret } from "@hermit/connectors";
import { createImapPort, IMAP_MESSAGE_BYTES, searchParts, tokenize } from "../src/imap-client.ts";
import { binaryString, type MailSocket, type MailSocketPort } from "../src/mail-socket.ts";
import { utf8Encode } from "../src/mime.ts";

const SERVER = { host: "imap.example.com", port: 993 };
const LOGIN = { username: "ana@example.com", password: new Secret("app pass \"x\" \\ ñ") };
const enc = (s: string) => utf8Encode(s);

/**
 * A scripted IMAP server: `answer` gets each line the client wrote (literal bytes arrive as their own "line" when the
 * client ends them with CRLF) and returns what the server sends back. Records every byte the client wrote.
 */
function server(answer: (line: string, state: { lines: string[] }) => string | Uint8Array | Array<string | Uint8Array> | undefined, greeting: string | Uint8Array = "* OK ready\r\n") {
  const state = { lines: [] as string[] };
  const opened: Array<[string, number]> = [];
  let written = "";
  let closed = false;
  const queue: Uint8Array[] = [typeof greeting === "string" ? enc(greeting) : greeting];
  let waiting: ((c: Uint8Array | undefined) => void) | undefined;
  let buffer = "";
  const push = (out: string | Uint8Array) => {
    const chunk = typeof out === "string" ? enc(out) : out;
    if (waiting) {
      const w = waiting;
      waiting = undefined;
      w(chunk);
    } else queue.push(chunk);
  };
  const socket: MailSocket = {
    async write(bytes) {
      const text = binaryString(bytes);
      written += text;
      buffer += text;
      for (let i = buffer.indexOf("\r\n"); i >= 0; i = buffer.indexOf("\r\n")) {
        const line = buffer.slice(0, i);
        buffer = buffer.slice(i + 2);
        state.lines.push(line);
        const out = answer(line, state);
        for (const o of out === undefined ? [] : Array.isArray(out) ? out : [out]) push(o);
      }
    },
    read() {
      if (queue.length) return Promise.resolve(queue.shift());
      if (closed) return Promise.resolve(undefined);
      return new Promise((r) => (waiting = r));
    },
    close() {
      closed = true;
      waiting?.(undefined);
    },
  };
  const sockets: MailSocketPort = {
    async open(host, port) {
      opened.push([host, port]);
      return socket;
    },
  };
  return { sockets, opened, state, written: () => written, closed: () => closed };
}

const tagOf = (line: string) => line.split(" ")[0]!;

/** A well-behaved server: SASL-IR, a three-message inbox, and LOGOUT. */
function goodServer(extra?: (line: string) => string | Array<string | Uint8Array> | undefined) {
  const message = (n: number) =>
    enc(`From: =?UTF-8?B?THXDrXM=?= <luis@example.com>\r\nTo: ana@example.com\r\nSubject: Hola ${n}\r\nDate: Tue, 1 Jul 2025 10:52:37 +0200\r\nMessage-ID: <m${n}@example.com>\r\n\r\nCuerpo ${n}\r\n`);
  return server((line) => {
    const extraOut = extra?.(line);
    if (extraOut !== undefined) return extraOut;
    const tag = tagOf(line);
    const cmd = line.slice(tag.length + 1).toUpperCase();
    if (cmd === "CAPABILITY") return [`* CAPABILITY IMAP4rev1 AUTH=PLAIN SASL-IR\r\n`, `${tag} OK done\r\n`];
    if (cmd.startsWith("AUTHENTICATE PLAIN ")) return `${tag} OK signed in\r\n`;
    if (cmd === "EXAMINE INBOX") return [`* 3 EXISTS\r\n`, `* OK [UIDVALIDITY 7] ok\r\n`, `${tag} OK [READ-ONLY] done\r\n`];
    if (cmd.startsWith("UID SEARCH")) return [`* SEARCH 101 103 102\r\n`, `${tag} OK done\r\n`];
    if (cmd.startsWith("UID FETCH") || cmd.startsWith("FETCH ")) {
      // By UID, or by position: message n of the inbox has UID 100 + n.
      const seq = /^FETCH (\d+):(\d+) /.exec(cmd);
      const uids = seq ? Array.from({ length: Number(seq[2]) - Number(seq[1]) + 1 }, (_, i) => String(100 + Number(seq[1]) + i)) : /^UID FETCH ([0-9,]+) /.exec(cmd)![1]!.split(",");
      const out: Array<string | Uint8Array> = [];
      uids.forEach((u, i) => {
        const m = message(Number(u));
        out.push(`* ${i + 1} FETCH (UID ${u} FLAGS (${u === "103" ? "\\Seen" : ""}) INTERNALDATE "01-Jul-2025 08:52:37 +0000" BODY[]<0> {${m.length}}\r\n`, m, `)\r\n`);
      });
      out.push(`${tag} OK done\r\n`);
      return out;
    }
    if (cmd === "LOGOUT") return [`* BYE bye\r\n`, `${tag} OK done\r\n`];
    return `${tag} BAD what\r\n`;
  });
}

describe("IMAP over the app's TLS socket (FR-MAIL-01, Q46)", () => {
  it("signs in with SASL PLAIN over implicit TLS on 993, reads the inbox read-only, and logs out", async () => {
    const s = goodServer();
    const port = createImapPort({ sockets: s.sockets });
    const found = await port.search(SERVER, LOGIN, { mailbox: "INBOX", criteria: [{ key: "UNSEEN" }], limit: 2 });
    expect(s.opened).toEqual([["imap.example.com", 993]]);
    expect(found.map((m) => [m.uid, m.from, m.subject, m.seen])).toEqual([["103", "Luís <luis@example.com>", "Hola 103", true], ["102", "Luís <luis@example.com>", "Hola 102", false]]);
    expect(found[0]!.text).toBe("Cuerpo 103\r\n");
    expect(found[0]!.messageId).toBe("<m103@example.com>");
    const lines = s.state.lines.map((l) => l.replace(/^h\d+ /, ""));
    expect(lines).toContain("EXAMINE INBOX");
    expect(lines.some((l) => /^SELECT/i.test(l))).toBe(false);
    expect(lines.find((l) => l.startsWith("UID FETCH"))).toBe("UID FETCH 103,102 (UID FLAGS INTERNALDATE BODY.PEEK[]<0.32768>)");
    expect(lines.at(-1)).toBe("LOGOUT");
    expect(s.closed()).toBe(true);
  });

  it("the inbox list (no search terms) fetches the newest by position, never a SEARCH ALL over the whole mailbox", async () => {
    const s = goodServer();
    const found = await createImapPort({ sockets: s.sockets }).search(SERVER, LOGIN, { mailbox: "INBOX", criteria: [{ key: "ALL" }], limit: 2 });
    expect(found.map((m) => m.uid)).toEqual(["103", "102"]);
    const lines = s.state.lines.map((l) => l.replace(/^h\d+ /, ""));
    expect(lines).toContain("FETCH 2:3 (UID FLAGS INTERNALDATE BODY.PEEK[]<0.32768>)");
    expect(lines.some((l) => l.startsWith("UID SEARCH"))).toBe(false);
  });

  it("verify: ok, auth_failed on NO, and unreachable for anything else; the password is never in a quoted string", async () => {
    expect(await createImapPort({ sockets: goodServer().sockets }).verify(SERVER, LOGIN)).toBe("ok");
    const refused = goodServer((line) => (/AUTHENTICATE/.test(line) ? `${tagOf(line)} NO [AUTHENTICATIONFAILED] wrong\r\n` : undefined));
    expect(await createImapPort({ sockets: refused.sockets }).verify(SERVER, LOGIN)).toBe("auth_failed");
    const broken = goodServer((line) => (/AUTHENTICATE/.test(line) ? `${tagOf(line)} BAD huh\r\n` : undefined));
    expect(await createImapPort({ sockets: broken.sockets }).verify(SERVER, LOGIN)).toBe("unreachable");
  });

  it("never signs in on a session it didn't open itself: PREAUTH, BYE or no IMAP4rev1, and no password is written", async () => {
    for (const greeting of ["* PREAUTH welcome\r\n", "* BYE busy\r\n", "garbage\r\n"]) {
      const s = server(() => undefined, greeting);
      expect(await createImapPort({ sockets: s.sockets }).verify(SERVER, LOGIN)).toBe("unreachable");
      expect(s.written()).not.toContain("AUTHENTICATE");
    }
    const old = server((line) => (line.endsWith("CAPABILITY") ? [`* CAPABILITY IMAP2\r\n`, `${tagOf(line)} OK\r\n`] : undefined));
    expect(await createImapPort({ sockets: old.sockets }).verify(SERVER, LOGIN)).toBe("unreachable");
    expect(old.written()).not.toMatch(/AUTHENTICATE|LOGIN/);
  });

  it("only port 993: any other port is refused before a socket opens", async () => {
    const s = goodServer();
    expect(await createImapPort({ sockets: s.sockets }).verify({ host: "imap.example.com", port: 143 }, LOGIN)).toBe("unreachable");
    expect(s.opened).toEqual([]);
  });

  it("LOGIN sends the username and password as literals after the server's go-ahead, never pasted into the command", async () => {
    // The username's literal, then the password's: each waits for "+" before its bytes go.
    const steps = ["+ go\r\n", "+ go\r\n", "h2 OK in\r\n"];
    let step = -1;
    const s = server((line) => {
      if (line.endsWith(" CAPABILITY")) return [`* CAPABILITY IMAP4rev1\r\n`, `${tagOf(line)} OK\r\n`];
      if (/^h2 LOGIN \{\d+\}$/.test(line)) step = 0;
      if (step >= 0 && step < steps.length) return steps[step++];
      if (line.endsWith(" LOGOUT")) return `${tagOf(line)} OK\r\n`;
      return undefined;
    });
    expect(await createImapPort({ sockets: s.sockets }).verify(SERVER, LOGIN)).toBe("ok");
    const password = LOGIN.password.reveal();
    expect(s.written()).toContain(`h2 LOGIN {${enc("ana@example.com").length}}\r\n`);
    expect(s.written()).toContain(`{${enc(password).length}}\r\n${binaryString(enc(password))}\r\n`);
    expect(s.written()).not.toContain(`"${password}"`);
  });

  it("a server that offers no password sign-in (LOGINDISABLED, no AUTH=PLAIN) gets no password", async () => {
    const s = server((line) => (line.endsWith(" CAPABILITY") ? [`* CAPABILITY IMAP4rev1 LOGINDISABLED AUTH=XOAUTH2\r\n`, `${tagOf(line)} OK\r\n`] : `${tagOf(line)} OK\r\n`));
    expect(await createImapPort({ sockets: s.sockets }).verify(SERVER, LOGIN)).toBe("unreachable");
    expect(s.written()).not.toMatch(/LOGIN \{|AUTHENTICATE/);
  });
});

describe("what Hermit sends can't become another command", () => {
  it("quotes ASCII values with escapes, sends anything else as a UTF-8 literal, and drops control characters", () => {
    expect(searchParts([{ key: "UNSEEN" }, { key: "FROM", value: 'a"b\\c' }])).toEqual(["UID SEARCH", " UNSEEN", ' FROM "a\\"b\\\\c"']);
    const injected = searchParts([{ key: "TEXT", value: 'x"\r\nh9 DELETE INBOX' }]);
    expect(injected).toEqual(["UID SEARCH", ' TEXT "x\\"h9 DELETE INBOX"']);
    const accents = searchParts([{ key: "TEXT", value: "canción" }]);
    expect(accents[0]).toBe("UID SEARCH CHARSET UTF-8");
    expect(accents[2]).toEqual(enc("canción"));
    expect(searchParts([{ key: "FROM", value: "\r\n" }])).toEqual(["UID SEARCH", " ALL"]);
  });
});

describe("what the server sends is read with caps (adversarial)", () => {
  const port = (s: ReturnType<typeof server>) => createImapPort({ sockets: s.sockets, deadlineMs: 2000 });
  const search = (s: ReturnType<typeof server>) => port(s).search(SERVER, LOGIN, { mailbox: "INBOX", criteria: [{ key: "UNSEEN" }], limit: 5 });

  it("a literal larger than a message is refused before it is read", async () => {
    const s = goodServer((line) => (/UID FETCH/.test(line) ? `* 1 FETCH (UID 101 BODY[]<0> {${IMAP_MESSAGE_BYTES + 1}}\r\n` : undefined));
    await expect(search(s)).rejects.toThrow(/literal larger/);
    expect(s.closed()).toBe(true);
  });

  it("a line that never ends, or more bytes than a command may read, ends the session", async () => {
    const endless = goodServer((line) => (/UID SEARCH/.test(line) ? `* SEARCH ${"1 ".repeat(600_000)}` : undefined));
    await expect(search(endless)).rejects.toThrow(/too long|more than/);
    const flood = goodServer((line) => (/UID SEARCH/.test(line) ? Array.from({ length: 5000 }, () => `* OK ${"x".repeat(1000)}\r\n`) : undefined));
    await expect(search(flood)).rejects.toThrow(/more than Hermit reads/);
  });

  it("an answer with another command's tag, an unbalanced list or a bad escape is an error, not a partial result", async () => {
    const wrongTag = goodServer((line) => (/UID SEARCH/.test(line) ? `h99 OK done\r\n` : undefined));
    await expect(search(wrongTag)).rejects.toThrow(/never sent/);
    const unbalanced = goodServer((line) => (/UID FETCH/.test(line) ? [`* 1 FETCH (UID 101 FLAGS (\\Seen)\r\n`, `${tagOf(line)} OK\r\n`] : undefined));
    await expect(search(unbalanced)).rejects.toThrow(/never closed/);
    expect(() => tokenize(['"a\\qb"'], [])).toThrow(/bad escape/);
    expect(() => tokenize(["(((((((((x)))))))))"], [])).toThrow(/too deep/);
  });

  it("a server that stops answering is cut off at the deadline and the socket closes", async () => {
    const s = goodServer((line) => (/UID SEARCH/.test(line) ? [] : undefined));
    await expect(createImapPort({ sockets: s.sockets, deadlineMs: 50 }).search(SERVER, LOGIN, { mailbox: "INBOX", criteria: [{ key: "UNSEEN" }], limit: 5 })).rejects.toThrow(/too long/);
    expect(s.closed()).toBe(true);
  });

  it("FETCH items the client didn't ask for, odd UIDs or unknown message numbers are ignored", async () => {
    const s = goodServer((line) =>
      /UID FETCH/.test(line)
        ? [`* 9 FETCH (FLAGS (\\Seen))\r\n`, `* 1 FETCH (UID 0 BODY[]<0> "x")\r\n`, `* 2 FETCH (UID 555 BODY[]<0> "Subject: no")\r\n`, `${tagOf(line)} OK\r\n`]
        : undefined,
    );
    expect(await search(s)).toEqual([]);
  });
});
