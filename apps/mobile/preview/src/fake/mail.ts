// Preview only: sample email for the HM-MAIL screens (SL-48, SL-49), shaped like @hermit/mail's MailService and the
// runtime's relay sign-in choices. Built with the package's own view functions (mailAccountsView, mailShownView,
// mailDraftView), so the screens render exactly what the app would. Nothing reaches a provider. `scene.variant` picks
// the state: "empty", "handoff", "waiting", "signin" (a refused token), "noclient", "connected", "disconnected" and
// "error", "imap" (an IMAP account too), "imapbad" (the form, a refused app password) and "noimap" (a build
// without the TLS sockets) on HM-MAIL-01; "empty" on HM-MAIL-02 and 03; "gone" and "error" on the message view; "empty", "edited",
// "bad", "sent" and "declined" on HM-MAIL-04; "own" on HM-CONN-05.
import type { ApprovalRequest, MailRenderContext } from "@hermit/core";
import { mailAccountsView, mailDraftView, mailShownView, type MailAccount, type MailDraft, type MailService, type ShownItem } from "@hermit/mail";
import { skillById } from "@hermit/skills";
import { scene } from "../scene";

const v = scene.variant;
const en = scene.lang === "en";
const L = (es: string, english: string) => (en ? english : es);
const now = Date.now();
const min = 60_000;
const hour = 60 * min;

const accounts: MailAccount[] = [
  { id: "a1", provider: "gmail", address: "camila.rojas@gmail.com", credentialId: "c1", createdAt: now - 40 * 24 * hour },
  { id: "a2", provider: "outlook", address: "crojas@andesconsultores.cl", label: L("trabajo", "work"), credentialId: "c2", createdAt: now - 12 * 24 * hour },
];
if (v === "imap") {
  accounts.push({
    id: "a3", provider: "imap", address: "camila@fastmail.com", label: L("personal", "personal"), credentialId: "c3", createdAt: now - 2 * 24 * hour,
    imap: { host: "imap.fastmail.com", port: 993 }, smtp: { host: "smtp.fastmail.com", port: 465, security: "tls" },
  });
}
const none = v === "empty" || v === "handoff" || v === "waiting" || v === "noclient";

const item = (ref: string, from: string, subject: string, ago: number, unread: boolean, accountId = "a1"): ShownItem => ({
  ref, id: ref, accountId, from, subject, at: now - ago, preview: "", unread,
});
const listed: ShownItem[] = [
  item("m1", "Luis Mora <luis.mora@gmail.com>", L("¿Almorzamos el martes?", "Lunch on Tuesday?"), 25 * min, true),
  item("m2", "LATAM Airlines <info@latam.com>", L("Tu tarjeta de embarque: SCL a LIM", "Your boarding pass: SCL to LIM"), 2 * hour, true),
  item("m3", "Banco Estado <avisos@bancoestado.cl>", L("Tu estado de cuenta de noviembre", "Your November statement"), 5 * hour, false),
  item("m4", "Andrea Soto <andrea.soto@andesconsultores.cl>", L("Minuta de la reunión de directorio", "Board meeting minutes"), 26 * hour, true, "a2"),
];
const found: ShownItem[] = [
  item("m5", "LATAM Airlines <info@latam.com>", L("Confirmación de tu reserva LA 2453", "Your booking confirmation LA 2453"), 3 * 24 * hour, false),
  item("m6", "LATAM Airlines <ofertas@latam.com>", L("Vuelos a Lima desde 89 dólares", "Flights to Lima from 89 dollars"), 6 * 24 * hour, false),
];

const draft: MailDraft = {
  ref: "d1", accountId: "a1", from: "camila.rojas@gmail.com", to: ["luis.mora@gmail.com"], cc: [],
  subject: L("Re: ¿Almorzamos el martes?", "Re: Lunch on Tuesday?"),
  body: L("¡Hola, Luis! El martes me queda perfecto. ¿Te parece a la 1 en el lugar de siempre?", "Hi Luis! Tuesday works for me. How about 1 pm at the usual place?"),
  replyTo: { ref: "m1", to: "luis.mora@gmail.com" }, savedAt: now - 3 * min, taint: "email",
};
const edited = v === "edited" || v === "bad" ? { ...draft, cc: v === "bad" ? [] : ["carla.mora@gmail.com"] } : draft;

const message = {
  ref: "m2", account: "camila.rojas@gmail.com", from: "LATAM Airlines <info@latam.com>", to: ["camila.rojas@gmail.com"], cc: [],
  subject: L("Tu tarjeta de embarque: SCL a LIM", "Your boarding pass: SCL to LIM"), at: now - 2 * hour, cut: false,
  text: L(
    "Hola, Camila:\n\nYa puedes descargar tu tarjeta de embarque para el vuelo LA 2453 de Santiago a Lima, el jueves 26 a las 08:40.\n\nPuerta: se informará en el aeropuerto.\nAsiento: 14C.\n\nTe recomendamos llegar 2 horas antes. Si viajas con equipaje en bodega, déjalo en el mesón hasta 60 minutos antes de la salida.\n\nBuen viaje,\nLATAM Airlines",
    "Hi Camila,\n\nYour boarding pass for flight LA 2453 from Santiago to Lima, Thursday the 26th at 08:40, is ready to download.\n\nGate: announced at the airport.\nSeat: 14C.\n\nWe recommend arriving 2 hours early. If you're checking a bag, drop it at the counter up to 60 minutes before departure.\n\nHave a good trip,\nLATAM Airlines",
  ),
};

const pending = v === "waiting" ? "gmail" : undefined;
const signInAgain = v === "signin";

/** The subset of MailService the screens call, with the sample data. */
export const fakeMail = {
  view: async () => {
    if (v === "error") throw new Error("preview: load failed");
    const list = none ? [] : accounts;
    const view = mailAccountsView(list);
    return { ...view, rows: view.rows.map((r) => ({ ...r, provider: list.find((a) => a.id === r.id)!.provider, signInAgain: signInAgain && r.id === "a2" })) };
  },
  pendingSignIn: () => pending,
  startSignIn: () => ({ url: "https://accounts.google.com/o/oauth2/v2/auth" }),
  cancelSignIn: () => {},
  finishSignIn: async () => ({ ok: true, account: accounts[0]! }),
  imapAvailable: v !== "noimap",
  connectImap: async () => (v === "imapbad" ? { ok: false, problem: "auth_failed" } : { ok: true, account: accounts[0]! }),
  disconnect: async () => ({ key: "HM-MAIL-01.disconnected" }),
  shown: (screen: "HM-MAIL-02" | "HM-MAIL-03", locale: string) => {
    const items = v === "empty" ? [] : screen === "HM-MAIL-02" ? listed : found;
    return mailShownView({ skill: screen === "HM-MAIL-02" ? "mail_list" : "mail_search", items }, screen, locale, "America/Santiago");
  },
  open: async () => (v === "gone" ? { ok: false, problem: "gone" } : v === "error" ? { ok: false, problem: "unreachable" } : { ok: true, message }),
  draft: (ref?: string) => {
    if (v === "empty") return { view: mailDraftView(undefined), edited: false, tainted: false };
    if (ref && ref !== "d1") return undefined;
    return { ref: "d1", view: mailDraftView(edited), edited: v === "edited" || v === "bad", tainted: true };
  },
  editDraft: () => (v === "bad" ? { ok: false, field: "to", problem: "bad_address" } : { ok: true }),
  draftCall: () => ({ skill: "mail_reply", args: { messageId: "m1", body: draft.body }, taint: "email" }),
  sentDraft: () => {},
  discardDraft: () => true,
  hosts: async () => (none ? [] : ["gmail.googleapis.com", "oauth2.googleapis.com", "graph.microsoft.com", "login.microsoftonline.com"]),
  load: async () => {},
} as unknown as MailService;

/** How the previewed sign-in ended, for HM-MAIL-01's "connected" and "disconnected" shots. */
export const fakeMailResult = v === "connected" ? { ok: true as const, account: accounts[0]! } : undefined;

const own = v === "own" ? { google: "381925460271-h7k2p9q4v8x1m6n3c5b0d2f4g6j8l0r2.apps.googleusercontent.com" } : {};
/** The relay settings' sign-in choices (HM-CONN-05): the user's own client for Google on "own", Dojo's otherwise. */
export const fakeSignIn = {
  signIn: async () => ({
    settings: { ownClientIds: own, dojoRelayOptIn: false },
    config: { dojoClientIds: v === "noclient" ? {} : { google: "1-dojo.apps.googleusercontent.com", microsoft: "00000000-0000-0000-0000-00000000d0d0" } },
  }),
  clients: async () => ({ own, dojo: { google: v !== "noclient", microsoft: v !== "noclient" } }),
  saveClientId: async () => ({ ok: true }),
  removeClientId: async () => {},
};

/** HM-CHAT-01's "mail-chat" shot: the answer after an unread list, tainted, linking HM-MAIL-02 (the runtime's TurnView.mail). */
export async function fakeMailTurn(ev: (e: unknown) => void) {
  if (v !== "mail-chat") return undefined;
  ev({ kind: "picked", skill: "mail_list" });
  ev({ kind: "approved", skill: "mail_list" });
  ev({ kind: "executed", skill: "mail_list", ok: true });
  await new Promise((r) => setTimeout(r, 600));
  return {
    kind: "reply",
    text: L("Tienes 3 correos sin leer. Luis te invita a almorzar el martes, LATAM te mandó la tarjeta de embarque para Lima y Andrea compartió la minuta del directorio.", "You have 3 unread emails. Luis is asking you to lunch on Tuesday, LATAM sent your boarding pass for Lima and Andrea shared the board minutes."),
    mail: "HM-MAIL-02",
    tainted: true,
  };
}

/** HM-MAIL-04's Send: the sheet would open; the preview answers as the user would in the shot's state. */
export const fakeMailSend = async () => (v === "declined" ? "declined" : "sent");

// --- HM-APPR-01 for mail: the sheets the real skills draw (skills/src/catalog.ts) over this sample's mail data ---------
const nameOf = (a: MailAccount) => (a.label ? `${a.address} (${a.label})` : a.address);
const renderMail: MailRenderContext = {
  sender: (wanted) => {
    const a = typeof wanted === "string" && /work|trabajo|andes/i.test(wanted) ? accounts[1]! : accounts[0]!;
    return { ok: true, account: { id: a.id, address: a.address, name: nameOf(a) } };
  },
  account: (id) => {
    const a = accounts.find((x) => x.id === id);
    return a && { id: a.id, address: a.address, name: nameOf(a) };
  },
  message: (ref) => {
    const h = [...listed, ...found].find((x) => x.ref === ref);
    return h && { ref, accountId: h.accountId, from: h.from, subject: h.subject };
  },
  shown: () => listed.map((x) => x.ref),
  known: (address) => address === "luis.mora@gmail.com" || accounts.some((a) => a.address === address),
};

const MAIL_SHEETS: Record<string, { skill: string; args: Record<string, unknown>; said: [string, string]; taint?: boolean }> = {
  "mail-list": { skill: "mail_list", args: {}, said: ["¿Tengo correos nuevos?", "Any new email?"] },
  "mail-send": {
    skill: "mail_send", taint: true,
    args: { to: "rodrigo.paz@gmail.com", subject: L("Fotos del paseo", "Photos from the trip"), body: L("¡Hola, Rodrigo! Te mando las fotos del paseo del sábado. Un abrazo.", "Hi Rodrigo! Here are the photos from Saturday's trip. Hugs.") },
    said: ["Mándale un correo a rodrigo.paz@gmail.com con las fotos del paseo", "Email rodrigo.paz@gmail.com the photos from the trip"],
  },
  "mail-reply": {
    skill: "mail_reply", taint: true,
    args: { messageId: "m1", body: L("¡Hola, Luis! El martes me queda perfecto. ¿A la 1?", "Hi Luis! Tuesday works. 1 pm?") },
    said: ["Respóndele el correo a Luis: el martes me queda perfecto", "Reply to Luis's email: Tuesday works for me"],
  },
  "mail-draft": {
    skill: "mail_draft", taint: true,
    args: { messageId: "m1", body: L("¡Hola, Luis! El martes me queda perfecto.", "Hi Luis! Tuesday works for me.") },
    said: ["Haz un borrador para responderle a Luis", "Draft a reply to Luis"],
  },
  "mail-modify": { skill: "mail_modify", taint: true, args: { messageIds: "shown", action: "archive" }, said: ["Archiva esos correos", "Archive those emails"] },
};

/** The approval sheet for a mail skill, as the runtime asks it after a mail read (tainted as email). */
export function mailApproval(variant: string): ApprovalRequest | undefined {
  const sample = MAIL_SHEETS[variant];
  const def = sample ? skillById(sample.skill) : undefined;
  if (!sample || !def) return undefined;
  const summary = def.describeAction(sample.args, { conversation: () => undefined, mail: renderMail });
  return {
    id: `req-${variant}`, requireBiometric: def.risk === "send", expiresAt: now + 3600_000,
    call: { id: "c-mail", skill: sample.skill as never, argsHash: "5e0d9c2a71b4f863e1a7c90b2d4f6a8c" },
    said: en ? sample.said[1] : sample.said[0],
    summary,
    ...(sample.taint ? { taintWarning: "Suggested after reading email", taintKind: "email" as const } : {}),
  };
}
