# Hermit brand book (v1, November 2026)

The visual book is `index.html` in this folder. To view it, serve the folder (`python3 -m http.server`) or open the file. This file holds the same rules in plain text, for developers and coding agents.

## Idea
- Hermit is a hermit crab that carries its home and keeps to itself.
  - The shell is the phone and the safety cage.
  - A bigger shell is **Boost**.
  - Changing phones is changing shells.
- Hermit **never molts, sheds or grows**. That language is OpenClaw's. Hermit only swaps shells.

## Voice
| Line | Copy |
|---|---|
| Tagline | Does everything. Tells no one. |
| Proof | Don't trust us. Read the code. |
| Category | The in-house agent. |
| Boost | Give Hermit a bigger shell. |
| Movement | Anti UI. UX Club. |

- **Language:** English only for brand materials (Q12).
- **Personality:** discreet, capable, dry, a loyal homebody, principled.
- **Errors:** they don't apologize. They say what happened and what to do.
- **Banned words:** "magic", "smart", "powered by AI", "your data is safe with us". There is no "us"; it's your phone.
- **Honest exceptions,** always stated where they apply:
  - WhatsApp sends your WhatsApp replies.
  - Calendar events sync wherever your calendar syncs.
  - The model downloads once.

## Logo
- **Source of truth:** the reference drawing, `logo/source/reference-drawing.png`. `scripts/brand/logo_from_trace.py` traces it into the vector files in `logo/`. Never redraw the logo by hand or with an image model.
- **What it is:** a hermit crab peeking out of its shell. A solid shell with the spiral cut out, a domed head with two dot eyes, two claws and two legs, in one color, with thin paper gaps between the pieces.
- **Files:**
  - `symbol-ink` and `lockup-ink` for paper and white;
  - `symbol-paper` and `lockup-paper` (reversed) for ink and photos;
  - `symbol-foam` and `lockup-foam` for Deep sea;
  - `wordmark-*` alone;
  - PNGs in `logo/png/`.
- **One color only.** No gradients and no second color inside the mark.
- **Clear space:** the head's height on every side.
- **Minimum size:** 24 px; below that, use the app icon.
- **Don't:**
  - recolor it red, orange or coral;
  - fill the paper gaps;
  - stretch, rotate, outline or add shadows.

## Signature
Use it everywhere Hermit credits itself (README, website footer, app About screen), verbatim:

> Hermit, built by Dojo Coding (dojocoding.io). Powered by QVAC (qvac.tether.io) from Tether (tether.io).
> Hermit is an independent project, not affiliated with or endorsed by Tether.

- **Logos:** always the three logos together, in this order: Dojo Coding mark, QVAC, Tether (`partners/`).
- **Surfaces:** on light surfaces use `qvac-logo-ink.svg` and `tether-logo-ink.svg`; on dark surfaces use the originals.
- **Before going public:** get Tether's written approval for the QVAC and Tether logos (Q14).

## Color
Tokens are in `tokens.json`, with WCAG contrast ratios.
- **Light (Quiet craft, master):** paper `#F5EDE1`, shell `#EBDDCB`, stone `#D3C2AE`, sand `#D5B893`, ink `#2B221B`, ink-soft `#6B5E52`, seaglass `#4F7C6D`, seaglass-deep `#3B6456`, coral `#B4483A`, amber `#8A5912`.
- **Dark (Deep sea):** abyss `#06121D`, trench `#0D2233`, current `#1A4A5E`, kelp `#8FA9B5`, foam `#E7F1F0`, glow `#5EF0CF`, coral `#FF8A7A`, amber `#F2B65A`.
- **Meaning:**
  - sea glass = Hermit;
  - amber = needs your approval;
  - coral = blocked by the cage.
- **Use limits:**
  - Seaglass `#4F7C6D` is 4.1:1 on paper, so it's for large text and fills only. Use seaglass-deep for small text and buttons.
  - Glow is an accent, never a large surface.

## Type
All three are SIL OFL and self-hosted in `fonts/`:
- **Newsreader:** headlines, taglines, long reading.
- **Instrument Sans:** UI, body, the wordmark.
- **JetBrains Mono:** hashes and code.

## Character
- **The logo is the character.** `scripts/brand/mascot.py` splits the reference drawing into its real pieces (the shell, the head with its inner legs, the outer leg, two claws, two eyes) and traces each once, into `mascot/parts.json`. Every pose only moves, rotates or swaps those exact pieces, so the mascot always is the logo's crab.
- **Files:** `mascot/rig/*.svg` (ink and `-dark` foam), PNGs in `mascot/png/`.
- **Sheets:** `masters/character-master.png`, `mascot/expressions-a.png` (states 1-8), `mascot/expressions-b.png` (9-15), laid out by `scripts/brand/compose.py`.
- **Rules:**
  - One color: ink on paper, foam on Deep sea. Sea glass only on small props (a pearl, the moon, a mic).
  - Pieces never touch: when a claw or prop moves over the shell, it cuts its own paper gap. Eyes seen against the shell are cut out of it, like the spiral.
  - Two dot eyes, two claws, two legs. No mouth.
  - When it retreats, it tucks into the shell and the claws close the door, as real hermit crabs do.
  - Never redraw it with an image model.
- **The 15 states:**
  1. idle (the logo)
  2. thinking
  3. working (holds the task)
  4. asking (holds up the envelope)
  5. done
  6. error
  7. **blocked** (tucked in, claws shut the door)
  8. offline
  9. sleeping
  10. Boost (a bigger shell)
  11. new phone
  12. remember (a pearl)
  13. forget (bubbles)
  14. listening
  15. Quiet mode (the empty shell)
- **Text first:** the character never replaces text. Quiet mode hides it.

## Interface
- **Talk first, tap if you need to.** The conversation is the interface; screens are the fallback.
- **The approval sheet shows the exact action,** rendered by the app and never by the model, plus why Hermit suggested it.
- **Anything that leaves the phone needs a fingerprint.**
- **Activity shows the signed audit chain** with "Chain verified".
- **Specs:** radius 18 for bubbles, 16 for cards, 28 for sheets, pill buttons. Spacing scale 4/8/12/16/24/32/48/64.
- **Mockups:** `ui/`. App icons: `icons/`.

## Assets and provenance
- **Generation:** illustrations and mockups were generated with `gpt-image-2.6-sunburst` via `scripts/brand/gen.py`. Every image has a sidecar `.json` with the exact request, and prompts are in `prompts/`. The method is in `prompting-playbook.md`.
- **Masters first:** lock the vector symbol and the character sheet, then pass them as references to everything else.
- **Before launch:**
  - redraw the character as vector and rig the 15 states (Rive or Lottie);
  - export stickers to WhatsApp spec (512×512 WebP, ≤100 KB);
  - clear the name (open question).
- **Research behind these choices:**
  - `docs/research/mascots.md`
  - `docs/research/atomic-agent.md`
  - moodboards in `explorations/`
