# Mascots and characters in AI agents (research, 2026-11-09)

Input for the Hermit brand book. Hermit's mascot is a hermit crab in a spiral shell. The shell stands for privacy and the safety cage, a bigger shell stands for Boost, and a new phone means a new shell. The brand direction is "Quiet craft" with a "Deep sea" dark mode. Q11 chose a full mascot.

Markers used below:
- **[unverified]**: a claim I could not confirm from a primary or reliable secondary source.
- **[secondary]**: a claim that comes only from press or blog coverage.
- **[known]**: well-established background, not re-checked against a source for this note.

---

## Summary

- **Only some AI agents run a full mascot.** Of the agents compared here, Meta Muse (Jolly), OpenAI dots, and OpenClaw (Molty, the lobster) are true full mascots.
  - xAI's Grok Bot has a *system* of status avatars rather than one character.
  - Hermes Agent has *optional* cosmetic pets, off by default, chosen from 3,200+ community sprites.
  - I found **no mascot** for Atomic Agent (its mark is an abstract blue tile), for Instinct (deliberately no app and no character), or for Underdog (it names things after dogs, "Woof" and "Husky", but I found no visual dog). Full mascot is still a sound choice for Hermit, but it is not unanimous. The privacy-first, local-first players (Instinct, Underdog, Atomic) mostly went *without* one.
- **2026 consumer agents use mascots to borrow trust.** Jolly and dots both launched in September 2026, explicitly to make handing over email and payments feel safe. The press response was split: kawaii appeal on one side, and on the other "infantilising", "cursed", Clippy comparisons, and an FTC complaint from Fairplay about childish iconography.
- **The best-executed agent mascots make the character a status display.** Grok Bot's avatar shows idle, thinking, working, waiting, blocked, and done. Hermes pets have six states. OpenClaw's lobster paces when the gateway disconnects and keeps vigil on long runs. All of them keep text as the source of truth.
- **The crustacean collision is real and specific.** OpenClaw's lore uses shell metaphors Hermit wanted for itself: "molting is growth", "New shell, same lobster", and lobsters that shed and come back "noticeably bigger". OpenClaw also has sleeping lobsters in its memory view, night-shift yawning, and a pixel-lobster icon. Rust's Ferris (an orange crab) is also iconic among developers. Hermit has to differentiate by **silhouette (shell-first, crab mostly hidden), color (no red or orange), temperament (quiet, not chaotic), and behavior (shell-swapping and closing the door, never molting)**.

---

## Per-product table

| Product | Mascot? / name | Form and style | Personality | Where it appears | User customization | Trust, safety and capability signals |
|---|---|---|---|---|---|---|
| **Meta Muse** (US launch Sept 8, 2026) | Yes. Default character **"Jolly"** | A fuzzy ivory egg with small black eyes and rosy cheeks. Plush, toy-like, compared to Labubu [secondary]. Animated | Cute, "kawaii", soft. Jolly "does no work of its own"; Muse does the work [secondary] | The Muse app, web, WhatsApp, Oakland billboards, and the **Muse Charm** keychain (about 2" screen, ships Dec 2026, designed under Alan Dye) | Yes, heavily. Users name the agent, pick an avatar (a mango, a labradoodle, toast in sunglasses), and change clothes and voice. Muse Realtime Avatar (Nov 5) lets users turn it into a person, animal or other character | Uses baby-schema ("Kindchenschema") on purpose to make the technology easier to accept. Critics call it infantilising and cursed, Fairplay asked the FTC to investigate childish mascots, and Fortune compared it to Clippy. Trust rests on architecture claims (a sandboxed computer, a "Sentinel" agent), not on the mascot |
| **OpenAI dots** (Sept 29, 2026) | Yes, a crew. Default **"Dottie"** (a green bean). Also **Alfred** (a yellow pear) and **Felipe** (a blue cloud) [secondary] | "Bubbly", cartoonish floating blobs, "like gummy candy" (Gizmodo). Accessories: berets, glasses, bow ties [secondary] | Office-minded, the "cool" movie assistant (per Altman) [secondary] | ChatGPT, Codex, Slack, Teams, phone calls. The primary dot plus "specialist dots" that act as a team | Name, shape, color, eyes, glasses, accessories, changeable any time | Each dot carries its own identity, credentials, and tools, so the character maps to a permission scope. Agent 365 security controls. The mascot lowers the barrier ("have you tried dots?") |
| **xAI / SpaceXAI Grok Bot** (beta Aug 11, 2026) | Not a single mascot. **Each bot has a name, avatar and title** | One construction (simple shapes and expressive eyes) with controlled variations and accessories. The team tested initials, emoji, pixel, line art, silhouettes and identicons, and rejected watercolor and clay as too detailed at sidebar size | Calm and "slightly curious" at rest | The sidebar and chat. Hover shows the current action | Per-bot identity. Details of user-driven customization are [unverified] | **The avatar is the status indicator**: idle, thinking, working, waiting, blocked, done. Motion gives "the first bit of reassurance". The best reference for Hermit's state system. (Grok's separate companions, Ani and the red panda Rudi, drew NSFW and kids-safety criticism. Avoid that association.) |
| **OpenClaw** (formerly Clawdbot, then Moltbot) | Yes. **Molty**, a "space lobster", pronouns they/them. 🦞 | Flat 2D vector: a red gradient body (#ff4d4d to #991b1b), two big claws, antennae, round dark eyes, front-facing. A **16×16 pixel-lobster** SVG for small sizes. Terminal banner. A light and dark palette | Enthusiastic, overeager, "possibly too powerful", in-joke heavy ("EXFOLIATE!", "The claw is the law", "New shell, same lobster") | README banner, the docs "Lore" page, status pages (it bobs while busy and looks down at the button on error), the Control UI composer as a *visiting* critter, sleeping in the Memory "dream scene", the CLI banner, Android, Linux, and Discord culture (the "Moltiverse") | Random per-visit variants (color, size, claw proportions, accessories, personality), hats from a catalog (fedora, crown, santa, party, pumpkin), plugin themes with SVG hats and visitors, and a local **Lobsterdex** collection | **Honest framing:** "the lobster was never your only source of truth". It paces worriedly on a gateway disconnect and keeps vigil on long runs. **Privacy:** all randomness and the Lobsterdex are local, and "No lobster data leaves your machine". A Visits toggle and reduced-motion support. Cautionary tale: 20+ AI-generated icon iterations produced the "Handsome Molty" human-faced lobster, which crypto scammers memed within minutes |
| **Atomic Agent** (atomicagent.io, AtomicBot-ai) | **No mascot found** | A blue (#006AFF) rounded-square app tile with an abstract white plus/star glyph | n/a | Logo in the header, footer and benchmarks. The README uses a demo GIF | n/a | It signals capability through benchmarks (GAIA L1 69.8%) and "state on your disk" badges. The claim that Atomic went full mascot is **[unverified]**. It may be a confusion with Atomic Bot, a one-click OpenClaw wrapper that inherits the lobster context |
| **Hermes Agent** (Nous Research) | **Optional pets** (since Jun 24, 2026), not a brand mascot | Small animated sprites from the community **petdex** gallery (3,200+). Rendered as half-block art in basic terminals | Varies by sprite | CLI, TUI, desktop app. Can detach into an always-on-top floating window with speech bubbles and a mail icon when a task finishes | Full: `hermes pets install/select`. Off by default | Six states: idle, running, thinking, wave (turn ended), jump (plan done), failed. Docs stress "no effect on tokens, caching or agent behavior": purely cosmetic |
| **Instinct** | **No mascot**, on purpose | n/a, no app. It works over SMS and iMessage, with a Mac app in progress | n/a | n/a | n/a | Reviewers contrast it with "Muse's cuddly bear mascot and dots' anthropomorphized blobs". The absence of a character *is* its positioning: serious and invisible. Calling Jolly a "bear" is one reviewer's wording |
| **Underdog** (Conway Research) | **No visual mascot found** [unverified]. Verbal dog theme only: the "Underdog" name, the **Woof** model (4B on-device; also a 31.7 MB browser speech model released Nov 6), and the **Husky** inference engine | Unknown | The underdog stance: private, never ad-supported. "Why should using AI require surrendering your private information?" | n/a | n/a | Trust comes from on-device processing, encrypted credentials, an App Defense Alliance assessment (a company claim), and a payment-fee business model. The *closest competitor in positioning* to Hermit, and it carries its theme through naming, not a drawn character |
| **Duolingo**: Duo the owl [known] | Yes | Flat, geometric, rounded vector. Redesigned around 2019 for a wider range of expressions and easier animation. Rive state machines drive the character animation and lip-sync | Cheeky, guilt-trippy, meme-native | App, push notifications, TikTok, merch, "Duo is dead" stunts | Users customize their own avatars, not Duo | Proves that a mascot can carry a brand's entire voice. It also shows the risk of a passive-aggressive persona becoming the joke |
| **GitHub**: Octocat [known] | Yes | Flat cartoon (a cat with octopus legs). Originally Simon Oxley stock art | Neutral and versatile | Logo, 404 pages, the **Octodex** (hundreds of variants), stickers, swag | Official variants only, though the community makes fan art | The variant library is a community engine. One base silhouette with endless costumes |
| **Docker**: Moby Dock | Yes | Flat whale carrying containers. Name chosen by community vote (Sept 2013, 411 votes) | Friendly, workhorse | Logo, conferences, plush. Docker even adopted a real whale, "Molly Dock" | n/a | The metaphor carries the product: the whale ships the containers, so the shape explains the capability |
| **Go**: the gopher | Yes | Hand-drawn character by Renée French | Goofy, lovable | Docs, conferences, user-group mascots, plush | **CC BY 4.0**. Anyone can adapt it with credit to Renée French. Official plush and vinyl designs are protected | The model for open-source fan art: a permissive license on the artwork plus "accept no substitutes" on official products |
| **Linux**: Tux [known] | Yes | Penguin drawn by Larry Ewing (1996, GIMP) | Content, well-fed | Everywhere: distros, boot logos, merch | Free use with attribution, endless remixes | Proves a mascot can outlive and outscale any company. Community ownership |
| **Microsoft**: Clippy [known] | Yes | 2D animated paperclip (Office 97) | Eager and interruptive | Popped up unsolicited inside documents | Alternate "assistants" (a dog, Einstein…) | **Cautionary tale.** Interrupting users, guessing intent ("It looks like you're writing a letter"), and offering no off switch made it a punchline. Disabled by default in 2001 and removed in 2007. Fortune revived the comparison for Jolly and dots: "Clippy asked whether you were writing a letter. Jolly and the dots mail it." |

---

## Patterns that work (and why)

1. **The mascot is a status display, not decoration.** Grok Bot, Hermes and OpenClaw all tie the character's motion to agent state. People most want to know whether the agent is still working, waiting on them, or stuck. A character answers that at a glance, at sidebar or notification size, where a text label doesn't fit. This is where a mascot earns its pixels in a capable agent.
2. **One construction, controlled variation.** Grok Bot ("recognizable at a glance without appearing to come from a different visual world"), the Octocat in the Octodex, and OpenClaw's hats all keep a fixed skeleton and vary only costume or color. Customization feels personal and the brand stays recognizable.
3. **The character never becomes the only channel for the truth.** OpenClaw says it outright: the status dot keeps working even with lobster visits off. Hermes: pets don't affect agent behavior. For a safety product this is non-negotiable. Approvals, blocks and errors are always explicit text first, with the character as emotional reinforcement.
4. **The metaphor explains the capability.** Docker's whale carries containers, and dots map one dot to one credential scope. Mascots work best when the shape is the product's mental model. Hermit has an unusually strong one: shell = protection, bigger shell = more power, new shell = new device.
5. **Rarity and respect beat ubiquity.** OpenClaw: "The lobster is a guest, not furniture." Half of all sessions get no visit, dismissals make it "more wary", there is an off toggle, and reduced-motion users get static versions. This is the anti-Clippy design.
6. **Local-only delight.** OpenClaw keeps all mascot randomness and collection state in the browser, and says so. A privacy brand can make delight *prove* the privacy promise.
7. **An open license drives community.** The Go gopher (CC BY 4.0) and Tux (free with attribution) became culture because people were allowed to remix them. Octocat-style variant libraries feed stickers and swag.
8. **A persona separate from the engine.** Jolly "does no work", and Grok Bot's companions are modes on one model. The face can evolve without implying a change in what the agent can do.

## Pitfalls

1. **The Clippy effect.** Unsolicited pop-ups, guessing intent, and no off switch. The 2026 version is worse: a cute face on an agent that *acts* (sends, buys). The fix is a character that speaks only when spoken to or when state changes, plus a global "Quiet mode" toggle.
2. **Childishness undermining trust (the baby-schema backlash).** Jolly drew "infantilising" (Creative Bloq), "cursed" (PC Gamer), an FTC complaint from Fairplay ("a cartoon character speaks to a six-year-old before it speaks to a thirty-year-old"), and Labubu jokes. For an agent that holds your email, passwords and payments, cute has to read as *competent* cute: calm eyes, purposeful posture, no rosy cheeks, no baby-talk copy.
3. **Uncanny 3D and plush rendering.** Plush and clay looks age badly, fail at 16 px, and invite creepy AI-generated variants. Grok Bot rejected clay and watercolor because they were too detailed at small sizes. "Quiet craft" points to flat vector plus editorial illustration, not 3D.
4. **AI-generated mascot drift.** OpenClaw's "Icon Generation Saga" produced 20+ "increasingly cursed" lobsters and a human-faced one that scammers memed instantly. Never let an image model be the source of truth for the character. Keep a hand-drawn master vector and a construction sheet, and use AI only for mood exploration.
5. **IP sameness (crustacean crowding).**
   - **OpenClaw** is a red, front-facing lobster with two big claws and antennae. Its lore *already owns* molting-as-growth, "New shell, same lobster", shedding to get "noticeably bigger", sleeping lobsters in the memory view, and night-shift yawns. A Hermit "bigger shell = Boost" story will be read as derivative unless it is visually and verbally distinct.
   - **Ferris** (Rust's orange crab) is iconic among developers [known].
   - Anthropic's Claude Code terminal mascot is reportedly a small orange pixel creature [unverified, check].
   - OpenClaw also has a 16 px pixel lobster, so a pixel crab would collide on the exact surface where Hermit is smallest.
6. **Customization that leaks.** Meta syncs the name and avatar across platforms. For Hermit, any customization that syncs or phones home contradicts "Tells no one".
7. **Persona sexualization and scandal adjacency.** Grok's companions (Ani) show that "character" can slide into companion or romance territory. Hermit's crab is a craftsman, not a companion.
8. **Scam magnets.** OpenClaw's mascot meme was instantly turned into a fake coin. An open-source mascot needs a clear "Hermit has no token" line in the README from day one.

---

## Recommendations for Hermit

### Name

- **Recommended: the crab is simply "Hermit".** The product, the agent and the character share one name, the way Docker's whale is just "the Docker whale" in daily use. This avoids a second name to clear (HERMIT name clearance is already open, see open questions). It also matches the product voice: one agent, quiet, singular.
- **Optional local renaming.** As with Muse and dots, the user can rename *their* crab, stored on-device only and never synced. The brand keeps "Hermit".
- **If a separate character name is wanted, LATAM-friendly options** (all [unverified] for trademark):
  - **Ermi** (from Spanish *ermitaño*): short, warm, works in English and Spanish.
  - **Pagu** (from *paguro*, Spanish and Italian for hermit crab): playful, unique.
  - **Nácar** (mother-of-pearl, the inside of the shell): elegant, suits "Quiet craft", but harder in English.
- **Avoid** "Molty", "Claw", "Pinch", "Snip" and anything molt- or claw-based, which is OpenClaw territory.

### Personality (5 traits)

1. **Discreet.** It says little, never gossips, and keeps its door shut. The tagline in character form.
2. **Capable craftsman.** Competent and unhurried, proud of tidy work. Not a pet, not a baby.
3. **Wry and dry.** A quiet sense of humor, a raised eye-stalk rather than a shout. The opposite of OpenClaw's "EXFOLIATE!" chaos.
4. **Loyal homebody.** Attached to *your* phone, its home. It travels light and moves house carefully.
5. **Principled.** When the cage blocks something, it is firm and calm, not apologetic or scared.

### Visual rules

- **Silhouette: shell-first.** The spiral shell is the dominant shape and *is* the logo mark. The crab is mostly hidden: eye stalks and one oversized claw peek from the aperture, seen in **3/4 or side view**. This is the opposite of OpenClaw's front-facing, two-claw, body-forward lobster.
- **Anatomy as a differentiator.** Real hermit crabs have **one large and one small claw**, and they **seal the shell opening with the big claw**. That asymmetry is unique to Hermit's silhouette and gives a perfect "blocked by the cage" pose.
- **Color.** The shell is warm paper or ink with a **sea-glass teal** spiral line, and the crab is muted sand or ink. **No red, orange or coral**, which belong to OpenClaw and Ferris. In Deep sea mode, a faint bioluminescent teal glow traces the spiral and eyes.
- **Style.** Flat 2D vector, a single ink line weight, minimal fills, built from geometry (a logarithmic spiral, circles for the eyes). For marketing hero art, an editorial "naturalist engraving" variant (cross-hatching, field-notebook labels) fits "Quiet craft" and is far from Jolly's plush and dots' gummy look.
- **No 3D, no plush rendering, no pixel art as the primary style.** A 1-bit terminal glyph is fine for a CLI.
- **Size ladder (each size is drawn, not scaled):**
  - **16 px:** the spiral only, one continuous teal stroke plus one eye dot at the aperture.
  - **24–48 px:** shell plus two eye stalks.
  - **64–128 px:** shell, eyes, big claw.
  - **256 px+:** legs, expressive eyebrows (eye-stalk tilt), props.
- **Expression budget.** Emotion comes from eye-stalk angle and height, claw position, and how far the crab is out of the shell. **How far out of the shell = how open or exposed**, a direct, readable privacy dial. No mouth, or a minimal one at large sizes only. No blush, no tears.
- **Motion.** Small and slow: settles, peeks, taps the shell. Ship a reduced-motion static for every state. Build with Rive or Lottie state machines (Duolingo's Rive approach) so one rig drives every state.
- **Master files.** A hand-drawn vector master plus a construction sheet. AI image generation is for exploration only, never final art (the "Handsome Molty" lesson).

### Product states (pose list)

The text status is always shown alongside. The crab never replaces it.

| State | Pose | Notes |
|---|---|---|
| Idle / ready | Half out of the shell, eye stalks up, relaxed | The default avatar |
| Thinking | Eye stalks slowly sweep, small claw taps the shell rim; the spiral line animates inward | The spiral "winding" doubles as a progress glyph |
| Working (tool running) | Out further, big claw busy (carrying a tiny item) | Distinct from thinking |
| Asking approval | Fully out, faces the user, holds the item up in the big claw, one eye stalk raised | The only pose where it looks *at* the user. It must be paired with an explicit approve/deny sheet |
| Done | Sets the item down, small satisfied nod, settles back to half-in | Calm, not confetti. Celebrate only at big milestones |
| Error / failed | Eyes droop, looks at the item on the ground | Honest and non-dramatic |
| Blocked by the cage | **Withdraws, big claw seals the aperture**; a teal ring pulses once on the shell | Signature pose. Firm, not scared. Copy explains what was blocked and why |
| Offline / airplane | Fully inside, shell closed, a small "moon" or calm-water line; still functional | Reinforces that Hermit works offline. Do not show this as a failure |
| Sleeping / night shift | Inside, eye stalks curled, faint glow in dark mode; a "Zz" is optional and subtle | OpenClaw has night yawns, so use the shell-as-bed image, not yawns |
| Boost (bigger shell) | Walks from the small shell to a larger shell beside the computer and peeks out from it | Use **shell-swapping**, never molting or growing. Optional extra: a "vacancy chain" of crabs lining up by size |
| Changing phones | Carries its belongings from the old shell to a new one; the old shell is left empty and clean | Signals that nothing is left behind |
| Remembering | Tucks a small pearl or pebble into a spiral chamber of the shell | The shell chambers act as memory |
| Forgetting | Takes the pearl out and lets it dissolve or sink into the water; the chamber is visibly empty | Must look deliberate and complete: trust in deletion |
| Listening (voice) | Eye stalks lean toward the mic, gently | |
| Quiet mode on | Shell only, no crab | The crab's absence *is* the setting |

### Customization that respects privacy

- **Shell skins, not crab skins.** Real hermit crabs adopt found objects as shells, so skins are lore-true. The crab body stays canonical (the Grok Bot "one construction" rule). Examples: a ceramic cup, a bottle cap, a snail shell, a tiny lighthouse, a mate gourd, a coffee can.
- **Rules:**
  - All customization is stored on-device, never synced and never reported.
  - No paid skins at launch, and never unlocks that require sharing data.
  - Skins may never hide the eye stalks, the big claw or the aperture, because they carry state.
  - A *collection* mechanic would echo OpenClaw's Lobsterdex, so avoid "-dex" naming. Offer a simple "Shells" drawer instead.
- **Local renaming only.** The user's name for the crab stays local.
- **Seasonal shells** are shipped in app updates (not fetched live), so no network call reveals usage.

### Stickers and community (LATAM, WhatsApp)

- **WhatsApp pack specs** (from the official WhatsApp/stickers README):
  - 3–30 stickers per pack, each exactly 512×512 WebP.
  - Static stickers ≤100 KB, animated ≤500 KB, animation ≤10 s.
  - The first frame must work as the full sticker.
  - Tray icon 96×96, ≤50 KB.
  - Up to 3 emoji tags per sticker.
- **First pack (about 24 stickers), Spanish and Portuguese first.** Everyday reactions, not ads. Examples:
  - "No le cuento a nadie 🤫" (the tagline as a sticker)
  - "Ya está" (done)
  - "¿Seguro?" (approval face)
  - "Hoy no salgo" (fully inside the shell)
  - "Me mudo" (shell swap)
  - "Lo olvidé, como pediste" (forgetting)
  - "Modo avión", "Visto 👀" (eye stalks), "Buenas noches", and the claw-closes-the-door sticker for "no".
- **The irony is an asset:** stickers about privacy shared inside a Meta app. Keep the art brand-pure, with no claims about WhatsApp integration.
- **Open license the character art under CC BY 4.0** (the Go gopher model) so fan art, memes and user-group crabs can spread. Keep the wordmark and logo mark trademarked, and sell any official plush and merch as "accept no substitutes".
- **Community motif.** The hermit crab *vacancy chain* (crabs line up by size to trade shells) works as a contributors-wall illustration and a "pass it on" referral visual.
- **README line from day one:** "Hermit has no token or coin." (OpenClaw's scam lesson.)

### Open questions surfaced by this research (to log, not yet decided)

1. **Revisit Q11's rationale?** Of the AI agents compared here, only three (Muse, dots, OpenClaw) run full mascots. Atomic, Instinct and Underdog have none, Grok Bot uses status avatars, and Hermes has optional pets. Full mascot can stand, but should Hermit adopt OpenClaw-style restraint (a guest, not furniture, with a Quiet mode)?
2. **Does the crab get its own name** ("Hermit" vs Ermi / Pagu / Nácar)?
3. **Character art license:** CC BY 4.0 for the art plus a trademarked logo?
4. **Avoid all molting language** and replace any "bigger shell" copy that echoes OpenClaw's "New shell, same lobster"?

---

## Sources

**Meta Muse / Jolly**
- Axios, Meta debuts Muse: https://axios.com/2026/09/08/meta-debuts-muse-personal-ai-agent
- Axios, Meta gives Muse an adorable mascot (could not fetch, 403): https://axios.com/2026/09/25/ai-doom-meta-muse-mascot
- TechCrunch, Muse launch and trust: https://techcrunch.com/2026/09/08/meta-debuts-its-muse-ai-agent-will-consumers-trust-it/
- TechCrunch, Muse Charm and bag-charm trend: https://techcrunch.com/2026/09/24/metas-muse-charm-looks-like-a-tamagotchi-but-its-tapping-into-a-much-newer-trend/
- TechCrunch, Tamagotchi-like wearable: https://techcrunch.com/2026/09/23/meta-made-a-tamagotchi-like-wearable-for-its-muse-ai-agent/
- Dezeen: https://dezeen.com/2026/09/25/meta-debuts-tamagotchi-style-ai-agent
- Fast Company, kawaii era: https://www.fastcompany.com/91612532/with-metas-muse-charm-ai-enters-its-kawaii-era
- Creative Bloq, "infantilised": https://www.creativebloq.com/ai/metas-new-ai-avatar-is-making-me-feel-infantilised
- PC Gamer critique: https://www.pcgamer.com/software/ai/i-want-to-punt-metas-muse-ai-mascot-back-into-the-cursed-void-from-whence-it-came/
- Gadget Review, Realtime Avatar: https://www.gadgetreview.com/?p=427059

**OpenAI dots**
- TechCrunch: https://techcrunch.com/2026/09/29/openai-launches-dots-its-bubbly-agentic-avatar/
- Fast Company (could not fetch, 403): https://www.fastcompany.com/91615068/openai-dots-agent-crew-of-friendly-mascots
- Semafor: https://www.semafor.com/article/09/29/2026/openai-unveils-its-muse-competitor-dots
- Jolly vs dots roundup (Lorenz, System1, BU, Fairplay, Fortune quotes): https://pasqualepillitteri.it/en/news/20242/meta-openai-cute-mascots-ai-agents-jolly-dots

**Grok Bot**
- xAI, Designing Grok Bot: https://x.ai/news/designing-grok-bot
- 9to5Mac: https://9to5mac.com/2026/08/11/grok-bot-is-an-all-new-iphone-and-mac-app-from-spacexai-and-cursor/
- Unite.AI: https://www.unite.ai/xai-launches-grok-bot-always-on-ai-teammates-with-their-own-cloud-computers/
- Grok companions coverage: https://www.bloomberg.com/opinion/articles/2025-07-18/elon-musk-s-grok-chatbot-is-cashing-in-on-ai-romance

**OpenClaw**
- README: https://github.com/openclaw/openclaw
- Lore: https://docs.openclaw.ai/start/lore
- The Lobster (docs/web/lobster.md): https://github.com/openclaw/openclaw/blob/main/docs/web/lobster.md
- Mascot source: https://github.com/openclaw/openclaw/blob/main/src/shared/openclaw-mascot.ts and https://github.com/openclaw/openclaw/blob/main/ui/src/components/mascot-pose.ts
- Pixel lobster: https://github.com/openclaw/openclaw/blob/main/docs/assets/pixel-lobster.svg

**Atomic Agent**
- README and logo: https://github.com/AtomicBot-ai/atomic-agent
- Site: https://atomicagent.io
- Atomic Bot: https://apps.apple.com/us/app/atomic-bot/id6759154616

**Hermes Agent**
- Decrypt: https://decrypt.co/372026/your-hermes-agent-now-pet
- GN Crypto: https://www.gncrypto.news/news/hermes-agent-3200-animated-pet-mascots/

**Instinct**
- Instinct vs Muse: https://www.progressiverobot.com/2026-10-09/instinct-vs-muse-buzziest-ai-agent-survive-meta-hands-on/
- Built In: https://builtin.com/articles/instinct-ai

**Underdog**
- TechCrunch: https://techcrunch.com/?p=3174503
- a16z: https://a16z.com/announcement/investing-in-conway-the-creator-of-underdog/
- AI Weekly, Woof speech model: https://aiweekly.co/alerts/underdog-demos-browser-native-woof-a-317mb-31m-param-speech-and-music-model
- Runtime Wire: https://runtimewire.com/article/conway-underdog-on-device-ai-payment-fees

**Older references**
- Go gopher: https://go.dev/blog/gopher
- Duolingo redesign: https://www.designweek.co.uk/issues/2-6-january-2019/duolingo-owl-receives-makeover-as-app-becomes-more-gamified
- Duolingo + Rive: https://rive.app/blog/duolingo-s-ai-powered-video-call-brings-lily-to-life
- Docker whale: https://www.networkworld.com/article/2942838/docker-the-container-company-with-a-whale-of-a-logo-adopted-a-real-whale.html
- Docker trademark guidelines: https://www.docker.com/legal/trademark-guidelines/
- Octodex [known]: https://octodex.github.com
- Tux [known]: https://en.wikipedia.org/wiki/Tux_(mascot)
- Clippy [known]: https://en.wikipedia.org/wiki/Office_Assistant
- Ferris [known]: https://rustacean.net

**WhatsApp stickers**
- Official spec: https://github.com/WhatsApp/stickers/blob/master/Android/README.md
