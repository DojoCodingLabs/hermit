#!/usr/bin/env python3
"""Generate or edit Hermit brand images with the OpenAI Image API.

Every run writes the image(s) plus a sidecar JSON with the exact request,
so any asset in docs/brand/ can be reproduced.

Usage:
  gen.py generate OUT_BASENAME PROMPT_FILE [--size 1536x1024] [--quality medium]
         [--complexity high] [--background auto] [--format png] [--n 1] [--model ...]
  gen.py edit OUT_BASENAME PROMPT_FILE --ref a.png --ref b.png [same options]

Reads OPENAI_API_KEY from the environment. Uses curl (no Python deps).
"""
import argparse
import base64
import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path

API = "https://api.openai.com/v1/images"
DEFAULT_MODEL = "gpt-image-2.6-sunburst"


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("mode", choices=["generate", "edit"])
    ap.add_argument("out", help="output path without extension")
    ap.add_argument("prompt_file")
    ap.add_argument("--model", default=DEFAULT_MODEL)
    ap.add_argument("--size", default="1536x1024")
    ap.add_argument("--quality", default="medium")
    ap.add_argument("--complexity", default=None)
    ap.add_argument("--background", default=None)
    ap.add_argument("--format", default="png")
    ap.add_argument("--n", type=int, default=1)
    ap.add_argument("--ref", action="append", default=[])
    ap.add_argument("--svg-model", default="gpt-5.5")
    a = ap.parse_args()

    key = os.environ.get("OPENAI_API_KEY")
    if not key:
        print("OPENAI_API_KEY not set", file=sys.stderr)
        return 2
    prompt = Path(a.prompt_file).read_text().strip()
    params = {"model": a.model, "prompt": prompt, "size": a.size, "quality": a.quality,
              "n": a.n, "output_format": a.format}
    if a.complexity:
        params["complexity"] = a.complexity
    if a.background:
        params["background"] = a.background
    if a.format == "svg":
        # SVG is generation-only; a text model writes the vector code. n must be 1.
        if a.mode == "edit":
            print("svg output is not available on /edits", file=sys.stderr)
            return 2
        params["svg"] = {"model": a.svg_model}
        params["n"] = 1

    if a.mode == "generate":
        body = tempfile.NamedTemporaryFile("w", suffix=".json", delete=False)
        json.dump(params, body)
        body.close()
        cmd = ["curl", "-sS", "-X", "POST", f"{API}/generations",
               "-H", f"Authorization: Bearer {key}", "-H", "Content-Type: application/json",
               "--data-binary", f"@{body.name}"]
    else:
        if not a.ref:
            print("edit mode needs at least one --ref", file=sys.stderr)
            return 2
        cmd = ["curl", "-sS", "-X", "POST", f"{API}/edits", "-H", f"Authorization: Bearer {key}"]
        for k, v in params.items():
            cmd += ["-F", f"{k}={v}"]
        for r in a.ref:
            cmd += ["-F", f"image[]=@{r}"]

    res = subprocess.run(cmd, capture_output=True, text=True, timeout=900)
    try:
        data = json.loads(res.stdout)
    except json.JSONDecodeError:
        print(res.stdout[:2000], res.stderr[:2000], file=sys.stderr)
        return 1
    if "error" in data:
        print(json.dumps(data["error"], indent=2), file=sys.stderr)
        return 1

    out = Path(a.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    ext = "svg" if a.format == "svg" else a.format
    written = []
    for i, item in enumerate(data.get("data", [])):
        suffix = "" if len(data["data"]) == 1 else f"-{i + 1}"
        path = out.with_name(f"{out.name}{suffix}.{ext}")
        path.write_bytes(base64.b64decode(item["b64_json"]))
        written.append(str(path))

    sidecar = {k: v for k, v in params.items()}
    sidecar.update(mode=a.mode, refs=a.ref, outputs=written, usage=data.get("usage"))
    out.with_name(out.name + ".json").write_text(json.dumps(sidecar, indent=2, ensure_ascii=False))
    print("\n".join(written))
    return 0


if __name__ == "__main__":
    sys.exit(main())
