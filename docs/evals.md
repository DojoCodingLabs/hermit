# How Hermit measures itself

Hermit runs a 0.8-billion-parameter model on a phone. A model that small is only as good as the harness around it, so every change to the harness is measured, the same way, before and after. This page explains the sets, the lab, the rules that keep the numbers honest, the current numbers and how to run everything yourself.

## What a case is

A case is one request, in Spanish or English, and the first action Hermit should take: a skill and the arguments that matter, or a plain reply, or a question back to you.

```ts
{ id: "en-remind-1", lang: "en", input: "remind me to buy milk at 5pm",
  expect: { choice: "remind", contains: { at: "T17:00" } } }
```

- **`choice`** is the skill the model must pick, or `respond` (a plain reply, no skill) or `ask_user` (a question back, because something essential is missing).
- **`args`** must match exactly. **`contains`** needs each named argument to contain a substring, case-insensitive. Extra arguments are fine.
- **The clock is fixed.** Every run believes it's Wednesday, 11 November 2026, 9:00 p.m. in Costa Rica, so "tomorrow at 7" means the same thing in every run.
- **Cases run like the real loop:** the router, the pick, the fill and the code that reads dates all run, exactly as they do on the phone.

Multi-turn **trajectories** are graded differently: on the end state. Was the reminder set for the right time? Did the reply go to the right person, with your approval? Did the injected instruction get ignored?

## The sets

| Set | Size | What it's for | Where |
| :-- | :-: | :-- | :-- |
| **Core** | 40 | The everyday tasks: remind, remember, recall, forget, the calendar and messages, plus plain chat, clarifying questions and requests nothing on the menu can do. 20 Spanish, 20 English, many phrased so the router's phrase rules don't fire, so the model's own choice gets measured. The phone bar is set on this one. | Public, [`first-win-cases.ts`](../packages/eval/src/first-win-cases.ts) |
| **Virtual assistant** | 124 | The core 40 plus 84 more, grouped by capability family. Forty cases can't tell 53% from 70%; this set can. | Public, [`va-cases.ts`](../packages/eval/src/va-cases.ts) |
| **Dev held-out** | 90 | Written blind to the harness and its prompts, to check that gains generalize. Its failures have since been read, so it now counts as development data. | Public, [`holdout-cases.ts`](../packages/eval/src/holdout-cases.ts) |
| **Messaging** | 50 | Reading before replying, who said what, and the near misses that belong to other skills. 25 Spanish, 25 English. | Public, [`messaging-cases.ts`](../packages/eval/src/messaging-cases.ts) |
| **Memory and decline** | 60 | Remember, recall and forget, polite refusals, and when to ask. 30 Spanish, 30 English. | Public, [`memdec-cases.ts`](../packages/eval/src/memdec-cases.ts) |
| **Trajectories** | 30 scenarios | Whole conversations through the real runtime (database, cage, loop, skills), including five prompt-injection scenarios. Run on several seeds. | Public, [`trajectory-eval.ts`](../packages/eval/src/trajectory-eval.ts) |
| **Original blind held-out** | 100 | Written separately by someone who never read the harness code, and never read or tuned on while it was blind. The scores below were measured then. | Public, so it no longer counts as blind: [`holdout2-cases.ts`](../packages/eval/src/holdout2-cases.ts) |
| **Original long-answer blind** | 80 | Checks that code recognizes when you asked for a long answer. Written without reading the detector. | Public, so it no longer counts as blind: [`long-form-blind-cases.ts`](../packages/eval/src/long-form-blind-cases.ts) |
| **New blind sets** | Varies | The honest judge from here on. Written by someone who hasn't read the harness, and never read or tuned on by anyone working on it. | Kept outside this repository. Only their scores are published. |

The package also holds evals for experimental features, like tasks on websites, x402 payments to a site and connectors drafted from a service's docs. They're useful for the people working on those features and aren't part of the headline numbers. Their held-out fixtures are public too, so they no longer count as blind.

The original blind sets are published for transparency: anyone can read the cases behind the numbers below. That also means they no longer count as blind, so new blind sets are kept outside the public repository, and future scores stay honest.

## The rules

These keep the numbers worth reading:

1. **Never tune on a blind set.** Don't read its cases, don't look at its failures, don't change a prompt, a normalizer or the router because of it. If you do by accident, the set stops being blind: say so and stop quoting it.
2. **New blind sets live outside this repository.** That way they can't leak into prompts, examples or training data. We publish their scores, not their cases. The original blind sets in this repository are public and count as development data now.
3. **New blind sets come from someone who hasn't read the harness:** the model package, the skills or the code that reads dates.
4. **Report the blind number as the honest one.** Development sets show progress. The blind set shows whether it's real.
5. **Same file, same clock, same scoring.** Record the model's SHA-256 and the profile id with every number. Change one thing at a time.
6. **Mind the noise.** A 40-task set carries about ±15 points of noise between versions of the harness. Confirm a change on the 124-case set, on several seeds for trajectories, and on a blind set (the maintainers run the new ones) before you believe it.
7. **One run at a time.** A loaded machine changes nothing about accuracy, but it makes runs slow and it can corrupt timing numbers.
8. **Pull requests that touch the harness include before and after numbers.** If a number went down, say so.

## The current numbers

Measured in November 2026. Every run used the same file: BotPsy-0.8B, `Q4_K_M`, SHA-256 `482db2df…4d83`. "Generic setup" means tools offered as JSON with thinking off. "Hermit's harness" means the shipped profile: tools in the model's native format with a 256-token thinking budget, the router with enforced calls, code that reads dates and times, and the checks.

| Set | Where | Generic setup | Hermit's harness |
| :-- | :-- | :-: | :-: |
| Core, 40 | Galaxy S26 Ultra | 21/40 | **39/40** |
| Core, 40 | Mac lab | 22/40 | **40/40** |
| Dev held-out, 90 | Mac lab | 55/90 | **85/90** |
| Blind held-out, 100 (measured while blind) | Mac lab | 73/100 | **93/100** |

- **Trajectories:** 120 of 120 (30 scenarios on 4 seeds). Injected instructions were never obeyed. Since code started writing the confirmations, the same 120 conversations take 270 model calls instead of 433, 38% fewer.
- **Time to first action on the phone:** 13.5 s median, under the 15 s bar. The 90th percentile is 24.6 s.
- **Decode speed on the phone:** about 40 tokens per second, 37 to 42 measured, with 5 threads on the S26 Ultra.

How to read them:

- The blind set's "generic" run already had code reading the times, so that row understates the harness's full effect. It's the conservative comparison.
- The core set was measured on the phone and in the lab. Before any harness work, the lab and the phone landed one task apart (22 and 21 of 40), which is why accuracy work happens in the lab and speed work happens on phones.
- Generic numbers come from earlier versions of this repository. Today's runners can switch parts of the harness off for ablations (below), but they don't recreate the old setup exactly.

## The Mac lab

The lab runs the phone's exact GGUF on your computer through llama.cpp's `llama-server`, with the same harness code the phone runs. Accuracy carries over. Speed doesn't, so never quote lab timings as phone timings.

**1. Get llama.cpp.** On macOS, `brew install llama.cpp` gives you `llama-server`. Elsewhere, build it from [ggml-org/llama.cpp](https://github.com/ggml-org/llama.cpp).

**2. Get the model and check it.**

```sh
REV=17bb36aa29c58fcde8e321aaaad3f2f7372aa655
curl -L -o botpsy-0.8b-q4_k_m-imat.gguf \
  "https://huggingface.co/qvac/BotPsy-0.8B-GGUFs/resolve/$REV/botpsy-0.8b-q4_k_m-imat.gguf"
shasum -a 256 botpsy-0.8b-q4_k_m-imat.gguf
# 482db2dfdbc8ab7db3d3216fd8ef071d7381dd8547aff9933bc03312839d4d83
```

**3. Start the server.**

```sh
llama-server -m botpsy-0.8b-q4_k_m-imat.gguf --jinja -c 8192 --port 8090 \
  -np 1 -t 6 --no-webui --cache-ram 0
```

- `--jinja` uses the model's own chat template, which native tool calls need.
- `-c 8192` matches the profile's context.
- `--port 8090` is where the runners look by default. Pass `--url` to point them elsewhere.
- `-np 1` keeps one slot, so one case runs at a time.
- `-t 6` is the thread count. Set it to your performance cores.
- `--cache-ram 0` keeps the server's memory flat across long runs.

**4. Run a set.** From a second terminal, with the repository installed (`pnpm install`):

```sh
cd packages/eval
node --experimental-transform-types --no-warnings src/mac-eval.ts botpsy-q4-native-think256
```

That runs the core 40 with the shipped profile. The last line prints the score, the Spanish and English split, the median time per case and the score by family.

| Flag | What it does |
| :-- | :-- |
| `--set va` | The 124-case set. Also `holdout` (dev held-out), `holdout2` (the original blind set), `messaging` and `memdec`. No flag means the core 40. |
| `--think N` | Overrides the thinking budget. `0` turns thinking off. |
| `--format two_stage` | Pick the skill from a constrained list first, then fill its schema, instead of native tool calls. |
| `--fast-route` | When the router forces a skill, skip thinking and fill the arguments in one short call. |
| `--raw` | Skips the code that reads dates and times, to see the model's own arguments. |
| `--url URL` | Another `llama-server` address. |
| `--out file.jsonl` | Writes every case: the input, the expectation, what came back, the time and the raw model exchange. |

Profiles you can pass as the first argument include `botpsy-q4-native-think256` (shipped), `botpsy-q4-native-nothink`, `botpsy-q4-two-stage-nothink` and `botpsy-q4-native-think128`. The full list is in [`packages/model/src/profile.ts`](../packages/model/src/profile.ts).

**5. Run the trajectories.**

```sh
HERMIT_SEED=1 node --experimental-transform-types --no-warnings src/trajectory-eval.ts botpsy-q4-native-think256
```

Repeat with other seeds (`HERMIT_SEED=2`, `3`, `4`) and add the results. `--only <scenario-id>` runs one scenario, and `--out file.jsonl` keeps the transcripts.

## On the phone

Speed is measured on real phones, with the dev build from the [README](../README.md#build-it-yourself).

1. Keep the phone unlocked and cool, with Hermit in the foreground. Android slows down apps it considers in the background, and a hot phone runs slower.
2. Open the eval screen:

   ```sh
   adb shell am start -a android.intent.action.VIEW -d "hermit://eval"
   adb logcat | grep "hermit:eval"
   ```

3. It runs the core 40 on the phone with the app's own thread plan, and prints each case, the score and the time to first action. `hermit://eval?p=<profile-id>` picks the profiles to compare, `threads=N` forces a thread count, and `delay=S` waits before each load so you can measure with the app in the background.
4. Let the phone cool down between runs, and run one profile at a time.

To run the benchmark on your own phone and share the results, use the [Device lab](devices.md).

## Adding cases

- **Write in both languages.** Add the Spanish and the English version of a request, and phrase them the way people actually write, not the way a menu reads. Latin American Spanish, voseo included.
- **Check only what matters.** The skill and its key arguments. Use `contains` for text the model may word differently.
- **Put cases in a development set,** never in a blind one, and never next to the router's examples. Examples teach the router; cases measure it.
- **Run the set before and after your change,** with the same profile and the same file, and put both numbers in the pull request.
