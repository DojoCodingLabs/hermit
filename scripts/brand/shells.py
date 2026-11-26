#!/usr/bin/env python3
"""Draws the shells every bot but Hermit wears, as data: apps/mobile/src/shells.ts, plus a contact sheet per theme.

Hermit is the crab (the reference drawing, never touched here). Every other bot wears a simple gastropod shell, drawn by
code: six parametric outlines (whelk, moon, turban, conch, auger, nerite), each with a cut spiral, and the two eye
pieces traced from the reference crab (docs/brand/mascot/parts.json eye_l, eye_r) peeking from the opening. The eyes are
only moved, uniformly scaled and tilted with the shell; their curves are the traced ones. No image model.

Colors: each color id carries an explicit light and dark fill, taken from docs/brand/tokens.json, never coral or
amber (they mark the modes), each at least 3:1 against its theme's canvas (paper, abyss).

Usage:
  shells.py           # write apps/mobile/src/shells.ts and docs/brand/shells/shells-{light,dark}.png
  shells.py --check   # exit 1 if the committed shells.ts is out of date
"""
import hashlib
import json
import math
import re
import sys
from pathlib import Path

sys.dont_write_bytecode = True

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "apps" / "mobile" / "src" / "shells.ts"
SHEETS = ROOT / "docs" / "brand" / "shells"
PARTS = ROOT / "docs" / "brand" / "mascot" / "parts.json"
TOKENS = ROOT / "docs" / "brand" / "tokens.json"

SHAPES = ["whelk", "moon", "turban", "conch", "auger", "nerite"]
# Each id: (light token, dark token). Light fills must stand 3:1 off paper, dark fills off abyss.
FILLS = {
    "sand": ("ink-soft", "sand"),
    "stone": ("current", "kelp"),
    "seaglass": ("seaglass", "glow"),
    "ink": ("ink", "foam"),
}
EYE_BOX = 15.0  # an eye's height in the 100 by 100 box: the same on every shape, so every shell has the same eyes
FIT = 88.0  # a shell's longest side in the box
STROKE = 3.0  # the spiral's stroke width in the 100 by 100 box, for the app and the sheets alike


# ---------------------------------------------------------------- profiles
# A shell stands upright, spire up, in a box of height 1. hw(y) is the half width at height y (0 tip, 1 base).

def semicircle(f):
    return math.sqrt(max(0.0, 1 - (2 * f - 1) ** 2))


def whorls(y, n, d, style):
    """The scallop factor: round whorls notch at every suture; a stepped cone drops at each one."""
    f = (y * n) % 1.0
    if style == "step":
        return (1 - d) + d * f
    return 1 - d + d * semicircle(f)


def close(y, top, bottom):
    """Rounds the tip and the base."""
    k = 1.0
    if y < top:
        k *= math.sqrt(max(0.0, 1 - ((top - y) / top) ** 2))
    if y > bottom:
        k *= math.sqrt(max(0.0, 1 - ((y - bottom) / (1 - bottom)) ** 2))
    return k


def cone(w0, wmax, p, n, d, style, top, bottom):
    return lambda y: (w0 + (wmax - w0) * y ** p) * whorls(y, n, d, style) * close(y, top, bottom)


def ellipse(cy, ry, rx):
    return lambda y: rx * math.sqrt(max(0.0, 1 - ((y - cy) / ry) ** 2)) if abs(y - cy) < ry else 0.0


def spire_body(spire_end, spire_w, n, body):
    """A scalloped spire on top of a rounded body whorl; the outline is whichever is wider."""
    spire = cone(0.02, spire_w, 1.0, n, 0.12, "round", 0.05, 1.0)
    return lambda y: max(spire(y / spire_end) if y < spire_end else 0.0, body(y))


def nerite_hw(y):
    return 0.92 * math.sqrt(max(0.0, 1 - (1 - y) ** 2)) * (1 - 0.05 * semicircle((y * 3) % 1.0))


def conch_right(y, base):
    """The flared outer lip of a conch: a wing on the right, widest about the middle."""
    wing = semicircle(min(1.0, max(0.0, (y - 0.28) / 0.5)))
    return base * (1 + 0.5 * wing)


# name: hw (left and right half width at height y), lean (the aperture side swells), tilt (degrees), ey (eye height),
# ex (eye offset), spiral (centre x in half widths, centre y, radius in half widths, turns), sutures (rows cut)
SHAPE = {
    "whelk": dict(hw=spire_body(0.55, 0.20, 4, ellipse(0.68, 0.32, 0.36)), lean=0.08, tilt=10, ey=0.84, ex=0.30, spiral=(0.1, 0.52, 0.5, 1.8), sutures=1, whorls=4),
    "moon": dict(hw=spire_body(0.36, 0.26, 2, ellipse(0.62, 0.38, 0.5)), lean=0.0, tilt=-8, ey=0.82, ex=0.30, spiral=(-0.1, 0.5, 0.6, 2.0), sutures=0),
    "turban": dict(hw=cone(0.02, 0.52, 1.0, 5, 0.07, "round", 0.04, 0.9), lean=0.0, tilt=-4, ey=0.82, ex=0.28, spiral=(-0.05, 0.54, 0.55, 1.8), sutures=2, whorls=5),
    "conch": dict(hw=spire_body(0.45, 0.22, 3, ellipse(0.66, 0.34, 0.34)), lean=0.0, tilt=-12, ey=0.82, ex=0.25, spiral=(-0.2, 0.52, 0.45, 1.8), sutures=1, whorls=3, wing=True),
    "auger": dict(hw=cone(0.02, 0.30, 1.0, 9, 0.08, "round", 0.03, 0.95), lean=0.04, tilt=8, ey=0.88, ex=0.25, spiral=(0.0, 0.56, 0.5, 1.6), sutures=7, whorls=9),
    "nerite": dict(hw=nerite_hw, lean=0.0, tilt=-4, ey=0.8, ex=0.30, spiral=(-0.1, 0.42, 0.6, 1.8), sutures=0),
}


def outline(name):
    """The shell's silhouette as local points (x across, y down), height 1."""
    s = SHAPE[name]
    ys = [i / 160 for i in range(161)]
    right, left = [], []
    for y in ys:
        w = s["hw"](y)
        wr = w * (1 + s["lean"] * y)
        wl = w * (1 - s["lean"] * 0.3 * y)
        if s.get("wing"):
            wr = conch_right(y, wr)
        right.append((wr, y))
        left.append((-wl, y))
    return right + left[::-1]


def half_width(name, y, side=1):
    s = SHAPE[name]
    w = s["hw"](y)
    if side > 0:
        w *= 1 + s["lean"] * y
        if s.get("wing"):
            w = conch_right(y, w)
        return w
    return w * (1 - s["lean"] * 0.3 * y)


def spiral_points(name, eye_h):
    s = SHAPE[name]
    cx_f, cy, rad_f, turns = s["spiral"]
    hw = half_width(name, cy, 1 if cx_f >= 0 else -1)
    cx = cx_f * hw
    rmax = rad_f * min(half_width(name, cy, 1), half_width(name, cy, -1))
    rmax = min(rmax, (s["ey"] - eye_h / 2 - 0.04 - cy) / 0.9)  # the spiral stops above the eyes
    steps = int(turns * 40)
    pts = []
    for i in range(steps + 1):
        t = i / steps
        a = t * turns * 2 * math.pi + math.pi * 0.2
        r = rmax * (0.06 + 0.94 * t ** 1.05)
        pts.append((cx + r * math.cos(a), cy + r * math.sin(a) * 0.9))
    return pts


def suture_lines(name, eye_h):
    s = SHAPE[name]
    lines = []
    count = s["sutures"]
    if not count:
        return lines
    n_whorls = s["whorls"]
    top = 1.0 / n_whorls
    for k in range(1, count + 1):
        y = k / n_whorls
        if y > s["ey"] - eye_h / 2 - 0.03 or (y > s["spiral"][1] - 0.04 and name in ("whelk", "conch")):
            break  # the eyes and the body whorl's spiral keep their room
        if abs(y - s["spiral"][1]) < 0.06:
            continue  # the spiral keeps its room
        wl, wr = half_width(name, y, -1) * 0.93, half_width(name, y, 1) * 0.93
        line = []
        for i in range(21):
            t = i / 20
            x = -wl + (wr + wl) * t
            line.append((x, y + 0.18 * top * math.sin(math.pi * t)))
        lines.append(line)
    return lines


# ---------------------------------------------------------------- the reference eyes (traced pieces, moved only)

def cubic(p0, p1, p2, p3, t):
    u = 1 - t
    return tuple(u ** 3 * a + 3 * u * u * t * b + 3 * u * t * t * c + t ** 3 * d for a, b, c, d in zip(p0, p1, p2, p3))


def trace_eye(svg):
    """A potrace path (M, c, l, z, relative) in symbol pixels, as a list of ('M'|'C'|'L'|'Z', points)."""
    d = re.search(r'\sd="([^"]+)"', svg).group(1)
    toks = re.findall(r"[A-Za-z]|-?\d+(?:\.\d+)?", d)
    seg, i, cmd, x, y, start = [], 0, None, 0.0, 0.0, (0.0, 0.0)

    def px(px_, py_):  # symbol pixels: scale(.25) translate(0,1684) scale(.1,-.1)
        return (px_ * 0.025, (1684 - py_ * 0.1) * 0.25)

    while i < len(toks):
        if toks[i].isalpha():
            cmd = toks[i]
            i += 1
            if cmd in "zZ":
                seg.append(("Z", []))
                x, y = start
                continue
        n = {"M": 2, "m": 2, "c": 6, "l": 2}[cmd]
        v = [float(t) for t in toks[i:i + n]]
        i += n
        if cmd == "M":
            x, y = v
            start = (x, y)
            seg.append(("M", [px(x, y)]))
            cmd = "l"
        elif cmd == "c":
            pts = [px(x + v[j], y + v[j + 1]) for j in range(0, 6, 2)]
            seg.append(("C", pts))
            x, y = x + v[4], y + v[5]
        elif cmd == "l":
            x, y = x + v[0], y + v[1]
            seg.append(("L", [px(x, y)]))
    return seg


def eye_box(segs):
    xs = [p[0] for _, pts in segs for p in pts]
    ys = [p[1] for _, pts in segs for p in pts]
    return min(xs), min(ys), max(xs), max(ys)


# ---------------------------------------------------------------- the shells

def r1(v):
    return f"{v:.1f}".rstrip("0").rstrip(".") if abs(v) >= 0.05 else "0"


def build(name, eyes_traced):
    """Everything for one shape in final coordinates: polylines and eye segments in the 100 by 100 box."""
    s = SHAPE[name]
    body = outline(name)
    a = math.radians(s["tilt"])
    ca, sa = math.cos(a), math.sin(a)
    rot = lambda p: (p[0] * ca - (p[1] - 0.5) * sa, p[0] * sa + (p[1] - 0.5) * ca)
    pts_all = [rot(p) for p in body]
    x0, x1 = min(p[0] for p in pts_all), max(p[0] for p in pts_all)
    y0, y1 = min(p[1] for p in pts_all), max(p[1] for p in pts_all)
    k = FIT / max(x1 - x0, y1 - y0)
    ox, oy = 50 - k * (x0 + x1) / 2, 50 - k * (y0 + y1) / 2
    fin = lambda p: (ox + k * rot(p)[0], oy + k * rot(p)[1])
    eye_h = EYE_BOX / k  # the same eye on every shape, in local units
    spiral = [spiral_points(name, eye_h)] + suture_lines(name, eye_h)
    # The eyes: the pair keeps the crab's own spacing and is scaled to the same size on every shape.
    boxes = [eye_box(e) for e in eyes_traced]
    pair_x0, pair_x1 = min(b[0] for b in boxes), max(b[2] for b in boxes)
    pair_y0, pair_y1 = min(b[1] for b in boxes), max(b[3] for b in boxes)
    scale = eye_h / (pair_y1 - pair_y0)
    ocx = (pair_x0 + pair_x1) / 2
    ocy = (pair_y0 + pair_y1) / 2
    ax = s["ex"] * (half_width(name, s["ey"], 1) - half_width(name, s["ey"], -1)) / 2
    eye_local = lambda p: (ax + (p[0] - ocx) * scale, s["ey"] + (p[1] - ocy) * scale)

    body_pts = [fin(p) for p in body]
    spiral_lines = [[fin(p) for p in line] for line in spiral]
    eyes = []
    for segs in eyes_traced:
        out = []
        for cmd, pts in segs:
            out.append((cmd, [fin(eye_local(p)) for p in pts]))
        eyes.append(out)
    return body_pts, spiral_lines, eyes


def path_poly(pts, close_=True):
    d = "M" + " L".join(f"{r1(x)} {r1(y)}" for x, y in pts)
    return d + (" Z" if close_ else "")


def path_eye(segs):
    out = []
    for cmd, pts in segs:
        if cmd == "Z":
            out.append("Z")
        else:
            out.append(cmd + " ".join(f"{r1(x)} {r1(y)}" for x, y in pts))
    return " ".join(out)


def flatten_eye(segs):
    poly, cur = [], None
    for cmd, pts in segs:
        if cmd == "M":
            cur = pts[0]
            poly.append(cur)
        elif cmd == "C":
            for i in range(1, 9):
                poly.append(cubic(cur, *pts, i / 8))
            cur = pts[2]
        elif cmd == "L":
            cur = pts[0]
            poly.append(cur)
    return poly


def tokens():
    d = json.loads(TOKENS.read_text())["color"]
    flat = {}
    for theme in ("light", "dark"):
        for k, v in d[theme].items():
            flat[(theme, k)] = v["value"].upper()
    return flat


def fill_of(tok, theme_first, flat):
    for theme in (theme_first, "light" if theme_first == "dark" else "dark"):
        if (theme, tok) in flat:
            return flat[(theme, tok)]
    raise KeyError(tok)


def lum(h):
    c = [int(h[i:i + 2], 16) / 255 for i in (1, 3, 5)]
    c = [x / 12.92 if x <= 0.03928 else ((x + 0.055) / 1.055) ** 2.4 for x in c]
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]


def contrast(a, b):
    hi, lo = sorted([lum(a), lum(b)], reverse=True)
    return (hi + 0.05) / (lo + 0.05)


def generate():
    parts = json.loads(PARTS.read_text())
    eyes_traced = [trace_eye(parts["eye_l"]["svg"]), trace_eye(parts["eye_r"]["svg"])]
    art = {}
    for name in SHAPES:
        body, spiral, eyes = build(name, eyes_traced)
        art[name] = dict(
            body=path_poly(body),
            spiral=" ".join(path_poly(line, False) for line in spiral),
            eyes=[path_eye(e) for e in eyes],
            _body=body, _spiral=spiral, _eyes=[flatten_eye(e) for e in eyes],
        )
    flat = tokens()
    fills = {c: {"light": fill_of(l, "light", flat), "dark": fill_of(d, "dark", flat)} for c, (l, d) in FILLS.items()}
    return art, fills, flat


def write_ts(art, fills):
    h = hashlib.sha256()
    for p in (PARTS, Path(__file__).resolve(), TOKENS):
        h.update(p.read_bytes())
    lines = [
        "// Generated by scripts/brand/shells.py. Do not edit: run `python3 scripts/brand/shells.py` after changing it,",
        "// then `pnpm --filter @hermit/mobile test`.",
        f"// Sources: docs/brand/mascot/parts.json, docs/brand/tokens.json and scripts/brand/shells.py, sha256 {h.hexdigest()}",
        "//",
        "// The shells every bot but Hermit wears: six gastropod outlines with a cut spiral, drawn by code in the brand",
        "// palette. The eyes are the reference drawing's traced eye pieces (docs/brand/mascot/parts.json), moved and uniformly scaled,",
        "// never redrawn. Each color id has a light and a dark fill, both brand tokens, each 3:1 off its canvas.",
        "",
        "/* eslint-disable */",
        'import type { BotLook } from "@hermit/core";',
        "",
        "export type ShellShape = BotLook[\"shape\"];",
        "export type ShellColor = BotLook[\"color\"];",
        "",
        f"/** The spiral is stroked, {STROKE:g} wide in the box; the eyes are filled. */",
        f"export const SHELL_STROKE = {STROKE:g};",
        "",
        "export const SHELL_ART: Record<ShellShape, { viewBox: string; body: string; spiral: string; eyes: [string, string] }> = {",
    ]
    for name in SHAPES:
        a = art[name]
        lines += [
            f"  {name}: {{",
            '    viewBox: "0 0 100 100",',
            f"    body: {json.dumps(a['body'])},",
            f"    spiral: {json.dumps(a['spiral'])},",
            f"    eyes: [{json.dumps(a['eyes'][0])}, {json.dumps(a['eyes'][1])}],",
            "  },",
        ]
    lines += ["};", "", "export const SHELL_FILL: Record<ShellColor, { light: string; dark: string }> = {"]
    for c, f in fills.items():
        lines.append(f'  {c}: {{ light: "{f["light"]}", dark: "{f["dark"]}" }},')
    lines += ["};", ""]
    return "\n".join(lines)


def draw(dr, art, name, fill, canvas, ox, oy, k):
    tx = lambda p: (ox + p[0] * k, oy + p[1] * k)
    dr.polygon([tx(p) for p in art[name]["_body"]], fill=fill)
    for line in art[name]["_spiral"]:
        dr.line([tx(p) for p in line], fill=canvas, width=max(1, int(STROKE * k)), joint="curve")
        for p in (line[0], line[-1]):
            x, y = tx(p)
            rr = STROKE * k / 2
            dr.ellipse([x - rr, y - rr, x + rr, y + rr], fill=canvas)
    for e in art[name]["_eyes"]:
        dr.polygon([tx(p) for p in e], fill=canvas)


def sheet(art, fills, theme, canvas):
    """One row per color at 200 px, then a row at the roster's real 40 px: every shape in the four colors."""
    from PIL import Image, ImageDraw
    cell, ss, real = 200, 4, 40
    cols = len(SHAPES)
    w, h = cols * cell, (len(fills) + 1) * cell - cell // 2
    img = Image.new("RGB", (w * ss, h * ss), canvas)
    dr = ImageDraw.Draw(img)
    for r, (cid, f) in enumerate(fills.items()):
        for c, name in enumerate(SHAPES):
            draw(dr, art, name, f[theme], canvas, (c + 0.04) * cell * ss, (r + 0.04) * cell * ss, cell * ss * 0.92 / 100)
    y0 = len(fills) * cell + (cell // 2 - real) // 2
    for c, name in enumerate(SHAPES):
        for i, f in enumerate(fills.values()):
            draw(dr, art, name, f[theme], canvas, (c * cell + 8 + i * (real + 6)) * ss, y0 * ss, real * ss / 100)
    return img.resize((w, h), Image.LANCZOS)


def main():
    art, fills, flat = generate()
    canvases = {"light": flat[("light", "paper")], "dark": flat[("dark", "abyss")]}
    for cid, f in fills.items():
        for theme, canvas in canvases.items():
            assert contrast(f[theme], canvas) >= 3, (cid, theme)
            assert f[theme] not in (flat[("light", "coral")], flat[("light", "amber")], flat[("dark", "coral")], flat[("dark", "amber")]), (cid, theme)
    text = write_ts(art, fills)
    if "--check" in sys.argv:
        if not OUT.exists() or OUT.read_text() != text:
            print("shells.ts is out of date: run python3 scripts/brand/shells.py")
            sys.exit(1)
        print("shells.ts is up to date")
        return
    OUT.write_text(text)
    SHEETS.mkdir(parents=True, exist_ok=True)
    for theme, canvas in canvases.items():
        sheet(art, fills, theme, canvas).save(SHEETS / f"shells-{theme}.png", optimize=True)
    print(f"wrote {OUT.relative_to(ROOT)} and {len(canvases)} contact sheets in {SHEETS.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
