#!/usr/bin/env python3
"""The Hermit mascot, built from the logo itself.

The reference drawing (docs/brand/logo/source/reference-drawing.png) is split into its real parts
(shell with the spiral cut out, head with the inner legs, outer leg, two claws, two eyes).
Each part is traced once with potrace and stored in docs/brand/mascot/parts.json.
Poses only move, rotate or swap those exact parts, so every drawing is the logo's crab.

Usage:
  mascot.py --extract    # re-trace parts from the reference (needs potrace)
  mascot.py [OUT_DIR]    # write one SVG per pose (ink and Deep sea "foam" versions)
"""
import json
import re
import subprocess
import sys
import tempfile
from collections import deque
from pathlib import Path

from PIL import Image, ImageOps

BRAND = Path(__file__).resolve().parents[2] / "docs" / "brand"
REFERENCE = BRAND / "logo" / "source" / "reference-drawing.png"
PARTS = BRAND / "mascot" / "parts.json"
INK, FOAM, SEA, GLOW, PAPER, ABYSS = "#2B221B", "#E7F1F0", "#4F7C6D", "#5EF0CF", "#F5EDE1", "#06121D"
SCALE = 4

# Component order is by size in the reference; names fixed here.
NAMES = ["shell", "head", "claw_l", "claw_r", "leg_out", "eye_l", "eye_r"]


def extract() -> None:
    bw = Image.open(REFERENCE).convert("L").point(lambda v: 0 if v < 110 else 255)
    px0 = bw.load()
    empty = [x for x in range(bw.width // 3, bw.width // 2) if all(px0[x, y] == 255 for y in range(bw.height))]
    sym = bw.crop((0, 0, empty[len(empty) // 2], bw.height))
    sym = sym.crop(ImageOps.invert(sym).getbbox())
    w, h = sym.size
    px = sym.load()
    seen = [[False] * w for _ in range(h)]
    comps = []
    for y in range(h):
        for x in range(w):
            if px[x, y] == 0 and not seen[y][x]:
                q, pts = deque([(x, y)]), []
                seen[y][x] = True
                while q:
                    cx, cy = q.popleft()
                    pts.append((cx, cy))
                    for nx, ny in ((cx + 1, cy), (cx - 1, cy), (cx, cy + 1), (cx, cy - 1)):
                        if 0 <= nx < w and 0 <= ny < h and not seen[ny][nx] and px[nx, ny] == 0:
                            seen[ny][nx] = True
                            q.append((nx, ny))
                if len(pts) > 30:
                    comps.append(pts)
    comps.sort(key=len, reverse=True)
    # the two eyes are equal size: order them left to right
    comps[5:7] = sorted(comps[5:7], key=lambda c: min(p[0] for p in c))
    comps[2:4] = sorted(comps[2:4], key=lambda c: min(p[0] for p in c))
    parts = {"size": [w, h]}
    for name, pts in zip(NAMES, comps):
        mask = Image.new("L", (w, h), 255)
        mp = mask.load()
        for x, y in pts:
            mp[x, y] = 0
        xs, ys = [p[0] for p in pts], [p[1] for p in pts]
        big = mask.resize((w * SCALE, h * SCALE), Image.LANCZOS).point(lambda v: 0 if v < 128 else 255).convert("1")
        with tempfile.TemporaryDirectory() as tmp:
            pbm, svg = Path(tmp, "in.pbm"), Path(tmp, "out.svg")
            big.save(pbm)
            subprocess.run(["potrace", str(pbm), "-s", "-o", str(svg), "--turdsize", "10", "--alphamax", "1.0", "--opttolerance", "0.2"], check=True)
            text = svg.read_text()
        g = re.search(r'<g transform="([^"]+)"[^>]*>(.*?)</g>', text, re.S)
        parts[name] = {
            "svg": f'<g transform="scale({1 / SCALE}) {g.group(1)}"><path d="{" ".join(re.findall(r"d=\"([^\"]+)\"", g.group(2)))}"/></g>',
            "box": [min(xs), min(ys), max(xs), max(ys)],
        }
    PARTS.write_text(json.dumps(parts))
    print("parts:", {n: parts[n]["box"] for n in NAMES})


# ---------------------------------------------------------------- poses

def load():
    return json.loads(PARTS.read_text())


def center(box):
    return ((box[0] + box[2]) / 2, (box[1] + box[3]) / 2)


def prop(kind, x, y, fg, accent, s=1.0):
    """Props in the logo's style: solid one-color shapes with paper cut-outs, plus the sea-glass accent."""
    sw = 9
    st = f'fill="none" stroke="{fg}" stroke-width="{sw}" stroke-linecap="round" stroke-linejoin="round"'
    g = f'<g transform="translate({x:.1f} {y:.1f}) scale({s})">'
    shapes = {
        "envelope": f'<rect x="-42" y="-28" width="84" height="56" rx="8" {st}/><path d="M-36 -20L0 8L36 -20" {st}/>',
        "note": f'<rect x="-30" y="-40" width="60" height="80" rx="8" {st}/><path d="M-16 -18H16M-16 0H16M-16 18H6" {st}/>',
        "pearl": f'<circle r="22" fill="{accent}"/><circle cx="7" cy="-7" r="6" fill="{PAPER}"/>',
        "bubbles": "".join(f'<circle cx="{dx}" cy="{dy}" r="{r}" fill="none" stroke="{accent}" stroke-width="7"/>' for dx, dy, r in ((0, 0, 10), (24, -32, 14), (-4, -70, 8))),
        "moon": f'<path d="M0 -40A42 42 0 1 0 36 22A34 34 0 1 1 0 -40Z" fill="{accent}"/>',
        "plane": f'<g transform="rotate(-15)"><path d="M-48 0L48 -26L6 30L-3 6Z" {st}/><path d="M-3 6L48 -26" {st}/></g>',
        "mic": f'<rect x="-16" y="-50" width="32" height="58" rx="16" fill="{accent}"/><path d="M-28 -6Q-28 28 0 28Q28 28 28 -6M0 28V48M-18 48H18" {st}/>',
        "phone": f'<rect x="-26" y="-46" width="52" height="92" rx="10" {st}/><path d="M-8 -34H8" {st}/>',
        "zz": f'<path d="M0 0h26l-26 26h26M38 -38h18l-18 18h18" fill="none" stroke="{accent}" stroke-width="8" stroke-linecap="round" stroke-linejoin="round"/>',
        "dots": "".join(f'<circle cx="{dx}" cy="{-dx * 0.6}" r="{r}" fill="{accent}"/>' for dx, r in ((0, 6), (20, 9), (46, 13))),
    }
    return g + shapes[kind] + "</g>"


def closed_eye(box, fg):
    cx, cy = center(box)
    return f'<path d="M{cx - 11:.1f} {cy - 2:.1f}Q{cx:.1f} {cy + 9:.1f} {cx + 11:.1f} {cy - 2:.1f}" fill="none" stroke="{fg}" stroke-width="7" stroke-linecap="round"/>'


GAP = 13  # the paper gap between pieces, as in the logo
TRACE_UNIT = 1 / (SCALE * 10)  # traced paths are drawn at scale(1/SCALE) * potrace's scale(0.1)


class Layers:
    """Draws pieces in order. A piece added with cut=True carves a GAP-wide gap into everything
    already drawn (an SVG mask), the way the logo separates the crab from its shell."""

    def __init__(self, extent):
        self.content, self.defs, self.n, self.extent = "", [], 0, extent

    def add(self, svg, cut=False, unit=1.0):
        """unit: the drawing scale of svg's own coordinates (traced parts are drawn at 1/40)."""
        if cut and self.content:
            self.n += 1
            x, y, w, h = self.extent
            self.defs.append(f'<mask id="cut{self.n}" maskUnits="userSpaceOnUse" x="{x}" y="{y}" width="{w}" height="{h}">'
                             f'<rect x="{x}" y="{y}" width="{w}" height="{h}" fill="#fff"/>'
                             f'<g fill="#000" stroke="#000" stroke-width="{2 * GAP / unit:.1f}" stroke-linejoin="round">{svg}</g></mask>')
            self.content = f'<g mask="url(#cut{self.n})">{self.content}</g>'
        self.content += svg

    def carve(self, svg, unit=1.0):
        """Cut svg out of everything drawn so far (paper shows through), like the logo's spiral."""
        self.n += 1
        x, y, w, h = self.extent
        self.defs.append(f'<mask id="cut{self.n}" maskUnits="userSpaceOnUse" x="{x}" y="{y}" width="{w}" height="{h}">'
                         f'<rect x="{x}" y="{y}" width="{w}" height="{h}" fill="#fff"/><g fill="#000" stroke="#000" stroke-width="{2 / unit:.1f}">{svg}</g></mask>')
        self.content = f'<g mask="url(#cut{self.n})">{self.content}</g>'

    def svg(self):
        return f'<defs>{"".join(self.defs)}</defs>{self.content}'


def render(parts, pose, fg=INK, accent=SEA):
    """Canvas: the symbol's own coordinates, with room around it for raised claws and props."""
    w, h = parts["size"]
    pad_l, pad_t, pad_r, pad_b = 60, 140, 140, 40
    vb = (-pad_l, -pad_t, w + pad_l + pad_r, h + pad_t + pad_b)
    L = Layers(vb)

    def part(name, transform=""):
        t = f' transform="{transform}"' if transform else ""
        return f'<g{t}>{parts[name]["svg"]}</g>'

    if pose.get("beside"):  # a small empty shell next to it (Boost)
        L.add(part("shell", "translate(-55 330) scale(0.24)"))
    shell_t = pose.get("shell_t", "")
    L.add(part("shell", shell_t))
    if pose.get("hide"):
        pass
    elif pose.get("tucked"):
        # pulled into the shell: the two claws close the opening, like a real hermit crab
        L.add(part("claw_l", "translate(-20 -95) rotate(-12 250 370)"), cut=True, unit=TRACE_UNIT)
        L.add(part("claw_r", "translate(-75 -100) rotate(12 400 370)"), cut=True, unit=TRACE_UNIT)
        if pose.get("peek"):
            # eyes peeking from the dark opening are cut out of the shell, like the spiral
            if pose.get("closed"):
                L.carve("".join(closed_eye([b + d for b, d in zip(parts[e]["box"], (12, -104, 12, -104))], "#000") for e in ("eye_l", "eye_r")))
            else:
                L.carve("".join(part(e, "translate(12 -104)") for e in ("eye_l", "eye_r")), TRACE_UNIT)
    else:
        L.add(part("head") + part("leg_out"), cut=False)
        gx, gy = pose.get("gaze", (0, 0))
        L.add("".join(closed_eye(parts[e]["box"], fg) if pose.get("closed") else part(e, f"translate({gx} {gy})") for e in ("eye_l", "eye_r")))
        for claw in ("claw_l", "claw_r"):
            t = pose.get(claw, "")
            L.add(part(claw, t), cut=bool(t), unit=TRACE_UNIT)  # a moved claw carves its own gap
    for kind, x, y, *sc in pose.get("props", ()):
        L.add(prop(kind, x, y, fg, accent, *(sc or [1.0])), cut=True)
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{" ".join(map(str, vb))}" width="{vb[2]}" height="{vb[3]}">'
            f'<g fill="{fg}">{L.svg()}</g></svg>\n')


RAISE_R = "translate(40 -120) rotate(-22 401 373)"   # right claw lifted above the head, holding something up
WAVE_L = "translate(-95 -95) rotate(28 250 370)"       # left claw raised out to the side in a wave
DROOP_R = "rotate(18 420 400) translate(0 8)"

POSES = {
    "01-idle": {},
    "02-thinking": {"gaze": (-4, -4), "props": (("dots", 470, 210),)},
    "03-working": {"claw_r": RAISE_R, "gaze": (5, -2), "props": (("note", 470, 150),)},
    "04-asking": {"claw_r": RAISE_R, "props": (("envelope", 478, 160),)},
    "05-done": {"closed": True, "props": (("envelope", 520, 380, 0.8),)},
    "06-error": {"gaze": (3, 6), "claw_r": DROOP_R, "props": (("envelope", 535, 395, 0.8),)},
    "07-blocked": {"tucked": True},
    "08-offline": {"tucked": True, "props": (("plane", 470, 40),)},
    "09-sleeping": {"tucked": True, "peek": True, "closed": True, "props": (("moon", 470, 30), ("zz", 380, 60))},
    "10-boost": {"beside": True, "shell_t": "translate(-30 -40) scale(1.1)"},
    "11-new-phone": {"claw_r": RAISE_R, "props": (("phone", 478, 150),)},
    "12-remember": {"claw_r": RAISE_R, "props": (("pearl", 474, 175),)},
    "13-forget": {"gaze": (4, -4), "claw_r": RAISE_R, "props": (("bubbles", 474, 180),)},
    "14-listening": {"gaze": (6, 0), "props": (("mic", 540, 300),)},
    "15-quiet": {"hide": True},
}

EXTRA = {
    "hello": {"claw_l": WAVE_L},
    "peek": {"tucked": True, "peek": True},
    "blink": {"closed": True},
    "mark": {},
}


if __name__ == "__main__":
    if "--extract" in sys.argv:
        extract()
        sys.exit(0)
    out_dir = Path(sys.argv[1] if len(sys.argv) > 1 else BRAND / "mascot" / "rig")
    out_dir.mkdir(parents=True, exist_ok=True)
    parts = load()
    for name, pose in {**POSES, **EXTRA}.items():
        (out_dir / f"{name}.svg").write_text(render(parts, pose))
        (out_dir / f"{name}-dark.svg").write_text(render(parts, pose, FOAM, GLOW))
    print(f"{len(POSES) + len(EXTRA)} poses x 2 -> {out_dir}")
