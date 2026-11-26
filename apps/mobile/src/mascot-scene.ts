// The crab as a tree of SVG elements, built the way scripts/brand/mascot.py render() layers it: pieces in draw order,
// and every piece that cuts (a moved claw, a prop) wraps everything drawn before it in a mask that removes the piece
// grown by its paper gap. The tree is plain data; components/mascot-player.tsx draws it with react-native-svg on the
// phone and mascot-player.web.tsx with the DOM in the browser preview. Numbers that move are bound to a Frame.
import { CARVE_CLOSED_EYES, CLOSED_EYES, PATHS, PIECES, PIECE_INFO, PROPS, RIG, RIG_POSES, type PieceName, type PropEl, type PropKind, type RigPoseName } from "./mascot-rig.ts";
import { LAYOUT, OP, pieceMatrix, propMatrix, type Frame, type Mat } from "./mascot-motion.ts";

/** What a moving element takes from the frame. */
export type Bind =
  | { t: "piece"; p: PieceName }
  | { t: "eyeOpen"; p: "eye_l" | "eye_r" }
  | { t: "eyeShut"; p: "eye_l" | "eye_r" }
  | { t: "gapWidth"; p: "claw_l" | "claw_r" }
  | { t: "carve"; open: boolean }
  | { t: "prop"; k: PropKind };

export type Attrs = { [k: string]: string | number | readonly number[] | undefined };

export interface SceneNode {
  el: "g" | "path" | "rect" | "circle";
  key: string;
  attrs: Attrs;
  bind?: Bind;
  /** The id of the mask this group is drawn through. */
  mask?: string;
  children?: SceneNode[];
}

export interface Scene {
  masks: { id: string; children: SceneNode[] }[];
  root: SceneNode[];
}

/** Light: ink and sea glass. Dark (Deep sea): foam and glow. The pearl's highlight is paper in both. */
export function rigColors(dark: boolean) {
  return { fg: dark ? RIG.colors.foam : RIG.colors.ink, accent: dark ? RIG.colors.glow : RIG.colors.sea, paper: RIG.colors.paper };
}

/** The value a bound element takes from a frame (and the blink, 1 while a blink shuts the eyes). */
export function bound(b: Bind, f: Frame, blink: number): { matrix?: Mat; opacity?: number; strokeWidth?: number } {
  "worklet";
  switch (b.t) {
    case "piece":
      return { matrix: pieceMatrix(f, b.p), opacity: f[LAYOUT.piece[b.p] + OP]! };
    case "eyeOpen":
      return { opacity: 1 - Math.max(f[LAYOUT.shut[b.p]]!, blink) };
    case "eyeShut":
      return { opacity: Math.max(f[LAYOUT.shut[b.p]]!, blink) };
    case "gapWidth":
      return { strokeWidth: (2 * f[LAYOUT.gap[b.p]]!) / RIG.traceUnit };
    case "carve":
      return { opacity: f[b.open ? LAYOUT.carveOpen : LAYOUT.carveShut]! };
    case "prop":
      return { matrix: propMatrix(f, b.k), opacity: f[LAYOUT.prop[b.k] + 3]! };
  }
}

export interface SceneOptions {
  /** Every rig pose the drawing has to show (the one it is in, and the one it is leaving). */
  poses: readonly RigPoseName[];
  /** Ambient blinks: the closed eyes are needed even if no pose shuts them. */
  blinks: boolean;
  dark: boolean;
  /** Prefix for mask ids, unique per crab on screen. */
  id: string;
  /**
   * A moving crab keeps one tree for its whole life: every layer a cut could need is a group, and a cut only turns
   * its mask on. Pieces then never remount while they move. A still crab gets only the layers its pose uses.
   */
  live?: boolean;
}

const EXTENT = { x: RIG.viewBox[0], y: RIG.viewBox[1], width: RIG.viewBox[2], height: RIG.viewBox[3] };
const KINDS = (Object.keys(PROPS) as PropKind[]).sort();

export function buildScene(opt: SceneOptions): Scene {
  const c = rigColors(opt.dark);
  const poses = opt.poses.map((n) => RIG_POSES[n]);
  const shows = (p: PieceName) => poses.some((pose) => pose.pieces[p]);
  const masks: Scene["masks"] = [];
  let content: SceneNode[] = [];

  /** Everything drawn so far goes under a layer; with `cut`, the layer is a mask that removes `cut`'s shapes. */
  const layer = (name: string, cut: SceneNode[] | null) => {
    if (!cut && !opt.live) return;
    const id = `${opt.id}-${name}`;
    const node: SceneNode = { el: "g", key: `under-${name}`, attrs: {}, children: content };
    if (cut) {
      masks.push({ id, children: [{ el: "rect", key: "paper", attrs: { ...EXTENT, fill: "#fff" } }, ...cut] });
      node.mask = id;
    }
    content = [node];
  };

  for (const p of PIECES) {
    if (p === "claw_l" || p === "claw_r") {
      // A moved claw cuts its paper gap: the claw itself, stroked GAP wide on every side, removed from what is under it.
      const cuts = poses.some((pose) => pose.pieces[p]?.cut);
      layer(
        p,
        cuts
          ? [
              {
                el: "g",
                key: `${p}-cut`,
                attrs: { fill: "#000", stroke: "#000", strokeLinejoin: "round" },
                children: [
                  {
                    el: "g",
                    key: `${p}-cut-at`,
                    attrs: {},
                    bind: { t: "piece", p },
                    children: [{ el: "path", key: `${p}-cut-path`, attrs: { d: PATHS[PIECE_INFO[p].path], matrix: RIG.base, strokeWidth: (2 * RIG.gap) / RIG.traceUnit }, bind: { t: "gapWidth", p } }],
                  },
                ],
              },
            ]
          : null,
      );
    }
    if (!shows(p)) continue;
    if (p === "eye_l" || p === "eye_r") {
      const open = opt.live || poses.some((pose) => pose.pieces[p] && !pose.closed);
      const shut = opt.live || opt.blinks || poses.some((pose) => pose.pieces[p] && pose.closed);
      const kids: SceneNode[] = [];
      if (open) kids.push({ el: "g", key: `${p}-open`, attrs: {}, bind: { t: "eyeOpen", p }, children: [{ el: "path", key: `${p}-dot`, attrs: { d: PATHS[p], matrix: RIG.base } }] });
      if (shut) {
        kids.push({
          el: "g",
          key: `${p}-shut`,
          attrs: {},
          bind: { t: "eyeShut", p },
          children: [{ el: "path", key: `${p}-line`, attrs: { d: CLOSED_EYES[p], fill: "none", stroke: c.fg, strokeWidth: RIG.closedEyeWidth, strokeLinecap: "round" } }],
        });
      }
      content.push({ el: "g", key: p, attrs: {}, bind: { t: "piece", p }, children: kids });
      continue;
    }
    content.push({ el: "g", key: p, attrs: {}, bind: { t: "piece", p }, children: [{ el: "path", key: `${p}-path`, attrs: { d: PATHS[PIECE_INFO[p].path], matrix: RIG.base } }] });
  }

  const carveOpen = poses.some((pose) => pose.carve === "open");
  const carveShut = poses.some((pose) => pose.carve === "closed");
  // Tucked in and peeking: the eyes are cut out of everything drawn so far, like the spiral of the shell.
  const carve: SceneNode[] = [];
  if (carveOpen) {
    carve.push({
      el: "g",
      key: "carve-open",
      attrs: { fill: "#000", stroke: "#000", strokeWidth: (2 * RIG.carveGrow) / RIG.traceUnit },
      bind: { t: "carve", open: true },
      children: (["eye_l", "eye_r"] as const).map((e) => ({
        el: "g" as const,
        key: `carve-${e}`,
        attrs: { matrix: [1, 0, 0, 1, RIG.peekShift[0], RIG.peekShift[1]] },
        children: [{ el: "path" as const, key: `carve-${e}-path`, attrs: { d: PATHS[e], matrix: RIG.base } }],
      })),
    });
  }
  if (carveShut) {
    carve.push({
      el: "g",
      key: "carve-shut",
      attrs: {},
      bind: { t: "carve", open: false },
      children: (["eye_l", "eye_r"] as const).map((e) => ({
        el: "path" as const,
        key: `carve-shut-${e}`,
        attrs: { d: CARVE_CLOSED_EYES[e], fill: "none", stroke: "#000", strokeWidth: RIG.closedEyeWidth, strokeLinecap: "round" },
      })),
    });
  }
  layer("carve", carve.length ? carve : null);

  // Props in one fixed order (every pose with two props lists them in it, mascot-scene.test.ts checks).
  const used = new Set(poses.flatMap((pose) => pose.props.map((pr) => pr.kind)));
  for (const k of KINDS) {
    if (!used.has(k) && !opt.live) continue;
    const cuts = poses.some((pose) => pose.props.some((pr) => pr.kind === k && pr.cut));
    // A prop cuts its own shapes, grown by the paper gap where a shape has no stroke of its own (mascot.py).
    layer(
      `prop-${k}`,
      cuts
        ? [
            {
              el: "g",
              key: `prop-${k}-cut`,
              attrs: { fill: "#000", stroke: "#000", strokeWidth: 2 * RIG.gap, strokeLinejoin: "round" },
              children: [{ el: "g", key: `prop-${k}-cut-at`, attrs: {}, bind: { t: "prop", k }, children: propNodes(k, c, "cut") }],
            },
          ]
        : null,
    );
    if (used.has(k)) content.push({ el: "g", key: `prop-${k}`, attrs: {}, bind: { t: "prop", k }, children: propNodes(k, c, "draw") });
  }

  return { masks, root: [{ el: "g", key: "crab", attrs: { fill: c.fg }, children: content }] };
}

function propNodes(k: PropKind, c: ReturnType<typeof rigColors>, prefix: string): SceneNode[] {
  const conv = (el: PropEl, i: number): SceneNode => {
    const attrs: Attrs = {};
    for (const [name, v] of Object.entries(el.attrs)) {
      attrs[name] = v === "fg" ? c.fg : v === "accent" ? c.accent : v === "paper" ? c.paper : v;
    }
    const node: SceneNode = { el: el.tag, key: `${prefix}-${k}-${i}`, attrs };
    if (el.children) node.children = el.children.map(conv);
    return node;
  };
  return PROPS[k].map(conv);
}

/** Every element of a scene, depth first (masks first), for tests and the preview. */
export function sceneNodes(scene: Scene): SceneNode[] {
  const out: SceneNode[] = [];
  const walk = (n: SceneNode) => {
    out.push(n);
    n.children?.forEach(walk);
  };
  scene.masks.forEach((m) => m.children.forEach(walk));
  scene.root.forEach(walk);
  return out;
}
