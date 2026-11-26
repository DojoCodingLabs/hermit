#!/usr/bin/env python3
"""Replace the old generated crab and logo in each UI mockup with the matching rig pose or traced logo.

Each patch: fill the old crab's box with the surrounding background, then center the new
pose (docs/brand/mascot/png) inside it. Boxes were measured on the 1024x1536 mockups.
"""
from pathlib import Path
from PIL import Image, ImageDraw

BRAND = Path(__file__).resolve().parents[2] / "docs" / "brand"

PATCHES = {
    "ui-activity-light": [((226, 506, 350, 612), "01-idle"), ((220, 680, 362, 788), "04-asking"),
                          ((220, 860, 360, 982), "07-blocked"), ((226, 1058, 345, 1162), "12-remember")],
    "ui-approval-light": [((388, 522, 640, 710), "04-asking")],
    "ui-chat-light": [((150, 915, 296, 1050), "01-idle"), ((158, 166, 284, 282), "logo:symbol-ink")],
    "ui-onboarding": [((180, 150, 850, 570), "11-new-phone")],
    "ui-chat-dark": [((640, 165, 862, 372), "09-sleeping-dark", (620, 260)), ((172, 188, 314, 336), "logo:symbol-foam", (160, 260)),
                     ((166, 558, 262, 656), "logo:symbol-foam", (150, 600)), ((166, 978, 262, 1076), "logo:symbol-foam", (150, 1020))],
}


def fitted(pose: str, w: int, h: int) -> Image.Image:
    src = BRAND / "logo" / "png" / f"{pose[5:]}.png" if pose.startswith("logo:") else BRAND / "mascot" / "png" / f"{pose}.png"
    im = Image.open(src).convert("RGBA")
    im = im.crop(im.getbbox())
    s = min(w / im.width, h / im.height)
    return im.resize((max(1, int(im.width * s)), max(1, int(im.height * s))), Image.LANCZOS)


def main() -> None:
    for name, patches in PATCHES.items():
        path = BRAND / "ui" / f"{name}.png"
        img = Image.open(path).convert("RGB")
        draw = ImageDraw.Draw(img)
        for (x0, y0, x1, y1), pose, *where in patches:
            # the card or screen color just left of the old crab, unless a sample point is given
            bg = img.getpixel(where[0] if where else (x0 - 4, (y0 + y1) // 2))
            draw.rounded_rectangle((x0, y0, x1, y1), radius=12, fill=bg)
            art = fitted(pose, x1 - x0 - 8, y1 - y0 - 8)
            img.paste(art, (x0 + (x1 - x0 - art.width) // 2, y0 + (y1 - y0 - art.height) // 2), art)
        img.save(path)
        print("patched", name, len(patches))


if __name__ == "__main__":
    main()
