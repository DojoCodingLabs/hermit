# Hermit: architecture and first-win design

- **Date:** 2026-11-08
- **Status:** draft for the product owner's approval (Q1-Q8 answered)
- **Evidence:** `docs/research/` (seven reports, including Atomic Agent and mascots, plus the five original ones from reading the actual QVAC, WDK, PearPass/Autopass/Holepunch, Hermes Agent and OpenClaw code, plus the Android/Expo platform). Decisions logged in `docs/build/open-questions.md`.

---

## 1. Intent

Hermit is a personal agent that does what Meta Muse, Instinct, Grok Bot and OpenAI Dots do, but with the model running on the user's own phone through Tether QVAC. It works in airplane mode. Tools touch the internet only when a task needs it, and the local model picks every one of them.

Tagline: **"Does everything. Tells no one."** Proof line: **"Don't trust us, read the code."** (Apache 2.0.)

**Why this shape:** the cloud agents' real moat is safety plumbing, not the model. That plumbing is a policy guard, stand-in credentials, approvals and an audit trail, and all of it ports to a phone. A 2-4B model can't drive a whole computer, but it can reliably **pick from a menu of typed skills and fill their arguments**. That is the core design bet.

**First market:** Android, WhatsApp-centric, Spanish (es-LATAM) first, English second.

## 2. Goals, non-goals, anti-goals

**Goals of the first win** (decided in Q2):
1. **Talk:** text chat with the local model, fully offline, Spanish and English.
2. **Remember:** save, recall and forget personal facts on command.
3. **Remind:** reminders and calendar read/write, offline.
4. **Reply:** read incoming WhatsApp notifications and reply in the chat, with the exact text and recipient approved by fingerprint.
5. **The cage**, end to end: a policy gate on every skill call, approvals bound to exact arguments, a signed hash-chained audit log, and session taint.

**Non-goals for the first win** (they move to later waves): voice, web reading and form fill, the wallet and payments, the vault for logins and cards, the night shift, Boost, iOS, fine-tuned Hermit models, agent-to-agent, and calls.

**Anti-goals** (failure even if it works):
- Any network call the user didn't cause, or any analytics or crash-reporting SDK. "Tells no one" must be literally true.
- A tool call that reaches the world without passing the cage.
- The model ever seeing a secret.
- Auto-sending WhatsApp messages without a human approval. This is a WhatsApp ToS risk and a Play policy risk.
- Use of Android's AccessibilityService for agent actions. Play bans it for autonomous agents.
- A generic shell, file or browser tool ("a computer"). The model only gets the menu.

## 3. Constraints (verified in research)

| Area | Constraint | Source |
|---|---|---|
| QVAC | `@qvac/sdk` 0.23.0, Apache 2.0. A breaking minor ships every ~2 weeks, so we pin exactly. Inference runs in a react-native-bare-kit worklet. Tool calls come back **unexecuted**. Grammar-constrained tool calls and `json_schema` output are supported. Physical devices only. | `research/qvac.md` §2 |
| bare-kit | Pin `react-native-bare-kit@~0.16.0`. 0.17 changed native packaging, and QVAC's addon linking likely breaks on it. | `research/qvac.md` 2d |
| Expo | SDK 58 / RN 0.88 is current. QVAC CI is tested on SDK 54, and one user reports it working on 57. The New Architecture is mandatory. Expo Go is not usable, so we use a dev client with prebuild. | `research/platform.md` §1, `qvac.md` 11a |
| Device | Galaxy S26 Ultra (Snapdragon/Adreno): QVAC's best path is OpenCL. Pixel phones are forced to CPU at about 1 tok/s. | Q1, `qvac.md` 8b |
| Wallet | WDK is blocked: it is stuck on bare-kit 0.14.5, and QVAC's linker deletes the addons other packages link. | `research/wdk.md` |
| PearPass | Paused since 2026-08-14. We use none of its code. | `research/vault-p2p.md` |
| WhatsApp | No library exists, so we write our own Kotlin module (NotificationListener + RemoteInput). A reply only works while the notification is live. Sideloaded builds need "Allow restricted settings". Android 15+ hides OTPs. | `research/platform.md` §2 |
| Prefill | ~150 tok/s on flagship phones, so the fixed prompt must stay ≤1.5K tokens and be KV-cached. Hermes Agent and OpenClaw prompts run 10-25K tokens, which is unusable. | `research/agents.md` |
| Dev Mac | M5 with 16 GB and **~18 GB free disk**: Android command-line tools only (no Android Studio), arm64-only builds, and Gradle `-Xmx4g`. | Q4 |

## 4. Architecture

### 4.1 Shape: ports and adapters, pure-TS core

The brain and the cage are **plain TypeScript with no React Native imports**. The same code runs:
- on the phone, behind mobile adapters (QVAC Expo worklet, op-sqlite, secure-store, Kotlin modules);
- on the Mac, behind Node adapters (QVAC Node SDK, `node:sqlite`, a scripted approver), for tests and the Spanish eval.

That lets us find out whether a model can do the job **before** building UI around it. It also makes the cage unit-testable, and the future Boost desktop app reuses it.

```
┌──────────────────────── apps/mobile (Expo SDK 58, Android) ─────────────────────────┐
│ UI: chat · approval sheet · memory · audit log · permissions    (Expo Router, es/en)│
│ Adapters: QvacModel · OpSqliteStore · SecureStoreKeys · BiometricApprover           │
│           Notifications(Kotlin) · Calendar/Reminders(expo-calendar, -notifications) │
└───────────────▲─────────────────────────────────────────────────────────────────────┘
                │ implements ports
┌───────────────┴──────────── packages (pure TS, vitest) ──────────────────────────────┐
│ @hermit/core   agent loop (pick → fill → repair → cage → execute), ports, memory    │
│ @hermit/cage   Sentinel policy · approvals (argsHash-bound) · taint · audit chain   │
│ @hermit/skills typed skill catalog: chat, remember, recall, forget, remind,         │
│                calendar_read, calendar_add, read_messages, reply_message            │
│ @hermit/eval   Node harness: es/en test set, runs the same loop on QVAC desktop     │
└──────────────────────────────────────────────────────────────────────────────────────┘
```

### 4.2 The agent loop (`@hermit/core`)

Modeled on OpenClaw's loop shape and Hermes Agent's repair chain. It is written fresh at about 1-2K lines; we vendor neither project.

1. **Context:**
   - a static prefix (persona ≤300 tokens, plus a menu line of ≤60 characters per skill), KV-cached through QVAC `cacheKey`;
   - a frozen memory snapshot (≤600 tokens);
   - the rolling history.
2. **Pick:** a constrained choice over an enum `{skill ids…, respond, ask_user}`.
3. **Fill:** only the picked skill's JSON Schema (`additionalProperties:false`) is used, as a `json_schema` response format.
4. **Repair:** deterministic, ported from Hermes Agent's algorithms:
   - fuzzy-match skill names;
   - repair JSON and coerce types;
   - three strikes end the turn.
5. **Canonicalize** the arguments, then compute `argsHash = sha256(canonical JSON)`.
6. **Cage:** `cage.decide(call, session)` returns allow, deny or ask (§4.3). Deny returns a readable error to the model.
7. **Approve** (if the decision is ask):
   - The approval sheet is rendered by the skill's pure `describeAction()`, never by the LLM.
   - A biometric is required by policy, and the approval binds to `argsHash`.
   - Timeout counts as deny.
8. **Execute** through the platform port. Untrusted output (incoming message bodies) **taints the session** and is wrapped in random-id untrusted-content markers.
9. **Audit:** every step appends a metadata-only entry.
10. **Limits:** at most 4 skill calls per user turn. Streaming applies to `respond`.

**Why two-stage decoding:** the prompt never carries 9-40 full schemas. Each step's schema is ~150 tokens, so prefill stays at about 1.5-2.5K new tokens, roughly 10-17 s at 150 tok/s.

**Per-step grammar (borrowed from Atomic Agent, verified in `docs/research/atomic-agent.md`):** each step's grammar lists only the skills allowed *at that moment* (for example, after taint, `reply_message` is removed from the pick enum). The cached prompt prefix stays untouched, so restricting the menu costs no extra prefill. Atomic Agent enforces required fields on only 16 of its tools. Hermit's menu is small and closed, so every skill is fully typed.

QVAC is called with `tools` only if two-stage decoding proves worse in the eval. Either way we **never pass `handler`**, so the SDK's `invoke()` cannot bypass the cage.

### 4.3 The cage (`@hermit/cage`)

- **Sentinel policy:** declarative rules `{skill, when(call, session), effect, grantable, requireBiometric}`.
  - Floor rules are evaluated first, and **deny wins**.
  - Each skill declares a risk: `read | local_write | send | spend | credential`.
  - First-win defaults:
    - `read` and `local_write`: allow, logged.
    - `send`: always ask, with biometric.
    - A tainted session escalates `send` to ask with a warning ("suggested after reading a message from X").
    - Unattended (no human present): every ask becomes deny.
  - There is no "always allow" for send or spend. There is no yolo mode.
- **Threat model for the first win (Q6):** prompt injection through incoming messages, and model mistakes. A malicious dependency or a compromised JS runtime is **out of scope until Wave 3**. Before the wallet or vault ships, approvals move to a non-exportable Android Keystore signing key in a Kotlin module, so JS can't forge them.
- **Approvals:** `ApprovalRequest` carries the exact rendered action, the `argsHash` and an expiry.
  - The biometric is **cryptographic, not just a prompt**. An `approval key` sits in expo-secure-store with `requireAuthentication: true` (Android Keystore, auth per use).
  - Reading the key requires BiometricPrompt. The approval proof is `HMAC(approvalKey, argsHash ‖ requestId)`, stored in the audit entry.
  - `expo-local-authentication` alone is never the gate.
- **Taint:** sticky for the session until the user clears it, stricter than OpenClaw's per-turn taint. Memory writes made in a tainted session are marked tainted.
- **Audit log:**
  - An append-only SQLite table: `seq, ts, sessionId, event, skill, argsHash, decision, outcome, prevHash, hash, sig`. The hash covers a fixed tuple with null for empty fields, so an entry verifies the same after a SQLite round trip.
  - Signed with Ed25519 (`@noble/curves`) from a device seed in secure-store, without biometric so background appends work.
  - **No message bodies and no arguments**, only hashes.
  - A `verifyChain()` function, plus a UI screen that shows "chain verified".
  - The UI says "tamper-evident", never "immutable": a single device can rewrite its own log until checkpoints leave the device (Boost era).

### 4.4 Storage and memory

- **op-sqlite 19** with `sqlcipher + fts5 + sqliteVec`. The flags must live in `apps/mobile/package.json`.
  - The DB key is 32 random bytes in secure-store, with no biometric.
  - At startup, assert that `PRAGMA cipher_version` returns a row; a SQLCipher build that is silently off would be a privacy bug.
  - Fallback: expo-sqlite with `useSQLCipher` + `withSQLiteVecExtension`.
- The core talks to storage through a small `SqlPort` (`exec`, `query`, `transaction`), so the same SQL and migrations run on `node:sqlite` in tests and the eval.
- **Memory:**
  - A capped profile (≤1,400 characters) loaded once per session as a frozen snapshot, which keeps the KV cache valid.
  - Notes stored in SQLite with FTS5 (`unicode61 remove_diacritics 2` for Spanish).
  - `remember`, `recall` and `forget` skills. An overflowing write is rejected with the current entries, so the model consolidates (Hermes Agent pattern).
  - Vectors with EmbeddingGemma come later. The sqlite-vec table is created now so the schema doesn't churn.

### 4.5 Model runtime

- QVAC `@qvac/sdk@0.23.x` pinned exactly, with `react-native-bare-kit@~0.16.0` and the Expo plugin with `installMissingPrebuilds:false`.
- A minimal `qvac.config.json`:
  - plugins: `llamacpp-completion` only for the first win;
  - `cacheDirectory` outside backed-up folders;
  - `requireSecureTransport: true` and `requireHttpChecksum: true`.
- **Model candidates** for the S26 Ultra, chosen by the eval and not by assumption:
  - Qwen3.5-4B Q4_K_M (2.7 GB), the starting default;
  - Granite 4.2 3B;
  - Qwen3.5-2B (1.3 GB);
  - Gemma 4 E2B.
- **Delivery:** for the private alpha, Hugging Face HTTPS URLs with pinned sha256, downloaded once on Wi-Fi with progress. Not QVAC's P2P registry, because DHT peers would see the IP and the model. The public-build policy is still an open question in the log.
- **Lifecycle:** `suspend()` on background and `resume()` on foreground. One LLM is loaded at a time.

### 4.6 Platform skills (Android, first win)

| Skill | Risk | Implementation |
|---|---|---|
| `remember`, `recall`, `forget` | local_write / read | `@hermit/core` memory over SqlPort |
| `remind` | local_write | `expo-notifications` local scheduled notification. Works offline. |
| `calendar_read`, `calendar_add` | read / local_write | `expo-calendar`, writing to the **user's own default calendar** (Q7). Whatever sync that calendar has is the user's; the privacy copy says so plainly. |
| `read_messages` | read, **untrusted output** | `modules/hermit-notifications` (Kotlin, about 300 lines): a NotificationListenerService for the WhatsApp and WhatsApp Business packages, MessagingStyle extraction, an in-memory reply-action LRU, and a native queue so nothing is lost while JS is down. |
| `reply_message` | **send** | The same module: RemoteInput reply through the live notification's action, returning `stale` when the notification is gone. |

The `respond` and `ask_user` pseudo-skills are part of the loop, not the catalog.

### 4.7 App UX (conversation first, GUI as fallback)

- **Screens:**
  - Chat (default)
  - Approval sheet: modal, showing the exact action, recipient and text, plus the fingerprint prompt
  - Memory list: view and forget
  - Activity: the audit log with chain verification
  - Setup: model download, notification access with the "Allow restricted settings" walkthrough, calendar permission
  - Status chip: "Thinking on this phone" / "Airplane mode: on-device"
- Spanish (es-419) by default and English, through a small i18n layer. Brand copy comes from the brainstorm. Never use "concha" for shell.
- Visual design is not decided here. A design pass comes in Wave 1, using the impeccable/frontend-design skills.

### 4.8 Privacy enforcement (mechanical, not just policy)

- **Dependency denylist check in CI:** fails the build on Sentry, PostHog, Firebase Analytics/Crashlytics, Segment, Amplitude, Bugsnag, Datadog and Google Sign-In.
- **No `fetch`, `XMLHttpRequest` or `WebSocket` in packages:** enforced with an ESLint `no-restricted-globals` rule. The only network code is the model-download adapter.
- **Android manifest audit:** a config plugin removes `INTERNET`-adjacent extras we don't use. `allowBackup=false`, so app data never goes to Google Drive backup.
- The README states exactly what leaves the phone. In the first win, that is the model download and nothing else. Two honest exceptions are stated in setup and the README: a WhatsApp reply is sent by WhatsApp itself, and calendar events sync wherever the user's calendar already syncs. Hermit itself sends nothing.

### 4.9 Repo layout and tooling

```
hermit/
  apps/mobile/            Expo SDK 58 app (dev client, CNG; android/ and ios/ gitignored)
    modules/hermit-notifications/   local Expo Module (Kotlin)
  packages/core/          agent loop, ports, memory, i18n strings for the model
  packages/cage/          policy, approvals, taint, audit chain
  packages/skills/        skill definitions (schemas, risk, describeAction, menu lines)
  packages/eval/          Node harness + es/en test cases (JSONL) + QVAC desktop adapter
  docs/research/ docs/build/ docs/superpowers/
  AGENTS.md (+ CLAUDE.md pointer)   rules for coding agents
  LICENSE (Apache-2.0) NOTICE THIRD_PARTY_NOTICES.md
```

- **Workspaces:** pnpm, isolated linker by default, with `nodeLinker: hoisted` as the documented fallback if QVAC bundling breaks.
  - React and React Native are pinned through overrides.
  - No Turborepo yet.
- **TypeScript:** strict, shared `tsconfig.base.json`, ESM.
- **Tests:** vitest for the packages, with TDD on the cage; jest-expo for the app later.
- **CI:** GitHub Actions on the repo (private then, public since Q210): install, typecheck, lint, test, denylist check. No native builds in CI yet.
- **Rules for coding agents** (`AGENTS.md`):
  - Every skill call goes through the cage.
  - No network outside adapters.
  - No telemetry.
  - Pin QVAC and bare-kit.
  - Commits carry no AI co-author or "Generated with" trailers, and the pull request says whether an agent helped.

## 5. Delivery: waves

**Audience (Q8):** only the S26 Ultra until the demo works. There are no weak-phone fallbacks, no second model tier, no device-capability check and no distribution channel in Waves 0-1.

**Wave 0: scaffold and de-risk.** This is the next step after this doc is approved. Each spike has a pass/fail gate.
- Monorepo, packages with their ports and types, CI, license files, AGENTS.md.
- Toolchain: JDK 17 and the Android command-line tools (approved in Q4).
- **S1:** a bare Expo SDK 58 dev build with QVAC 0.23 + bare-kit 0.16 loads Qwen3.5-2B on the S26 Ultra and streams tokens. **If it fails:** SDK 57, then 54. Record the tok/s.
- **S2:** op-sqlite with SQLCipher + FTS5 + sqlite-vec opens on the device. `cipher_version`, MATCH and vec0 KNN all work.
- **S3:** QVAC worklet bundling works under pnpm isolated linking. If not, switch to hoisted.
- **S4:** the eval harness runs one es/en case through `@hermit/core` on the Mac with QVAC desktop.

**Wave 1: the first win.**
1. The cage, test-first.
2. Memory.
3. The loop with two-stage decoding.
4. The skills (§4.6) and the Kotlin notification module.
5. The UI (§4.7).
6. An eval set of about 60 es/en cases across the 9 skills, including injection cases in incoming WhatsApp text.
7. A model choice by eval score and latency.

**Exit gate (Q5),** on the S26 Ultra over the es/en eval:
- **≤15 s** from sending a message to the first action: the approval sheet, or the executed result for allow-skills.
- **≥85%** correct skill plus arguments.

If no candidate passes, try these in order:
1. Merge pick and fill into one call with a discriminated-union schema. With 9 skills it stays small.
2. Shrink the persona, menu and memory snapshot.
3. Pull the fine-tuned Hermit adapter forward from Wave 4. It needs a Q8_0 base.

**Demo script** (on the S26 Ultra, airplane mode except the WhatsApp reply):
1. "Recuérdame llamar a mamá a las 9"
2. "Recuerda que mi pasaporte vence en marzo"
3. "¿Cuándo vence mi pasaporte?"
4. "¿Qué tengo mañana?"
5. A WhatsApp message arrives from Ana; "Dile que llego en 10 minutos" brings up the approval sheet, then the fingerprint, then the reply is sent.
6. The Activity screen shows a verified chain.

**Later waves, in order:**
- **Wave 2: Ears and eyes.** Voice (native PCM capture, Whisper + Silero VAD, Supertonic es), web reading (fetch + Readability, WebView fallback) with a quarantined reader, and the night shift (a custom WorkManager module).
- **Wave 3: Hands.** The vault (handles, exact-origin binding, Hermes Agent semantics), WebView form fill, and the wallet (WDK, once its bare-kit migration lands) with x402.
- **Wave 4: Bigger shell.** Boost over HyperDHT + secret-stream as a QVAC plugin, with a LAN-direct path; fine-tuned Hermit-2B/4B adapters; iOS.

## 6. Decisions (Q1-Q8, 2026-11-08)

- Dev device: Galaxy S26 Ultra.
- First win: talk, remember, remind and reply through the cage. No wallet.
- Apache 2.0 in the repo now. The repo stays private until the alpha works and the name is cleared (superseded: the repository went public as open source, Q210 to Q213).
- Install the Android toolchain on the build machine. Done: JDK 17 and the Android command-line tools.
- Speed bar: ≤15 s to first action, ≥85% correct (Q5).
- Threat model: injection and mistakes now, a hardware approval key at the wallet wave (Q6).
- Calendar: the user's own, with an honest exception (Q7).
- Alpha: only the S26 Ultra (Q8).
- Commits carry no AI co-author or "Generated with" trailers, and the pull request says whether an agent helped.

## 7. Calls made in this spec (for review)

1. **Clean Expo app instead of forking the WDK starter.** About 60% of the starter is wallet UI. It is pinned to bare-kit 0.14.5, which blocks QVAC, and its master branch currently mixes Expo 58 and 55.
2. **Expo SDK 58 first, gated by spike S1,** with fallback to 57 and then 54. Starting old means a forced upgrade within months.
3. **A pure-TS core plus a Mac eval harness.** The model gets tested in Spanish before UI is built around it.
4. **Two-stage decoding (pick, then fill) instead of handing the model all tool schemas.**
5. **Vault and audit log on platform primitives** (Keystore through expo-secure-store, SQLCipher, Ed25519 hash chain), not Autopass, PearPass or Hypercore.
6. **Hugging Face HTTPS with pinned sha256 for model download in the private alpha,** instead of QVAC's P2P registry.
7. **pnpm and no Turborepo; vitest; GitHub Actions with no native builds yet.**
8. **Android command-line tools instead of Android Studio,** to save disk space.
9. **Text-only first win.** Voice moves to Wave 2: QVAC's voice example is desktop-only and needs a native audio-capture module.

## 8. Left to the builder

File-level structure inside each package, exact SQL schema, i18n library choice, UI component library, the exact eval scoring script, and the Kotlin module's internals within the §4.6 contract.

## 8b. Competitive note (2026-11-09)

Atomic Agent (Atomic Wallet group, MIT runtime, desktop app source not public) is the closest open-source rival. It ships PostHog analytics and Sentry **on by default** with hardcoded keys, and an optional hosted login broker (Composio). The same company already ships Atomic Chat on iOS and Android, so a phone agent is a short step for them. Hermit leads with the cage, typed phone skills and literally zero telemetry, not with "local agent". Don't fork Atomic for Boost: it's about 316K lines of TypeScript. Port its grammar builder, scheduler and memory caps instead, with MIT credit.

## 9. Still open (logged, not blocking Wave 0)

- Model-download policy for the public build. Does "Tells no one" cover the first download?
- Trademark clearance for "Hermit" before going public.
