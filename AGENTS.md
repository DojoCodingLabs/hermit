# AGENTS.md

This is the guide for everyone who changes Hermit: AI coding agents, the people who run them, and people who write code by hand. Read it before you change anything.

`CLAUDE.md`, `GEMINI.md`, `.github/copilot-instructions.md`, `.cursor/rules/hermit.mdc` and `.windsurfrules` all point here. If one of them disagrees with this file, this file wins.

## Hermit in ten lines

1. Hermit is an open-source AI agent that lives on your phone.
2. The model runs on the phone. No core feature needs a server, and chat, memory and reminders work in airplane mode.
3. It talks, remembers, reminds and replies, in Spanish and English.
4. Memories are encrypted on the device.
5. The model never gets a shell or a browser. It picks one typed skill from a menu, then fills in only that skill's fields.
6. A pick is a request, never an action. The cage decides what takes effect, and a signed log records it.
7. Text other people wrote (messages, web pages, mail, other bots) can never give Hermit orders.
8. Payments and logins always wait for an approval sheet that code wrote, and your fingerprint. Sending asks first too, unless you knowingly pick a mode that doesn't.
9. There is no telemetry. CI fails if a dependency that phones home is added.
10. All of it is open: read the code, build it, check every claim.

Read [VISION.md](VISION.md) for why Hermit exists, [ROADMAP.md](ROADMAP.md) for what comes next, [docs/architecture.md](docs/architecture.md) for how the pieces fit, and [docs/evals.md](docs/evals.md) for how we measure the model.

## The non-negotiables

These rules are why people can trust Hermit. They are not style preferences. A change that breaks one won't be merged, however good the rest of it is. To change a rule, open an RFC first (see [How to propose work](#how-to-propose-work)).

### 1. Data stays on the phone

The model runs on the device. Memories and everything else Hermit stores are encrypted on the device (SQLCipher). No core feature may need a server, a cloud model or cloud sync. Data leaves the phone only to carry out what the user asked for, and only to services the user already uses.

**Why:** the promise is that nobody else holds your messages, memories or keys. A feature that needs our server, or anyone's, is a different product.

### 2. No telemetry, ever

No analytics, ads, crash reporters, session replay, attribution or "anonymous usage" pings, opt-in or not. `pnpm check:privacy` and the PR guard fail the build when one is added, including through an alias, a git source or another package's dependencies.

**Why:** "tells no one" has to be true in the code, not a promise in a policy. Telemetry needs a server, and every byte of it is data leaving the phone.

### 3. No network in `packages/*`

The packages are pure TypeScript behind the ports in `packages/core/src/ports.ts`. `fetch`, `XMLHttpRequest` and `WebSocket` are lint errors there. In the phone app, network code lives only in the adapters (`apps/mobile`), and every outbound request is counted through `apps/mobile/src/adapters/net.ts`, so the privacy screen can list each host Hermit contacted. The only exceptions are a few desktop eval tools listed in `eslint.config.js`, which never ship in the app.

**Why:** the core must run and be tested on any machine, and anyone must be able to see at a glance that it can't phone home.

### 4. The cage decides every skill call

Every skill call goes through `decide()` in `packages/cage`, and into the signed, hash-chained audit log, before it takes effect. Deny wins, and no matching rule means deny. Nothing may skip the cage or the log: not a test helper that ships, a debug menu, a demo mode, or "just this once".

**Why:** the model can be wrong, and it can be tricked. The cage is what makes it safe to let it act, and the log is how you check what it did.

### 5. Untrusted text is never the user

Messages, web pages, mail, calendar invitations, connector and MCP results, and other bots' output are untrusted. Code that gives them to the model wraps them with `wrapUntrusted()` (`packages/agent/src/untrusted.ts`), and reading them taints the session. They never count as the user's own words: a request inside a message is data, not an instruction. Once a session has read untrusted text, payments and logins are refused in every mode. By default (Ask mode), saving also asks first, and links or searches the user didn't type need approval or are refused.

**Why:** prompt injection. Anyone who can send you a message must not be able to steer your agent.

### 6. Money and logins always need the sheet and the fingerprint, and sending asks by default

Money and logins always need the code-written approval sheet and the fingerprint, in every mode. Sending and other outward actions need the approval sheet by default (Ask mode); only a permission mode the user picks on purpose, behind explicit warnings, may let them run without asking. Changing what any mode allows is an RFC.

An approval binds to the exact arguments (`argsHash`) and to one request, is checked in code, and expires. Payments and logins also need a signature from a key held in the phone's Android Keystore, and are refused when the session has read untrusted text or nobody is there to approve. For money and logins these are hard limits in code: no rule, setting or mode loosens them.

**Why:** these are the actions you can't take back. A fingerprint on the exact arguments is the one approval a tricked model can't fake, so money and logins never go without it, and nothing outward runs without asking unless the user turned that on knowingly.

### 7. Approval sheets and cards show only words the code wrote

What an approval sheet or a card says comes from code: each skill's `describeAction()` and the copy in `packages/copy`, filled in from the call's arguments and trusted data on the phone, such as a contact's real name. Model output may appear only as clearly marked content the user is approving, such as the text of a reply, never as the app's own words.

**Why:** if the model could write the sheet, it could describe one action and do another.

### 8. Testnet only, and no keys in the repo

The wallet works on testnets only. Don't add mainnet networks, mainnet endpoints or real assets until the maintainers announce otherwise through an accepted RFC. Never commit a real private key, seed phrase, mnemonic, API token or `.env` file. Tests use published test vectors or keys they generate themselves.

**Why:** real money needs audits and a release process that don't exist yet. A key pushed to a public repo is burned the moment it lands.

### 9. Every UI string lives in `packages/copy`, in both locales

Every string a person sees is a key in `packages/copy/locales/en.json` and `packages/copy/locales/es-419.json`, with the same keys and the same `{placeholders}` in both. Keys look like `HM-XXX-NN.element` or `common.*`. Nothing is hard-coded in a screen. Write plain words and short sentences, with no em or en dashes. The Spanish is Latin American (es-419) and uses tú.

**Why:** Hermit is for Spanish and English speakers from day one, and plain, calm words are part of why people trust it.

### 10. Tests first, with made-up data

Write the failing test first, watch it fail for the right reason, then write the code. Tests, fixtures, eval cases and screenshots use made-up people, numbers and addresses (`example.com`, invented names), never real messages, contacts, mail or logs.

**Why:** a test written first is the spec. Real data in a public repo is a leak that can't be taken back.

### 11. Evals don't regress, and held-out sets stay blind

Any change on the model path reports eval numbers from before and after (see [Evidence we need](#evidence-we-need)). No set may score lower after your change. Never tune prompts, router phrases, tool descriptions, normalizers or examples against a held-out case, and never copy a held-out case into a set you tune on. The original blind sets in this repository are published for transparency and no longer count as blind; new blind sets are kept outside the public repository. [docs/evals.md](docs/evals.md) says which sets are which.

**Why:** a small model is only as good as the harness around it, and a blind set stops measuring anything the moment someone tunes on it.

### 12. The logo and mascot are locked

The logo and the mascot are locked to the original drawing in `docs/brand/`. Never redraw, restyle, regenerate or "improve" them, by hand or with an image model. New poses and expressions move the logo's own pieces (`scripts/brand/mascot.py`), and brand files used elsewhere are byte-for-byte copies of the ones in `docs/brand/`.

**Why:** the character is the brand. People recognize it only if it looks the same everywhere.

### 13. Licenses and marks

Code is Apache 2.0 ([LICENSE](LICENSE)). Character art is CC BY 4.0 ([LICENSE-ART.md](LICENSE-ART.md)). The Hermit name, logo and wordmark are trademarks of Dojo Coding and are covered by neither license. Contribute only work you have the right to license under these terms. Anything you bring in from elsewhere must have an Apache-compatible license, and its notice comes with it.

**Why:** clear terms let anyone use, fork and build on Hermit safely, and keep forks from passing themselves off as Hermit.

## How the code stays that way

- **Pure packages, platform adapters.** `packages/*` never import React Native or Expo (lint enforces it). Native and network code lives in `apps/mobile` adapters that implement the ports.
- **Every skill has a risk.** Each skill in `packages/skills` declares one: `read`, `local_write`, `network`, `remote_write`, `send`, `credential` or `spend`. Give a skill the highest risk that fits. Never lower a risk to skip an approval.
- **Tool calls come back unexecuted.** The model runtime (QVAC) returns tool calls without running them. Never pass a `handler` to QVAC tools: skills run only after the cage decides.
- **Model files are pinned.** They download over HTTPS and are checked against a pinned SHA-256 before use. Never load a model from QVAC `registry://` sources: the peer-to-peer registry exposes the user's IP address to peers.
- **Versions are pinned.** `@qvac/sdk` is pinned exactly and `react-native-bare-kit` to `~0.16.0`. Pin new dependencies to exact versions. In `apps/mobile`, add packages with `npx expo install` so Expo picks compatible versions.
- **Money and time.** Amounts are integer base units (`bigint`) with an asset and a network, never floats. Timestamps are stored as UTC epoch milliseconds and shown in the user's locale.
- **Expo moves fast.** Read [apps/mobile/AGENTS.md](apps/mobile/AGENTS.md) and the versioned Expo docs before you touch an Expo or React Native API. Don't trust what you remember about older versions.
- **Generated folders stay generated.** `expo prebuild` creates `apps/mobile/android` and `apps/mobile/ios`. Never edit them by hand.

## The repo map

Each part has one job.

| Path | Its one job |
|---|---|
| `apps/mobile` | The Android app (Expo): the screens, and the adapters that connect the ports to the phone (the model runtime, encrypted SQLite, notifications, calendar, Keystore, network). |
| `apps/relay` | An optional, open-source sign-in relay for services that require a client secret. It swaps a code for tokens, returns them encrypted to the phone, and stores nothing. |
| `apps/site` | The static website. No server functions, cookies, analytics or third-party scripts. |
| `packages/core` | Shared types, the ports, canonical argument hashing, repair of model output, and the rules for money, time and memory. |
| `packages/cage` | The policy (deny wins), the hard limits, taint, approvals bound to exact arguments, and the signed, hash-chained audit log. |
| `packages/skills` | The menu: typed skills, each with a risk, an argument schema and a code-written description of what it will do. |
| `packages/agent` | The turn loop: pick a skill, fill it, repair it, ask the cage, wait for approval, run, log. |
| `packages/model` | Everything between the loop and the on-device model: prompts, the router, model profiles, the pinned download manifest and the plan for each device. |
| `packages/runtime` | The app's logic without the screens: chat state, the approval bridge, settings, the vault, the wallet and web tasks, wired from the other packages. |
| `packages/connectors` | Connector specs and the one runtime that runs them, OAuth with PKCE, the MCP client and the relay protocol. Credentials stay on the phone. |
| `packages/mail` | Email: Gmail, Microsoft Graph, IMAP and SMTP behind ports, and the mail skills. |
| `packages/night` | The night shift: jobs that run while the phone charges, under the cage's rules for when nobody is there, and the morning briefing. |
| `packages/payments` | The testnet wallet's logic: x402 payments, EIP-3009 transfers, the spending ledger and the wallet's message protocol. |
| `packages/copy` | Every UI string, in es-419 and en, and the translator. |
| `packages/eval` | Eval cases and the harness that scores a model on the menu, with a fake model for CI. |
| `packages/sql-node` | SQLite on Node, for tests and evals. The phone uses op-sqlite with SQLCipher. |
| `scripts/check-privacy.mjs` | The dependency denylist: no analytics, crash reporting or login brokers in any manifest, lockfile or Gradle file. |
| `scripts/guard/` | The PR guard (see [The gates](#the-gates)). |
| `docs/` | Architecture, evals, device data, RFCs and the brand. |

## Setup

You need Node 24.9 or later (`.nvmrc` names the major version), git, and pnpm through Corepack (`package.json` pins the version).

```sh
corepack enable
pnpm install
```

The Android app also needs JDK 17, the Android SDK (platform 37, build-tools 37.0.0, NDK 29.0.14206865, CMake 3.22.1) and a physical arm64 Android phone, because QVAC doesn't run inference on emulators. [CONTRIBUTING.md](CONTRIBUTING.md#build-the-android-app) has the build steps.

## The gates

Run all of these before you open or update a pull request. CI runs them too, and a red gate blocks the merge.

```sh
pnpm check:privacy             # no analytics, crash reporting or login broker anywhere in the dependency tree
pnpm typecheck                 # every package
pnpm lint                      # eslint, including the no-network rule for packages
pnpm test                      # node:test for scripts, vitest for packages
node scripts/guard/check.mjs --patterns scripts/guard/patterns.txt   # the PR guard, against origin/HEAD
```

The PR guard reads what your change adds, committed or not, and fails when it:

- adds a telemetry, analytics, ads or crash reporting SDK, to a `package.json`, a lockfile, or a Gradle or iOS build file;
- adds an em or en dash to `packages/copy/locales/*.json`;
- leaves the locales without the same keys and placeholders;
- adds a line to `docs/` or a top-level Markdown file that matches a pattern in `scripts/guard/patterns.txt` (`--patterns <file>`): a quote or narration of what someone said, a transcript or run log, personal data, a local path that names a user, or a secret.

If you change the guard, run its tests too: `node --test scripts/guard/check.test.mjs`. If you change the app's native code, build the APK (see CONTRIBUTING.md).

Never skip, disable or loosen a gate, a test or a lint rule to get to green. If a gate is wrong, say so in the pull request.

## How to propose work

- **A bug:** open a bug report. Fix it in a pull request that links the issue, with a regression test first.
- **A feature:** open a feature proposal and wait for a maintainer to label it `accepted`. Code for a feature without an accepted issue may be closed, however good it is.
- **A change to a non-negotiable:** open an issue with the RFC form (label `rfc`), following [docs/rfcs/0000-template.md](docs/rfcs/0000-template.md). Only a maintainer can accept it. Until then, a pull request that changes the rule won't be reviewed.
- **A small fix:** typos, broken links and wrong comments can go straight to a pull request.
- **A question or an early idea:** [GitHub Discussions](https://github.com/DojoCodingLabs/hermit/discussions).
- **A security problem:** never in public. Follow [SECURITY.md](SECURITY.md).
- **Device data:** [docs/devices.md](docs/devices.md) explains how to send it.

## Scope discipline

- **One issue per pull request.** Two fixes are two pull requests.
- **Small diffs.** If a change grows past roughly 400 changed lines, not counting tests and the lockfile, split it and say how in the issue.
- **No drive-by changes.** No refactors, renames, reformatting, comment rewrites or "while I was here" fixes outside the issue. Open another issue for them.
- **No new dependency without a reason in the pull request:** what it does, why the platform or an existing dependency can't do it, its license, its size, and that it makes no network calls of its own.
- **Leave the lockfile to pnpm.** It changes only through `pnpm install`.
- **Leave the guardrails alone.** Don't change CI workflows, the cage's hard limits, the privacy check, the guard or CODEOWNERS unless the issue is about them.

## Evidence we need

Every pull request shows its work. A maintainer can't merge what they can't check.

- **Tests:** the test that failed before your change and passes after it. A bug fix brings a regression test. A change near the cage shows the hard limits still hold with the configurable rules removed, as the tests in `packages/cage/test/policy.test.ts` do.
- **Eval numbers, for any change on the model path.** The model path is `packages/model`, `packages/agent`, `packages/skills` and `packages/eval`, and anything else that changes the prompt, the router, tool descriptions, normalizers, examples or the model file. Run the sets [docs/evals.md](docs/evals.md) lists for your change, before and after, with the same model file and settings, and paste both.
- **Screenshots, for any UI change:** each changed screen in both themes (light and Deep sea) and both languages (es-419 and en), with made-up data. Shots from a phone or from the preview harness in `apps/mobile/preview` are both fine.
- **Network, if you touch it:** for a new or changed request in an adapter, name the host, why it's needed, and the skill and risk it runs under.

## What we will not merge

- Telemetry of any kind: analytics, ads, crash reporting, session replay, attribution or usage pings, even opt-in.
- Anything that needs a server, a cloud model or cloud sync for a core feature.
- Network calls inside `packages/*`, or a request in the app that isn't counted.
- A side effect that skips `decide()` or the audit log, including debug, demo and test bypasses that ship.
- A way to pay or log in without the approval sheet and the fingerprint, in any mode, or an approval that isn't bound to the exact arguments.
- A send or other outward action that runs without asking in Ask mode, or a change to what any permission mode allows without an accepted RFC.
- Approval sheets or cards that show model-written text as the app's own words.
- Untrusted text treated as the user's: a recipient, amount, link or trusted memory taken from a message or a page as if the user said it.
- Mainnet networks or real assets in the wallet. Real keys, seed phrases, tokens or `.env` files anywhere.
- UI strings outside `packages/copy`, a string in only one locale, or copy with em or en dashes.
- Real personal data in tests, fixtures, eval cases, screenshots or logs.
- Tuning on held-out eval cases, or a change that lowers any eval set.
- A redrawn, restyled or regenerated logo or mascot.
- Code or assets you don't have the right to contribute, or under a license that isn't compatible with Apache 2.0.
- Login brokers or hosted connector platforms that hold users' tokens on their servers.
- A token, coin, NFT or airdrop. Hermit has none.
- Several issues in one pull request, drive-by refactors, or new dependencies without a stated reason.
- A change to a non-negotiable without an accepted RFC.
- Agent output the submitter hasn't read and run, or can't explain.

## How to pick work

Look for these labels:

- **`good first issue`:** small and well scoped, with a pointer to the code. Start here.
- **`help wanted`:** maintainers would welcome help. These may need more context; ask in the issue.
- **`agent-friendly`:** a clear scope, the files named, and the test to write first. Fine to hand to an AI agent, as long as a person reviews and runs the result.
- **`device-lab`:** needs a real phone, or device data ([docs/devices.md](docs/devices.md)).

Before you start, comment on the issue to say you're taking it. Take one issue at a time. If a week goes by with no draft pull request or update, someone else may take it.

## If you are an AI agent

Follow this checklist on every task. If you can't do a step, say which one in the pull request, and why.

1. Read this file, then the issue you are working on. No issue, or a feature that isn't `accepted`? Stop, and draft the issue or proposal instead of code.
2. Write the scope down in one or two sentences. Touch only the files that scope needs.
3. Check your plan against the non-negotiables. If it would bend one, stop and draft an RFC instead.
4. Write the failing test first. Run it, and confirm it fails for the right reason.
5. Make the smallest change that makes it pass.
6. Run every gate: `pnpm check:privacy`, `pnpm typecheck`, `pnpm lint`, `pnpm test` and `node scripts/guard/check.mjs --patterns scripts/guard/patterns.txt`. Never skip, disable or loosen a test, a lint rule or a check to pass.
7. On the model path, run the evals in [docs/evals.md](docs/evals.md) before and after, and paste the numbers. Don't tune on held-out cases or copy them into a set you tune on.
8. On the UI, put every string in `packages/copy`, in both locales, with no em or en dashes, and attach screenshots in both themes and both languages.
9. Add no dependency, network call, permission or telemetry unless the issue asks for it and the pull request explains it.
10. Use only made-up names, numbers and data. Never commit secrets, keys or `.env` files.
11. Never invent results: no made-up test output, eval numbers or screenshots. If you didn't run something, say so.
12. Fill in the pull request template honestly, including which agent you are and what you did.
13. When something is unclear, ask in the issue instead of guessing.
14. In docs, write a decision as what the product does, with its date ("Resolved 2026-11-25: bots message each other directly"). Never quote or paraphrase what someone asked or told you, never say which option was picked or how a question was asked, and never paste run logs, transcripts or paths from your machine.
