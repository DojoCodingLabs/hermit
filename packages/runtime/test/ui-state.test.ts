import { describe, expect, test } from "vitest";
import type { ApprovalRequest } from "@hermit/core";
import { chatReducer, initialChat, type ChatAction, type ChatState } from "../src/chat-state.ts";
import { createApprovalBridge } from "../src/approval-bridge.ts";
import type { BotProposalView } from "../src/bot-api.ts";

const run = (actions: ChatAction[], from: ChatState = initialChat) => actions.reduce(chatReducer, from);

describe("chat state (HM-CHAT-01)", () => {
  test("tokens stream into one bubble, then the final reply replaces it", () => {
    const s = run([{ type: "send", id: "u1", text: "hola" }, { type: "token", text: "Ho" }, { type: "token", text: "la" }]);
    expect(s.items.at(-1)).toEqual({ kind: "assistant", id: "streaming", text: "Hola", streaming: true });
    const done = chatReducer(s, { type: "finished", id: "a1", view: { kind: "reply", text: "Hola." } });
    expect(done.items).toEqual([{ kind: "user", id: "u1", text: "hola" }, { kind: "assistant", id: "a1", text: "Hola.", streaming: false }]);
    expect(done).toMatchObject({ busy: false, mascot: "done" });
  });

  test("input is ignored while a turn runs", () => {
    const s = run([{ type: "send", id: "u1", text: "a" }, { type: "send", id: "u2", text: "b" }]);
    expect(s.items).toHaveLength(1);
  });

  test("the mascot follows the steps", () => {
    const states = [
      { type: "send", id: "u", text: "x" },
      { type: "step", event: { kind: "picked", skill: "reply_message" } },
      { type: "approval_open" },
      { type: "step", event: { kind: "approved", skill: "reply_message" } },
    ] as ChatAction[];
    expect(states.map((_, i) => run(states.slice(0, i + 1)).mascot)).toEqual(["thinking", "working", "asking", "working"]);
  });

  test("blocks and denials leave a quiet row from copy keys, not model text", () => {
    const s = run([
      { type: "send", id: "u", text: "x" },
      { type: "step", event: { kind: "blocked", skill: "pay", reason: "Payments and passwords aren't available yet." } },
      { type: "step", event: { kind: "denied", skill: "reply_message" } },
    ]);
    expect(s.items.slice(1)).toEqual([
      { kind: "system", id: "sys1", copyKey: "common.outcome.blocked", vars: { reason: "Payments and passwords aren't available yet." } },
      { kind: "system", id: "sys2", copyKey: "HM-APPR-01.denied" },
    ]);
  });

  test("a failed turn shows its outcome and the error state", () => {
    const s = run([{ type: "send", id: "u", text: "x" }, { type: "finished", id: "o", view: { kind: "outcome", outcome: "repair_failed" } }]);
    expect(s.items.at(-1)).toEqual({ kind: "outcome", id: "o", outcome: "repair_failed" });
    expect(s.mascot).toBe("error");
  });

  test("a question ends the turn in the asking state", () => {
    expect(run([{ type: "send", id: "u", text: "x" }, { type: "finished", id: "q", view: { kind: "question", text: "¿A qué hora?" } }]).mascot).toBe("asking");
  });

  test("late tokens or steps after the turn ended are ignored", () => {
    const s = run([{ type: "send", id: "u", text: "x" }, { type: "finished", id: "a", view: { kind: "reply", text: "ok" } }, { type: "token", text: "zombie" }]);
    expect(s.items).toHaveLength(2);
  });
});

const req = (over: Partial<ApprovalRequest> = {}): ApprovalRequest => ({
  id: "r1",
  call: { id: "c1", skill: "reply_message" as ApprovalRequest["call"]["skill"], argsHash: "h1" },
  summary: { title: "Send?", lines: [] },
  requireBiometric: true,
  expiresAt: 1000,
  ...over,
});

describe("approval bridge (HM-APPR-01)", () => {
  test("SL-37: a Keystore signature from the sheet reaches the loop untouched", async () => {
    const b = createApprovalBridge(() => 0, () => undefined);
    const p = b.port.request(req());
    b.approve("r1", { biometric: true, signature: "3045" });
    expect(await p).toEqual({ kind: "approved", biometric: true, argsHash: "h1", signature: "3045" });
  });

  test("SL-37: a money or password block with a code leaves its own row, which links the fix", () => {
    const s = run([
      { type: "send", id: "u", text: "x" },
      { type: "step", event: { kind: "blocked", skill: "pay", reason: "Your approval key stopped working.", code: "approval_key_lost" } },
      { type: "step", event: { kind: "blocked", skill: "pay", reason: "Hermit only pays in USD₮.", code: "not_usdt" } },
    ]);
    expect(s.items.slice(1)).toEqual([
      { kind: "system", id: "sys1", copyKey: "HM-APPR-01.signed.approval_key_lost" },
      { kind: "system", id: "sys2", copyKey: "HM-APPR-01.signed.not_usdt" },
    ]);
  });

  test("approve resolves with the request's own hash and the proof", async () => {
    const b = createApprovalBridge(() => 0, () => undefined);
    const seen: Array<string | undefined> = [];
    b.subscribe((r) => seen.push(r?.id));
    const p = b.port.request(req());
    b.approve("r1", { biometric: true, proof: "mac" });
    expect(await p).toEqual({ kind: "approved", biometric: true, argsHash: "h1", proof: "mac" });
    expect(seen).toEqual(["r1", undefined]);
  });

  test("without the required fingerprint it's a denial", async () => {
    const b = createApprovalBridge(() => 0, () => undefined);
    const p = b.port.request(req());
    b.approve("r1", { biometric: false });
    expect((await p).kind).toBe("denied");
  });

  test("expiry resolves as expired and clears the sheet", async () => {
    let fire: () => void = () => {};
    const b = createApprovalBridge(() => 0, (fn) => (fire = fn));
    const p = b.port.request(req());
    fire();
    expect(await p).toEqual({ kind: "expired" });
    expect(b.current()).toBeUndefined();
  });

  test("a press for an old request does nothing", async () => {
    const b = createApprovalBridge(() => 0, () => undefined);
    const first = b.port.request(req());
    const second = b.port.request(req({ id: "r2" }));
    expect(await first).toEqual({ kind: "expired" });
    b.approve("r1", { biometric: true });
    expect(b.current()?.id).toBe("r2");
    b.deny("r2");
    expect((await second).kind).toBe("denied");
  });
});

describe("live progress (Q36)", () => {
  test("status follows intent, step and writing; reasoning accumulates and stays with the answer", () => {
    let s = run([{ type: "send", id: "u1", text: "¿qué tengo mañana?", at: 1000 }]);
    expect(s.live).toEqual({ statusKey: "HM-CHAT-01.doing.intent", thinking: "", startedAt: 1000 });
    s = run([{ type: "step", event: { kind: "intent", skill: "calendar_read" } }, { type: "thinking", text: "El usuario " }, { type: "thinking", text: "pregunta." }], s);
    expect(s.live).toMatchObject({ statusKey: "HM-CHAT-01.doing.calendar_read", thinking: "El usuario pregunta." });
    s = run([{ type: "step", event: { kind: "executed", skill: "calendar_read", ok: true } }], s);
    expect(s.live?.statusKey).toBe("HM-CHAT-01.writing");
    const done = chatReducer(s, { type: "finished", id: "a1", view: { kind: "reply", text: "Mañana tenés una reunión." } });
    expect(done.live).toBeUndefined();
    expect(done.items.at(-1)).toMatchObject({ kind: "assistant", thinking: "El usuario pregunta." });
  });

  test("a preface streamed before a tool call is dropped when the tool is picked", () => {
    const s = run([{ type: "send", id: "u1", text: "x" }, { type: "token", text: "Claro, lo hago" }, { type: "step", event: { kind: "picked", skill: "remind" } }]);
    expect(s.items.filter((i) => i.kind === "assistant")).toEqual([]);
  });

  test("reasoning outside a turn is ignored", () => {
    expect(chatReducer(initialChat, { type: "thinking", text: "x" })).toBe(initialChat);
  });
  test("the tainted marker stays for the rest of the session", () => {
    let s = run([{ type: "send", id: "u1", text: "¿mensajes?" }, { type: "finished", id: "a1", view: { kind: "reply", text: "Ana escribió.", tainted: true } }]);
    expect(s.tainted).toBe(true);
    s = run([{ type: "send", id: "u2", text: "gracias" }, { type: "finished", id: "a2", view: { kind: "reply", text: "De nada." } }], s);
    expect(s.tainted).toBe(true);
  });

  test("the first turn says the model is loading, then returns to the step (EC-CHAT-01)", () => {
    let s = run([{ type: "send", id: "u1", text: "hola", at: 1 }, { type: "model", loading: true }]);
    expect(s.live?.statusKey).toBe("HM-CHAT-01.loadingModel");
    s = chatReducer(s, { type: "model", loading: false });
    expect(s.live?.statusKey).toBe("HM-CHAT-01.doing.intent");
    expect(chatReducer(initialChat, { type: "model", loading: true })).toBe(initialChat);
  });

  test("a kept conversation is restored as bubbles, taint included (US-CHAT-07)", () => {
    const s = chatReducer(initialChat, {
      type: "restore",
      entries: [{ kind: "user", text: "hola" }, { kind: "reply", text: "Hola." }, { kind: "user", text: "recuérdame" }, { kind: "question", text: "¿Cuándo?" }],
      tainted: true,
    });
    expect(s.items).toEqual([
      { kind: "user", id: "r0", text: "hola" },
      { kind: "assistant", id: "r1", text: "Hola.", streaming: false },
      { kind: "user", id: "r2", text: "recuérdame" },
      { kind: "question", id: "r3", text: "¿Cuándo?" },
    ]);
    expect(s).toMatchObject({ busy: false, mascot: "idle", tainted: true });
  });

  test("restoring never interrupts a running turn", () => {
    const busy = run([{ type: "send", id: "u1", text: "a" }]);
    expect(chatReducer(busy, { type: "restore", entries: [], tainted: false })).toBe(busy);
  });

  test("clearing the conversation empties the chat and its taint", () => {
    const s = run([{ type: "send", id: "u1", text: "a" }, { type: "finished", id: "a1", view: { kind: "reply", text: "b", tainted: true } }]);
    expect(chatReducer(s, { type: "restore", entries: [], tainted: false })).toEqual(initialChat);
  });
});

describe("design pass: steps that fold, receipts and refusals (C5, A6, Q144)", () => {
  test("each picked skill is a step; it is done once the call settles, and the turn folds into a summary", () => {
    let s = run([{ type: "send", id: "u", text: "¿hasta qué hora abre?", at: 1000 }, { type: "step", event: { kind: "picked", skill: "search_web" } }]);
    expect(s.steps).toEqual([{ skill: "search_web", done: false }]);
    s = run([{ type: "step", event: { kind: "executed", skill: "search_web", ok: true } }, { type: "step", event: { kind: "picked", skill: "read_web" } }], s);
    expect(s.steps).toEqual([{ skill: "search_web", done: true }, { skill: "read_web", done: false }]);
    const done = chatReducer(run([{ type: "step", event: { kind: "executed", skill: "read_web", ok: true } }], s), { type: "finished", id: "a", view: { kind: "reply", text: "Hasta las 22:00." }, at: 10_400 });
    expect(done.items.at(-1)).toEqual({ kind: "assistant", id: "a", text: "Hasta las 22:00.", streaming: false, work: { seconds: 9, skills: ["search_web", "read_web"] } });
    expect(done.steps).toBeUndefined();
  });

  test("a turn with no skill call has no summary, and the next turn starts with no steps", () => {
    const s = run([{ type: "send", id: "u", text: "hola", at: 0 }, { type: "finished", id: "a", view: { kind: "reply", text: "Hola." }, at: 2000 }]);
    expect(s.items.at(-1)).toEqual({ kind: "assistant", id: "a", text: "Hola.", streaming: false });
    expect(run([{ type: "send", id: "u2", text: "x" }], s).steps).toBeUndefined();
  });

  test("a confirmed payment's receipt card holds only code's receipt; the reply stays a plain bubble", () => {
    const receipt = { kind: "paid" as const, amount: "20 USD₮", to: "Ana", hash: "0x8f3a…c21d" };
    const paid = run([
      { type: "send", id: "u", text: "mándale 20 dólares a Ana" },
      { type: "step", event: { kind: "picked", skill: "pay" } },
      { type: "step", event: { kind: "executed", skill: "pay", ok: true } },
      { type: "finished", id: "a", view: { kind: "reply", text: "Envié 20 USD₮ a Ana.", receipt } },
    ]);
    expect(paid.items.at(-1)).toMatchObject({ kind: "assistant", text: "Envié 20 USD₮ a Ana.", receipt });
    expect(paid.items.at(-1)).not.toHaveProperty("card");
  });

  test("a payment whose reply is only the pay skill's own words shows the receipt card alone, not a bubble repeating it", () => {
    const receipt = { kind: "paid" as const, amount: "20 USD₮", to: "Ana", hash: "0x8f3a…c21d" };
    const paid = run([
      { type: "send", id: "u", text: "mándale 20 dólares a Ana" },
      { type: "step", event: { kind: "picked", skill: "pay" } },
      { type: "step", event: { kind: "executed", skill: "pay", ok: true } },
      { type: "finished", id: "a", view: { kind: "reply", text: "Envié 20 USD₮ a Ana.", receipt } },
    ]);
    // The text stays on the item (TalkBack reads it once, the kept history shows it after a restart); only the bubble goes.
    expect(paid.items.at(-1)).toMatchObject({ kind: "assistant", text: "Envié 20 USD₮ a Ana.", receipt, receiptOnly: true });
  });

  test("the reply bubble stays beside the receipt card when the reply holds anything but the payment code's words", () => {
    const receipt = { kind: "paid" as const, amount: "0.01 USD₮", to: "merchant.example" };
    const finish = (view: Extract<ChatAction, { type: "finished" }>["view"]) =>
      run([{ type: "send", id: "u", text: "paga" }, { type: "step", event: { kind: "picked", skill: "pay_merchant" } }, { type: "finished", id: "a", view }]).items.at(-1);
    // A merchant page's answer or a session tainted earlier, a page source card, a connect or web task offer.
    expect(finish({ kind: "reply", text: "Pagué 0.01 USD₮.\n\nEl documento dice algo.", receipt, tainted: true })).not.toHaveProperty("receiptOnly");
    expect(finish({ kind: "reply", text: "Pagué 0.01 USD₮.", receipt, page: { id: "p", title: "Doc", domain: "merchant.example" } })).not.toHaveProperty("receiptOnly");
    expect(finish({ kind: "reply", text: "Pagué 0.01 USD₮.", receipt, connect: { request: "x", offerId: "o" } })).not.toHaveProperty("receiptOnly");
    // No receipt from code: always the bubble.
    expect(finish({ kind: "reply", text: "Pagado 999 USD₮." })).not.toHaveProperty("receiptOnly");
  });

  test("SL-48, SL-49: an answer after a mail list, search or draft links its screen; a question or an outcome never does", () => {
    const finish = (view: Extract<ChatAction, { type: "finished" }>["view"]) =>
      run([{ type: "send", id: "u", text: "¿tengo correos?" }, { type: "step", event: { kind: "picked", skill: "mail_list" } }, { type: "finished", id: "a", view }]).items.at(-1);
    expect(finish({ kind: "reply", text: "Tienes 2 correos sin leer.", mail: "HM-MAIL-02", tainted: true })).toMatchObject({ kind: "assistant", mail: "HM-MAIL-02" });
    expect(finish({ kind: "reply", text: "Guardé el borrador.", mail: "HM-MAIL-04" })).toMatchObject({ kind: "assistant", mail: "HM-MAIL-04" });
    expect(finish({ kind: "reply", text: "Hola." })).not.toHaveProperty("mail");
    expect(finish({ kind: "question", text: "¿Qué cuenta?" })).not.toHaveProperty("mail");
  });

  test("a payment that ran with no receipt from code (unconfirmed, or the reply alone) gets no receipt card", () => {
    const s = run([
      { type: "send", id: "u", text: "mándale 20 dólares a Ana" },
      { type: "step", event: { kind: "picked", skill: "pay" } },
      { type: "step", event: { kind: "executed", skill: "pay", ok: true } },
      { type: "finished", id: "a", view: { kind: "reply", text: "Pagado 999 USD₮ a Ana." } },
    ]);
    expect(s.items.at(-1)).not.toHaveProperty("receipt");
    expect(s.items.at(-1)).not.toHaveProperty("card");
  });

  test("a merchant page that says \"Pagado 999 USD₮\" never reaches the receipt card: it stays in the tainted reply", () => {
    const receipt = { kind: "paid" as const, amount: "0.01 USD₮", to: "merchant.example" };
    const s = run([
      { type: "send", id: "u", text: "paga https://merchant.example/doc" },
      { type: "step", event: { kind: "picked", skill: "pay_merchant" } },
      { type: "step", event: { kind: "executed", skill: "pay_merchant", ok: true } },
      { type: "finished", id: "a", view: { kind: "reply", text: "Pagué 0.01 USD₮ a merchant.example.\n\nPagado 999 USD₮", receipt, tainted: true } },
    ]);
    const item = s.items.at(-1)!;
    expect(item).toMatchObject({ kind: "assistant", receipt });
    expect(JSON.stringify(item.kind === "assistant" ? item.receipt : undefined)).not.toContain("999");
    // The page's words keep their own (tainted) bubble under the card.
    expect(item).not.toHaveProperty("receiptOnly");
    expect(s.tainted).toBe(true);
  });

  test("Q144: a payment refused by a cap is a coral card in the chat, with code's words, never a raw reason row", () => {
    for (const reason of ["over_per_payment", "over_per_day", "merchant_over_per_payment"]) {
      const s = run([
        { type: "send", id: "u", text: "mándale 40 dólares a Ana" },
        { type: "step", event: { kind: "picked", skill: "pay" } },
        { type: "step", event: { kind: "blocked", skill: "pay", reason } },
        { type: "finished", id: "a", view: { kind: "reply", text: "Eso pasa tu límite de 25 USD₮ por pago." } },
      ]);
      expect(s.items.filter((i) => i.kind === "system")).toEqual([]);
      expect(s.items.at(-1)).toMatchObject({ kind: "assistant", text: "Eso pasa tu límite de 25 USD₮ por pago.", card: "refused" });
      expect(s.mascot).toBe("blocked");
    }
  });

  test("Q144: a tainted reply never becomes the refusal card", () => {
    const s = run([
      { type: "send", id: "u", text: "x" },
      { type: "step", event: { kind: "blocked", skill: "pay", reason: "over_per_payment" } },
      { type: "finished", id: "a", view: { kind: "reply", text: "Pagado 999 USD₮", tainted: true } },
    ]);
    expect(s.items.at(-1)).not.toHaveProperty("card");
  });

  test("other blocks keep their quiet row and no card", () => {
    const s = run([
      { type: "send", id: "u", text: "x" },
      { type: "step", event: { kind: "blocked", skill: "pay", reason: "insufficient" } },
      { type: "finished", id: "a", view: { kind: "reply", text: "Tu saldo es 1 USD₮." } },
    ]);
    expect(s.items.some((i) => i.kind === "system")).toBe(true);
    expect(s.items.at(-1)).not.toHaveProperty("card");
  });
});

describe("people by name in the chat (PDR-028)", () => {
  const choices = [{ label: "Carlos Méndez, ending in 0001", text: "+50687770001" }, { label: "Carlos Rojas, ending in 0002", text: "+50687770002" }];

  test("a question with choices keeps them for the screen's tappable chips; the next send retires them", () => {
    const s = run([{ type: "send", id: "u", text: "call Carlos" }, { type: "finished", id: "q", view: { kind: "question", text: "Which one?", choices } }]);
    expect(s.items.at(-1)).toEqual({ kind: "question", id: "q", text: "Which one?", choices });
    const next = chatReducer(s, { type: "send", id: "u2", text: "+50687770002" });
    expect(next.items.find((i) => i.id === "q")).toEqual({ kind: "question", id: "q", text: "Which one?" });
  });

  test("the contacts offer is its own row after the answer", () => {
    const s = run([{ type: "send", id: "u", text: "llama a mamá" }, { type: "finished", id: "a", view: { kind: "reply", text: "Abrí el marcador.", offer: "contacts" } }]);
    expect(s.items.slice(-2)).toEqual([
      { kind: "assistant", id: "a", text: "Abrí el marcador.", streaming: false },
      { kind: "offer", id: "a-offer", offer: "contacts" },
    ]);
  });
});

describe("a bot proposal (multi-bot contracts)", () => {
  const PROPOSAL: BotProposalView = { offerId: "o1", name: "Viajes", role: "Planeas los viajes de la familia Prueba.", look: { shape: "whelk", color: "sand" }, grants: ["web_read", "notes"], sources: { sites: ["wikivoyage.org"], connectors: [] }, tainted: false, needsFingerprint: false, mode: "ask" };
  const sent = chatReducer(initialChat, { type: "send", id: "u1", text: "créame un bot" });
  test("a reply's bot proposal reaches its chat item", () => {
    const view = { kind: "reply" as const, text: "Te propongo este bot.", botProposal: PROPOSAL };
    const s = chatReducer(sent, { type: "finished", id: "m2", view });
    expect(s.items.at(-1)).toMatchObject({ kind: "assistant", botProposal: PROPOSAL });
  });
});
