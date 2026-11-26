#!/usr/bin/env python3
"""Build the official Hermit logo files by tracing the reference drawing (docs/brand/logo/source/reference-drawing.png).

The reference is the source of truth: a solid shell with a cut-out spiral, a crab peeking
out with a domed head, two dot eyes, two pincers and two legs, next to the HERMIT wordmark.
This script splits symbol and wordmark, traces both with potrace, and writes one-color
variants. Requires: potrace (brew install potrace), Pillow.

Usage: logo_from_trace.py
"""
import re
import subprocess
import tempfile
from pathlib import Path

from PIL import Image, ImageOps

BRAND = Path(__file__).resolve().parents[2] / "docs" / "brand"
REFERENCE = BRAND / "logo" / "source" / "reference-drawing.png"
COLORS = {"ink": "#2B221B", "paper": "#F5EDE1", "foam": "#E7F1F0", "glow": "#5EF0CF"}
SCALE = 4  # trace at 4x for smooth curves


def split(bw: Image.Image) -> tuple[Image.Image, Image.Image]:
    """The symbol ends where the first fully empty band of columns begins, left of the wordmark."""
    px = bw.load()
    empty = [x for x in range(bw.width // 3, bw.width // 2) if all(px[x, y] == 255 for y in range(bw.height))]
    cut = empty[len(empty) // 2]
    parts = []
    for box in ((0, 0, cut, bw.height), (cut, 0, bw.width, bw.height)):
        part = bw.crop(box)
        parts.append(part.crop(ImageOps.invert(part).getbbox()))
    return parts[0], parts[1]


def trace(part: Image.Image) -> tuple[str, int, int]:
    """Returns (path data, width, height) in the part's pixel units."""
    big = part.resize((part.width * SCALE, part.height * SCALE), Image.LANCZOS).point(lambda v: 0 if v < 128 else 255).convert("1")
    with tempfile.TemporaryDirectory() as tmp:
        pbm, svg = Path(tmp, "in.pbm"), Path(tmp, "out.svg")
        big.save(pbm)
        subprocess.run(["potrace", str(pbm), "-s", "-o", str(svg), "--turdsize", "20", "--alphamax", "1.0", "--opttolerance", "0.2"], check=True)
        text = svg.read_text()
    group = re.search(r"<g transform=\"([^\"]+)\"[^>]*>(.*?)</g>", text, re.S)
    transform, body = group.group(1), group.group(2)
    paths = " ".join(re.findall(r'd="([^"]+)"', body))
    return f'<g transform="scale({1 / SCALE}) {transform}"><path d="{paths}"/></g>', part.width, part.height


def write(name: str, art: str, w: int, h: int, color: str, pad: float = 0.0) -> None:
    p = round(max(w, h) * pad)
    svg = (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{-p} {-p} {w + 2 * p} {h + 2 * p}" width="{w + 2 * p}" height="{h + 2 * p}">'
           f'<title>Hermit</title><g fill="{color}">{art}</g></svg>\n')
    (BRAND / "logo" / f"{name}.svg").write_text(svg)


def main() -> None:
    bw = Image.open(REFERENCE).convert("L").point(lambda v: 0 if v < 110 else 255)
    symbol, wordmark = split(bw)
    sym_art, sw, sh = trace(symbol)
    word_art, ww, wh = trace(wordmark)
    for color in ("ink", "paper", "foam"):
        write(f"symbol-{color}", sym_art, sw, sh, COLORS[color], pad=0.08)
        write(f"wordmark-{color}", word_art, ww, wh, COLORS[color])
    # horizontal lockup, same spacing as the reference: wordmark centered on the symbol's mid-height
    gap = round(sw * 0.12)
    wy = round(sh * 0.5 - wh * 0.5)
    for color in ("ink", "paper", "foam"):
        lock = f'{sym_art}<g transform="translate({sw + gap} {wy})">{word_art}</g>'
        write(f"lockup-{color}", lock, sw + gap + ww, sh, COLORS[color], pad=0.04)
    print("symbol", sw, sh, "wordmark", ww, wh)


if __name__ == "__main__":
    main()
