// SL-48 and SL-49: the phone's email, built once by createPorts. @hermit/mail's service over:
// - the mail transport (../mail-transport): Gmail's and Microsoft's exact hosts only, every request counted for the
//   privacy screen (FR-PRIV-02), expo/fetch with no redirect followed;
// - the Keystore-backed credential store (./credentials), the only place tokens live (FR-CONN-03);
// - the encrypted database's settings table for the accounts and the address book (no secrets);
// - the platform's secure random source for PKCE and the state.
// The ports get its skills, render context, night hooks, past recipients and email code source; the HM-MAIL screens
// read the same service through mailService(). IMAP and SMTP run on the hermit-tls module's sockets (Q46, Q158): a
// build without the module has no IMAP, and HM-MAIL-01 says so.
import { fetch as expoFetch } from "expo/fetch";
import { getRandomBytes, randomUUID } from "expo-crypto";
import type { SqlPort, StopSignal } from "@hermit/core";
import { base64ToBytes, bytesToBase64, createImapPort, createMailService, createSmtpPort, settingsMailKv, type MailService } from "@hermit/mail";
import { HermitTls } from "../../modules/hermit-tls";
import { createMailSockets } from "../mail-sockets";
import { createMailTransport, type MailFetch } from "../mail-transport";
import { phoneCredentials } from "./credentials";
import { countOutbound } from "./net";

export const mailTransport = createMailTransport({ fetch: expoFetch as unknown as MailFetch, count: countOutbound, timeoutMs: 30_000 });

const sockets = createMailSockets(HermitTls, { count: countOutbound, timeoutMs: 30_000, toBase64: (b) => bytesToBase64(b), fromBase64: base64ToBytes });
const mailServers = HermitTls ? { imap: createImapPort({ sockets }), smtp: createSmtpPort({ sockets }) } : {};

const sleep = (ms: number, signal: StopSignal) =>
  new Promise<void>((resolve) => {
    const timer = setTimeout(done, ms);
    function done() {
      clearTimeout(timer);
      signal.removeEventListener("abort", done);
      resolve();
    }
    signal.addEventListener("abort", done, { once: true });
  });

let service: MailService | undefined;

/** Builds the service over this run's database (once; the same one every later call). */
export function startMail(sql: SqlPort): MailService {
  service ??= createMailService({
    credentials: phoneCredentials,
    transport: mailTransport,
    kv: settingsMailKv(sql),
    now: () => Date.now(),
    newId: () => randomUUID(),
    timeZone: () => Intl.DateTimeFormat().resolvedOptions().timeZone,
    random: (n) => getRandomBytes(n),
    sleep,
    ...mailServers,
  });
  return service;
}

/** The service the HM-MAIL screens use; undefined until the runtime started. */
export function mailService(): MailService | undefined {
  return service;
}
