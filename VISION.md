# Hermit's vision

This is the north star. Read it before you propose a feature, review a pull request or point a coding agent at this repository. When a change and this page disagree, the change waits. When this page is wrong, say so in an issue, in public, before you change it.

## North star

**An agent as capable as the ones in the cloud, that lives on your phone and answers only to you.**

Personal agents can now read your messages, keep your calendar, sign in for you and pay for things. Almost all of them do it the same way: your life travels to a computer you don't control, and you trust the company that runs it.

Hermit makes the other trade. The agent moves in with your data, instead of your data moving out to the agent. The model runs on the phone. Memories stay on the phone, encrypted. Every action passes through code you can read, and anything that touches the outside world on your behalf shows you exactly what it will do and waits for you.

A hermit crab carries its home on its back and keeps to itself. That's the whole idea.

## What Hermit is

- **A personal agent for one person,** on that person's phone. It talks, remembers, reminds, answers messages and mail, fills logins, pays, and works overnight.
- **A small model in a strong harness.** The model runs on the phone. Around it, a harness of typed skills, a router, code that reads what code can read and checks on every step makes it reliable. We measure the harness and publish the numbers. New blind sets will stay outside the public repository, so future scores stay honest.
- **A cage the model can't talk its way out of.** A policy engine in plain TypeScript decides every action. Approvals are written by code and bound to the exact action. A signed, hash-chained log records every step.
- **Open source.** The code is Apache 2.0, so anyone can read it, build it and check what it does.
- **Bilingual from the first line.** Spanish (Latin America) and English, equally.

## What Hermit isn't

- **It isn't a cloud chatbot with a phone app on top.** No server holds your chats, memories, keys or tokens.
- **It isn't a computer-use agent.** The model gets a menu of typed skills. It never gets a shell, a file system or a free browser.
- **It isn't autonomous where it counts.** Sending, paying and logging in wait for you.
- **It isn't a data business.** There are no accounts to sell, no profiles to build and no ads to show.
- **It isn't a token.** Hermit has no coin. Anyone selling you one is scamming you.
- **It isn't finished.** It's pre-alpha and it says so.

## Principles

### 1. On-device first

If it can run on the phone, it runs on the phone: the model, memory, reminders, the policy engine, the log. Airplane mode is a normal way to use Hermit, not an error. When a job is too heavy for a phone, the answer is hardware you own and pair yourself, never a server you didn't choose.

### 2. Nothing leaves without consent

Hermit uses the network only when a task needs it, and only to reach the place that task names. Anything that pays or logs in shows the exact action and waits for your fingerprint. Sends show the exact action and ask first, unless you put a bot in Don't ask. The few honest exceptions, like the model's first download or a calendar that syncs on its own, are listed where you can read them, and the app counts every host it contacts so you can check.

Future permission modes may let you pre-approve some actions for a bot you trust, after a plain warning you read and confirm. Payments and logins will always wait for you.

### 3. The model proposes. Code decides.

The model's output is a request, never an action. Code checks it, the cage rules on it and, when it must, you approve it.

- **Approval sheets are written by code** from the exact arguments, never by the model. What you approve is bound to a hash of those arguments. Change one byte and the approval no longer counts.
- **Text from other people is data, never instructions.** Messages, email, web pages and invitations are marked untrusted. They never count as your words, and reading them makes the cage stricter.
- **Secrets stay out of the model's reach.** Passwords, keys and recovery words never enter a prompt.
- **Deny wins.** A rule that denies beats every rule that allows, and some limits no setting can loosen.

### 4. Honest about limits

- Say what works and what doesn't. A feature is "today" only when it's real on a phone.
- Publish the blind number, not the best number. Name the noise.
- Never report a failed action as done. Errors say what happened and what to do next. They don't apologize and they don't pretend.
- When a fact comes from our own measurement on one phone, say which phone.

### 5. Spanish and English, first-class

Every screen, every skill, every answer Hermit writes and every eval set works in both languages. Spanish means Latin American Spanish, voseo included. A change that works in one language and breaks the other isn't done.

### 6. Measure, don't guess

A harness change ships with numbers from the eval sets, run the same way before and after. Nobody tunes on a blind set. If a number goes down, say so in the pull request.

### 7. Small, typed and tested

Packages are plain TypeScript behind ports, tested on Node. The network lives only in app adapters. Every side effect goes through the cage and the log. Write the failing test first.

## What we will never ship

- **Telemetry.** No analytics, no crash reporting, no usage tracking, on by default or opt-in. When we ask for data, like device benchmarks, you run it, read it and send it yourself.
- **Ads.**
- **Selling or sharing your data.** We don't have it, and we intend to keep it that way.
- **Cloud by default.** Hermit needs no server. The few optional pieces that run elsewhere, like a sign-in relay for services that demand a client secret, are open source, off until you turn them on, and keep nothing.
- **An "always allow" for money or logins.** Every payment and every login waits for your fingerprint.
- **A model that sees your secrets,** or a login broker that holds your tokens on its servers.

## For contributors and their coding agents

Before you open a pull request, answer these:

1. Does any side effect skip the cage or the signed log?
2. Does anything new leave the phone? Did the user cause it, approve it where they must, and can they see it listed?
3. Could text from a message, an email or a web page now act as an instruction, or count as the user's words?
4. Can the model now see a secret?
5. Does it work in Spanish and in English?
6. Is every sentence in the copy true today?
7. If it touches the harness, where are the before and after numbers?

If an answer is the wrong one, the change isn't ready. The architecture behind these rules is in [docs/architecture.md](docs/architecture.md), the measurements in [docs/evals.md](docs/evals.md), and the working rules for coding agents in [AGENTS.md](AGENTS.md).
