"""Makes the app's static brand fonts from the variable fonts in the google/fonts repo (SIL OFL 1.1).

Usage (fontTools 4.x on the path, the downloads in their own folder, never run from inside it):

    python3 -I scripts/fonts/instance_fonts.py <download dir> apps/mobile/assets/fonts

<download dir> holds the files below, fetched from https://github.com/google/fonts/tree/main/ofl. Each is checked
against the SHA-256 pinned here before anything is read, so a changed upstream file stops the run instead of
shipping. Writes one static TTF per face the app uses and copies each family's OFL.txt next to them.

- Newsreader, one display face: optical size 36 (the titles and the large amounts are set at 26 to 64), weight 450,
  between Regular and Medium, so the serif holds on paper and on Deep sea alike (docs/design/polish/decisions.md).
- Instrument Sans at width 100: Regular 400, Medium 500 and SemiBold 600.
- JetBrains Mono: Regular 400 and Medium 500.

The OFL files declare no Reserved Font Name, so the instances keep the families' names.
"""

import hashlib
import shutil
import sys
from pathlib import Path

from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont

SOURCES = {
    "Newsreader[opsz,wght].ttf": "8a08d13f8a6c0d51be379a60af84f945f65369a67e509ee3c3bdcc421254d7c1",
    "InstrumentSans[wdth,wght].ttf": "b24f1812584816958afcf22e22d08e44318c5e51651e25d2438efdde389b33b1",
    "JetBrainsMono[wght].ttf": "48715a42ec242c21e9f02692891e147d022299a52e48d5e413e1a942193ffeda",
    "OFL-Newsreader.txt": "fdfad38143ec470553cae82a1e45320bdd1b9ec70415d37bd0171051d8a4ded8",
    "OFL-InstrumentSans.txt": "9e27a72ed30eb49a08678f6a5d6ed98ec7ba5368f541637ee0683ec9134ef966",
    "OFL-JetBrainsMono.txt": "b2fe5e8987594e9ffd1d2ca52a2f5d73eb8335243893c5d6254b5ad69269591d",
}

# (variable source, output file, family, style name, axis location, weight class)
FACES = [
    ("Newsreader[opsz,wght].ttf", "Newsreader-Display.ttf", "Newsreader Display", "Regular", {"opsz": 36, "wght": 450}, 400),
    ("InstrumentSans[wdth,wght].ttf", "InstrumentSans-Regular.ttf", "Instrument Sans", "Regular", {"wdth": 100, "wght": 400}, 400),
    ("InstrumentSans[wdth,wght].ttf", "InstrumentSans-Medium.ttf", "Instrument Sans", "Medium", {"wdth": 100, "wght": 500}, 500),
    ("InstrumentSans[wdth,wght].ttf", "InstrumentSans-SemiBold.ttf", "Instrument Sans", "SemiBold", {"wdth": 100, "wght": 600}, 600),
    ("JetBrainsMono[wght].ttf", "JetBrainsMono-Regular.ttf", "JetBrains Mono", "Regular", {"wght": 400}, 400),
    ("JetBrainsMono[wght].ttf", "JetBrainsMono-Medium.ttf", "JetBrains Mono", "Medium", {"wght": 500}, 500),
]


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def rename(font: TTFont, family: str, style: str, weight: int) -> None:
    """Names a static face so Android, the web and font tools agree on what it is."""
    regular = style == "Regular"
    full = family if regular else f"{family} {style}"
    postscript = f"{family.replace(' ', '')}-{style}"
    version = font["name"].getDebugName(5) or "Version 1.000"
    names = {
        1: family if style in ("Regular", "Bold") else f"{family} {style}",
        2: style if style in ("Regular", "Bold") else "Regular",
        3: f"{version.replace('Version ', '')};HERMIT;{postscript}",
        4: full,
        6: postscript,
        16: family,
        17: style,
    }
    table = font["name"]
    # Drop the variable font's leftovers (axis and instance names) before writing the static ones.
    table.names = [n for n in table.names if n.nameID < 256 and n.nameID not in (25,)]
    for name_id, text in names.items():
        table.setName(text, name_id, 3, 1, 0x409)
        table.setName(text, name_id, 1, 0, 0)
    os2 = font["OS/2"]
    os2.usWeightClass = weight
    os2.fsSelection = (os2.fsSelection & ~0b1100001) | (0b1000000 if regular else 0)
    font["head"].macStyle = 0


def main(src_dir: str, out_dir: str) -> None:
    src, out = Path(src_dir), Path(out_dir)
    for name, digest in SOURCES.items():
        got = sha256(src / name)
        if got != digest:
            sys.exit(f"{name}: SHA-256 {got} is not the pinned {digest}; refusing to build")
    out.mkdir(parents=True, exist_ok=True)
    for source, file, family, style, location, weight in FACES:
        font = instantiateVariableFont(TTFont(src / source), location)
        for leftover in ("STAT", "MVAR", "HVAR", "avar"):
            if leftover in font:
                del font[leftover]
        rename(font, family, style, weight)
        font.save(out / file)
        print(f"{file}: {location}, {(out / file).stat().st_size} bytes")
    for license_file in ("OFL-Newsreader.txt", "OFL-InstrumentSans.txt", "OFL-JetBrainsMono.txt"):
        shutil.copyfile(src / license_file, out / license_file)


if __name__ == "__main__":
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    main(sys.argv[1], sys.argv[2])
