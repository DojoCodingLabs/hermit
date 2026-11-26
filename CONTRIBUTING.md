# Contributing to Hermit

Thanks for helping. Hermit is an AI agent that lives on your phone and tells no one, built in the open by people and their AI agents. This guide covers setup, the checks to run, and how a change gets merged.

The rules live in [AGENTS.md](AGENTS.md). Read its non-negotiables before your first change, whether you write code by hand or with an agent. They are short, and they are the reason a change gets merged or closed.

## Ways to help

- Fix a bug or build an accepted proposal. Look for `good first issue`, `help wanted` and `agent-friendly`.
- Report a bug, with steps to reproduce and no personal data.
- Propose a feature. Read [VISION.md](VISION.md) first.
- Run Hermit on your phone and send device data: [docs/devices.md](docs/devices.md) explains how.
- Improve the docs, or the Spanish and English copy.
- Review open pull requests. Reading and running someone's change helps too.

## Set up

You need Node 24, from 24.9 (`.nvmrc` names the major version), git, and pnpm through Corepack (`package.json` pins the version). Node 25 and later don't include Corepack, and Node 26 can't run the eval lab yet.

```sh
git clone https://github.com/DojoCodingLabs/hermit.git
cd hermit
corepack enable
pnpm install
pnpm check:privacy && pnpm typecheck && pnpm lint && pnpm test
```

Working from a fork? Clone your fork, then add this repository as `upstream`, so the PR guard can compare your work with it:

```sh
git remote add upstream https://github.com/DojoCodingLabs/hermit.git
git fetch upstream
git remote set-head upstream --auto
node scripts/guard/check.mjs --base upstream/HEAD --patterns scripts/guard/patterns.txt
```

### Build the Android app

You need JDK 17, the Android SDK (platform 37, build-tools 37.0.0, NDK 29.0.14206865 and CMake 3.22.1) and a physical arm64 Android phone, because QVAC doesn't run inference on emulators. The steps are the same as in `.github/workflows/android.yml`:

```sh
pnpm install
(cd apps/mobile && npx expo prebuild --platform android --no-install)
node scripts/qvac-bundle.mjs                 # QVAC's worker bundle, rebuilt from the workspace root
node apps/mobile/worklets/wallet/build.mjs   # the wallet worklet and its addons, last before Gradle
(cd apps/mobile/android && ./gradlew :app:assembleDebug)
adb install -r apps/mobile/android/app/build/outputs/apk/debug/app-debug.apk
```

The debug build is a development client: it loads JavaScript from Metro on your computer, so JavaScript changes don't need a new build. Connect the phone over USB, then:

```sh
adb reverse tcp:8081 tcp:8081
pnpm --filter @hermit/mobile start
```

To build for an iPhone instead, with its current limits, see [Run it on an iPhone](docs/devices.md#run-it-on-an-iphone-development-build).

## The gates

Run these before you open or update a pull request:

```sh
pnpm check:privacy             # no analytics, crash reporting or login broker anywhere in the dependency tree
pnpm typecheck                 # every package
pnpm lint                      # eslint, including the no-network rule for packages
pnpm test                      # node:test for scripts, vitest for packages
node scripts/guard/check.mjs --patterns scripts/guard/patterns.txt   # the PR guard (AGENTS.md says what it checks)
```

If you change the guard itself, run its tests: `node --test scripts/guard/check.test.mjs`.

CI runs three workflows on pull requests, on GitHub-hosted runners with read-only access and no secrets:

- **CI:** the privacy check, typecheck, lint and tests.
- **Guard:** the PR guard and its own tests.
- **Android:** the debug APK and the app's JVM tests, only for pull requests that touch the app and are ready for review.

A red CI or Guard check blocks the merge, and a maintainer won't merge with a red Android check either. If you think a check is wrong, say so in the pull request rather than working around it.

## Run part of the tests

`pnpm test` runs every test in the repository. For a faster loop while you work, run one package or one file from the repository root after `pnpm install`:

```sh
pnpm --filter @hermit/core test                          # all tests in packages/core, with Vitest
pnpm --filter @hermit/core test test/time.test.ts        # one test file in packages/core, with Vitest
pnpm --filter @hermit/mobile test                        # all tests in apps/mobile, with node:test
(cd apps/mobile && node --test --experimental-strip-types src/format.test.ts)   # one test file in apps/mobile, with node:test
node --test scripts/devices/validate.test.mjs            # one test file for the scripts, with node:test
```

Vitest runs the tests in `packages/*`, `apps/site` and `apps/relay`. `node --test` runs the tests in `apps/mobile` and the scripts at the root. Add the file path after `test` to pick one Vitest file. The path is relative to the package, so `test/time.test.ts` means `packages/core/test/time.test.ts`.

The guard's own tests are not part of `pnpm test`. Run them when you change the guard, as AGENTS.md asks:

```sh
node --test scripts/guard/check.test.mjs
```

The gates still run everything before a pull request. Use these commands only to check your work as you go.

## Make a change

1. Find the issue, or open one. A feature needs the `accepted` label first. A change to a non-negotiable needs an accepted RFC.
2. Comment on the issue to say you're taking it.
3. Create a branch from the default branch, with a short name like `fix/reminder-time-zone`.
4. Write the failing test, then the change.
5. Run the gates.
6. Commit with a message that says what changed and why, in plain words. Sign off (see below).
7. Open a pull request and fill in the template. Open it as a draft if you want early feedback, and mark it ready when the gates pass.

### Sign off your commits (DCO)

We recommend signing off every commit with the [Developer Certificate of Origin](https://developercertificate.org/). It's one line in the commit message that says you wrote the change, or have the right to submit it, under this project's licenses:

```
Signed-off-by: Your Name <you@example.com>
```

`git commit -s` adds the line for you. It's recommended, not required. If an agent wrote part of the change, your sign-off covers that part too, so sign off only on work you've read and stand behind.

### Working with AI agents

You're welcome to code with Codex, Claude Code, Cursor, Copilot, Gemini, Jules or any other agent. Most of them find AGENTS.md on their own, and this repository has pointer files for the rest.

You are responsible for every line you submit: read it, run it, and be ready to explain it. The pull request template asks whether an agent helped and which one. That's for transparency, not a filter: agent-written changes are reviewed exactly like any other. Pull requests whose author hasn't read or run them will be closed.

Don't credit an agent in your commits: no `Co-authored-by` trailer for an AI tool and no "Generated with" line. Many agents add one by default; turn it off in the agent's settings, or remove the line and amend before you push. Name the agent in the pull request's description instead, as the template asks. The PR guard refuses a commit that credits an AI tool.

## Review

- A maintainer reviews every pull request from a contributor. CODEOWNERS requests the maintainer for the cage, the core, the privacy check, the guard and the workflows.
- Reviewers check, in this order: the change fits the vision, it keeps the non-negotiables, the tests came first and cover the change, the evidence is there (eval numbers, screenshots), it sticks to one issue, and the code is clear.
- Expect questions and requested changes. That's normal, not a rejection. Reply in the thread and push new commits instead of force-pushing, so reviewers can see what changed.
- Style is the linters' job in the packages, scripts and site, so reviews focus on behavior and risk. The app in `apps/mobile` isn't linted yet: match the code around your change.
- A maintainer merges a contributor's pull request once it's approved and the required checks are green. A pull request that goes quiet for a long time may be closed; you can reopen it whenever you're back.

## Talk to us

- **Questions, ideas and show-and-tell:** [GitHub Discussions](https://github.com/DojoCodingLabs/hermit/discussions).
- **Bugs and accepted work:** [Issues](https://github.com/DojoCodingLabs/hermit/issues).
- **Security problems:** privately, as [SECURITY.md](SECURITY.md) explains. Never in a public issue.
- **Conduct:** the [Code of Conduct](CODE_OF_CONDUCT.md) applies everywhere in the project. Report problems privately, through GitHub's Report content option or by email to privacy@dojocoding.io.

## Licensing

By contributing, you agree that your contribution is licensed under the Apache License 2.0 ([LICENSE](LICENSE)), or under CC BY 4.0 ([LICENSE-ART.md](LICENSE-ART.md)) for character art. The Hermit name, logo and wordmark remain trademarks of Dojo Coding.

## For maintainers

The repository settings this guide relies on: Discussions on, private vulnerability reporting on, and reported content sent to maintainers (Settings, Moderation options), so conduct reports reach you privately.

Labels live in `.github/labels.json`. To create them, or update the ones that already exist:

```sh
jq -c '.[]' .github/labels.json | while read -r label; do
  gh label create "$(jq -r .name <<<"$label")" \
    --color "$(jq -r .color <<<"$label")" \
    --description "$(jq -r .description <<<"$label")" \
    --force
done
```

Device reports wait on the `device-data` branch: the device-report workflow commits them there and never opens a pull request. To publish them, open a pull request from `device-data` to `main`; opening it runs CI and Guard. The workflow's own pushes start no run, so if another report lands while the pull request is open, close and reopen it so both checks run on its newest commit. Then merge it.

Before you merge anything from GitHub, turn on **Keep my email addresses private** in your GitHub email settings. Otherwise the merge commit carries your account's primary email address, in public.

A preview APK starts from a tag. On an up-to-date `main`, push a lightweight tag (no `-a`, so no tagger and no email address goes with it): `git tag v0.1.0-preview.2 && git push origin v0.1.0-preview.2`. The Release APK workflow builds the APK, signs it with the preview key and publishes the release with the APK's SHA-256. The workflow never makes a tag. To build an existing tag again, run it by hand from that tag: Actions, Release APK, Run workflow, and pick the tag. Then copy the release's file name, link and SHA-256 into `apps/site/lib/release.ts`.
