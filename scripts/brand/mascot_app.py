#!/usr/bin/env python3
"""Exports the mascot rig to the app as data: apps/mobile/src/mascot-rig.ts.

The app draws the crab with react-native-svg from the exact pieces scripts/brand/mascot.py traced from the reference
drawing (docs/brand/mascot/parts.json), placed by the same pose table (POSES and EXTRA). Nothing is drawn here.
For every pose this script runs mascot.render() with a recording Layers and writes down what it did: which piece
is drawn with which transform, which piece cuts its paper gap into what came before, what is carved out of the
shell, and which props stand where. Transforms are also written as numbers an animation can interpolate:
translate, rotate and scale about the piece's own pivot (the centre of its traced box).

Usage:
  mascot_app.py           # write apps/mobile/src/mascot-rig.ts
  mascot_app.py --check   # exit 1 if the committed file is out of date
"""
import hashlib
import json
import math
import re
import sys
import xml.etree.ElementTree as ET
from pathlib import Path

sys.dont_write_bytecode = True  # importing the rig leaves no __pycache__ next to it
sys.path.insert(0, str(Path(__file__).resolve().parent))
import mascot  # noqa: E402  (scripts/brand/mascot.py, the rig)

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "apps" / "mobile" / "src" / "mascot-rig.ts"
SOURCES = [mascot.PARTS, Path(mascot.__file__).resolve(), Path(__file__).resolve()]

# The pieces in the order render() draws them. shell_small is the second, smaller shell of the Boost pose.
PIECES = ["shell_small", "shell", "head", "leg_out", "eye_l", "eye_r", "claw_l", "claw_r"]
PATH_OF = {"shell_small": "shell"}


# ---------------------------------------------------------------- transforms

def parse_transform(text):
    """An SVG transform list to a matrix (a, b, c, d, e, f). Only what the rig writes: translate, rotate, scale."""
    m = (1.0, 0.0, 0.0, 1.0, 0.0, 0.0)
    for name, args in re.findall(r"(\w+)\(([^)]*)\)", text or ""):
        v = [float(x) for x in re.split(r"[\s,]+", args.strip()) if x]
        if name == "translate":
            step = (1, 0, 0, 1, v[0], v[1] if len(v) > 1 else 0.0)
        elif name == "scale":
            sx = v[0]
            sy = v[1] if len(v) > 1 else sx
            step = (sx, 0, 0, sy, 0, 0)
        elif name == "rotate":
            a = math.radians(v[0])
            cos, sin = math.cos(a), math.sin(a)
            cx, cy = (v[1], v[2]) if len(v) == 3 else (0.0, 0.0)
            step = (cos, sin, -sin, cos, cx - cos * cx + sin * cy, cy - sin * cx - cos * cy)
        elif name == "matrix":
            step = tuple(v)
        else:
            raise ValueError(f"unexpected transform {name} in {text!r}")
        m = mul(m, step)
    return m


def mul(m, n):
    a, b, c, d, e, f = m
    a2, b2, c2, d2, e2, f2 = n
    return (a * a2 + c * b2, b * a2 + d * b2, a * c2 + c * d2, b * c2 + d * d2, a * e2 + c * f2 + e, b * e2 + d * f2 + f)


def decompose(m, pivot):
    """m as translate(tx ty) rotate(rot about pivot) scale(s about pivot): the numbers a spring interpolates."""
    a, b, c, d, e, f = m
    s = math.sqrt(a * d - b * c)
    rot = math.degrees(math.atan2(b, a))
    if abs(a - s * math.cos(math.radians(rot))) > 1e-9 or abs(d - a) > 1e-9 or abs(c + b) > 1e-9:
        raise ValueError(f"not a rotation and uniform scale: {m}")
    px, py = pivot
    tx = e - px + (a * px + c * py)
    ty = f - py + (b * px + d * py)
    return [tx, ty, rot, s]


def compose(ch, pivot):
    """The inverse of decompose, to check every pose round-trips."""
    tx, ty, rot, s = ch
    r = math.radians(rot)
    a, b = s * math.cos(r), s * math.sin(r)
    px, py = pivot
    return (a, b, -b, a, tx + px - (a * px - b * py), ty + py - (b * px + a * py))


def num(v, digits=6):
    v = round(v, digits)
    if v == 0:
        v = 0.0
    text = f"{v:.{digits}f}".rstrip("0").rstrip(".")
    return text if text not in ("-0", "") else "0"


# ---------------------------------------------------------------- what render() does

class Recorder(mascot.Layers):
    """mascot.Layers, writing down every call render() makes."""

    last = None

    def __init__(self, extent):
        super().__init__(extent)
        self.ops = []
        Recorder.last = self

    def add(self, svg, cut=False, unit=1.0):
        self.ops.append({"op": "add", "svg": svg, "cut": cut, "unit": unit})
        super().add(svg, cut, unit)

    def carve(self, svg, unit=1.0):
        self.ops.append({"op": "carve", "svg": svg, "unit": unit})
        super().carve(svg, unit)


def record(parts, pose):
    plain = mascot.render(parts, pose)
    real = mascot.Layers
    mascot.Layers = Recorder
    try:
        svg = mascot.render(parts, pose)
    finally:
        mascot.Layers = real
    assert svg == plain, "recording changed the drawing"
    return Recorder.last.ops, svg


def fragment(svg):
    # Only markup mascot.py itself just generated in this process is parsed (no DTD, no outside input).
    return list(ET.fromstring(f"<r>{svg}</r>"))


def path_d(text):
    return " ".join(text.split())


def main():
    parts = mascot.load()
    base_text = re.match(r'<g transform="([^"]+)">', parts["shell"]["svg"]).group(1)
    base = parse_transform(base_text)
    d_of = {}
    for name in ("shell", "head", "leg_out", "eye_l", "eye_r", "claw_l", "claw_r"):
        g = re.match(r'<g transform="([^"]+)"><path d="([^"]+)"/></g>$', parts[name]["svg"], re.S)
        assert g and g.group(1) == base_text, f"{name}: every traced piece shares one transform"
        d_of[name] = g.group(2)
    by_d = {path_d(d): name for name, d in d_of.items()}

    def box(piece):
        return parts[PATH_OF.get(piece, piece)]["box"]

    def pivot(piece):
        return mascot.center(box(piece))

    closed_d = {e: re.search(r'd="([^"]+)"', mascot.closed_eye(parts[e]["box"], "FG")).group(1) for e in ("eye_l", "eye_r")}
    closed_w = float(re.search(r'stroke-width="([^"]+)"', mascot.closed_eye(parts["eye_l"]["box"], "FG")).group(1))

    # The peek pose's carve: the eyes, moved onto the shell, and the closed strokes for the sleeping pose.
    peek_ops, _ = record(parts, mascot.EXTRA["peek"])
    peek_eyes = fragment(peek_ops[-1]["svg"])
    peek_t = peek_eyes[0].get("transform")
    peek_shift = parse_transform(peek_t)
    sleep_ops, _ = record(parts, mascot.POSES["09-sleeping"])
    carve_closed = {}
    for el in fragment(next(o for o in sleep_ops if o["op"] == "carve")["svg"]):
        cx = float(re.match(r"M([-\d.]+)", el.get("d")).group(1))
        eye = min(("eye_l", "eye_r"), key=lambda e: abs(mascot.center(parts[e]["box"])[0] + peek_shift[4] - 11 - cx))
        carve_closed[eye] = el.get("d")

    viewbox = None
    poses = {}
    for name, pose in {**mascot.POSES, **mascot.EXTRA}.items():
        ops, svg = record(parts, pose)
        vb = [float(x) for x in re.search(r'viewBox="([^"]+)"', svg).group(1).split()]
        assert viewbox in (None, vb), "one canvas for every pose"
        viewbox = vb
        placed, props, carve, closed = {}, [], None, False
        order = []
        prop_queue = list(pose.get("props", ()))
        for op in ops:
            if op["op"] == "carve":
                els = fragment(op["svg"])
                carve = "closed" if els[0].tag == "path" and els[0].get("stroke-width") else "open"
                if carve == "open":
                    assert all(e.get("transform") == peek_t for e in els), name
                order.append("carve")
                continue
            for el in fragment(op["svg"]):
                inner = list(el)
                if el.tag == "path":  # a closed eye, drawn as the rig's stroke
                    eye = next(e for e in ("eye_l", "eye_r") if closed_d[e] == el.get("d"))
                    placed[eye] = {"t": "", "cut": op["cut"]}
                    closed = True
                    order.append(eye)
                elif inner and inner[0].tag == "g" and len(inner) == 1 and inner[0].get("transform") == base_text:
                    piece = by_d[path_d(inner[0][0].get("d"))]
                    if piece == "shell" and "shell" in placed:
                        raise AssertionError(f"{name}: two shells drawn without the Boost flag")
                    if piece == "shell" and pose.get("beside") and "shell_small" not in placed:
                        piece = "shell_small"
                    placed[piece] = {"t": el.get("transform") or "", "cut": op["cut"], "unit": op["unit"]}
                    order.append(piece)
                else:  # a prop, in the order the pose lists them
                    kind, x, y, *sc = prop_queue.pop(0)
                    expect = mascot.prop(kind, x, y, "FG", "ACCENT", *(sc or [1.0]))
                    got = ET.tostring(el, encoding="unicode")
                    assert fragment(expect)[0].get("transform") == el.get("transform"), (name, kind)
                    assert len(got) > 0
                    props.append({"kind": kind, "x": float(x), "y": float(y), "s": float(sc[0]) if sc else 1.0, "cut": op["cut"]})
                    order.append(f"prop:{kind}")
        assert not prop_queue, name
        # The app draws every pose in one fixed order (shell_small, shell, head, leg_out, eyes, claws, carve, props).
        fixed = [p for p in PIECES if p in order] + (["carve"] if carve else []) + [o for o in order if o.startswith("prop:")]
        assert order == fixed, f"{name}: render() order {order} is not the app's {fixed}"
        poses[name] = {"placed": placed, "props": props, "carve": carve, "closed": closed}

    # Which props really cut into something: a prop's cut is drawn only where the prop (grown by its gap) can
    # overlap a piece drawn before it. Boxes are conservative, so a skipped cut never changes a pixel.
    def piece_bounds(piece, t):
        m = parse_transform(t)
        x0, y0, x1, y1 = box(piece)
        pts = [(m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]) for x, y in ((x0, y0), (x1, y0), (x0, y1), (x1, y1))]
        return min(p[0] for p in pts), min(p[1] for p in pts), max(p[0] for p in pts), max(p[1] for p in pts)

    prop_reach = {}
    for kind in ("envelope", "note", "pearl", "bubbles", "moon", "plane", "mic", "phone", "zz", "dots"):
        prop_reach[kind] = prop_extent(mascot.prop(kind, 0, 0, "FG", "ACCENT", 1.0))

    for name, p in poses.items():
        # A closed eye's stroke reaches a little past the traced eye's box: every box grows by 5.
        drawn = [tuple(b + g for b, g in zip(piece_bounds(k, v["t"]), (-5, -5, 5, 5))) for k, v in p["placed"].items()]
        for pr in p["props"]:
            x0, y0, x1, y1 = prop_reach[pr["kind"]]
            pad = mascot.GAP + 2
            reach = (pr["x"] + x0 * pr["s"] - pad, pr["y"] + y0 * pr["s"] - pad, pr["x"] + x1 * pr["s"] + pad, pr["y"] + y1 * pr["s"] + pad)
            hits = any(not (reach[2] < b[0] or b[2] < reach[0] or reach[3] < b[1] or b[3] < reach[1]) for b in drawn)
            pr["cut"] = bool(pr["cut"] and hits)
            drawn.append(reach)

    write(parts, d_of, base, viewbox, closed_d, closed_w, peek_shift, carve_closed, poses, pivot, box)


def path_points(d):
    """Points that bound a prop's path: every end and control point; an arc adds its whole circle's box."""
    tokens = re.findall(r"[A-Za-z]|-?\d+(?:\.\d+)?", d)
    pts, x, y, start, i, cmd = [], 0.0, 0.0, (0.0, 0.0), 0, None
    arity = {"M": 2, "L": 2, "H": 1, "V": 1, "Q": 4, "C": 6, "A": 7, "Z": 0}
    while i < len(tokens):
        if tokens[i].isalpha():
            cmd = tokens[i]
            i += 1
            if cmd in "Zz":
                x, y = start
                continue
        n = arity[cmd.upper()]
        v = [float(t) for t in tokens[i:i + n]]
        i += n
        rel = cmd.islower()
        ox, oy = (x, y) if rel else (0.0, 0.0)
        up = cmd.upper()
        if up == "H":
            x = v[0] + (x if rel else 0)
        elif up == "V":
            y = v[0] + (y if rel else 0)
        elif up == "A":
            rx, ry = v[0], v[1]
            pts += [(x - 2 * rx, y - 2 * ry), (x + 2 * rx, y + 2 * ry)]
            x, y = v[5] + ox, v[6] + oy
        else:
            pts += [(v[j] + ox, v[j + 1] + oy) for j in range(0, n - 2, 2)]
            x, y = v[n - 2] + ox, v[n - 1] + oy
        pts.append((x, y))
        if up == "M":
            start = (x, y)
            cmd = "l" if rel else "L"
    return pts


def prop_extent(markup):
    """A prop's reach in its own coordinates, never smaller than the real one, grown by its widest stroke."""
    pts = []
    widest = 0.0
    for el in fragment(markup)[0].iter():
        a = el.attrib
        widest = max(widest, float(a.get("stroke-width", 0)) / 2)
        if el.tag == "rect":
            pts += [(float(a["x"]), float(a["y"])), (float(a["x"]) + float(a["width"]), float(a["y"]) + float(a["height"]))]
        elif el.tag == "circle":
            r, cx, cy = float(a["r"]), float(a.get("cx", 0)), float(a.get("cy", 0))
            pts += [(cx - r, cy - r), (cx + r, cy + r)]
        elif el.tag == "path":
            pts += path_points(a["d"])
    xs, ys = [p[0] for p in pts], [p[1] for p in pts]
    ext = (min(xs), min(ys), max(xs), max(ys))
    if "rotate" in markup:  # the plane is turned: any turn stays inside the circle through its farthest point
        r = max(math.hypot(px, py) for px, py in pts)
        ext = (-r, -r, r, r)
    return ext[0] - widest, ext[1] - widest, ext[2] + widest, ext[3] + widest


# ---------------------------------------------------------------- props as element trees

ROLE = {"FG": "fg", "ACCENT": "accent", mascot.PAPER: "paper"}
NUMERIC = {"x", "y", "width", "height", "rx", "r", "cx", "cy", "stroke-width"}


def prop_tree(kind):
    root = fragment(mascot.prop(kind, 0, 0, "FG", "ACCENT", 1.0))[0]

    def conv(el):
        attrs = {}
        for k, v in el.attrib.items():
            key = re.sub(r"-(\w)", lambda m: m.group(1).upper(), k)
            if k in ("fill", "stroke"):
                attrs[key] = ROLE.get(v, v)
            elif k == "transform":
                attrs["matrix"] = [float(num(x)) for x in parse_transform(v)]
            elif k in NUMERIC:
                attrs[key] = float(v)
            else:
                attrs[key] = v
        out = {"tag": el.tag, "attrs": attrs}
        kids = [conv(c) for c in el]
        if kids:
            out["children"] = kids
        return out

    return [conv(c) for c in root]


# ---------------------------------------------------------------- the TypeScript module

def ts_value(v, indent=0):
    pad = "  " * indent
    if isinstance(v, bool):
        return "true" if v else "false"
    if isinstance(v, (int, float)):
        return num(float(v))
    if isinstance(v, str):
        return json.dumps(v)
    if v is None:
        return "null"
    if isinstance(v, (list, tuple)):
        if all(isinstance(x, (int, float, str, bool)) for x in v):
            return "[" + ", ".join(ts_value(x) for x in v) + "]"
        return "[\n" + "".join(f"{pad}  {ts_value(x, indent + 1)},\n" for x in v) + f"{pad}]"
    if isinstance(v, dict):
        if not v:
            return "{}"
        items = []
        for k, x in v.items():
            key = k if re.match(r"^[A-Za-z_]\w*$", k) else json.dumps(k)
            items.append(f"{pad}  {key}: {ts_value(x, indent + 1)},\n")
        return "{\n" + "".join(items) + f"{pad}}}"
    raise TypeError(type(v))


def write(parts, d_of, base, viewbox, closed_d, closed_w, peek_shift, carve_closed, poses, pivot, box):
    hashes = {str(p.relative_to(ROOT)): hashlib.sha256(p.read_bytes()).hexdigest() for p in SOURCES}
    pieces = {}
    for piece in PIECES:
        info = {"path": PATH_OF.get(piece, piece), "box": box(piece), "pivot": list(pivot(piece))}
        if piece.startswith("claw"):
            x0, _, x1, y1 = box(piece)
            info["wrist"] = [(x0 + x1) / 2, y1]
        pieces[piece] = info

    rig_poses = {}
    for name, p in poses.items():
        placed = {}
        for piece in PIECES:
            if piece not in p["placed"]:
                continue
            v = p["placed"][piece]
            m = parse_transform(v["t"])
            ch = decompose(m, pivot(piece))
            back = compose(ch, pivot(piece))
            assert all(abs(x - y) < 1e-9 for x, y in zip(back, m)), (name, piece)
            entry = {"t": v["t"], "m": [float(num(x, 9)) for x in m], "ch": [float(num(x, 9)) for x in ch]}
            if piece.startswith("claw"):
                entry["cut"] = bool(v["cut"])
            placed[piece] = entry
        rig_poses[name] = {
            "pieces": placed,
            "closed": p["closed"],
            "carve": p["carve"],
            "props": [{"kind": pr["kind"], "x": pr["x"], "y": pr["y"], "s": pr["s"], "cut": pr["cut"]} for pr in p["props"]],
        }

    kinds = sorted({pr["kind"] for p in poses.values() for pr in p["props"]} | {"envelope", "note", "pearl", "bubbles", "moon", "plane", "mic", "phone", "zz", "dots"})
    props = {k: prop_tree(k) for k in kinds}
    names = list(poses)

    src = f"""// Generated by scripts/brand/mascot_app.py from the traced crab. Do not edit: run
// `python3 scripts/brand/mascot_app.py` after changing the rig, then `pnpm --filter @hermit/mobile test`.
// Sources: {", ".join(f"{k} sha256 {v}" for k, v in hashes.items())}
//
// Every piece is a path traced once from docs/brand/logo/source/reference-drawing.png (docs/brand/mascot/parts.json),
// drawn with BASE (potrace's own scale and flip) under the pose's transform, exactly as scripts/brand/mascot.py
// render() does. A pose only moves, rotates or scales those pieces; `ch` is the same transform as `t`, written as
// translate(tx ty) rotate(rot about the piece's pivot) scale(s about the pivot), so a spring can interpolate it.
// A claw with `cut` carves a paper gap of GAP around itself into everything drawn before it; a prop with `cut`
// does the same with its own shapes; `carve` cuts the eyes out of the shell (the tucked "peek" poses).

/* eslint-disable */
export type PieceName = {" | ".join(json.dumps(p) for p in PIECES)};
export type RigPoseName = {" | ".join(json.dumps(n) for n in names)};
export type PropKind = {" | ".join(json.dumps(k) for k in kinds)};
/** A color in a prop: the crab's ink (or foam), the sea-glass accent, or the paper highlight of the pearl. */
export type PropColor = "fg" | "accent" | "paper" | "none";
export interface PropEl {{
  tag: "rect" | "path" | "circle" | "g";
  attrs: {{ [k: string]: string | number | readonly number[] }};
  children?: readonly PropEl[];
}}
/** Six numbers, as SVG's matrix(a b c d e f). */
export type Matrix = readonly [number, number, number, number, number, number];
export interface Placement {{
  /** The rig's own transform, as written in scripts/brand/mascot.py. */
  t: string;
  /** `t` as a matrix. */
  m: Matrix;
  /** `t` as [tx, ty, rot (degrees), s] about the piece's pivot. */
  ch: readonly [number, number, number, number];
  /** A claw that moved cuts its own paper gap (GAP) into what is under it. */
  cut?: boolean;
}}
export interface RigPose {{
  /** The pieces this pose draws. A piece that is not here is not drawn (tucked in, or Quiet). */
  pieces: {{ readonly [P in PieceName]?: Placement }};
  /** The eyes are the rig's closed strokes (CLOSED_EYES), not the traced dots. */
  closed: boolean;
  /** Tucked in and peeking: the eyes are cut out of the shell, open or closed. */
  carve: "open" | "closed" | null;
  props: readonly {{ kind: PropKind; x: number; y: number; s: number; cut: boolean }}[];
}}

export const RIG = {{
  /** The canvas of every pose and of docs/brand/mascot/png (512 by 444 is this box at 0.7388). */
  viewBox: {ts_value(viewbox)},
  /** The traced symbol, in its own pixels. */
  size: {ts_value(parts["size"])},
  /** The paper gap a moved piece cuts around itself. */
  gap: {num(mascot.GAP)},
  /** Traced paths are in potrace units: BASE maps them to the symbol, 1/40 of a unit per symbol pixel. */
  base: {ts_value([float(num(x, 9)) for x in base])} as Matrix,
  traceUnit: {num(mascot.TRACE_UNIT, 9)},
  /** Ink on light, foam on dark (Deep sea); the accent is sea glass, glow on dark. */
  colors: {{ ink: {json.dumps(mascot.INK)}, foam: {json.dumps(mascot.FOAM)}, sea: {json.dumps(mascot.SEA)}, glow: {json.dumps(mascot.GLOW)}, paper: {json.dumps(mascot.PAPER)} }},
  /** The closed eye is a stroke of this width with round caps (mascot.closed_eye). */
  closedEyeWidth: {num(closed_w)},
  /** The carved eyes of the peek pose sit here, moved onto the shell, and grow by one pixel. */
  peekShift: {ts_value([float(num(x)) for x in peek_shift[4:]])},
  carveGrow: 1,
}} as const;

/** Draw order, as render() draws them. */
export const PIECES: readonly PieceName[] = {ts_value(PIECES)};

export const PIECE_INFO: {{ readonly [P in PieceName]: {{ path: keyof typeof PATHS; box: readonly number[]; pivot: readonly [number, number]; wrist?: readonly [number, number] }} }} = {ts_value(pieces)};

export const CLOSED_EYES: {{ readonly eye_l: string; readonly eye_r: string }} = {ts_value(closed_d)};
export const CARVE_CLOSED_EYES: {{ readonly eye_l: string; readonly eye_r: string }} = {ts_value(carve_closed)};

export const PROPS: {{ readonly [K in PropKind]: readonly PropEl[] }} = {ts_value(props)};

export const RIG_POSES: {{ readonly [N in RigPoseName]: RigPose }} = {ts_value(rig_poses)};

/** The traced pieces, in potrace units (draw them under RIG.base). */
export const PATHS = {ts_value({k: path_d(v) for k, v in d_of.items()})} as const;
"""
    if "--check" in sys.argv:
        if not OUT.exists() or OUT.read_text() != src:
            print(f"{OUT.relative_to(ROOT)} is out of date: run python3 scripts/brand/mascot_app.py")
            sys.exit(1)
        print("up to date")
        return
    OUT.write_text(src)
    print(f"{len(rig_poses)} poses, {len(props)} props -> {OUT.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
