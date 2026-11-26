# GPT Image 2.6 Sunburst: prompting playbook for the Hermit brand book

Researched 2026-11-08. Sources at the bottom. Where a source is a third-party reseller, the claim is marked as unverified.

## 1. The model and the knobs

| Knob | Values | How we use it |
|---|---|---|
| `model` | `gpt-image-2.6-sunburst` (detail, precise edits) / `gpt-image-2.6-flare` (fast) | Explore in Flare, then render finals in Sunburst with the same prompt. Sunburst follows multi-instruction layouts better. |
| Endpoints | `POST /v1/images/generations`, `POST /v1/images/edits` | Not available in Responses, Chat or Batch. |
| `quality` | `low`, `medium`, `high`, `xhigh`, `max`, `auto`. These are documented for 2.5; 2.6 is assumed to match. | Use `medium` for explorations, `high` for boards with small text, and `xhigh`/`max` only for hero finals. |
| `complexity` | `low`, `medium`, `high` (default `high`) | This is how much the model plans the layout, separate from quality. Use `high` for dense brand boards, `low` for targeted edits. High can drift backgrounds. |
| `size` | `1024x1024`, `1536x1024`, `1024x1536`, or custom: multiples of 16, aspect 1:3 to 3:1 | Use 1536x1024 (landscape) for brand-book spreads, 1024x1024 for logos and icons, and 1024x1536 for phone screens. |
| `background` | `transparent`, `opaque`, `auto` | Logos: `transparent` + PNG. Check the decoded alpha channel; a drawn checkerboard is not transparency. |
| `output_format` | png / jpeg / webp, plus **svg** and animated **gif** on 2.6 | Use SVG for the logo master (`n=1`, editable XML). GIF is for the mascot animation sheet, if wanted. |
| `n` | several per request | Generate 3-4 logo variants per call and compare. |
| `markup` (edits) | a transparent PNG overlay with circles drawn, matching the first image's size | Point at exactly what to change. Can't be combined with `mask`. |
| Input fidelity | not needed: Sunburst reads references at high fidelity | Omit `input_fidelity`. |
| Pricing | text $5, image in $8, image out $30 per 1M tokens | A 1024² image at medium costs about $0.013 in output; at high, about $0.053. |

## 2. Prompt rules (OpenAI guide, plus what testers found)

1. **Say what the image is for.** Give the subject, intended use, composition, aspect ratio and placement. Use labeled sections for complex boards: SCENE / LAYOUT / TEXT / STYLE / CONSTRAINTS.
2. **Text is a contract.**
   - Put every visible string in double quotes, with position, size and typeface.
   - Spell brand names letter by letter when needed: "H-E-R-M-I-T".
   - Add "no other text".
   - Proofread every output; small text can still misspell.
3. **Logos:**
   - Describe the brand and the defining shapes.
   - Ask for a strong silhouette, simplicity over detail (it must read at 16 px and on a billboard), one centered mark, generous padding, a transparent background, and no watermark, mockup or backdrop.
4. **Character consistency (the crab):**
   - First build a **character reference sheet** (turnaround, expressions, palette swatches).
   - In every later prompt, pass it as a reference image, repeat the defining traits, and add "do not redesign the character".
5. **UI mockups:**
   - Describe the product as if it already exists: layout, hierarchy, spacing and real interface elements, with real copy in quotes and a device frame.
   - No concept-art language ("futuristic, sleek, 8k").
6. **Diagrams and infographics:**
   - Name the audience and the information.
   - List the components and what to exclude.
   - Use `quality=high`.
   - Verify labels and relationships, not just looks.
7. **Edits:**
   - Say what changes AND what must stay fixed ("change only X").
   - Make one change per turn, feeding the previous output back.
   - Anchor to a unique visible detail, not to counting ("the shell", not "third from left").
   - Restate the critical constraints if things drift.
8. **No keyword soup.** "4k, ultra detailed, masterpiece" tells the model nothing. Concrete materials, lighting, color and medium do.
9. **Treat counts as approximate** in busy scenes. Testers never got exactly 12 mugs.
10. **Pixel-perfect parts:** composite approved elements into the original instead of regenerating.

## 3. How this applies to the brand book

- **Lock the masters first, then everything references them:**
  1. Logo (SVG plus transparent PNG)
  2. Mascot reference sheet
  3. Palette card
  4. Type specimen

  Every later board (app icon, UI screens, social, merch) goes through `/edits` with those masters as numbered references: "image 1 is the logo, image 2 is the mascot sheet, use exactly these".
- **Final type and color are decided by us, not the model.** Image models approximate fonts. The brand book names real, licensable typefaces and exact hex values. The generated boards are visualizations.
- **Vector truth:** the SVG logo is cleaned by hand, or in code, before it is called final.

## Sources
- [OpenAI: Image prompting guide](https://developers.openai.com/api/docs/guides/image-prompting)
- [OpenAI: Image generation guide](https://developers.openai.com/api/docs/guides/image-generation)
- [OpenAI: gpt-image-2.6-sunburst model page](https://developers.openai.com/api/docs/models/gpt-image-2.6-sunburst.md)
- [Replicate: GPT Image 2.6 Sunburst](https://replicate.com/openai/gpt-image-2.6-sunburst)
- [each::labs: GPT Image 2.6 tested](https://www.eachlabs.ai/blog/gpt-image-2-6-tested-on-eachlabs) (single-brief test, anecdotal)
- [OpenArt: GPT Image 2.6 prompt guide](https://openart.ai/blog/gpt-image-2-6-prompt-guide/) (third party)
- [Wiro: GPT Image 2.6 Sunburst](https://wiro.ai/models/openai/gpt-image-2-6-sunburst) (third party; 2K/4K experimental)
- [Grida: GPT Image 2.5 Flare vs Sunburst](https://grida.co/docs/models/gpt-image-2.5)

## Lessons from producing the book (2026-11-09/10)

- **SVG output** needs `svg: {"model": "<text model>"}` (we used `gpt-5.5`), `n=1`, and works only on `/generations`, not `/edits`. It came back clean and editable but drifted from the approved mark. The logo master is therefore built in code (`scripts/brand/symbol.py`).
- **GIF output** renders a 9-frame sprite sheet. The sheet must fit the pixel budget, so 1024 px frames fail and 512 px frames work. `/edits` with the character master as reference keeps the crab on model. Retime frames afterwards with PIL (hold the first and last frames).
- **Edits drift** when the brief lists many cells. Expression sheet B invented a heart and a lightbulb until we passed sheet A as the layout reference and spelled out the forbidden symbols.
- **Low complexity** (`--complexity low`) with the original as the reference is the right tool for one-row fixes (the Activity screen's blocked row).
- **Partner logos** that are white or mint vanish on light pages. Keep ink variants and swap them with `<picture>` on GitHub.
