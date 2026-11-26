# Roadmap

Hermit is pre-alpha. This page says what we're working on and in what order, without dates. Work moves to the next band when it passes its bar on a real phone, not when a calendar says so. Priorities can change as we learn; when they do, this page changes in the same pull request.

Everything here has to fit [VISION.md](VISION.md): on the phone first, nothing out without consent, code-written approvals, honest numbers, Spanish and English.

## Now: make what works solid

What works today, on more phones and in more hands.

- **The everyday loop.** Chat, memory, reminders, the calendar, WhatsApp replies, mail, the vault with autofill, the night shift and its morning briefing, and the testnet wallet with x402 payments. Fewer rough edges, clearer errors, the same cage.
- **Preview APKs.** A signed preview APK on [GitHub Releases](https://github.com/DojoCodingLabs/hermit/releases) for each step forward, so anyone can try Hermit without building it. The first, v0.1.0-preview.1, is out. [How to install one](docs/devices.md).
- **Google Play.** A Play Store listing next to the APKs on GitHub Releases, once Play's review accepts how Hermit reads notifications.
- **The Device lab.** Speed and accuracy numbers from phones other than the one Hermit was tuned on, so the device-adaptive runtime learns from real hardware. [How to run it](docs/devices.md).
- **The harness.** Keep the blind score honest as the skill menu grows, and keep the first action under the 15-second bar on the phone.
- **Open development.** Contributor docs, a public issue tracker and a steady stream of [good first issues](https://github.com/DojoCodingLabs/hermit/issues?q=is%3Aissue+is%3Aopen+label%3A%22good+first+issue%22).

## Next: several bots, and Boost

Two tracks, built at the same time. Hermit becomes a small team that works for you, with Hermit coordinating it, and gets a bigger shell on a computer you own.

**Several bots**

- **Specialized bots.** Each one with its own chat, role, notes and skills, listed like contacts, with Hermit at the top.
- **Permission modes.** You choose how much a bot may do on its own: **Ask** (the default), **Auto**, or **Don't ask** for people who accept the risk. Each mode explains what it allows before you turn it on. Payments and logins always wait for your fingerprint, in every mode.
- **Routines.** Bots that work on a schedule, asked for in plain words, with guards for battery and heat, and honest about when they ran and when they'll run next.
- **Bots that hand work to each other.** In the open, in the chat, and never as a way around the cage: a message from another bot is never your words.

**Boost** ([its issues](https://github.com/DojoCodingLabs/hermit/milestone/1))

- **Pairing.** A companion app on your own computer, paired with your phone directly over Holepunch, with a QR code and a 6-digit code. You pair it, you own it, and it never holds your keys.
- **A bigger model for heavy tasks.** The cage stays on the phone: you choose what may go to Boost, and Hermit shows you when a turn used it.
- **Open-ended web tasks** too big for the phone, on a computer you own.

## Later

- **iOS,** and Hermit on the App Store.
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
- **[Open an issue](https://github.com/DojoCodingLabs/hermit/issues/new?template=docs_or_cleanup.yml)** when something here looks wrong, missing or out of order.
- **Read the full product requirements** in [docs/prd/hermit-prd.md](docs/prd/hermit-prd.md) if you want the detail behind each band.
