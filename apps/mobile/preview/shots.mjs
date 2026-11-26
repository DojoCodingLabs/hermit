// Dev-only: every shot the gallery shows. `route` is the expo-router name; `variant` picks the sample data for one
// state (src/fake); `params` are the route params; `act` taps through to a state before the picture.
const both = ["light", "dark"];

/** Core screens: light and dark, es-419 and English. Every other screen: light and dark, es-419. */
const shot = (langs) => (s) => ({ themes: both, langs, ...s, file: s.file ?? s.route.replace(/\//g, "-") + (s.variant ? `-${s.variant}` : "") });
const core = shot(["es-419", "en"]);
const other = shot(["es-419"]);

const tap = (label) => async (page) => {
  await page.getByText(label, { exact: true }).first().click({ timeout: 5000 });
  await page.waitForTimeout(500);
};
const startTask = tap(/^(Empezar|Start)$/);
/** Q155: the request, in the language of the shot (params may be a function of the language). */
const recipeAsk = (lang) => ({ say: lang === "en" ? "Give me a recipe for rice pudding" : "Dame una receta de arroz con leche" });

export const shots = [
  // Core
  core({ id: "HM-CHAT-01", name: "Chat, a kept conversation", route: "index", mockup: "chat-conversation" }),
  core({ id: "HM-CHAT-01", name: "Chat, first run (empty)", route: "index", variant: "empty", mockup: "chat-empty" }),
  core({ id: "HM-CHAT-01", name: "Chat, Hermit working (live status and reasoning)", route: "index", variant: "working", params: { say: "¿Hasta qué hora abre la farmacia de Irarrázaval?" }, wait: 4200, mockup: "chat-working" }),
  core({ id: "HM-CHAT-01", name: "Chat, a payment the network confirmed (receipt card)", route: "index", variant: "paid", params: { say: "Mándale 20 dólares a Ana" }, wait: 1500 }),
  core({ id: "HM-CHAT-01", name: "Chat, a payment a cap refused (coral card, Q144)", route: "index", variant: "refused", params: { say: "Mándale 40 dólares a Ana" }, wait: 1500, mockup: "approval-blocked-inline" }),
  // Q155: long answers when asked, and never cut silently. The user's words in the shot's own language.
  core({ id: "HM-CHAT-01", name: "Chat, a long answer when asked (a recipe, drawn as structure)", route: "index", variant: "long", params: recipeAsk, wait: 1800 }),
  core({ id: "HM-CHAT-01", name: "Chat, a long answer still streaming (Stop in the composer)", route: "index", variant: "long-streaming", params: recipeAsk, wait: 1800 }),
  core({ id: "HM-CHAT-01", name: "Chat, a reply cut at its cap (the cut line and Seguir)", route: "index", variant: "cut", params: recipeAsk, wait: 1800 }),
  core({ id: "HM-CHAT-01", name: "Chat, Seguir writing the next part into the same bubble", route: "index", variant: "continuing", params: recipeAsk, wait: 1800, act: tap(/^(Seguir|Continue)$/) }),
  core({ id: "HM-CHAT-01", name: "Chat, Seguir found nothing new (the reply is whole, and says so)", route: "index", variant: "nothing-more", params: recipeAsk, wait: 1800, act: tap(/^(Seguir|Continue)$/) }),
  core({ id: "HM-CHAT-01", name: "Chat, a reply the user stopped (its words kept, Seguir)", route: "index", variant: "stopped", params: recipeAsk, wait: 1800 }),
  core({ id: "HM-APPR-02", name: "Approval sheet, a payment", route: "index", variant: "pay", note: "The sheet is a Modal mounted by the chat; on the phone it opens over whatever screen is on top.", mockup: "approval-pay" }),
  other({ id: "HM-APPR-02", name: "Approval sheet, a payment, details open", route: "index", variant: "pay", file: "index-pay-details", act: tap(/^(Ver detalles|Show details)$/), mockup: "approval-pay-details" }),
  other({ id: "HM-APPR-02", name: "Approval sheet, a payment to a typed address (shown whole)", route: "index", variant: "pay-typed" }),
  core({ id: "HM-APPR-02", name: "Approval sheet, a site's x402 price (pay_merchant)", route: "index", variant: "merchant" }),
  core({ id: "HM-APPR-01", name: "Approval sheet, a password (web task sign-in)", route: "index", variant: "credential", note: "The sign-in step of a web task (FILL_LOGIN): the recipe's name, the site and the vault login.", mockup: "approval-credential" }),
  core({ id: "HM-ONB-01", name: "Welcome", route: "welcome", mockup: "onb-welcome" }),
  core({ id: "HM-PAY-01", name: "Wallet", route: "wallet", mockup: "wallet-home" }),
  core({ id: "HM-PAY-03", name: "Wallet transactions", route: "wallet-history", mockup: "wallet-history" }),
  core({ id: "HM-PAY-05", name: "Spending caps and payees", route: "wallet-caps", mockup: "wallet-caps" }),
  core({ id: "HM-WEB-02", name: "Web tasks, saved list", route: "browser" }),
  core({ id: "HM-WEB-02", name: "Web task, the plan", route: "browser", variant: "plan", params: { recipe: "farmacia" }, mockup: "web-plan" }),
  core({ id: "HM-WEB-02", name: "Web task, running", route: "browser", variant: "running", params: { recipe: "farmacia" }, act: startTask }),
  core({ id: "HM-SET-01", name: "Settings", route: "settings", mockup: "settings-root" }),
  core({ id: "HM-SET-09", name: "What Hermit can use (Q147)", route: "use", mockup: "settings-use" }),
  core({ id: "HM-VAULT-01", name: "Vault, unlocked", route: "vault" }),
  core({ id: "HM-SET-02", name: "Privacy", route: "privacy", mockup: "settings-privacy" }),

  // 200% text (Android's largest font size), light, es-419: the hero screens still read, wrap and scroll.
  ...[
    { id: "HM-CHAT-01", name: "Chat at 200% text", route: "index", file: "index-x2" },
    { id: "HM-CHAT-01", name: "Chat, first run, at 200% text", route: "index", variant: "empty", file: "index-empty-x2" },
    { id: "HM-CHAT-01", name: "Chat, a long answer, at 200% text", route: "index", variant: "long", params: recipeAsk, wait: 1800, file: "index-long-x2" },
    { id: "HM-CHAT-01", name: "Chat, a reply cut at its cap, at 200% text", route: "index", variant: "cut", params: recipeAsk, wait: 1800, file: "index-cut-x2" },
    { id: "HM-APPR-02", name: "Approval sheet, a payment, at 200% text", route: "index", variant: "pay", file: "index-pay-x2" },
    { id: "HM-PAY-01", name: "Wallet at 200% text", route: "wallet", file: "wallet-x2" },
    { id: "HM-ONB-01", name: "Welcome at 200% text", route: "welcome", file: "welcome-x2" },
    // One per screen family of the polish round's second phase: a list, settings, a detail, a sheet, an empty state.
    { id: "HM-ACT-01", name: "Activity at 200% text", route: "activity", file: "activity-x2" },
    { id: "HM-SET-01", name: "Settings at 200% text", route: "settings", file: "settings-x2" },
    { id: "HM-ACT-02", name: "Activity entry at 200% text", route: "activity-entry", params: { seq: "41" }, file: "activity-entry-x2" },
    { id: "HM-APPR-01", name: "Approval sheet, a password, at 200% text", route: "index", variant: "credential", file: "index-credential-x2" },
    { id: "HM-MEM-01", name: "Memories, nothing saved yet, at 200% text", route: "memories", variant: "empty", file: "memories-empty-x2" },
  ].map((x) => ({ ...other({ ...x, fontScale: 2 }), themes: ["light"] })),

  // Chat and approvals, more states
  other({ id: "HM-CHAT-01", name: "Chat, a reply from a web page", route: "index", variant: "reply", params: { say: "¿Hasta qué hora abre la farmacia de Irarrázaval?" }, wait: 2200, mockup: "chat-web-reply" }),
  // The sheets family of the polish round's second phase: an info sheet, and a sheet's own info.
  other({ id: "HM-PAY-01", name: "Wallet, about this wallet (an info sheet)", route: "wallet", variant: "info", act: async (page) => { await page.getByLabel(/^(Sobre esta billetera|About this wallet)$/).first().click({ timeout: 5000 }); await page.waitForTimeout(700); } }),
  other({ id: "HM-APPR-01", name: "Approval sheet, a password, how it works", route: "index", variant: "credential", file: "index-credential-info", act: async (page) => { await page.waitForTimeout(600); await page.getByLabel(/^(Cómo funciona esta aprobación|How this approval works)$/).first().click({ timeout: 5000 }); await page.waitForTimeout(700); } }),
  other({ id: "HM-CHAT-01", name: "Chat, the menu", route: "index", variant: "menu", act: async (page) => { await page.getByLabel(/^(Abrir el menú|Open the menu)$/).first().click({ timeout: 5000 }); await page.waitForTimeout(500); } }),
  other({ id: "HM-APPR-01", name: "Approval sheet, a web search", route: "index", variant: "search" }),
  other({ id: "HM-APPR-01", name: "Approval sheet, a reply after reading messages (tainted)", route: "index", variant: "message", mockup: "approval-message" }),
  other({ id: "HM-CHAT-02", name: "Where Hermit runs", route: "where" }),
  other({ id: "HM-APPR-01", name: "Approval key", route: "approval-key" }),
  other({ id: "HM-APPR-01", name: "Approval key, not set up", route: "approval-key", variant: "none" }),
  other({ id: "HM-APPR-01", name: "Approval key, retired after a fingerprint change", route: "approval-key", variant: "lost" }),

  // Onboarding
  other({ id: "HM-ONB-02", name: "Language", route: "language", mockup: "onb-language" }),
  other({ id: "HM-ONB-03", name: "Model download", route: "download", variant: "fresh", mockup: "onb-download" }),
  other({ id: "HM-ONB-04", name: "Permissions", route: "permissions", mockup: "onb-permissions" }),
  other({ id: "HM-ONB-05", name: "Phone not supported", route: "unsupported", variant: "below" }),

  // Web
  other({ id: "HM-WEB-01", name: "Page reader", route: "web", params: { id: "p1" } }),
  other({ id: "HM-WEB-02", name: "Web task, paused to pay yourself", route: "browser", variant: "paused", params: { recipe: "farmacia" }, act: startTask }),
  other({ id: "HM-WEB-02", name: "Web task, done", route: "browser", variant: "done", params: { recipe: "farmacia" }, act: startTask, mockup: "web-done" }),
  other({ id: "HM-WEB-02", name: "Web task, record a new one", route: "browser", variant: "record", params: { record: "1" } }),
  other({ id: "HM-WEB-02", name: "Web tasks, none saved", route: "browser", variant: "empty" }),

  // Vault and forms
  other({ id: "HM-VAULT-01", name: "Vault, locked", route: "vault", variant: "vault_locked" }),
  other({ id: "HM-VAULT-01", name: "Vault, none yet", route: "vault", variant: "none" }),
  other({ id: "HM-VAULT-01", name: "Vault, key lost after a fingerprint change", route: "vault", variant: "lost" }),
  other({ id: "HM-VAULT-01", name: "Vault, no logins yet", route: "vault", variant: "empty" }),
  other({ id: "HM-VAULT-02", name: "Vault item", route: "vault-item", params: { id: "v4" } }),
  other({ id: "HM-VAULT-02", name: "Vault item, shown for 30 s", route: "vault-item", variant: "shown", params: { id: "v4" }, act: tap(/^(Mostrar con huella|Show with fingerprint)$/) }),
  other({ id: "HM-VAULT-02", name: "Vault item, add a login", route: "vault-item", variant: "add" }),
  other({ id: "HM-VAULT-03", name: "Import passwords", route: "vault-import" }),
  other({ id: "HM-VAULT-03", name: "Import passwords, the preview", route: "vault-import", variant: "preview", act: tap(/^(Elegir un archivo CSV|Choose a CSV file)$/) }),
  other({ id: "HM-VAULT-03", name: "Import passwords, done", route: "vault-import", variant: "done", act: async (page) => { await tap(/^(Elegir un archivo CSV|Choose a CSV file)$/)(page); await tap(/^(Importar \d+ con huella|Import \d+ with fingerprint)$/)(page); } }),
  other({ id: "HM-FORM-02", name: "Personal profile", route: "profile" }),
  other({ id: "HM-FORM-01", name: "Fill preview", route: "fill", params: { request: "r1" } }),
  other({ id: "HM-FORM-01", name: "Fill, a login (HM-APPR-01)", route: "fill", variant: "login", params: { request: "r1" } }),

  // Wallet, more
  other({ id: "HM-PAY-01", name: "Wallet, none yet", route: "wallet", variant: "none" }),
  other({ id: "HM-PAY-01", name: "Wallet, needs backup", route: "wallet", variant: "needs_backup" }),
  other({ id: "HM-PAY-02", name: "Recovery words", route: "wallet-words", params: { mode: "backup" } }),
  other({ id: "HM-PAY-02", name: "Recovery words, shown", route: "wallet-words", variant: "shown", params: { mode: "backup" }, act: tap("Mostrar las palabras") }),
  other({ id: "HM-PAY-02", name: "Recovery words, the check", route: "wallet-words", variant: "check", params: { mode: "backup" }, act: async (page) => { await tap("Mostrar las palabras")(page); await tap("Ya las anoté")(page); } }),
  other({ id: "HM-PAY-02", name: "Recovery words, restore a wallet", route: "wallet-words", variant: "restore", params: { mode: "restore" } }),
  other({ id: "HM-PAY-04", name: "Receive", route: "wallet-receive", mockup: "wallet-receive" }),

  // Settings
  other({ id: "HM-SET-01", name: "App lock screen", route: "settings", variant: "locked" }),
  other({ id: "HM-SET-03", name: "Delete everything, the wallet still holds money", route: "delete" }),
  other({ id: "HM-SET-03", name: "Delete everything, type the word", route: "delete", variant: "confirm", act: tap(/^(Entiendo, continuar|I understand, continue)$/) }),
  other({ id: "HM-SET-06", name: "Appearance", route: "appearance" }),
  other({ id: "HM-SET-08", name: "About", route: "about" }),

  // Activity, messages, memory, reminders, calendar
  other({ id: "HM-ACT-01", name: "Activity", route: "activity", mockup: "settings-activity" }),
  other({ id: "HM-ACT-03", name: "Activity, chain broken", route: "activity", variant: "broken", mockup: "settings-activity-broken" }),
  other({ id: "HM-ACT-02", name: "Activity entry", route: "activity-entry", params: { seq: "41" } }),
  other({ id: "HM-MSG-01", name: "Messages", route: "messages" }),
  other({ id: "HM-MEM-01", name: "Memories", route: "memories" }),
  other({ id: "HM-MEM-02", name: "One memory", route: "memory", params: { id: "6" } }),
  other({ id: "HM-MEM-01", name: "Memories, nothing saved yet", route: "memories", variant: "empty" }),
  other({ id: "HM-MEM-02", name: "One memory, saved by you", route: "memory", variant: "own", params: { id: "8" } }),
  other({ id: "HM-MSG-01", name: "Messages, none yet", route: "messages", variant: "empty" }),
  other({ id: "HM-MSG-01", name: "Messages, no notification access", route: "messages", variant: "forbidden" }),
  other({ id: "HM-REM-01", name: "Reminders", route: "reminders" }),
  other({ id: "HM-REM-01", name: "Reminders, none yet", route: "reminders", variant: "empty" }),
  other({ id: "HM-CAL-02", name: "Calendar choice", route: "calendar" }),
  other({ id: "HM-CAL-02", name: "Calendar choice, the chosen one is gone", route: "calendar", variant: "gone" }),
  other({ id: "HM-CAL-02", name: "Calendar choice, no calendar access", route: "calendar", variant: "forbidden" }),

  // Night shift
  other({ id: "HM-NIGHT-01", name: "Night shift", route: "night" }),
  other({ id: "HM-NIGHT-01", name: "Night shift, off", route: "night", variant: "off" }),
  other({ id: "HM-NIGHT-02", name: "Morning briefing", route: "briefing" }),
  other({ id: "HM-NIGHT-02", name: "Morning briefing, none yet", route: "briefing", variant: "empty" }),

  // Connections
  other({ id: "HM-CONN-03", name: "MCP servers", route: "mcp" }),
  other({ id: "HM-CONN-03", name: "MCP sign-in coming back", route: "oauth/mcp", params: { code: "abc", state: "xyz" } }),
  other({ id: "HM-CONN-03", name: "MCP servers, none yet", route: "mcp", variant: "empty" }),
  other({ id: "HM-CONN-03", name: "MCP server, sign in on the service's page", route: "mcp", variant: "signin", params: { url: "https://mcp.linear.app/mcp" }, act: tap(/^(Revisar este servidor|Check this server)$/) }),
  other({ id: "HM-CONN-03", name: "MCP server, review its tools", route: "mcp", variant: "review", params: { url: "https://mcp.linear.app/mcp" }, act: tap(/^(Revisar este servidor|Check this server)$/) }),
  other({ id: "HM-CONN-04", name: "Connect a service", route: "connect" }),
  other({ id: "HM-CONN-04", name: "Connect a service, review a drafted connector", route: "connect", variant: "review", params: { request: "Bsale" }, act: tap(/^(Buscar cómo conectar|Find a way to connect)$/) }),
  other({ id: "HM-CONN-04", name: "Connect a service, it has its own MCP server", route: "connect", variant: "mcp", params: { request: "Notion" }, act: tap(/^(Buscar cómo conectar|Find a way to connect)$/) }),
  other({ id: "HM-CONN-04", name: "Connect a service, send me the docs", route: "connect", variant: "need_docs", params: { request: "Bsale" }, act: tap(/^(Buscar cómo conectar|Find a way to connect)$/) }),
  other({ id: "HM-CONN-05", name: "Sign-in options (relays)", route: "sign-in-options" }),
  other({ id: "HM-CONN-05", name: "Sign-in options, no relay yet", route: "sign-in-options", variant: "empty" }),

  // Email (SL-48, SL-49): every state of the HM-MAIL screens, the mail approval sheets, the chat's link, HM-CONN-05's own
  // client IDs, and email on Settings, What Hermit can use and Privacy. Every file name holds "mail": `node shoot.mjs mail`.
  core({ id: "HM-MAIL-01", name: "Email accounts", route: "mail" }),
  other({ id: "HM-MAIL-01", name: "Email accounts, none yet", route: "mail", variant: "empty" }),
  other({ id: "HM-MAIL-01", name: "Email accounts, one to sign in to again", route: "mail", variant: "signin" }),
  other({ id: "HM-MAIL-01", name: "Email accounts, no client ID yet (Gmail and Outlook disabled)", route: "mail", variant: "noclient" }),
  other({ id: "HM-MAIL-01", name: "Email accounts, just connected", route: "mail", variant: "connected" }),
  core({ id: "HM-MAIL-01", name: "Connect Gmail, the hand-off to the browser", route: "mail", variant: "handoff", act: tap(/^(Conectar Gmail|Connect Gmail)$/) }),
  other({ id: "HM-MAIL-01", name: "Connect Gmail, waiting for the browser", route: "mail", variant: "waiting" }),
  other({ id: "HM-MAIL-01", name: "Email accounts, couldn't load", route: "mail", variant: "error" }),
  core({ id: "HM-MAIL-01", name: "Other email (IMAP), the form", route: "mail", variant: "imapform", act: tap(/^(Otro correo \(IMAP\)|Other email \(IMAP\))$/) }),
  other({ id: "HM-MAIL-01", name: "Other email (IMAP), a refused app password (known servers filled in)", route: "mail", variant: "imapbad", act: async (page) => {
    await tap(/^(Otro correo \(IMAP\)|Other email \(IMAP\))$/)(page);
    const field = (label) => page.getByLabel(label).first();
    await field(/^(Dirección de correo|Email address)$/).fill("camila@fastmail.com");
    await field(/^(Dirección de correo|Email address)$/).blur();
    await field(/^(Contraseña de aplicación|App password)$/).fill("abcd efgh ijkl mnop");
    await page.waitForTimeout(300);
    await tap(/^(Conectar|Connect)$/)(page);
  } }),
  other({ id: "HM-MAIL-01", name: "Email accounts with an IMAP account", route: "mail", variant: "imap" }),
  other({ id: "HM-MAIL-01", name: "Email accounts, a build without IMAP", route: "mail", variant: "noimap" }),
  other({ id: "HM-MAIL-01", name: "Sign-in coming back (Google)", route: "oauth2redirect", file: "mail-oauth2redirect" }),
  core({ id: "HM-MAIL-02", name: "Messages in this summary", route: "mail-summary" }),
  other({ id: "HM-MAIL-02", name: "Messages in this summary, none", route: "mail-summary", variant: "empty" }),
  other({ id: "HM-MAIL-03", name: "Search results", route: "mail-search" }),
  other({ id: "HM-MAIL-03", name: "Search results, none", route: "mail-search", variant: "empty" }),
  core({ id: "HM-MAIL-03", name: "One email (message view)", route: "mail-message", params: { ref: "m2" } }),
  other({ id: "HM-MAIL-03", name: "One email, no longer at hand", route: "mail-message", variant: "gone", params: { ref: "m9" } }),
  other({ id: "HM-MAIL-03", name: "One email, couldn't open", route: "mail-message", variant: "error", params: { ref: "m2" } }),
  core({ id: "HM-MAIL-04", name: "Draft, written after reading email", route: "mail-draft" }),
  other({ id: "HM-MAIL-04", name: "Draft, edited on the phone", route: "mail-draft", variant: "edited" }),
  other({ id: "HM-MAIL-04", name: "Draft, an address that isn't one", route: "mail-draft", variant: "bad", act: tap(/^(Enviar|Send)$/) }),
  other({ id: "HM-MAIL-04", name: "Draft, sent", route: "mail-draft", variant: "sent", act: tap(/^(Enviar|Send)$/) }),
  other({ id: "HM-MAIL-04", name: "Draft, not sent (declined)", route: "mail-draft", variant: "declined", act: tap(/^(Enviar|Send)$/) }),
  other({ id: "HM-MAIL-04", name: "Draft, none yet", route: "mail-draft", variant: "empty" }),
  other({ id: "HM-APPR-01", name: "Approval sheet, read email", route: "index", variant: "mail-list", file: "index-mail-list" }),
  core({ id: "HM-APPR-01", name: "Approval sheet, send an email (a new recipient, after reading email)", route: "index", variant: "mail-send", file: "index-mail-send" }),
  other({ id: "HM-APPR-01", name: "Approval sheet, reply in the thread", route: "index", variant: "mail-reply", file: "index-mail-reply" }),
  other({ id: "HM-APPR-01", name: "Approval sheet, save a draft", route: "index", variant: "mail-draft", file: "index-mail-draft" }),
  other({ id: "HM-APPR-01", name: "Approval sheet, archive emails (the change named)", route: "index", variant: "mail-modify", file: "index-mail-modify" }),
  other({ id: "HM-CHAT-01", name: "Chat, an answer after reading email, linking the messages", route: "index", variant: "mail-chat", params: { say: "¿Tengo correos nuevos?" }, wait: 2200, file: "index-mail-chat" }),
  other({ id: "HM-CONN-05", name: "Sign-in options, your own Google client", route: "sign-in-options", variant: "own", file: "sign-in-options-mail-own" }),
  other({ id: "HM-CONN-05", name: "Sign-in options, no client ID yet", route: "sign-in-options", variant: "noclient", file: "sign-in-options-mail-noclient" }),
  other({ id: "HM-SET-01", name: "Settings, with Email accounts", route: "settings", file: "settings-mail" }),
  other({ id: "HM-SET-09", name: "What Hermit can use, with email", route: "use", file: "use-mail" }),
  other({ id: "HM-SET-02", name: "Privacy, with the email providers' hosts", route: "privacy", file: "privacy-mail" }),

  // Dev-only screens
  other({ id: "HM-DEV-01", name: "Autofill diagnostics (dev only)", route: "autofill-debug" }),
  other({ id: "HM-DEV-02", name: "Wallet worklet spike (dev only)", route: "wallet-debug" }),
  other({ id: "DEV", name: "On-phone model eval (dev only)", route: "eval" }),
];
