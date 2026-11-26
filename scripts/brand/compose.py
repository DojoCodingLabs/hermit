#!/usr/bin/env python3
"""Lay out the brand assets that show the mascot, as HTML pages built from the vector rig.

Every crab on these pages is a file from docs/brand/mascot/rig (scripts/brand/mascot.py),
so the anatomy is identical everywhere. Chrome renders each page to PNG (see BRANDBOOK.md).

Usage: compose.py   (writes docs/brand/compose/*.html)
"""
from pathlib import Path

BRAND = Path(__file__).resolve().parents[2] / "docs" / "brand"
OUT = BRAND / "compose"

PAPER, SHELL, STONE, SAND, INK, INK_SOFT, SEA, SEA_DEEP = "#F5EDE1", "#EBDDCB", "#D3C2AE", "#D5B893", "#2B221B", "#6B5E52", "#4F7C6D", "#3B6456"
ABYSS, CURRENT, KELP, FOAM, GLOW = "#06121D", "#1A4A5E", "#8FA9B5", "#E7F1F0", "#5EF0CF"


def page(name, w, h, body, bg=PAPER, extra_css=""):
    html = f"""<!doctype html><html><head><meta charset="utf-8">
<link rel="stylesheet" href="../fonts/fonts.css">
<style>
  html,body{{margin:0;padding:0}}
  #art{{width:{w}px;height:{h}px;background:{bg};position:relative;overflow:hidden;font-family:"Instrument Sans",sans-serif;color:{INK}}}
  .serif{{font-family:"Newsreader",serif}}
  .crab{{position:absolute;display:block}}
  {extra_css}
</style></head><body><div id="art">{body}</div></body></html>"""
    (OUT / f"{name}.html").write_text(html)


def crab(pose, x, y, size, dark=False):
    suffix = "-dark" if dark else ""
    return f'<img class="crab" src="../mascot/rig/{pose}{suffix}.svg" style="left:{x}px;top:{y + size * 0.066:.0f}px;width:{size}px;height:auto" alt="">'


STATES = [
    ("01-idle", "Idle", "The logo. Ready and watching."),
    ("02-thinking", "Thinking", "Looks up, a thought forming."),
    ("03-working", "Working", "Holds the task it picked."),
    ("04-asking", "Asking", "Holds up the exact message."),
    ("05-done", "Done", "Eyes closed, job set down."),
    ("06-error", "Error", "Looks at what fell."),
    ("07-blocked", "Blocked", "Tucked in, claws shut the door."),
    ("08-offline", "Offline", "Tucked in, still working."),
    ("09-sleeping", "Sleeping", "Night shift, eyes closed."),
    ("10-boost", "Boost", "Moved into a bigger shell."),
    ("11-new-phone", "New phone", "Holds up its new home."),
    ("12-remember", "Remember", "Keeps a pearl."),
    ("13-forget", "Forget", "Lets it go, as asked."),
    ("14-listening", "Listening", "Leans toward the mic."),
    ("15-quiet", "Quiet mode", "Just the shell."),
]


def expressions(name, states, title):
    cells = []
    for i, (pose, label, desc) in enumerate(states):
        col, row = i % 4, i // 4
        x, y = 40 + col * 364, 130 + row * 440
        num = pose.split("-")[0].lstrip("0")
        cells.append(f"""<div style="position:absolute;left:{x}px;top:{y}px;width:344px;height:420px;background:{SHELL};border-radius:20px">
          {crab(pose, 47, 20, 250)}
          <div style="position:absolute;left:0;right:0;top:292px;text-align:center;font-weight:700;font-size:22px;letter-spacing:.14em">{num}. {label.upper()}</div>
          <div style="position:absolute;left:24px;right:24px;top:330px;text-align:center;font-size:18px;color:{INK_SOFT};line-height:1.35">{desc}</div>
        </div>""")
    head = f"""<img src="../logo/wordmark-ink.svg" style="position:absolute;left:48px;top:46px;height:30px" alt="HERMIT">
      <div style="position:absolute;left:250px;top:46px;font-size:26px;letter-spacing:.2em;color:{INK_SOFT}">{title}</div>"""
    page(name, 1536, 1024 if len(states) > 4 else 600, head + "".join(cells))


def character_sheet():
    W, ox, oy = 880, 20, 150
    sc = W / 693
    def at(x, y):  # rig symbol coordinates -> page pixels (rig viewBox starts at -60, -140)
        return ox + (x + 60) * sc, oy + (y + 140) * sc + W * 0.066
    callouts = [
        ((170, 90), (40, 120), "A solid shell, spiral cut out"),
        ((296, 290), (630, 140), "Two dot eyes"),
        ((400, 373), (720, 930), "Two claws"),
        ((110, 360), (40, 760), "Legs"),
        ((330, 252), (600, 270), "Paper gaps separate every piece"),
    ]
    lines, labels = [], []
    for (px, py), (lx, ly), text in callouts:
        x1, y1 = at(px, py)
        lines.append(f'<line x1="{x1:.0f}" y1="{y1:.0f}" x2="{lx + 10:.0f}" y2="{ly + 14:.0f}" stroke="{SEA_DEEP}" stroke-width="3"/>'
                     f'<circle cx="{x1:.0f}" cy="{y1:.0f}" r="8" fill="{SEA_DEEP}"/>')
        labels.append(f'<div style="position:absolute;left:{lx}px;top:{ly}px;background:{PAPER};padding:2px 8px;font-size:22px;font-weight:600">{text}</div>')
    rules = "".join(f"<li>{r}</li>" for r in [
        "The logo is the character. Every pose moves the logo's own pieces.",
        "One color: ink on paper, foam on Deep sea.",
        "Pieces never touch: a paper gap always separates them.",
        "Two dot eyes, two claws, two legs. No mouth.",
        "Sea glass only on small props (a pearl, the moon, a mic).",
        "Never redraw it with an image model; use scripts/brand/mascot.py.",
    ])
    swatches = "".join(f'<div style="display:flex;align-items:center;gap:12px;margin:6px 0"><span style="width:44px;height:44px;border-radius:10px;background:{c};outline:2px solid {STONE}"></span><span style="font-size:19px">{n} {c}</span></div>'
                       for n, c in (("Ink", INK), ("Paper", PAPER), ("Sea glass (props)", SEA), ("Foam (Deep sea)", FOAM)))
    body = f"""<img src="../logo/wordmark-ink.svg" style="position:absolute;left:48px;top:46px;height:30px" alt="HERMIT">
      <div style="position:absolute;left:250px;top:46px;font-size:26px;letter-spacing:.2em;color:{INK_SOFT}">CHARACTER SHEET</div>
      {crab('01-idle', ox, oy, W)}
      <svg style="position:absolute;left:0;top:0" width="1536" height="1024">{''.join(lines)}</svg>
      {''.join(labels)}
      <div style="position:absolute;left:960px;top:150px;width:520px">
        <div class="serif" style="font-size:44px;font-weight:500;line-height:1.1">One crab, and it's the logo.</div>
        <ul style="font-size:21px;line-height:1.5;padding-left:22px;margin:24px 0">{rules}</ul>
        {swatches}
      </div>"""
    page("character-sheet", 1536, 1024, body)


STICKERS = [
    ("07-blocked", "Tells no one"), ("05-done", "Done"), ("04-asking", "You sure?"), ("15-quiet", "Not going out today"),
    ("10-boost", "Moving up"), ("13-forget", "Forgotten, as asked"), ("08-offline", "Airplane mode"), ("14-listening", "I'm listening"),
    ("09-sleeping", "Good night"), ("02-thinking", "Thinking"), ("hello", "Hi"), ("03-working", "On it"),
]


def stickers():
    cells = []
    for i, (pose, text) in enumerate(STICKERS):
        col, row = i % 4, i // 4
        x, y = 40 + col * 370, 70 + row * 318
        cells.append(f"""<div style="position:absolute;left:{x}px;top:{y}px;width:340px;height:296px;background:#fff;border-radius:44px;box-shadow:0 6px 0 {STONE}">
          {crab(pose, 70, 4, 200)}
          <div style="position:absolute;left:12px;right:12px;top:212px;text-align:center;font-weight:700;font-size:30px;line-height:1.05">{text}</div>
        </div>""")
    page("stickers", 1536, 1024, "".join(cells))


def symbol_img(dark=False):
    c = "foam" if dark else "ink"
    return (f'<img src="../logo/symbol-{c}.svg" style="position:absolute;left:64px;top:176px;height:150px" alt="">'
            f'<img src="../logo/wordmark-{c}.svg" style="position:absolute;left:252px;top:232px;height:38px" alt="HERMIT">')


def banner(dark):
    bg, fg, soft = (ABYSS, FOAM, KELP) if dark else (PAPER, INK, INK_SOFT)
    body = f"""{symbol_img(dark)}
      <div class="serif" style="position:absolute;left:580px;top:130px;font-size:86px;line-height:1.0;font-weight:500;letter-spacing:-.02em;color:{fg}">Does everything.<br>Tells no one.</div>
      <div style="position:absolute;left:584px;top:335px;font-size:28px;color:{soft}">Open-source AI agent that lives on your phone.</div>
      {crab('hello', 1210, 120, 320, dark)}"""
    page("banner-dark" if dark else "banner-light", 1536, 512, body, bg)


def og_card():
    """The website's link preview (Open Graph, 1200x630): the brand line beside the waving crab, on paper."""
    body = f"""<img src="../logo/lockup-ink.svg" style="position:absolute;left:72px;top:62px;height:46px" alt="Hermit">
      <div style="position:absolute;left:764px;top:96px;width:440px;height:440px;border-radius:50%;background:#F1E7D8"></div>
      <div style="position:absolute;left:728px;top:60px;width:512px;height:512px;border-radius:50%;border:2px solid rgba(43,34,27,.12)"></div>
      {crab('hello', 796, 152, 372)}
      <div class="serif" style="position:absolute;left:68px;top:178px;font-size:90px;line-height:1;font-weight:440;letter-spacing:-.03em;color:{INK}">Does everything.<br><em style="color:{SEA}">Tells no one.</em></div>
      <div style="position:absolute;left:72px;top:418px;width:560px;font-size:29px;line-height:1.3;color:{INK_SOFT}">The open-source AI agent that lives on your phone.</div>
      <div style="position:absolute;left:72px;top:530px;font-size:22px;font-weight:600;letter-spacing:.02em;color:{INK}">joinhermit.com</div>"""
    page("og", 1200, 630, body)


def social_post():
    body = f"""<div class="serif" style="position:absolute;left:0;right:0;top:90px;text-align:center;font-size:96px;line-height:1.02;font-weight:500;color:{FOAM}">Does everything.<br>Tells no one.</div>
      {crab('01-idle', 190, 340, 700, True)}
      <div style="position:absolute;left:0;right:0;top:960px;text-align:center;font-size:34px;color:{KELP}">Your AI agent. On your phone. Nowhere else.</div>"""
    page("social-post", 1080, 1080, body, ABYSS)


ICON_PHONE = f'<svg width="190" height="250" viewBox="0 0 190 250"><rect x="30" y="10" width="130" height="230" rx="24" fill="{PAPER}" stroke="{INK}" stroke-width="12"/><rect x="55" y="70" width="80" height="54" rx="14" fill="{SEA}"/><path d="M70 124l-6 22 22-22" fill="{SEA}"/><circle cx="95" cy="214" r="8" fill="{INK}"/></svg>'
ICON_PRINT = f'<svg width="230" height="250" viewBox="0 0 230 250"><circle cx="100" cy="110" r="90" fill="{SEA}"/><g fill="none" stroke="{PAPER}" stroke-width="9" stroke-linecap="round"><path d="M55 120c0-30 20-50 45-50s45 20 45 50"/><path d="M75 150c-3-10-5-20-5-30 0-18 13-32 30-32s30 14 30 32c0 20-4 36-12 50"/><path d="M100 120v30c0 15-4 28-10 38"/></g><rect x="120" y="150" width="100" height="70" rx="12" fill="{PAPER}" stroke="{INK}" stroke-width="10"/><path d="M138 175h64M138 197h44" stroke="{INK}" stroke-width="8" stroke-linecap="round"/></svg>'
ICON_SENT = f'<svg width="240" height="250" viewBox="0 0 240 250"><path d="M60 70L215 25L140 135L125 90Z" fill="{PAPER}" stroke="{INK}" stroke-width="10" stroke-linejoin="round"/><path d="M125 90L215 25" stroke="{INK}" stroke-width="10"/><path d="M40 120q20 40 70 40" fill="none" stroke="{SEA}" stroke-width="8" stroke-dasharray="14 12"/><g stroke="{INK}" stroke-width="9" fill="{SAND}"><rect x="20" y="180" width="54" height="44" rx="10"/><rect x="92" y="180" width="54" height="44" rx="10"/></g><rect x="164" y="180" width="54" height="44" rx="10" fill="{SEA}" stroke="{INK}" stroke-width="9"/><path d="M178 202l10 10 18-20" fill="none" stroke="{PAPER}" stroke-width="8" stroke-linecap="round"/><path d="M74 202h18M146 202h18" stroke="{INK}" stroke-width="9"/></svg>'
ICON_LOCK = f'<svg width="90" height="100" viewBox="0 0 90 100" style="position:absolute;left:165px;top:178px"><path d="M22 45V30a23 23 0 0 1 46 0v15" fill="none" stroke="{INK}" stroke-width="10"/><rect x="8" y="42" width="74" height="54" rx="12" fill="{SEA}" stroke="{INK}" stroke-width="9"/><circle cx="45" cy="66" r="8" fill="{PAPER}"/></svg>'


def how_it_works():
    panels = [
        (f'<div style="position:absolute;left:52px;top:28px">{ICON_PHONE}</div>', "You ask", "Tell Ana I'm 10 minutes late"),
        (crab("03-working", 30, 10, 250), "Hermit picks a skill", "From a menu, not a computer"),
        (crab("07-blocked", 30, 10, 250) + ICON_LOCK, "The cage checks it", "Sending always asks"),
        (f'<div style="position:absolute;left:30px;top:28px">{ICON_PRINT}</div>', "You approve", "The exact message, nothing else"),
        (f'<div style="position:absolute;left:28px;top:28px">{ICON_SENT}</div>', "Done and logged", "Signed on your phone"),
    ]
    cells = []
    for i, (art, title, sub) in enumerate(panels):
        x = 24 + i * 302
        cells.append(f"""<div style="position:absolute;left:{x}px;top:40px;width:282px;height:560px;background:{SHELL};border-radius:24px">
          {art}
          <div style="position:absolute;left:12px;right:12px;top:310px;text-align:center;font-weight:700;font-size:34px;line-height:1.1">{title}</div>
          <div style="position:absolute;left:20px;right:20px;top:420px;text-align:center;font-size:24px;color:{INK_SOFT};line-height:1.3">{sub}</div>
        </div>""")
        if i < 4:
            cells.append(f'<div style="position:absolute;left:{x + 282}px;top:300px;width:20px;text-align:center;font-size:28px;color:{STONE}">›</div>')
    page("how-it-works", 1536, 640, "".join(cells))


def what_leaves():
    rows = [("Model download, once", "↓"), ("WhatsApp reply, after your OK", "➤"), ("Calendar sync, your provider", "▦")]
    lines, labels = [], []
    for i, (text, glyph) in enumerate(rows):
        y = 150 + i * 170
        lines.append(f'<path d="M930 {320 + (i - 1) * 40}C1000 {320 + (i - 1) * 40} 1000 {y} 1060 {y}" fill="none" stroke="{SEA}" stroke-width="6" stroke-dasharray="14 12"/>')
        labels.append(f'<div style="position:absolute;left:1080px;top:{y - 30}px;font-size:34px;font-weight:600;display:flex;gap:16px;align-items:center">'
                      f'<span style="width:58px;height:58px;border-radius:14px;background:{PAPER};outline:4px solid {INK};display:inline-grid;place-items:center;font-size:30px">{glyph}</span>{text}</div>')
    body = f"""<svg style="position:absolute;left:0;top:0" width="1536" height="640">
        <rect x="560" y="30" width="370" height="580" rx="56" fill="{SHELL}" stroke="{INK}" stroke-width="12"/>
        <rect x="690" y="50" width="110" height="18" rx="9" fill="{INK}"/>
        {''.join(lines)}
        <g transform="translate(160 230)"><path d="M40 120a60 60 0 0 1 10-118a80 80 0 0 1 150 20a55 55 0 0 1 10 98Z" fill="none" stroke="{INK}" stroke-width="10"/>
        <path d="M20 10L230 150M230 10L20 150" stroke="{SEA}" stroke-width="12" stroke-linecap="round"/></g>
      </svg>
      {crab('01-idle', 575, 140, 340)}
      <div style="position:absolute;left:600px;top:480px;width:290px;text-align:center;font-size:24px;color:{INK_SOFT}">Memories, keys and your log stay here.</div>
      <div style="position:absolute;left:120px;top:420px;width:330px;text-align:center;font-size:32px;font-weight:600">No servers, no analytics</div>
      {''.join(labels)}"""
    page("what-leaves", 1536, 640, body)


def app_icon(dark):
    c, bg = ("foam", ABYSS) if dark else ("ink", PAPER)
    page("app-icon-dark" if dark else "app-icon-light", 1024, 1024,
         f'<img src="../logo/symbol-{c}.svg" style="position:absolute;left:172px;top:212px;width:680px" alt="">', bg)


if __name__ == "__main__":
    OUT.mkdir(exist_ok=True)
    app_icon(False)
    app_icon(True)
    character_sheet()
    expressions("expressions-a", STATES[:8], "EXPRESSION SHEET A")
    expressions("expressions-b", STATES[8:], "EXPRESSION SHEET B")
    stickers()
    banner(False)
    banner(True)
    og_card()
    social_post()
    how_it_works()
    what_leaves()
    print(sorted(p.name for p in OUT.glob("*.html")))
