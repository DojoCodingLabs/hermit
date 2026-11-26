# Polish round: audit

What makes today's app look generic or unfinished, where it shows, and the fix. Measured on every screen the preview harness renders (`apps/mobile/preview`, 95 states, light and dark, es-419; the core states in English too): 228 pictures, 0 render errors, kept as the "before" set in `docs/design/polish/shots/before/` (gitignored). Decisions behind the fixes are in `decisions.md`.

Verdict: the screens are honest and complete, but they are built from four generic parts (an outlined pill, a brown 1px box, a paragraph, a line icon) repeated everywhere, in the phone's fallback fonts, with nothing that moves. That combination is what makes an app look generic.

## Phase 1: issues found, by area

| # | Issue | Where (state names from `shots.mjs`) | Fix (phase 1 builds the system; phase 2 rolls it out) |
|---|---|---|---|
| | **Type and words** | | |
| 1 | **System fallback fonts on every screen** | Every screen: the titles fall back to the phone's serif (Times-like), the interface to stock Roboto (the Mac's system face in the renders). | The brand faces bundled as static TTFs: Newsreader at a display optical size, Instrument Sans 400/500/600, JetBrains Mono 400/500, embedded at build time. |
| 2 | **Paragraphs where one line would do** | Payment sheet: three caption paragraphs above the button (who signs, the fingerprint screen repeats the amount, the second fingerprint) plus the foot line. Same on `merchant`, `credential`, `fill-login`. Paragraph under the title on memories, briefing, wallet (`payInChat`, `testnet`, `noRecovery` all at once), night, MCP, use, privacy, web tasks, caps, and a description under every settings section. | One short line per security fact, the long version behind an info button in a sheet. Section descriptions go. Kept facts are listed in `decisions.md`. |
| 3 | **Absolute timestamps** | "20 nov 2026, 7:13:43 p.m.", "Guardado el 16 de noviembre de 2026 a las 9:13 p.m." | Relative dates ("hace 5 min", "ayer, 19:10", "lun 17 nov") from one helper, absolute on the detail screen. |
| 4 | **Inconsistent quotes** | Straight quotes in 26 copy strings ("Dentista"), « » in memories, messages and the page reader, none elsewhere. | “ ” in both languages, from one helper; copy strings updated in phase 2. |
| | **Surfaces** | | |
| 5 | **Every surface on one plane** | Groups, cards, inputs and sheets are `shell` boxes or brown `stone` 1px outlines on `paper`; the sheet is a slightly different beige with a 1px border; no surface sits above another. | Four layers from the tokens: canvas, raised (groups and cards, lighter than the canvas), overlay (sheets) and sunken (fields, tracks). Hairline separators. Soft tinted shadows on raised and overlay; elevation tints in Deep sea. |
| 6 | **Outlined text fields** | 1.5px brown outlines on every input (caps, payees, MCP, profile, vault item, night times). | Sunken filled fields with a focus ring in the accent; label above, never a placeholder as label. |
| 7 | **Cards nested in cards, notes in boxes** | Settings toggle row inside a group inside a section with a description; night shift's boxed note; privacy's boxed "nothing to turn off". | One container level. Notes become a single line with an icon, or move into an info sheet. |
| 8 | **Glow as a large fill in Deep sea** | Every dark primary button is a full-width neon `#5EF0CF` bar. | Glow stays the dark accent but the button is calmer: one primary per screen, the rest tonal, so the bright fill appears once. |
| 9 | **The approval sheet's chrome** | A 4 dp amber top border and a 1px outline around the sheet. | The sheet is an overlay surface with a grab handle and a soft shadow; amber marks the "needs you" label only. |
| | **Controls** | | |
| 10 | **One button style for every action** | Wallet (Recibir / Límites), web task running (Tomar el control / Detener), paused, browser list (Grabar una tarea nueva), vault (Importar desde un archivo), wallet none (Restaurar), delete, memory (Borrar), refused card (Ver mis límites). | One filled primary per screen, a tonal secondary (tinted fill, no border), a text tertiary. Every button sinks on press. |
| 11 | **Disabled primary looks broken** | MCP "Revisar este servidor", restore "Revisar estas palabras": a washed-out green pill. | Disabled buttons keep their shape in a neutral sunken fill with soft text, so they read as waiting, not faded. |
| 12 | **Badges on most rows, all outlined** | "Necesita tu OK", "Destinatario guardado: Ana", "Stable testnet" on the sheet; "Stable testnet" on the wallet card and history; "Guardado por ti" on every memory; "Sugerido después de leer mensajes" in the briefing; "Ya no se puede responder desde Hermit" on messages; outcome pills on every Activity row. All outlined at 1.5px. | Badges become small tonal labels used only when they carry information (one per row at most). A saved payee is a row with an avatar, the network a quiet row, provenance a short secondary line. |
| 13 | **Icon sizes that vary, and icons that repeat without meaning** | Lucide drawn at 16, 18, 20, 22 and 24 on the same screens; outline-circle icons on history rows; the same bookmark on every memory, the same key on every vault login, a wallet icon for an address. | One rule: 20 in rows and buttons, 24 in the app bar, stroke 1.75; leading icons sit in tinted squircle tiles; a repeated icon that says nothing is removed (memories, vault rows use the site's initial instead). |
| 14 | **Controls and labels that don't follow Android's conventions** | Caps: "CÓDIGOS DE UN SOLO USO" (privacy) and the dev screens' section labels (`textTransform: "uppercase"`). Radio cards: language (settings, onboarding), delivery and login choice (web plan), search provider (privacy). Underlined links: receipt card, chat links, history "Lo hizo Hermit". Raw addresses in mono: wallet, history (every row), payees, the payment sheet's details, receive. | Sentence-case footnote labels everywhere. A segmented control for 2 to 3 short options; a list with a check for longer ones. Links become text buttons. Addresses middle-truncated (`0x9C3f…2F41`) with a copy action; the whole address only where a person must compare it (receive, typed address). |
| 15 | **Machine data shown raw** | Activity entry dumps hashes, epoch milliseconds and event ids in mono; vault rows show `https://www.bancoestado.cl` in mono; history rows show full tx hashes; MCP tools show ids in mono. | Words first (site name, "hace 2 horas"); hashes stay available behind a details row, middle-truncated, in JetBrains Mono at a smaller size. |
| | **Layout** | | |
| 16 | **The chat's first screen: a crowded bar over empty space** | `index*`: green dot + "En este teléfono", centered crab, status line, trash, hamburger, and a 1px rule; on first run the intro bubble and starters sit at the bottom under an empty half screen. | A quiet bar: the small crab with one status word that crossfades; trash moves into the menu. First run is composed around a staged crab and a greeting at the optical center. |
| 17 | **Two header systems** | Stack header with a small sans title (web task, page reader, activity entry) next to the big serif page titles everywhere else. | One page header: back button, then a large Newsreader title that the content scrolls under. |
| 18 | **Inconsistent widths and gutters** | 10, 16 and 24 dp gutters across screens; sheets at 24; onboarding at 24 with a 1px footer rule. | One 20 dp gutter, a 4 pt grid, 32 between sections, 8 from a label to its group. |
| | **The crab and motion** | | |
| 19 | **The crab is a still image, sized and placed differently on each screen** | 44 to 64 dp PNG in the header and sheets, 96 to 148 dp in onboarding, placed top-left, centered or inline depending on the screen. | Owned by the mascot branch (vector, motion). Here: one staging rule, larger in empty states and onboarding, on a quiet tonal stage, always in the same place; the small header crab gets animated transitions from the mascot branch. |
| 20 | **No feedback on press, and no transitions** | Nothing responds to a press; sheets appear (or slide with the system default); statuses swap; steps fold instantly; messages pop in; the loader icon ("Leyendo la página…") is a static ring. | Motion tokens in `src/motion.ts`; Animated with the native driver for press feedback, sheets springing in over a fading backdrop, the first block rising in, status crossfades, steps folding and new messages arriving. Off for reduce motion and Quiet mode. |

## Phase 2: issues found on the other screens, and their fixes

| # | Issue | Where | Fix |
|---|---|---|---|
| 21 | **Chips that say nothing** | "Hecho" on most Activity rows; the login source on the credential sheet and the fill screen; "Guardado por ti" on a memory; the import's file format; a web task's site. | Gone, or a quiet line. Badges stay only where they inform (from a message, unknown sender, drafted by Hermit, suggested after reading messages). |
| 22 | **A hash on every row** | Activity's rows and its status card (the chain's head). | Only in the entry (HM-ACT-02), whole and selectable. |
| 23 | **Times that don't line up** | Activity's time after the outcome; "Hace 40 min" breaking alone; "mar, 10:51 p.m." in lower case (and "mar" reads as March); reminders as raw Intl dates. | The time at the title's end on its baseline; the whole weekday capitalized; "Mañana", "Domingo" for times to come. |
| 24 | **Three left edges** | Section intros at 4 dp, labels and row text at 16, field labels at 0. | One text column, 16 dp in; the page's title and subtitle on the gutter. |
| 25 | **"Change" eight times** | Profile fields, granted permissions. | A chevron on a row that opens; "Agregar" only on an empty one. |
| 26 | **Stacks of buttons** | The login screen: show, copy, copy, edit, delete as five buttons. | Copy beside each field, Edit in the bar, Delete as a coral row, one primary. |
| 27 | **Outlined cards and 1 px rules** | MCP servers, connectors, briefing suggestions, appearance, the approval key, the tool lists. | Raised surfaces and hairlines; Card lost its outlined variant. |
| 28 | **Empty states under the title** | Every empty state started at the top with half the screen bare below. | At the optical center of the room the page leaves. |
| 29 | **The last header outliers** | The page reader, the activity entry and every web task state on the stack header; Delete everything's title drawn inside its content. | `Page` everywhere; the live page and recording keep the title small in the bar. |
| 30 | **Lists that build every row** | Moving the vault, memories and messages to grouped lists risked building thousands of rows at once. | `Page`'s list mode: a FlatList whose cells draw the group look, so only what's on screen is built. |
| 31 | **Cut addresses of strangers** | An unnamed counterparty's address cut in the middle (history, the sheet's title, replies), the shape address poisoning exploits. | Whole, mono, wrapping, everywhere a stranger's address appears; only the user's own address may be cut. |
| 32 | **Leftover quotes** | « » on a memory's fact; straight quotes around other people's words in the briefing. | Curly quotes from `quoted()`. |

## Round 3: a detail review, and a sweep for the same slips

The audit now checks every picture for these (`apps/mobile/preview/audit.mjs`, "slips"): a mono value whose last line holds one or two characters, a line repeating the one before it, a row description past two lines, and a fallback label.

| # | Issue | Where | Fix |
|---|---|---|---|
| 33 | **A lone character on a mono line** | An unknown sender's address in the history ("…C8C6F", then "B" alone). | Whole addresses in groups of four after the 0x, breaking only between groups; hashes in groups of eight. Display only, with copy where the value is used. |
| 34 | **A badge echoed by the next sentence** | "Remitente desconocido" over "Remitente desconocido: no está…". | The sentence starts at the warning itself; TalkBack still hears both. |
| 35 | **A section label equal to its first row** | Settings' "Lo que Hermit puede usar"; Privacy's Dojo relay; the autofill test screen's title. | "Acceso y conexiones", "Inicios de sesión"; the debug screen's repeated title removed. |
| 36 | **Row descriptions past two lines** | Language and the app lock in Settings; Quiet mode; the night shift's mail note; MCP's read claim and notes; permissions with their status beside them; the privacy relay. | One short line each; the status under the title so the description keeps the row's width; a permission's fix-it steps open in a sheet. |
| 37 | **Fallback labels in the gallery** | "Otra acción" twice in Activity from made-up skill ids in the sample log. | Real ids (a reminder, the night shift's agenda), and every family of skill has its icon. |
| 38 | **Plurals for one** | "1 veces" on Privacy; "paso(s)" on a web task's fix. | `.one` forms where a count can be one. |
