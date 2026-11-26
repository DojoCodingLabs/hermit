// Preview only: a Hermit that answers every screen with sample data, shaped like @hermit/runtime's `Hermit`. It has
// no database, model or network. `scene.variant` picks a state where one screen has several (locked vault, empty list).
import { DEFAULT_SPENDING_CAPS, usdt, WALLET_NETWORK, type Money } from "@hermit/core";
import type { Recipe } from "@hermit/core";
import { stepWords, type WebTaskState } from "@hermit/runtime";
import { scene } from "../scene";
import { fakeMailSend, fakeMailTurn, fakeSignIn } from "./mail";

const v = scene.variant;
const en = scene.lang === "en";
const now = Date.now();
const min = 60_000;
const hour = 60 * min;
const day = 24 * hour;
const ok = <T>(x: T) => () => Promise.resolve(x);
const L = (es: string, english: string) => (en ? english : es);

// --- Chat (HM-CHAT-01) ----------------------------------------------------------------------------------------------
const transcript = v === "empty" ? [] : [
  { kind: "user", text: L("¿Qué tengo mañana?", "What do I have tomorrow?") },
  { kind: "assistant", text: L("Mañana tienes dentista a las 9:30 y la reunión con Pedro a las 15:00. También vence el pago de la luz.", "Tomorrow you have the dentist at 9:30 and the meeting with Pedro at 3 pm. The electricity bill is also due.") },
  { kind: "user", text: L("Recuérdame salir 20 minutos antes del dentista", "Remind me to leave 20 minutes before the dentist") },
  { kind: "assistant", text: L("Listo. Te aviso mañana a las 9:10.", "Done. I'll remind you tomorrow at 9:10.") },
  { kind: "user", text: L("¿Ana me escribió algo?", "Did Ana message me?") },
  { kind: "question", text: L("Tengo dos contactos llamados Ana. ¿Cuál?", "I have two contacts called Ana. Which one?") },
];

// Q155: a long answer when asked, and what happens at its cap. The recipe is written the way the long reply prompt asks.
const RECIPE = L(
  "Arroz con leche para 4 personas.\n\nIngredientes:\n- 1 taza de arroz\n- 1 litro de leche entera\n- 3/4 de taza de azúcar\n- 1 rama de canela\n- La cáscara de 1 limón\n\nPasos:\n1. Lava el arroz y déjalo escurrir.\n2. Hierve la leche con la canela y la cáscara de limón.\n3. Agrega el arroz y cocina a fuego bajo unos 30 minutos, revolviendo seguido.\n4. Cuando esté cremoso, suma el azúcar y cocina 5 minutos más.\n5. Saca la canela y la cáscara, y sirve tibio o frío con canela en polvo.",
  "Rice pudding for 4.\n\nIngredients:\n- 1 cup of rice\n- 1 liter of whole milk\n- 3/4 cup of sugar\n- 1 cinnamon stick\n- The peel of 1 lemon\n\nSteps:\n1. Rinse the rice and let it drain.\n2. Bring the milk to a boil with the cinnamon and the lemon peel.\n3. Add the rice and cook on low heat for about 30 minutes, stirring often.\n4. When it is creamy, stir in the sugar and cook 5 more minutes.\n5. Take out the cinnamon and the peel, and serve warm or cold with ground cinnamon.",
);
/** Up to the end of step 2: where a cap of 120 tokens leaves it. */
const RECIPE_CUT = RECIPE.slice(0, RECIPE.indexOf(L("\n3. ", "\n3. ")));
/** Where a stop left it: the ingredients half written. */
const RECIPE_STOPPED = RECIPE.slice(0, RECIPE.indexOf(L("\n- 3/4", "\n- 3/4")));
const pieces = (text: string) => text.match(/[\s\S]{1,7}/g) ?? [];
const streamInto = (text: string, live?: { onToken?(t: string): void }) => {
  for (const t of pieces(text)) live?.onToken?.(t);
};

/**
 * Q155, Seguir: streams the next part; in the "continuing" shot it never finishes, so the picture shows it writing. In
 * the "nothing-more" shot it found nothing new (only lines the reply already had): the reply is whole, and says so.
 */
async function continueReply(_session: string, live?: { onToken?(t: string): void }) {
  const rest = RECIPE.slice(RECIPE_CUT.length);
  if (v === "nothing-more") return { kind: "reply", text: RECIPE_CUT, nothingMore: true };
  if (v === "continuing") {
    streamInto(rest.slice(0, rest.indexOf(L(" unos 30", " for about 30"))), live);
    return new Promise(() => {});
  }
  streamInto(rest, live);
  return { kind: "reply", text: RECIPE };
}

/** A turn in progress: the reasoning streams and a step event says what Hermit is doing; it never finishes. */
async function send(_session: string, _text: string, live?: { onToken?(t: string): void; onThinking?(t: string): void; onEvent?(e: unknown): void }) {
  const ev = (e: unknown) => live?.onEvent?.(e);
  // Q155: the long answer (streamed whole, or still streaming), cut at its cap, Seguir's turn, and a stopped reply.
  if (v === "long" || v === "long-streaming" || v === "cut" || v === "continuing" || v === "nothing-more" || v === "stopped") {
    ev({ kind: "words" });
    if (v === "long-streaming") {
      streamInto(RECIPE.slice(0, RECIPE.indexOf(L("\n4. ", "\n4. "))), live);
      return new Promise(() => {});
    }
    if (v === "long") return streamInto(RECIPE, live), { kind: "reply", text: RECIPE };
    if (v === "stopped") return streamInto(RECIPE_STOPPED, live), { kind: "reply", text: RECIPE_STOPPED, cut: true, stopped: true };
    return streamInto(RECIPE_CUT, live), { kind: "reply", text: RECIPE_CUT, cut: true };
  }
  // SL-48: an answer after reading email, linking the messages it used (from ./mail).
  const mailTurn = await fakeMailTurn(ev);
  if (mailTurn) return mailTurn;
  // A payment the network confirmed (A6) and one a cap refused before any sheet (Q144): the skill's own words.
  if (v === "paid") {
    ev({ kind: "picked", skill: "pay" });
    ev({ kind: "approved", skill: "pay" });
    ev({ kind: "executed", skill: "pay", ok: true });
    return { kind: "reply", text: L("Envié 20.00 USD₮ a Ana. La red lo confirmó (transacción 0x8f3a…c21d).", "Sent 20.00 USD₮ to Ana. The network confirmed it (transaction 0x8f3a…c21d)."), receipt: { kind: "paid", amount: "20.00 USD₮", to: "Ana", hash: "0x8f3a…c21d" } };
  }
  if (v === "refused") {
    ev({ kind: "picked", skill: "pay" });
    ev({ kind: "blocked", skill: "pay", reason: "over_per_payment" });
    return { kind: "reply", text: L("Eso pasa tu límite de 25.00 USD₮ por pago, así que no puedo enviarlo. No se envió nada. Subir el límite no lo envía después; vuelve a pedirlo.", "That's over your 25.00 USD₮ per-payment cap, so I can't send it. Nothing was sent. Raising the cap won't send it later; ask again.") };
  }
  live?.onThinking?.(L("El usuario quiere saber el horario de la farmacia. Necesito buscar en la web...", "The user wants the pharmacy's hours. I need to search the web..."));
  ev({ kind: "picked", skill: "search_web" });
  ev({ kind: "executed", skill: "search_web", ok: true });
  ev({ kind: "picked", skill: "read_web" });
  if (v === "reply") {
    ev({ kind: "executed", skill: "read_web", ok: true });
    await new Promise((r) => setTimeout(r, 1200));
    return { kind: "reply", text: L("La Farmacia Ahumada de Irarrázaval abre hoy hasta las 22:00.", "The Ahumada pharmacy on Irarrázaval is open today until 10 pm."), page: { id: "p1", title: "Farmacia Ahumada Irarrázaval", domain: "www.farmaciasahumada.cl" }, tainted: true };
  }
  return new Promise(() => {});
}

// --- Wallet (HM-PAY-01 to HM-PAY-05) --------------------------------------------------------------------------------
const ADDRESS = "0x9C3f5B2a1E7d4F0b8A6c2D9e1F3a5B7c9D0e2F41";
const ANA = "0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed";
const CARLOS = "0xfB6916095ca1df60bB79Ce92cE3Ea74c37c5d359";
const SHOP = "0xdbF03B407c01E7cD3CBea99509d93f8DDDC8C6FB";
const m = (n: bigint): Money => usdt(n);
const walletStatus = v === "none" ? "none" : v === "needs_backup" ? "needs_backup" : v === "lost" ? "lost" : "ready";
const wallet = {
  status: ok(walletStatus),
  summary: ok(walletStatus === "none" ? { kind: "none" } : { kind: "wallet", status: walletStatus, address: ADDRESS, words: 12, source: "created" }),
  balance: ok({ kind: "balance", usdt: m(127_450_000n) }),
  history: ok(v === "empty" ? { kind: "page", items: [], from: 1_200_000n, to: 1_250_000n, atFloor: true } : {
    kind: "page",
    from: 1_200_000n,
    to: 1_250_000n,
    atFloor: false,
    next: { toBlock: 1_199_999n, floor: 1_000_000n },
    items: [
      { txHash: "0x4f1c2a9be3d07a6c5e8f9012ab34cd56ef7890ab12cd34ef56ab78cd90ef12ab", logIndex: 0, block: 1_249_811n, at: now - 2 * hour, direction: "out", counterparty: ANA, amount: m(20_000_000n), contact: "Ana", unknownSender: false, logSeq: 41 },
      { txHash: "0x8a7b6c5d4e3f2a1b0c9d8e7f6a5b4c3d2e1f0a9b8c7d6e5f4a3b2c1d0e9f8a7b", logIndex: 2, block: 1_248_102n, at: now - 1 * day - 3 * hour, direction: "in", counterparty: CARLOS, amount: m(50_000_000n), contact: "Carlos", unknownSender: false },
      { txHash: "0x1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90a", logIndex: 1, block: 1_240_550n, at: now - 3 * day, direction: "in", counterparty: SHOP, amount: m(4_990_000n), unknownSender: true },
      { txHash: "0x9f8e7d6c5b4a39281706f5e4d3c2b1a09f8e7d6c5b4a39281706f5e4d3c2b1a0", logIndex: 0, block: 1_231_004n, at: now - 6 * day, direction: "out", counterparty: SHOP, amount: m(12_500_000n), unknownSender: false, logSeq: 17 },
      { txHash: "0xabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcd", logIndex: 0, block: 1_210_000n, at: now - 12 * day, direction: "in", counterparty: CARLOS, amount: m(100_000_000n), contact: "Carlos", unknownSender: false },
    ],
  }),
  create: ok({ kind: "created", address: ADDRESS }),
  reveal: ok({ kind: "words", words: "ballena tarde lluvia cometa jardín niebla trompeta vela puente azul faro canela".split(" "), positions: [3, 7, 11] }),
  confirmBackup: ok("confirmed"),
  checkPhrase: () => ({ ok: false, problem: "too_short", words: 0 }),
  restore: ok({ kind: "cancelled" }),
  commitRestore: ok("nothing_pending"),
  cancelRestore: ok(undefined),
  startOver: ok("not_lost"),
  lock: () => {},
};
const payees = [
  { id: "py1", name: "Ana", address: ANA, network: WALLET_NETWORK.network, createdAt: now - 20 * day },
  { id: "py2", name: "Carlos", address: CARLOS, network: WALLET_NETWORK.network, createdAt: now - 9 * day },
];
const payments = {
  caps: ok({ caps: v === "custom" ? { perPayment: m(40_000_000n), perDay: m(100_000_000n) } : DEFAULT_SPENDING_CAPS, custom: v === "custom", spentToday: m(20_000_000n) }),
  setCaps: ok({ kind: "saved" }),
  payees: ok(v === "empty" ? [] : payees),
  savePayee: ok({ kind: "saved" }),
  removePayee: ok("removed"),
};

// --- Vault (HM-VAULT-01 to HM-VAULT-03), profile and fill (HM-FORM-01, HM-FORM-02) ---------------------------------
const vaultItems = [
  { id: "v1", name: "Banco Estado", origins: ["https://www.bancoestado.cl"], createdAt: now - 40 * day, updatedAt: now - 2 * day },
  { id: "v2", name: "Farmacias Ahumada", origins: ["https://www.farmaciasahumada.cl"], createdAt: now - 30 * day, updatedAt: now - 30 * day },
  { id: "v3", name: "Gmail", origins: ["https://accounts.google.com"], createdAt: now - 25 * day, updatedAt: now - 10 * day },
  { id: "v4", name: "Mercado Libre", origins: ["https://www.mercadolibre.cl", "https://auth.mercadolibre.cl"], createdAt: now - 12 * day, updatedAt: now - 12 * day },
  { id: "v5", name: "Netflix", origins: ["https://www.netflix.com"], createdAt: now - 3 * day, updatedAt: now - 3 * day },
];
const vaultStatus = v === "locked" || v === "vault_locked" ? "locked" : v === "none" ? "none" : v === "lost" ? "lost" : "unlocked";
const vault = {
  status: ok(vaultStatus),
  create: ok("created"),
  unlock: ok("unlocked"),
  lock: () => {},
  event: () => {},
  isUnlocked: () => vaultStatus === "unlocked",
  list: ok(vaultStatus === "unlocked" ? { kind: "items", items: v === "empty" ? [] : vaultItems } : { kind: vaultStatus === "lost" ? "lost" : "locked" }),
  entry: (id: string) => Promise.resolve({ kind: "entry", entry: vaultItems.find((i) => i.id === id) ?? vaultItems[0] }),
  save: ok({ kind: "saved", id: "v9" }),
  reveal: ok({ kind: "revealed", secrets: { username: "hugo.prueba@example.com", secret: "T7#rq-Lomas-2291" }, hideAt: now + 30_000 }),
  copy: ok({ kind: "copy", value: "x", clearAfterMs: 45_000 }),
  remove: ok("deleted"),
  reset: ok(undefined),
  generate: () => "q8V!m2Lp#Xz4Rt9w",
  prepareImport: ok(v === "preview" || v === "done" ? {
    kind: "preview",
    preview: {
      format: "chrome", extrasIgnored: 1,
      ready: [
        { row: 2, name: "Cuenta RUT", origins: ["https://www.bancoestado.cl"], dropped: [], existing: [{ id: "v1", name: "Banco Estado" }] },
        { row: 3, name: "Jumbo", origins: ["https://www.jumbo.cl"], dropped: [{ site: "android://com.jumbo", problem: "origin_app" }], existing: [] },
        { row: 4, name: "Spotify", origins: ["https://accounts.spotify.com"], dropped: [], existing: [] },
      ],
      refused: [{ row: 5, name: "Router de la casa", site: "http://192.168.0.1", problems: ["origin_not_https"] }],
    },
  } : { kind: "unreadable" }),
  commitImport: ok(v === "done" ? { kind: "imported", counts: { added: 2, replaced: 0, skipped: 1, refused: 1 } } : { kind: "cancelled" }),
  cancelImport: () => {},
};
const profileValues: Record<string, string> = {
  given_name: "Hugo", family_name: "Prueba Soto", email: "hugo.prueba@example.com", phone: "+56 9 8765 4321",
  street_address: "Av. Irarrázaval 2450", city: "Ñuñoa", region: "Región Metropolitana", postal_code: "7750000", country: "Chile",
};
const sensitiveKinds = new Set(["birth_date", "id_number", "tax_id", "passport_number"]);
const profile = {
  list: ok(["given_name", "family_name", "email", "phone", "street_address", "address_line2", "city", "region", "postal_code", "country", "birth_date", "id_number", "tax_id", "passport_number"].map((kind) => ({
    kind, sensitive: sensitiveKinds.has(kind), locked: sensitiveKinds.has(kind) && kind !== "id_number",
    ...(profileValues[kind] ? { value: profileValues[kind] } : kind === "id_number" ? { value: "12.345.678-5" } : {}),
  }))),
  save: ok({ kind: "saved" }),
  remove: ok({ kind: "removed" }),
};
const forms = {
  prepare: ok(v === "login"
    ? { kind: "login", id: "f1", requester: { kind: "app", packageName: "com.mercadolibre", label: "Mercado Libre", key: "AB:12:CD:34" }, name: "Mercado Libre", fields: ["username", "password"], expiresAt: now + 60_000, signed: { payload: {}, message: "m" } }
    : {
      kind: "preview", id: "f1", requester: { kind: "app", packageName: "com.mercadolibre", label: "Mercado Libre", key: "AB:12:CD:34" }, requireBiometric: true, expiresAt: now + 60_000, skipped: [],
      lines: [
        { key: "f1", kind: "full_name", sensitive: false, value: "Hugo Prueba Soto" },
        { key: "f2", kind: "email", sensitive: false, value: "hugo.prueba@example.com" },
        { key: "f3", kind: "phone", sensitive: false, value: "+56 9 8765 4321" },
        { key: "f4", kind: "id_number", sensitive: true },
      ],
    }),
  approve: ok({ kind: "cancelled" }),
  deny: ok(undefined),
  delivered: ok(undefined),
};

// --- Web (HM-WEB-01, HM-WEB-02) -------------------------------------------------------------------------------------
const recipes: Recipe[] = [
  {
    format: 1, id: "farmacia", version: 2, name: L("Volver a pedir mi receta", "Reorder my prescription"), kind: "reorder", origin: "https://www.farmaciasahumada.cl",
    params: [{ name: "cantidad", label: L("Cantidad de cajas", "Number of boxes"), kind: "number", required: true, default: "2" }, { name: "entrega", label: L("Entrega", "Delivery"), kind: "choice", options: [L("Despacho a domicilio", "Home delivery"), L("Retiro en tienda", "Store pickup")], required: true, default: L("Despacho a domicilio", "Home delivery") }],
    steps: [
      { op: "open", path: "/mi-cuenta/pedidos" },
      { op: "login" },
      { op: "click", target: { role: "button", name: "Comprar de nuevo", nth: 0 } },
      { op: "fill", target: { role: "textbox", name: "Cantidad" }, value: { param: "cantidad" } },
      { op: "select", target: { role: "combobox", name: "Tipo de entrega" }, value: { param: "entrega" } },
      { op: "click", target: { role: "button", name: "Pagar" }, commit: "spend" },
    ],
    createdAt: now - 14 * day, updatedAt: now - 2 * day,
  },
  {
    format: 1, id: "hora", version: 1, name: L("Ver estado de mi hora médica", "Check my doctor's appointment"), kind: "status", origin: "https://agenda.clinicaalemana.cl",
    params: [],
    steps: [{ op: "open", path: "/mis-horas" }, { op: "login" }, { op: "read", question: L("¿Cuándo es mi próxima hora y está confirmada?", "When is my next appointment and is it confirmed?") }],
    createdAt: now - 5 * day, updatedAt: now - 5 * day,
  },
];
function task(recipe: Recipe) {
  const listeners = new Set<(s: WebTaskState) => void>();
  let state: WebTaskState = { kind: "ready" };
  const values = { cantidad: "2", entrega: L("Despacho a domicilio", "Home delivery") };
  return {
    id: "t1",
    plan: () => ({ site: recipe.origin.replace("https://", ""), origin: recipe.origin, steps: recipe.steps.map((s) => stepWords(recipe, s, values)), missing: [] }),
    start: () => {
      const doing = stepWords(recipe, recipe.steps[3]!, values);
      state = v === "paused" ? { kind: "paused", step: 5, total: 6, reason: "pay_yourself", doing: stepWords(recipe, recipe.steps[5]!, values) }
        : v === "done" ? { kind: "finished", end: { kind: "done", repaired: 0, answer: { text: L("Tu pedido #48213 quedó confirmado. Llega el jueves entre 10:00 y 14:00.", "Your order #48213 is confirmed. It arrives Thursday between 10 am and 2 pm."), quotes: [L("Pedido #48213 confirmado", "Order #48213 confirmed")], untrusted: true } } }
        : { kind: "running", step: 3, total: 6, doing };
      setTimeout(() => listeners.forEach((l) => l(state)), 30);
      return new Promise(() => {});
    },
    takeOver: () => {}, resume: () => {}, stop: () => {},
    state: () => state,
    subscribe: (l: (s: WebTaskState) => void) => (listeners.add(l), () => listeners.delete(l)),
    repairedRecipe: () => undefined,
  };
}
const web = {
  recipes: ok(v === "empty" ? [] : recipes),
  claim: ok({ recipe: recipes[0], values: { cantidad: "2" } }),
  task,
  record: ok({ ok: true, origin: "https://www.jumbo.cl" }),
  save: ok({ ok: true }),
  saveFix: ok({ ok: true }),
  remove: ok(true),
  keptSites: ok(v === "empty" ? [] : ["https://www.farmaciasahumada.cl"]),
  keepSignedIn: ok(undefined),
  cleared: ok(undefined),
  loginsFor: ok({ logins: [{ hash: "a".repeat(64), name: "Farmacias Ahumada" }, { hash: "b".repeat(64), name: L("Farmacias Ahumada (mamá)", "Farmacias Ahumada (mom)") }], chosen: "a".repeat(64) }),
  chooseLogin: ok(true),
};
const page = {
  id: "p1", url: "https://www.farmaciasahumada.cl/locales/irarrazaval", domain: "www.farmaciasahumada.cl", title: "Farmacia Ahumada Irarrázaval", at: now - 3 * min,
  text: "Farmacia Ahumada Irarrázaval\nAv. Irarrázaval 3021, Ñuñoa, Santiago.\nHorario: lunes a domingo de 08:00 a 22:00.\nTeléfono: 600 222 4000.\nServicios: toma de presión, vacunatorio, retiro de pedidos web.\nEstacionamiento para clientes en el subterráneo.",
  cut: false, truncated: false, answer: "Abre todos los días de 08:00 a 22:00.", quotes: ["Horario: lunes a domingo de 08:00 a 22:00."],
};

// --- Memory, messages, activity, reminders, calendar --------------------------------------------------------------
const notes = [
  { id: 9, fact: L("Mi dentista es la Dra. Fuentes, en Providencia.", "My dentist is Dr. Fuentes, in Providencia."), tainted: false, createdAt: now - 1 * hour },
  { id: 8, fact: L("Prefiero las reuniones después de las 10.", "I prefer meetings after 10 am."), tainted: false, createdAt: now - 1 * day },
  { id: 7, fact: L("El cumpleaños de mamá es el 14 de marzo.", "Mom's birthday is March 14."), tainted: false, createdAt: now - 3 * day },
  { id: 6, fact: L("La clave del wifi de la oficina cambió el lunes (según un mensaje de Pedro).", "The office wifi password changed on Monday (from a message from Pedro)."), tainted: true, createdAt: now - 4 * day },
  { id: 5, fact: L("Soy alérgico a la penicilina.", "I'm allergic to penicillin."), tainted: false, createdAt: now - 10 * day },
];
const conversations = [
  { id: "wa:carla", title: "Carla Rojas", app: "whatsapp", lastAt: now - 12 * min, canReply: true },
  { id: "wa:familia", title: "Familia Prueba", app: "whatsapp", lastAt: now - 2 * hour, canReply: false },
  { id: "wab:ferreteria", title: "Ferretería Don Lucho", app: "whatsapp_business", lastAt: now - 1 * day, canReply: false },
];
const recent = [
  { conversationId: "wa:carla", conversation: "Carla Rojas", app: "whatsapp", sender: "Carla Rojas", text: "¿Nos vemos el jueves a las 7 en el café de siempre?", at: now - 12 * min },
  { conversationId: "wa:familia", conversation: "Familia Prueba", app: "whatsapp", sender: "Mamá", text: "No olviden el almuerzo del domingo 🙂", at: now - 2 * hour },
  { conversationId: "wa:familia", conversation: "Familia Prueba", app: "whatsapp", sender: "Banco", text: "", at: now - 3 * hour, hidden: "one_time_code" },
  { conversationId: "wab:ferreteria", conversation: "Ferretería Don Lucho", app: "whatsapp_business", sender: "Ferretería Don Lucho", text: "Su pedido está listo para retiro.", at: now - 1 * day },
];
const hash = (i: number) => (`${i}f3a9c2e7b1d4058`.repeat(5)).slice(0, 64);
const activityRows = [
  { seq: 48, at: now - 5 * min, skill: "search_web", mark: "approved", shortHash: "3fa1c09e" },
  { seq: 44, at: now - 40 * min, skill: "read_web", mark: "read_untrusted", shortHash: "b71d2e44" },
  { seq: 41, at: now - 2 * hour, skill: "pay", mark: "approved", shortHash: "9c3e5a10" },
  { seq: 37, at: now - 3 * hour, skill: "reply_message", mark: "denied", shortHash: "e02bb7f1" },
  // Real skill ids only, so every row shows the name the app gives it (no "Otra acción" from a made-up id).
  { seq: 33, at: now - 5 * hour, skill: "remind", mark: "ran", shortHash: "4d6f8a2c" },
  { seq: 30, at: now - 9 * hour, skill: "night.agenda", mark: "ran", shortHash: "71ac03de" },
  { seq: 28, at: now - 9 * hour, skill: "pay", mark: "blocked", shortHash: "aa90f3b2" },
  { seq: 12, at: now - 2 * day, skill: "", mark: "cleared", shortHash: "0b5e7c19", clearedCount: 112 },
];
const chain = v === "broken" ? { kind: "broken", atSeq: 33, reason: "hash" } : { kind: "verified", count: 48 };
const activityDetail = [
  { seq: 41, at: now - 2 * hour - 4000, event: "call_proposed", skill: "pay", argsHash: hash(1), prevHash: hash(2), hash: hash(3), sig: hash(4) + hash(5) },
  { seq: 42, at: now - 2 * hour - 3000, event: "policy_decided", skill: "pay", decision: "ask", argsHash: hash(1), prevHash: hash(3), hash: hash(6), sig: hash(7) + hash(8) },
  { seq: 43, at: now - 2 * hour - 1000, event: "approval", skill: "pay", decision: "ask", outcome: "ok", argsHash: hash(1), prevHash: hash(6), hash: hash(9), sig: hash(1) + hash(2) },
  { seq: 44, at: now - 2 * hour, event: "executed", skill: "pay", outcome: "ok", argsHash: hash(1), prevHash: hash(9), hash: hash(3), sig: hash(4) + hash(6) },
];
const reminders = v === "empty" ? [] : [
  { id: 3, text: L("Salir al dentista", "Leave for the dentist"), at: now + 14 * hour, state: "pending", createdAt: now - 1 * hour },
  { id: 4, text: L("Pagar la luz", "Pay the electricity bill"), at: now + 1 * day + 3 * hour, state: "pending", createdAt: now - 2 * day },
  { id: 5, text: L("Llamar a mamá", "Call mom"), at: now + 4 * day, state: "pending", createdAt: now - 3 * day },
];
const calendarChoice = {
  options: [
    { id: "c1", title: "hugo.prueba@example.com", writable: true, primary: true, account: "hugo.prueba@example.com" },
    { id: "c2", title: L("Trabajo", "Work"), writable: true, account: "hugo@work.example" },
    { id: "c3", title: L("Familia", "Family"), writable: true, account: "hugo.prueba@example.com" },
  ],
  selectedId: "c1",
  chosenGone: v === "gone",
};

// --- Night shift (HM-NIGHT-01, HM-NIGHT-02) -------------------------------------------------------------------------
const nightSettings = { enabled: true, window: { start: "01:00", end: "06:00" }, jobs: ["agenda", "reminders", "messages"], briefingAt: "07:00" };
const ymd = new Date(now).toISOString().slice(0, 10);
const briefing = {
  id: "b1", date: ymd, createdAt: now - 6 * hour, updatedAt: now - 5 * hour, closed: true,
  jobs: [
    { job: "agenda", status: "ran", at: now - 6 * hour },
    { job: "reminders", status: "ran", at: now - 6 * hour },
    { job: "messages", status: "ran", at: now - 6 * hour },
    { job: "mail", status: "skipped", reason: "battery_low" },
  ],
  sections: [
    { job: "agenda", untrusted: true, count: 2, quotes: [], items: [{ at: now + 2 * hour, text: L("Dentista", "Dentist") }, { at: now + 7 * hour, text: L("Reunión con Pedro", "Meeting with Pedro") }] },
    { job: "reminders", untrusted: false, count: 1, quotes: [], items: [{ when: "09:10", text: L("Salir al dentista", "Leave for the dentist") }] },
    { job: "messages", untrusted: true, count: 3, summary: L("Carla pregunta si se juntan el jueves a las 7. Tu mamá recuerda el almuerzo del domingo.", "Carla asks whether you're meeting Thursday at 7. Your mom reminds you about Sunday lunch."), quotes: ["¿Nos vemos el jueves a las 7 en el café de siempre?"], items: [{ who: "Carla Rojas", text: "¿Nos vemos el jueves a las 7?" }, { who: "Mamá", text: "No olviden el almuerzo del domingo" }] },
  ],
  suggestions: [{ id: "sg1", job: "messages", kind: "reply_draft", skill: "reply_message", args: {}, argsHash: "x", tainted: true, taintKind: "inbound_message", vars: { who: "Carla Rojas", subject: L("el jueves a las 7", "Thursday at 7") }, status: "pending", createdAt: now - 6 * hour }],
  refusals: [{ job: "messages", skill: "pay", at: now - 6 * hour }],
};

// --- Connectors (HM-CONN-03 to HM-CONN-05) -------------------------------------------------------------------------
const mcpServers = v === "empty" ? [] : [{
  id: "m1", serverUrl: "https://mcp.notion.com/mcp", host: "mcp.notion.com", auth: "oauth", scopes: ["read", "write"], addedAt: now - 6 * day,
  tools: [
    { name: "search", enabled: true, risk: "network", proposed: "network", readProposal: true, readConfirmed: true, destructive: false, changed: false, reasons: [] },
    { name: "fetch_page", enabled: true, risk: "network", proposed: "network", readProposal: true, readConfirmed: true, destructive: false, changed: false, reasons: [] },
    { name: "create_page", enabled: false, risk: "remote_write", proposed: "remote_write", readProposal: false, readConfirmed: false, destructive: false, changed: false, reasons: [] },
    { name: "delete_block", enabled: false, risk: "remote_write", proposed: "remote_write", readProposal: false, readConfirmed: false, destructive: true, changed: false, reasons: [] },
  ],
}];
const installed = v === "empty" ? [] : [{
  id: "k1", name: "Clima Chile", hosts: ["api.meteochile.gob.cl"], source: "openapi", madeByHermit: false, changed: false, enabled: ["pronostico"], tested: "ok", installedAt: now - 4 * day, lastUsedAt: now - 1 * day,
  operations: [
    { name: "pronostico", title: L("Pronóstico por comuna", "Forecast by district"), method: "GET", path: "/v1/pronostico/{comuna}", risk: "network", destructive: false, enabled: true },
    { name: "alertas", title: L("Alertas vigentes", "Active alerts"), method: "GET", path: "/v1/alertas", risk: "network", destructive: false, enabled: false },
  ],
}];
// HM-CONN-04's review (a connector Hermit drafted from docs) and HM-CONN-03's sign-in hand-off and review.
const connectReview = {
  draftId: "d1", source: "drafted", name: "Bsale", hosts: ["api.bsale.io"], madeByHermit: true, docHost: "docs.bsale.dev", replaces: false,
  signIn: { reading: { kind: "header_key", name: "access_token" }, available: true, changeable: true, words: ["access_token"], needs: "key" },
  operations: [
    { name: "list_documents", title: L("Ver boletas y facturas", "List invoices and receipts"), method: "GET", path: "/v1/documents.json", args: [{ name: "limit", in: "query", type: "integer", required: false }], risk: "network", reason: "", destructive: false, guard: [] },
    { name: "create_payment", title: L("Registrar un pago", "Record a payment"), method: "POST", path: "/v1/payments.json", args: [{ name: "amount", in: "body", type: "number", required: true }], risk: "remote_write", reason: "", destructive: false, guard: [{ effect: "moves_money", word: "payment" }] },
  ],
  testable: ["list_documents"], keySaved: false, skipped: [{}], repairs: 1, specHash: "x",
};
const mcpReview = {
  draftId: "m2", serverUrl: "https://mcp.linear.app/mcp", host: "mcp.linear.app", auth: "oauth", signInHost: "linear.app", scopes: ["read", "write"], skipped: [],
  tools: [
    { name: "list_issues", risk: "network", proposed: "network", readProposal: true, destructive: false, reasons: [], conflicts: [] },
    { name: "create_issue", risk: "remote_write", proposed: "remote_write", readProposal: false, destructive: false, reasons: [], conflicts: [] },
    { name: "delete_issue", risk: "remote_write", proposed: "remote_write", readProposal: false, destructive: true, reasons: [], conflicts: ["destructive"] },
  ],
};
const mcpBegin = v === "review" ? { kind: "review", review: mcpReview }
  : v === "signin" ? { kind: "sign_in", draftId: "m2", host: "mcp.linear.app", signInHost: "linear.app", scopes: ["read", "write"], authorizationUrl: "https://linear.app/oauth/authorize" }
  : { kind: "refused", problem: "bad_url" };
const connectStart = v === "review" ? { kind: "review", review: connectReview }
  : v === "mcp" ? { kind: "mcp", name: "Notion", serverUrl: "https://mcp.notion.com/mcp" }
  : v === "need_docs" ? { kind: "need_docs" }
  : { kind: "refused", problem: "bad_url" };
const relayView =v === "empty" ? { dojo: { available: true, on: false, host: "relay.dojocoding.io" } } : { own: { url: "https://relay.hugoprueba.example", host: "relay.hugoprueba.example" }, dojo: { available: true, on: true, host: "relay.dojocoding.io" } };

// --- Settings ------------------------------------------------------------------------------------------------------
const settings: Record<string, string> = { "onboarding.done": "1", "search.provider": "duckduckgo" };
if (v === "fresh") delete settings["onboarding.done"];

export const fakeHermit = {
  init: ok(undefined),
  startSession: ok("s1"),
  resumeSession: ok("s1"),
  transcript: ok({ entries: transcript, tainted: v !== "empty" }),
  clearConversation: ok("s2"),
  memories: {
    list: ok({ notes: v === "empty" ? [] : notes }),
    get: (id: number) => Promise.resolve(notes.find((n) => n.id === id) ?? notes[0]),
    delete: ok(true),
  },
  send,
  continueReply,
  messages: { conversations: ok(v === "empty" ? [] : conversations), recent: ok(v === "empty" ? [] : recent) },
  activity: ok(v === "empty" ? { rows: [], chain: { kind: "empty" } } : { rows: activityRows, chain }),
  activityEntry: ok(activityDetail),
  clearActivity: ok({ kind: "cleared", count: 48 }),
  vault,
  wallet,
  payments,
  profile,
  forms,
  web,
  mcp: {
    list: ok(mcpServers), begin: ok(mcpBegin), finishSignIn: ok({ kind: "refused" }), approve: ok({ ok: true }), cancel: ok(undefined),
    setTool: ok({ ok: true }), reapprove: ok({ ok: true }), remove: ok(true),
  },
  connect: {
    list: ok(installed), start: ok(connectStart), setSignIn: ok({ ok: true }), saveKey: ok({ ok: true }), testCall: ok({ ok: true }),
    install: ok({ ok: true }), cancel: ok(undefined), setOperation: ok({ ok: true }), remove: ok(true),
  },
  relay: {
    view: ok(relayView), saveOwn: ok({ ok: true }), removeOwn: ok(undefined), check: ok({ kind: "ok", providers: ["google", "microsoft"] }), setDojo: ok({ ok: true }),
    privacyHosts: ok({ relayHosts: ["relay.dojocoding.io"], ownRelayHosts: ["relay.hugoprueba.example"] }),
    // SL-48: the sign-in choices with the own client IDs (HM-CONN-05), from ./mail.
    ...fakeSignIn,
  },
  mailSend: fakeMailSend,
  approvalKey: {
    view: ok(v === "lost" ? { kind: "lost" } : v === "none" ? { kind: "not_set_up" } : { kind: "ready", level: "strongbox" }),
    enroll: ok({ ok: false, reason: "cancelled" }),
  },
  settings: {
    get: (k: string) => Promise.resolve(settings[k]),
    set: (k: string, val: string) => ((settings[k] = val), Promise.resolve()),
  },
  reminders: { upcoming: ok(reminders), cancel: ok("cancelled") },
  calendars: { choice: ok(calendarChoice), choose: ok(undefined) },
  hosts: {
    record: ok(undefined),
    list: ok([
      { host: "huggingface.co", count: 1, lastAt: now - 20 * day },
      { host: "html.duckduckgo.com", count: 14, lastAt: now - 5 * min },
      { host: "www.farmaciasahumada.cl", count: 9, lastAt: now - 3 * min },
      { host: "rpc.testnet.example-evm.org", count: 31, lastAt: now - 2 * hour },
      { host: "relay.dojocoding.io", count: 2, lastAt: now - 1 * day },
    ]),
  },
  lastTurn: ok({ profile: "botpsy-1.7b-q4", firstActionMs: 1840, totalMs: 6420 }),
  page: (id: string) => (id === "p1" ? page : undefined),
  night: {
    settings: ok(v === "off" ? { ...nightSettings, enabled: false } : nightSettings),
    saveSettings: ok([]),
    run: ok(undefined),
    briefing: ok(v === "empty" ? undefined : briefing),
    act: ok({ kind: "denied" }),
  },
};
