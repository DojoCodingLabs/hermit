<!--
Thanks for contributing. Read AGENTS.md first.
Fill in every section, and write "n/a" where one doesn't apply. Whoever opens this pull request is responsible for
every line in it, whether a person or an agent wrote it.
-->

## What and why

Closes #

<!-- One or two sentences: what changes, and why. One issue per pull request. -->

## Vision fit

<!-- Which principle in VISION.md does this serve, and how? -->

## Non-negotiables

- [ ] This keeps every non-negotiable in AGENTS.md as it is.
- [ ] Or it changes one, and this is the accepted RFC: #

## Checklist

- [ ] It closes one issue, linked above, or it's a small fix (a typo, a broken link, a wrong comment). A feature has an `accepted` proposal.
- [ ] I wrote the failing test first. It fails without this change and passes with it.
- [ ] These pass: `pnpm check:privacy`, `pnpm typecheck`, `pnpm lint`, `pnpm test` and `node scripts/guard/check.mjs --patterns scripts/guard/patterns.txt`.
- [ ] No new network call, telemetry, analytics, ads or crash reporting. (A new request in an app adapter is explained below, with its host, skill and risk.)
- [ ] No new dependency, or the reason for each one is below.
- [ ] Every UI string is in `packages/copy`, in es-419 and en, with matching keys and placeholders, and no em or en dashes.
- [ ] Tests, fixtures and screenshots use made-up data only.

## Model path

- [ ] This doesn't touch the model path: `packages/model`, `agent`, `skills` or `eval`, the prompt, the router, tool descriptions, normalizers, examples or the model file.
- [ ] It does. The eval numbers from before and after are below, run as docs/evals.md says. No held-out case was tuned on.

<!--
| Set | Before | After | Model file and settings |
|-----|--------|-------|-------------------------|
-->

## Screenshots

- [ ] No UI change.
- [ ] UI change. Each changed screen is below, in both themes and both languages, with made-up data.

| | Light | Deep sea |
|---|---|---|
| es-419 | | |
| en | | |

## New dependencies and network calls

<!-- For each one: what it does, why the platform or an existing dependency can't, its license, its size, and whether it calls the network. -->

## AI agents

<!-- This is for transparency, not a ban. Agent-written changes are reviewed like any other. -->

- [ ] No AI agent wrote any part of this.
- [ ] An AI agent helped. Which one, and what it did:
- [ ] I read and ran everything in this pull request, and I can explain it.
