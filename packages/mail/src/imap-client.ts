/*
 * A small IMAP4rev1 client (RFC 3501, FR-MAIL-01, Q46) for ImapPort: implicit TLS on 993 only, read-only (EXAMINE and
 * BODY.PEEK, so nothing is marked read), the app password sent only inside TLS (AUTHENTICATE PLAIN, or LOGIN with
 * literals). Every value Hermit sends is a quoted string or a literal built here, never text pasted into a command;
 * every response is read with caps (a line, a literal, a command's bytes), and anything unexpected ends the session.
 */
import type { ImapServer } from "./accounts.ts";
import { ImapAuthError, type ImapCriterion, type ImapFetched, type ImapLogin, type ImapPort } from "./imap.ts";
import { asciiBytes, binaryString, createSocketReader, MailProtocolError, type MailSocket, type MailSocketPort, type SocketReader } from "./mail-socket.ts";
import { bytesToBase64, utf8Encode } from "./mime.ts";
import { readMessage } from "./mime-read.ts";

export const IMAP_PORT = 993;
/** What one message may bring: the start of each list item, and a whole message when one is opened. */
export const IMAP_PREVIEW_BYTES = 32_768;
export const IMAP_MESSAGE_BYTES = 1_048_576;
/** A SEARCH answer is one line: room for about 140,000 UIDs. */
const MAX_LINE = 1_048_576;
const MAX_RESPONSES = 20_000;
const MAX_LIST = 50;
/** Bytes a command may read in all: a search's previews or one message, plus room for the protocol around them. */
const BUDGET = 4 * 1_048_576;

/** A response token: an atom or a quoted string (as a binary string), a literal's bytes, NIL, or a parenthesized list. */
export type ImapToken = string | Uint8Array | null | ImapToken[];

export interface ImapResponse {
  kind: "untagged" | "tagged" | "continue";
  tag?: string;
  /** Tagged and untagged status responses: OK, NO, BAD, BYE or PREAUTH, upper case. */
  status?: string;
  /** Status text, untouched (it is free text, never tokens). */
  text: string;
  /** Data responses (CAPABILITY, SEARCH, FETCH, EXISTS...): the tokens after `*`. */
  data: ImapToken[];
}

const STATUS = new Set(["OK", "NO", "BAD", "BYE", "PREAUTH"]);
const LITERAL_AT_END = /\{(\d{1,10})\}$/;

/** Splits one response's text (with its literals in place of `{n}`) into tokens; throws on anything malformed. */
export function tokenize(segments: readonly string[], literals: readonly Uint8Array[]): ImapToken[] {
  const root: ImapToken[] = [];
  const stack: ImapToken[][] = [root];
  let depth = 0;
  segments.forEach((seg, si) => {
    let i = 0;
    const text = si < literals.length ? seg.replace(LITERAL_AT_END, "") : seg;
    while (i < text.length) {
      const c = text[i]!;
      const top = stack[stack.length - 1]!;
      if (c === " ") i++;
      else if (c === "(") {
        if (++depth > 8) throw new MailProtocolError("lists nested too deep");
        const list: ImapToken[] = [];
        top.push(list);
        stack.push(list);
        i++;
      } else if (c === ")") {
        if (stack.length === 1) throw new MailProtocolError("a list closed that never opened");
        stack.pop();
        depth--;
        i++;
      } else if (c === '"') {
        let out = "";
        let j = i + 1;
        for (; j < text.length && text[j] !== '"'; j++) {
          if (text[j] === "\\") {
            j++;
            if (text[j] !== "\\" && text[j] !== '"') throw new MailProtocolError("a bad escape in a quoted string");
          }
          out += text[j];
        }
        if (j >= text.length) throw new MailProtocolError("a quoted string never ended");
        top.push(out);
        i = j + 1;
      } else {
        // An atom, with any [section] kept whole: BODY[]<0>, BODY[HEADER.FIELDS (FROM)], \Seen, 1234.
        let j = i;
        let bracket = 0;
        for (; j < text.length; j++) {
          const d = text[j]!;
          if (d === "[") bracket++;
          else if (d === "]") bracket--;
          else if (bracket === 0 && (d === " " || d === "(" || d === ")" || d === '"')) break;
          if (d.charCodeAt(0) < 0x20 || d.charCodeAt(0) === 0x7f) throw new MailProtocolError("a control character in a response");
        }
        if (bracket !== 0) throw new MailProtocolError("a section never closed");
        const atom = text.slice(i, j);
        top.push(atom.toUpperCase() === "NIL" ? null : atom);
        i = j;
      }
    }
    if (si < literals.length) stack[stack.length - 1]!.push(literals[si]!);
  });
  if (stack.length !== 1) throw new MailProtocolError("a list never closed");
  return root;
}

/** Reads one whole response: its first line, then each literal it announces and the line after it. */
export async function readResponse(reader: SocketReader, maxLiteral: number): Promise<ImapResponse> {
  const segments = [await reader.line()];
  const literals: Uint8Array[] = [];
  for (;;) {
    const last = segments[segments.length - 1]!;
    const m = LITERAL_AT_END.exec(last);
    // A status response's text is free text: a "{5}" at its end is just text.
    if (!m || isStatusLine(segments[0]!)) break;
    const n = Number(m[1]);
    if (n > maxLiteral) throw new MailProtocolError("a literal larger than Hermit reads");
    if (literals.length >= 64) throw new MailProtocolError("too many literals in one response");
    literals.push(await reader.bytes(n));
    segments.push(await reader.line());
  }
  const first = segments[0]!;
  if (first.startsWith("+")) return { kind: "continue", text: first.slice(1).trimStart(), data: [] };
  const space = first.indexOf(" ");
  const head = space < 0 ? first : first.slice(0, space);
  const rest = space < 0 ? "" : first.slice(space + 1);
  const word = rest.split(" ", 1)[0]!.toUpperCase();
  if (head === "*") {
    if (STATUS.has(word)) return { kind: "untagged", status: word, text: rest.slice(word.length).trimStart(), data: [] };
    return { kind: "untagged", text: "", data: tokenize([rest, ...segments.slice(1)], literals) };
  }
  if (!/^[A-Za-z0-9]{1,16}$/.test(head) || !STATUS.has(word)) throw new MailProtocolError("a response Hermit can't read");
  return { kind: "tagged", tag: head, status: word, text: rest.slice(word.length).trimStart(), data: [] };
}

function isStatusLine(line: string): boolean {
  const [head, word] = line.split(" ", 3);
  return head !== undefined && (head === "*" || /^[A-Za-z0-9]{1,16}$/.test(head)) && STATUS.has((word ?? "").toUpperCase());
}

/** An IMAP quoted string for printable ASCII, or undefined when the value needs a literal. */
export function imapQuoted(value: string): string | undefined {
  if (!/^[\x20-\x7e]*$/.test(value)) return undefined;
  return `"${value.replace(/[\\"]/g, (c) => `\\${c}`)}"`;
}


/** A command: Hermit's own protocol text, with each value as a literal (bytes) between the pieces. */
type Part = string | Uint8Array;

interface Session {
  capabilities: Set<string>;
  /**
   * Sends a command and reads to its tagged answer; returns the untagged data responses. `sasl` answers the one
   * continuation a SASL exchange asks for; any other continuation ends the session.
   */
  run(parts: Part[], opts?: { budget?: number; sasl?: string }): Promise<{ status: string; data: ImapToken[][] }>;
}

const upper = (t: ImapToken | undefined): string => (typeof t === "string" ? t.toUpperCase() : "");

async function openSession(socket: MailSocket): Promise<Session> {
  const reader = createSocketReader(socket, { maxLine: MAX_LINE, budget: BUDGET });
  let n = 0;
  const greeting = await readResponse(reader, 0);
  // PREAUTH or BYE: never go on with a session Hermit didn't sign in to itself.
  if (greeting.kind !== "untagged" || greeting.status !== "OK") throw new MailProtocolError("the server didn't greet with OK");
  const write = async (parts: Part[]) => {
    for (const p of parts) await socket.write(typeof p === "string" ? asciiBytes(p) : p);
  };
  const session: Session = {
    capabilities: new Set(),
    async run(parts, opts = {}) {
      reader.budget(opts.budget ?? BUDGET);
      const tag = `h${++n}`;
      const data: ImapToken[][] = [];
      let sasl = opts.sasl;
      let pending: Part[] = [`${tag} `];
      const next = async (): Promise<ImapResponse> => {
        const r = await readResponse(reader, IMAP_MESSAGE_BYTES);
        if (r.kind === "tagged" && r.tag !== tag) throw new MailProtocolError("an answer to a command Hermit never sent");
        if (r.kind === "untagged" && r.status === "BYE") throw new MailProtocolError("the server ended the session");
        if (r.kind === "untagged" && r.data.length) {
          data.push(r.data);
          if (data.length > MAX_RESPONSES) throw new MailProtocolError("too many responses");
        }
        return r;
      };
      for (const p of parts) {
        if (typeof p === "string") {
          pending.push(p);
          continue;
        }
        // A synchronizing literal: announce it, wait for the go-ahead, then send the bytes.
        pending.push(`{${p.length}}\r\n`);
        await write(pending);
        pending = [];
        for (;;) {
          const r = await next();
          if (r.kind === "continue") break;
          if (r.kind === "tagged") return { status: r.status!, data };
        }
        pending.push(p);
      }
      pending.push("\r\n");
      await write(pending);
      for (;;) {
        const r = await next();
        if (r.kind === "tagged") return { status: r.status!, data };
        if (r.kind === "continue") {
          if (sasl === undefined) throw new MailProtocolError("the server asked for data Hermit never offered");
          await write([`${sasl}\r\n`]);
          sasl = undefined;
        }
      }
    },
  };
  const caps = await session.run(["CAPABILITY"]);
  for (const d of caps.data) if (upper(d[0]) === "CAPABILITY") for (const c of d.slice(1)) session.capabilities.add(upper(c));
  if (caps.status !== "OK" || !session.capabilities.has("IMAP4REV1")) throw new MailProtocolError("not an IMAP4rev1 server");
  return session;
}

/** The app password goes only over this session's TLS connection, as SASL PLAIN or as LOGIN's literals. */
async function authenticate(session: Session, login: ImapLogin): Promise<void> {
  const password = login.password.reveal();
  if (!login.username || /[\0\r\n]/.test(login.username) || password.includes("\0")) throw new ImapAuthError("a username or password Hermit can't send");
  let status: string;
  if (session.capabilities.has("AUTH=PLAIN")) {
    const plain = bytesToBase64(utf8Encode(`\0${login.username}\0${password}`));
    status = session.capabilities.has("SASL-IR")
      ? (await session.run([`AUTHENTICATE PLAIN ${plain}`])).status
      : (await session.run(["AUTHENTICATE PLAIN"], { sasl: plain })).status;
  } else if (!session.capabilities.has("LOGINDISABLED")) {
    status = (await session.run(["LOGIN ", utf8Encode(login.username), " ", utf8Encode(password)])).status;
  } else {
    throw new MailProtocolError("the server offers no way to sign in with a password");
  }
  if (status === "NO") throw new ImapAuthError();
  if (status !== "OK") throw new MailProtocolError("the server refused the sign-in command");
}

/** SEARCH keys with each value as a quoted string, or as a literal when it isn't plain ASCII (then CHARSET UTF-8). */
export function searchParts(criteria: readonly ImapCriterion[]): Part[] {
  const keys: Part[] = [];
  let utf8 = false;
  for (const c of criteria) {
    if (c.key === "ALL" || c.key === "UNSEEN") {
      keys.push(` ${c.key}`);
      continue;
    }
    const value = [...c.value].filter((ch) => ch.charCodeAt(0) >= 0x20 && ch.charCodeAt(0) !== 0x7f).join("").slice(0, 200);
    if (!value) continue;
    const quoted = imapQuoted(value);
    if (quoted) keys.push(` ${c.key} ${quoted}`);
    else {
      utf8 = true;
      keys.push(` ${c.key} `, utf8Encode(value));
    }
  }
  if (!keys.length) keys.push(" ALL");
  return [utf8 ? "UID SEARCH CHARSET UTF-8" : "UID SEARCH", ...keys];
}

const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];

/** INTERNALDATE ("17-Jul-1996 02:44:25 -0700") to epoch ms. */
export function internalDate(text: string): number | undefined {
  const m = /^\s?(\d{1,2})-([A-Za-z]{3})-(\d{4}) (\d{2}):(\d{2}):(\d{2}) ([+-])(\d{2})(\d{2})$/.exec(text);
  const month = m ? MONTHS.indexOf(m[2]!.toUpperCase()) : -1;
  if (!m || month < 0) return undefined;
  const offset = (m[7] === "-" ? -1 : 1) * (Number(m[8]) * 60 + Number(m[9])) * 60_000;
  return Date.UTC(Number(m[3]), month, Number(m[1]), Number(m[4]), Number(m[5]), Number(m[6])) - offset;
}

const UID = /^[1-9][0-9]{0,9}$/;

/** One FETCH response's UID, FLAGS, INTERNALDATE and message bytes, from the pairs the server sent. */
export function fetchedFrom(data: ImapToken[]): ImapFetched | undefined {
  if (data.length !== 3 || typeof data[0] !== "string" || !/^[0-9]{1,10}$/.test(data[0]) || upper(data[1]) !== "FETCH" || !Array.isArray(data[2])) return undefined;
  const items = data[2];
  let uid: string | undefined;
  let seen = false;
  let date: number | undefined;
  let raw: Uint8Array | string | undefined;
  for (let i = 0; i + 1 < items.length; i += 2) {
    const name = upper(items[i]);
    const value = items[i + 1];
    if (name === "UID" && typeof value === "string" && UID.test(value)) uid = value;
    else if (name === "FLAGS" && Array.isArray(value)) seen = value.some((f) => upper(f) === "\\SEEN");
    else if (name === "INTERNALDATE" && typeof value === "string") date = internalDate(value);
    else if (name.startsWith("BODY[]") && (value instanceof Uint8Array || typeof value === "string")) raw = value;
  }
  if (!uid || raw === undefined) return undefined;
  const m = readMessage(typeof raw === "string" ? raw : binaryString(raw));
  return {
    uid, from: m.from, to: m.to, cc: m.cc, subject: m.subject, at: m.date ?? date ?? 0, seen,
    ...(m.text !== undefined ? { text: m.text } : {}),
    ...(m.html !== undefined ? { html: m.html } : {}),
    ...(m.messageId ? { messageId: m.messageId } : {}),
    ...(m.references ? { references: m.references } : {}),
  };
}

/**
 * ImapPort over the app's TLS sockets. Each call is one session: connect, sign in, EXAMINE INBOX (read-only), the
 * command, LOGOUT. `deadlineMs` bounds a whole call; the socket is closed when it ends, whatever happened.
 */
export function createImapPort(deps: { sockets: MailSocketPort; deadlineMs?: number }): ImapPort {
  const deadline = deps.deadlineMs ?? 60_000;
  const session = async <T>(server: ImapServer, login: ImapLogin, op: (s: Session) => Promise<T>): Promise<T> => {
    if (server.port !== IMAP_PORT) throw new MailProtocolError("IMAP goes over implicit TLS on 993 only");
    const socket = await deps.sockets.open(server.host, IMAP_PORT);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        socket.close();
        reject(new MailProtocolError("the server took too long"));
      }, deadline);
    });
    try {
      return await Promise.race([
        (async () => {
          const s = await openSession(socket);
          await authenticate(s, login);
          const out = await op(s);
          await s.run(["LOGOUT"]).catch(() => undefined);
          return out;
        })(),
        timeout,
      ]);
    } finally {
      if (timer !== undefined) clearTimeout(timer);
      socket.close();
    }
  };
  /** Opens INBOX read-only; how many messages it holds. */
  const examine = async (s: Session): Promise<number> => {
    const r = await s.run(["EXAMINE INBOX"]);
    if (r.status !== "OK") throw new MailProtocolError("the inbox couldn't be opened");
    const exists = r.data.find((d) => d.length === 2 && upper(d[1]) === "EXISTS" && typeof d[0] === "string" && /^[0-9]{1,10}$/.test(d[0]));
    return exists ? Number(exists[0]) : 0;
  };
  const items = (bytes: number) => `(UID FLAGS INTERNALDATE BODY.PEEK[]<0.${bytes}>)`;
  /** The messages a FETCH returned, once each, newest (highest UID) first; only `wanted` ones when given. */
  const collect = (data: ImapToken[][], wanted?: readonly string[]): ImapFetched[] => {
    const byUid = new Map<string, ImapFetched>();
    for (const d of data) {
      const f = fetchedFrom(d);
      if (f && (!wanted || wanted.includes(f.uid)) && !byUid.has(f.uid)) byUid.set(f.uid, f);
    }
    return [...byUid.values()].sort((a, b) => Number(b.uid) - Number(a.uid));
  };
  const fetchUids = async (s: Session, uids: string[], bytes: number): Promise<ImapFetched[]> => {
    if (!uids.length) return [];
    const r = await s.run([`UID FETCH ${uids.join(",")} ${items(bytes)}`]);
    if (r.status !== "OK") throw new MailProtocolError("the server refused the fetch");
    return collect(r.data, uids);
  };
  return {
    async verify(server, login) {
      try {
        await session(server, login, async () => undefined);
        return "ok";
      } catch (err) {
        return err instanceof ImapAuthError ? "auth_failed" : "unreachable";
      }
    },
    search: (server, login, request) =>
      session(server, login, async (s) => {
        const exists = await examine(s);
        const limit = Math.max(0, Math.min(request.limit, MAX_LIST));
        if (!limit || !exists) return [];
        if (request.criteria.every((c) => c.key === "ALL")) {
          // The newest messages by position: no SEARCH ALL that would list the whole mailbox.
          const r = await s.run([`FETCH ${Math.max(1, exists - limit + 1)}:${exists} ${items(IMAP_PREVIEW_BYTES)}`]);
          if (r.status !== "OK") throw new MailProtocolError("the server refused the fetch");
          return collect(r.data).slice(0, limit);
        }
        const r = await s.run(searchParts(request.criteria));
        if (r.status !== "OK") throw new MailProtocolError("the server refused the search");
        const found: number[] = [];
        for (const d of r.data) {
          if (upper(d[0]) !== "SEARCH") continue;
          for (const t of d.slice(1)) if (typeof t === "string" && UID.test(t)) found.push(Number(t));
        }
        // Higher UIDs arrived later: newest first, at most `limit`.
        const newest = [...new Set(found)].sort((a, b) => b - a).slice(0, limit).map(String);
        return fetchUids(s, newest, IMAP_PREVIEW_BYTES);
      }),
    fetch: (server, login, _mailbox, uid) =>
      UID.test(uid)
        ? session(server, login, async (s) => {
            await examine(s);
            return (await fetchUids(s, [uid], IMAP_MESSAGE_BYTES))[0];
          })
        : Promise.resolve(undefined),
  };
}
