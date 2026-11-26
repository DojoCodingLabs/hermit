# Roadmap

Hermit is pre-alpha. This page says what we're working on and in what order, without dates. Work moves to the next band when it passes its bar on a real phone, not when a calendar says so. Priorities can change as we learn; when they do, this page changes in the same pull request.

Everything here has to fit [VISION.md](VISION.md): on the phone first, nothing out without consent, code-written approvals, honest numbers, Spanish and English.

## Now: make what works solid

What works today, on more phones and in more hands.

- **The everyday loop.** Chat, memory, reminders, the calendar, WhatsApp replies, mail, the vault with autofill, the night shift and its morning briefing, and the testnet wallet with x402 payments. Fewer rough edges, clearer errors, the same cage.
- **Preview APKs.** Preview APKs are published on GitHub Releases; the first one is coming soon. [How to install one](docs/devices.md).
- **The Device lab.** Speed and accuracy numbers from phones other than the one Hermit was tuned on, so the device-adaptive runtime learns from real hardware. [How to run it](docs/devices.md).
- **The harness.** Keep the blind score honest as the skill menu grows, and keep the first action under the 15-second bar on the phone.
- **Open development.** Contributor docs, a public issue tracker and a steady stream of good first issues.

## Next: several bots

Hermit becomes a small team that works for you, with Hermit coordinating it.

- **Specialized bots.** Each one with its own chat, role, notes and skills, listed like contacts, with Hermit at the top.
- **Permission modes.** You choose how much a bot may do on its own: **Ask** (the default), **Auto**, or **Don't ask** for people who accept the risk. Each mode explains what it allows before you turn it on. Payments and logins always wait for your fingerprint, in every mode.
- **Routines.** Bots that work on a schedule, asked for in plain words, with guards for battery and heat, and honest about when they ran and when they'll run next.
- **Bots that hand work to each other.** In the open, in the chat, and never as a way around the cage: a message from another bot is never your words.

## Later: a bigger shell

- **Boost.** A companion app on your own computer that runs a bigger model for heavy tasks. You pair it, you own it, and it never holds your keys.
- **iOS.**
- **Voice.** Voice notes in, spoken replies out, in both languages.

## On the bench

Parts of these already exist in the code as experiments. Each one moves to "works today" only when it holds up on a phone, in the evals and in the cage:

- **Reading and searching the web,** with the first visit to each site in a chat asking you first.
- **Tasks on websites** in an in-app browser, with every step that submits, books or signs in approved by you.
- **Connectors,** including MCP servers, and connectors Hermit drafts for you to review before anything is installed.
- **Opening your other apps** with the details filled in, so you finish the call, the route or the message there.

## Never

Telemetry, ads, selling data or cloud by default. The full list and the reasons are in [VISION.md](VISION.md#what-we-will-never-ship).

## Help shape it

- **Run the Device lab** on your phone: [docs/devices.md](docs/devices.md).
- **Open an issue** when something here looks wrong, missing or out of order.
- **Read the full product requirements** in [docs/prd/hermit-prd.md](docs/prd/hermit-prd.md) if you want the detail behind each band.
