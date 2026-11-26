# Wave brief: W2

| Field | Value |
| :---- | :---- |
| Wave | W2 (voice, email and connectors, the model proven on device, turn control, de-risking spikes) |
| PRD | docs/prd/hermit-prd.md, slice map Part 3.4 |
| Written | 2026-11-14, while the W1 gate waits for one phone session (W1 is code-complete) |
| Scope decision | Q40: full V1 scope, nothing cut; Q41: parallel local agents on the build machine |

## Scope

The 15 W2 slices: SL-13 to SL-21, SL-47 to SL-50, SL-52 and SL-59. Find your slice in `docs/prd/hermit-prd.md` by its SL id, then read its stories and every ID they cite.

Build exactly what those say. Neighbouring IDs are out of scope unless your slice lists them.

## Stack and gotchas (in addition to `docs/build/wave-brief.md`, still valid)

- Read `AGENTS.md` first: the cage, no network in `packages/*` (network lives in `apps/mobile` adapters or `packages/eval` dev tools), privacy check, failing test first, no AI co-author or "Generated with" trailers in commits.
- The harness is model-first: code helps the model (routing, normalizers, guards, templates for listing results); it never replaces the model's decisions.
- Copy: every user-facing string is a key in both `packages/copy/locales/en.json` and `es-419.json` (neutral Latin American Spanish, no voseo in copy).
- UI states: follow `docs/prd/hermit-ui-states-and-edge-cases.md` (ST-* and EC-*); add rows for your screens in the same PR.
- House style in docs, comments and copy: no em or en dashes.
- Run heavy commands one at a time, and never start a second llama-server.

## Commands an agent may run

- In its worktree first: `pnpm install --offline --frozen-lockfile` (hardlinks from the local store, light).
- Per package, directly (light): `pnpm --filter <pkg> test`, `pnpm --filter <pkg> typecheck`.
- Heavy, one at a time: the full `pnpm lint`, `pnpm check:privacy`, and model evals.
- The Mac eval lab (llama-server on :8090, already running) through `scripts/eval/mac-run.sh`, one run at a time. It runs at low priority, behind the optional `HERMIT_HEAVY` command prefix (for example, a lock that runs one heavy job at a time).
- Never: Android builds, installs, adb, Metro, or anything on the phone. The maintainers run those.

## PR flow

One branch and one PR per slice, named `w2/sl-NN-<short>`. The PR body states the slice, what was built, the tests, what remains for the phone check, and anything another slice must know. Do not merge: a maintainer merges after CI is green.

## This wave, batch 1 (parallel)

| Slice | Outcome | Owns |
| :---- | :---- | :---- |
| SL-15 | Stop a turn; summarize unread chats through the quarantined reader | `packages/agent/src/loop.ts` (stop), `packages/runtime`, chat stop control in `apps/mobile/src/app/index.tsx` |
| SL-16 | A failed download explains itself and retries cleanly | `apps/mobile/src/app/download.tsx`, the download adapter |
| SL-47 | Connector runtime, credential store, catalog, sign-in options | new `packages/connectors`, credential port in `packages/core/src/ports.ts` (additive) |
| SL-18 | Spike: an x402 testnet purchase from the payments package | new `packages/payments` (pure) plus a dev-tool script under `packages/eval` for the testnet call |
| SL-50 | Spike: the phone model completes a known web task from the accessibility tree | `packages/eval` (fixtures and a runner on the Mac lab), a findings note in `docs/research/` |

Later batches: SL-48, SL-49, SL-52 (after SL-47); SL-14 and SL-59 (model on device, needs phone sessions); SL-13, SL-17, SL-19, SL-20 (phone-bound, one at a time); SL-21 (needs Dojo's Play Console account).

## Report back

Files changed, decisions taken, anything another slice must know, and open questions. When the map is silent, stop and report the question instead of inventing behavior.
