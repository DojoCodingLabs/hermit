import { extractWhen, splitClauses, type JsonSchema, type ModelPort, type Msg, type PickLive, type ReplyText, type SkillDef, type SkillId, type StopSignal } from "@hermit/core";
import type { CompletionEngine, EngineMessage, EngineRequest } from "./engine.ts";
import type { ModelProfile } from "./profile.ts";
import { planIntents, routeIntent, type Route } from "./intent-hints.ts";
import { askFor } from "./ask-questions.ts";
import { asksWhatHermitCanDo } from "./capabilities.ts";
import { quarantinedRead } from "./reader.ts";
import { ContinuationFilter, continueNote, endAtBoundary, stoppedShort } from "./reply-cut.ts";
import { longFormAsked, type LongFormKind } from "./long-form.ts";
import { longReplyCap } from "./runtime.ts";
import { CATCH_UP, catchUpReply, fallbackReply, longReplyPrompt, mailCountLine, mailReply, mailSource, maskMail, isBareActionName, replyPrompt, scrubForgotten, stableSystemPrompt, stripThinking, stripVisibleReasoning, systemPrompt, toEngineMessages, userLanguage, type PromptContext } from "./prompt.ts";

type Choice = SkillId | "respond" | "ask_user";

/**
 * ModelPort over a completion engine (FR-MODEL-01, FR-LOOP-01). Two formats (FR-MODEL-05):
 * - two_stage: pick returns {"choice": one of the menu}, constrained by a JSON schema enum; fill is
 *   constrained by the skill's own argument schema.
 * - native_tools: pick offers the menu as tools with toolChoice "required"; the call's name is the choice
 *   and its arguments are kept so fill can return them without a second pass.
 * Either way the loop still validates, repairs and puts every call through the cage.
 */
export interface ModelPortOptions {
  /**
   * US-MSG-04: after the catch-up list, one paragraph across conversations from the quarantined reader
   * (FR-WEB-03). Costs one extra short model call, only when two or more conversations came in.
   */
  catchUpSummary?: boolean;
  /**
   * Skills that change from turn to turn (SL-54: the MCP tools routed for this turn, capped). They follow the
   * fixed skills everywhere the model sees skills, so the fixed part of a stable prefix stays the same.
   */
  extraSkills?: () => readonly SkillDef[];
  /**
   * W1: what Hermit can do on this phone, written by code from the skills it has (the runtime's copy), in the given
   * language. Asked "what can you do?" (`asksWhatHermitCanDo`), the port answers with it and the model runs not at all:
   * on the S26 it invented capabilities. Without it the model answers as before.
   */
  capabilities?: (language: "es-419" | "en") => string | undefined | Promise<string | undefined>;
}

/** The mail skills that change something (SL-49). */
const MAIL_WRITES = new Set(["mail_send", "mail_reply", "mail_forward", "mail_draft", "mail_modify"]);

export function createModelPort(engine: CompletionEngine, profile: ModelProfile, skills: readonly SkillDef[], context: () => PromptContext, options: ModelPortOptions = {}): ModelPort {
  const fixed = new Map(skills.map((s) => [s.id as string, s]));
  const extras = () => options.extraSkills?.() ?? [];
  const byId = { get: (id: string): SkillDef | undefined => fixed.get(id) ?? extras().find((s) => s.id === id) };
  const every = () => [...skills, ...extras().filter((s) => !fixed.has(s.id as string))];
  let pendingNative: { skill: string; args: unknown } | undefined;
  // The current call's stop signal (FR-LOOP-06): every engine call carries it, and none starts once it fired.
  let signal: StopSignal | undefined;
  const complete = (req: EngineRequest) => {
    if (signal?.aborted) return Promise.reject(new Error("Stopped by the user."));
    return engine.complete(signal ? { ...req, signal } : req);
  };

  const base = (given: Parameters<ModelPort["pick"]>[0]["messages"], menu: readonly SkillId[], prefixCacheKey: string) => {
    // Mail text never reaches the main model, which has tools in reach: it sees only the facts code read from
    // the headers (ids, dates, sender addresses, subjects), enough to choose the message (SL-49 review).
    const messages = maskMail(scrubForgotten(given));
    const offered = menu.map((id) => byId.get(id)).filter((s): s is SkillDef => s !== undefined);
    // Answer in the language of the user's own words this turn (the app setting is only the fallback):
    // with an English-only setting BotPsy asked Spanish speakers in English.
    const said = [...messages].reverse().find((m) => m.role === "user" && !m.content.startsWith("Result:"))?.content ?? "";
    const spoken = userLanguage(said);
    const ctx = context();
    const language = spoken === "Spanish (Latin America)" ? "es-419" : spoken === "English" ? "en" : ctx.language;
    const thinking = profile.thinking.mode === "on" ? { enabled: true, budgetTokens: profile.thinking.budgetTokens } : { enabled: false };
    if (profile.stablePrefix) {
      // One prefix for every call: all skills, a system prompt that changes once an hour; the history only grows.
      return {
        offered,
        req: {
          messages: toEngineMessages(stableSystemPrompt(ctx, every()), messages, profile.format),
          thinking,
          sampling: profile.sampling,
          cacheKey: `${prefixCacheKey}:${profile.id}`,
        } satisfies Partial<EngineRequest>,
      };
    }
    return {
      offered,
      req: {
        messages: toEngineMessages(systemPrompt({ ...ctx, language }, offered, profile.prompt ?? "menu"), messages, profile.format),
        thinking,
        sampling: profile.sampling,
        cacheKey: `${prefixCacheKey}:${profile.id}`,
      } satisfies Partial<EngineRequest>,
    };
  };

  const port: ModelPort = {
    async pick({ prefixCacheKey, messages, menu, live, signal: stop }) {
      pendingNative = undefined;
      signal = stop;
      // Narrow on the user's own latest words, for every step of the turn: after a failure a small model
      // wandered from remind to forget on the S26. The hint holds until the user speaks again.
      // Streams answer text once it can't be the start of a tool call; reasoning goes to its own panel.
      let streamed = false;
      let held = "";
      let sent = 0;
      let cut = false;
      const stream = (t: string) => {
        if (!live?.onToken || cut) return;
        held += t;
        // Stop before any markup (a tool call can follow a preface: "Claro, <tool_call>..."), and hold a partial
        // tag at the end until it resolves. The loop drops a streamed bubble the moment a tool is picked.
        const tag = held.search(/<[/!a-z|]|<$/i);
        if (!streamed) {
          if (held.length < 40) return;
          if (/^\s*[{[]/.test(held) || (tag >= 0 && tag < 40)) return void (cut = true);
          // Visible reasoning ("The user wants...") is never shown; the final text has it stripped anyway.
          if (stripVisibleReasoning(held.slice(0, tag >= 0 ? tag : held.length)) !== held.slice(0, tag >= 0 ? tag : held.length).trim()) return void (cut = true);
          streamed = true;
        }
        const upTo = tag >= 0 ? tag : held.length;
        if (upTo > sent) live.onToken(held.slice(sent, upTo));
        sent = Math.max(sent, upTo);
        if (tag >= 0 && !/<$/.test(held)) cut = true;
      };
      const isUser = (m: (typeof messages)[number]) => m.role === "user" && !m.content.startsWith("Result:");
      let userIdx = -1;
      for (let i = messages.length - 1; i >= 0 && userIdx < 0; i--) if (isUser(messages[i]!)) userIdx = i;
      const lastUser = messages[userIdx]?.content ?? "";
      // An answer to our own question ("mañana a las 8") carries the request it answers ("pon un
      // recordatorio"): route on both, so the reminder is still a reminder.
      const asked = userIdx > 0 && messages[userIdx - 1]!.role === "assistant" && /[?？¿]/.test(messages[userIdx - 1]!.content);
      const earlier = asked ? [...messages.slice(0, userIdx - 1)].reverse().find(isUser)?.content : undefined;
      // The phone's clock and zone for day words ("el viernes" at 20:00 is tomorrow, not a week away, W1 review).
      const clock = context().clock;
      let route = routeIntent(earlier ? `${earlier}\n${lastUser}` : lastUser, menu.map((id) => ({ id })), clock);
      // Several requests in one message: the first clause not yet done this turn decides the route, forced.
      const plan = planIntents(lastUser, menu.map((id) => ({ id })), clock);
      // W1: "what can you do?" gets the skills on this phone, in code's words, before any model call.
      const lang = () => {
        const want = userLanguage(lastUser);
        return want === "English" ? ("en" as const) : want ? ("es-419" as const) : context().language;
      };
      if (messages[messages.length - 1]?.role === "user" && options.capabilities && asksWhatHermitCanDo(lastUser)) {
        const text = await options.capabilities(lang());
        if (text) return { choice: "respond", text };
      }
      // W1: once the turn's actions wrote their own answers and nothing more is owed, they are the answer; the model,
      // which restated them wrong on the S26, writes nothing.
      const coded = codedAnswer(messages, userIdx, lastUser, route, plan, menu);
      if (coded) return { choice: "respond", text: coded.text, ...(coded.untrusted ? { untrusted: true } : {}) };
      if (plan.length > 1) {
        const done = new Set(messages.slice(userIdx + 1).filter((m) => m.role === "assistant" && m.content.startsWith('{"skill":')).map((m) => (JSON.parse(m.content) as { skill: string }).skill));
        const next = plan.find((p) => !p.skills.some((s) => done.has(s.id as string)));
        route = next ? { ...next, force: true } : { skills: menu.map((id) => ({ id })), force: false };
      }
      // Mail (SL-48): the answer after a mail read is built from the result, never by the main model, which
      // would be reading other people's text with tools in reach. A list or a message goes through the
      // quarantined reader (FR-WEB-03), with the count from code; search results are a list from code. Only
      // for a single request: with more asked in the same message, the turn goes on. Also not when the user's
      // words asked to reply, forward, draft or organize (SL-49): the read was the first step, and every write
      // still asks with a sheet built by code, recipients from the user's words or the thread. Either way the
      // quarantine holds: when the turn goes on, the model sees only mailFacts (maskMail in base and words).
      const tail = messages[messages.length - 1];
      const wantsMailWrite = route.skills.length < menu.length && route.skills.some((s) => MAIL_WRITES.has(s.id as string));
      const mail = tail?.role === "tool" && plan.length <= 1 && !wantsMailWrite ? mailSource(tail.content) : undefined;
      if (mail && tail) {
        const want = userLanguage(lastUser);
        const lang = want === "English" ? "en" : want ? "es-419" : context().language;
        const listed = mailReply(tail.content, lang);
        if (mail === "mail_search") {
          if (listed) return { choice: "respond", text: listed, untrusted: true };
        } else {
          const summary = await quarantinedRead({ complete }, profile, { question: lastUser, untrusted: tail.content, source: mail, language: lang }).catch((err: unknown) => {
            if (signal?.aborted) throw err;
            return undefined;
          });
          const count = mail === "mail_list" ? mailCountLine(tail.content, lang) : undefined;
          if (summary) return { choice: "respond", text: count ? `${count} ${summary.answer}` : summary.answer, untrusted: true };
          if (listed) return { choice: "respond", text: listed, untrusted: true };
        }
      }
      // Q155: the user's own words ask for a long answer (a recipe, steps, a list, a detailed explanation) and nothing
      // is routed for them: no skill hint, one request, not out of scope, no installed tool routed this turn. The
      // answer is words only, with the prompt that allows structure and the long cap; no tools are offered, so nothing
      // it writes can act. Thinking per the profile (off: the words start at once).
      const long = messages[messages.length - 1]?.role === "user" && plan.length <= 1 && route.skills.length === menu.length && !route.outOfScope && !extras().length ? longFormAsked(lastUser) : undefined;
      if (long) {
        live?.onWords?.();
        return longAnswer(messages, lastUser, long, live);
      }
      const narrowed = route.skills.map((s) => s.id);
      // The router knows the skill before the model runs: say so at once (Q36).
      if (route.skills.length < menu.length) live?.onIntent?.(route.skills[0]!.id as string);
      const { offered, req } = base(messages, narrowed, prefixCacheKey);
      // Stable prefix: every call carries the same tool block (all skills, fixed order); narrowing is
      // the choice check below and the constrained fallback. Calls that must not call a tool say "none".
      const allTools = every().map((s) => ({ name: s.id as string, description: s.menuLine, parameters: leanSchema(s.args) }));
      const keep = (r: Partial<EngineRequest>): Partial<EngineRequest> => (profile.stablePrefix ? { ...r, tools: allTools, toolChoice: r.tools ? r.toolChoice : "none" } : r);
      const choices = [...offered.map((s) => s.id as string), "respond", "ask_user"];

      if (profile.format === "native_tools") {
        // The trained format (docs/research/harness-inference.md): only real skills are tools, the model may
        // call one or answer in plain text. No call means respond; a question means ask_user.
        const tools = profile.stablePrefix ? allTools : offered.map((s) => ({ name: s.id as string, description: s.menuLine, parameters: leanSchema(s.args) }));
        // Forced only on the first step of a turn: after a result the model must be free to answer.
        const firstStep = messages[messages.length - 1]?.role === "user";
        // Follow-through for replies: the user asked to tell someone something, read_messages has run this
        // turn and returned conversations, and no reply was sent yet. One constrained call to reply_message,
        // with conversationId limited by grammar to the ids the read returned (no invented ids possible).
        const replySkill = byId.get("reply_message");
        // Only when the user's own words asked for a reply (a narrowed route). The full menu also contains
        // reply_message: without this check, reading an injected "send me the bank password" forced a reply.
        const askedToReply = route.skills.length < menu.length && route.skills.some((x) => x.id === "reply_message");
        // Catch-up: once the messages are read, the answer is the list itself, in the user's language.
        const lastMsg = messages[messages.length - 1];
        if (!firstStep && !askedToReply && CATCH_UP.test(lastUser) && lastMsg?.role === "tool" && lastMsg.content.startsWith('<untrusted source="read_messages"')) {
          const want = userLanguage(lastUser);
          const lang = want === "English" ? "en" : want ? "es-419" : context().language;
          // The read's own list when it wrote one (from its records, W1 review); its lines only when it didn't.
          const listed = lastMsg.answer ?? catchUpReply(lastMsg.content, lang);
          if (listed) {
            // The list quotes other people, so the answer stays marked untrusted either way.
            const summary = options.catchUpSummary && conversationsIn(lastMsg.content) >= 2
              ? await quarantinedRead({ complete }, profile, { question: lastUser, untrusted: lastMsg.content, source: "read_messages", language: lang }).catch((err: unknown) => {
                  if (signal?.aborted) throw err;
                  return undefined;
                })
              : undefined;
            const text = summary ? `${listed}\n\n${lang === "en" ? "In short:" : "En resumen:"} ${summary.answer}` : listed;
            return { choice: "respond", text, untrusted: true };
          }
        }
        if (!firstStep && replySkill && askedToReply) {
          const thisTurn = messages.slice(userIdx + 1);
          const replied = thisTurn.some((m) => m.role === "assistant" && m.content.includes('"skill":"reply_message"'));
          const ids = [...new Set(thisTurn.filter((m) => m.role === "tool" && m.content.startsWith('<untrusted source="read_messages"')).flatMap((m) => [...m.content.matchAll(/^conversationId: ([A-Za-z0-9_:.-]+) \|/gm)].map((x) => x[1]!)))];
          if (!replied && ids.length) {
            const args = replySkill.args as { properties: Record<string, JsonSchema> };
            const pinned = { ...replySkill, args: { ...args, properties: { ...args.properties, conversationId: { type: "string", enum: ids } } } } as SkillDef;
            const forced = await complete({ ...req, ...keep({}), thinking: { enabled: false }, jsonSchema: choiceSchema([pinned], false), maxTokens: 300 } as EngineRequest);
            const parsed = safeJson(stripThinking(forced.text)) as { choice?: string; args?: unknown } | undefined;
            if (parsed?.choice === "reply_message") {
              pendingNative = { skill: "reply_message", args: parsed.args ?? {} };
              return { choice: "reply_message" as SkillId };
            }
          }
        }

        // Fast path: the router is sure which skill fits, so thinking adds little; one short call fills it.
        // Out of scope (a call, a purchase, the weather): no tools offered, so the answer can only be words.
        if (route.outOfScope && firstStep) {
          // No tools are offered (keep() offers them only with toolChoice "none"): nothing it writes can act.
          live?.onWords?.();
          const said = await complete({ ...req, ...keep({}), maxTokens: 400, onThinking: live?.onThinking, onToken: stream } as EngineRequest);
          const text = stripVisibleReasoning(said.text);
          const want = userLanguage(lastUser);
          // Q155: out of tokens before its own end is said, never shown as finished.
          if (text && !isBareActionName(text, choices) && (!want || !userLanguage(text) || userLanguage(text) === want)) return answer(text, streamed, stoppedShort(said));
          return { choice: "respond" };
        }
        // A lookup off the route (stable prefix) doesn't finish the request: the routed skill is still owed and
        // stays forced ("remind me on my mom's birthday": recall found Nov 20, then the model only chatted).
        const turnCalls = messages.slice(userIdx + 1).filter((m) => m.role === "assistant" && m.content.startsWith('{"skill":')).map((m) => (JSON.parse(m.content) as { skill: string }).skill);
        const owed = profile.stablePrefix && route.force && !firstStep && turnCalls.length > 0 && !turnCalls.some((c) => narrowed.includes(c as SkillId));
        const forceNow = route.force && (firstStep || plan.length > 1 || owed);
        const fast = profile.fastRoute && forceNow;
        const out = await complete({ ...req, ...(fast ? { thinking: { enabled: false } } : {}), tools, toolChoice: forceNow ? "required" : "auto", maxTokens: fast ? 200 : 512, onThinking: live?.onThinking, onToken: stream });
        const call = out.toolCalls[0];
        // With every tool offered, a trusted read off the route is fine: "remind me on my mom's birthday"
        // looks the date up with recall, then sets the reminder. read_messages brings outside content, so no.
        // Only before a write the route owes (a reminder needs the date it looks up), and only on the first step:
        // a lookup never replaces a routed read ("¿qué me perdí?" is read_messages, not recall).
        const routeWrites = route.skills.length < menu.length && route.skills.every((x) => byId.get(x.id as string)?.risk !== "read");
        const offRouteRead = profile.stablePrefix && firstStep && routeWrites && call && byId.get(call.name)?.risk === "read" && call.name !== "read_messages";
        if (call && (choices.includes(call.name) || offRouteRead)) {
          pendingNative = { skill: call.name, args: call.arguments };
          return { choice: call.name as SkillId };
        }
        if (forceNow) {
          // The router says a tool must be called and runtimes don't all enforce tool_choice "required" for
          // this format (llama.cpp doesn't), so constrain one short call to the routed skills' schemas.
          // Nothing read yet means no conversation to reply in: read first (reply_message needs its id).
          const readFirst = offered.some((s) => s.id === "read_messages") && !messages.some((m) => m.role === "tool");
          const pool = readFirst ? offered.filter((s) => s.id === "read_messages") : offered;
          const forced = await complete({ ...req, ...keep({}), thinking: { enabled: false }, jsonSchema: choiceSchema(pool, false), maxTokens: 300 } as EngineRequest);
          const parsed = safeJson(stripThinking(forced.text)) as { choice?: string; args?: unknown } | undefined;
          if (parsed?.choice && choices.includes(parsed.choice)) {
            pendingNative = { skill: parsed.choice, args: parsed.args ?? {} };
            return { choice: parsed.choice as SkillId };
          }
        }
        let text = stripVisibleReasoning(out.text);
        // Q155: an answer that ran out of tokens is a long answer, never a question back, and says it was cut.
        const short = stoppedShort(out) && text.length > 0;
        // "I need to know what to remind you about. Could you tell me...?" opens like visible reasoning and is
        // stripped, but it is the model asking the user: keep its closing question (first step only).
        const raw = stripThinking(out.text).trim();
        if (!text && firstStep && /[?？]\s*$/.test(raw)) text = raw.split(/(?<=[.!])\s+/).filter((x) => /[?？]\s*$/.test(x)).pop() ?? "";
        // A question anywhere, or an opening that asks for what's missing, is ask_user.
        // Only before any result this turn: after a result, text is the answer, and it may quote a question
        // ("Ana: ¿Vienes a la cena?"). Quoted text never counts.
        const unquoted = text.replace(/"[^"]*"|“[^”]*”|«[^»]*»|'[^']*'/g, "").replace(/^[^:\n]{1,40}:\s.*$/gm, "");
        if (firstStep && text && !short && !isBareActionName(text, choices) && (/[?？¿]/.test(unquoted) || /^(i need (to know|more (information|details))|could you (please )?(tell|specify|provide|clarify)|necesito (saber|m[aá]s (informaci[oó]n|detalles))|(me )?(podr[ií]as|puedes) (decirme|indicarme|especificar))/i.test(text))) {
          const want = userLanguage(lastUser);
          // When the router knows the skill, a fixed question in the user's language beats an improvised one.
          const lang = want === "English" ? "en" : want ? "es-419" : context().language;
          if (route.skills.length < menu.length) {
            const fixed = askFor(route.skills[0]!.id as string, lang);
            if (fixed) return { choice: "ask_user", text: fixed };
          }
          // Its question must be in the user's language; otherwise the reply prompt (which pins it) rewrites it.
          if (want && userLanguage(text) && userLanguage(text) !== want) return { choice: "ask_user", text: (await words(messages, "question", choices, () => {})).text };
          return { choice: "ask_user", text };
        }
        // A plain answer in the user's language is the reply: on the trajectory eval the separate reply
        // prompt (no thinking) contradicted a correct answer ("no se encontró ningún mensaje de Ana").
        const want = userLanguage(lastUser);
        const said = userLanguage(text);
        if (text && !isBareActionName(text, choices) && (!want || !said || said === want)) return answer(text, streamed, short);
        return { choice: "respond" };
      }

      // One call per action: the grammar admits {"choice":"<skill>","args":{...that skill's schema...}}
      // for each offered skill, or respond, or ask_user with a question. Arguments are kept for fill().
      const schema = choiceSchema(offered, true);
      const out = await complete({ ...req, jsonSchema: schema, maxTokens: 400 });
      const parsed = safeJson(stripThinking(out.text)) as { choice?: string; text?: string; args?: unknown } | undefined;
      const choice = parsed?.choice && choices.includes(parsed.choice) ? (parsed.choice as Choice) : "respond";
      if (choice !== "ask_user" && choice !== "respond") {
        pendingNative = { skill: choice, args: parsed?.args ?? {} };
        return { choice };
      }
      if (choice !== "ask_user") return { choice };
      // ask_user must come with an actual question; write one with the reply prompt if the pick had none.
      const given = parsed?.text?.trim();
      if (given && !isBareActionName(given, choices)) return { choice, text: given };
      return { choice, text: (await words(messages, "question", choices, () => {})).text };
    },

    async warm({ prefixCacheKey }) {
      // Only the stable prefix is worth warming: it is the same for every call until the hour changes.
      signal = undefined;
      if (!profile.stablePrefix || profile.format !== "native_tools") return;
      const { req } = base([], skills.map((s) => s.id), prefixCacheKey);
      const tools = skills.map((s) => ({ name: s.id as string, description: s.menuLine, parameters: leanSchema(s.args) }));
      await complete({ ...req, tools, maxTokens: 0, prefill: true } as EngineRequest);
    },

    async fill({ prefixCacheKey, messages, skill, schema, signal: stop }) {
      signal = stop;
      if (pendingNative && pendingNative.skill === skill) {
        const args = idAlone(pendingNative.args);
        pendingNative = undefined;
        return { rawText: JSON.stringify(args), args };
      }
      // Only reached when pick didn't carry arguments (a repair retry): one system message, first.
      const { req } = base(messages, [skill], prefixCacheKey);
      const [system, ...rest] = req.messages;
      const out = await complete({
        ...req,
        messages: [{ role: "system", content: `${system!.content}\n\nNow write only the JSON arguments for ${skill}.` }, ...rest],
        jsonSchema: schema,
        maxTokens: 400,
      });
      const rawText = stripThinking(out.text);
      return { rawText, args: safeJson(rawText) };
    },

    async respond({ messages, signal: stop }, onToken) {
      signal = stop;
      const names = [...every().map((s) => s.id as string), "respond", "ask_user"];
      return words(messages, "answer", names, onToken);
    },

    async continueReply({ messages, signal: stop }, onToken) {
      signal = stop;
      const last = messages[messages.length - 1];
      if (!last || last.role !== "assistant" || !last.content.trim() || last.content.startsWith('{"skill":')) {
        throw new Error("Nothing to continue: the conversation doesn't end with a reply.");
      }
      return more(messages, last.content, onToken);
    },
  };

  // Honesty guard, for any model: a reminder or an event needs a time the user actually said. With no time
  // in their words (this turn, or the request our question answers), the model's time is invented, so
  // Hermit asks instead (the Qwen3.5-0.8B base model invented one in every "ask" case; BotPsy did for
  // "avisame mañana porfa").
  const inner = port.pick.bind(port);
  port.pick = async (input) => {
    const picked = await inner(input);
    const firstStep = input.messages[input.messages.length - 1]?.role === "user";
    // A recall or forget about "that" with nothing earlier in the conversation to point at: ask what.
    if (firstStep && (picked.choice === "recall" || picked.choice === "forget") && input.messages.filter((m) => m.role === "user").length === 1) {
      const q = String((pendingNative?.args as { query?: unknown } | undefined)?.query ?? "").toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, "").trim();
      if (/^(|that|this|it|eso|esto|lo|algo|something|my|mi)$/.test(q)) {
        pendingNative = undefined;
        const want = userLanguage(requestWords(input.messages));
        return { choice: "ask_user", text: askFor(picked.choice, want === "English" ? "en" : want ? "es-419" : context().language)! };
      }
    }
    if (firstStep && (picked.choice === "remind" || picked.choice === "calendar_add")) {
      const words = requestWords(input.messages);
      const clock = context().clock;
      const w = extractWhen(words, clock?.now ?? Date.now(), clock?.timeZone ?? "UTC");
      if (w.time === undefined && w.at === undefined) {
        pendingNative = undefined;
        const want = userLanguage(words);
        return { choice: "ask_user", text: askFor(picked.choice, want === "English" ? "en" : want ? "es-419" : context().language)! };
      }
    }
    return picked;
  };
  return port;

  /**
   * W1: the answer the turn's actions wrote themselves (`Msg.answer`, from `SkillResult.answer`), when it is the whole
   * answer: the last result has one, every action that changes something ran and confirmed itself (a failure, a refusal
   * or a "no" is the model's to explain), each request in the message had its action, and nothing routed is still owed
   * (a reply the user asked for after reading, an action a lookup came first for, a later request in the message).
   * A single request answers with its actions' confirmations and the last read's listing; several requests answer with
   * every part, in order. Listings quote other people, so the answer keeps their result's untrusted mark.
   */
  function codedAnswer(messages: readonly Msg[], userIdx: number, lastUser: string, route: Route<{ id: SkillId }>, plan: ReadonlyArray<Route<{ id: SkillId }>>, menu: readonly SkillId[]): { text: string; untrusted: boolean } | undefined {
    const tail = messages[messages.length - 1];
    if (userIdx < 0 || tail?.role !== "tool" || !tail.answer) return undefined;
    // A catch-up keeps its own list and the quarantined summary across conversations (US-MSG-04).
    if (CATCH_UP.test(lastUser) && tail.content.startsWith('<untrusted source="read_messages"')) return undefined;
    const steps: Array<{ skill: string; result?: Msg }> = [];
    for (let i = userIdx + 1; i < messages.length; i++) {
      const m = messages[i]!;
      if (m.role !== "assistant" || !m.content.startsWith('{"skill":')) continue;
      const skill = safeJson(m.content) as { skill?: unknown } | undefined;
      if (typeof skill?.skill !== "string") continue;
      const next = messages[i + 1];
      steps.push({ skill: skill.skill, ...(next?.role === "tool" ? { result: next } : {}) });
    }
    const writes = (skill: string) => {
      const risk = byId.get(skill)?.risk;
      return risk !== undefined && risk !== "read" && risk !== "network";
    };
    if (!steps.length || steps.some((s) => writes(s.skill) && !s.result?.answer)) return undefined;
    // Two "recuérdame" in one message route alike, so the plan can't tell them apart: one action per request at least.
    if (steps.length < splitClauses(lastUser).length) return undefined;
    const several = plan.length > 1;
    if (several) {
      if (steps.some((s) => !s.result?.answer)) return undefined;
      const done = new Set(steps.map((s) => s.skill));
      if (plan.some((p) => !p.skills.some((x) => done.has(x.id as string)))) return undefined;
    } else if (route.skills.length < menu.length) {
      const routed = new Set(route.skills.map((s) => s.id as string));
      if (!steps.some((s) => routed.has(s.skill))) return undefined;
      if (routed.has("reply_message") && !steps.some((s) => s.skill === "reply_message")) return undefined;
    }
    const parts = steps.filter((s) => s.result?.answer && (several || writes(s.skill) || s.result === tail));
    if (!parts.length) return undefined;
    return { text: parts.map((s) => s.result!.answer!).join("\n\n"), untrusted: parts.some((s) => s.result!.untrusted === true) };
  }

  /** respond with the answer's text; Q155: an answer that ran out of tokens ends at its last whole line and says so. */
  function answer(text: string, streamed: boolean, short: boolean) {
    return { choice: "respond" as const, text: short ? endAtBoundary(text) : text, ...(streamed ? { streamed } : {}), ...(short ? { cut: true } : {}) };
  }

  /** Q155: thinking for a long answer, from the profile (off unless it says otherwise). */
  function longThinking(): EngineRequest["thinking"] {
    return profile.longThinking?.mode === "on" ? { enabled: true, budgetTokens: profile.longThinking.budgetTokens } : { enabled: false };
  }

  /**
   * Q155: a long request for the engine: the long prompt over the history, the long cap the context leaves room for,
   * and `longForm`, so a device-tuned engine allows it only while the phone is cool. Words only: no tools, no schema.
   */
  function longRequest(messages: Msg[], userText: string, kind: LongFormKind, extra: EngineMessage[] = []): Omit<EngineRequest, "onToken"> {
    // The phone reads every prompt token before the first word (the S26: 8 to 20 s for 4,400 tokens), so a long answer
    // reads only the latest turns, and keeps its own cache key so Seguir reuses the prompt it already read.
    const engineMessages = [...toEngineMessages(longReplyPrompt(context(), kind, userText), maskMail(scrubForgotten(latestTurns(messages))), profile.format), ...extra];
    const chars = engineMessages.reduce((n, m) => n + m.content.length, 0);
    return { messages: engineMessages, thinking: longThinking(), sampling: profile.sampling, maxTokens: longReplyCap(profile, chars), longForm: true, cacheKey: `hermit-long:${profile.id}` };
  }

  /** Q155: the long answer itself, streamed once its opening can't be visible reasoning. */
  async function longAnswer(messages: Msg[], userText: string, kind: LongFormKind, live: PickLive | undefined) {
    const shown = heldStream(live?.onToken);
    const out = await complete({ ...longRequest(messages, userText, kind), ...(live?.onThinking ? { onThinking: live.onThinking } : {}), onToken: shown.push });
    const text = stripVisibleReasoning(out.text);
    // Nothing usable: the loop asks the reply prompt, which answers long again for these words.
    if (!text || isBareActionName(text, [...every().map((s) => s.id as string), "respond", "ask_user"])) return { choice: "respond" as const };
    return answer(text, shown.streamed(), stoppedShort(out));
  }

  /** Words for the user, from the reply prompt (no menu). One retry, then a fixed fallback; never a bare action name. */
  async function words(messages: Parameters<ModelPort["respond"]>[0]["messages"], task: "answer" | "question", names: readonly string[], onToken: (t: string) => void): Promise<ReplyText> {
    const thinking = profile.thinking.mode === "on" ? { enabled: true, budgetTokens: profile.thinking.budgetTokens } : { enabled: false };
    const userText = [...messages].reverse().find((m) => m.role === "user")?.content ?? "";
    // Q155: an answer to words that asked for a long one is long too (after a result, say), with the same rules.
    const long = task === "answer" ? longFormAsked(userText) : undefined;
    for (let attempt = 0; attempt < 2; attempt++) {
      let inThink = false;
      let streamed = "";
      let flushed = 0;
      const out = await complete({
        ...(long
          ? longRequest(messages, userText, long)
          : { messages: toEngineMessages(replyPrompt(context(), task, userText), maskMail(messages), profile.format), thinking, sampling: profile.sampling, maxTokens: profile.maxReplyTokens }),
        // Stream only the first attempt; a retry replaces the bubble when the turn finishes.
        onToken: (t) => {
          if (attempt > 0) return;
          if (t.includes("<think>")) inThink = true;
          if (inThink) {
            if (t.includes("</think>")) inThink = false;
            return;
          }
          // Hold the stream until the opening can't be visible reasoning; the final text replaces it anyway.
          streamed += t;
          if (streamed.length > 40 && stripVisibleReasoning(streamed) === streamed.trim()) {
            onToken(streamed.slice(flushed));
            flushed = streamed.length;
          }
        },
      });
      const text = stripVisibleReasoning(out.text);
      // Q155: words that ran out of tokens are a cut answer (a question is short; it is never offered Seguir). Tokens
      // spent thinking with nothing written leave no text, so they retry instead.
      if (!isBareActionName(text, names)) return task === "answer" && stoppedShort(out) ? { text: endAtBoundary(text), cut: true } : { text };
    }
    return { text: fallbackReply(context().language) };
  }

  /**
   * Q155, Seguir: the next part of `partial`, the reply the conversation ends with. Words only: the reply prompt (no
   * menu, no tools, no schema) and, on the user's side, a request to go on in their language. Thinking is off so the
   * words start at once; if all it wrote was visible reasoning, one retry thinks first. What streams goes through
   * ContinuationFilter, line by line: nothing the reply already says (a restart, a renumbered repeat, a loop, a
   * preface) reaches the screen, and what does is exactly the part appended.
   */
  async function more(messages: Msg[], partial: string, onToken: (t: string) => void): Promise<ReplyText> {
    const userText = [...messages].reverse().find((m) => m.role === "user" && !m.content.startsWith("Result:"))?.content ?? "";
    const spoken = userLanguage(userText);
    const language = spoken === "English" ? "en" : spoken === "Spanish (Latin America)" ? "es-419" : context().language;
    // A long answer goes on long (its prompt, its cap, `longForm`); any other reply with the reply prompt and its cap.
    const long = longFormAsked(userText);
    const ask = { role: "user" as const, content: continueNote(language) };
    const base = long
      ? longRequest(messages, userText, long, [ask])
      : { messages: [...toEngineMessages(replyPrompt(context(), "answer", userText), maskMail(scrubForgotten(messages)), profile.format), ask], sampling: profile.sampling, maxTokens: profile.maxReplyTokens };
    const thinkFirst = profile.thinking.mode === "on" ? { enabled: true, budgetTokens: profile.thinking.budgetTokens } : { enabled: false };
    for (let attempt = 0; attempt < 2; attempt++) {
      let raw = "";
      let inThink = false;
      let fed = false;
      let reasoning = false;
      let shown = "";
      const filter = new ContinuationFilter(partial);
      const emit = (t: string) => {
        if (!t) return;
        shown += t;
        onToken(t);
      };
      // The opening is held until it can't be visible reasoning (dropped whole); then everything goes through the filter.
      const open = (text: string) => {
        if (stripVisibleReasoning(text) !== stripThinking(text).trim()) {
          reasoning = true;
          return;
        }
        fed = true;
        emit(filter.push(text.replace(/^\s+/, "")));
      };
      const out = await complete({
        ...base,
        thinking: attempt === 0 ? { enabled: false } : thinkFirst,
        onToken: (t) => {
          if (t.includes("<think>")) inThink = true;
          if (inThink) {
            if (t.includes("</think>")) inThink = false;
            return;
          }
          if (reasoning) return;
          if (fed) return emit(filter.push(t));
          raw += t;
          if (raw.length >= 40) open(raw);
        },
      });
      if (!fed && !reasoning) open(raw || out.text);
      if (!reasoning) emit(filter.end(stoppedShort(out)));
      if (reasoning && attempt === 0) continue;
      // Nothing new (only what the reply already says, visible reasoning, or nothing), however it ended: an empty part,
      // never cut. The runtime says so in its own words and Seguir ends there, never an endless tap (review 2026-11-25).
      if (reasoning || !shown.trim() || isBareActionName(shown.trim(), [])) return { text: "" };
      return stoppedShort(out) ? { text: endAtBoundary(shown), cut: true } : { text: shown.replace(/\s+$/, "") };
    }
    return { text: "" };
  }
}

/**
 * Words for the screen as they stream, once their opening can't be visible reasoning (the final text has it stripped
 * anyway); thinking tags never reach the screen. Held until 40 characters, then flushed as they come.
 */
function heldStream(onToken: ((t: string) => void) | undefined) {
  let inThink = false;
  let held = "";
  let flushed = 0;
  return {
    streamed: () => flushed > 0,
    push: (t: string) => {
      if (!onToken) return;
      if (t.includes("<think>")) inThink = true;
      if (inThink) {
        if (t.includes("</think>")) inThink = false;
        return;
      }
      held += t;
      if (held.length > 40 && (flushed > 0 || stripVisibleReasoning(held) === held.trim())) {
        onToken(held.slice(flushed));
        flushed = held.length;
      }
    },
  };
}

/** Q155: how much history a long answer reads: the latest few turns, enough for "más largo" or "y para 8 personas". */
const LONG_HISTORY = 6;

/**
 * The latest messages, at most LONG_HISTORY before the last one, starting at the user's words (never mid-exchange). A
 * turn with several tool calls can be longer than that: the user's latest words still lead, then the exchange from its
 * next assistant message, so the model never goes on without the request in view (review 2026-11-25).
 */
function latestTurns(messages: Msg[]): Msg[] {
  const words = (m: Msg) => m.role === "user" && !m.content.startsWith("Result:");
  const recent = messages.slice(-(LONG_HISTORY + 1));
  const from = recent.findIndex(words);
  if (from >= 0) return recent.slice(from);
  const asked = [...messages].reverse().find(words);
  if (!asked) return recent;
  const next = recent.findIndex((m) => m.role === "assistant");
  return [asked, ...(next >= 0 ? recent.slice(next) : [])];
}

/**
 * What the model needs to see of an argument schema: names, types, descriptions, enums and what's
 * required. Limits and patterns stay in code (validateArgs runs on every call); dropping them from the
 * prompt saves hundreds of prefill tokens per step on every phone.
 */
export function leanSchema(schema: JsonSchema): JsonSchema {
  const s = schema as { type?: unknown; description?: unknown; enum?: unknown; properties?: Record<string, JsonSchema>; required?: unknown; items?: JsonSchema };
  const out: Record<string, unknown> = {};
  if (s.type !== undefined) out.type = s.type;
  if (s.description !== undefined) out.description = s.description;
  if (s.enum !== undefined) out.enum = s.enum;
  if (s.properties) out.properties = Object.fromEntries(Object.entries(s.properties).map(([k, v]) => [k, leanSchema(v)]));
  if (Array.isArray(s.required) && s.required.length) out.required = s.required;
  if (s.items) out.items = leanSchema(s.items);
  return out as JsonSchema;
}

/** {"choice": skill, "args": that skill's schema} for each offered skill; with talk, respond and ask_user too. */
function choiceSchema(offered: readonly SkillDef[], talk: boolean): JsonSchema {
  return {
    anyOf: [
      ...offered.map((s) => ({
        type: "object",
        properties: { choice: { const: s.id }, args: s.args },
        required: ["choice", "args"],
        additionalProperties: false,
      })),
      ...(talk
        ? [
            { type: "object", properties: { choice: { const: "respond" } }, required: ["choice"], additionalProperties: false },
            { type: "object", properties: { choice: { const: "ask_user" }, text: { type: "string", maxLength: 300 } }, required: ["choice"], additionalProperties: false },
          ]
        : []),
    ],
  };
}

/**
 * A conversationId as read_messages wrote it: the id alone. The model sometimes copies the label or the whole line
 * ("wa:1c02… | Wednesday, November 11, 2026, 20:50 (today) | Ana: …"), which the loop then refuses and nothing is sent
 * (W1 trajectory, seed 23). Only a leading id followed by the line's own " | " separator, or the "conversationId:"
 * label, is cut; anything else stays for the loop's checks, and the store and the approval binding still decide who
 * it reaches.
 */
function idAlone(args: unknown): unknown {
  if (!args || typeof args !== "object") return args;
  const v = (args as Record<string, unknown>).conversationId;
  if (typeof v !== "string") return args;
  const m = /^\s*(?:conversationId:\s*)?([A-Za-z0-9_:.-]+)\s*(?:\|.*)?$/s.exec(v);
  return m && m[1] !== v ? { ...(args as Record<string, unknown>), conversationId: m[1] } : args;
}

/** The user's request: their latest words, plus the request they answer when our last turn was a question. */
function requestWords(messages: readonly Msg[]): string {
  const isUser = (m: Msg) => m.role === "user" && !m.content.startsWith("Result:");
  let idx = -1;
  for (let i = messages.length - 1; i >= 0 && idx < 0; i--) if (isUser(messages[i]!)) idx = i;
  if (idx < 0) return "";
  const asked = idx > 0 && messages[idx - 1]!.role === "assistant" && /[?？¿]/.test(messages[idx - 1]!.content);
  const earlier = asked ? [...messages.slice(0, idx - 1)].reverse().find(isUser)?.content : undefined;
  return earlier ? `${earlier}\n${messages[idx]!.content}` : messages[idx]!.content;
}

/** How many conversations a read_messages result covers. */
function conversationsIn(toolContent: string): number {
  return new Set([...toolContent.matchAll(/^conversationId: ([^ |]+) \|/gm)].map((m) => m[1])).size;
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}
