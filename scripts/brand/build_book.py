#!/usr/bin/env python3
"""Render docs/brand/index.html from book.template.html, tokens.json and the traced logo."""
import json
import re
from pathlib import Path

BRAND = Path(__file__).resolve().parents[2] / "docs" / "brand"


def swatches(theme: dict) -> str:
    out = []
    for name, t in theme.items():
        contrast = f"<br><code>{t['contrast']:.1f}:1 on background</code>" if "contrast" in t else ""
        out.append(
            f'<div class="sw"><div class="chip" style="background:{t["value"]}"></div>'
            f'<div class="meta"><b>{name}</b><code>{t["value"]}</code>{contrast}<br>{t["role"]}</div></div>')
    return "\n      ".join(out)


def symbol() -> str:
    """The hero mark: the traced logo, inline so it inherits no external requests."""
    svg = (BRAND / "logo" / "symbol-ink.svg").read_text()
    return svg.replace("<svg ", '<svg role="img" aria-label="Hermit" class="hero-mark" ', 1)


def main() -> None:
    tokens = json.loads((BRAND / "tokens.json").read_text())
    html = (BRAND / "book.template.html").read_text()
    html = html.replace("{{SYMBOL}}", symbol())
    html = html.replace("{{SWATCHES_LIGHT}}", swatches(tokens["color"]["light"]))
    html = html.replace("{{SWATCHES_DARK}}", swatches(tokens["color"]["dark"]))
    (BRAND / "index.html").write_text(html)
    print(BRAND / "index.html")


if __name__ == "__main__":
    main()
