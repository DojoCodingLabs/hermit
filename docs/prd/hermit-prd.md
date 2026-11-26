# Hermit Platform: Product Requirements Document (PRD)

| Field | Value |
| :---- | :---- |
| Product working name | Hermit: an open-source personal AI agent that lives on your phone. Does everything. Tells no one. |
| Client / Organization | Dojo Coding venture (internal product) |
| Delivery partner | Dojo Coding (B2B software factory) |
| Document type | Foundational PRD. The atomic primitive that seeds Linear, the on-device schema, the screens, and all agent work |
| Status | v1.3, adds Tether's BotPsy-0.8B as the lead model candidate (`docs/research/botpsy.md`). v1.2, adds the open-source code research (`docs/research/oss-connectors.md`, `oss-computer-use.md`, `oss-phone-use.md`) and decisions Q26 and Q27. v1.1, amended for feature parity with the cloud agents (decisions Q19 to Q25: email, web tasks, connectors, voice notes, Google sign-in, relays, drafted connectors; research `docs/research/connectors.md`). v1.0 seeded from: an early product brainstorm (not published), the architecture spec `docs/superpowers/specs/2026-11-08-hermit-architecture-design.md`, seven research reports in `docs/research/`, decisions Q1 to Q18 in `docs/build/open-questions.md`, the brand book, and the merged code of PRs 1 to 3) |
| Stack | Expo SDK 58 (React Native 0.88) Android app; Tether QVAC for on-device inference; op-sqlite with SQLCipher and FTS5; a pnpm monorepo of pure TypeScript packages (`core`, `cage`, `skills`, `agent`, `eval`, `sql-node`). From the house stack, Next.js on Vercel serves only a static public site (ADR-012). Supabase is not used: Hermit has no servers by design (ADR-009) |
| Execution model | Agentic-first. Built by coding agents (Claude Code with Opus 5.5, and OpenAI Codex) with maximum safe parallelization, in waves of vertical slices from a first win to the complete V1. See Part 3 |
| Method | v2: exhaustive map, dosed delivery |
| Scope of this document | Defines V1, its first win and its waves, and sequences later versions. No timelines or time estimates anywhere by design |

## How to read this document (and why it is shaped this way)

This PRD is written to be consumed by both humans and coding agents. Every requirement is atomic and addressable by a stable ID so it can become a Linear issue, a branch, a commit scope, and a screen at once. The structure follows a fixed order: user stories first, then the full set of standard PRD sections, then the agentic delivery model that governs how the work is executed.

It contains no timelines, no estimates, and no story points. Sequencing is expressed only as release bands and as dependency and blocker links. Time is deliberately out of scope. Durations that appear are product rules (an approval that expires, a reminder that fires), never effort.

It is exhaustive on purpose: it is the map, so no one has to guess what the product should do. It is not built all at once. Part 3 doses it: a first win, then waves of vertical slices toward the complete V1, and each slice is built from the exact text of the map that it cites.

Hermit differs from a typical Dojo platform in one structural way: there is no backend. The phone is the whole product. Where the method speaks of RLS as the security boundary, Hermit's boundary is the cage (the deny-wins policy engine, the approvals bound to exact arguments, and the signed log), enforced in code and asserted by tests. Where the method speaks of staging, Hermit's staging is the dev build on the reference device (Galaxy S26 Ultra) plus the eval harness on a Mac.

## ID conventions, area codes, priority and release bands

### ID conventions

| Prefix | Meaning | Example |
| :---- | :---- | :---- |
| `EP-NN` | Epic | EP-05 |
| `US-<AREA>-NN` | User story | US-MSG-02 |
| `HM-<AREA>-NN` | Screen ID (every screen carries one, for change control) | HM-APPR-01 |
| `FR-<AREA>-NN` | Functional requirement (system contract) | FR-CAGE-01 |
| `NFR-NN` | Non-functional requirement | NFR-01 |
| `ENT-<Name>` | Domain entity (on-device) | ENT-AuditEntry |
| `ADR-NNN` | Architectural Decision Record | ADR-005 |
| `PDR-NNN` | Product Decision Record | PDR-002 |
| `EVT-<AREA>-NN` | Local event (never transmitted) | EVT-APPR-01 |
| `ASM-NN`, `DEP-NN`, `RSK-NN`, `OQ-NN` | Assumption (and verified fact), dependency, risk, open question | ASM-01 |
| `CT-NN` | Cross-cutting contract | CT-06 |
| `W0` to `W6` | Wave of V1 delivery: W0 preflight and contracts, W1 the first win, then the widening waves | W1 |
| `B1`, `B2` | Multi-bot wave: B1 bots, their chats, notes, permissions and modes; B2 handoffs, routines and group chats (PDR-029) | B1 |
| `SL-NN` | Slice: the vertical unit that becomes one Linear issue (Part 3) | SL-08 |

`HM` is the screen prefix (Hermit). Screens of later bands carry "(V2)" or "(V3)" in their names.

### Area codes

- Phone app, user surfaces: `ONB` (setup), `CHAT` (talk), `MEM` (memory), `REM` (reminders), `CAL` (calendar), `MSG` (messages), `APPR` (approvals), `ACT` (activity and the signed log), `VOICE`, `WEB` (web reading and web tasks), `MAIL` (email), `CONN` (connectors), `APP` (opening other apps), `PHONE` (phone use), `NIGHT` (night shift), `VAULT`, `FORM` (forms and logins), `PAY` (wallet and payments), `MOVE` (changing phones), `SET` (settings), `BOT` (bots).
- Platform and cross-cutting: `CAGE` (policy engine), `LOOP` (the agent turn loop), `MODEL` (inference runtime and eval), `PRIV` (privacy enforcement), `PLAT` (builds and distribution), `I18N`, `SITE` (public website).
- Later bands: `BOOST`, `TRAIN`, `IOS`, `A2A`, `WATCH`, `MAC`, `FAM`, `CLOUD`.

### Priority key

MoSCoW: `M` must have, `S` should have, `C` could have. Priority and release band are independent: a story can be `M` within V2.

### Release bands

| Band | Meaning |
| :---- | :---- |
| V1 | The full phone-only agent: the first win, then ears and eyes, then hands (PDR-007) |
| V2 | Boost (a bigger shell), fine-tuned Hermit models, iOS, agents of other people on the same bus, and the deepening of V1 features (PDR-016) |
| V3 | Keep watch, Mac powers, family sharing, and the confidential-cloud Boost (PDR-016) |

Waves sequence V1 only. Every V1 story carries the wave that delivers it (`W1` for the first win, then `W2` onward); stories in later bands carry no wave. W0 holds preflight and contracts, not user stories.

---

# PART 1: USER STORIES

Stories are grouped by epic. Each states role, capability and benefit with testable acceptance criteria, MoSCoW priority, release band, the screens it touches and notable dependencies. Stories tagged V2 or V3 are written now so the map is complete and the V1 on-device data model is shaped not to block them, but only V1 stories are in the first build. The roles are the phone's owner (the user, first of all an internal tester on the reference Galaxy S26 Ultra), the people who write to the user (contacts, whose text is untrusted), and the system acting in the background (the night shift).

| Epic | Title | Primary surface |
| :---- | :---- | :---- |
| EP-01 | Setup and onboarding | Phone app |
| EP-02 | Conversation | Phone app |
| EP-03 | Memory | Phone app |
| EP-04 | Reminders and calendar | Phone app |
| EP-05 | Messages (WhatsApp) | Phone app |
| EP-06 | Approvals and the cage | Phone app |
| EP-07 | Activity and the signed log | Phone app |
| EP-08 | Voice notes and voice | Phone app |
| EP-09 | Web reading and web tasks | Phone app |
| EP-10 | Night shift | Phone app |
| EP-11 | Vault, forms and logins | Phone app |
| EP-12 | Wallet and payments | Phone app |
| EP-13 | Changing phones | Phone app |
| EP-14 | Settings, privacy and accessibility | Phone app |
| EP-15 | Model runtime and eval | Platform |
| EP-16 | Builds and distribution | Platform |
| EP-17 | Public website | Web |
| EP-18 | Boost: a bigger shell | Phone app and desktop (V2) |
| EP-19 | Learn my style (fine-tuning) | Phone app (V2) |
| EP-20 | iOS | Phone app (V2) |
| EP-21 | Agent to agent | Phone app (V2) |
| EP-22 | Keep watch and Mac powers | Desktop (V3) |
| EP-23 | Family sharing and confidential cloud | Phone app and cloud (V3) |
| EP-24 | Email | Phone app |
| EP-25 | Connectors | Phone app |
| EP-26 | Open other apps | Phone app |
| EP-27 | Phone use (sideload build) | Phone app (V2) |
| EP-28 | Bots | Phone app |

---

## EP-01: Setup and onboarding

Goal: get from install to a working, private agent on the phone with the fewest steps, downloading the model once and asking only for the permissions the first win needs (ADR-002, ADR-008, ADR-013, PDR-001, PDR-002).

### US-ONB-01: See the promise on first launch
- **As a** new user, **I want** a first screen that says plainly what Hermit is and what never leaves my phone, **so that** I trust it before granting anything.
- **Priority:** M · **Release:** V1 · **Wave:** W1 · **Screens:** HM-ONB-01
- **Acceptance criteria:**
  - Given a fresh install, when Hermit opens, then HM-ONB-01 shows the mascot, the line "Your agent lives here.", the three promises (private by design, works offline, you approve every send) and one "Get started" action.
  - The screen makes no network request and stores nothing except the fact that it was seen.
  - Copy comes from the locale files (CT-10); the screen renders in es-419 or English following the phone's language (ADR-013).

### US-ONB-02: Choose the app language
- **As a** user, **I want** to switch Hermit between Spanish and English, **so that** I can use the language I think in.
- **Priority:** S · **Release:** V1 · **Wave:** W3 · **Screens:** HM-ONB-02, HM-SET-05
- **Acceptance criteria:**
  - Hermit follows the phone's language by default (es-419 for any Spanish locale, English otherwise).
  - The user can override it in setup (HM-ONB-02) or later in settings (HM-SET-05); the change applies without reinstalling.
  - The model is told the user's language, and replies default to it unless the user writes in the other language.

### US-ONB-03: Download the model once, verified
- **As a** user, **I want** Hermit to download its model once over Wi-Fi and check it, **so that** the brain on my phone is the genuine file and nothing else is fetched later.
- **Priority:** M · **Release:** V1 · **Wave:** W1 · **Screens:** HM-ONB-03
- **Acceptance criteria:**
  - HM-ONB-03 states the file size and that the download goes to Hugging Face over HTTPS, once (ADR-008).
  - By default the download starts only on Wi-Fi; the user can explicitly allow mobile data.
  - Given the file is downloaded, when its SHA-256 does not match the pinned value, then Hermit deletes it, shows the "file failed its check" state, and offers retry (FR-MODEL-02).
  - Progress is shown as a percentage; the user can leave the screen and the download continues in the foreground service.
  - The model file is stored outside any backed-up folder.

### US-ONB-04: Grant notification access with a guided walkthrough
- **As a** user, **I want** clear steps to give Hermit access to my WhatsApp notifications, **so that** it can read and reply to my messages.
- **Priority:** M · **Release:** V1 · **Wave:** W1 · **Screens:** HM-ONB-04
- **Acceptance criteria:**
  - HM-ONB-04 explains why the access is needed and that replies always ask first (PDR-002, FR-CAGE-03).
  - Given a sideloaded install, when Android blocks the setting, then the walkthrough shows how to tap "Allow restricted settings" in App info and returns to the access screen (ASM-05).
  - When access is granted, the screen confirms it; when it is not, the user can continue and enable it later (US-ONB-08).

### US-ONB-05: Grant calendar access
- **As a** user, **I want** to let Hermit read and add events in my calendar, **so that** it can answer "what do I have tomorrow" and schedule things.
- **Priority:** M · **Release:** V1 · **Wave:** W1 · **Screens:** HM-ONB-04
- **Acceptance criteria:**
  - Calendar access is requested with the system dialog after a one-line explanation, including the honest exception that events sync wherever the user's calendar already syncs (PDR-004).
  - Denying access disables the calendar skills (`calendar_read`, `calendar_add`) without breaking chat; the model is not offered skills that cannot run.

### US-ONB-06: Learn early if the phone can run Hermit
- **As a** user on an unsupported phone, **I want** to be told before downloading anything, **so that** I don't waste data on something that won't work.
- **Priority:** S · **Release:** V1 · **Wave:** W6 · **Screens:** HM-ONB-05
- **Acceptance criteria:**
  - Before the model download, Hermit checks the architecture (arm64), Android version and memory against the supported floor (NFR-05).
  - Phones below the floor see HM-ONB-05 with the reason in plain words and no download.
  - Phones known to be forced onto CPU by QVAC (for example Google Pixel) are told replies will be slow, and may continue.

### US-ONB-07: Recover from a failed download
- **As a** user, **I want** a failed or interrupted download to be clearly explained and retryable, **so that** setup never leaves me stuck.
- **Priority:** M · **Release:** V1 · **Wave:** W2 · **Screens:** HM-ONB-03
- **Acceptance criteria:**
  - Network loss, low storage and checksum failure each have their own message and action (retry, free space, try Wi-Fi).
  - Given low storage, when the free space is below the model size plus a margin, then the download does not start.
  - A retry restarts the download cleanly; partial files are removed.

### US-ONB-08: Use Hermit with fewer permissions
- **As a** cautious user, **I want** to skip optional permissions and still chat and remember, **so that** I can try Hermit before trusting it with my messages.
- **Priority:** S · **Release:** V1 · **Wave:** W3 · **Screens:** HM-ONB-04, HM-SET-01
- **Acceptance criteria:**
  - Every permission screen has "Not now"; chat and memory work with none granted.
  - Settings (HM-SET-01) lists each permission with its state and a way to grant it later.
  - When the user asks for something that needs a missing permission, Hermit explains which one and links to grant it.

---

## EP-02: Conversation

Goal: talk to an agent whose model runs entirely on the phone, in airplane mode, that picks from a menu of typed skills instead of driving a computer (ADR-003, ADR-004, ADR-005, PDR-002, PDR-003).

### US-CHAT-01: Chat with Hermit offline
- **As a** user, **I want** to chat with Hermit with no internet at all, **so that** my agent works anywhere and nothing I type leaves the phone.
- **Priority:** M · **Release:** V1 · **Wave:** W1 · **Screens:** HM-CHAT-01
- **Acceptance criteria:**
  - Given airplane mode, when the user sends a message, then Hermit replies using the on-device model (ADR-003).
  - Each turn runs the loop of FR-LOOP-01 to FR-LOOP-06: at most 4 skill calls and 3 repair attempts.
  - The reply streams into the bubble as it is generated (US-CHAT-03).
  - No network request occurs during a turn unless a skill that needs the network runs and the cage allows it.

### US-CHAT-02: See where Hermit is thinking
- **As a** user, **I want** to see that Hermit is running on this phone, **so that** the privacy promise is visible, not assumed.
- **Priority:** M · **Release:** V1 · **Wave:** W1 · **Screens:** HM-CHAT-01, HM-CHAT-02
- **Acceptance criteria:**
  - The header chip reads "On this phone", or "Airplane mode · on-device" when the radio is off.
  - Tapping the chip opens HM-CHAT-02: model name, where it runs, and the last turn's speed (EVT-MODEL-01).

### US-CHAT-03: Watch replies stream in
- **As a** user, **I want** replies to appear word by word, **so that** I am not staring at a blank screen while the phone thinks.
- **Priority:** M · **Release:** V1 · **Wave:** W1 · **Screens:** HM-CHAT-01
- **Acceptance criteria:**
  - While a skill is being picked or filled, the bubble shows the thinking state (the mascot's thinking pose plus text).
  - When the model responds, tokens stream into the bubble; the input stays disabled until the turn ends or is stopped (US-CHAT-06).

### US-CHAT-04: Answer Hermit's clarifying question
- **As a** user, **I want** Hermit to ask when my request is ambiguous, **so that** it doesn't guess wrong.
- **Priority:** M · **Release:** V1 · **Wave:** W1 · **Screens:** HM-CHAT-01
- **Acceptance criteria:**
  - When the model picks `ask_user`, the turn ends with a question bubble (FR-LOOP-01) and no skill runs.
  - The user's answer starts a new turn with the full history.

### US-CHAT-05: Understand a turn that failed
- **As a** user, **I want** a plain explanation when Hermit couldn't finish, **so that** I know whether to rephrase or try again.
- **Priority:** M · **Release:** V1 · **Wave:** W1 · **Screens:** HM-CHAT-01
- **Acceptance criteria:**
  - Each terminal error of FR-LOOP-05 (`repair_failed`, `max_steps`, `model_error`) maps to its own message in CT-04, with a retry action.
  - Errors never show stack traces, raw model output or hashes.

### US-CHAT-06: Stop a turn
- **As a** user, **I want** to stop Hermit mid-turn, **so that** I can cancel a wrong request before anything happens.
- **Priority:** S · **Release:** V1 · **Wave:** W2 · **Screens:** HM-CHAT-01
- **Acceptance criteria:**
  - A stop control replaces send while a turn runs.
  - Stopping aborts generation, closes any open approval as denied, and records nothing as executed.
  - A skill already executing finishes or fails atomically; partial effects are never left behind (FR-LOOP-06).

### US-CHAT-07: Keep and clear conversation history
- **As a** user, **I want** my conversation kept encrypted on the phone and clearable, **so that** I can pick up where I left off or start fresh.
- **Priority:** S · **Release:** V1 · **Wave:** W3 · **Screens:** HM-CHAT-01, HM-SET-01
- **Acceptance criteria:**
  - Conversation history is stored in the encrypted database (ADR-006) and survives restarts.
  - "Clear conversation" removes the history; memories and the signed log are unaffected.
  - Long histories are compacted before they exceed the model's context (FR-LOOP-07).

### US-CHAT-08: See Hermit's state through the mascot, or hide it
- **As a** user, **I want** the crab to show what Hermit is doing, and to turn it off if I prefer, **so that** state is glanceable without being childish.
- **Priority:** C · **Release:** V1 · **Wave:** W3 · **Screens:** HM-CHAT-01, HM-SET-06
- **Acceptance criteria:**
  - The chat shows the mascot pose matching the state (idle, thinking, working, asking, done, error, blocked, offline), always next to text that says the same.
  - Quiet mode (HM-SET-06) hides the mascot everywhere; text remains.
  - The mascot comes only from the rig assets (`docs/brand/mascot/`), never regenerated.

### US-CHAT-09: Share content into Hermit from other apps
- **As a** user, **I want** to share a link, text or image into Hermit from any app, **so that** I can ask about it without copying.
- **Priority:** S · **Release:** V2 · **Screens:** HM-CHAT-03
- **Acceptance criteria:**
  - Deferred to V2 (PDR-016). The message model already carries an `untrusted` flag so shared content is tainted on arrival (FR-CAGE-04).

---

## EP-03: Memory

Goal: Hermit remembers what the user asks it to, recalls it later, forgets on command, and never lets text other people wrote become trusted memory (ADR-006, PDR-002, FR-MEM-01 to FR-MEM-06).

### US-MEM-01: Ask Hermit to remember something
- **As a** user, **I want** to say "remember my passport expires in March", **so that** I don't have to keep it in my head.
- **Priority:** M · **Release:** V1 · **Wave:** W1 · **Screens:** HM-CHAT-01
- **Acceptance criteria:**
  - The `remember` skill stores the fact (at most 500 characters) in the encrypted database and replies "Saved." (FR-MEM-01).
  - The fact records its provenance: tainted when the session has read untrusted content (FR-MEM-02); a write without provenance is refused.
  - In an untainted session the write runs without approval; in a tainted one it asks first (FR-CAGE-05).

### US-MEM-02: Ask Hermit what it remembers
- **As a** user, **I want** to ask "when does my passport expire?", **so that** Hermit answers from what I told it.
- **Priority:** M · **Release:** V1 · **Wave:** W1 · **Screens:** HM-CHAT-01
- **Acceptance criteria:**
  - The `recall` skill searches with accent and case folding (FR-MEM-03); "mama" finds "mamá".
  - If nothing matches, the reply says so instead of inventing an answer.
  - If a returned fact is tainted, the session becomes tainted (FR-MEM-04).

### US-MEM-03: Ask Hermit to forget
- **As a** user, **I want** to say "forget my passport", **so that** the fact is gone from my phone.
- **Priority:** M · **Release:** V1 · **Wave:** W1 · **Screens:** HM-CHAT-01
- **Acceptance criteria:**
  - The `forget` skill deletes every note matching all words of the query and reports the count (FR-MEM-05).
  - Deleted notes are removed from the search index in the same transaction.
  - The signed log records that a forget ran, never what was forgotten (FR-ACT-02).

### US-MEM-04: Browse and delete memories
- **As a** user, **I want** a list of everything Hermit remembers, **so that** I can review and delete items myself.
- **Priority:** S · **Release:** V1 · **Wave:** W3 · **Screens:** HM-MEM-01, HM-MEM-02
- **Acceptance criteria:**
  - HM-MEM-01 lists facts newest first, marks tainted ones with "From a message" and supports search.
  - HM-MEM-02 shows the fact, when it was saved and its provenance, with Delete.
  - Deleting from the list is the same operation as `forget` for one note.

### US-MEM-05: Keep text from others out of trusted memory
- **As a** user, **I want** facts that came from other people's messages marked and kept out of Hermit's standing context, **so that** a message can't plant instructions in my agent.
- **Priority:** M · **Release:** V1 · **Wave:** W1 · **Screens:** HM-CHAT-01
- **Acceptance criteria:**
  - The profile snapshot loaded at session start contains only untainted facts, newest first, up to 1,400 characters (FR-MEM-06).
  - Tainted facts are reachable only through `recall`, which taints the session.

### US-MEM-06: Get asked to be specific when forgetting too much
- **As a** user, **I want** Hermit to refuse a vague forget that would delete many notes, **so that** one loose phrase can't wipe my memory.
- **Priority:** M · **Release:** V1 · **Wave:** W1 · **Screens:** HM-CHAT-01
- **Acceptance criteria:**
  - Given more than 5 notes match a forget, when the skill runs, then nothing is deleted and the reply asks which one (FR-MEM-05).

### US-MEM-07: Recall by meaning, not only words
- **As a** user, **I want** Hermit to find "my mom's birthday" when I saved "Mamá cumple el 3 de mayo", **so that** I don't have to remember my exact words.
- **Priority:** S · **Release:** V2 · **Screens:** HM-CHAT-01
- **Acceptance criteria:**
  - Deferred to V2 (PDR-016). The database already ships the vector extension, and `ENT-Note` reserves an embedding column so this is additive.

### US-MEM-08: Export my memories as text
- **As a** user, **I want** to export my memories to a file, **so that** I own a readable copy.
- **Priority:** C · **Release:** V2 · **Screens:** HM-MEM-01
- **Acceptance criteria:**
  - Deferred to V2. Exports never leave the phone unless the user shares the file.

---

## EP-04: Reminders and calendar

Goal: schedule reminders that fire offline and read and add calendar events in the user's own calendar (PDR-002, PDR-004).

### US-REM-01: Set a reminder by asking
- **As a** user, **I want** to say "remind me to call Mom at 9", **so that** I get nudged at the right time.
- **Priority:** M · **Release:** V1 · **Wave:** W1 · **Screens:** HM-CHAT-01, HM-REM-02
- **Acceptance criteria:**
  - The `remind` skill takes `text` and an ISO-8601 `at`; a time in the past is refused with a clarifying question.
  - Relative times ("in 2 hours", "tomorrow at 9") are resolved against the phone's local time zone (CT-02).
  - The reply confirms the exact local time, and a system row shows "Reminder set · 9:00 PM".

### US-REM-02: Get reminded even offline
- **As a** user, **I want** reminders to fire with no network and the app closed, **so that** I can rely on them.
- **Priority:** M · **Release:** V1 · **Wave:** W1 · **Screens:** HM-REM-02
- **Acceptance criteria:**
  - Reminders are scheduled as local notifications (FR-REM-01) and fire in airplane mode after a restart of the phone.
  - Tapping the notification opens Hermit on the related conversation.

### US-REM-03: See and cancel my reminders
- **As a** user, **I want** a list of upcoming reminders, **so that** I can cancel or check them.
- **Priority:** S · **Release:** V1 · **Wave:** W3 · **Screens:** HM-REM-01
- **Acceptance criteria:**
  - HM-REM-01 lists pending reminders in time order with cancel.
  - Asking "cancel my 9 o'clock reminder" does the same through chat.

### US-REM-04: Snooze or complete from the notification
- **As a** user, **I want** snooze and done buttons on the reminder, **so that** I don't have to open the app.
- **Priority:** S · **Release:** V2 · **Screens:** HM-REM-02
- **Acceptance criteria:**
  - Deferred to V2. `ENT-Reminder` already has a `state` field (`pending`, `fired`, `done`, `cancelled`) so snoozing is additive.

### US-CAL-01: Ask what's on my calendar
- **As a** user, **I want** to ask "what do I have tomorrow?", **so that** I get my day in one answer.
- **Priority:** M · **Release:** V1 · **Wave:** W1 · **Screens:** HM-CHAT-01, HM-CAL-01
- **Acceptance criteria:**
  - The `calendar_read` skill reads events in a date range from the calendars the user granted.
  - Event titles and descriptions written by others (invitations) taint the session (FR-CAGE-04).
  - The answer can show an agenda card (HM-CAL-01) under the reply.

### US-CAL-02: Add an event by asking
- **As a** user, **I want** to say "put the dentist on Friday from 10 to 11", **so that** it lands in my real calendar.
- **Priority:** M · **Release:** V1 · **Wave:** W1 · **Screens:** HM-CHAT-01
- **Acceptance criteria:**
  - The `calendar_add` skill writes to the user's default calendar (PDR-004), or the one chosen in US-CAL-03.
  - The first calendar write explains once that events sync wherever the user's calendar syncs.

### US-CAL-03: Choose which calendar Hermit uses
- **As a** user, **I want** to pick the calendar Hermit writes to, **so that** work and personal stay separate.
- **Priority:** S · **Release:** V1 · **Wave:** W3 · **Screens:** HM-CAL-02
- **Acceptance criteria:**
  - HM-CAL-02 lists the phone's calendars and stores the choice in `ENT-Setting`.

### US-CAL-04: Move or cancel an event
- **As a** user, **I want** to move or cancel events by asking, **so that** my calendar stays current.
- **Priority:** S · **Release:** V2 · **Screens:** HM-CHAT-01
- **Acceptance criteria:**
  - Deferred to V2 (PDR-016). Editing others' events is a `send`-risk action because attendees are notified.

---

## EP-05: Messages (WhatsApp)

Goal: read incoming WhatsApp messages through notifications and reply in the conversation, always with the exact text and the real recipient approved first (ADR-005, ADR-007, PDR-002, ASM-04, ASM-05).

### US-MSG-01: Ask what my messages say
- **As a** user, **I want** to ask "did Ana text me?", **so that** Hermit reads my recent WhatsApp messages for me.
- **Priority:** M · **Release:** V1 · **Wave:** W1 · **Screens:** HM-CHAT-01, HM-MSG-01
- **Acceptance criteria:**
  - The `read_messages` skill returns messages captured from WhatsApp and WhatsApp Business notifications, optionally filtered by sender (FR-MSG-01).
  - Message text is wrapped as untrusted and taints the session (FR-CAGE-04).
  - HM-MSG-01 lists captured conversations with the latest message and time.

### US-MSG-02: Reply to a conversation, approved
- **As a** user, **I want** to say "tell Ana I'm 10 minutes late" and approve the exact message, **so that** Hermit replies for me without ever sending something I didn't see.
- **Priority:** M · **Release:** V1 · **Wave:** W1 · **Screens:** HM-CHAT-01, HM-APPR-01
- **Acceptance criteria:**
  - The `reply_message` skill takes a `conversationId` and `text`; the recipient shown on the approval sheet is resolved from captured conversation data, never written by the model (FR-MSG-03).
  - The cage always asks for a send, with a fingerprint (FR-CAGE-02); the reply is handed to the live WhatsApp notification only after an approval bound to the exact arguments (FR-CAGE-03).
  - The signed log records the send by hash, never the text.

### US-MSG-03: Know when a reply can't be sent anymore
- **As a** user, **I want** to be told when the conversation's notification is gone, **so that** I don't think a message was sent when it wasn't.
- **Priority:** M · **Release:** V1 · **Wave:** W1 · **Screens:** HM-CHAT-01
- **Acceptance criteria:**
  - Given the notification was dismissed or replaced, when the reply runs, then it returns `stale`, nothing is sent, and the chat explains it and offers to open WhatsApp (FR-MSG-04).

### US-MSG-04: Get a summary of unread chats
- **As a** user, **I want** to ask "what did I miss?", **so that** I get one summary across conversations.
- **Priority:** S · **Release:** V1 · **Wave:** W2 · **Screens:** HM-CHAT-01
- **Acceptance criteria:**
  - Hermit summarizes captured messages grouped by conversation, through the quarantined reader (FR-WEB-03 applies to messages too).
  - The summary never proposes a send without the normal approval.

### US-MSG-05: Don't lose messages while the app is closed
- **As a** user, **I want** messages that arrive while Hermit is closed to be there when I ask, **so that** nothing is missed.
- **Priority:** M · **Release:** V1 · **Wave:** W1 · **Screens:** HM-MSG-01
- **Acceptance criteria:**
  - The notification listener queues message data natively when JavaScript is not running (FR-MSG-02) and Hermit ingests the queue on next start.
  - Duplicates from re-posted notifications are dropped by notification key and post time.

### US-MSG-06: Use WhatsApp Business too
- **As a** user with WhatsApp Business, **I want** Hermit to read and reply there as well, **so that** my work chats are covered.
- **Priority:** S · **Release:** V1 · **Wave:** W3 · **Screens:** HM-MSG-01
- **Acceptance criteria:**
  - The listener's allow-list includes the WhatsApp Business package; conversations show which app they came from.

### US-MSG-07: Know why one-time codes are invisible
- **As a** user, **I want** to understand why Hermit can't read verification codes, **so that** I don't think it's broken.
- **Priority:** C · **Release:** V1 · **Wave:** W3 · **Screens:** HM-SET-02
- **Acceptance criteria:**
  - The privacy screen explains that Android hides one-time codes from apps like Hermit (ASM-13).

### US-MSG-08: Reply to SMS
- **As a** user, **I want** Hermit to read and reply to SMS, **so that** non-WhatsApp contacts are covered.
- **Priority:** S · **Release:** V2 · **Screens:** HM-MSG-01
- **Acceptance criteria:**
  - Deferred to V2 (PDR-016). The capture contract (FR-MSG-01) is app-agnostic so SMS is an added source.

### US-MSG-09: Telegram and Signal
- **As a** user, **I want** Hermit to work with Telegram and Signal notifications, **so that** all my messengers are covered.
- **Priority:** C · **Release:** V2 · **Screens:** HM-MSG-01
- **Acceptance criteria:**
  - Deferred to V2. Each messenger is one more allow-listed package behind the same listener.

---

## EP-06: Approvals and the cage

Goal: nothing Hermit does reaches the outside world, spends money or touches a password unless the cage allows it, and anything that leaves the phone is approved by the user on the exact action (ADR-005, ADR-007, PDR-011, CT-07, CT-08).

### US-APPR-01: See the exact action before it happens
- **As a** user, **I want** an approval sheet that shows exactly what will be sent and to whom, **so that** I'm never approving something vague.
- **Priority:** M · **Release:** V1 · **Wave:** W1 · **Screens:** HM-APPR-01
- **Acceptance criteria:**
  - HM-APPR-01 is rendered by the skill's `describeAction` from the exact arguments and trusted phone data, never from model prose (FR-CAGE-03, CT-06).
  - The sheet shows the action title, each field (for example To, Message), and why Hermit is suggesting it when the session is tainted (US-APPR-04).

### US-APPR-02: Approve with my fingerprint
- **As a** user, **I want** to approve with my fingerprint, **so that** only I can let Hermit act.
- **Priority:** M · **Release:** V1 · **Wave:** W1 · **Screens:** HM-APPR-01
- **Acceptance criteria:**
  - The approve button triggers a biometric prompt that unlocks the approval key (ADR-007).
  - On success, the approval carries the arguments' hash and a proof (an HMAC of the hash and the request ID), recorded in the signed log (FR-CAGE-03, FR-ACT-01).
  - An approval whose hash differs from the call's, or that lacks the required biometric, is treated as a denial.

### US-APPR-03: Decline, or let it time out
- **As a** user, **I want** to decline or ignore an approval, **so that** nothing happens without my yes.
- **Priority:** M · **Release:** V1 · **Wave:** W1 · **Screens:** HM-APPR-01
- **Acceptance criteria:**
  - "Don't send" denies; closing the sheet or waiting past the expiry also denies (FR-CAGE-03).
  - The chat says plainly that nothing was sent.

### US-APPR-04: Be warned when an action was suggested by someone else's text
- **As a** user, **I want** a clear warning when Hermit proposes an action after reading a message or page, **so that** I can spot a manipulated request.
- **Priority:** M · **Release:** V1 · **Wave:** W1 · **Screens:** HM-APPR-01
- **Acceptance criteria:**
  - When the session is tainted, the sheet shows "Suggested after reading" with the source (FR-CAGE-04).

### US-APPR-05: Approve once for the rest of a session
- **As a** user, **I want** to approve a low-risk action once for the session, **so that** repeated harmless steps don't nag me.
- **Priority:** S · **Release:** V2 · **Screens:** HM-APPR-01
- **Acceptance criteria:**
  - Deferred to V2 (PDR-016). Never offered for send, spend or credential risks (PDR-011). `ENT-ApprovalGrant` is reserved.

### US-CAGE-01: Understand why something was blocked
- **As a** user, **I want** a plain reason when Hermit refuses an action, **so that** I know it was a rule, not a bug.
- **Priority:** M · **Release:** V1 · **Wave:** W1 · **Screens:** HM-CHAT-01
- **Acceptance criteria:**
  - Blocked calls show the mascot's blocked pose and the policy's reason (FR-CAGE-01); the model receives "Blocked: reason" and must respond without retrying the same call.

### US-CAGE-02: Background work can never act on its own
- **As a** user, **I want** anything Hermit does while I'm away to be unable to send, pay or log in, **so that** the night shift is safe by construction.
- **Priority:** M · **Release:** V1 · **Wave:** W3 · **Screens:** HM-NIGHT-01
- **Acceptance criteria:**
  - In an unattended session every `ask` becomes `deny` (FR-CAGE-02); results that would need approval are queued as suggestions for the morning briefing (US-NIGHT-02).

### US-CAGE-03: Approvals that a compromised app can't forge
- **As a** user, **I want** money and password approvals signed by a key the app itself can't read, **so that** even a malicious library couldn't fake my approval.
- **Priority:** M · **Release:** V1 · **Wave:** W5 · **Screens:** HM-APPR-01
- **Acceptance criteria:**
  - From W5 on, approvals for spend and credential risks are signed by a non-exportable Android Keystore key inside a native module (ADR-007).
  - The signed log stores the hardware signature; verification uses the key's public part.

---

## EP-07: Activity and the signed log

Goal: show everything Hermit did, in a tamper-evident chain the user can verify on the phone (ADR-005, PDR-012, FR-ACT-01 to FR-ACT-04).

### US-ACT-01: See what Hermit did
- **As a** user, **I want** a list of every action Hermit proposed, ran, blocked or I approved, **so that** I can check its work.
- **Priority:** M · **Release:** V1 · **Wave:** W1 · **Screens:** HM-ACT-01
- **Acceptance criteria:**
  - HM-ACT-01 lists log entries newest first: action, outcome and time, with a short hash.
  - Blocked entries show the coral shield; approved ones show the fingerprint mark.
  - Entries contain no message text, arguments or memory content: only hashes and metadata (FR-ACT-02).

### US-ACT-02: Verify the chain
- **As a** user, **I want** to verify that the log hasn't been edited, **so that** I can trust it.
- **Priority:** M · **Release:** V1 · **Wave:** W1 · **Screens:** HM-ACT-01, HM-ACT-03
- **Acceptance criteria:**
  - "Chain verified" appears when every entry's hash, link and signature check out (FR-ACT-03).
  - If any check fails, HM-ACT-03 shows "Chain broken at entry N" and the reason; Hermit keeps working and logs the event.
  - The wording says "tamper-evident", never "immutable".

### US-ACT-03: Open an entry's details
- **As a** user, **I want** to open an entry, **so that** I see its full metadata and hashes.
- **Priority:** S · **Release:** V1 · **Wave:** W3 · **Screens:** HM-ACT-02
- **Acceptance criteria:**
  - HM-ACT-02 shows event, skill, decision, outcome, time, the arguments' hash, the entry hash and signature, in monospace.

### US-ACT-04: Clear the log, on the record
- **As a** user, **I want** to clear the activity log, **so that** I control my data, while the clearing itself stays visible.
- **Priority:** S · **Release:** V1 · **Wave:** W3 · **Screens:** HM-ACT-01
- **Acceptance criteria:**
  - Clearing requires a fingerprint and starts a new chain whose first entry records "log cleared" with the previous head hash (PDR-012).

### US-ACT-05: Export the log for someone to verify
- **As a** user, **I want** to export the log with its public key, **so that** a third party can verify it.
- **Priority:** C · **Release:** V2 · **Screens:** HM-ACT-02
- **Acceptance criteria:**
  - Deferred to V2. Boost (EP-18) may also hold signed checkpoints off the phone.

---

## EP-08: Voice notes and voice

Goal: Hermit is a chat first. Voice is secondary: the user can send voice notes in the chat, transcribed on the phone by QVAC's speech to text, in Spanish or English. Realtime conversation and calls come later (ADR-003, ADR-013, PDR-020).

### US-VOICE-01: Send a voice note
- **As a** user, **I want** to record a voice note in the chat instead of typing, **so that** I can ask Hermit things the way I message people.
- **Priority:** M · **Release:** V1 · **Wave:** W2 · **Screens:** HM-CHAT-01, HM-VOICE-01
- **Acceptance criteria:**
  - Holding the mic records a voice note (HM-VOICE-01 shows the timer and level; slide to cancel); releasing sends it, like a messaging app.
  - The note is transcribed on the phone by QVAC's speech to text (FR-VOICE-01); the transcript shows under the note and runs as a normal turn.
  - No audio leaves the phone; the audio is discarded after transcription unless the user keeps voice notes in settings.

### US-VOICE-02: Correct a transcript before it runs
- **As a** user, **I want** to see and fix what Hermit heard, **so that** a misheard word doesn't become a wrong action.
- **Priority:** S · **Release:** V1 · **Wave:** W2 · **Screens:** HM-VOICE-01
- **Acceptance criteria:**
  - A setting makes voice notes wait for review: the transcript stays editable with Send and Discard before the turn runs.
  - Approvals are never granted by voice; they always need the sheet and the fingerprint (FR-CAGE-03).

### US-VOICE-03: Hear Hermit reply
- **As a** user, **I want** Hermit to read its reply aloud, **so that** I can listen when I can't look.
- **Priority:** C · **Release:** V2 · **Screens:** HM-CHAT-01, HM-SET-04
- **Acceptance criteria:**
  - Deferred to V2 (PDR-020). On-device text to speech in the reply's language (FR-VOICE-02).

### US-VOICE-04: Speak in Spanish or English
- **As a** bilingual user, **I want** Hermit to understand my voice notes in either language, **so that** I don't switch settings to talk.
- **Priority:** M · **Release:** V1 · **Wave:** W2 · **Screens:** HM-VOICE-01
- **Acceptance criteria:**
  - Recognition detects es or en per note; the eval set includes spoken-style prompts in both (FR-MODEL-04).

### US-VOICE-05: Call Hermit hands-free with a wake word
- **As a** user, **I want** to say a wake word instead of pressing a button, **so that** I can use Hermit while driving.
- **Priority:** C · **Release:** V3 · **Screens:** HM-VOICE-01
- **Acceptance criteria:**
  - Deferred to V3 (PDR-016). Always-on listening must first prove its battery cost and its privacy story on device.

### US-VOICE-06: Talk through headphones and the car
- **As a** user, **I want** to record voice notes from a headset button and Android Auto, **so that** voice works where I need it most.
- **Priority:** C · **Release:** V2 · **Screens:** HM-VOICE-01
- **Acceptance criteria:**
  - Deferred to V2 (PDR-016).

### US-VOICE-07: Have a realtime voice conversation
- **As a** user, **I want** to talk with Hermit back and forth and interrupt it, **so that** voice feels like a conversation.
- **Priority:** S · **Release:** V2 · **Screens:** HM-VOICE-01
- **Acceptance criteria:**
  - Deferred to V2 (PDR-020). Speech in and out on the phone; voice never approves an action.

### US-VOICE-08: Let Hermit screen my calls
- **As a** user, **I want** Hermit to answer unknown callers, take a message and summarize it, **so that** I'm not interrupted by spam.
- **Priority:** C · **Release:** V2 · **Screens:** HM-VOICE-01
- **Acceptance criteria:**
  - Deferred to V2 (PDR-020). Uses Android's call screening role; needs a Play policy review.

---

## EP-09: Web reading and web tasks

Goal: Hermit reads web pages through a quarantined reader that can see but never act, and does simple, known tasks on websites in an in-app browser the user can watch, approving every submit, purchase and sign-in. Open-ended browsing runs on Boost (ADR-005, ADR-018, PDR-007, PDR-018).

### US-WEB-01: Ask Hermit to read a page
- **As a** user, **I want** to paste a link and ask "what does this say about refunds?", **so that** I get the answer without reading the page.
- **Priority:** M · **Release:** V1 · **Wave:** W3 · **Screens:** HM-CHAT-01, HM-WEB-01
- **Acceptance criteria:**
  - The `read_web` skill fetches the URL over HTTPS, extracts readable text and passes it only to the quarantined reader (FR-WEB-01, FR-WEB-03).
  - The answer cites the page title and domain; HM-WEB-01 shows the extracted text the answer used.
  - The session is tainted afterward (FR-CAGE-04).

### US-WEB-02: Approve a network fetch
- **As a** user, **I want** to approve each new site Hermit wants to open, **so that** I know when it goes online.
- **Priority:** M · **Release:** V1 · **Wave:** W3 · **Screens:** HM-APPR-01
- **Acceptance criteria:**
  - A fetch is a `network` risk that asks the first time per domain per session (FR-WEB-02), showing the full URL.
  - Fetches in airplane mode fail with a clear "offline" reply.

### US-WEB-03: Search the web
- **As a** user, **I want** to ask a question that needs the web and have Hermit search, **so that** I get current facts.
- **Priority:** S · **Release:** V1 · **Wave:** W3 · **Screens:** HM-CHAT-01, HM-SET-02
- **Acceptance criteria:**
  - The `search_web` skill queries one search provider the user picked in settings, sending only the query (FR-WEB-04, OQ-04).
  - Results are untrusted and go through the quarantined reader.

### US-WEB-04: Keep pages from giving Hermit orders
- **As a** user, **I want** instructions hidden in a page to be ignored, **so that** reading a page is never dangerous.
- **Priority:** M · **Release:** V1 · **Wave:** W3 · **Screens:** HM-CHAT-01
- **Acceptance criteria:**
  - The quarantined reader returns only a typed summary (FR-WEB-03); it has no skills and cannot choose any.
  - The eval suite contains injection pages that try to cause sends, payments and memory writes; none succeeds (NFR-07).

### US-WEB-05: Share a page into Hermit
- **As a** user, **I want** to share a page from my browser into Hermit, **so that** I can ask about what I'm reading.
- **Priority:** S · **Release:** V2 · **Screens:** HM-CHAT-03
- **Acceptance criteria:**
  - Deferred to V2 with US-CHAT-09.

### US-WEB-06: Read pages behind my logins
- **As a** user, **I want** Hermit to read pages behind my logins, **so that** it can check my orders or bills.
- **Priority:** S · **Release:** V1 · **Wave:** W4 · **Screens:** HM-WEB-02
- **Acceptance criteria:**
  - Signed-in pages are read in the in-app browser (FR-WEB-05); sign-in uses the vault with exact-origin matching (FR-VAULT-04), approved with a fingerprint.
  - Cookies live in a per-site, encrypted browser profile that the user can clear per site.

### US-WEB-07: Do a simple task on a website
- **As a** user, **I want** to say "reorder my usual from the pharmacy" or "book a table for two at 8", **so that** Hermit finishes errands on sites with no API.
- **Priority:** M · **Release:** V1 · **Wave:** W4 · **Screens:** HM-WEB-02, HM-APPR-01
- **Acceptance criteria:**
  - Hermit drives an in-app browser on the phone, reading each page through its accessibility tree (FR-WEB-05); no screenshot or page leaves the phone.
  - Tasks are known flows (book, reorder, check out, fill and submit, check a status) limited to at most 15 steps; a task outside them is handed to Boost in V2 or declined (FR-WEB-06).
  - The session is untrusted throughout: page text never chooses a skill outside the task.

### US-WEB-08: Watch Hermit use the browser
- **As a** user, **I want** to watch the browser live and take over at any moment, **so that** I always see what Hermit does on my behalf.
- **Priority:** M · **Release:** V1 · **Wave:** W4 · **Screens:** HM-WEB-02
- **Acceptance criteria:**
  - HM-WEB-02 shows the live page with the current step in words; "Take over" pauses Hermit and hands the page to the user; "Stop" ends the task.

### US-WEB-09: Approve each step that commits
- **As a** user, **I want** to approve every submit, purchase and sign-in, **so that** a web task can never commit me to something I didn't see.
- **Priority:** M · **Release:** V1 · **Wave:** W4 · **Screens:** HM-APPR-01
- **Acceptance criteria:**
  - Any click that submits a form, places an order, signs in or changes an account is a `remote_write`, `spend` or `credential` call (FR-WEB-07); the sheet shows the site, the button and the values being sent.
  - Card payments on a site are `spend` and follow the caps (PDR-011); Hermit never stores card numbers in V1.

### US-WEB-11: Repeat a web task I did before
- **As a** user, **I want** Hermit to remember how it did a task on a site, **so that** "reorder my usual" is fast and reliable next time.
- **Priority:** S · **Release:** V1 · **Wave:** W4 · **Screens:** HM-WEB-02
- **Acceptance criteria:**
  - A completed, approved task is saved as a recipe on the phone (FR-WEB-10) and replayed without the model; the model is called only for a step that fails.
  - Committing steps in a replay still ask every time.

### US-WEB-10: Hand hard web tasks to Boost
- **As a** user, **I want** open-ended browsing to run on my computer's bigger model, **so that** long or unusual tasks still get done.
- **Priority:** S · **Release:** V2 · **Screens:** HM-WEB-02, HM-BOOST-01
- **Acceptance criteria:**
  - Deferred to V2 with EP-18 (PDR-018). Approvals, the vault and the signed log stay on the phone.

### US-WEB-12: Do open-ended web tasks and purchases fully on the phone
- **As a** user, **I want** Hermit to do any web task and purchase without my computer or any cloud, **so that** the most private agent is also the most capable one.
- **Priority:** S · **Release:** V3 · **Screens:** HM-WEB-02, HM-APPR-01
- **Acceptance criteria:**
  - Long-term goal (PDR-026): each task family moves from Boost to the phone only when its on-phone eval passes the same gate Boost passes for that family.
  - The research path is in `docs/research/web-on-phone.md`: structured paths first (merchant MCP servers, WebMCP, x402), code-driven search and extraction, recipes, then a dedicated small web-step model behind a planner and skill-executor split.
  - Approvals, the vault, the cage and the signed log are unchanged; every committing step still asks.

---

## EP-10: Night shift

Goal: Hermit works while the phone charges at night, preparing a morning briefing, and by construction can never send, pay or log in while unattended (ADR-005, PDR-007).

### US-NIGHT-01: Turn on the night shift
- **As a** user, **I want** to let Hermit work while my phone charges overnight, **so that** I wake up to something useful.
- **Priority:** M · **Release:** V1 · **Wave:** W3 · **Screens:** HM-NIGHT-01
- **Acceptance criteria:**
  - HM-NIGHT-01 enables the night shift with a window and the jobs to run (summarize messages, prepare the day's agenda, review reminders).
  - Jobs run only while charging, on Wi-Fi if they need the network, and with the screen off (FR-NIGHT-01).
  - The session is unattended: every `ask` becomes `deny` (US-CAGE-02).

### US-NIGHT-02: Read the morning briefing
- **As a** user, **I want** a short briefing in the morning, **so that** I start the day knowing what matters.
- **Priority:** M · **Release:** V1 · **Wave:** W3 · **Screens:** HM-NIGHT-02
- **Acceptance criteria:**
  - HM-NIGHT-02 shows the briefing: today's agenda, important messages, due reminders, and suggested actions.
  - Each suggested action opens the normal approval sheet; nothing proposed overnight runs without it (FR-NIGHT-02).
  - A notification announces the briefing at the user's chosen time.

### US-NIGHT-03: See what ran overnight
- **As a** user, **I want** to see which jobs ran and what they were refused, **so that** I trust the night shift.
- **Priority:** S · **Release:** V1 · **Wave:** W3 · **Screens:** HM-NIGHT-02, HM-ACT-01
- **Acceptance criteria:**
  - The briefing lists jobs run, skipped (not charging, battery hot) and actions denied as unattended; each is in the signed log.

### US-NIGHT-04: Stop the night shift from hurting the battery
- **As a** user, **I want** the night shift to pause when the phone is hot or the battery is low, **so that** it never harms my phone.
- **Priority:** M · **Release:** V1 · **Wave:** W3 · **Screens:** HM-NIGHT-01
- **Acceptance criteria:**
  - Jobs pause above the thermal threshold or below the battery floor (NFR-04) and resume when conditions return.

### US-NIGHT-05: Schedule my own recurring jobs
- **As a** user, **I want** to ask "every Friday, summarize my week", **so that** I create my own routines.
- **Priority:** S · **Release:** V1 · **Wave:** B2 · **Screens:** HM-BOT-04
- **Acceptance criteria:**
  - Superseded by US-BOT-11 (routines). A routine belongs to a bot, runs unattended under the same cage and the bot's mode (PDR-029, PDR-031), and the night shift keeps its own jobs.

---

## EP-11: Vault, forms and logins

Goal: a password vault on the phone that Hermit can use to fill forms and log in, revealing a secret only to the exact site it belongs to and only after the user approves (ADR-005, ADR-007, PDR-007, PDR-015).

### US-VAULT-01: Create the vault
- **As a** user, **I want** an encrypted vault unlocked by my fingerprint, **so that** my passwords live on my phone, not in a cloud.
- **Priority:** M · **Release:** V1 · **Wave:** W4 · **Screens:** HM-VAULT-01
- **Acceptance criteria:**
  - The vault is encrypted with a key held in the Android Keystore and unlocked with a biometric (FR-VAULT-01).
  - The model never sees a secret value; it sees only item names and origins (FR-VAULT-02).

### US-VAULT-02: Add, view and edit a login
- **As a** user, **I want** to save a login with its exact website, **so that** Hermit can use it only there.
- **Priority:** M · **Release:** V1 · **Wave:** W4 · **Screens:** HM-VAULT-01, HM-VAULT-02
- **Acceptance criteria:**
  - Each item stores name, username, secret, notes and one or more exact origins (scheme, host and port).
  - Viewing a secret requires a fingerprint and hides it again after the product rule of 30 seconds.

### US-VAULT-03: Import passwords from a file
- **As a** user, **I want** to import a CSV from my current password manager, **so that** I don't type everything again.
- **Priority:** S · **Release:** V1 · **Wave:** W4 · **Screens:** HM-VAULT-03
- **Acceptance criteria:**
  - Import accepts the common CSV formats (FR-VAULT-03), shows a preview, and reminds the user to delete the file afterward.

### US-VAULT-04: Generate a strong password
- **As a** user, **I want** Hermit to generate a strong password when I create an account, **so that** I don't reuse passwords.
- **Priority:** S · **Release:** V1 · **Wave:** W4 · **Screens:** HM-VAULT-02
- **Acceptance criteria:**
  - The generator uses the platform secure random source with a length and character set the user can adjust.

### US-VAULT-05: Use passkeys
- **As a** user, **I want** Hermit's vault to hold passkeys, **so that** I can move off passwords.
- **Priority:** C · **Release:** V2 · **Screens:** HM-VAULT-02
- **Acceptance criteria:**
  - Deferred to V2 (PDR-016).

### US-FORM-01: Fill a form in another app
- **As a** user, **I want** Hermit to fill a form with my details, **so that** I stop typing my address and ID again and again.
- **Priority:** M · **Release:** V1 · **Wave:** W4 · **Screens:** HM-FORM-01, HM-APPR-01
- **Acceptance criteria:**
  - Hermit fills fields through the Android autofill service (FR-FORM-01), proposing values from the user's profile and vault.
  - The user sees each field and value on HM-FORM-01 and approves before anything is filled.
  - Submitting the form stays the user's own tap.

### US-FORM-02: Log in to a site with an approved credential
- **As a** user, **I want** Hermit to log me in to a site, **so that** I don't look up passwords.
- **Priority:** M · **Release:** V1 · **Wave:** W4 · **Screens:** HM-APPR-01
- **Acceptance criteria:**
  - A login is a `credential` risk: the cage asks with a fingerprint every time (FR-CAGE-02); hard limits deny credential use in unattended or tainted sessions.
  - The secret is released only when the requesting origin matches a stored origin exactly (FR-VAULT-04); a lookalike domain gets nothing.

### US-FORM-03: Keep my personal profile for forms
- **As a** user, **I want** to keep my name, address, ID numbers and similar details in one place, **so that** form filling knows them.
- **Priority:** S · **Release:** V1 · **Wave:** W4 · **Screens:** HM-FORM-02
- **Acceptance criteria:**
  - The profile is stored in the vault, encrypted, and each field is marked sensitive or not; sensitive fields need a fingerprint to fill.

### US-FORM-04: Fill payment cards
- **As a** user, **I want** Hermit to fill my card details, **so that** checkout is faster.
- **Priority:** C · **Release:** V2 · **Screens:** HM-FORM-01
- **Acceptance criteria:**
  - Deferred to V2 (PDR-016). Card data would be a `spend`-risk item under the money rules (PDR-011).

---

## EP-12: Wallet and payments

Goal: a self-custodial USD₮ wallet on the phone, built with Tether's WDK, that can pay people and pay x402 merchants, always asking within caps the user sets (ADR-007, ADR-015, PDR-008, PDR-011).

### US-PAY-01: Create a wallet
- **As a** user, **I want** to create a self-custodial wallet in Hermit, **so that** my agent can hold and move dollars I control.
- **Priority:** M · **Release:** V1 · **Wave:** W5 · **Screens:** HM-PAY-01, HM-PAY-02
- **Acceptance criteria:**
  - The wallet is created with WDK in the worklet; the seed is encrypted under a Keystore key and never reaches the model (FR-PAY-01).
  - The user is shown the 12 or 24 recovery words once, behind a fingerprint, and confirms three of them.

### US-PAY-02: Back up and restore the wallet
- **As a** user, **I want** to restore my wallet from my recovery words, **so that** losing the phone doesn't lose the money.
- **Priority:** M · **Release:** V1 · **Wave:** W5 · **Screens:** HM-PAY-02
- **Acceptance criteria:**
  - Restore accepts the words, derives the same addresses and shows the balance.
  - Hermit states plainly that nobody, including Dojo Coding, can recover a lost seed.

### US-PAY-03: See my balance and history
- **As a** user, **I want** to see my USD₮ balance and transactions, **so that** I know where my money went.
- **Priority:** M · **Release:** V1 · **Wave:** W5 · **Screens:** HM-PAY-01, HM-PAY-03
- **Acceptance criteria:**
  - Balance and history are read from the chain through the configured RPC (FR-PAY-02); amounts follow the money contract (CT-01).
  - Each transaction links to its signed-log entry when Hermit made it.

### US-PAY-04: Receive money
- **As a** user, **I want** a QR code and address to receive USD₮, **so that** people can pay me.
- **Priority:** M · **Release:** V1 · **Wave:** W5 · **Screens:** HM-PAY-04
- **Acceptance criteria:**
  - HM-PAY-04 shows the address, a QR code and the network name; the network is stated on every receive screen.

### US-PAY-05: Send money by asking
- **As a** user, **I want** to say "send Ana 20 dollars", **so that** paying someone is one sentence and one fingerprint.
- **Priority:** M · **Release:** V1 · **Wave:** W5 · **Screens:** HM-CHAT-01, HM-APPR-02
- **Acceptance criteria:**
  - The `pay` skill takes a contact or address and an amount; the recipient's address comes from the user's saved contacts, never from the model or a message (FR-PAY-03).
  - The cage always asks, with a fingerprint, on HM-APPR-02 showing amount, fee, network and recipient; the approval is signed by the Keystore key (US-CAGE-03).
  - Payments are denied outright in tainted or unattended sessions and above the user's caps (FR-CAGE-02, US-PAY-06).

### US-PAY-06: Set spending caps
- **As a** user, **I want** a per-payment and per-day cap, **so that** even an approved mistake has a ceiling.
- **Priority:** M · **Release:** V1 · **Wave:** W5 · **Screens:** HM-PAY-05
- **Acceptance criteria:**
  - Caps are stored in `ENT-SpendingCap`; changing them needs a fingerprint and is logged (PDR-011).
  - A payment over either cap is denied with the reason; raising a cap does not retry it.

### US-PAY-07: Pay a merchant that asks for x402
- **As a** user, **I want** Hermit to pay for an API or page that requests an x402 payment, **so that** small purchases just work under my caps.
- **Priority:** M · **Release:** V1 · **Wave:** W5 · **Screens:** HM-APPR-02
- **Acceptance criteria:**
  - When a fetch returns HTTP 402 with x402 requirements, the payments package builds an EIP-3009 authorization with the WDK EVM account (FR-PAY-04).
  - The cage asks with the merchant's origin, amount and network; the fetch retries with the payment header only after approval.
  - Requirements on unsupported networks or assets are refused with a reason.

### US-PAY-08: Hold more assets than USD₮
- **As a** user, **I want** to hold bitcoin and other assets, **so that** one wallet covers everything.
- **Priority:** C · **Release:** V2 · **Screens:** HM-PAY-01
- **Acceptance criteria:**
  - Deferred to V2 (PDR-008). WDK supports more chains; the money contract (CT-01) already carries an asset code.

### US-PAY-09: Pay agent to agent
- **As a** user, **I want** my Hermit to pay another agent for a service, **so that** agents can trade on my behalf.
- **Priority:** C · **Release:** V2 · **Screens:** HM-APPR-02
- **Acceptance criteria:**
  - Deferred to V2 with EP-21.

---

## EP-13: Changing phones

Goal: move everything Hermit holds to a new phone directly, phone to phone over Holepunch, with no server in between (ADR-016, PDR-010).

### US-MOVE-01: Pair the old and new phone
- **As a** user, **I want** to pair my new phone with my old one by scanning a QR code, **so that** only my phones talk to each other.
- **Priority:** M · **Release:** V1 · **Wave:** W6 · **Screens:** HM-MOVE-01, HM-MOVE-02
- **Acceptance criteria:**
  - The old phone shows a QR code carrying a one-time key; the new phone scans it and both show the same 6-digit code to compare (FR-MOVE-01).
  - Pairing fails closed if the codes don't match or the user cancels.

### US-MOVE-02: Transfer everything
- **As a** user, **I want** memories, reminders, settings, the vault, the wallet and the signed log moved in one go, **so that** my new phone is my old Hermit.
- **Priority:** M · **Release:** V1 · **Wave:** W6 · **Screens:** HM-MOVE-03
- **Acceptance criteria:**
  - The transfer runs over a Holepunch connection end to end encrypted with the pairing key (FR-MOVE-02); progress shows per category.
  - The vault and the wallet move only after a fingerprint on the old phone; Keystore keys are re-created on the new phone, never exported.
  - The model file is not transferred; the new phone downloads and verifies its own (US-ONB-03).

### US-MOVE-03: Confirm and wipe the old phone
- **As a** user, **I want** to wipe Hermit from the old phone once the new one has everything, **so that** my data isn't left behind.
- **Priority:** M · **Release:** V1 · **Wave:** W6 · **Screens:** HM-MOVE-03
- **Acceptance criteria:**
  - The new phone verifies counts and the signed log's chain before offering "Wipe old phone"; the wipe needs a fingerprint on the old phone.

### US-MOVE-04: Keep an encrypted backup without a second phone
- **As a** user, **I want** an encrypted backup file I can store myself, **so that** a lost phone doesn't lose my Hermit.
- **Priority:** S · **Release:** V2 · **Screens:** HM-MOVE-04
- **Acceptance criteria:**
  - Deferred to V2 (PDR-016). The transfer format of FR-MOVE-02 is reused as the backup format.

---

## EP-14: Settings, privacy and accessibility

Goal: one place to see what Hermit can touch, prove what it doesn't send, and make it usable for everyone (ADR-009, ADR-013, PDR-013).

### US-SET-01: See and manage permissions
- **As a** user, **I want** one screen listing every permission and what uses it, **so that** I stay in control.
- **Priority:** M · **Release:** V1 · **Wave:** W3 · **Screens:** HM-SET-01
- **Acceptance criteria:**
  - HM-SET-01 lists notifications, calendar, contacts, microphone and autofill with state and a link to change each (contacts: PDR-028).

### US-SET-02: See what Hermit sends, and to whom
- **As a** user, **I want** a privacy screen that shows every network destination Hermit has used, **so that** "tells no one" is checkable.
- **Priority:** M · **Release:** V1 · **Wave:** W3 · **Screens:** HM-SET-02
- **Acceptance criteria:**
  - HM-SET-02 lists each outbound host Hermit contacted (model download, web reading, search, RPC), with counts, from a local counter (FR-PRIV-02).
  - It states that Hermit has no analytics, no crash reporting and no account (ADR-009).

### US-SET-03: Delete everything
- **As a** user, **I want** one action that erases all of Hermit's data, **so that** leaving is clean.
- **Priority:** M · **Release:** V1 · **Wave:** W3 · **Screens:** HM-SET-03
- **Acceptance criteria:**
  - After a fingerprint and a typed confirmation, Hermit deletes the database, the vault, the keys and the model file; a wallet with a balance shows a warning first.

### US-SET-04: Choose voice settings
- **As a** user, **I want** to control read-aloud and the voice, **so that** Hermit sounds right to me.
- **Priority:** C · **Release:** V2 · **Screens:** HM-SET-04
- **Acceptance criteria:**
  - Deferred to V2 with US-VOICE-03 (PDR-020). Settings cover read-aloud, speech rate and the voice per language.

### US-SET-05: Change the language
- **As a** user, **I want** a language setting, **so that** I can override the phone's language.
- **Priority:** S · **Release:** V1 · **Wave:** W3 · **Screens:** HM-SET-05
- **Acceptance criteria:**
  - Covered by US-ONB-02; HM-SET-05 is the settings entry point.

### US-SET-06: Turn on quiet mode
- **As a** user, **I want** to hide the mascot and animations, **so that** Hermit looks like a plain tool.
- **Priority:** S · **Release:** V1 · **Wave:** W3 · **Screens:** HM-SET-06
- **Acceptance criteria:**
  - Quiet mode hides the mascot and turns off motion; it also follows the system "remove animations" setting.

### US-SET-07: Use Hermit with TalkBack
- **As a** user who relies on a screen reader, **I want** every screen to work with TalkBack, **so that** Hermit is usable without sight.
- **Priority:** M · **Release:** V1 · **Wave:** W3 · **Screens:** HM-CHAT-01, HM-APPR-01
- **Acceptance criteria:**
  - All controls have labels; the approval sheet reads the action and each field in order before the approve button (PDR-013).
  - Streaming replies are announced when complete, not token by token.

### US-SET-08: Use large text and dark mode
- **As a** user, **I want** Hermit to respect my font size and dark mode, **so that** it's comfortable to read.
- **Priority:** M · **Release:** V1 · **Wave:** W3 · **Screens:** HM-SET-07
- **Acceptance criteria:**
  - Layouts hold up to 200% font scale; dark mode uses the Deep sea palette and follows the system by default; contrast meets WCAG 2.2 AA (NFR-08).

### US-SET-09: Lock Hermit with a fingerprint on open
- **As a** user, **I want** Hermit to need my fingerprint when it opens, **so that** someone holding my unlocked phone can't read my agent.
- **Priority:** S · **Release:** V1 · **Wave:** W3 · **Screens:** HM-SET-01
- **Acceptance criteria:**
  - An optional app lock asks for a biometric on open and after the phone has been locked.

### US-SET-10: See the credits and licenses
- **As a** user, **I want** an About screen with who builds Hermit and the open-source licenses, **so that** I know where it comes from.
- **Priority:** S · **Release:** V1 · **Wave:** W3 · **Screens:** HM-SET-08
- **Acceptance criteria:**
  - HM-SET-08 shows the signature (Hermit, built by Dojo Coding, powered by QVAC from Tether) with the three logos and the not-affiliated line (PDR-005), and the license list.

### US-SET-11: Customize the mascot's name and tone
- **As a** user, **I want** to rename Hermit and choose a more formal or casual tone, **so that** it feels like mine.
- **Priority:** C · **Release:** V2 · **Screens:** HM-SET-06
- **Acceptance criteria:**
  - Deferred to V2 (PDR-016).

---

## EP-15: Model runtime and eval

Goal: run the model on the phone within the speed and accuracy bar, prove it with an eval set, and fine-tune only if the stock model misses (ADR-003, ADR-004, ADR-008, PDR-003, PDR-009).

### US-MODEL-01: Run the model on the phone's GPU
- **As a** user, **I want** Hermit's model to run on my phone's GPU, **so that** answers come fast without the cloud.
- **Priority:** M · **Release:** V1 · **Wave:** W1 · **Screens:** HM-CHAT-02
- **Acceptance criteria:**
  - The QVAC adapter loads the pinned model in the worklet and implements the `Model` port of `packages/core` (FR-MODEL-01).
  - On the S26 Ultra the first skill call is chosen within the speed bar (NFR-01); the speed is recorded per turn (EVT-MODEL-01).
  - The model stays loaded while the app is in the foreground and unloads under memory pressure.

### US-MODEL-02: Prove the model meets the bar
- **As the** owner, **I want** the eval to report accuracy and speed on the phone in both languages, **so that** a model change is accepted on numbers, not feel.
- **Priority:** M · **Release:** V1 · **Wave:** W2 · **Screens:** none
- **Acceptance criteria:**
  - The eval runs the shared cases against the phone build and reports the share of correct first actions per language and the median time to first action (FR-MODEL-04).
  - The bar is at least 85% correct in each language and a median within the speed bar (PDR-003); results are stored in the repo per model hash.

### US-MODEL-03: Recover when the model misbehaves
- **As a** user, **I want** Hermit to recover from a bad model output instead of acting on it, **so that** small model mistakes don't become actions.
- **Priority:** M · **Release:** V1 · **Wave:** W2 · **Screens:** HM-CHAT-01
- **Acceptance criteria:**
  - Invalid JSON or arguments are repaired deterministically, then retried with the error up to 3 times, then fail with `repair_failed` (FR-LOOP-03).

### US-MODEL-04: Update the model safely
- **As a** user, **I want** a new model version to be offered, verified and reversible, **so that** an update never breaks Hermit.
- **Priority:** S · **Release:** V1 · **Wave:** W6 · **Screens:** HM-CHAT-02
- **Acceptance criteria:**
  - New models arrive only with an app update that pins their hash (FR-MODEL-02); the previous file is kept until the new one passes a smoke prompt.

### US-TRAIN-01: Use a Hermit-tuned model
- **As a** user, **I want** a model tuned for Hermit's skills, **so that** it chooses actions more accurately and faster.
- **Priority:** S · **Release:** V2 · **Screens:** HM-CHAT-02
- **Acceptance criteria:**
  - Deferred to V2 (PDR-009); triggered earlier only if the stock model misses the bar at the W2 gate.

---

## EP-16: Builds and distribution

Goal: ship Hermit through Google Play and as a signed, reproducible APK that anyone can verify, with privacy enforced in CI (ADR-009, ADR-014, PDR-005).

### US-PLAT-01: Install Hermit from Google Play
- **As a** user, **I want** to install Hermit from Google Play, **so that** I get it the normal way with updates.
- **Priority:** M · **Release:** V1 · **Wave:** W6 · **Screens:** none
- **Acceptance criteria:**
  - The Play listing, data safety form ("no data collected, no data shared") and the notification listener declaration are accepted (DEP-06, FR-PLAT-02).

### US-PLAT-02: Verify the APK is built from the source
- **As a** technical user, **I want** to rebuild the APK from the tagged source and get the same file, **so that** I can trust what I install.
- **Priority:** M · **Release:** V1 · **Wave:** W6 · **Screens:** none
- **Acceptance criteria:**
  - A tagged release produces a signed APK on GitHub Releases with its SHA-256 and the build recipe; an independent rebuild matches apart from the signature (FR-PLAT-03).

### US-PLAT-03: Know the build carries no trackers
- **As a** user, **I want** proof that no analytics or tracking library is in the app, **so that** the promise is enforced, not just stated.
- **Priority:** M · **Release:** V1 · **Wave:** W6 · **Screens:** HM-SET-02
- **Acceptance criteria:**
  - The privacy CI gate (FR-PRIV-01) runs on every PR and on the release build; the release notes link to its result.

### US-IOS-01: Use Hermit on iPhone
- **As an** iPhone user, **I want** Hermit on iOS, **so that** I'm not left out.
- **Priority:** M · **Release:** V2 · **Screens:** none
- **Acceptance criteria:**
  - Deferred to V2 (PDR-016). iOS cannot read other apps' notifications, so the message skills are redesigned around the share sheet and Shortcuts.

### US-IOS-02: Talk to Hermit through Siri and Shortcuts
- **As an** iPhone user, **I want** Hermit's skills exposed as App Intents, **so that** I can trigger them from Siri.
- **Priority:** S · **Release:** V2 · **Screens:** none
- **Acceptance criteria:**
  - Deferred to V2 with US-IOS-01.

---

## EP-17: Public website

Goal: a static public site that explains Hermit, hosts the privacy policy and links to the downloads, with no tracking and nothing the app depends on (ADR-012, PDR-005).

### US-SITE-01: Understand Hermit from its website
- **As a** visitor, **I want** a page that explains what Hermit does and how it stays private, **so that** I decide whether to install it.
- **Priority:** M · **Release:** V1 · **Wave:** W6 · **Screens:** HM-SITE-01
- **Acceptance criteria:**
  - A static Next.js export on Vercel (ADR-012) with the brand, the mascot, the promises and the signature; no cookies, analytics or third-party scripts (FR-SITE-01).
  - es-419 and English versions (ADR-013).

### US-SITE-02: Read the privacy policy
- **As a** visitor or a Play reviewer, **I want** a public privacy policy, **so that** the data handling is on record.
- **Priority:** M · **Release:** V1 · **Wave:** W6 · **Screens:** HM-SITE-02
- **Acceptance criteria:**
  - The policy states that Hermit collects nothing, lists every outbound connection the app can make, and is linked from the Play listing.

### US-SITE-03: Download and verify the APK
- **As a** visitor, **I want** a download page with the APK, its hash and the verify steps, **so that** I can sideload safely.
- **Priority:** S · **Release:** V1 · **Wave:** W6 · **Screens:** HM-SITE-03
- **Acceptance criteria:**
  - The page links to the GitHub release, shows the SHA-256 and the rebuild instructions (US-PLAT-02).

### US-SITE-04: Read the docs for contributors
- **As a** developer, **I want** contributor docs on how skills and the cage work, **so that** I can add a skill.
- **Priority:** S · **Release:** V2 · **Screens:** HM-SITE-04
- **Acceptance criteria:**
  - Deferred to V2. The repository itself is public from launch (Q210 to Q213 supersede the private-repository part of PDR-005).

---

## EP-18: Boost: a bigger shell

Goal: let the phone borrow a bigger model on the user's own computer, paired directly over Holepunch, keeping the same cage on the phone (ADR-010, ADR-016, PDR-016).

### US-BOOST-01: Pair my computer as a Boost
- **As a** user, **I want** to pair my laptop running Hermit Boost with my phone, **so that** hard requests run on a bigger model I own.
- **Priority:** M · **Release:** V2 · **Screens:** HM-BOOST-01
- **Acceptance criteria:**
  - Pairing reuses the QR and 6-digit flow of FR-MOVE-01; the computer never holds the user's keys.

### US-BOOST-02: See when a turn used Boost
- **As a** user, **I want** to see when a reply came from my computer instead of the phone, **so that** I know where my data went.
- **Priority:** M · **Release:** V2 · **Screens:** HM-CHAT-02
- **Acceptance criteria:**
  - The header chip reads "On your computer" during Boost turns; the cage, approvals and signed log stay on the phone.

### US-BOOST-03: Choose what may go to Boost
- **As a** user, **I want** to keep some topics phone-only, **so that** sensitive requests never leave the phone even to my laptop.
- **Priority:** S · **Release:** V2 · **Screens:** HM-BOOST-01
- **Acceptance criteria:**
  - Vault, wallet and tainted turns never route to Boost; the user can add more exclusions.

### US-BOOST-04: Use a confidential-cloud Boost
- **As a** user without a computer, **I want** a Boost in a confidential cloud enclave, **so that** I get a bigger model without trusting a provider.
- **Priority:** C · **Release:** V3 · **Screens:** HM-BOOST-01
- **Acceptance criteria:**
  - Deferred to V3 (PDR-016). Requires remote attestation shown to the user.

---

## EP-19: Learn my style (fine-tuning)

Goal: improve Hermit for its user without sending data anywhere, once the stock model and the V1 surfaces are proven (PDR-009, PDR-016).

### US-TRAIN-02: Learn from my corrections on the phone
- **As a** user, **I want** Hermit to learn from the times I corrected it, **so that** it gets better for me.
- **Priority:** S · **Release:** V2 · **Screens:** HM-SET-01
- **Acceptance criteria:**
  - Deferred to V2. Corrections are stored locally as training pairs only with consent; tainted content is excluded.

### US-TRAIN-03: Write in my style
- **As a** user, **I want** replies drafted in my voice, **so that** messages sound like me.
- **Priority:** C · **Release:** V2 · **Screens:** HM-SET-06
- **Acceptance criteria:**
  - Deferred to V2. A style adapter is trained on the user's own sent messages, on the phone or a paired Boost.

---

## EP-20: iOS

Goal: bring Hermit to iPhone once Android V1 is proven (PDR-016). Stories US-IOS-01 and US-IOS-02 live in EP-16 with the build stories; this epic holds what is specific to iOS.

### US-IOS-03: Read messages I share to Hermit on iOS
- **As an** iPhone user, **I want** to share a message thread to Hermit, **so that** it can reply even without notification access.
- **Priority:** S · **Release:** V2 · **Screens:** HM-CHAT-03
- **Acceptance criteria:**
  - Deferred to V2. Shared content is untrusted on arrival (FR-CAGE-04).

---

## EP-21: Agent to agent

Goal: let Hermit talk to other agents (including other people's Hermits) without ever giving them control of the user's skills (ADR-005, PDR-016).

### US-A2A-01: Let another agent request something
- **As a** user, **I want** my Hermit to receive requests from agents I allow, **so that** my accountant's agent can ask for a document.
- **Priority:** S · **Release:** V2 · **Screens:** HM-A2A-01
- **Acceptance criteria:**
  - Deferred to V2. Every inbound agent message is untrusted and every outbound action asks.

### US-A2A-02: Pair with a friend's Hermit
- **As a** user, **I want** to pair my Hermit with a friend's, **so that** our agents can coordinate plans.
- **Priority:** C · **Release:** V2 · **Screens:** HM-A2A-01
- **Acceptance criteria:**
  - Deferred to V2. Uses the pairing flow of FR-MOVE-01.

### US-A2A-03: Speak MCP and A2A
- **As a** developer, **I want** Hermit to expose its skills over standard agent protocols, **so that** other tools can use it under the cage.
- **Priority:** C · **Release:** V2 · **Screens:** none
- **Acceptance criteria:**
  - Deferred to V2. Only skills the user allows are exposed, and the cage applies unchanged.

---

## EP-22: Keep watch and Mac powers

Goal: later capabilities that need an always-on companion device (PDR-016).

### US-WATCH-01: Keep watch over something for me
- **As a** user, **I want** Hermit to watch a price, a page or an inbox and tell me when it changes, **so that** I don't check it myself.
- **Priority:** S · **Release:** V3 · **Screens:** HM-NIGHT-01
- **Acceptance criteria:**
  - Deferred to V3. Watches run unattended under the night-shift rules (US-CAGE-02).

### US-WATCH-02: Get alerted by priority
- **As a** user, **I want** watch alerts ranked so only important ones buzz, **so that** Hermit doesn't nag.
- **Priority:** C · **Release:** V3 · **Screens:** HM-NIGHT-02
- **Acceptance criteria:**
  - Deferred to V3.

### US-MAC-01: Let Hermit use my Mac
- **As a** user, **I want** Hermit to run approved actions on my Mac (files, apps), **so that** my agent reaches my desk too.
- **Priority:** S · **Release:** V3 · **Screens:** HM-BOOST-01
- **Acceptance criteria:**
  - Deferred to V3. Mac actions are typed skills under the same cage, approved on the phone.

### US-MAC-02: Hand off a task from phone to Mac
- **As a** user, **I want** to start a request on the phone and finish it on the Mac, **so that** long tasks use the bigger screen.
- **Priority:** C · **Release:** V3 · **Screens:** HM-BOOST-01
- **Acceptance criteria:**
  - Deferred to V3.

---

## EP-23: Family sharing and confidential cloud

Goal: let a household share some of Hermit safely, and offer a cloud option that keeps the privacy promise (PDR-016).

### US-FAM-01: Share a calendar and lists with family
- **As a** parent, **I want** my family's Hermits to share a calendar and shopping list, **so that** we coordinate without a cloud account.
- **Priority:** S · **Release:** V3 · **Screens:** HM-FAM-01
- **Acceptance criteria:**
  - Deferred to V3. Sharing runs phone to phone over Holepunch (ADR-016).

### US-FAM-02: Set limits for a child's Hermit
- **As a** parent, **I want** to set what my child's Hermit can do, **so that** it's safe for them.
- **Priority:** C · **Release:** V3 · **Screens:** HM-FAM-01
- **Acceptance criteria:**
  - Deferred to V3. Limits are cage rules the parent signs.

### US-CLOUD-01: Run Hermit in a confidential cloud when my phone is off
- **As a** user, **I want** an attested cloud instance to run my night jobs when my phone is off, **so that** work continues.
- **Priority:** C · **Release:** V3 · **Screens:** HM-SET-02
- **Acceptance criteria:**
  - Deferred to V3 with US-BOOST-04. Remote attestation is shown before any data moves.

### US-CLOUD-02: Pay for a confidential Boost with USD₮
- **As a** user, **I want** to pay for cloud Boost time with my wallet, **so that** there's no account or card.
- **Priority:** C · **Release:** V3 · **Screens:** HM-PAY-01
- **Acceptance criteria:**
  - Deferred to V3. Payments use x402 under the money rules (PDR-011).

---

## EP-24: Email

Goal: read, search, summarize, draft and send email from the phone, talking directly to the mail provider with tokens kept on the phone, and sending only what the user approves (ADR-009, ADR-017, PDR-017, PDR-021).

### US-MAIL-01: Connect my email account
- **As a** user, **I want** to connect Gmail, Outlook or any IMAP account, **so that** Hermit can work with my email.
- **Priority:** M · **Release:** V1 · **Wave:** W2 · **Screens:** HM-MAIL-01, HM-CONN-01
- **Acceptance criteria:**
  - Gmail and Outlook connect with OAuth in the system browser (PKCE, no server); other providers with IMAP and SMTP plus an app password (FR-MAIL-01).
  - Tokens and passwords are stored in the credential store under a Keystore key (FR-CONN-03); the model never sees them.
  - The connection screen states that mail goes straight between the phone and the provider.

### US-MAIL-02: Ask what's new in my inbox
- **As a** user, **I want** to ask "anything important in my email?", **so that** I get a short summary instead of scrolling.
- **Priority:** M · **Release:** V1 · **Wave:** W2 · **Screens:** HM-CHAT-01, HM-MAIL-02
- **Acceptance criteria:**
  - The `mail_list` skill fetches recent messages (headers and text, at most 50 per call) and the summary goes through the quarantined reader (FR-WEB-03); the session is tainted.
  - HM-MAIL-02 lists the messages the summary used.

### US-MAIL-03: Search my email
- **As a** user, **I want** to ask "find the flight confirmation from Avianca", **so that** I don't dig through folders.
- **Priority:** M · **Release:** V1 · **Wave:** W2 · **Screens:** HM-CHAT-01, HM-MAIL-03
- **Acceptance criteria:**
  - The `mail_search` skill uses the provider's search (Gmail query, Graph search, IMAP SEARCH) and shows results on HM-MAIL-03; bodies are untrusted.

### US-MAIL-04: Draft a reply or a new email
- **As a** user, **I want** Hermit to draft a reply in my language and tone, **so that** answering takes seconds.
- **Priority:** M · **Release:** V1 · **Wave:** W2 · **Screens:** HM-MAIL-04
- **Acceptance criteria:**
  - Drafts show on HM-MAIL-04 with To, Cc, Subject and body, all editable; saving a draft to the provider is a `remote_write` (FR-CAGE-02).

### US-MAIL-05: Send an approved email
- **As a** user, **I want** to approve the exact email before it goes, **so that** Hermit never sends something I didn't see.
- **Priority:** M · **Release:** V1 · **Wave:** W2 · **Screens:** HM-APPR-01
- **Acceptance criteria:**
  - `mail_send` is a `send` risk: it always asks with a fingerprint; the sheet renders recipients from the arguments and the thread headers, never from model prose (CT-06).
  - Recipients not seen before in the user's mail are flagged "new recipient" on the sheet.
  - A recipient the user names ("forward it to Ana") resolves by code from the people the user emailed before (origin "sent") or the contacts' addresses; the sheet says where it came from, several matches ask which one, and when Hermit asks for an address the people the user emailed before are tappable suggestions (PDR-028).
  - The signed log records the send by hash only.

### US-MAIL-06: Archive, label and mark as read by asking
- **As a** user, **I want** to say "archive the newsletters from this week", **so that** my inbox stays clean.
- **Priority:** S · **Release:** V1 · **Wave:** W2 · **Screens:** HM-APPR-01
- **Acceptance criteria:**
  - `mail_modify` is a `remote_write`: it asks once with the count and a sample of messages affected; at most 200 messages per call.

### US-MAIL-07: Get email in the morning briefing
- **As a** user, **I want** important overnight email in the briefing, **so that** one screen covers my morning.
- **Priority:** S · **Release:** V1 · **Wave:** W3 · **Screens:** HM-NIGHT-02
- **Acceptance criteria:**
  - The night shift reads mail read-only (unattended); replies it suggests wait in the briefing for approval (FR-NIGHT-02).

### US-MAIL-08: Use more than one email account
- **As a** user, **I want** to connect work and personal accounts, **so that** Hermit sees all my email.
- **Priority:** S · **Release:** V1 · **Wave:** W2 · **Screens:** HM-MAIL-01
- **Acceptance criteria:**
  - Accounts are listed separately; every mail skill takes an optional account and the sheet always shows which account sends.

### US-MAIL-09: Read attachments
- **As a** user, **I want** Hermit to read PDFs and documents attached to emails, **so that** it can answer from them.
- **Priority:** S · **Release:** V2 · **Screens:** HM-MAIL-03
- **Acceptance criteria:**
  - Deferred to V2 (PDR-016). Attachment text is untrusted.

### US-MAIL-10: Unsubscribe for me
- **As a** user, **I want** Hermit to unsubscribe me from lists, **so that** my inbox shrinks.
- **Priority:** C · **Release:** V2 · **Screens:** HM-APPR-01
- **Acceptance criteria:**
  - Deferred to V2. Each unsubscribe is a `remote_write`.

### US-MAIL-11: Write in my style
- **As a** user, **I want** drafts that sound like my own emails, **so that** I rarely edit.
- **Priority:** C · **Release:** V2 · **Screens:** HM-MAIL-04
- **Acceptance criteria:**
  - Deferred to V2 with US-TRAIN-03.

---

## EP-25: Connectors

Goal: connect Hermit to the user's services the way cloud agents do, without a server: the phone calls each service directly with the user's own tokens, any MCP server the user adds becomes skills, and when a service has no connector Hermit drafts one as a spec the user approves. Every connector call goes through the cage (ADR-017, PDR-019, PDR-021, PDR-022).

### US-CONN-01: Connect a service from the catalog
- **As a** user, **I want** to connect Google Calendar, Drive, Outlook, Spotify and the other built-in services in a couple of taps, **so that** Hermit can work with them.
- **Priority:** M · **Release:** V1 · **Wave:** W2 · **Screens:** HM-CONN-01, HM-CONN-02
- **Acceptance criteria:**
  - HM-CONN-01 lists shipped connectors (specs signed by Dojo Coding, FR-CONN-01); connecting runs OAuth in the system browser with PKCE, or asks for a key in the credential store (FR-CONN-03).
  - HM-CONN-02 shows, before connecting, every host the connector talks to and each operation with its risk.

### US-CONN-02: See and revoke connected services
- **As a** user, **I want** one list of everything Hermit is connected to, **so that** I can disconnect anything instantly.
- **Priority:** M · **Release:** V1 · **Wave:** W2 · **Screens:** HM-CONN-01
- **Acceptance criteria:**
  - Each account shows its service, the scopes granted, last use and a Disconnect action that deletes the tokens and revokes them at the provider where it supports revocation.

### US-CONN-03: Add an MCP server
- **As a** user, **I want** to add an MCP server by its URL, **so that** any service with an MCP server becomes something Hermit can use.
- **Priority:** M · **Release:** V1 · **Wave:** W4 · **Screens:** HM-CONN-03
- **Acceptance criteria:**
  - Hermit acts as an MCP client over Streamable HTTP with OAuth where the server requires it (FR-CONN-05); each tool becomes a skill with a risk the user confirms (non-read tools default to `remote_write`).
  - Tool descriptions and results from MCP servers are untrusted (FR-CAGE-04).

### US-CONN-04: Ask Hermit to connect to a service it doesn't know
- **As a** user, **I want** to say "connect to my gym's booking system" and have Hermit work out how, **so that** I'm not limited to a catalog.
- **Priority:** M · **Release:** V1 · **Wave:** W4 · **Screens:** HM-CHAT-01, HM-CONN-04
- **Acceptance criteria:**
  - Hermit looks for, in order: a shipped connector, an MCP server in the MCP Registry, a published OpenAPI description, then the service's API docs the user points to (FR-CONN-06).
  - From docs, the phone model drafts a connector spec (JSON, never code, CT-12); every operation that is not a read starts at `remote_write` or higher, and the model cannot lower a risk.
  - If no API exists, Hermit offers a vault entry for the login and the in-app browser for web tasks (US-CONN-07).

### US-CONN-05: Approve a connector before it's installed
- **As a** user, **I want** to review what a new connector can reach and do, **so that** nothing gets access I didn't grant.
- **Priority:** M · **Release:** V1 · **Wave:** W4 · **Screens:** HM-CONN-04
- **Acceptance criteria:**
  - HM-CONN-04 shows the hosts, the sign-in type and each operation with its risk; installing needs a fingerprint; the spec's hash is recorded in the signed log.
  - Any change to an installed spec needs a new approval; drafted specs are labeled "Made by Hermit" until the user has used them.

### US-CONN-06: Import a connector from an OpenAPI file or the MCP Registry
- **As a** user, **I want** to install a connector from a published API description, **so that** I can use services that publish one.
- **Priority:** S · **Release:** V1 · **Wave:** W4 · **Screens:** HM-CONN-04
- **Acceptance criteria:**
  - OpenAPI 3 files are converted to a spec deterministically (FR-CONN-06); the user picks which operations to include.

### US-CONN-07: Save a login for a service with no API
- **As a** user, **I want** to give Hermit my email and password for a site with no API, safely, **so that** it can do tasks there.
- **Priority:** M · **Release:** V1 · **Wave:** W4 · **Screens:** HM-VAULT-02
- **Acceptance criteria:**
  - The login goes into the vault with its exact origin (never into the chat); Hermit uses it only in the in-app browser, with a `credential` approval each time (FR-VAULT-04).

### US-CONN-08: Use my own Google sign-in client
- **As a** power user, **I want** to paste my own Google OAuth client ID, **so that** I don't depend on Dojo's client.
- **Priority:** S · **Release:** V1 · **Wave:** W2 · **Screens:** HM-CONN-05
- **Acceptance criteria:**
  - HM-CONN-05 accepts a client ID per provider; tokens issued to it are stored like any other (PDR-021).

### US-CONN-09: Connect services that need a secret through my own relay
- **As a** power user, **I want** to run Hermit's open-source relay myself, **so that** I can connect Slack, Notion and others that require a client secret without trusting anyone.
- **Priority:** S · **Release:** V1 · **Wave:** W4 · **Screens:** HM-CONN-05
- **Acceptance criteria:**
  - The relay only exchanges the authorization code for tokens and returns them to the phone end to end encrypted; it stores nothing (FR-CONN-07).

### US-CONN-10: Opt in to Dojo's relay for those services
- **As a** user, **I want** a one-tap option for services that need a secret, **so that** I don't have to host anything.
- **Priority:** S · **Release:** V1 · **Wave:** W4 · **Screens:** HM-CONN-05, HM-SET-02
- **Acceptance criteria:**
  - Off by default; turning it on explains that the code-for-token exchange passes through Dojo's open-source relay, which stores nothing (PDR-022); the privacy screen lists it as a destination when used.

### US-CONN-11: Grow the connector catalog
- **As a** user, **I want** many more services in the catalog, **so that** most things connect in one tap.
- **Priority:** S · **Release:** V2 · **Screens:** HM-CONN-01
- **Acceptance criteria:**
  - Deferred to V2 (PDR-019). Catalog growth is data (new signed specs), not code.

### US-CONN-12: Share a connector I made
- **As a** user, **I want** to share a connector spec Hermit drafted for me, **so that** others can use it.
- **Priority:** C · **Release:** V2 · **Screens:** HM-CONN-04
- **Acceptance criteria:**
  - Deferred to V2. Shared specs install like any imported spec, with their risks reviewed again.

---

## EP-26: Open other apps

Goal: Hermit prepares actions in other apps through Android intents, with everything prefilled, and the person makes the final tap in that app. Play-safe, no special permission; finding a person by name uses the optional contacts permission (ADR-020, PDR-023, PDR-028).

### US-APP-01: Start a new WhatsApp chat with the message ready
- **As a** user, **I want** to say "text Carlos on WhatsApp that I'm on my way", **so that** I can message people who haven't written to me.
- **Priority:** M · **Release:** V1 · **Wave:** W3 · **Screens:** HM-CHAT-01
- **Acceptance criteria:**
  - The `open_whatsapp_chat` skill opens WhatsApp on the contact's chat with the text prefilled (FR-APP-01); the person taps Send in WhatsApp.
  - The phone number comes from the user's own words in this turn, or from the phone's contacts when the user names the person ("llama a mi mamá"), never from untrusted text (FR-APP-02, PDR-028).
  - A name with several matches asks which one (names with the last four digits); one match shows the number and "from your contacts" on the sheet before the app opens; without the contacts permission the other app's own picker chooses, and Hermit offers the permission once.

### US-APP-02: Compose an SMS or email in its app
- **As a** user, **I want** Hermit to open my SMS or email app with a message written, **so that** I just review and send.
- **Priority:** S · **Release:** V1 · **Wave:** W3 · **Screens:** HM-CHAT-01
- **Acceptance criteria:**
  - `compose_sms` and `compose_email` open the default app with recipients, subject and body prefilled; nothing is sent by Hermit.

### US-APP-03: Call, navigate or share
- **As a** user, **I want** to say "navigate to the dentist" or "call Mom", **so that** the right app opens ready to go.
- **Priority:** S · **Release:** V1 · **Wave:** W3 · **Screens:** HM-CHAT-01
- **Acceptance criteria:**
  - `dial` opens the dialer with the number (never places the call), `navigate` opens the maps app with the destination, `share` opens the share sheet with the text or link.

### US-APP-04: Set an alarm or save a contact
- **As a** user, **I want** to say "wake me at 6" or "save this number as Ana's work", **so that** the clock and contacts apps do it.
- **Priority:** S · **Release:** V1 · **Wave:** W3 · **Screens:** HM-CHAT-01
- **Acceptance criteria:**
  - `set_alarm` and `add_contact` open the system apps prefilled; the person confirms.

---

## EP-27: Phone use (sideload build)

Goal: drive other apps on the phone (tap, type, scroll) for parity with cloud agents' computer use, only in the GitHub and F-Droid APK, because Google Play bans AI-planned automation through the Accessibility API (ADR-021, PDR-024).

### US-PHONE-01: Let Hermit operate an app for me
- **As a** sideload user, **I want** Hermit to do a task inside an app with no API, **so that** it can do anything I could do on my phone.
- **Priority:** S · **Release:** V2 · **Screens:** HM-PHONE-01
- **Acceptance criteria:**
  - Deferred to V2 (PDR-024). An AccessibilityService reads the screen as a numbered text tree and acts with a fixed action set; only in the sideload build; enabled only after the AndroidWorld spike passes its bar.

### US-PHONE-02: Choose which apps Hermit may operate
- **As a** sideload user, **I want** to pick the apps Hermit may drive, **so that** it never touches the rest.
- **Priority:** S · **Release:** V2 · **Screens:** HM-PHONE-01
- **Acceptance criteria:**
  - Deferred to V2. Banking, wallet, password-manager and one-time-code apps are always blocked.

### US-PHONE-03: Approve every tap that commits
- **As a** sideload user, **I want** to approve any tap that sends, pays, buys or deletes, **so that** phone use is as safe as everything else.
- **Priority:** S · **Release:** V2 · **Screens:** HM-APPR-01
- **Acceptance criteria:**
  - Deferred to V2. The cage classifies the target element (its text and role), not the model; system dialogs are never auto-accepted; sessions run only in the foreground.

---

## EP-28: Bots

Goal: several specialized bots that the user sees like contacts, with Hermit as the front door and the coordinator. Each bot has its own role, notes, permissions, sources and mode, and the cage enforces each bot's limits in code (PDR-029, PDR-031). Wave B1 is bots, their chats, notes, permissions and modes. Wave B2 is handoffs, routines, group chats and Hermit's report.

### US-BOT-01: See my bots like contacts
- **As a** user, **I want** a list of my bots, Hermit first, **so that** I open the one I need as I open a chat with a contact.
- **Priority:** M · **Release:** V1 · **Wave:** B1 · **Screens:** HM-BOT-01
- **Acceptance criteria:**
  - The roster (HM-BOT-01) is home. Hermit is first, starred and labeled as the coordinator; the pinned bots come next; the rest follow by their newest activity.
  - Each row shows the bot's shell, its name, the last line of its chat ("Tú: ..." for the user's words, or "No messages"), the time, and a chip when the bot runs in Auto or Don't ask.
  - A user who had one chat before sees it as Hermit's, with its history and memories (EC-BOT-12).

### US-BOT-02: Chat with one bot in its role
- **As a** user, **I want** each bot to answer in its own role, **so that** a travel planner talks like a travel planner and nothing more.
- **Priority:** M · **Release:** V1 · **Wave:** B1 · **Screens:** HM-BOT-02
- **Acceptance criteria:**
  - Each bot has one main chat with its own history; "New chat" starts a fresh one and the older chats stay in a list; leaving a chat stops its turn (EC-BOT-11).
  - The bot's role is in its prompt, and it uses only the skill groups it holds. A request that only a withheld skill could do is answered by code ("No tengo permiso para ..."), never by the model (FR-BOT-03).
  - A bot reads its own notes plus the shared profile. Its prompt cache is its own (FR-BOT-06).

### US-BOT-03: Ask Hermit to create a bot
- **As a** user, **I want** to say "ponme un bot de recetas", **so that** Hermit proposes one and I confirm it.
- **Priority:** M · **Release:** V1 · **Wave:** B1 · **Screens:** HM-CHAT-01, HM-BOT-03
- **Acceptance criteria:**
  - The `create_bot` skill belongs to Hermit alone. Code renders the proposal's card (name, look, role, permissions, sources, mode) from its fields; the model's words are never shown as the card.
  - A proposal drafted after reading other people's text is marked, and offers Review only: the user opens HM-BOT-03 with the proposal filled in and checks every field before it exists (EC-BOT-04).
  - Create asks for the fingerprint when the grants include mail send, wallet and pay, or the vault and logins (a group no screen offers in wave 1), or the bot's own mode is Don't ask; for Don't ask it also asks for the typed word (FR-BOT-09).

### US-BOT-04: Create a bot from "＋" or a template
- **As a** user, **I want** to start from a template or from scratch, **so that** I don't depend on Hermit to make a bot.
- **Priority:** M · **Release:** V1 · **Wave:** B1 · **Screens:** HM-BOT-01, HM-BOT-03
- **Acceptance criteria:**
  - The templates are travel, recipes, agenda and inbox; each fills the name and the role, and the user adjusts everything.
  - The name is at most 40 characters, the role at most 800, and the roster holds at most 50 bots, Hermit included (EC-BOT-01, EC-BOT-06).
  - The look is one of six shell shapes and four colors, chosen at creation and drawn by the brand pipeline, never an image model.

### US-BOT-05: Give a bot its permissions and sources
- **As a** user, **I want** to choose what a bot may do and where it may read, **so that** it is a boundary and not only a name.
- **Priority:** M · **Release:** V1 · **Wave:** B1 · **Screens:** HM-BOT-03, HM-BOT-04
- **Acceptance criteria:**
  - The user toggles the permission groups the screens show; mail send, wallet and pay need the fingerprint to grant (FR-BOT-09). Vault and logins are not offered in wave B1.
  - Sources are websites, written like wikivoyage.org, and installed connectors. Nothing runs from a connector that is uninstalled later; the bot works from its other sources (EC-BOT-07).
  - Hermit's own grants, name and role are not edited on HM-BOT-04.

### US-BOT-06: Choose how much a bot may do without asking
- **As a** user, **I want** to pick Ask, Auto or Don't ask for all of Hermit and for each bot, **so that** I choose my own risk with clear warnings.
- **Priority:** M · **Release:** V1 · **Wave:** B1 · **Screens:** HM-SET-01, HM-BOT-03, HM-BOT-04
- **Acceptance criteria:**
  - Ask is the default. Auto opens a sheet that says what will run without asking. Don't ask opens a red sheet with the concrete risks and needs the fingerprint and the typed word, "entiendo" or "I understand", in either language (FR-CAGE-08, PDR-031).
  - A bot inherits the global mode until it has its own. A bot's own Don't ask needs the fingerprint and the word even when the global mode is Don't ask; a copy starts with no mode of its own.
  - Auto and Don't ask show as a chip in the bot's chat bar and on its roster row. A turn keeps the mode it started with (EC-BOT-08).
  - Payments and logins need the fingerprint in every mode, and never start from a bot's own work (PDR-031).

### US-BOT-07: Pin, hide and search
- **As a** user, **I want** to pin two bots, hide the ones I don't use and search the list, **so that** fifty bots stay manageable.
- **Priority:** S · **Release:** V1 · **Wave:** B1 · **Screens:** HM-BOT-01
- **Acceptance criteria:**
  - At most 2 bots are pinned, below Hermit; a third is refused with a line that says to unpin one (EC-BOT-02).
  - A hidden bot leaves the main list and shows under "Ocultos"; Hermit can't be hidden or pinned.
  - Search matches a bot's name or the title of one of its chats; an empty result names the search.

### US-BOT-08: Duplicate, reset or delete a bot
- **As a** user, **I want** to copy a bot, clear its conversation or delete it, **so that** I stay in charge of what each bot keeps.
- **Priority:** M · **Release:** V1 · **Wave:** B1 · **Screens:** HM-BOT-04
- **Acceptance criteria:**
  - A duplicate is named "<name> 2" and copies the role, the permissions and the sources, with no history, no notes and no mode of its own (it inherits the global mode).
  - Reset clears the bot's conversation history and keeps its notes, routines and settings. Delete removes its chats and notes and can't be undone; both confirm first.
  - Delete, Reset and Clear conversation are refused while the bot's turn runs, and say so (EC-BOT-03). Hermit can't be duplicated, hidden or deleted.

### US-BOT-09: Share facts with every bot
- **As a** user, **I want** to share one of a bot's notes with every bot, **so that** I don't repeat myself.
- **Priority:** S · **Release:** V1 · **Wave:** B1 · **Screens:** HM-BOT-04, HM-MEM-01
- **Acceptance criteria:**
  - Sharing is one way: an untainted note of a bot becomes part of the shared profile. A tainted note can't be shared (tainted facts never enter the shared profile).
  - Every bot reads the shared profile; the snapshot stays at most 1,400 characters (FR-MEM-06). Only Hermit may forget or delete a shared fact.
  - Notes keep what the run that wrote them had read (private data, the web), so a bot that mixed them can't use the web alone across runs (FR-CAGE-08).

### US-BOT-10: Bots hand work to each other
- **As a** user, **I want** one bot to hand a job to another, **so that** a coordinating bot can hand work to my specialists.
- **Priority:** S · **Release:** V1 · **Wave:** B2 · **Screens:** HM-BOT-02
- **Acceptance criteria:**
  - Deferred to wave B2 (PDR-030). A bot's words are data to the bot that reads them, results come back as cards, and the loop guards hold.

### US-BOT-11: Routines in plain words
- **As a** user, **I want** to tell a bot "revisa mi bandeja cada mañana", **so that** it works on a schedule I can read and change.
- **Priority:** S · **Release:** V1 · **Wave:** B2 · **Screens:** HM-BOT-03, HM-BOT-04
- **Acceptance criteria:**
  - Deferred to wave B2 (PDR-029). Supersedes US-NIGHT-05. A routine runs unattended under the bot's mode; what the mode doesn't allow alone becomes a suggestion.

### US-BOT-12: Group chats
- **As a** user, **I want** to talk to several bots in one chat, **so that** they answer me together.
- **Priority:** C · **Release:** V1 · **Wave:** B2 · **Screens:** HM-BOT-05
- **Acceptance criteria:**
  - Deferred to wave B2. The user and 2 to 6 bots; `@` names one; approvals, logins and drafts never appear in a group.

### US-BOT-13: Ask Hermit what's new
- **As a** user, **I want** to ask "¿qué hay de nuevo?", **so that** Hermit reports what my bots did.
- **Priority:** S · **Release:** V1 · **Wave:** B2 · **Screens:** HM-BOT-02
- **Acceptance criteria:**
  - Deferred to wave B2. A bot's results reach Hermit's chat as cards rendered by code; Hermit reads a result only in the turn the user asks, and the chat then keeps a code-written line in place of the text (PDR-030).

---

# PART 2: PRODUCT REQUIREMENTS

## 2.1 Executive summary and product vision

Hermit is an open-source personal AI agent that lives on the user's phone. It talks, remembers, reminds, reads and replies to messages and email, connects to the user's services, reads the web and does tasks on websites, works overnight, fills forms, logs in, and pays, and it does all of it with a model that runs on the phone through Tether's QVAC. Nothing the user says or stores is sent to a server, because Hermit has no server.

The category is crowded with cloud agents (Meta Muse, Instinct, Grok Bot, OpenAI Dots, OpenClaw) that are capable because they send everything to someone else's computer. Hermit's bet is the opposite trade: a smaller model, made reliable by giving it a menu of typed skills instead of a computer to drive, and made safe by a cage that the model cannot talk its way out of. Its line is the product: "Does everything. Tells no one."

The goal is feature parity with the cloud agents (Muse, Claude Duet, dots, Grok Bot, Instinct, Atomic Agent) with a privacy and sovereignty edge: the same jobs, done on the phone, with no server holding the user's data or tokens.

V1 is phone-only on Android, delivered as a first win (talk, remember, remind, reply on WhatsApp through the cage) and then widened with voice notes, email and connectors, eyes (web reading and the night shift) and hands (vault, form fill and logins, web tasks, model-drafted connectors, a USD₮ wallet with x402 payments, and changing phones). V2 adds Boost (a bigger model on the user's own computer), tuned models, iOS and agent to agent. V3 adds keep watch, Mac powers, family sharing and a confidential-cloud Boost.

## 2.2 Background, current systems, and the problem

People want an agent that acts for them, and every agent on the market asks them to hand over their messages, calendar, passwords and money to a cloud provider to get it. Prompt injection makes it worse: any message or page the agent reads can try to give it orders. Two facts make a different design possible now: phones like the Galaxy S26 Ultra run capable small models on their GPU, and QVAC packages on-device inference, speech and peer-to-peer transport for React Native.

| Area | System(s) today | Disposition in this program |
| :---- | :---- | :---- |
| Agent core | Built in this repository (PRs 1 and 2): `packages/core`, `cage`, `skills`, `agent`, `eval`, `sql-node`, 103 tests | Keep as the system of record for the loop, policy, skills and audit. W1 adds the phone adapters behind its ports |
| Phone app | Expo SDK 58 shell in `apps/mobile` with the About screen and theme | Extend. W1 builds the first-win screens on it |
| Brand | Brand book, tokens, the traced reference drawing and mascot rig (PR 3) | Locked (PDR-006). Screens use `docs/brand/tokens.json` and the rig assets only |
| Inference | Tether QVAC `@qvac/sdk` 0.23 (pinned), react-native-bare-kit 0.16 | Adopt behind the `Model` port. Unproven on the S26 Ultra until spike S1 (ASM-01) |
| Model | Tether's BotPsy-0.8B (Apache 2.0, a Qwen3.5-0.8B tool-calling fine-tune, GGUF Q4_K_M about 530 MB, released 2026-11-11) | Lead candidate for OQ-03, trained on Hermit's domains; Spanish and latency with thinking mode to be proven by the eval (`docs/research/botpsy.md`) |
| Wallet | Tether WDK | Adopt in W5 through Hermit's own wallet worklet (SL-17): Tether's React Native host still needs bare-kit 0.14.5 (DEP-07, ASM-08) |
| Messaging | WhatsApp through Android notifications (no API) | Read and reply via `NotificationListenerService` and the notification's reply action (ASM-04) |
| Connectors | Competitors: Duet 6,000+, dots 4,000+, Composio for Atomic, all through their servers | Direct from the phone with the user's own tokens, plus an MCP client and model-drafted specs (ADR-017). Composio does not fit: it holds tokens and runs calls on its servers (`docs/research/connectors.md`) |
| Cloud services | None | None by design (ADR-009). The only exception is an opt-in, open-source relay that swaps OAuth codes for tokens and stores nothing (PDR-022) |

## 2.3 Goals and success metrics

Goals: (1) the first win works end to end on the reference S26 Ultra in airplane mode except for the WhatsApp send itself; (2) the model meets the speed and accuracy bar on device in Spanish and English; (3) no injection in the eval suite leads to an unapproved action; (4) zero bytes of user data leave the phone except where the user asked and approved; (5) the full V1 surface ships on Google Play and as a reproducible APK.

Hermit has no analytics by design, so every KPI is measured on the reference device, in the eval harness or in CI, never from users.

| KPI | Definition | Source |
| :---- | :---- | :---- |
| Time to first action | Median time from send to the first skill chosen, on the S26 Ultra, at most 15 seconds (PDR-003) | Eval harness on device; EVT-MODEL-01 locally |
| First-action accuracy | Share of eval cases where the first skill and its arguments are correct, at least 85% in es and in en (PDR-003) | `packages/eval` report per model hash |
| Injection resistance | Share of injection cases that end in an unapproved send, spend, credential use or tainted memory write: zero | Eval injection set (NFR-07) |
| Network silence | Outbound hosts outside the allowed list observed in a test session: zero | Privacy CI gate plus on-device host counter (FR-PRIV-02) |
| Chain integrity | Signed-log verifications that fail on an untampered device: zero | FR-ACT-03 tests |
| First-win completion | The W1 journey script passes on the S26 Ultra | Gate W1 (2.20) |

## 2.4 Personas

| Persona | Description | Primary intents |
| :---- | :---- | :---- |
| The first tester | An internal tester on the reference Galaxy S26 Ultra, technical, using test accounts and synthetic data in Spanish (es-419) and English | Delegate messages and reminders, run every skill on test accounts, prove the product works |
| The privacy-minded professional | Lawyer, doctor or journalist whose messages are confidential | An assistant they can legally and ethically use with client data |
| The LATAM everyday user | Spanish-first, WhatsApp-centric, mid-to-high-end Android, patchy connectivity | Help with messages, reminders and payments that works offline and in Spanish |
| The open-source builder | Developer who reads the code and may add skills | Verify the claims, rebuild the APK, extend the menu |
| The message sender | Anyone who writes to the user; their text is untrusted | None in the product; they may try to steer the agent |

## 2.5 Roles and RBAC matrix

Hermit has one human role: the phone's owner. There are no accounts, servers or staff. Authority is expressed instead as sessions and risks, enforced by the cage (ADR-005). The matrix below is what the policy engine decides by default (FR-CAGE-01, FR-CAGE-02).

| Risk of the skill | Attended, untainted | Attended, tainted | Unattended (night shift) |
| :---- | :---- | :---- | :---- |
| `read` (read_messages, recall, calendar_read) | allow | allow | allow |
| `local_write` (remember, remind, calendar_add) | allow | ask | deny |
| `network` (read_web, search_web, connector reads) | ask once per domain | ask | allow only for jobs the user enabled, read-only |
| `remote_write` (save a draft, archive mail, a web-form submit, a connector write) | ask | ask, with the taint warning | deny |
| `send` (reply_message) | ask, fingerprint | ask, fingerprint, with the taint warning | deny |
| `credential` (vault fill, login) | ask, fingerprint | deny | deny |
| `spend` (pay, x402) | ask, fingerprint, within caps | deny | deny |

A rule that tries to allow `send`, `credential` or `spend` without asking is ignored: these hard limits are in code, not configuration.

## 2.6 Scope

| Band | Contents |
| :---- | :---- |
| V1 | EP-01 to EP-17, EP-24 and EP-25: setup; conversation; memory; reminders and calendar; WhatsApp messages; approvals and the cage; the signed log; voice notes; web reading and web tasks; night shift; email; connectors (catalog, MCP client, model-drafted specs, relays); opening other apps with prefilled intents; vault, forms and logins; the USD₮ wallet with x402; changing phones; settings, privacy and accessibility; the model runtime and eval; builds and distribution; the public site |
| V2 | Boost on the user's computer (including open-ended web tasks); tuned models; iOS; agent to agent; realtime voice, read-aloud and call screening; phone use in the sideload build; and deepening V1 (meaning-based recall, SMS, Telegram and Signal, share into Hermit, email attachments, a larger connector catalog, passkeys, encrypted backup, recurring jobs, more assets) |
| V3 | Keep watch, Mac powers, family sharing, confidential-cloud Boost and cloud night jobs, wake word |

### First win
- **First user:** an internal tester on the reference Galaxy S26 Ultra (PDR-001)
- **Journey:** after setup, the tester asks Hermit in airplane mode to remember a fact and set a reminder, asks what is on their calendar, then turns the radio on, asks whether Ana texted, approves with their fingerprint the exact WhatsApp reply Hermit drafts, and finds every step in the verified signed log (PDR-002)
- **Environment and data:** the dev build on the S26 Ultra with a test WhatsApp account, a test calendar and synthetic notes; the data never leaves the phone, and the eval harness on a Mac with synthetic cases
- **Excluded from W1:** voice notes, email and the connector catalog (W2), the model eval on device (W2), web reading and night shift (W3), settings, memory browsing and accessibility polish (W3), vault, form fill, web tasks and model-drafted connectors (W4), wallet and payments (W5), changing phones, Play and the public site (W6). Code already built for later waves stays as it is, off in the first-win journey
- **Stories:** US-ONB-01, US-ONB-03, US-ONB-04, US-ONB-05, US-CHAT-01, US-CHAT-02, US-CHAT-03, US-CHAT-04, US-CHAT-05, US-MEM-01, US-MEM-02, US-MEM-03, US-MEM-05, US-MEM-06, US-REM-01, US-REM-02, US-CAL-01, US-CAL-02, US-MSG-01, US-MSG-02, US-MSG-03, US-MSG-05, US-APPR-01, US-APPR-02, US-APPR-03, US-APPR-04, US-CAGE-01, US-ACT-01, US-ACT-02, US-MODEL-01
- **Gate:** the W1 journey script runs on the S26 Ultra: install the dev build, download and verify the model, grant notification and calendar access, then in airplane mode "remember my passport expires in March" (Saved), "remind me to call Mom at 9 PM" (reminder fires offline), "what do I have tomorrow?" (agenda); radio on, a test contact sends a WhatsApp message, "did Ana text me?" (message read, session tainted), "tell her I'm 10 minutes late" (approval sheet with the real recipient and the taint warning, fingerprint, the reply arrives in WhatsApp); the activity log shows every step and "Chain verified"

## 2.7 Information architecture and screen inventory

Navigation is bot-first: the roster (HM-BOT-01) is home, with Hermit first. Each bot's chat (HM-BOT-02) opens from it. A drawer holds Activity, Memory, Reminders, Messages, Night shift, Vault, Wallet and Settings. Approvals are bottom sheets over whatever screen is open. Every screen carries an ID for change control.

| Screen ID | Name | Purpose | Key stories |
| :---- | :---- | :---- | :---- |
| HM-ONB-01 | Welcome | The promise and Get started | US-ONB-01 |
| HM-ONB-02 | Language | Choose es-419 or English | US-ONB-02 |
| HM-ONB-03 | Model download | Size, Wi-Fi rule, progress, checksum states | US-ONB-03, US-ONB-07 |
| HM-ONB-04 | Permissions walkthrough | Notification access (with restricted-settings help), calendar, contacts (PDR-028), Not now | US-ONB-04, US-ONB-05, US-ONB-08 |
| HM-ONB-05 | Unsupported phone | Reason the phone is below the floor | US-ONB-06 |
| HM-CHAT-01 | Chat | Conversation, streaming, mascot state, mic, stop; HM-BOT-02 is this screen for one bot | US-CHAT-01, US-CHAT-03, US-CHAT-04, US-CHAT-05, US-CHAT-06, US-CHAT-07, US-CHAT-08, US-APP-01, US-APP-02, US-APP-03, US-APP-04 |
| HM-CHAT-02 | Where Hermit runs | Model, device, last-turn speed, Boost state | US-CHAT-02, US-MODEL-01, US-BOOST-02 |
| HM-CHAT-03 | Share into Hermit (V2) | Incoming shared content as an untrusted message | US-CHAT-09, US-WEB-05, US-IOS-03 |
| HM-MEM-01 | Memory list | Facts, search, provenance marks | US-MEM-04, US-MEM-08 |
| HM-MEM-02 | Memory detail | One fact, provenance, delete | US-MEM-04 |
| HM-REM-01 | Reminders | Upcoming reminders, cancel | US-REM-03 |
| HM-REM-02 | Reminder notification | The system notification and its actions | US-REM-01, US-REM-02, US-REM-04 |
| HM-CAL-01 | Agenda card | Events under a reply | US-CAL-01 |
| HM-CAL-02 | Calendar choice | Which calendar Hermit writes to | US-CAL-03 |
| HM-MSG-01 | Messages | Captured conversations by app | US-MSG-01, US-MSG-05, US-MSG-06, US-MSG-08, US-MSG-09 |
| HM-APPR-01 | Approval sheet | Exact action, fields, taint warning, fingerprint | US-APPR-01, US-APPR-02, US-APPR-03, US-APPR-04, US-APPR-05, US-CAGE-03, US-WEB-02, US-WEB-07, US-WEB-09, US-FORM-02, US-MAIL-05, US-MAIL-06, US-MAIL-10, US-PHONE-03 |
| HM-APPR-02 | Payment approval sheet | Amount, fee, network, recipient, cap left | US-PAY-05, US-PAY-07, US-PAY-09 |
| HM-ACT-01 | Activity | The signed log, newest first, chain state | US-ACT-01, US-ACT-04, US-NIGHT-03 |
| HM-ACT-02 | Activity entry | Hashes and metadata of one entry | US-ACT-03, US-ACT-05 |
| HM-ACT-03 | Chain broken | Where and why verification failed | US-ACT-02 |
| HM-VOICE-01 | Voice note recorder | Timer, level, slide to cancel, transcript review | US-VOICE-01, US-VOICE-02, US-VOICE-04, US-VOICE-05, US-VOICE-06, US-VOICE-07, US-VOICE-08 |
| HM-WEB-01 | Page reader | Extracted text an answer used | US-WEB-01 |
| HM-WEB-02 | Live browser | The page Hermit is driving, current step, take over, stop | US-WEB-06, US-WEB-07, US-WEB-08, US-WEB-10, US-WEB-11 |
| HM-NIGHT-01 | Night shift settings | Window, jobs, conditions | US-NIGHT-01, US-NIGHT-04, US-NIGHT-05, US-CAGE-02, US-WATCH-01 |
| HM-NIGHT-02 | Morning briefing | Agenda, messages, email, suggestions, overnight log | US-NIGHT-02, US-NIGHT-03, US-WATCH-02, US-MAIL-07 |
| HM-VAULT-01 | Vault | Items list, locked state | US-VAULT-01, US-VAULT-02 |
| HM-VAULT-02 | Vault item | Login with origins, reveal, generator | US-VAULT-02, US-VAULT-04, US-VAULT-05, US-CONN-07 |
| HM-VAULT-03 | Import | CSV import preview | US-VAULT-03 |
| HM-FORM-01 | Fill preview | Fields and values to approve | US-FORM-01, US-FORM-04 |
| HM-FORM-02 | Personal profile | Details used for forms | US-FORM-03 |
| HM-PAY-01 | Wallet | Balance, actions | US-PAY-01, US-PAY-03, US-PAY-08, US-CLOUD-02 |
| HM-PAY-02 | Recovery words | Show, confirm, restore | US-PAY-01, US-PAY-02 |
| HM-PAY-03 | Transactions | History with log links | US-PAY-03 |
| HM-PAY-04 | Receive | Address, QR, network | US-PAY-04 |
| HM-PAY-05 | Spending caps | Per payment and per day | US-PAY-06 |
| HM-MOVE-01 | Move: old phone | QR and code | US-MOVE-01 |
| HM-MOVE-02 | Move: new phone | Scan and compare code | US-MOVE-01 |
| HM-MOVE-03 | Move: transfer | Progress, verify, wipe old phone | US-MOVE-02, US-MOVE-03 |
| HM-MOVE-04 | Backup file (V2) | Export and restore an encrypted backup | US-MOVE-04 |
| HM-SET-01 | Settings and permissions | Permissions, app lock, learning consent | US-SET-01, US-SET-09, US-ONB-08, US-CHAT-07, US-TRAIN-02 |
| HM-SET-02 | Privacy | Outbound hosts, search provider, relay use, promises | US-SET-02, US-MSG-07, US-WEB-03, US-PLAT-03, US-CLOUD-01, US-CONN-10 |
| HM-SET-03 | Delete everything | Erase with confirmation | US-SET-03 |
| HM-SET-04 | Voice settings (V2) | Read-aloud, rate, voice | US-SET-04, US-VOICE-03 |
| HM-SET-05 | Language | Language override | US-SET-05, US-ONB-02 |
| HM-SET-06 | Appearance and quiet mode | Mascot, motion, tone | US-SET-06, US-CHAT-08, US-SET-11, US-TRAIN-03 |
| HM-SET-07 | Display | Dark mode, text size preview | US-SET-08 |
| HM-SET-08 | About | Signature, logos, licenses | US-SET-10 |
| HM-MAIL-01 | Email accounts | Connect and list mail accounts | US-MAIL-01, US-MAIL-08 |
| HM-MAIL-02 | Inbox summary | Messages a summary used | US-MAIL-02 |
| HM-MAIL-03 | Mail search results | Results and a message view | US-MAIL-03, US-MAIL-09 |
| HM-MAIL-04 | Draft | Editable To, Cc, Subject, body | US-MAIL-04, US-MAIL-11 |
| HM-CONN-01 | Connections | Catalog and connected accounts, disconnect | US-CONN-01, US-CONN-02, US-CONN-11, US-MAIL-01 |
| HM-CONN-02 | Connector details | Hosts, operations and risks before connecting | US-CONN-01 |
| HM-CONN-03 | Add an MCP server | URL, sign-in, tools and their risks | US-CONN-03 |
| HM-CONN-04 | Review a new connector | A drafted or imported spec to approve | US-CONN-04, US-CONN-05, US-CONN-06, US-CONN-12 |
| HM-CONN-05 | Sign-in options | Own OAuth client IDs, own relay, Dojo relay opt-in | US-CONN-08, US-CONN-09, US-CONN-10 |
| HM-PHONE-01 | Phone use (V2) | Allowed apps and the live action | US-PHONE-01, US-PHONE-02 |
| HM-BOT-01 | Roster (home) | Hermit and the bots like contacts: pins, Ocultos, search, mode chips, create | US-BOT-01, US-BOT-07 |
| HM-BOT-02 | A bot's chat | HM-CHAT-01 for one bot: its bar, mode chip, menu, older chats, the answer code gives when a skill is withheld | US-BOT-02, US-BOT-03 |
| HM-BOT-03 | New bot | Templates, a proposal from Hermit, name, role, look, permissions, sources, mode, the fingerprint | US-BOT-03, US-BOT-04, US-BOT-05, US-BOT-06, US-BOT-11 |
| HM-BOT-04 | Bot settings | A bot's details, notes, mode, duplicate, reset and delete; Hermit's variant is read-only | US-BOT-05, US-BOT-06, US-BOT-08, US-BOT-09, US-BOT-11 |
| HM-BOT-05 | Group chat (wave B2) | The user and 2 to 6 bots in one chat | US-BOT-12 |
| HM-SITE-01 | Website home | What Hermit is | US-SITE-01 |
| HM-SITE-02 | Privacy policy | The public policy | US-SITE-02 |
| HM-SITE-03 | Download | APK, hash, verify steps | US-SITE-03 |
| HM-SITE-04 | Contributor docs (V2) | Skills and cage docs | US-SITE-04 |
| HM-BOOST-01 | Boost (V2) | Pair and configure a Boost | US-BOOST-01, US-BOOST-03, US-BOOST-04, US-MAC-01, US-MAC-02 |
| HM-A2A-01 | Connected agents (V2) | Allowed agents and their requests | US-A2A-01, US-A2A-02 |
| HM-FAM-01 | Family (V3) | Shared items and child limits | US-FAM-01, US-FAM-02 |

## 2.8 Functional requirements (system contracts)

Each FR is a contract that an agent implements and a test asserts. Where the code already exists, the FR names it, and the test suite in that package is the proof.

### Agent loop (`packages/agent`)

- **FR-LOOP-01.** A turn is two-stage decoding: the model first picks one skill name from the enum of skills that can run (plus `respond` and `ask_user`), then fills that skill's JSON schema. `respond` and `ask_user` end the turn with text.
- **FR-LOOP-02.** Every skill call passes through the cage (FR-CAGE-01) before it executes; `deny` returns "Blocked: reason" to the model, and an `ask` waits for the approval port.
- **FR-LOOP-03.** Invalid output is repaired deterministically (`packages/core/src/repair.ts`: JSON extraction, type coercion, hostile keys such as `__proto__` dropped), then retried with the validation error, at most 3 repair attempts per call.
- **FR-LOOP-04.** At most 4 skill calls per turn; the 5th ends the turn with `max_steps`.
- **FR-LOOP-05.** A turn ends in exactly one of: `responded`, `asked`, `repair_failed`, `max_steps`, `model_error`, `stopped`. Errors thrown by a skill or the model are contained and logged, never crash the app.
- **FR-LOOP-06.** Stopping a turn aborts generation and resolves any pending approval as denied; a skill already executing completes or fails atomically. Q155: a reply written with no tools in reach keeps the words already shown, marked stopped, and Seguir can go on from them (Q170); a reply that used up its tokens is marked cut, never shown as finished.
- **FR-LOOP-07.** When the history exceeds the model's context budget, the oldest turns are compacted into a summary; tainted content keeps its untrusted markers through compaction.

### The cage (`packages/cage`)

- **FR-CAGE-01.** `decide(call, session)` evaluates the rules deny-wins: any matching `deny` wins over `ask`, and `ask` over `allow`. The decision carries a human reason.
- **FR-CAGE-02.** Hard limits, not overridable by rules, per mode (amended for PDR-031). In Ask, the default: `send` always asks; `spend` and `credential` are denied in tainted or unattended sessions and otherwise ask with a biometric; `remote_write` always asks; `local_write` asks when tainted; in an unattended session every `ask` becomes `deny`. In Auto and Don't ask the mode may turn an `ask` into a run (FR-CAGE-08), but `spend` and `credential` keep their limit in every mode: denied in tainted or unattended sessions, and otherwise an approval with a biometric from the user's own words. The risks are `read`, `local_write`, `network`, `remote_write`, `send`, `credential` and `spend`.
- **FR-CAGE-03.** An approval is valid only if it carries the `argsHash` of the exact call (canonical JSON, SHA-256), the request ID, a biometric when required, and passes `verifyApproval` (an HMAC proof over the hash and the request ID). It expires after the product rule of 2 minutes. Anything else is a denial.
- **FR-CAGE-04.** Any skill marked `producesUntrusted` (read_messages, calendar_read, recall of a tainted fact, read_web, search_web, every mail read, every connector or MCP result, every page in the in-app browser) taints the session; its output is wrapped in untrusted markers (CT-09) before the model sees it. Taint never clears within a session.
- **FR-CAGE-05.** Memory writes in a tainted session are recorded with `tainted: true` provenance and ask first.
- **FR-CAGE-06.** From W5, approvals for `spend` and `credential` are signed in a native module by a non-exportable Android Keystore key that requires user authentication (ADR-007); the JS proof of FR-CAGE-03 remains for other risks.
- **FR-CAGE-07.** Risk tiers are code, not the model. Each skill carries a tier (low, medium or high) in its definition, and the cage reads the tier; a skill without a tier is high. Reads, links, search, notes, and reminders and events for the user are low; deletes and every intent skill (`apps`) are medium; recipe skills, MCP tools and connector operations stay untiered, so they are high. A table test pins every skill's tier.
- **FR-CAGE-08.** The mode sits over the tiers (PDR-031), and the cage reads the mode in effect (the bot's own, else the global one), the tier, whether the user is in the chat (attended) or the work is alone, and taint. Auto never asks the small model whether something is safe.
  - Ask is today's rules in a chat. Alone, a bot reads its own sources and the private data its grants hold, never both in one run (the split below), and keeps notes about what it read, marked as read from outside; the rest waits as a suggestion.
  - Auto in a chat never asks more than Ask and runs low-tier steps, even after outside text. It opens a link without asking only when the address appears verbatim in the user's messages and mail or in the user's own words; a link Hermit composes asks, and web reads give nothing to follow. Alone, Auto allows what Ask alone allows plus low tiers anywhere.
  - Don't ask runs everything except money and logins.
  - The private-data split: alone, in Ask and in Auto, a bot can't use private data (messages, mail, calendar, contacts) and the web in the same run. This is stricter than the first spec text, which allowed it in Auto (a coordinator ruling, 2026-11-25). Notes carry the kinds the run that wrote them had read, so the split holds across runs. Only Don't ask lifts it.
  - Search alone stays fail-closed in Ask and Auto in wave B1, since no alone turns exist yet; wave B2 allows it scoped to the bot's listed sites. Don't ask runs it.
  - A step a mode runs is logged as "ran" with the reason `mode.ask`, `mode.auto` or `mode.dont_ask`, bound like an approval (its summary built, any unresolved value blocked). It is never remembered as an approval: approved domains, search providers and new recipients are learned only from the user's own approval.
  - Money and logins need the fingerprint in the user's own words in every mode, and never start from a bot's own work.

### Bots (`packages/core`, `packages/runtime`, `packages/cage`, `apps/mobile`)

- **FR-BOT-01.** The data (migration 17, forward-only): `bots` (id, name, role, shape, color, primary flag, pin order, hidden, notify, mode, created_at), `bot_grants`, `bot_sources`, `sessions.bot_id` and `sessions.title`, `notes.bot_id` and `notes.kinds`, and `audit.bot_id`. Hermit's row has the id `hermit` and comes from the migration. Every new table joins the erase list. At most 50 bots, Hermit included, and at most 2 pins.
- **FR-BOT-02.** Sessions and notes are per bot: `latest(botId)` and `clear(botId)` replace the global versions, and a chat's title is the first user words. A bot reads its own notes plus the shared profile (`notes.bot_id` null). Untainted notes from before the migration became shared; tainted ones stayed Hermit's own. A note from a bot is that bot's own; sharing is one way, for untainted own notes; only Hermit may forget or delete a shared fact. A note keeps the read kinds (private, web) of the session that wrote it, and a missing value is refused.
- **FR-BOT-03.** The boundary is in code over 13 groups: calendar, reminders, notes, messages read, messages reply, mail read, mail send, web read, web tasks, contacts, apps (open other apps with prefilled intents), vault and logins, and wallet and pay. A skill outside a bot's groups is denied and never offered in its menu. A skill with no group and no source (`connect_service`, `create_bot`) is held by Hermit only. Hermit holds every group in code; its name, role and grants are not editable. `vault_logins` is reserved: no screen offers it, and create and update refuse it in wave B1.
- **FR-BOT-04.** Sources are the sites and connectors a bot works from. A site is a registrable name like wikivoyage.org, never a numeric address; a bot that works alone reads only these sites on the web in Ask (FR-CAGE-08), once alone turns exist in wave B2. The role is at most 800 characters and the name 40.
- **FR-BOT-05.** One model, one queue. Priority: the user's own turn, then a reply the user is waiting for (Seguir in wave B1), then handoffs, then routines. A turn holds its priority until it ends; a running model call always finishes (the safe point) and is never cut for another bot. The night shift runs at routine priority and warm-up at user priority. A new user turn waits only for the current model call.
- **FR-BOT-06.** The prompt cache has one key per bot, `hermit-v1:<botId>`, and one `:long` key for long answers and Seguir. At most 6 named caches stay on disk, least recently used out first, and Hermit's turn key is never evicted. The app logs the caches' total size on disk.
- **FR-BOT-07.** Per-turn values: each turn takes the bot's role, grants, sources and mode, builds its menu from the bot's granted skills only, and passes the bot to the cage with every call. Wave B1 background callers (the night shift, morning suggestions) pass no bot.
- **FR-BOT-08.** Proposals are rendered by code. `create_bot` shows a card whose every field is code-written; a proposal drafted after reading outside text offers Review only; an offer expires, works once, and is re-checked before it creates anything. A request to make a bot reaches `create_bot` through an intent hint in `packages/model`, in es and en.
- **FR-BOT-09.** One rule, `needsFingerprint`, decides the fingerprint to grant: mail send, wallet and pay (and vault and logins) need it to grant, and a bot's own mode of Don't ask needs it plus the typed word, even under a global Don't ask. Create asks when the grants include those groups or the bot's own mode is Don't ask; duplicate starts with no mode of its own, so only fingerprint-gated grants ask. Settings can't write a mode key; only the mode setters do.
- **FR-BOT-10.** The signed log records bot ids and never content: an audit entry may carry `bot_id` inside its hashed content, and entries from before bots still verify. Activity shows the bot's current name, or "bot borrado" when it is deleted, and the "ran" reason. Creating, changing, duplicating, resetting, deleting and sharing are logged. Delete, Reset and Clear conversation are refused while the bot's turn runs.

### Memory (`packages/agent/src/memory-skills.ts`, `packages/core/src/memory.ts`)

- **FR-MEM-01.** `remember` stores at most 500 characters per fact in `ENT-Note` with FTS5 indexing, in one transaction.
- **FR-MEM-02.** Every note write requires provenance (`tainted` true or false); a write without it is refused by the type and at runtime.
- **FR-MEM-03.** `recall` searches with accent and case folding, ranks by FTS5 relevance, and returns at most 8 facts.
- **FR-MEM-04.** If any recalled fact is tainted, that recall taints the session.
- **FR-MEM-05.** `forget` deletes notes matching all words of the query; if more than 5 match, it deletes nothing and asks the user to be specific.
- **FR-MEM-06.** The profile snapshot at session start contains only untainted facts, newest first, at most 1,400 characters.

### Reminders and calendar

- **FR-REM-01.** `remind` schedules an exact local notification through the platform alarm API; it survives reboots, fires offline and records `ENT-Reminder` state transitions `pending` to {`fired`, `cancelled`}, `fired` to {`done`}.
- **FR-REM-02.** A reminder in the past, or more than the product rule of 1 year ahead, is refused with a clarifying question.
- **FR-CAL-01.** `calendar_read` and `calendar_add` use the platform calendar provider; reads are limited to the granted calendars and a range of at most 31 days; event text written by others is untrusted.

### Messages (native module plus `packages/skills`)

- **FR-MSG-01.** A `NotificationListenerService` captures notifications from an allow-list of packages (WhatsApp, WhatsApp Business) into `ENT-Message` and `ENT-Conversation`: sender, text, time, conversation key and the reply action handle.
- **FR-MSG-02.** When JavaScript is not running, the native listener writes to a native queue that the app drains on start; duplicates are dropped by notification key plus post time.
- **FR-MSG-03.** `reply_message` takes `{conversationId, text}`; `describeAction` renders the recipient from `ENT-Conversation`, never from model text.
- **FR-MSG-04.** Sending fires the stored `RemoteInput` reply action; if the notification is gone or replaced, the skill returns `stale` and sends nothing.

### Activity and the signed log (`packages/cage/src/audit*.ts`)

- **FR-ACT-01.** Every proposal, decision, approval, execution, block and error appends an `ENT-AuditEntry`: sequence, time, event, skill, decision, outcome, `argsHash`, previous hash, entry hash over a fixed tuple, and an Ed25519 signature.
- **FR-ACT-02.** Entries never contain arguments, message text or memory content.
- **FR-ACT-03.** `verifyChain` recomputes each hash, link and signature, and reports the first broken index and why.
- **FR-ACT-04.** Clearing the log starts a new chain whose genesis entry records `log_cleared` with the previous head hash and count.

### Model runtime and eval

- **FR-MODEL-01.** A QVAC adapter implements the `Model` port (`packages/core/src/ports.ts`): `complete` with a grammar or JSON schema constraint and streaming tokens; the model runs in the bare worklet, never on the UI thread.
- **FR-MODEL-02.** The model file is downloaded from a pinned Hugging Face URL over HTTPS and accepted only if its SHA-256 equals the pinned value in the app build; mismatches are deleted.
- **FR-MODEL-03.** The device floor check (arm64, Android version, total memory) runs before download (NFR-05).
- **FR-MODEL-04.** The eval CLI (`packages/eval`) runs cases with a model adapter and reports, per language, the share of correct first actions and the median time to first action, plus the injection set result.
- **FR-MODEL-05.** Model settings are part of the model's pinned profile and evaluated together: thinking mode (off, or on with a token budget), sampling, and the decoding format (Hermit's two-stage decoding, or the model's native tool-call template constrained by the same grammar). The eval reports each profile, and the shipped profile is the one that meets PDR-003 with the highest accuracy. Q155: the profile also pins the long-answer settings (the cap for a long answer the user asked for, 800 tokens, and its thinking, off), measured on the Mac lab (`docs/build/long-answers-2026-11-21.md`); on the phone the long cap applies only while `budgetFor` says the phone is cool with headroom.

### Voice

- **FR-VOICE-01.** A voice note is recorded in memory and transcribed with QVAC's on-device speech to text; the audio is discarded after transcription unless the user keeps voice notes.
- **FR-VOICE-02.** Read-aloud (V2) uses on-device text to speech in the reply's language; no network voice is used.

### Web reading

- **FR-WEB-01.** `read_web` fetches HTTPS URLs only, follows at most 5 redirects, caps the body at 2 MB, and extracts readable text.
- **FR-WEB-02.** A fetch is a `network` risk; the first fetch per domain per session asks.
- **FR-WEB-03.** The quarantined reader is a separate model call with no skills in its enum; it receives untrusted text and the user's question and returns a typed summary `{answer, quotes[], source}`. Only the summary reaches the main loop, still marked untrusted.
- **FR-WEB-04.** `search_web` sends only the query to the provider configured in settings and returns titles, URLs and snippets as untrusted.
- **FR-WEB-05.** Web tasks run in an in-app browser (an Android WebView with a per-site encrypted profile); the model sees each page as a pruned accessibility tree, never pixels, built by injected JavaScript ported from Playwright's aria snapshot (Apache 2.0): one line per element in page order (`[7] button "Place order" disabled`, `[12] textbox "Email" = "..."`, `## Heading`), at most about 3,000 characters, truncated keeping the first 80% and the last 20%, secret field values masked. It acts with typed browser skills (`web_open`, `web_click`, `web_type`, `web_select`, `web_read`, `web_report_infeasible`); the grammar allows only element numbers shown in that step. Each action returns one result line (`[ok] click [7] button "Next" -> navigated to ...`), not a new full tree.
- **FR-WEB-06.** A web task is bounded: at most 15 browser steps, and it stops after 3 consecutive failed or no-change actions, allowed only on the domains named in the task, and only for the known task kinds (book, reorder, check out, fill and submit, check a status); anything else is declined on the phone and offered to Boost in V2.
- **FR-WEB-07.** Before a click or an Enter key runs, a classifier ported from Nanobrowser (Apache 2.0) reads the element's role and label, its form, nearby amounts and whether Enter submits, and maps pay to `spend`, sign-in and grant to `credential`, submit and delete to `remote_write`; unclassifiable clicks on a page with a form default to `remote_write`. A false positive costs one prompt; a false negative is not allowed.
- **FR-WEB-08.** "Take over" pauses the task and gives the page to the user; "Stop" ends it; both are logged.
- **FR-WEB-09.** After an approval, the runtime re-checks that the element's role, name, page origin and form target still match what the sheet showed; on any mismatch the action is cancelled.
- **FR-WEB-10.** A completed, approved task is saved as a recipe on the phone: steps that find elements by role and name, with the user's values as variables. Replays run without the model and call it only for a failing step; committing steps still ask every time. The recipe format is Hermit's own (workflow-use is AGPL and is not copied).

### Email

- **FR-MAIL-01.** Mail accounts connect through Gmail API or Microsoft Graph with OAuth (PKCE public client, system browser), or IMAP and SMTP over TLS with an app password; nothing passes through a Hermit server.
- **FR-MAIL-02.** `mail_list`, `mail_search` and `mail_read` are `network` reads whose output is untrusted; bodies are converted to text and capped per message.
- **FR-MAIL-03.** `mail_draft` and `mail_modify` (archive, label, mark read; at most 200 messages) are `remote_write`; `mail_send` is `send`.
- **FR-MAIL-04.** The send sheet renders From, To, Cc, Subject and body from the arguments and the thread headers (CT-06) and flags recipients not present in the user's mail history.
- **FR-MAIL-05.** Mail is fetched on demand and cached in the encrypted database only for the current summary; the cache is cleared on disconnect.

### Connectors

- **FR-CONN-01.** A connector is a spec (CT-12) run by one fixed runtime; specs never contain code. Shipped specs are signed by Dojo Coding and verified before install.
- **FR-CONN-02.** The runtime allows requests only to the hosts in the spec, over HTTPS, with the operation's declared method, path and input schema; responses are untrusted and capped.
- **FR-CONN-03.** Tokens, keys and passwords live in the credential store, encrypted under an Android Keystore key; the runtime injects them at send time; the model never sees them. OAuth uses PKCE in the system browser with an app link redirect.
- **FR-CONN-04.** Each operation's risk comes from the spec; the user may raise a risk, never lower one below the spec's; every call goes through `decide` (FR-CAGE-01). An operation's domain sets a floor (payments at least `spend`; email or messaging create at least `send`; credentials at least `credential`); a spec whose risk contradicts its own effect, destructive flag or domain is rejected at install.
- **FR-CONN-05.** The MCP client speaks Streamable HTTP with MCP authorization (OAuth with PKCE); each tool becomes a skill; only `readOnlyHint: true` from a server the user installed may propose `read`, a missing destructive hint counts as destructive, and no model ever lowers a risk; tool descriptions are treated as untrusted and never rendered on the approval sheet. Servers that support dynamic client registration are signed into directly from the phone with PKCE.
- **FR-CONN-06.** Connector discovery tries, in order: shipped specs, an official MCP server that supports dynamic client registration, other MCP Registry entries (third-party-hosted servers flagged as passing data through that party), a published OpenAPI 3 description (converted deterministically: GET to `read`, others at least `remote_write`, overrides only raise risk, external `$ref` never fetched), then a spec drafted by the phone model from docs the user points to. Drafted specs mark every non-read operation `remote_write` or higher and are labeled "Made by Hermit".
- **FR-CONN-07.** For providers that require a client secret, the code-for-token exchange runs through a relay: the user's own (open source) or Dojo's (opt-in, off by default). The relay returns tokens encrypted to a key the phone generated for that sign-in and stores nothing.
- **FR-CONN-09.** Each connector keeps a per-operation allow list; disabled operations never reach the model; the model never gets a generic "call any path on this host" skill.
- **FR-CONN-10.** OAuth endpoints, PKCE support and scope formats come from Hermit's own `oauth-providers.json` (Apache 2.0), modeled on Nango's field set but written from each provider's docs, since Nango's file is under the Elastic License.
- **FR-CONN-08.** Installing or changing a spec needs a fingerprint; the spec hash is recorded in the signed log; a spec whose hash changes is disabled until approved again.

### Opening other apps

- **FR-APP-01.** Intent skills (`open_whatsapp_chat` via `wa.me`, `compose_sms`, `compose_email`, `dial`, `navigate`, `share`, `set_alarm`, `add_contact`) build an Android intent with prefilled fields and hand it to the target app; Hermit never completes the action itself. Their risk is `local_write`, so they ask when the session is tainted.
- **FR-APP-02.** Phone numbers and addresses in intent skills come from the user's own words in the turn, or from the phone's contacts when the user names the person in the turn; never from untrusted text or the model. Code matches the name (accents and case ignored, the contact's own name or nickname field), the model never receives the contact list, zero or several matches ask, and a number found by name always shows the approval sheet with its source (PDR-028).

### Night shift

- **FR-NIGHT-01.** Night jobs run as a foreground service only while charging, inside the user's window, with thermal and battery guards (NFR-04); each job runs in an unattended session. WorkManager wakes the app while charging and starts the service, which runs the night pass headlessly; one pass at a time (a run lock); when Android refuses the service the pass runs inside the WorkManager job (Q69, Q75).
- **FR-NIGHT-02.** Proposed actions from a night job are stored as suggestions in `ENT-Briefing` and executed only from the briefing through the normal approval.

### Vault, forms and logins

- **FR-VAULT-01.** Vault items are encrypted with a data key wrapped by an Android Keystore key that requires biometric authentication.
- **FR-VAULT-02.** The model sees only item names and origins; secrets are never placed in a prompt, a log entry or a skill result.
- **FR-VAULT-03.** CSV import supports the common exports (Chrome, Bitwarden, 1Password) and rejects files without origins for login items.
- **FR-VAULT-04.** A credential is released only when the requesting origin equals a stored origin exactly (scheme, host, port), after a `credential` approval.
- **FR-FORM-01.** Form filling uses the Android autofill service; values are shown for approval and filled into the target fields; Hermit never submits the form.

### Wallet and payments (`packages/payments`, new)

- **FR-PAY-01.** WDK runs in the worklet; the seed is encrypted under a Keystore key and is never exposed to JavaScript outside the wallet module, the model or the log.
- **FR-PAY-02.** Balances and history are read from the configured RPC endpoints; amounts are integer base units with asset and network (CT-01).
- **FR-PAY-03.** `pay` resolves the recipient from `ENT-Contact` payees; a raw address from the model is accepted only if the user typed it in the current turn, and is shown in full on the sheet.
- **FR-PAY-04.** On HTTP 402 with x402 requirements, the payments package selects a supported scheme (`exact` on a supported EVM network with USD₮), builds an EIP-3009 `transferWithAuthorization` signed by the WDK EVM account, and retries with the payment header after approval.
- **FR-PAY-05.** Every payment checks `ENT-SpendingCap` (per payment and rolling per day) before asking; over-cap payments are denied.

### Changing phones (Holepunch in the worklet)

- **FR-MOVE-01.** Pairing: the old phone shows a QR with a one-time key and topic; both phones derive a 6-digit short code from the handshake and the user compares them; a mismatch aborts.
- **FR-MOVE-02.** Transfer streams an encrypted, versioned archive of the database, vault and wallet secrets over the paired Holepunch connection; Keystore keys are re-created on the receiving phone and data re-wrapped.

### Privacy, platform, website and language

- **FR-PRIV-01.** CI fails if any package depends on a denied analytics, crash or tracking library (including npm aliases and lockfile entries), or if a package imports a network API outside the allowed adapters (ESLint no-network rule).
- **FR-PRIV-02.** All outbound requests (including connectors, mail, the in-app browser and the relay) go through one fetch wrapper that counts destination hosts locally in `ENT-HostCounter` for the privacy screen.
- **FR-PLAT-01.** Builds are Android arm64, release-signed, with the dev client excluded from release.
- **FR-PLAT-02.** The Play build declares the notification listener use, the data safety form states no collection, and the permissions list matches 2.15.
- **FR-PLAT-03.** Release builds are reproducible: pinned toolchain, lockfile, deterministic bundling; CI publishes the APK, its SHA-256 and the recipe to GitHub Releases.
- **FR-SITE-01.** The website is a static export (no server functions) on Vercel with no cookies, analytics or third-party scripts, and a strict content security policy.
- **FR-I18N-01.** All copy comes from locale files (es-419, en) keyed by screen ID; the model's system prompt states the user's language.

### Cross-cutting contracts

These ship as code in W0 or already exist; every slice uses them instead of inventing its own.

- **CT-01: Money.** Amounts are integer base units (bigint) with `asset` and `network`; no floats anywhere; formatting only at display, in the user's locale.
- **CT-02: Time.** Timestamps stored as UTC epoch milliseconds; the phone's IANA zone is read at use; relative times resolve against local time; display follows the locale.
- **CT-03: Local events.** One envelope `{name, at, sessionId, props}` for the local event log (2.13); events never leave the phone.
- **CT-04: Error codes.** One union of user-facing outcomes (`repair_failed`, `max_steps`, `model_error`, `stopped`, `stale`, `blocked`, `offline`, `permission_missing`, `over_cap`) mapped to copy keys.
- **CT-05: Skill definition.** `{name, risk, argsSchema, describeAction(args, ctx), run, producesUntrusted?}` in `packages/skills`; risk is one of `read`, `local_write`, `network`, `remote_write`, `send`, `credential`, `spend`; a skill without a risk does not compile.
- **CT-06: Action rendering.** Approval sheets render only `describeAction` output built from the arguments and trusted phone data (`RenderContext`), never model prose.
- **CT-07: Approval.** `{requestId, argsHash, approved, biometric, proof, at}` and its verification (FR-CAGE-03, FR-CAGE-06).
- **CT-08: Audit entry.** The fixed tuple and signature of FR-ACT-01, persisted in `ENT-AuditEntry`.
- **CT-09: Untrusted text.** `wrapUntrusted(source, text)` markers and the session taint flag; any code that feeds external text to a model goes through it.
- **CT-10: Copy and locales.** Copy keys `screenId.element`; es-419 and en files; no hard-coded strings in screens.
- **CT-11: Ports.** `Model`, `Sql`, `Clock`, `Approver`, `Notifier`, `Signer` interfaces in `packages/core`; phone adapters implement them; pure packages never import React Native.
- **CT-12: Connector spec.** `{id, version, name, hosts[], auth: {type: oauth2_pkce | oauth2_dcr | api_key | basic | relay, ...}, operations[]: {name, description, sideEffects, method, path, inputSchema, scopes[], effect: read | write | delete, destructive, idempotent, domain, risk}, transforms[] (from a fixed built-in set only), origin: shipped | registry | openapi | drafted, signature?}`; the hash of the canonical spec is its identity (FR-CONN-08).

## 2.9 Domain data model

All entities live on the phone in one SQLCipher database (ADR-006), except vault and wallet secrets, which are encrypted again under their own Keystore keys. There is no server schema. The table names below are the on-device tables.

| Entity | Purpose | Key fields and relationships | Table | First wave |
| :---- | :---- | :---- | :---- | :---- |
| `ENT-Note` | A remembered fact | id, text (max 500), tainted, source, bot_id (null is the shared profile), kinds, created_at, embedding (reserved, V2) | `notes`, `notes_fts` | W1 |
| `ENT-Reminder` | A scheduled reminder | id, text, at, state {pending, fired, done, cancelled}, notification_id, created_at | `reminders` | W1 |
| `ENT-Conversation` | A captured chat | id, app {whatsapp, whatsapp_business}, title, key, reply_handle, last_at | `conversations` | W1 |
| `ENT-Message` | A captured message | id, conversation_id, sender, text, at, notification_key | `messages` | W1 |
| `ENT-ChatTurn` | Conversation history with Hermit | id, session_id, role, text, untrusted, outcome, at | `chat_turns` | W1 |
| `ENT-Session` | A session and its taint | id, bot_id, title, attended, tainted, started_at | `sessions` | W1 |
| `ENT-ApprovalRequest` | A pending or resolved approval | request_id, session_id, skill, args_hash, state {pending, approved, denied, expired}, at | `approvals` | W1 |
| `ENT-AuditEntry` | The signed log | seq, ts, session_id, bot_id, event, skill, args_hash, decision, outcome, prev_hash, hash, sig | `audit` | W1 |
| `ENT-Setting` | Key and value settings | key, value | `settings` | W1 |
| `ENT-Bot` | A bot, Hermit included | id, name, role, shape, color, primary, pin_order, hidden, notify, mode (null inherits), created_at | `bots` | B1 |
| `ENT-BotGrant` | A skill group a bot holds | bot_id, group | `bot_grants` | B1 |
| `ENT-BotSource` | A site or connector a bot works from | bot_id, kind {site, connector}, value | `bot_sources` | B1 |
| `ENT-ModelInstall` | The installed model | model_id, sha256, path, size, verified_at | `model_installs` | W1 |
| `ENT-LocalEvent` | Local event log (2.13) | id, name, at, session_id, props | `local_events` | W1 |
| `ENT-ConnectorSpec` | An installed connector spec | id, version, origin {shipped, registry, openapi, drafted}, spec_json, spec_hash, approved_at, enabled | `connector_specs` | W2 |
| `ENT-ConnectorAccount` | A connected account and its credentials | id, spec_id, label, scopes, credential (encrypted), relay {none, own, dojo}, last_used_at | `connector_accounts` | W2 |
| `ENT-MailCache` | Messages fetched for the current summary | account_id, message_id, from, subject, snippet, at | `mail_cache` | W2 |
| `ENT-BrowserTask` | A web task and its steps | id, kind, domains, state {running, paused, done, stopped, failed}, steps, started_at | `browser_tasks` | W4 |
| `ENT-HostCounter` | Outbound hosts for the privacy screen | host, count, last_at | `host_counters` | W3 |
| `ENT-NightJob` | A night-shift job | id, kind, enabled, last_run_at, last_result | `night_jobs` | W3 |
| `ENT-Briefing` | A morning briefing and its suggestions | id, date, sections, suggestions (skill, args, args_hash) | `briefings` | W3 |
| `ENT-VaultItem` | A login or secure note | id, name, username, secret (encrypted), origins, notes, updated_at | `vault_items` | W4 |
| `ENT-Profile` | Personal details for forms | field, value (encrypted), sensitive | `profile_fields` | W4 |
| `ENT-WalletAccount` | A wallet account | id, network, address, derivation_path | `wallet_accounts` | W5 |
| `ENT-Transaction` | A wallet transaction | id, account_id, direction, amount (base units), asset, network, counterparty, tx_hash, audit_seq, at | `transactions` | W5 |
| `ENT-SpendingCap` | Payment limits | per_payment, per_day, asset, updated_at | `spending_caps` | W5 |
| `ENT-Contact` | Payees | id, name, address, network | `contacts` | W5 |
| `ENT-PairedDevice` | A paired phone or Boost | id, kind {phone, boost}, public_key, paired_at | `paired_devices` | W6 |
| `ENT-ApprovalGrant` | Session-wide approval (reserved) | id, session_id, skill, risk, expires_at | `approval_grants` | V2 |

Integrity rules: `audit` is append-only (a trigger refuses updates; no delete except the logged clear of FR-ACT-04); `notes.tainted` is NOT NULL; amounts are integers; every migration is forward-only and numbered, with the slot assigned in the slice map (`packages/core/src/schema.ts`).

## 2.10 Integration specifications

Hermit integrates with the phone and a few external services, never with a backend of its own.

| System | Direction | Contract and notes | Access | Sandbox | Verified |
| :---- | :---- | :---- | :---- | :---- | :---- |
| Tether QVAC (`@qvac/sdk` 0.23) | In-process | LLM completion with grammar constraints, speech to text, text to speech, Holepunch transport, in a bare worklet | npm, Apache 2.0 | Node and the dev build | `docs/research/qvac.md`, 2026-11-08; on-device run Unverified (ASM-01) |
| Hugging Face | Outbound HTTPS | One model download per version, pinned URL and SHA-256 | Public | Same | ADR-008; Verified 2026-11-08 |
| Android notifications | Inbound and reply | `NotificationListenerService`, `RemoteInput` reply action | Permission granted by the user | Dev build with a test WhatsApp account | `docs/research/platform.md`, Verified 2026-11-08; restricted settings on sideload ASM-05 |
| Android calendar provider | Read and write | `CalendarContract` through expo-calendar | Runtime permission | Dev build | Verified 2026-11-08 |
| Android Keystore and BiometricPrompt | Local | Keys requiring user authentication, non-exportable | Platform | Dev build | Verified 2026-11-08 (ASM-07) |
| Android autofill service | Outbound to other apps | `AutofillService` fill responses | User enables Hermit as autofill | Dev build | Unverified (ASM-10) |
| op-sqlite (SQLCipher, FTS5, sqlite-vec) | Local | Encrypted database with full-text search | npm | Node tests via `sql-node` | Unverified on device (ASM-02) |
| Tether WDK | In-process | Wallet creation, EVM accounts, signing | npm | Testnet | Tether's React Native host is still bare-kit 0.14.5 only (DEP-07); Hermit bundles `@tetherto/wdk-wallet-evm` in its own worklet for bare-kit 0.16 instead (SL-17, ASM-08) |
| x402 merchants | Outbound HTTPS | HTTP 402 with payment requirements, EIP-3009 authorization | Public | Testnet facilitator | No React Native client exists (ASM-09); spike in W2 |
| EVM RPC providers | Outbound HTTPS | Balance, history, broadcast | Public endpoints chosen in settings | Testnet | Unverified (ASM-11) |
| Search provider | Outbound HTTPS | Query only | User-chosen provider | Same | Open (OQ-04) |
| Holepunch (Hyperswarm) | Peer to peer | Phone-to-phone transfer and later Boost | Through QVAC | Two dev phones | Unverified on Android (ASM-12) |
| Gmail API and Google Workspace APIs | Outbound HTTPS | Mail, Calendar, Drive through OAuth with PKCE from the phone | Dojo's OAuth client (DEP-10) or the user's own (PDR-021) | Test users under the 100-user cap | PKCE without a secret on Android Verified (ASM-14); the cap Verified (ASM-15) |
| Microsoft Graph | Outbound HTTPS | Outlook mail and calendar, OneDrive, OAuth public client | Dojo app registration (DEP-11) | Developer tenant | Unverified |
| IMAP and SMTP | Outbound TLS | Any other mail provider with an app password | User credentials | Test mailbox | Verified (standard protocols) |
| MCP servers | Outbound HTTPS | Streamable HTTP, MCP authorization | Server URL from the user or the MCP Registry | Public test servers; the SDK reference server in `packages/eval/mcp-reference-server` | Client built in `packages/connectors/src/mcp` (SL-51); on-phone run pending (ASM-20) |
| OAuth relay | Outbound HTTPS | Code-for-token exchange for providers that need a secret; stores nothing | The user's own, or Dojo's opt-in | Local run | Which providers need it Unverified (ASM-17) |
| Android WebView | Local | In-app browser driven through an accessibility tree | Platform | Dev build | Driving it with the phone model Unverified (ASM-19) |
| Google Play | Distribution | Listing, data safety, notification listener review | Play developer account (DEP-06) | Internal testing track | Unverified (ASM-06) |
| GitHub Releases | Distribution | Signed APK, SHA-256, recipe | Repository | Same | Verified |
| Vercel | Website hosting | Static export only | Dojo Coding account | Preview deployments | Verified |

## 2.11 Subsystem specification: the agent turn

1. The user sends text (typed or transcribed). A turn starts in the current `ENT-Session`.
2. The prompt builder assembles: system rules, the language, the profile snapshot (FR-MEM-06), the compacted history (FR-LOOP-07) and the skill menu (only skills whose permissions are granted).
3. Stage one: the model picks a skill name from the enum. Stage two: it fills the schema (FR-LOOP-01). Output is validated and repaired (FR-LOOP-03).
4. The cage decides (FR-CAGE-01, FR-CAGE-02). An `ask` renders HM-APPR-01 from `describeAction` (CT-06) and waits for an approval that matches the `argsHash` (FR-CAGE-03).
5. The skill runs. Untrusted output is wrapped and taints the session (FR-CAGE-04). Every step appends to the signed log (FR-ACT-01).
6. The loop continues to at most 4 calls (FR-LOOP-04) and ends with one terminal outcome (FR-LOOP-05).

Why this shape is agent-safe to build in parallel: the cage, the repair and the log are in pure packages with their own tests, so a slice that adds a skill cannot forget a guard; the type of `SkillDefinition` (CT-05) requires a risk, and the loop never calls a skill except through `decide`.

## 2.12 Subsystem specification: data in, data out

- **Depth.** Hermit imports nothing from other systems in V1 except notifications as they arrive (no back-fill of WhatsApp history, which Android does not expose) and an optional password CSV (FR-VAULT-03).
- **Reconcile rule.** For the phone transfer (FR-MOVE-02), the new phone's row counts per table and the signed log's head hash must equal the old phone's before the wipe is offered.
- **Reference data.** The model file (pinned hash), the skill menu, and the locale files ship with the app. Network lists for payments (supported chains, the USD₮ contract addresses) ship with the app and are checked in the W2 spikes.
- **Export.** V1 exports only through the phone transfer; file export is V2 (US-MEM-08, US-MOVE-04).

## 2.13 Analytics and event taxonomy

Hermit has no analytics (ADR-009). Events exist only in a local log on the phone (`ENT-LocalEvent`, envelope CT-03), used for the "Where Hermit runs" screen, the privacy screen and on-device debugging. They are never transmitted, and they are deleted with "Delete everything".

| Event ID | When it fires |
| :---- | :---- |
| EVT-MODEL-01 | A turn finished: time to first action, tokens per second, outcome |
| EVT-MODEL-02 | The model was downloaded and its checksum passed or failed |
| EVT-APPR-01 | An approval sheet was shown, with its risk |
| EVT-APPR-02 | An approval resolved: approved, denied or expired |
| EVT-CAGE-01 | A call was blocked, with the rule's reason code |
| EVT-MSG-01 | A message was captured (no content) |
| EVT-MSG-02 | A reply returned `stale` |
| EVT-NIGHT-01 | A night job ran, skipped or paused |
| EVT-PRIV-01 | An outbound request was made, with the host |
| EVT-PAY-01 | A payment was signed or refused, with the reason code |
| EVT-MOVE-01 | A phone transfer completed or failed |
| EVT-MAIL-01 | A mail account was connected or disconnected (no content) |
| EVT-CONN-01 | A connector spec was installed, changed or disabled, with its origin |
| EVT-WEB-01 | A web task ended: done, stopped, taken over or failed, with its step count |

## 2.14 Non-functional requirements

| ID | Area | Requirement |
| :---- | :---- | :---- |
| NFR-01 | Performance | On the S26 Ultra, the median time from send to the first chosen skill is at most 15 seconds, and replies stream from the first token (PDR-003) |
| NFR-02 | Accuracy | First-action accuracy of at least 85% in es and in en on the eval set (PDR-003) |
| NFR-03 | Offline | Chat, memory, reminders, calendar reads and the signed log work in airplane mode |
| NFR-04 | Device health | Night jobs pause above the platform's moderate thermal status or below 30% battery; the model unloads on memory pressure |
| NFR-05 | Compatibility | Android 13 or later, arm64, at least 8 GB of memory; the S26 Ultra is the reference device; phones forced to CPU are warned |
| NFR-06 | Security | Hard limits of the cage are covered by tests that cannot be skipped; secrets never appear in prompts, logs or crash output; OWASP Mobile Top 10 reviewed for T1 slices |
| NFR-07 | Injection resistance | Zero unapproved send, spend, credential use or trusted memory write across the eval injection set |
| NFR-08 | Accessibility | WCAG 2.2 AA contrast, TalkBack labels on every control, layouts up to 200% text, reduced motion honored (PDR-013) |
| NFR-09 | Privacy | No analytics, crash reporting or third-party SDK that sends data; enforced by FR-PRIV-01 |
| NFR-10 | Reliability | A crash or kill mid-turn never leaves a sent message or a payment without a log entry; database writes are transactional |
| NFR-11 | Storage | App plus model within the documented size; the download refuses to start without the space (US-ONB-07) |
| NFR-12 | Maintainability | Pure packages have no React Native imports; package boundaries enforced by lint; every package has tests in CI |
| NFR-13 | Localization | Every screen in es-419 and English; dates, numbers and money in the user's locale |
| NFR-14 | Integrity | The signed log verifies on every untampered device; the chain survives app updates |
| NFR-16 | Connector safety | Connector specs are data, never code; no connector can reach a host outside its spec; credentials never appear in prompts, results or the log |
| NFR-17 | Web task reliability | Known web tasks complete in at least 80% of eval runs on the reference sites, and never commit without an approval |
| NFR-15 | Reproducibility | Release APKs rebuild to the same bytes apart from the signature (FR-PLAT-03) |

## 2.15 Security, privacy, and consent

- **Posture.** Everything is sensitive: messages, calendar, memory, passwords and money. The design answer is that none of it leaves the phone (ADR-009), and what must act on the world passes through the cage (ADR-005).
- **Threat model.** V1 defends against prompt injection through messages, pages and invitations, and against model mistakes; from W5 it also defends approvals for money and passwords against a compromised JavaScript layer with a Keystore key (ADR-007). A rooted phone or a malicious OS is out of scope and stated in the privacy copy.
- **Authorization.** The cage is the boundary: deny-wins rules, hard limits in code, approvals bound to the exact arguments. Its tests assert the hard limits with the rules removed, the equivalent of RLS isolation tests in a server product.
- **Authentication.** No accounts. The biometric unlocks approval keys, the vault and the wallet; an optional app lock (US-SET-09).
- **Data minimization.** The log stores hashes only (FR-ACT-02); voice audio is discarded (FR-VOICE-01); messages are captured only from allow-listed apps; mail is fetched on demand and cached only for the current summary (FR-MAIL-05).
- **Connectors and relays.** Connector tokens stay on the phone (FR-CONN-03). The opt-in Dojo relay is the only Dojo-operated component that ever touches a sign-in; it sees an authorization code once, stores nothing, is open source, and is listed on the privacy screen when used (PDR-022).
- **Consent.** Each permission is asked with a reason and is optional (US-ONB-08); training on corrections is opt-in (V2).
- **Permissions declared.** Notification listener, calendar read and write, contacts read (optional, to find a person the user names, PDR-028), microphone, exact alarms, post notifications, foreground service, autofill service, biometric, internet. No SMS, location or storage permission in V1. Contact data never leaves the phone and is never stored in Hermit's database.
- **Payments.** Self-custody; caps; always asks; denied when tainted or unattended (PDR-011).
- **Audit.** The signed, hash-chained log, verifiable on the phone (PDR-012).
- **Data rights.** Delete everything (US-SET-03); transfer to a new phone (EP-13).
- **Law.** No personal data is processed by Dojo Coding, so data-protection duties sit with the user's own device. The Play data safety form and the privacy policy state this (US-SITE-02). Whether a self-custodial wallet in the app creates licensing duties in Costa Rica, Panamá or the US is open (OQ-02).

## 2.16 Architecture Decision Records

Each ADR is the resolved position from discovery, recorded so agents build to the same architecture.

**ADR-001: A pnpm monorepo of pure TypeScript packages plus the Expo app.** Status: Accepted. Context: the agent core must be testable in Node and reused by the phone, the eval and later Boost. Decision: pnpm workspace with `packages/*` (no React Native imports) and `apps/mobile`. Rejected cheaper option: everything inside the app, rejected because the cage and the eval could not be tested without a phone. Consequence: ports and adapters (CT-11).

**ADR-002: Expo SDK 58 with a dev client, Android first.** Status: Accepted. Context: native modules (notification listener, Keystore, autofill) and fast iteration. Decision: Expo SDK 58, React Native 0.88 New Architecture, Expo Router, custom native modules, Android only in V1. Rejected cheaper option: Expo Go, rejected because it cannot load native modules. Consequence: iOS is V2 (EP-20).

**ADR-003: QVAC on-device inference, pinned.** Status: Accepted. Context: the product promise is no cloud. Decision: `@qvac/sdk` 0.23 pinned with react-native-bare-kit 0.16, behind the `Model` port; Tether's BotPsy-0.8B is the first model profiled. Rejected cheaper option: a cloud model API, rejected because it breaks the promise. Consequence: the model choice is an eval result (PDR-009), and spike S1 proves the runtime.

**ADR-004: A menu of typed skills with two-stage decoding.** Status: Accepted. Context: small models fail at open-ended computer use. Decision: the model chooses from an enum of typed skills and fills a schema, with deterministic repair (FR-LOOP-01, FR-LOOP-03). Rejected cheaper option: free-form tool calling, rejected on accuracy. Consequence: every capability is a skill with a risk (CT-05).

**ADR-005: The cage.** Status: Accepted. Context: injection and model mistakes. Decision: deny-wins policy with hard limits, approvals bound to `argsHash` with biometric and proof, session taint, untrusted markers, a signed hash-chained log. Rejected cheaper option: confirmation dialogs with model-written text, rejected because the model could misdescribe the action. Consequence: approval sheets render from arguments only (CT-06).

**ADR-006: Encrypted SQLite on the phone.** Status: Accepted. Decision: op-sqlite with SQLCipher, FTS5 and sqlite-vec; key in the Keystore through expo-secure-store. Rejected cheaper option: unencrypted SQLite, rejected for a phone that can be lost. Consequence: spike S2 proves the build (ASM-02).

**ADR-007: Threat model staged by risk.** Status: Accepted. Decision: injection and mistakes defended from W1 with a JavaScript approval key; a non-exportable Keystore key in a native module signs money and password approvals from W5 (FR-CAGE-06). Rejected cheaper option: JavaScript keys for everything, rejected for money. Consequence: US-CAGE-03 is in W5.

**ADR-008: Model download from Hugging Face over HTTPS with a pinned SHA-256.** Status: Accepted. Rejected cheaper option: the QVAC peer-to-peer registry, rejected because it exposes the user's IP to peers. Consequence: FR-MODEL-02.

**ADR-009: Zero telemetry, enforced in CI.** Status: Accepted. Decision: no analytics, crash reporting or tracking SDKs; a privacy CI gate and a lint rule (FR-PRIV-01). Rejected cheaper option: opt-in analytics, rejected because it needs a server and erodes the promise. Consequence: KPIs come from the eval and the device (2.3).

**ADR-010: Boost over Holepunch, in V2.** Status: Accepted. Decision: a bigger model on the user's own computer, paired directly; the cage stays on the phone. Rejected cheaper option: a hosted relay, rejected for privacy. Consequence: EP-18 reuses ADR-016's transport.

**ADR-012: The public website is a static Next.js site on Vercel only.** Status: Accepted. Decision: a static export with no server functions, no Supabase, no accounts, no analytics; the app never calls it. Rejected cheaper option: a hosted CMS, rejected as unneeded. Consequence: EP-17 and FR-SITE-01.

**ADR-013: es-419 and English from V1.** Status: Accepted. Decision: Spanish (Latin America) as the default for Spanish locales, English otherwise; locale files keyed by screen. Rejected cheaper option: English only, rejected because the first market is Spanish-speaking. Consequence: CT-10, NFR-13.

**ADR-014: Google Play plus a signed, reproducible APK on GitHub Releases.** Status: Accepted. Rejected cheaper option: Play only, rejected because the open-source audience needs to verify builds. Consequence: FR-PLAT-02, FR-PLAT-03, DEP-06.

**ADR-015: An x402 client in a pure TypeScript payments package.** Status: Accepted. Context: x402 has no React Native client. Decision: `packages/payments` implements x402 with EIP-3009 signed by the WDK EVM account; spiked in W2 before W5 builds on it. Rejected cheaper option: a hosted x402 proxy, rejected for privacy and custody. Consequence: FR-PAY-04, ASM-09.

**ADR-016: Holepunch transport in the QVAC worklet, with QR and 6-digit pairing.** Status: Accepted. Decision: phone-to-phone transfer uses Hyperswarm through QVAC; pairing by QR and a compared 6-digit code; the same transport serves Boost in V2. Rejected cheaper option: transfer through a cloud bucket, rejected for privacy. Consequence: EP-13, FR-MOVE-01.

**ADR-017: Connectors are signed specs run by one runtime on the phone, plus an MCP client.** Status: Accepted. Context: parity with cloud agents' thousands of connectors without a server (`docs/research/connectors.md`). Decision: declarative connector specs (CT-12) executed by one fixed runtime; OAuth with PKCE from the phone; credentials in a Keystore-backed store; an MCP client for Streamable HTTP servers; discovery from shipped specs, the MCP Registry, OpenAPI files and model-drafted specs. Rejected cheaper option: Composio or a similar hosted platform, rejected because it holds the user's tokens and runs every call on its servers, and its terms forbid reusing its catalog. Consequence: EP-25; the model can draft a spec but never code; risks only go up.

**ADR-018: Web tasks run in an in-app browser on the phone, read through the accessibility tree; open-ended tasks go to Boost.** Status: Accepted. Context: competitors drive browsers in cloud VMs. Decision: an Android WebView driven by typed browser skills over a pruned accessibility tree, bounded to known task kinds and 15 steps, with every committing click classified and approved (FR-WEB-05 to FR-WEB-08); open-ended browsing on Boost in V2. Rejected cheaper option: a cloud browser, rejected for privacy. Consequence: PDR-018; spike in W2 (ASM-19).

**ADR-019: Email talks directly to the provider.** Status: Accepted. Decision: Gmail API and Microsoft Graph with OAuth from the phone, IMAP and SMTP otherwise; no mail server of Hermit's own. Rejected cheaper option: a hosted mail aggregator, rejected for privacy. Consequence: EP-24; Google verification is a go-live dependency (DEP-10).

**ADR-020: Intents hand actions to other apps with the final tap left to the person.** Status: Accepted. Decision: typed intent skills (FR-APP-01). Rejected cheaper option: none needed; this is the Play-safe floor. Consequence: EP-26; Hermit can start new WhatsApp chats without an accessibility service.

**ADR-021: Phone use through an AccessibilityService, only in the sideload build.** Status: Accepted. Context: Google Play bans AI-planned automation through the Accessibility API, and AppFunctions are reserved for system roles (`docs/research/oss-phone-use.md`). Decision: a V2 "phone use" capability in the GitHub and F-Droid APK only: a numbered text tree of the screen, the AndroidWorld T3A action set under a grammar, user-chosen apps with sensitive categories always blocked, commit taps classified by the cage, no auto-accepted dialogs, foreground only. Rejected option: shipping it on Play, rejected because it would put the whole Play listing at risk. Consequence: EP-27; a W2 spike measures the model on AndroidWorld.

**ADR-022: The harness carries the model: native tool format, deterministic routing, arguments read by code.** Status: Accepted (Q30, 2026-11-11; measured in `docs/research/harness-diagnosis.md`). Context: on the same BotPsy-0.8B file and cases, ADR-004's two-stage JSON decoding scored 22/40, and the model's own tool format with a 256-token thinking budget scored 31/40. The full harness reached 84/100 on a blind held-out set and passed all 20 multi-turn trajectories on four seeds. Decision, refining ADR-004 (the typed skill menu, the cage and repair stay):
- **Format and thinking:** the model calls skills in its trained format, thinking with a budget that closes cleanly.
- **Router:** a deterministic router narrows the menu and forces a call on unambiguous phrases. A constrained fallback is used when the runtime doesn't enforce `tool_choice`.
- **Arguments by code:** times, dates and reply text are read from the user's own words (`SkillDef.normalize`, before the cage, so approvals bind the corrected arguments).
- **Pinned ids:** reply follow-through limits `conversationId` by grammar to ids that were actually read.
- **Fixed questions:** missing information gets a fixed question in the user's language.
- **Per device:** a runtime plan picks threads, cores and the thinking budget, and slow tiers skip thinking on routed calls.

Rejected option: a bigger model (Qwen3.5-4B took about 15 s per call and overheated the S26). Consequence: every new skill ships with tool-description text, router phrases in both languages and, where it takes times, names or quoted text, a normalizer. The harness evals (VA set, blind held-out sets, trajectories with pass^k) gate model and harness changes (Q31).

## 2.17 Product Decision Records

**PDR-001: The first user is an internal tester on the reference Galaxy S26 Ultra.** Status: Accepted. Alpha stays on that phone until the first-win demo works; no other testers in W1.

**PDR-002: The first win is talk, remember, remind and reply, through the cage.** Status: Accepted. No wallet in the first win. The WhatsApp reply proves the cage end to end.

**PDR-003: The bar is at most 15 seconds to first action and at least 85% correct, in es and en, on the S26 Ultra.** Status: Accepted. Measured by the eval (FR-MODEL-04); missing it triggers the fine-tune path (PDR-009).

**PDR-004: Calendar uses the user's own calendar, with an honest exception.** Status: Accepted. Events sync wherever the user's calendar syncs; the copy says so (US-ONB-05).

**PDR-005: Licenses and publication.** Status: Accepted; the publication part is superseded by Q210 to Q213. Code Apache 2.0; character art CC BY 4.0; the name, logo and wordmark reserved as trademarks; the Tether logo is used with a not-affiliated line. Superseded: the repository was to stay private until the alpha worked and the name was cleared, and Tether's written OK was needed before going public (DEP-04). Now the public repository starts from one clean commit (Q210). The Tether and QVAC logos and the partner line stay (Q211, which supersedes Q14's blocker). Everything is public except secrets, personal data and private messages (Q212). Device reports come in through an in-app Device lab and a GitHub issue form (Q213). Name clearance (OQ-01) stays open and no longer blocks the public repository.

**PDR-006: The reference crab drawing is the logo and the mascot.** Status: Accepted. The traced reference is the source of truth; the mascot is built from its pieces; it is never redrawn with an image model.

**PDR-007: V1 is the first win plus ears, eyes and hands.** Status: Accepted. Ears: voice notes. Eyes: web reading and the night shift. Hands: vault, form fill and logins, web tasks, money, and changing phones. Extended by PDR-017 to PDR-019 (email, web tasks, connectors). V2 is Boost, tuned models, iOS and agent to agent.

**PDR-008: Money in V1 is USD₮ through WDK plus x402 merchant payments.** Status: Accepted. Other assets are V2 (US-PAY-08). x402 needs a spike first (ADR-015).

**PDR-009: Use a stock model chosen by the eval; fine-tune only if it misses the bar.** Status: Accepted. The tuned model is V2 (US-TRAIN-01) unless the W2 gate fails the bar.

**PDR-010: Changing phones is phone to phone over Holepunch, in V1.** Status: Accepted. Encrypted file backup is V2 (US-MOVE-04).

**PDR-011: Money always asks, within caps the user sets.** Status: Accepted. No "approve for the session" for spend, send or credential risks, ever; caps are per payment and per day.

**PDR-012: The signed log is kept until the user clears it, and the clearing is logged.** Status: Accepted. FR-ACT-04.

**PDR-013: Accessibility to WCAG 2.2 AA, with TalkBack and dynamic type.** Status: Accepted. NFR-08.

**PDR-014: Voice is push-to-talk, in es and en, on the device.** Status: Accepted. Superseded by PDR-020.

**PDR-015: The web is read-only through a quarantined reader; logins happen only through the vault with exact-origin matching.** Status: Accepted. The read-only part is superseded by PDR-018; the quarantined reader and exact-origin logins stand.

**PDR-016: Release bands.** Status: Accepted; amended for bots (Q201, 2026-11-25). V1 as PDR-007, plus bots: several bots, their handoffs and their routines are V1, in waves B1 and B2 (PDR-029). V2: Boost, tuned models, iOS, other people's agents (EP-21, on the bus PDR-030 designs), and V1 deepening. V3: keep watch, Mac powers, family sharing, confidential-cloud Boost. US-NIGHT-05 moved from V2 to V1 as US-BOT-11.

**PDR-017: Email is in V1, direct from the phone.** Status: Accepted. Read, search, summarize, draft, archive and send across Gmail, Outlook and IMAP accounts; send always asks. Attachments, unsubscribe and style are V2 (Q19).

**PDR-018: Web tasks in V1 on the phone for known flows; open-ended browsing on Boost in V2.** Status: Accepted. Supersedes the read-only part of PDR-015. Every committing step asks (Q20).

**PDR-019: Connectors in V1: a signed catalog, an MCP client, and connectors Hermit drafts on request.** Status: Accepted. Following Instinct's experience: when a service has no connector, Hermit finds an MCP server or an OpenAPI file, or drafts a spec from the docs, and the user approves it; with no API, it offers a vault login and the in-app browser. Catalog growth is V2 (Q21, Q25).

**PDR-020: Hermit is a chat first; voice is secondary.** Status: Accepted. V1 has voice notes in the chat, transcribed on the phone. Read-aloud, realtime conversation and call screening are V2; wake word V3 (Q22).

**PDR-021: Google sign-in uses Dojo's OAuth client by default, with a bring-your-own option.** Status: Accepted. The alpha runs under the 100-user testing cap; Google verification is a go-live dependency (Q23).

**PDR-023: Opening other apps with prefilled intents is in V1.** Status: Accepted. W3 (Q26).

**PDR-024: Phone use ships in V2, only in the sideload build, after an AndroidWorld spike in W2.** Status: Accepted (Q27).

**PDR-025: Phones below the floor get Hermit without the model by default, and may run it with a warning.** Status: Accepted (Q33). Context: under 3 GB of RAM, or CPUs without ARMv8.2 dot product, BotPsy is too slow to be useful (`docs/research/device-adaptive-runtime.md`, tier "unsupported"). Decision: on these phones the model is off by default. Reminders, memory and the calendar work through simple forms, and settings let the user turn the model on with a clear warning that it will be slow. Rejected options: blocking the install (leaves those users with nothing), and running the model silently (a broken experience). Consequence: the runtime plan's "unsupported" tier switches the chat to forms until the user opts in.

**PDR-026: Open-ended web tasks and purchases stay on Boost for now; doing them fully on the phone is a standing long-term goal.** Status: Accepted (Q37). Context: doing open-ended web tasks and purchases fully on the phone with a sub-1B model is Hermit's distinctive long-term bet. Research (`docs/research/web-on-phone.md`, 2026-11-12) found no published web navigation result below 2B; the smallest credible ones are 2B on Android, 3B on WebArena-Lite and 4B on the live web. Decision: PDR-018 stands (known flows on the phone in V1, open-ended browsing on Boost in V2), and US-WEB-12 records the goal of moving every task family onto the phone, family by family, as each passes an on-phone eval gate. Rejected options: dropping the goal (it is Hermit's distinctive bet), and forcing it into V1 (no evidence a sub-1B model can do it yet). Consequence: the web eval lab measures each family on the phone and on Boost with the same cases, and the research lane (structured paths, recipes, a dedicated web-step model) continues alongside V1.

**PDR-027: Hermit pays in USD₮ only.** Status: Accepted (Q44). Context: the x402 spike (SL-18) settled a testnet payment in Base Sepolia USDC because that is what the public facilitator settles; USD₮0 had no public facilitator. Decision: the wallet, caps, approvals and x402 pay only in USD₮ (USD₮0 where a chain carries it); every other asset is refused in code, and the W5 gate settles USD₮0, with a self-hosted facilitator on a USD₮0 testnet if no public one exists. Rejected options: a USDC gate now with USD₮ later (Hermit is built on Tether's stack), and paying in any stablecoin a merchant asks for (more risk, no product need). Consequence: `packages/payments` keeps a USD₮-only asset list; the USDC run stays a recorded protocol check in `docs/research/x402-spike.md`.

**PDR-028: Hermit may read the phone's contacts to find a person the user names, and resolves mail recipients by name.** Status: Accepted (Q49 and Q48, 2026-11-14). Context: "llama a mi mamá", "text Carlos on WhatsApp" and "forward it to Ana" name a person without a number or address. V1 declared no contacts permission, so the other app's own picker chose the person and mail asked for the address (SL-58, SL-49). Decision: Hermit asks for READ_CONTACTS (optional, offered once in the chat when a name could not be looked up, and on HM-ONB-04 and HM-SET-01) and code resolves the name: only a name that appears in the user's own words this turn is looked up; matching is by code, accent- and case-insensitive, on the contact's own name or nickname field, never a synonym table; the model never receives the contact list. For mail, a name also resolves from the people the user emailed before (address book entries with origin "sent" only) and from the contacts' email addresses; when Hermit has to ask for an address, the people the user emailed before are tappable suggestions, and a typed address keeps working as before. Zero or several matches end the turn with a question (names with the last four digits, or masked addresses); a match never runs without the approval sheet, which shows the exact number or address and where it came from ("from your contacts", "you emailed before"), and keeps the new recipient flag of FR-MAIL-04. Without the permission, behavior is the same as before (the other app's picker, or Hermit asks for the address). Rejected options: the other app's picker only (a person named in the request should resolve without a second search in the other app), Android's contact picker inside Hermit (an extra step for every request), and resolving mail names from senders (a look-alike sender could compete for the name). Consequence: the declared permissions add READ_CONTACTS; contact data stays on the phone, is read for one lookup and is never stored in Hermit's database (the stored history keeps the call without the found number or address); FR-APP-02 and FR-MAIL-04 change as written in Part 2.

**PDR-022: Providers that require a client secret connect without a relay when possible, else through a relay the user chooses.** Status: Accepted. Default: an MCP server or the in-app browser. Options: the user's own open-source relay, or Dojo's relay as an explicit opt-in that stores nothing and is disclosed on the privacy screen (Q24).

**PDR-029: Hermit holds several bots, each a boundary, with Hermit as the coordinator, in V1 and two waves.** Status: Accepted (Q200, Q201 and Q202, 2026-11-25). Context: assistants like Grok Bot let people keep one bot per chat: specialists that wake on a schedule and carry on their work, two pinned at the top, and one that coordinates the others. Hermit had one chat; sessions, memory, cage rules and the approval sheet were global; one model served one queue. Decision: bots are contacts. The home is the roster (HM-BOT-01), with Hermit starred at the top plus up to 2 pins, at most 50 bots. Each bot has one main chat, its own role, notes, permissions, sources and mode, and the cage enforces each bot's groups in code, so a bot is a real boundary, unlike Grok Bot's shared computer (FR-BOT-03). Hermit is the primary bot: exactly one, can't be deleted, hidden or duplicated, and the user can't make another bot primary in V1. A bot reads its own notes plus the shared profile, and tainted facts never enter the shared profile. Multi-bot is V1, built in two waves (Q201). Wave B1: the roster, a chat per bot, per-bot notes, grants, sources and modes, bots made by asking Hermit or from a form, and the upgrade that keeps today's chat as Hermit's. Wave B2: handoffs between bots (PDR-030), routines in plain words that wake a bot on a schedule (Q202: on battery too, at most hourly, one small step per wake, paused below 30% battery, when warm or in battery saver, down to every 15 minutes while charging, and each bot shows its last and next run), group chats, and Hermit's report. The model stays one and the queue one (FR-BOT-05). Rejected options: one Hermit with many chats (no specialists with boundaries, and nothing to coordinate); bots as @skills in one chat (furthest from one bot per chat); bots in V2 as the PRD said before; wake-ups only while charging, like the night shift, and any interval the user sets down to 15 minutes on battery (it can drain the battery). Consequence: EP-28 holds the stories (EP-23 is taken, and IDs are stable); migration 17 adds the tables (FR-BOT-01); US-NIGHT-05 is superseded by US-BOT-11; "Navigation is chat-first" becomes bot-first; with no bots and Ask mode, Hermit behaves as it did with one chat.

**PDR-030: Bots talk through an in-process bus that follows A2A 1.0, with Hermit's trust rules; the bus is wave B2.** Status: Accepted as a wave 2 design record (Q203, Q205 and Q206, 2026-11-25). Context: the decision is an A2A framework with full parity with Grok Bot, so any bot can message any bot, the receiver wakes, handles it and replies later. Grok Bot has no switch for this and once snowballed. Decision: the bus follows the A2A 1.0 specification in process. Code generates an Agent Card per bot from its row and grants, and the model never writes a card. A message creates a Task with the A2A states and a `contextId`, Messages carry parts, results come back as Artifacts, and a follow-up names its task in `referenceTaskIds`. The model has two skills, `message_bot` and `reply_to_bot`, and code validates the target, the hop count and the budget before anything queues. The tables `a2a_tasks` and `a2a_messages` (migration 18) join the erase list; the signed log records bot ids and task ids, never content. Loop guards: one reply per message, a hop cap of 4 handoffs per chain, a daily budget of 24 handoff or routine turns per bot, an empty reply closes the task without a message, and a "Bots can message each other" switch on by default. Trust rules: a bot's words are data, so another bot's text enters a turn as untrusted input with a new `bot` taint kind, wrapped like a web page, and never counts as the user's own words. Work the user didn't start is unattended and follows the mode (PDR-031); what the mode doesn't allow alone becomes a suggestion card, shown in code-written text only. Results stay out of the chat's memory (Q205): they reach other chats as cards rendered by code, Hermit reads a result's text only in the turn the user asks, and afterwards the chat keeps a code-written line ("Leí el resultado de Viajes de las 10:00"), so the chat stays clean for payments and logins. Money and logins never start from a bot (Q206): the bot posts a code-written note ("Noticias quiere pagar: ábrelo para hacerlo") in its chat and in Hermit's report, and the user asks for it in their own words, in a clean turn, through the normal sheet and the fingerprint, in every mode. Built in wave B1 already: the per-bot boundary (FR-BOT-03), the tiers and modes (FR-CAGE-07, FR-CAGE-08), the fingerprint to grant (FR-BOT-09), the log by bot id (FR-BOT-10) and the money and login rule. Rejected options: bots through Hermit only, one level deep; no talking between bots in V1. Consequence: later, the same objects over A2A's HTTP+JSON or JSON-RPC bindings with signed Agent Cards serve Boost and other people's agents (EP-21, V2), so nothing in the bus may assume a bot is local beyond its binding.

**PDR-031: Hermit has three permission modes, Ask, Auto and Don't ask, chosen by the user, globally and per bot.** Status: Accepted (Q204, 2026-11-25): each person picks their own risk tolerance, with clear warnings. Context: what a bot may do with nobody in its chat, and how much the user's own chat should ask. Decision: Ask is the default and today's rules. Auto runs low-risk steps without asking; medium and high risk ask. Don't ask runs everything except money and logins. The user picks one in Settings for all of Hermit and may give a bot its own; a bot inherits the global mode until it has one, and a copy of a bot inherits the global mode instead of its original's. Risk tiers are code: each skill carries a tier, a skill without one is high, and Auto never asks the small model whether something is safe, because a reviewer model on a 0.8B is weak and injectable (FR-CAGE-07, FR-CAGE-08). As built in wave B1: Auto opens only links that appear in the user's messages and mail or in the user's own words; a link Hermit composes still asks, and web reads give nothing to follow. Alone, a bot can't use private data and the web in one run, in Ask and in Auto; this is a coordinator ruling stricter than the first spec text, which allowed the combination in Auto, because reading private data and then using the web unattended is the exfiltration combination. Only Don't ask lifts it. Notes carry the read kinds of the run that wrote them across runs, so a bot that mixed private data and the web can't use the web alone later. A step a mode runs is logged as "ran" with its reason and is never remembered as an approval. A bot's own Don't ask needs the fingerprint and the typed word, "entiendo" or "I understand", even under a global Don't ask. Money and logins need the fingerprint in the user's own words in every mode, and never start from a bot (Q206). Warnings: the Auto sheet says what runs without asking (read, save notes, create reminders and events, open links and search the web even when they come from others' text); that a page with many links can steer which one it opens; that a search after reading other people's text sends the user's search provider a query Hermit wrote, which can include what it read; that it may open confirm, unsubscribe or sign-in links found in the user's mail and messages; that a link Hermit builds itself still asks; that it still asks before replying, sending an email or changing someone else's data; that alone it can't read private data and use the web in one task; and that payments and logins always need the fingerprint (right after its title). The Don't ask sheet is red and says a web page could make Hermit send messages or emails in the user's name, delete things or share their data; that tools from connected services run without asking and Hermit can't always tell whether one moves money; that payments and logins still need the fingerprint; and that turning it on needs the fingerprint and the typed word. While a chat or bot runs in Auto or Don't ask, its bar shows a chip (amber for Auto, red for Don't ask) and the roster shows it on the row. Rejected options: a reviewer model that judges safety (weak and injectable at 0.8B); a bot's grants as standing permissions in every case; bots that use only notes, calendar and reminders when alone. Ask keeps Q204's recommended rule: a bot alone reads its own sources and the private data its grants hold, and the private-data split governs what it may combine. Consequence: FR-CAGE-02 is amended and FR-CAGE-07 and FR-CAGE-08 are added; every mode keeps the signed log, the untrusted markers, code-written approval text, the loop guards and the user's erase and delete.

## 2.18 Quality, testing, and Definition of Done

Test layers:

- **Unit.** Pure logic in the packages: policy decisions, hard limits, canonical JSON and `argsHash`, repair, memory rules, the audit chain, x402 payload building, money formatting. Vitest in Node.
- **Cage isolation.** The hard limits of FR-CAGE-02 asserted with every configurable rule removed or inverted, so no rule change can open send, spend or credential use. This is Hermit's equivalent of RLS isolation tests.
- **Adapter contracts.** Each phone adapter (QVAC, op-sqlite, notifications, calendar, Keystore, WDK, Holepunch) has a fake that implements the same port and a contract test both run, so features never need a live phone in CI.
- **Eval.** The eval harness (FR-MODEL-04) with the fake model on every PR, and with the real model on the phone at each wave gate; the injection set is part of it (NFR-07).
- **On-device journeys.** The wave's journey script, run by hand or with Maestro on the S26 Ultra at each gate.
- **Accessibility.** Automated label checks plus a manual TalkBack pass at the W3 gate and every later gate.
- **Integrity.** The signed log verifies after every journey; amounts stay integers; migrations apply forward from every earlier version.

Where each runs: unit, lint, typecheck, the privacy gate and the eval with the fake model on every PR; cage isolation and adapter contract tests on every PR of a T1 slice; the on-device journey and the real-model eval at each wave gate, on the merged result.

Definition of Done (per slice): the behavior matches its stories' acceptance criteria and the FRs and contracts they cite; its tests pass at the layers its tier requires; the cage decides every skill it adds; it records local events with the shared envelope; copy is externalized in both locales; its screens carry their IDs and render the defined states (loading, empty, error, offline where relevant); accessibility checks pass on its screens; its step is in the wave's journey script and passes on the S26 Ultra; and its Linear issue reflects the merged state. Part 3.9 adds what T1 requires.

## 2.19 Risks, assumptions, dependencies, and open questions

### Assumptions and verified facts

| ID | Assumption | Source | Status |
| :---- | :---- | :---- | :---- |
| ASM-01 | QVAC 0.23 runs a 1B to 4B instruction model on the S26 Ultra's GPU through bare-kit inside an Expo dev build | `docs/research/qvac.md`, 2026-11-08 | Unverified |
| ASM-02 | op-sqlite builds with SQLCipher, FTS5 and sqlite-vec on Expo SDK 58 | `docs/research/platform.md`, 2026-11-08 | Unverified |
| ASM-03 | The QVAC worklet bundle and the model loader fit Expo's build without ejecting | `docs/build/wave-0-spikes.md` | Unverified |
| ASM-04 | WhatsApp notifications expose a `RemoteInput` reply action that a listener can fire | `docs/research/platform.md`, 2026-11-08 | Verified |
| ASM-05 | Sideloaded apps on Android 13 or later need "Allow restricted settings" before notification access | Android documentation, 2026-11-08 | Verified |
| ASM-06 | Google Play accepts a notification listener used for an assistant with a declared use | Play policy, 2026-11-08 | Unverified |
| ASM-07 | Android Keystore keys can require biometric authentication per use and are non-exportable | Android documentation, 2026-11-08 | Verified |
| ASM-08 | WDK runs in the same worklet once its bare-kit dependency moves from 0.14.5 to 0.16 or later | Tether WDK issue, `docs/research/wdk.md`, 2026-11-08; SL-17 2026-11-17: no Tether release yet, but `@tetherto/wdk-wallet-evm` runs in Hermit's own worklet on Bare 1.33.4 (bare-kit 0.16.0's runtime) on the Mac with three pins, `docs/research/wdk-worklet-spike.md`; the phone run is pending | Unverified |
| ASM-09 | x402 `exact` payments on EVM can be built with EIP-3009 in pure TypeScript and signed by a WDK account | x402 specification, `docs/research/wdk.md`, 2026-11-08 | Unverified |
| ASM-10 | An Expo app can register an Android `AutofillService` through a custom native module | Android documentation, 2026-11-08 | Unverified |
| ASM-11 | Public EVM RPC endpoints are sufficient for balance and history without an API key | Provider documentation, 2026-11-08 | Unverified |
| ASM-12 | Hyperswarm through QVAC connects two Android phones on the same and on different networks | `docs/research/vault-p2p.md`, 2026-11-08 | Unverified |
| ASM-13 | Android 15 and later hide one-time codes in notifications from listener apps | Android documentation, 2026-11-08 | Verified |
| ASM-14 | Google OAuth supports Android public clients with PKCE and no client secret, using app link redirects | Google OAuth documentation, `docs/research/connectors.md`, 2026-11-11 | Verified |
| ASM-15 | An unverified Google app using sensitive scopes is capped at 100 users for its lifetime | Google documentation, `docs/research/connectors.md`, 2026-11-11 | Verified |
| ASM-16 | Google's restricted-scope security assessment does not apply when Gmail data never reaches a server | Third-party sources, `docs/research/connectors.md`, 2026-11-11 | Unverified |
| ASM-17 | Slack, Notion and LinkedIn require a client secret in the token exchange | `docs/research/connectors.md`, 2026-11-11 | Unverified |
| ASM-18 | The phone model drafts valid connector specs from API docs often enough to be useful | None yet | Unverified |
| ASM-19 | The phone model completes known web tasks from a pruned accessibility tree within 15 steps | None yet | Unverified |
| ASM-20 | An MCP client over Streamable HTTP with OAuth runs in React Native | `docs/research/mcp-client-spike.md`, 2026-11-14: a pure TypeScript client (no Node API, platform `URL`, WebCrypto or streaming) passes discovery, dynamic registration, PKCE sign-in, initialize, tools/list and tools/call against the official SDK's OAuth server on the Mac; the expo/fetch adapter and the browser hand-off are not yet run on the phone (SL-54) | Unverified |
| ASM-21 | MCP servers with dynamic client registration (Notion, Linear, Asana, HubSpot and others) accept a phone app-link redirect | `docs/research/mcp-client-spike.md`, 2026-11-14: read-only discovery shows Asana and HubSpot have no dynamic registration; Notion, Linear, Sentry, Vercel, Canva, Stripe, PayPal and Atlassian register public clients; Supabase and Figma only confidential ones. The SDK reference server accepts `hermit://` and app-link redirects; production servers not yet registered against (needs the product owner's OK), and `hermit.dojocoding.io` does not resolve yet | Unverified |
| ASM-22 | Hermit's phone model reaches a useful AndroidWorld score with a text tree and the T3A action set | `docs/research/oss-phone-use.md`, 2026-11-11 | Unverified |
| ASM-24 | QVAC 0.23 loads BotPsy-0.8B (Qwen3.5 Gated DeltaNet layers) on the S26 Ultra's GPU | Model card says GGUF for the QVAC SDK, 2026-11-11 | Unverified |
| ASM-25 | BotPsy-0.8B reaches at least 85% correct first actions in Spanish within the speed bar | Card recommends English; blog reports multilingual instruction following of 72 to 80 for Spanish, 2026-11-11 | Unverified |
| ASM-23 | Google Play bans AI-planned automation through the Accessibility API for apps that are not accessibility tools | Google Play policy, `docs/research/oss-phone-use.md`, 2026-11-11 | Verified |

### Dependencies

| ID | Dependency | Owner | Blocks |
| :---- | :---- | :---- | :---- |
| DEP-01 | The S26 Ultra connected over USB with developer mode and ADB authorized on the build Mac | Tester | W1 |
| DEP-02 | At least 15 GB free on the build Mac for Android builds | Tester | W1 |
| DEP-03 | A test WhatsApp contact who sends messages during the gate | Tester | W1 |
| DEP-04 | Tether's written OK to show its logo publicly. Superseded by Q211: the Tether and QVAC logos and the partner line stay, and this no longer blocks going public (Q14's blocker is superseded) | Product owner | none |
| DEP-05 | Trademark clearance for the name Hermit (OQ-01, open). It no longer blocks the public repository (Q210 to Q213) | Product owner | go-live |
| DEP-06 | A Google Play developer account in Dojo Coding's name | Dojo | W6 |
| DEP-07 | A WDK release compatible with bare-kit 0.16 or later (still open on 2026-11-17: `wdk-react-native-core` 1.0.0-beta.24 is unchanged, its issue #140 is open and React Native is outside Tether's current roadmap; SL-17 works around it with Hermit's own wallet worklet, so W5 no longer waits on it once the phone check passes) | Tether | W5 |
| DEP-08 | A Vercel project and a domain for the website | Dojo | W6 |
| DEP-09 | A new OpenAI key for brand image work (not product work) | Product owner | none |
| DEP-10 | Hermit's Google OAuth client registered (W2) and verified by Google, with the security assessment if it applies | Dojo | go-live |
| DEP-11 | A Microsoft Entra app registration for Outlook and Graph | Dojo | W2 |
| DEP-12 | Dojo's opt-in OAuth relay deployed from the open-source code | Dojo | W4 |

### Risks

| ID | Risk | Posture |
| :---- | :---- | :---- |
| RSK-01 | The stock model misses the accuracy or speed bar | The eval decides (PDR-009); a tuned model path is written (US-TRAIN-01); the skill menu can be narrowed |
| RSK-02 | QVAC or bare-kit changes break the build | Versions pinned; the `Model` port isolates the runtime |
| RSK-03 | WhatsApp changes its notifications | The capture contract is app-agnostic; `stale` handling is explicit (FR-MSG-04) |
| RSK-04 | Play rejects the notification listener | The reproducible APK on GitHub is a second channel (ADR-014) |
| RSK-05 | WDK stays blocked | W5 moves after W6 if needed; the payments package is independent of the wallet source |
| RSK-06 | A new injection technique beats the cage | Hard limits do not depend on the model; the injection set grows with each finding |
| RSK-07 | The phone overheats under long night jobs | Thermal and battery guards (NFR-04) |
| RSK-08 | A drafted or imported connector is used to exfiltrate data | Hosts are fixed by the spec and approved; risks only go up; results are untrusted; the spec hash is logged (FR-CONN-02, FR-CONN-08) |
| RSK-09 | The phone model is unreliable at web tasks | Tasks are bounded and approved step by step; the user can take over; open-ended tasks go to Boost (ADR-018) |
| RSK-10 | Google verification blocks public email | Bring-your-own client (PDR-021) and IMAP stay available |

### Open questions

| ID | Question | Owner | Blocks | Status |
| :---- | :---- | :---- | :---- | :---- |
| OQ-01 | Is the name Hermit clear to use as a trademark in the target markets? It no longer blocks the public repository (Q210 to Q213) | Product owner | go-live | Open |
| OQ-02 | Does offering a self-custodial wallet in the app create licensing duties in the US, Panamá or Costa Rica? | Product owner | W5 | Open |
| OQ-03 | Which stock model and profile win the eval? Lead candidate BotPsy-0.8B (`docs/research/botpsy.md`), then the candidates in `docs/research/qvac.md` | Dojo | W2 | Open |
| OQ-04 | Which search provider does `search_web` use by default, and is it private enough? | Product owner | W3 | Open |
| OQ-05 | Which domain hosts the website? | Product owner | W6 | Open |
| OQ-06 | Does Google's restricted-scope security assessment apply to an on-device Gmail client (ASM-16)? | Product owner | go-live | Open |

## 2.20 Wave plan (sequencing only, no timelines)

V1 is delivered in waves: W0 prepares the ground, W1 is the first win, and each later wave widens the product toward the complete V1. The multi-bot waves B1 and B2 are built beside W2 to W6 and are part of V1 (PDR-016). There are no dates, durations, or estimates. A wave ends at a gate of capability, never at a date.

| Wave | Goal | Gate |
| :---- | :---- | :---- |
| W0 | Preflight and contracts (Part 3.2) | CI green on a trivial PR, the dev build installs on the S26 Ultra, the contracts are merged, the W1 tables migrate, the W1 brief is written |
| W1 | The first win (2.6), with spikes S1 to S4 | The first-win journey script passes on the S26 Ultra |
| W2 | Voice notes, email and the connector catalog, the model proven on device, turn control, and the spikes that de-risk the hands (WDK, x402, Holepunch, autofill, Play policy, web tasks, MCP, spec drafting) | A voice note in es and in en runs a turn; the tester connects a test Gmail account, gets an inbox summary and sends an approved reply; a catalog connector connects and disconnects; the eval meets the bar on device; each spike has a written result |
| W3 | Eyes: web reading and the night shift, opening other apps, plus settings, privacy, language and accessibility | A page with an injected instruction is read and nothing acts; a night shift produces a briefing whose suggestion is approved in the morning; a TalkBack pass completes |
| W4 | Hands I: vault, form fill and logins, web tasks, the MCP client and connectors Hermit drafts | A form in another app is filled after approval; a login fills only on the exact origin and refuses a lookalike; a reorder on a reference site completes with each committing step approved; "connect to" a service with no catalog entry yields an approved spec that works |
| W5 | Hands II: the USD₮ wallet, caps, Keystore approvals and x402 | A testnet payment to a contact and an x402 testnet purchase both complete within caps, and an over-cap payment is denied |
| W6 | Changing phones and distribution | A full transfer to a second phone verifies; the Play internal track and the reproducible APK are published; the website is live |
| B1 | Bots (PDR-029): the roster, a chat per bot, notes, permissions, sources and the three modes | The multi-bot phone checks pass on the S26 Ultra: the upgrade keeps the chat as Hermit's, three synthetic bots follow their roles and every grant refusal is code's answer, Activity shows no skill outside a bot's grants, and a tainted proposal offers Review only |
| B2 | Bots work together (PDR-030): handoffs, routines, group chats and Hermit's report | A handoff between two bots runs with the loop guards; a routine wakes a bot within the battery budget; a page read by one bot that tells another to pay ends as a suggestion at most |

Later bands: V2 (Boost, tuned models, iOS, agent to agent, and the V1 deepening stories) and V3 (keep watch, Mac powers, family sharing, confidential cloud) stay on the map, outside the build queue.

---

# PART 3: AGENTIC-FIRST DELIVERY MODEL

This PRD is the map: every story, screen, contract and decision, with a stable ID. Part 3 is the lane that builds it. Work moves in waves. Each wave is a set of vertical slices; each slice becomes one Linear issue and one or more atomic PRs; each agent receives the wave brief plus the slice packet, the exact text of the map that its slice cites. Nobody builds from the whole map, and nobody builds from memory. The same ID is visible at every layer, so a change requested by ID lands in exactly one place.

## 3.1 Principles: the map and the lane

- The build is executed by coding agents: Claude Code (Opus 5.5) and OpenAI Codex. The product owner sets direction, resolves ambiguity, fact-checks machine output, runs the on-device gates and decides what merges.
- **Exhaustive map, dosed delivery.** The map stays complete so no agent invents behavior; the lane decides what is built now.
- **First win first.** Ordering is by capability and dependency, never by time.
- **Maximum safe parallelism.** The measured constraint here is the build Mac: its free disk, its memory and one connected phone. Heavy commands (Android builds, the full suite) run one at a time; pure-package slices run in parallel worktrees freely. The agent count lives in the wave brief.
- **Clean, narrow context per unit.** The slice packet (3.5) keeps each agent's context exact.
- **Rigor where the risk is.** T1 for the cage, keys, the vault, connectors and credentials, email, money and captured messages; T2 for everything else.

## 3.2 W0: preflight and contracts

This is a brownfield start: the agent core, the cage, the skills, the eval and the app shell are merged (PRs 1 to 3). W0 is a closed list:

1. **CI that runs.** GitHub Actions already runs typecheck, lint, tests and the privacy gate. Add branch protection on `master` and a `Dev` integration branch; merges into `Dev` need green CI; the product owner merges `Dev` into `master` at each gate.
2. **The dev environment.** The Expo dev build installs on the S26 Ultra (DEP-01, DEP-02). The "staging" of this product is that phone plus the Node eval.
3. **The contracts as code.** CT-01 to CT-11: most exist in `packages/core` and `packages/cage`; add CT-01 (money), CT-03 (local events), CT-04 (error codes) and CT-10 (copy keys and locale files).
4. **Conventions and design tokens.** Tokens from `docs/brand/tokens.json` exported to `apps/mobile/src/theme.ts`; fonts self-hosted; the mascot rig assets bundled.
5. **The W1 tables only.** Migrations for `notes`, `reminders`, `conversations`, `messages`, `chat_turns`, `sessions`, `approvals`, `audit`, `settings`, `model_installs`, `local_events`, with a slot pre-assigned to each W1 slice.
6. **Inventory of the existing code.** What W1 reuses (`runTurn`, `decide`, `createAuditLog`, the 8 skills, `nodeSql` for tests) and what stays switched off (nothing yet).
7. **The operating kit.** The W1 brief written from the real repository (`docs/build/wave-brief.md`).

**Gate W0:** CI is green on a trivial PR, the dev build installs on the S26 Ultra, the contracts are merged, the W1 tables migrate, and the W1 brief exists.

## 3.3 Waves, gates and the fast-lane laws

- **W0:** preflight and contracts. **W1:** the first win. **W2 to W6:** widen toward the complete V1 as sequenced in 2.20. **V2 and V3** stay on the map.

After W1, slices are ordered by: finish before widening; remove go-live blockers and unverified facts early (which is why W2 carries the WDK, x402, Holepunch, autofill, Play, web-task, spec-drafting and AndroidWorld spikes, and W3 the MCP spike); serve the next most common task (voice, then reading, then hands); then breadth.

**The fast-lane laws.**

1. Agents work only on the current wave.
2. Only slices become issues.
3. The V1 slice total is capped (3.4); going over reopens the scope decision with the product owner as a PDR.
4. A gate is executable: the journey script passes on the S26 Ultra and every slice of the wave is merged. Unfinished slices roll forward.
5. When the map is silent, stop: add a question to the wave list and take another slice.
6. The smallest complete change: a seam for later is a reserved column or an interface, never working behavior.
7. The map stays current: errata are folded in by ID in one docs PR at each gate.

## 3.4 The slice map

| Slice | Wave | Outcome | Stories | Tier | Depends on | Status |
| :---- | :---- | :---- | :---- | :---- | :---- | :---- |
| SL-01 | W1 | First launch, verified model download and permissions on the S26 Ultra | US-ONB-01, US-ONB-03, US-ONB-04, US-ONB-05 | T2 | SL-09, SL-11 | Prove |
| SL-02 | W1 | Chat runs on the phone's model, streaming, offline, with the "On this phone" chip | US-MODEL-01, US-CHAT-01, US-CHAT-02, US-CHAT-03 | T2 | SL-09, SL-01 | Prove |
| SL-03 | W1 | Clarifying questions and failed turns render on the phone | US-CHAT-04, US-CHAT-05 | T2 | SL-02 | Prove |
| SL-04 | W1 | Remember, recall and forget on the encrypted database with provenance | US-MEM-01, US-MEM-02, US-MEM-03, US-MEM-05, US-MEM-06 | T1 | SL-10, SL-02 | Prove |
| SL-05 | W1 | Reminders fire offline and the calendar reads and adds events | US-REM-01, US-REM-02, US-CAL-01, US-CAL-02 | T2 | SL-02 | Prove |
| SL-06 | W1 | WhatsApp messages are captured, queued when closed, and readable as untrusted | US-MSG-01, US-MSG-05 | T1 | SL-12, SL-10 | Prove |
| SL-07 | W1 | An exact reply is approved with a fingerprint and sent, or blocked or stale with a reason | US-MSG-02, US-MSG-03, US-APPR-01, US-APPR-02, US-APPR-03, US-APPR-04, US-CAGE-01 | T1 | SL-06 | Prove |
| SL-08 | W1 | The activity log lists every step and verifies the chain on the phone | US-ACT-01, US-ACT-02 | T2 | SL-10 | Prove |
| SL-09 | W1 | Spike S1: QVAC runs BotPsy-0.8B (Q4_K_M) on the S26 Ultra's GPU in the dev build, with memory and speed measured | ASM-01, ASM-24 | T2 | none | Done |
| SL-10 | W1 | Spike S2: op-sqlite with SQLCipher and FTS5 on Expo SDK 58 | ASM-02 | T2 | none | Done |
| SL-11 | W1 | Spike S3: the worklet bundle and model loader in the Expo build | ASM-03 | T2 | SL-09 | Done |
| SL-12 | W1 | Spike S4: the notification listener fires a WhatsApp reply action | ASM-04 | T2 | none | Prove |
| SL-13 | W2 | Voice notes in es and en, transcribed on the phone, with transcript review | US-VOICE-01, US-VOICE-02, US-VOICE-04 | T2 | SL-02 | Open |
| SL-14 | W2 | The model meets the bar on device in es and en (profiles of FR-MODEL-05) and recovers from bad output | US-MODEL-02, US-MODEL-03, ASM-25 | T2 | SL-02 | Open |
| SL-15 | W2 | Stop a turn, and summarize unread chats | US-CHAT-06, US-MSG-04 | T2 | SL-07 | Prove |
| SL-16 | W2 | A failed download explains itself and retries cleanly | US-ONB-07 | T2 | SL-01 | Prove |
| SL-17 | W2 | Spike: WDK in the worklet with bare-kit 0.16 | ASM-08 | T1 | DEP-07 | Prove |
| SL-18 | W2 | Spike: an x402 testnet purchase from the payments package | ASM-09, ASM-11 | T1 | none | Prove |
| SL-19 | W2 | Spike: Holepunch between two Android phones | ASM-12 | T2 | none | Open |
| SL-20 | W2 | Spike: an Android autofill service from an Expo native module | ASM-10 | T2 | none | Prove |
| SL-21 | W2 | Spike: a Play internal-track upload with the notification listener declaration | ASM-06 | T2 | DEP-06 | Open |
| SL-47 | W2 | The connector runtime, credential store, catalog and sign-in options | US-CONN-01, US-CONN-02, US-CONN-08 | T1 | SL-07 | Prove |
| SL-48 | W2 | Connect mail accounts, summarize and search the inbox | US-MAIL-01, US-MAIL-02, US-MAIL-03, US-MAIL-08 | T1 | SL-47 | Prove |
| SL-49 | W2 | Draft, send and organize email with approval | US-MAIL-04, US-MAIL-05, US-MAIL-06 | T1 | SL-48 | Prove |
| SL-50 | W2 | Spike: the phone model completes a known web task from the accessibility tree | ASM-19 | T2 | SL-14 | Done |
| SL-59 | W2 | Spike: Hermit's model on AndroidWorld with a text tree (decides the V2 phone use) | ASM-22 | T2 | SL-14 | Open |
| SL-52 | W2 | Spike: the phone model drafts a valid connector spec from API docs | ASM-18, ASM-17 | T2 | SL-47 | Done |
| SL-51 | W3 | Spike: an MCP client with OAuth and dynamic client registration in React Native | ASM-20, ASM-21 | T2 | none | Prove |
| SL-58 | W3 | Open other apps with prefilled intents | US-APP-01, US-APP-02, US-APP-03, US-APP-04 | T2 | SL-07 | Prove |
| SL-22 | W3 | Read a web page through the quarantined reader, approved per domain | US-WEB-01, US-WEB-02, US-WEB-04 | T1 | SL-07 | Prove |
| SL-23 | W3 | Search the web with the chosen provider | US-WEB-03 | T2 | SL-22 | Prove |
| SL-24 | W3 | The night shift runs unattended and leaves a morning briefing, with email | US-NIGHT-01, US-NIGHT-02, US-NIGHT-03, US-NIGHT-04, US-CAGE-02, US-MAIL-07 | T1 | SL-07, SL-48 | Prove |
| SL-25 | W3 | Permissions, the privacy screen and the app lock | US-SET-01, US-SET-02, US-SET-09, US-ONB-08 | T2 | SL-01 | Prove |
| SL-26 | W3 | Delete everything | US-SET-03 | T1 | SL-25 | Prove |
| SL-27 | W3 | Language choice, TalkBack, large text and dark mode | US-ONB-02, US-SET-05, US-SET-07, US-SET-08 | T2 | SL-07 | Prove |
| SL-28 | W3 | The mascot state, quiet mode and About | US-CHAT-08, US-SET-06, US-SET-10 | T2 | SL-02 | Prove |
| SL-29 | W3 | Browse memories and keep or clear chat history | US-MEM-04, US-CHAT-07 | T2 | SL-04 | Prove |
| SL-30 | W3 | List reminders and choose the calendar | US-REM-03, US-CAL-03 | T2 | SL-05 | Prove |
| SL-31 | W3 | WhatsApp Business and the one-time code explanation | US-MSG-06, US-MSG-07 | T2 | SL-06 | Prove |
| SL-32 | W3 | Activity details and a logged clear | US-ACT-03, US-ACT-04 | T2 | SL-08 | Prove |
| SL-33 | W4 | The vault: create, add, view, generate | US-VAULT-01, US-VAULT-02, US-VAULT-04 | T1 | none | Prove |
| SL-34 | W4 | Import passwords from CSV | US-VAULT-03 | T1 | SL-33 | Prove |
| SL-35 | W4 | Fill forms in other apps from the profile | US-FORM-01, US-FORM-03 | T1 | SL-33, SL-20 | Prove |
| SL-36 | W4 | Log in with an exact-origin credential | US-FORM-02 | T1 | SL-35 | Prove |
| SL-53 | W4 | Web tasks in the in-app browser, watched live, approved at each committing step, and saved as recipes | US-WEB-06, US-WEB-07, US-WEB-08, US-WEB-09, US-WEB-11 | T1 | SL-36, SL-50 | Prove |
| SL-54 | W4 | Add an MCP server and use its tools under the cage | US-CONN-03 | T1 | SL-47, SL-51 | Prove |
| SL-55 | W4 | "Connect me to X": discover, import or draft a connector and approve it | US-CONN-04, US-CONN-05, US-CONN-06 | T1 | SL-54, SL-52 | Prove |
| SL-56 | W4 | A vault login for services with no API | US-CONN-07 | T1 | SL-33, SL-53 | Prove |
| SL-57 | W4 | Sign in through the user's own relay or Dojo's opt-in relay | US-CONN-09, US-CONN-10 | T1 | SL-47 | Prove |
| SL-37 | W5 | Money and password approvals signed by a Keystore key | US-CAGE-03 | T1 | none | Prove |
| SL-38 | W5 | Create, back up and restore the wallet | US-PAY-01, US-PAY-02 | T1 | SL-17 | Prove |
| SL-39 | W5 | Balance, history and receive | US-PAY-03, US-PAY-04 | T1 | SL-38 | Prove |
| SL-40 | W5 | Pay a contact by asking, within caps | US-PAY-05, US-PAY-06 | T1 | SL-37, SL-39 | Prove |
| SL-41 | W5 | Pay an x402 merchant | US-PAY-07 | T1 | SL-40, SL-18 | Prove |
| SL-42 | W6 | Pair, transfer and wipe the old phone | US-MOVE-01, US-MOVE-02, US-MOVE-03 | T1 | SL-19 | Open |
| SL-43 | W6 | The device floor check and safe model updates | US-ONB-06, US-MODEL-04 | T2 | SL-01 | Prove |
| SL-44 | W6 | Release on the Play internal track with no trackers | US-PLAT-01, US-PLAT-03 | T2 | SL-21 | Open |
| SL-45 | W6 | A reproducible signed APK on GitHub Releases | US-PLAT-02 | T2 | SL-44 | Open |
| SL-46 | W6 | The public website: home, privacy policy, download | US-SITE-01, US-SITE-02, US-SITE-03 | T2 | SL-45 | Prove |

Tiers: T1 where a slice changes the cage, keys, the vault, credentials, connectors, email, money or captured personal messages; T2 otherwise. Slices marked `Finish` build on code already merged in `packages/*` and add the phone side. Status as of 2026-11-21: `Done` is proven on the S26 Ultra; `Prove` is built and merged, waiting for its check on the phone (its wave's gate); `Finish` is merged in `packages/*` with the phone side still to build; `Open` is not started. SL-48 and SL-49 moved from `Finish` to `Prove` with the app's mail (Gmail and Outlook; IMAP accounts follow with Q46's TLS socket).

## 3.5 Wave briefs and the slice packet

- **The wave brief** is written at the previous gate from the real repository: scope and explicit NOs, the stack and its gotchas (Expo SDK 58, bare-kit pinning, TypeScript 6.0.3 for typescript-eslint), what exists with real paths, the commands agents may run (and that heavy ones run one at a time, after a free-disk check), the device rules, the slices and how to report back.
- **Dispatch.** An agent receives the brief, the slice packet (the slice's section of this PRD: the exact text of every ID its row cites) and the slice row. Nothing else.
- **IDs, not copies.** Issues carry IDs; packets are extracted at dispatch.

## 3.6 Parallelism without collisions

- **Lanes follow journeys.** Contracts land in W0; slices fan out from them.
- **Ownership.** Each slice owns its paths (for example SL-06 owns `apps/mobile/modules/hermit-notifications/` and the capture skill). A shared file takes a minimal additive change.
- **Migrations.** Each slice has a pre-assigned numbered migration file; two slices touching the same table never run together.
- **One coordinator runs the heavy work.** Android builds, installs on the phone and the full suite run once, by the coordinator, one at a time; agents run typecheck, lint and their package tests.
- **One phone.** On-device checks are serialized; the gate journey runs once per wave.

## 3.7 The integration loop by tier

1. The agent opens atomic PRs into `Dev`, named for the slice.
2. CI by tier: every PR runs typecheck, lint, unit tests, the privacy gate and the fake-model eval; T1 PRs add cage isolation and adapter contract tests.
3. Review by tier: T1 gets an independent review (a second agent, plus the product owner) for correctness and security; T2 merges on green CI plus the slice checklist.
4. Findings are fact-checked and each gets a recorded decision: fix now, move to the wave list, or decline with a reason. At most two review rounds per PR.
5. The slice's state follows its merged PRs. Commits carry no AI co-author or "Generated with" trailers, and each pull request says whether an agent helped (the pull request template asks).

## 3.8 Linear as the source of truth

- **Project:** one, Hermit.
- **Milestones:** W0 to W6, then V2 and V3. Capability gates, never dates.
- **Issues:** the W0 list and the current wave's slices, each with its slice ID, wave, tier, outcome, IDs, owned paths, migration slot and gate step.
- **Future waves:** one placeholder per wave listing its slice IDs.
- **The wave list:** one issue per wave for findings.
- **Labels:** area, wave, tier and type. Status follows PRs.
- Seeding happens only on the product owner's explicit request, after a dry-run plan.

## 3.9 Definition of Done by tier

- **Every slice:** acceptance criteria met; screens render their states; local events use the shared envelope; copy externalized in es-419 and English; IDs threaded through branch, commits and PR; its step added to the wave's journey script and passing on the S26 Ultra; CI green.
- **T1 also:** the hard limits asserted with the rules removed (cage isolation), secrets proven absent from prompts and log entries, adapter contract tests green, and the independent review resolved.

## 3.10 One slice end to end

1. SL-07 exists in Linear under W1, tier T1, outcome "an exact reply is approved with a fingerprint and sent", IDs US-MSG-02, US-MSG-03, US-APPR-01 to US-APPR-04, US-CAGE-01, owned paths `apps/mobile/src/components/ApprovalSheet.tsx` and the reply native bridge, migration slot for `approvals`, gate step "tell her I'm 10 minutes late".
2. The coordinator extracts its packet (the stories, FR-MSG-03, FR-MSG-04, FR-CAGE-01 to FR-CAGE-04, CT-06, CT-07, HM-APPR-01, ENT-ApprovalRequest, ADR-005, PDR-002) and hands it to an agent with the W1 brief.
3. The agent opens a worktree on `feat/SL-07-approved-reply`. Sub-agents build the Keystore-backed approver adapter, HM-APPR-01 with its states, and the reply bridge, each with its part of the packet.
4. Atomic commits reference the IDs; the PR opens into `Dev`; CI runs the T1 set.
5. A second agent reviews; findings are fact-checked and decided.
6. The PR merges; the coordinator installs the build on the S26 Ultra; the reply step passes in the W1 journey; EVT-APPR-01 and EVT-APPR-02 appear in the local log and the step in the verified chain; the issue closes from the merge.

This loop, repeated wave by wave, takes Hermit from its first win to the complete V1 that the map describes.

*End of PRD. This document defines V1, its first win and its waves, and sequences later versions with no timelines or estimates by design. Every requirement is ID-stable so it can seed Linear, the schema, the screens, and the agent work described in Part 3.*
