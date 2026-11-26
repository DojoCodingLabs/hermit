# W0 inventory: what exists, what W1 reuses

Written at W0 (2026-11-11) from the repository, per PRD Part 3.2 item 6. Brownfield: PRs 1 to 3 built the agent core before the PRD existed.

## Reused by W1 as is

| Area | Path | What W1 uses |
| :---- | :---- | :---- |
| Types and ports (CT-05, CT-11) | `packages/core/src/types.ts`, `packages/core/src/ports.ts` | `SkillDef`, `Risk` (now 7 risks), `ModelPort`, `SqlPort`, `SignerPort`, `ApprovalPort` |
| Canonical JSON and args hash | `packages/core/src/canonical.ts` | `argsHash` for approvals (FR-CAGE-03) |
| Repair (FR-LOOP-03) | `packages/core/src/repair.ts` | deterministic repair, hostile keys dropped |
| Memory (FR-MEM-01 to 06) | `packages/core/src/memory.ts` | `createMemory`; its `migrate()` stays for tests, the app uses `migrate()` from the schema |
| Cage (FR-CAGE-01, 02) | `packages/cage/src/policy.ts` | `decide`, `defaultRules` (network and remote_write added in W0) |
| Signed log (FR-ACT-01 to 03) | `packages/cage/src/audit.ts`, `packages/cage/src/audit-log.ts` | `createAuditLog`, `verifyChain`, `ed25519Signer` |
| Approval proof (FR-CAGE-03) | `packages/cage/src/approval-proof.ts` | HMAC proof over hash and request id |
| Loop (FR-LOOP-01 to 06) | `packages/agent/src/loop.ts` | `runTurn` |
| Untrusted text (CT-09) | `packages/agent/src/untrusted.ts` | `wrapUntrusted` |
| First-win skills | `packages/skills/src/catalog.ts` | 8 skills: remember, recall, forget, remind, calendar_read, calendar_add, read_messages, reply_message |
| Eval (FR-MODEL-04) | `packages/eval/src`, `packages/eval/cases/first-win.jsonl` | `runEval`, `FakeModel`, the CLI |
| Node SQLite for tests | `packages/sql-node/src/index.ts` | `nodeSql` |
| App shell and brand | `apps/mobile/src/theme.ts`, `apps/mobile/src/signature.ts`, `apps/mobile/src/app/about.tsx` | tokens, signature, About (US-SET-10, W3) |
| Privacy gate (FR-PRIV-01) | `scripts/check-privacy.mjs`, `eslint.config.js` | deny list, aliases, lockfile scan, no-network rule |

## Added in W0

| Contract | Path |
| :---- | :---- |
| CT-01 Money | `packages/core/src/money.ts` |
| CT-03 Local events | `packages/core/src/events.ts` |
| CT-04 Outcomes | `packages/core/src/errors.ts` |
| CT-05 risks `network` and `remote_write` | `packages/core/src/types.ts`, `packages/cage/src/policy.ts` |
| CT-10 Copy and locales | `packages/copy/` (es-419 and en for the W1 screens) |
| W1 tables, one slot per slice | `packages/core/src/schema.ts` |

## Not built yet (W1 builds it)

QVAC, op-sqlite, the notification listener, Keystore and biometric adapters; every W1 screen except About. No inherited feature needs switching off.

## Not done in W0, owner action

- Branch protection on `master` and the `Dev` branch (Part 3.2 item 1): repository admin setting. Until then PRs go to `master` after green CI, as before.
- Spikes S1 to S4 and the dev build on the S26 Ultra need the phone over USB (DEP-01) and at least 15 GB free on the build Mac (DEP-02).
