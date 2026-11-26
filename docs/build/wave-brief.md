# Wave brief: W1, the first win

| Field | Value |
| :---- | :---- |
| Wave | W1 |
| PRD | docs/prd/hermit-prd.md (v1.3) |
| Written | at the W0 gate, from the repository |

## Scope

The tester, on the reference Galaxy S26 Ultra, sets Hermit up, then in airplane mode remembers a fact, sets a reminder and reads their calendar; with the radio on they ask whether Ana texted, approve the exact WhatsApp reply with their fingerprint, and see every step in the verified activity log (PRD 2.6).

NOs for W1, even though the PRD describes them: voice notes, email, connectors, the eval on device, stop button, web reading, web tasks, night shift, intents, settings screens, memory browsing, vault, forms, wallet, moving phones, Play, the website, dark mode polish. Do not add seams for them beyond what the contracts already reserve.

## Stack and gotchas

- Expo SDK 58, React Native 0.88.1 (New Architecture), Expo Router with routes in `apps/mobile/src/app`. A dev client, never Expo Go: W1 needs native modules.
- TypeScript 6.0.3 (typescript-eslint does not support 7). Node 24 with `--experimental-strip-types`: no constructor parameter properties, no enums in files Node runs directly.
- pnpm 10 workspace. Pure packages (`packages/*`) never import React Native (NFR-12); phone code implements their ports.
- QVAC `@qvac/sdk` 0.23 pinned with `react-native-bare-kit` 0.16; the model runs in the bare worklet, never on the UI thread. The first model profile is BotPsy-0.8B Q4_K_M (`docs/research/botpsy.md`): thinking mode on by default in its template, so measure with a capped budget.
- op-sqlite with SQLCipher and FTS5 replaces `nodeSql` on the phone behind the same `SqlPort`.
- `Risk` now has seven values; every skill needs one or it does not compile.

## Roles

One human role, the phone's owner. Authority is sessions and risks, decided by `decide` in `packages/cage/src/policy.ts` (PRD 2.5). Attended or unattended, tainted or not.

## Already built

- Contracts and ports: `packages/core/src/types.ts`, `packages/core/src/ports.ts`, `packages/core/src/money.ts`, `packages/core/src/events.ts`, `packages/core/src/errors.ts`.
- Schema with one slot per W1 slice: `packages/core/src/schema.ts` (`migrate`, `MIGRATIONS`). Never edit another slice's migration; add a new id at the end if you must.
- Loop: `packages/agent/src/loop.ts` (`runTurn`); untrusted wrapping: `packages/agent/src/untrusted.ts`; memory skills: `packages/agent/src/memory-skills.ts`.
- Cage: `packages/cage/src/policy.ts`, signed log `packages/cage/src/audit-log.ts`, approval proof `packages/cage/src/approval-proof.ts`.
- Skills: `packages/skills/src/catalog.ts` (8 first-win skills).
- Copy: `packages/copy/locales/en.json`, `packages/copy/locales/es-419.json`, translator in `packages/copy/src/index.ts`.
- Eval: `packages/eval/src/cli.ts`, cases in `packages/eval/cases/first-win.jsonl`.
- App shell, theme and signature: `apps/mobile/src/theme.ts`, `apps/mobile/src/signature.ts`, `apps/mobile/src/app/about.tsx`. Brand assets: `docs/brand/tokens.json`, mascot rig in `docs/brand/mascot/` (never redraw it).
- Inventory: `docs/build/w0-inventory.md`.

## Conventions

- Phone adapters live in `apps/mobile/src/adapters/` (one file per port) and native modules in `apps/mobile/modules/`. Screens in `apps/mobile/src/app/` carry their screen ID in a comment on the first line.
- Every skill call goes through `runTurn` and `decide`; nothing calls a skill directly. Approval sheets render `describeAction` output only (CT-06).
- All copy through the translator with keys `HM-XXX-NN.element`; add a key to both locale files in the same change.
- User-facing failures map to an `Outcome` (CT-04). No stack traces, hashes or raw model text on screen.
- Events go through `createEventLog` with codes, never content.
- Each slice owns its paths (slice table below). A shared file takes a minimal, additive change, reported back.
- Commits carry no AI co-author or "Generated with" trailers, and the pull request says whether an agent helped.

## Commands

- Agents may run, per package: `pnpm --filter <pkg> test`, `pnpm --filter <pkg> typecheck`, `pnpm lint`, `pnpm check:privacy`.
- Only the maintainers run: Android builds and installs, the full `pnpm test`, the full `pnpm typecheck`, and anything on the phone. They run one at a time, after `df -h /` shows at least 10 GB free.
- Agent count for W1: up to 3 in parallel for pure-package work (T2 and the package side of T1 slices); one at a time for anything touching the phone, since there is one device.

## Environments

The only environment is the dev build on the S26 Ultra plus Node for the eval. There is no server and no staging database. Never point anything at a production account other than the tester's own WhatsApp and calendar during the gate.

## Test data

Unit and package tests use `nodeSql()` in memory and synthetic text. No real names, phone numbers or messages in tests or fixtures. The gate uses one test WhatsApp contact (DEP-03).

## This wave

| Slice | Outcome | Owns | Migration slot |
| :---- | :---- | :---- | :---- |
| SL-09 | Spike S1: QVAC runs BotPsy-0.8B on the S26 GPU; memory and speed measured | `apps/mobile/src/adapters/qvac-model.ts` | none |
| SL-10 | Spike S2: op-sqlite with SQLCipher and FTS5 | `apps/mobile/src/adapters/op-sqlite.ts` | none |
| SL-11 | Spike S3: worklet bundle and model loader in the Expo build | `apps/mobile/worklet/` | none |
| SL-12 | Spike S4: the listener fires a WhatsApp reply action | `apps/mobile/modules/notifications/` | none |
| SL-01 | Welcome, verified model download, permissions | `apps/mobile/src/app/onboarding/` | 7 |
| SL-02 | Chat on the phone's model, streaming, "On this phone" | `apps/mobile/src/app/index.tsx`, `apps/mobile/src/app/where.tsx` | 5 |
| SL-03 | Clarifying questions and failed turns render | chat outcome components | none |
| SL-04 | Memory on the encrypted database with provenance | memory wiring in the app | 1 |
| SL-05 | Reminders offline, calendar read and add | `apps/mobile/src/adapters/reminders.ts`, `apps/mobile/src/adapters/calendar.ts` | 3 |
| SL-06 | Messages captured, queued, read as untrusted | `apps/mobile/modules/notifications/` (after SL-12) | 4 |
| SL-07 | Approved reply with fingerprint, blocked or stale | `apps/mobile/src/app/approval/`, `apps/mobile/src/adapters/approver.ts` | 6 |
| SL-08 | Activity log and chain verification | `apps/mobile/src/app/activity/` | 2 |

Spikes first: SL-09 and SL-10 unblock everything; SL-12 unblocks SL-06 and SL-07.

## Changed since last wave

- `Risk` gained `network` and `remote_write`; `defaultRules` asks for both, and `remote_write` can never resolve to allow.
- New contracts: money, local events, outcomes, copy. New package `packages/copy`.
- One schema with numbered migrations replaces ad hoc table creation for the app.
- PRD v1.3: BotPsy-0.8B is the first model profile; FR-MODEL-05 evaluates thinking mode and decoding format together.

## Report back

Every agent returns: files changed, decisions taken and why, anything another slice must know (a renamed export, a new copy key, a port change), measurements for spikes (load time, memory, first-action time, tokens per second), and questions added to the W1 list.

## When the map is silent

Stop. Add the question to the W1 list in `docs/build/open-questions.md`, then take another W1 slice. Never invent behavior. A slice blocked by an open question moves to a later wave.
