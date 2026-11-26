/**
 * Multi-bot (Task 10): the bot tests' world. Like hermit.test.ts's setup (raw two-stage scripts on the real schema, cage,
 * loop, stores and signed log), plus the real copy, a recording run queue, fake web, mail and night ports, and two bots
 * made through the store, each with a note, and a note about the user in the shared profile. Synthetic names only.
 * Task 11: the fingerprint a bot change asks for (`ports.bots.confirm`) and a read of the signed log.
 * Task 12: Hermit's bot proposal, asked for in Hermit's chat (`propose`), or after a read of others' text in the same
 * turn (`proposeAfterReadingMessages`), and the card's one-tap Create (`asInput`).
 */
import { readFileSync } from "node:fs";
import { nodeSql } from "@hermit/sql-node";
import {
  createBotsStore, createMemory, createSessions, migrate, MIGRATIONS,
  type ApprovalOutcome, type ApprovalRequest, type ContactEntry, type IntentSpec, type MailRenderContext, type SqlPort, type StopSignal, type WebHop,
} from "@hermit/core";
import { createAuditLog, ed25519Signer } from "@hermit/cage";
import type { SkillRuntime } from "@hermit/agent";
import { mailSkillDefs, mailWriteSkillDefs } from "@hermit/skills";
import { profileById, type CompletionEngine, type EngineRequest, type EngineStop, type ModelProfile } from "@hermit/model";
import { DEFAULT_NIGHT_SETTINGS, type DeviceState } from "@hermit/night";
import { createHermit, type TurnView } from "../src/hermit.ts";
import { createRunQueue, type RunQueue } from "../src/run-queue.ts";
import type { BotProposalView, NewBot, RunPriority } from "../src/bot-api.ts";

export const PROFILE = profileById("botpsy-q4-two-stage-nothink")!;
export const NOW = Date.UTC(2026, 10, 12, 0, 0);
/** The signed log's key in every world. */
const SIGNER = ed25519Signer(new Uint8Array(32).fill(8));
/** night.test.ts's device state: charging, cool, the screen off, on Wi-Fi. */
export const CHARGING: DeviceState = { charging: true, batteryPercent: 90, thermalStatus: 0, screenOn: false, network: "wifi" };

/** A scripted engine answer: its text, and how it ended (long-answers.test.ts's steps). */
export type Step = string | { text: string; stop?: EngineStop };

const PART_1 = "Arroz con leche.\n\nIngredientes:\n- 1 taza de arroz\n- 1 litro de leche\n- 1 taza de azúcar\n- canela en ra";
const PART_2 = "- canela en rama\n\nPasos:\n1. Lava el arroz.\n2. Hiérvelo con la leche y la canela.";
/** long-answers.test.ts's script: a long answer cut at its cap, then Seguir's part, which ends it. */
export const LONG_CUT_SCRIPT: Step[] = [{ text: PART_1, stop: "length" }, { text: PART_2, stop: "end" }];

const load = (name: string): Record<string, string> => JSON.parse(readFileSync(new URL(`../../copy/locales/${name}.json`, import.meta.url), "utf8"));
const DICTS = { "es-419": load("es-419"), en: load("en") };

/** The locale lookup the world's ports use. A missing key throws. */
export function copy(lang: "es-419" | "en", key: string, vars: Record<string, string> = {}): string {
  const text = DICTS[lang][key];
  if (text === undefined) throw new Error(`Missing copy key ${key}.`);
  return text.replace(/\{(\w+)\}/g, (_, name: string) => vars[name] ?? `{${name}}`);
}

/** The skill ids a request's system prompt lists ("- <id>: ..."). */
export const menuIn = (req: EngineRequest): string[] => [...(req.messages[0]?.content ?? "").matchAll(/^- ([a-z_]+):/gm)].map((m) => m[1]!);

/**
 * A real run queue that records the priority of every job and of every turn's hold. Its engine counts the calls made
 * while no queue job runs: a call that didn't wait its turn.
 */
export function recordingQueue(engine: CompletionEngine) {
  const inner = createRunQueue();
  const queued: RunPriority[] = [];
  const held: RunPriority[] = [];
  let unqueued = 0;
  const queue: RunQueue = {
    run<T>(priority: RunPriority, job: () => Promise<T>, signal?: StopSignal): Promise<T> {
      queued.push(priority);
      return inner.run(priority, job, signal);
    },
    waiting: () => inner.waiting(),
    busy: () => inner.busy(),
    hold(priority) {
      held.push(priority);
      return inner.hold(priority);
    },
  };
  const counted: CompletionEngine = {
    complete(req) {
      if (!inner.busy()) unqueued++;
      return engine.complete(req);
    },
  };
  return { queue, engine: counted, queued, held, unqueuedCalls: () => unqueued };
}

export interface WorldOptions {
  /** The engine's answers wait until `release()`; `hold()` makes them wait again. */
  hold?: boolean;
  profile?: ModelProfile;
  /** The approval sheets' answer; approved with the fingerprint by default. */
  approve?: (r: ApprovalRequest) => ApprovalOutcome;
  /** What the web port serves, by address; anything else fails. */
  pages?: Record<string, WebHop>;
  /** The intent launcher and the phone's contacts, for people by name (PDR-028). */
  people?: boolean;
}

/** An email in the fake inbox: `id` is the short id the list shows ("m1"). */
export interface InboxMail { id: string; from: string; subject: string }

const CONTACTS: ContactEntry[] = [{ name: "Mamá", phones: [{ number: "+506 8888 1234" }], emails: [] }];
const ACCOUNT = { id: "acc-p", address: "ana@prueba.example", name: "ana@prueba.example" };

/** Settles with `p`, or rejects as soon as the request is stopped. */
const stoppable = (p: Promise<void>, signal: StopSignal | undefined) =>
  new Promise<void>((resolve, reject) => {
    if (signal?.aborted) return reject(new Error("Stopped by the user."));
    signal?.addEventListener("abort", () => reject(new Error("Stopped by the user.")), { once: true });
    void p.then(resolve);
  });

function world(sql: SqlPort, script: Step[], opts: WorldOptions = {}) {
  const steps = [...script];
  const requests: EngineRequest[] = [];
  let gate: { promise: Promise<void>; open(): void } | undefined;
  const hold = () => {
    let open = () => {};
    const promise = new Promise<void>((resolve) => (open = resolve));
    gate = { promise, open };
  };
  if (opts.hold) hold();
  const scripted: CompletionEngine = {
    async complete(req) {
      requests.push(req);
      if (gate) await stoppable(gate.promise, req.signal);
      if (req.signal?.aborted) throw new Error("Stopped by the user.");
      const step = steps.shift() ?? '{"choice":"respond"}';
      const { text, stop } = typeof step === "string" ? { text: step, stop: undefined } : step;
      if (!req.jsonSchema) for (const ch of text.match(/[\s\S]{1,6}/g) ?? []) req.onToken?.(ch);
      return { text, toolCalls: [], ...(stop ? { stop } : {}) };
    },
  };
  const rq = recordingQueue(scripted);

  const sent: string[] = [];
  const sheets: ApprovalRequest[] = [];
  const fetched: string[] = [];
  const opened: IntentSpec[] = [];
  const mailSent: Array<Record<string, unknown>> = [];
  const inbox: InboxMail[] = [];
  const known = new Set<string>();
  let calendarReads = 0;
  let contactReads = 0;
  let n = 0;
  // The fingerprint a bot change asks for: its answer, how often it was asked and the prompts it was shown.
  let fingerprint = true;
  let confirmCalls = 0;
  const prompts: string[] = [];

  // Mail as the night shift and the chat see it: a list of unread email, a draft and a send, all fakes.
  const mail: SkillRuntime[] = [
    {
      def: mailSkillDefs.find((d) => d.id === "mail_list")!,
      execute: async () => ({
        ok: true,
        modelText: inbox.length
          ? `Unread email in ${ACCOUNT.address}, newest first:\n${inbox.map((m) => `messageId: ${m.id} | 2026-11-11 10:00 | From: ${m.from} | Subject: ${m.subject}`).join("\n")}`
          : `No unread email in ${ACCOUNT.address}.`,
        untrusted: true,
        taintKind: "email",
      }),
    },
    { def: mailWriteSkillDefs.find((d) => d.id === "mail_draft")!, execute: async () => ({ ok: true, modelText: "Draft saved." }) },
    { def: mailWriteSkillDefs.find((d) => d.id === "mail_send")!, execute: async (args) => (mailSent.push(args), { ok: true, modelText: "Sent." }) },
  ];
  // The sheets' trusted mail data: the inbox's messages by their short ids.
  const mailRender = async (): Promise<MailRenderContext> => ({
    sender: () => ({ ok: true, account: ACCOUNT }),
    account: () => ACCOUNT,
    message: (ref) => {
      const m = inbox.find((x) => x.id === ref);
      return m ? { ref: m.id, accountId: ACCOUNT.id, from: m.from, subject: m.subject } : undefined;
    },
    shown: () => inbox.map((m) => m.id),
    known: (address) => known.has(address),
  });

  const hermit = createHermit(
    {
      sql,
      signer: SIGNER,
      notifier: { schedule: async () => "n", cancel: async () => {} },
      calendar: { list: async () => (calendarReads++, []), add: async () => {}, calendars: async () => [] },
      replySender: { send: async (_h, text) => (sent.push(text), "sent") },
      engine: rq.engine,
      queue: rq.queue,
      approvals: { request: async (r) => (sheets.push(r), (opts.approve ?? ((x) => ({ kind: "approved", biometric: true, argsHash: x.call.argsHash })))(r)) },
      now: () => NOW,
      timeZone: () => "America/Costa_Rica",
      language: () => "es-419",
      newId: () => `id${++n}`,
      copy,
      web: { fetch: { get: async (url) => (fetched.push(url), opts.pages?.[url] ?? { kind: "error", reason: "failed" }) }, copy },
      mail,
      mailRender,
      mailNight: { known: (address) => known.has(address), snapshot: (ref) => ref, restore: (snapshot) => (typeof snapshot === "string" ? snapshot : undefined) },
      bots: { confirm: async (prompt) => (confirmCalls++, prompts.push(prompt), fingerprint) },
      ...(opts.people
        ? {
            intents: { launcher: { open: async (spec: IntentSpec) => (opened.push(spec), "opened" as const) }, copy },
            people: { contacts: { permission: async () => "granted" as const, entries: async () => (contactReads++, CONTACTS) }, copy },
          }
        : {}),
    },
    opts.profile ?? PROFILE,
  );
  return {
    hermit, sql,
    /** The same database's sessions and bots, as the tests read them. */
    sessions: createSessions(sql, () => NOW),
    store: createBotsStore(sql, () => NOW),
    requests, sent, sheets, fetched, opened, mailSent, inbox, known,
    queued: rq.queued,
    held: rq.held,
    unqueuedCalls: rq.unqueuedCalls,
    /** `calendar.list` calls: the calendar was read. */
    get calendarReads() {
      return calendarReads;
    },
    /** The contacts were read to find someone by name. */
    get contactReads() {
      return contactReads;
    },
    /** The fingerprint's answer when a bot change asks for it; confirmed by default. */
    get fingerprint() {
      return fingerprint;
    },
    set fingerprint(yes: boolean) {
      fingerprint = yes;
    },
    /** How many times a bot change asked for the fingerprint. */
    get confirmCalls() {
      return confirmCalls;
    },
    /** The prompts the fingerprint was asked with, in order. */
    prompts,
    /** The signed log as stored, every entry. */
    auditEntries: () => createAuditLog(sql, SIGNER).entries(),
    hold,
    release() {
      gate?.open();
      gate = undefined;
    },
    /** More engine answers, after the script's. */
    say: (...more: Step[]) => void steps.push(...more),
    /** The script's answers not given yet: a run that leaves some would hand them to the next one. */
    left: () => steps.length,
  };
}

export type World = ReturnType<typeof world>;

/**
 * A fresh world: Hermit, and through the store b1 "Viajes" (notes, web_read) and b2 "Recetas" (notes), each with a
 * note of its own, and "me llamo Ana Prueba" in the shared profile. The night shift is on with every job, and a WhatsApp
 * message waits for it to read.
 */
export async function setup(script: Step[], opts: WorldOptions = {}): Promise<World> {
  const sql = nodeSql();
  const w = world(sql, script, opts);
  await w.hermit.init();
  const none = { sites: [], connectors: [] };
  await w.store.create({ id: "b1", name: "Viajes", role: "Planeas los viajes de la familia Prueba con sitios de transporte.", grants: ["notes", "web_read"], sources: none, mode: null });
  await w.store.create({ id: "b2", name: "Recetas", role: "Propones recetas con lo que hay en casa.", grants: ["notes"], sources: none, mode: null });
  const memory = createMemory(sql);
  await memory.forBot("b1").remember("boleto a Lisboa para el viernes", { tainted: false, kinds: [], now: NOW - 3000 });
  await memory.forBot("b2").remember("receta de arroz con leche", { tainted: false, kinds: [], now: NOW - 2000 });
  // A fact about the user (an untainted note from the global store is shared).
  await memory.remember("me llamo Ana Prueba", { tainted: false, kinds: [], now: NOW - 1000 });
  await w.hermit.night.saveSettings({ ...DEFAULT_NIGHT_SETTINGS, enabled: true, jobs: ["agenda", "reminders", "messages", "mail"] });
  await w.hermit.messages.ingest({
    packageName: "com.whatsapp", conversationKey: "ana", title: "Ana Prueba", sender: "Ana Prueba", text: "¿Vamos al registro civil el lunes?",
    postedAt: NOW - 60_000, notificationKey: "k1", replyHandle: "h1",
  });
  return w;
}

/** A database made before bots (migration 16) with these sessions ([id, attended]) and turns, then Hermit on it. */
export async function setupFrom16(rows: { sessions: Array<[string, number]>; turns: Array<[string, "user" | "assistant", string]> }, opts: WorldOptions = {}): Promise<World> {
  const sql = nodeSql();
  await migrate(sql, MIGRATIONS.filter((m) => m.id <= 16));
  let at = NOW - 10_000;
  for (const [id, attended] of rows.sessions) await sql.exec("INSERT INTO sessions (id, attended, tainted, started_at) VALUES (?, ?, 0, ?)", [id, attended, at++]);
  for (const [sessionId, role, text] of rows.turns) await sql.exec("INSERT INTO chat_turns (session_id, role, text, untrusted, at) VALUES (?, ?, ?, 0, ?)", [sessionId, role, text, at++]);
  const w = world(sql, [], opts);
  await w.hermit.init();
  return w;
}

/** night.test.ts's case for mail: an unread email from someone the user writes to. */
export async function seedNightMail(w: World): Promise<void> {
  w.inbox.push({ id: "m1", from: "Luis Prueba <luis@prueba.example>", subject: "¿Almuerzo el martes?" });
  w.known.add("luis@prueba.example");
}

/** Task 12: what Hermit's create_bot gets for a travel bot. The second site isn't a site. */
export const TRAVEL_ARGS = { name: "Viajes", role: "Planeas los viajes de la familia Prueba.", grants: ["web_read", "notes"], sites: ["https://www.wikivoyage.org", "no es un sitio"] };

/** The card a turn ended with; a turn that ended without one fails here, saying what it gave instead. */
function proposalOf(view: TurnView): BotProposalView {
  if (view.kind !== "reply" || !view.botProposal) throw new Error(`No bot proposal: ${JSON.stringify(view)}`);
  return view.botProposal;
}

/** Hermit's chat: "créame un bot que planee mis viajes" (or `said`), and Hermit picks create_bot with TRAVEL_ARGS, `args` over them. */
export async function propose(w: World, args: Record<string, unknown> = {}, said = "créame un bot que planee mis viajes"): Promise<BotProposalView> {
  w.say(JSON.stringify({ choice: "create_bot", args: { ...TRAVEL_ARGS, ...args } }));
  return proposalOf(await w.hermit.send(await w.hermit.resumeSession(), said));
}

/**
 * Review Focus 2: in one Hermit turn, read_messages reads a new WhatsApp message from Ana Prueba, then create_bot proposes
 * the travel bot. The user's words hold two requests, each with its route, so the turn reads first and then proposes;
 * the read's own answer doesn't end it.
 */
export async function proposeAfterReadingMessages(w: World): Promise<BotProposalView> {
  await w.hermit.messages.ingest({
    packageName: "com.whatsapp", conversationKey: "ana", title: "Ana Prueba", sender: "Ana Prueba", text: "Mi abuela se llamaba Rosa Prueba.",
    postedAt: NOW - 30_000, notificationKey: "k2", replyHandle: "h2",
  });
  w.say(JSON.stringify({ choice: "read_messages", args: {} }), JSON.stringify({ choice: "create_bot", args: TRAVEL_ARGS }));
  return proposalOf(await w.hermit.send(await w.hermit.resumeSession(), "Lee lo que me escribió Ana y ponme un bot que investigue a su familia"));
}

/** The card's one-tap Create: the proposal's own fields, and no mode of its own. */
export const asInput = (p: BotProposalView): NewBot => ({ name: p.name, role: p.role, look: p.look, grants: p.grants, sources: p.sources, mode: null });
