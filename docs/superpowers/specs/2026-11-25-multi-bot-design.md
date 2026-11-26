# Multi-bot: several specialized bots, with Hermit as their coordinator

Design, 2026-11-25. Status: approved 2026-11-25. Decisions: Q200 to Q206 in `docs/build/open-questions.md`. Research: `docs/research/multi-bot-benchmark.md` (Grok Bot, Perplexity Teammates, Cue, OpenClaw, dots, Claude Duet, Muse and others, sourced).

## 1. Intent

Hermit has one chat today, so every job shares one generalist. This design gives Hermit several specialized bots, one chat each, with Hermit as their coordinator. Each bot keeps its own role, notes, permissions and routines. Bots message each other directly, on an in-process bus that follows A2A 1.0, with loop guards in code. The research (`docs/research/multi-bot-benchmark.md`) found the same shape in Grok Bot, Perplexity Teammates, Cue and OpenClaw.

What success looks like: a user opens Hermit and sees their bots like contacts in a messenger. Hermit sits at the top as the coordinator. The user makes a travel bot by asking Hermit; it checks fares for a planned trip every hour on its own, and its findings wait in its chat. The user asks Hermit "¿qué hay de nuevo?" and gets one answer for every bot. Bots hand work to each other without the user relaying it. Nothing any bot does can send, pay or log in without the user's fingerprint.

## 2. Decisions

| Question | Decision (2026-11-25) |
|---|---|
| Q200 How Hermit holds several bots | Bots as contacts, Hermit coordinates: a list home, Hermit starred at the top, pins, each bot its own chat with its own role, instructions, notes, permissions and optional schedule |
| Q201 When | V1, starting now, in two waves: wave 1 bots; wave 2 schedules and bots working together |
| Q202 Wake-ups | On battery too, with guards: at most hourly on battery, as often as every 15 minutes while charging, paused when the battery is low, the phone is warm or battery saver is on |
| Q203 Bot to bot | Bots message each other directly, on an in-process bus that follows A2A 1.0, with loop guards: any bot can message any other, the receiver wakes, handles it and can reply later; group chats of bots; a coordinator that creates bots, hands off work and reports |
| Q204 What bots may do alone | Three permission modes, Ask, Auto and Don't ask, picked by the user for all of Hermit and per bot, each with clear warnings (6.4.1) |
| Q205 Bot results in chats | Results stay out of the chat's memory: cards rendered by code; Hermit reads a result only in the turn the user asks |
| Q206 Payments and logins from bot work | The bot tells, the user asks in their own words; never a card from a bot |

## 3. Goals, non-goals, anti-goals

**Goals**
- G1. Several bots, one main chat each, listed like contacts, with Hermit starred at the top and pins.
- G2. Each bot has its own role and instructions, its own notes, its own permissions and its own routines.
- G3. Grok Bot parity on coordination: the coordinator creates bots, hands off work and reports for all; any bot messages any other; group chats of 2 to 6 bots; handoffs visible in the transcript.
- G4. Bot-to-bot messaging is built on A2A 1.0's model (Agent Card, Task, Message, Part, Artifact), so the same bus later carries other agents (EP-21, V2).
- G5. Routines per bot, asked for in plain words, honest about when they ran and will run, with guards for battery and heat.

**Non-goals for V1**
- Bots in Slack, Teams, X Chat or WhatsApp as surfaces.
- Other people's agents and other people's Hermits (EP-21 stays V2; it reuses this bus).
- A model per bot or a cloud model. There is one model on the phone.
- Bots that run on Boost. Boost is V2; long research moves there when it exists.
- Shared bots and team bots.

**Anti-goals: failure even if it works**
- A bot that pays or logs in because another bot told it to, in any mode; or that sends because another bot told it to, unless the user chose Don't ask for it.
- A bot list that drains the battery or heats the phone in a pocket.
- Bots that loop, answering each other with nothing to say.
- Bots that leak each other's private notes, or a page's text that reaches another bot as an order.
- A redrawn or restyled crab. The crab is Hermit's and stays the traced drawing.
- Model-written text presented as if Hermit's code wrote it, on any card or sheet.

## 4. How Hermit works today (what this touches)

From a read of the code at master `0a9c7b4`:
- **One chat.** `HermitProvider` calls `resumeSession()` once at launch, which returns the newest attended session in the database (`packages/core/src/sessions.ts:84`, `packages/runtime/src/hermit.ts:873`). "Clear conversation" deletes every session (`sessions.ts:96-102`). Sessions have no owner.
- **Global memory.** `notes` holds `fact`, `tainted`, `created_at`, with no session or bot (`packages/core/src/memory.ts:76`); the profile snapshot is the untainted facts, newest first, at most 1,400 characters, rebuilt on every turn (`memory.ts:152`). The latest migration is 16.
- **Global rules.** The cage's rules are built per turn from global settings (`hermit.ts:953`); the per-session inputs are taint, unattended and approved domains. Unattended turns turn every ask into a deny (`packages/cage/src/policy.ts:283`).
- **Taint kinds** are a closed set: web, email, inbound_message, file, notification (`packages/core/src/types.ts:184`). A string passed as `userText` to `runTurn` counts as the user's own words, and the cage uses those words to allow actions (`packages/agent/src/loop.ts:133`).
- **One model, no queue.** Completions are counted, not serialized (`apps/mobile/src/engine-slot.ts:76-89`); every turn uses one prompt-cache key, `"hermit-v1"` (`loop.ts:51`), and the engine drops the named cache when the system prompt changes (`apps/mobile/src/adapters/qvac-engine.ts:93-98`). Two closure variables in `createHermit` (`mcpTurn`, `profileLines`) are rewritten per turn.
- **One approval sheet.** A new request expires the pending one (`packages/runtime/src/approval-bridge.ts:38`).
- **The night shift** runs fixed code jobs (agenda, reminders, messages, mail) in unattended sessions, through a WorkManager periodic job every 15 minutes that requires charging (`apps/mobile/modules/hermit-night/.../NightScheduler.kt:38-45`), with conditions in JS (battery at least 30%, thermal status below 2, screen off). No user-defined jobs exist; US-NIGHT-05 is V2.
- **The phone:** the S26 Ultra runs BotPsy-0.8B Q4_K_M at 37 to 42 tokens a second on screen (5 threads) and on 3 threads in the background; a turn takes 12 to 52 s, mostly reading the prompt.
- **The PRD** puts agent to agent in V2 (PDR-016, EP-21: "every inbound agent message is untrusted and every outbound action asks").

## 5. Approaches considered

1. **Bots as contacts, Hermit coordinates (picked, Q200).** A roster home, one chat per bot, per-bot role, notes, permissions and routines; Hermit is the primary bot. Matches Grok Bot and Perplexity Teammates; the most to build.
2. **One Hermit, many chats.** Claude Duet's channels: topic chats with their own instructions and schedules, one memory, no bot identities. Less to build, the direction OpenAI and Google took by retiring GPTs and Gems; but no specialists with boundaries and nothing to coordinate.
3. **Bots as @skills in one chat.** The smallest change; furthest from Grok Bot.

## 6. The design

### 6.1 Concepts

- **Bot.** A durable specialist: name, look, role (its instructions, written by the user or by Hermit and confirmed by the user), its own notes, its own permissions, its routines, its notification switch. About 50 bots at most, as Grok Bot.
- **Hermit, the primary bot.** Exactly one, starred, always first, can't be deleted. It is today's chat, moved into the roster with its history. It coordinates: it creates bots, hands off work and reports for all. The user can't make another bot primary in V1 (Grok Bot can; we keep Hermit as the front door, it carries the crab and the brand).
- **Chat.** Each bot has one main chat. "New chat" starts a fresh one with the same bot (older chats stay in the bot's list); "Reset conversation" clears its history and keeps notes, routines and settings. Threads inside a chat are out of scope for V1.
- **Group chat.** The user and 2 to 6 bots. The user writes; the bots decide who answers, or the user names one with `@`. Approval requests, login requests and drafts never appear in a group (as Grok Bot); they go to the user's chat with the bot that raised them.
- **Handoff.** A bot sends another bot a message; the receiver wakes, handles it and can reply later. Built as an A2A task (6.3).
- **Routine.** One bot's instruction plus when to run it, asked for in plain words ("cada hora", "todos los días a las 8"). Up to 50 per bot, as Grok Bot.
- **Shared profile.** A few facts about the user that every bot reads: name, language, time zone, and the facts the user marks as shared.

### 6.2 Data (SQLCipher, migration 17 and on)

- `bots`: id, name, look (shape and color), role text, `primary` flag (one row), pin order (null when unpinned), hidden, notify, created_at. Hermit's row is created by the migration.
- `sessions.bot_id` (Hermit's id for every existing session) and `sessions.title`; `latest(botId)` and `clear(botId)` replace the global versions; "Clear conversation" clears one bot.
- `notes.bot_id`, null meaning the shared profile. Existing untainted notes become shared profile facts (they were about the user); existing tainted notes stay Hermit's own. A bot reads its own notes plus the shared profile; tainted facts never enter the shared profile (today's rule, kept).
- `bot_grants`: which skill groups a bot may use (6.4). Hermit's grants are today's global settings.
- `routines`: id, bot_id, instruction, schedule (a parsed rule, plus the plain words shown back), active, last_run, next_run; `routine_runs` keeps the latest 20 per routine (running, done, failed with the reason).
- `a2a_tasks` and `a2a_messages` (6.3).
- Every new table joins the erase list; the signed log records bot ids, task ids and routine ids, never content.

### 6.3 The A2A bus

Hermit's bots talk through an in-process bus that follows A2A 1.0 (https://a2a-protocol.org/latest/specification/, latest released version 1.0.0):
- **Agent Card per bot:** `name`, `description` (its role, short), `skills` (one entry per skill group it holds, with examples), `capabilities` (`streaming: false`, `pushNotifications: true`), `version`. Cards are generated by code from the bot's row and grants; the model never writes a card.
- **SendMessage** from bot A to bot B creates a `Task` with a `contextId` (the conversation chain) and states `TASK_STATE_SUBMITTED`, `TASK_STATE_WORKING`, `TASK_STATE_COMPLETED`, `TASK_STATE_FAILED`, `TASK_STATE_CANCELED`, `TASK_STATE_REJECTED`, `TASK_STATE_INPUT_REQUIRED` (B needs something from A or from the user) and `TASK_STATE_AUTH_REQUIRED` (B needs the user's approval: see 6.4).
- **Messages** carry `parts` (text, and data for structured results); results come back as `Artifact`s; a follow-up names its earlier task in `referenceTaskIds`.
- **Delivery** in-process: a submitted task queues a turn for the receiver (6.6), and its updates post folded events in both bots' chats ("3 messages with Viajes", tap to open), as Grok Bot shows them.
- **Model surface:** two skills, `message_bot` (to a named bot, with the request) and `reply_to_bot` (closing a task with a result). Code validates the target exists, the hop count (6.5) and the budget before anything queues.
- **Later (EP-21, V2):** the same objects over A2A's `HTTP+JSON` or `JSONRPC` binding, with signed Agent Cards (JWS), for Boost and for other people's agents. Nothing in the V1 bus should assume a bot is local beyond the binding.

### 6.4 Trust: Grok Bot's reach, Hermit's rules

Parity in what bots can do together; Hermit's rules on what they can do to the world, under the permission mode the user picks (6.4.1):
- **A bot's words are data.** When bot B handles a message from bot A, A's text enters B's turn as untrusted input with a new taint kind, `bot`, wrapped like a web page. The cage's "in the user's own words" checks (`urlInUserWords`, `queryInUserWords`) never count it. Grok Bot states the same principle for outside content ("Only your own messages count as instructions") but leaves bot messages unstated; Hermit makes it explicit.
- **Work the user didn't start is unattended.** A turn started by a handoff or a routine runs with nobody present. What it may do alone depends on the mode (6.4.1); whatever the mode doesn't allow alone becomes a suggestion card in that bot's chat (and in Hermit's report), approved later with the normal sheet. The card shows only code-written text.
- **Results stay out of the chat's memory (Q205).** A bot's results reach other chats (Hermit's report, a handoff's answer, the briefing) as cards rendered by code, quoted and marked. Hermit reads a result's text only in the turn the user asks about it; that turn is tainted, and afterwards the chat's history keeps a code-written line in place of the text ("Leí el resultado de Viajes de las 10:00"), so the chat itself stays clean for payments and logins. A bot's own posted findings follow the same rule in its own chat: its next wake reads its typed notes, not its raw transcript.
- **Money and logins never start from a bot (Q206).** When a bot's work wants a payment or a login, it posts a code-written note ("Viajes quiere pagar: ábrelo para hacerlo") in its chat and in Hermit's report. The user asks for it in their own words, in a clean turn, through the normal sheet and the fingerprint. This holds in every mode.
- **Each bot is a boundary.** A bot uses only the skill groups it holds: calendar, reminders, notes, messages (read, reply), mail (read, send), web (read, tasks), contacts, apps (open other apps with prefilled intents), vault and logins, wallet and pay. The cage receives the bot's grants with every turn; a skill outside them is denied in code, never offered in the menu. A bot can't grant anything to itself or another bot; grants change only in the bot's settings, and vault, logins, mail send and pay need the fingerprint to grant. Unlike Grok Bot ("Do not use separate Bots as a security boundary"), Hermit's bots are one.
- **Sources.** Each bot lists its sources: sites and connectors it works from (for example, a travel bot: a few travel sites; a running coach: a fitness service's connector). In Ask mode they bound what it reads alone.
- **Creating a bot.** Hermit (or the user's "+") produces a bot proposal: name, look, role, grants, sources, routines, mode. Code renders the card from those fields; the user taps Create (fingerprint if the grants include vault, logins, mail send or pay, or the mode is Don't ask).
- **Groups.** As Grok Bot: no approvals, logins or drafts in a group; only the user's own messages are instructions there.

#### 6.4.1 Permission modes (Q204, PDR-031)

What bots may do alone is set by a permission mode (Q204). Hermit gets three modes, each with clear warnings. The user picks one in Settings for all of Hermit, and may set a different one per bot (a bot inherits the global mode until it has its own).

| | **Preguntar / Ask** (default) | **Auto** | **Sin preguntar / Don't ask** (dangerous) |
|---|---|---|---|
| In a chat the user is in | Today's rules: risky steps ask | Low-risk steps run without asking, even after reading outside text; medium and high risk ask | Everything runs without asking, except money and logins |
| Alone (routine, handoff) | Reads only the bot's own sources (search and pages on its sites, links within them, its connectors); saves notes about them, marked as read from outside; a bot that reads private data alone (messages, mail, calendar, contacts) can't also fetch the web alone; the rest becomes a suggestion | Low-risk steps run anywhere (reads, links, search, notes, reminders and events for the user); as in Ask, a bot can't read private data and use the web in the same unattended run; medium-risk steps (a reply, an email, a change to someone else's data) become suggestions | Everything runs, except money and logins |
| Money and logins | Fingerprint, in the user's own words (Q206) | Same | Same |

- **Risk tiers are code, not the model.** Each skill carries a tier in its definition (low, medium, high); the cage reads the tier, the mode, attended or alone, and taint, and decides. Auto never asks the small model whether something is safe; a reviewer model on a 0.8B is weak and injectable. The builder writes the tier table with the skills; a skill without a tier is high.
- **Search alone.** In Ask and Auto, search alone stays fail-closed in wave 1, since no alone turns exist yet; in wave 2, search alone is allowed when it's scoped to the bot's listed sites. Don't ask runs it, as it runs everything but money and logins.
- **Warnings ("advertencias").** Auto opens a sheet saying, in plain words, what will now run without asking. Don't ask opens a red sheet with the concrete risks ("una página web podría hacer que Hermit envíe mensajes o correos en tu nombre, borre cosas o comparta tus datos"), and needs the fingerprint plus typing "entiendo" (or "I understand", in either language). While a chat or bot runs in Auto or Don't ask, its header shows the mode as a chip (amber, red); the roster shows it on the bot's row.
- **What stays in every mode:** money and the vault need the fingerprint (the Keystore key requires the user's presence; Q206); the signed log records every step; untrusted text stays marked; approval sheets and cards show only code-written text; the loop guards (6.5) and the budgets (7) hold; erase and delete stay the user's.
- **Unchanged for the single chat today:** with no bots and Ask mode, Hermit behaves exactly as it does now.

### 6.5 Loop guards (Hermit's additions to parity)

Grok Bot has "no switch" and once snowballed. Hermit keeps the reach and adds limits in code:
- **One reply per message:** a bot's reply to a handoff can't itself start a new handoff back to the sender in the same chain.
- **Hop cap:** a chain (one `contextId`) stops at 4 handoffs; the fifth is refused with a code-written note to the coordinator.
- **Budget:** each bot has a daily budget of turns started by other bots or routines (default 24); when it runs out, work waits for the next day or the user.
- **Silence over noise:** an empty or near-empty reply ("." or "ok") closes the task without a message.
- **A switch:** Settings has "Bots can message each other", on by default (parity), so the user can turn it off.

### 6.6 One model, one queue

Every bot turn, user turn, handoff and routine run goes through one queue in the runtime:
- Priority: the user's own turn, then a reply the user is waiting for, then handoffs, then routines. A new user turn waits only for the current model call to end (a safe point), never for a whole background turn.
- The prompt cache gets one key per bot (`hermit-v1:<botId>`) so switching bots doesn't drop each other's cache; the builder caps how many caches stay on disk.
- One approval sheet at a time stays: suggestions queue as cards, not sheets, so two bots never fight over the sheet.
- The per-turn closure state in `createHermit` (`mcpTurn`, `profileLines`) becomes per-turn values.

### 6.7 Routines and wake-ups (Q202)

- **Asking:** "revisa los precios cada hora", "todos los días a las 8". Code parses the words into a rule and shows them back under the routine ("Cada hora · próxima 10:00 · última 9:02, sin novedades"). A routine that can't be parsed asks.
- **When it may run:** on battery at most every 60 minutes; while charging as often as every 15 minutes (WorkManager's floor). Paused below 30% battery, at thermal status 2 or more, or in battery saver. Android may hold wakes while the phone sleeps (Doze), so "next run" says "around".
- **Native:** a second unique periodic WorkManager job, `hermit-bots-wake`, every 15 minutes without the charging constraint, next to `hermit-night-wake`; JS decides what is due under the conditions above.
- **One small step per wake:** load the model if needed (3 threads in the background), run one bot turn with a step budget (at most 3 model calls, about 90 s), save progress to the bot's notes, and post in the bot's chat only when something changed. A travel bot advances a little each hour; deep research across many sites waits for Boost (V2).
- **Run history:** the latest 20 runs per routine, with Running, Done, Failed and the reason.
- **Idle routines:** a bot the user hasn't opened in 7 days gets asked (in Hermit's report) whether to keep its routines; with no answer in 3 more days they pause. Grok Bot does the same after a long time away.
- **Battery:** before the default ships, measure one hourly bot for a day on the S26 (estimate 5 to 10%); Settings shows model time and battery use per bot.

### 6.8 Hermit as coordinator

- **Creates bots** when asked, or offers one when the same kind of request keeps coming back with its own sources or schedule (Grok Bot's advice); always a proposal card the user confirms.
- **Hands off work** with `message_bot`, and shows the handoff folded in its chat.
- **Reports for all:** "¿qué hay de nuevo?" answers from each bot's latest results and pending suggestions, built by code from the bots' run records plus one model summary; the morning briefing (night shift) gains a section per bot with news.
- **Doesn't administer:** like Grok Bot's primary bot, it can't edit another bot's notes, grants or routines; it asks that bot, in a handoff, and the user confirms anything that needs it.

### 6.9 Screens

```
Hermit                                     ⌕  ＋
★ Hermit          2 bots trabajando · ahora
📌 Viajes         Bajó el vuelo a Cusco · 10:00        (2)
   Entrenador     Necesita tu OK · 9:30                 !
   Recetas
   Grupo: Vacaciones (3)   Viajes: listo el itinerario · ayer
```

- **HM-BOT-01 Roster (the new home):** Hermit starred first, then pinned bots, then the rest by latest activity, then group chats. Each row: avatar, name, a status line (needs your OK, new result, working, typing), time, unread badge. Long press: pin, hide, mark read, notifications. Search bots and chats. Hidden bots keep working under "Ocultos".
- **HM-BOT-02 Bot chat:** today's chat screen, for one bot: its name and avatar in the header, folded events for handoffs and routine runs, suggestion cards for work it couldn't do alone, the composer as today (Stop, Seguir).
- **HM-BOT-03 New bot:** from Hermit's proposal card or from "＋": name, look, role, permissions (plain words), routines. Templates for common roles.
- **HM-BOT-04 Bot settings:** role, look, permissions, routines (each with an Active switch and run history), notes (view, delete, mark shared), notifications, pin, hide, duplicate (without history or notes), reset conversation, delete (erases its chats, notes and routines; can't be undone).
- **HM-BOT-05 Group chat:** members' avatars in the header, `@` to name a bot, no cards in the group.
- **Looks:** Hermit keeps the crab (logo lock). Other bots wear shells: simple shell shapes in the brand palette with eyes, chosen at creation, drawn by the brand pipeline (never an image model). A hermit crab changes shells; a bot is a shell Hermit wears.

### 6.10 Grok Bot parity checklist

| Grok Bot | Hermit V1 |
|---|---|
| About 50 bots, one main chat each, fresh chats | Wave 1 |
| Starred primary bot that coordinates | Wave 1 (Hermit, fixed) |
| Pins, hide, search, sections | Pins, hide and search wave 1; sections after wave 2 |
| Create from a message, templates, duplicate, share as template | Create, templates, duplicate wave 1; share a template file after wave 2 |
| Per-bot memory plus shared facts | Wave 1 |
| Reset conversation, delete | Wave 1 |
| Bot to bot messages, async, visible handoffs | Wave 2 (A2A bus) |
| Group chats of 2 to 6 | Wave 2 |
| Routines in plain words, run history, Test | Wave 2 |
| Event triggers (an email, a message, a webhook) | After wave 2: Hermit's notification listener and mail as triggers |
| Check-ins and offers to take work | Wave 2, in Hermit's report and the morning briefing |
| Approvals from unattended work expire; drafts for email you didn't start | Wave 2, as suggestion cards (kept until acted on) |
| Usage by bot | Model time and battery by bot, wave 2 |
| A shared cloud computer, account-wide tools | Not copied: grants per bot, on the phone |
| Slack, Teams, X Chat surfaces | Not in V1 |
| No switch for bot-to-bot | Hermit adds one, on by default |

### 6.11 Two waves

**Wave 1, bots:** data and migration (6.2); per-bot sessions, notes, grants and sources through the runtime and the cage; permission modes with the risk tiers, the warnings and the mode chips (6.4.1); the prompt with the bot's role and one cache key per bot; the run queue (6.6); HM-BOT-01 to 04; creating a bot from Hermit's proposal and from "＋"; pins, hide, search, duplicate, reset, delete; Hermit's history moved into its bot. Eval: role following and grant refusals per bot; each mode's decisions over the tier table, attended and alone; on the Mac lab and the phone.

**Wave 2, bots work together:** the A2A bus with `message_bot` and `reply_to_bot`, the `bot` taint kind, loop guards and the switch; results as cards that stay out of the chat's memory (Q205) and the money-and-login notes (Q206); group chats (HM-BOT-05); routines with the parser, `hermit-bots-wake`, the guards and run history; Hermit's report and the briefing section; model time and battery per bot. Eval: handoff correctness, injection through a bot's message (a page read by one bot telling another to pay must end as a suggestion at most), loop cases, one routine step on the phone; the battery measurement.

### 6.12 Documents that change

- PRD: PDR-029 (multi-bot, Q200 to Q202), PDR-030 (the A2A bus and its trust rules, Q203, Q205, Q206), PDR-031 (permission modes, Q204; FR-CAGE changes for tiers and modes), PDR-016 amended (bots and their handoffs in V1; other people's agents stay V2 under EP-21, on this bus), a new epic EP-28 Bots (EP-23 is Family sharing and confidential cloud; IDs are stable) with user stories and FR-BOT requirements, US-NIGHT-05 superseded by routines.
- States spec: HM-BOT-01 to 05 and their edge cases.
- `docs/build/open-questions.md`: anything the builder can't settle.

## 7. Builder check (2026-11-25)

A plan written from this document listed what it couldn't settle. Three needed a product decision, now Q204 to Q206 in 6.4 and 6.4.1 (permission modes; results stay out of the chat's memory; money and logins never start from a bot). The rest are design calls:

- **A routine's instruction as the user's words.** It counts as the user's own words for the cage's checks (addresses, search words, names) when the user typed it, or when it was drafted in an untainted turn and the user confirmed it on the code-rendered card. Drafted in a tainted turn, it is marked untrusted: the routine runs, but its words unlock nothing.
- **Who answers in a group.** The bots named with `@` answer. With no `@`, one routing step picks a single bot; at most 2 bots answer one message. In a group only the user's messages start answers: a bot's message in a group never makes another bot answer, so groups can't loop. On the phone each answer is a separate 12 to 52 s turn.
- **Budgets.** Handoffs and routines have separate budgets: each bot takes at most 24 turns a day started by other bots; routines are bounded by their own schedules. Across all bots, background model time on battery is capped at 45 minutes a day; while charging there is no daily cap beyond the heat guard. When a wake runs out of time, handoffs go before routines, and among routines the one that has waited longest goes first.
- **The battery pass mark.** One hourly bot on battery for 24 hours on the S26 must use at most 8% of the battery. If it uses more, the battery default becomes every 2 hours, and Settings shows the measured number.

## 8. Left to the builder

The exact schema and migration steps; the schedule parser and its wording in es-419 and en; how many prompt caches stay on disk; the shell shapes and colors (through the brand pipeline); the template list; the copy for every card and status line; the eval cases, written to the harness lab's rules (synthetic names only).
