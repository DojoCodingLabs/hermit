# Wave 1a: Agent Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The platform-free half of the first win: encrypted-ready memory, tool-call repair, a persisted signed audit log, and the agent loop (pick → fill → repair → cage → approve → execute → audit), all tested on Node with real SQLite.

**Architecture:** New `@hermit/sql-node` implements `SqlPort` over `node:sqlite` (Node 24, FTS5 verified) for tests and the eval. Memory and repair live in `@hermit/core`. The persisted audit log and approval proofs live in `@hermit/cage`. The loop lives in a new `@hermit/agent` package, because it needs both `core` and `cage` (cage already depends on core). The phone later supplies op-sqlite, QVAC and biometric adapters for the same ports.

**Tech Stack:** TypeScript 6.0.3, vitest 5.1, `node:sqlite`, `@noble/hashes` (HMAC-SHA256), existing `@hermit/core|cage|skills`.

**Spec:** `docs/superpowers/specs/2026-11-08-hermit-architecture-design.md` §4.2 (loop), §4.3 (cage), §4.4 (memory).

## Global Constraints

- Everything from the Wave 0 plan's Global Constraints still holds: no network in packages, no React Native imports, no AI attribution in commits, and heavy commands run one at a time.
- Loop limits (spec §4.2): at most **4** skill calls per user turn; **3** repair strikes end the turn; an approval that times out counts as deny.
- Memory (spec §4.4): one fact is at most **500** characters; the profile snapshot is at most **1,400** characters and is built once per session; FTS5 uses `tokenize='unicode61 remove_diacritics 2'`.
- Untrusted tool output is wrapped in random-id markers, and the content is stripped of anything that looks like a marker.
- Never pass a QVAC `handler`. Skills run only through `@hermit/agent`.

## Review Focus

- Args changed between approval and execution must not run → Task 5 test `approval for a different argsHash is treated as deny`.
- Untrusted text containing a fake closing marker must not escape the wrapper → Task 5 test `untrusted output cannot forge the closing marker`.
- An approval sheet that never answers must not hang the turn → Task 5 test `approval timeout counts as deny`.
- Memories saved in a tainted session must not be injected silently into the system prompt → Task 2 test `tainted facts stay out of the profile snapshot`.
- A model that keeps calling skills must stop → Task 5 test `stops after four skill calls`.

---

### Task 1: `@hermit/sql-node`

**Files:** Create `packages/sql-node/{package.json,tsconfig.json,src/index.ts}`, `packages/sql-node/test/node-sql.test.ts`

**Interfaces:**
- Consumes: `SqlPort` from `@hermit/core`.
- Produces: `nodeSql(path?: string): SqlPort & { close(): void }`. The default path is `":memory:"`. `query` returns plain objects (not null-prototype). `transaction` runs `BEGIN`/`COMMIT` and rolls back on throw.

- [ ] **Step 1: Failing tests:** `exec and query round trip with params`; `query returns plain objects`; `transaction rolls back on error` (insert inside a transaction that throws → the row count stays 0); `fts5 matches without accents` (insert "Mi pasaporte vence en marzo", `MATCH 'pasaporte'` and `MATCH 'mama'` against "llamar a mamá" both hit).
- [ ] **Step 2:** Run, see it fail. **Step 3:** Implement with `DatabaseSync`. **Step 4:** Run, see it pass. Commit `feat(sql-node): SqlPort over node:sqlite for tests and eval`.

### Task 2: Memory in `@hermit/core`

**Files:** Create `packages/core/src/memory.ts`, `packages/core/test/memory.test.ts` (devDependency `@hermit/sql-node`)

**Interfaces:**
- Consumes: `SqlPort`.
- Produces: `Memory { migrate(): Promise<void>; remember(fact: string, opts?: { tainted?: boolean; now?: number }): Promise<{ id: number }>; recall(query: string, limit?: number): Promise<Array<{ id: number; fact: string; tainted: boolean; createdAt: number }>>; forget(query: string): Promise<number>; profileSnapshot(maxChars?: number): Promise<string> }` and `createMemory(sql: SqlPort): Memory`. Errors: `MemoryError` with `code: "too_long" | "empty"`.
- Schema: table `notes(id INTEGER PRIMARY KEY, fact TEXT NOT NULL, tainted INTEGER NOT NULL, created_at INTEGER NOT NULL)` plus a `notes_fts` fts5 table with `content='notes'`, kept in sync by triggers.
- Recall: user text is turned into an FTS5 query by quoting each word (`"w1" "w2"`, joined with OR) so punctuation can't break the syntax, ordered by `bm25`.
- `forget` deletes every note that matches the query and returns the count.
- `profileSnapshot`: the newest **untainted** facts, joined one per line as `- fact`, until adding the next fact would exceed `maxChars` (default 1,400).

- [ ] **Step 1: Failing tests:** `remember then recall finds the fact`; `recall ignores accents and case` (stored "Mamá cumple el 3 de mayo", query "mama"); `recall survives punctuation in the query` (`"what's my passport?"` doesn't throw); `forget removes matching facts and reports the count`; `remember rejects facts over 500 characters`; `profile snapshot stays under the cap, newest first`; `tainted facts stay out of the profile snapshot`.
- [ ] **Steps 2-4:** fail, implement, pass. Commit `feat(core): on-device memory with FTS5 recall and capped profile snapshot`.

### Task 3: Tool-call repair in `@hermit/core`

**Files:** Create `packages/core/src/repair.ts`, `packages/core/test/repair.test.ts`

**Interfaces:**
- Produces:
  - `repairSkillName(raw: string, menu: readonly string[]): { name: string; repaired: boolean } | null`. It normalizes case, turns `-` and spaces into `_`, converts camelCase to snake_case, strips a `_tool` suffix, then picks the unique menu entry within Levenshtein distance 2, or returns null.
  - `parseArgs(rawText: string): { value: unknown; repairs: string[] }`. It strips code fences, removes trailing commas, and maps Python `None`/`True`/`False` to JSON. It throws `RepairError("bad_json")` when the text still doesn't parse.
  - `coerceArgs(args: unknown, schema: JsonSchema): { args: Record<string, unknown>; repairs: string[] }`. It converts `"42"` to a number for number/integer fields and `"true"`/`"false"` to booleans, and drops properties the schema doesn't declare when `additionalProperties` is false.
  - `validateArgs(args: Record<string, unknown>, schema: JsonSchema): string[]`. It checks required, type, maxLength, pattern and enum, and returns human-readable errors (empty when valid).

- [ ] **Step 1: Failing tests:**
  - `repairs common skill-name slips` (`"Reply-Message"`, `"replyMessage"`, `"reply_message_tool"` and `"reply_mesage"` all map to `reply_message`);
  - `rejects names that are not on the menu` (`"shell"` gives null);
  - `parses fenced json with trailing commas`;
  - `maps python literals`;
  - `throws on hopeless json`;
  - `coerces numeric and boolean strings`;
  - `drops undeclared properties`;
  - `validate reports missing required, too long and pattern mismatch`.
- [ ] **Steps 2-4:** fail, implement, pass. Commit `feat(core): deterministic tool-call repair and argument validation`.

### Task 4: Persisted audit log and approval proofs in `@hermit/cage`

**Files:** Create `packages/cage/src/audit-log.ts`, `packages/cage/src/approval-proof.ts`, tests `packages/cage/test/{audit-log.test.ts,approval-proof.test.ts}` (devDependency `@hermit/sql-node`)

**Interfaces:**
- Consumes: `appendEntry`, `verifyChain`, `AuditEntry`, `AuditInput` (Wave 0), `SqlPort`, `SignerPort`.
- Produces:
  - `AuditLog { migrate(): Promise<void>; append(input: AuditInput): Promise<AuditEntry>; entries(): Promise<AuditEntry[]>; verify(publicKey: Uint8Array): Promise<ReturnType<typeof verifyChain>> }` and `createAuditLog(sql: SqlPort, signer: SignerPort): AuditLog`.
  - Table `audit(seq INTEGER PRIMARY KEY, ts, session_id, event, skill, args_hash, decision, outcome, prev_hash, hash, sig)`. Optional columns hold NULL; `entries()` maps NULL back to `undefined`.
  - `approvalProof(key: Uint8Array, argsHash: string, requestId: string): string` (hex HMAC-SHA256 over `argsHash + "\n" + requestId`) and `verifyApprovalProof(key, argsHash, requestId, proof): boolean` (constant-time compare).

- [ ] **Step 1: Failing tests:** `appended entries persist and verify after reload` (append 3 entries, one of them without `skill`; a fresh `createAuditLog` on the same db reads them back and verifies `ok`); `append continues the chain across instances`; `tampering in the table is detected` (UPDATE `skill` in SQL, then verify fails at that seq); `approval proof verifies for the same hash and request`; `approval proof fails for a different hash`.
- [ ] **Steps 2-4:** fail, implement, pass. Commit `feat(cage): SQLite-backed signed audit log and approval proofs`.

### Task 5: The agent loop, `@hermit/agent`

**Files:** Create `packages/agent/{package.json,tsconfig.json,src/index.ts,src/types.ts,src/untrusted.ts,src/loop.ts}`, tests `packages/agent/test/{untrusted.test.ts,loop.test.ts,helpers.ts}`

**Interfaces:**
- Consumes:
  - from `@hermit/core`: `ModelPort`, `Msg`, `SessionState`, `SkillDef`, `RenderContext`, `ApprovalPort`, `argsHash`, `repairSkillName`, `parseArgs`, `coerceArgs`, `validateArgs`;
  - from `@hermit/cage`: `decide`, `PolicyRule`, `AuditInput`;
  - from `@hermit/skills`: the `SkillDef`s.
- Produces (`types.ts`):
  - `SkillResult { ok: boolean; modelText: string; untrusted?: boolean }`;
  - `SkillRuntime { def: SkillDef; execute(args: Record<string, unknown>, ctx: { session: SessionState; approvedArgsHash?: string }): Promise<SkillResult> }`;
  - `AuditSink { append(input: AuditInput): Promise<unknown> }`;
  - `LoopDeps { model: ModelPort; skills: SkillRuntime[]; rules: PolicyRule[]; approvals: ApprovalPort; audit: AuditSink; render: RenderContext; now(): number; newId(): string; maxSteps?: number; maxStrikes?: number; approvalTimeoutMs?: number }`;
  - `StepEvent` = `{ kind: "picked"; skill } | { kind: "blocked"; skill; reason } | { kind: "approved"; skill } | { kind: "denied"; skill } | { kind: "executed"; skill; ok } | { kind: "repair_failed"; detail }`;
  - `TurnResult = ({ kind: "final"; text } | { kind: "needs_user"; question } | { kind: "error"; code: "max_steps" | "repair_failed" | "model_error" }) & { events: StepEvent[]; messages: Msg[] }`.
- Produces (`untrusted.ts`): `wrapUntrusted(text: string, source: string, id: string): string`. Output looks like `<untrusted id="{id}" source="{source}">\n…\n</untrusted id="{id}">`. Any `<untrusted` or `</untrusted` sequence inside `text` is replaced by `‹untrusted` before wrapping.
- Produces (`loop.ts`): `runTurn(state: { session: SessionState; messages: Msg[] }, userText: string, deps: LoopDeps): Promise<TurnResult>`. It mutates `state.session.taint` when untrusted output arrives.

Loop behavior, as the spec fixes it:
1. Append the user message.
2. Then, up to `maxSteps` (default 4) times:
   1. `pick` over the available skill ids.
   2. `respond` streams the reply and returns `final`.
   3. `ask_user` returns `needs_user` with the model's text.
   4. Any other choice goes through `repairSkillName`. If no skill matches, it costs a strike and a tool error message.
   5. `fill` with that skill's schema, then `parseArgs` → `coerceArgs` → `validateArgs`. Any failure costs a strike plus a tool message naming the errors; `maxStrikes` (3) strikes return `repair_failed`.
   6. Compute `argsHash` and audit `call_proposed`.
   7. `decide` → audit `policy_decided`. A deny becomes a tool message "Blocked: {reason}" and the loop continues.
   8. An ask calls `approvals.request` with:
      - `summary` from `def.describeAction(args, render)`;
      - `taintWarning` when `decision.taintInfluenced`;
      - `expiresAt` set to now + `approvalTimeoutMs` (default 120,000), raced against a timer that returns `expired`.

      The approval counts only if `kind === "approved"` and `outcome.argsHash === call.argsHash`. Anything else is a deny (a tool message "Not approved"), and the audit records an `approval` entry with the outcome.
   9. `execute` → audit `executed`. Untrusted output (from the result or `def.producesUntrusted`) adds a taint (`kind: "inbound_message"`, ref = skill id), audits `taint_added`, and wraps `modelText` with `wrapUntrusted`. The tool message is appended.
3. Hitting the step limit returns `max_steps`.

- [ ] **Step 1: Failing tests (`untrusted.test.ts`):** `wraps with the id and source`; `untrusted output cannot forge the closing marker`.
- [ ] **Step 2: Failing tests (`loop.test.ts`)**, using a scripted `ModelPort`, recording approval and audit fakes, and the `firstWinSkills` defs with fake executors:
  - `plain chat responds without touching skills`;
  - `remember runs without approval and is audited` (audit events in order: call_proposed, policy_decided, executed);
  - `reply asks, and an approved send executes`;
  - `denied approval does not execute`;
  - `approval for a different argsHash is treated as deny`;
  - `approval timeout counts as deny` (approvals never resolve, `approvalTimeoutMs: 20`);
  - `reading messages taints the session and wraps the output`;
  - `a send after reading messages carries a taint warning`;
  - `misspelled skill names are repaired`;
  - `three bad fills end the turn with repair_failed`;
  - `stops after four skill calls`.
- [ ] **Steps 3-5:** fail, implement, pass, typecheck and lint. Commit `feat(agent): turn loop with repair, cage, approvals, taint and audit`.

### Task 6: Memory skills end to end

**Files:** Create `packages/agent/src/memory-skills.ts`, `packages/agent/test/memory-skills.test.ts`

**Interfaces:**
- Consumes: `Memory` (Task 2), `skillById` from `@hermit/skills`, `SkillRuntime` (Task 5).
- Produces: `memorySkills(memory: Memory): SkillRuntime[]` for `remember`, `recall` and `forget`.
  - `remember` stores the fact, tainted when `ctx.session.taint.length > 0`, and replies "Saved."
  - `recall` returns the matches one per line, or "Nothing saved about that."
  - `forget` returns "Forgot {n}." or "Nothing matched."

- [ ] **Step 1: Failing tests:** `remember then recall across two turns with a real SQLite memory`; `a fact saved after reading messages is stored tainted`; `forget reports the count`.
- [ ] **Steps 2-4:** fail, implement, pass. Commit `feat(agent): memory skills over on-device memory`.

### Task 7: Ship

- [ ] Run the full gate, one heavy command at a time: privacy check, typecheck, lint and test. Then a final whole-branch review, the fix pass, push, and PR #2 "Wave 1a: agent core". No AI co-author or "Generated with" lines.
