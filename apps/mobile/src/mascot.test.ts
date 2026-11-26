/// <reference types="node" />
// Mascot v2 (docs/design/mascot): the crab's pose data is the rig's, exactly; every move comes to rest on the rig's
// numbers; Quiet mode hides it; reduced motion keeps it still in the rig's pose.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { appearance } from "../../../packages/runtime/src/appearance.ts";
import { RIG_POSE, type Pose } from "./mascot.ts";
import {
  AMBIENT_MIN_WIDTH,
  BODY,
  BODY_AMP,
  BODY_REST,
  BREATHS_FOR,
  HELLO_WAVE,
  LAYOUT,
  OP,
  POSE_MOTION,
  SPRINGS,
  arriveMoves,
  arrivalEnd,
  between,
  blinkPattern,
  bodyScale,
  buildBodyTrack,
  buildPartsTrack,
  evalBody,
  evalParts,
  mascotMotion,
  partsVelocity,
  pieceMatrix,
  propMatrix,
  rigFrame,
  seeded,
  type Frame,
  type Mat,
  type MotionPose,
} from "./mascot-motion.ts";
import { PATHS, PIECES, PIECE_INFO, RIG, RIG_POSES, type PieceName, type RigPoseName } from "./mascot-rig.ts";
import { buildScene, sceneNodes, type SceneNode } from "./mascot-scene.ts";

const ROOT = new URL("../../../", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, ROOT));
const POSES = Object.keys(RIG_POSES) as RigPoseName[];
const APP_POSES = Object.keys(RIG_POSE) as Pose[];
const zeros = (n: number) => new Array(n).fill(0);

/** SVG transform lists, parsed here on their own (the generator has its own parser in Python). */
function parse(text: string): Mat {
  let m: Mat = [1, 0, 0, 1, 0, 0];
  for (const [, name, args] of text.matchAll(/(\w+)\(([^)]*)\)/g)) {
    const v = args!.trim().split(/[\s,]+/).filter(Boolean).map(Number);
    let step: Mat;
    if (name === "translate") step = [1, 0, 0, 1, v[0]!, v[1] ?? 0];
    else if (name === "scale") step = [v[0]!, 0, 0, v[1] ?? v[0]!, 0, 0];
    else if (name === "rotate") {
      const r = (v[0]! * Math.PI) / 180;
      const [c, s, x, y] = [Math.cos(r), Math.sin(r), v[1] ?? 0, v[2] ?? 0];
      step = [c, s, -s, c, x - c * x + s * y, y - s * x - c * y];
    } else throw new Error(`unexpected ${name}`);
    m = [m[0] * step[0] + m[2] * step[1], m[1] * step[0] + m[3] * step[1], m[0] * step[2] + m[2] * step[3], m[1] * step[2] + m[3] * step[3], m[0] * step[4] + m[2] * step[5] + m[4], m[1] * step[4] + m[3] * step[5] + m[5]];
  }
  return m;
}

function near(a: readonly number[], b: readonly number[], eps: number, what: string) {
  assert.equal(a.length, b.length, what);
  a.forEach((x, i) => assert.ok(Math.abs(x - b[i]!) <= eps, `${what}[${i}]: ${x} vs ${b[i]}`));
}

/** What a frame shows: each drawn piece's matrix and opacity, eyes, gaps, carve and props. Hidden things don't count. */
function shown(f: Frame) {
  const out: Record<string, number[]> = {};
  for (const p of PIECES) {
    const op = f[LAYOUT.piece[p] + OP]!;
    if (op > 0) out[p] = [...pieceMatrix(f, p), op];
  }
  for (const e of ["eye_l", "eye_r"] as const) if (f[LAYOUT.piece[e] + OP]! > 0) out[`${e}.shut`] = [f[LAYOUT.shut[e]]!];
  for (const c of ["claw_l", "claw_r"] as const) if (f[LAYOUT.piece[c] + OP]! > 0) out[`${c}.gap`] = [f[LAYOUT.gap[c]]!];
  out.carve = [f[LAYOUT.carveOpen]!, f[LAYOUT.carveShut]!];
  for (const k of Object.keys(LAYOUT.prop) as (keyof typeof LAYOUT.prop)[]) {
    const op = f[LAYOUT.prop[k] + 3]!;
    if (op > 0) out[`prop.${k}`] = [...propMatrix(f, k), op];
  }
  return out;
}

// ---------------------------------------------------------------- the pose data is the rig

test("mascot-rig.ts is generated from the current rig (run python3 scripts/brand/mascot_app.py when this fails)", () => {
  const head = readFileSync(new URL("./mascot-rig.ts", import.meta.url), "utf8").split("\n").slice(0, 4).join("\n");
  for (const source of ["docs/brand/mascot/parts.json", "scripts/brand/mascot.py", "scripts/brand/mascot_app.py"]) {
    const sha = createHash("sha256").update(read(source)).digest("hex");
    assert.ok(head.includes(`${source} sha256 ${sha}`), `${source} changed since mascot-rig.ts was generated`);
  }
});

test("the pieces are the traced paths of the reference drawing, unchanged (never redrawn)", () => {
  const parts = JSON.parse(read("docs/brand/mascot/parts.json").toString()) as Record<string, { svg: string; box: number[] }>;
  for (const [name, d] of Object.entries(PATHS)) {
    const traced = /<path d="([^"]+)"/.exec(parts[name]!.svg)![1]!.split(/\s+/).join(" ");
    assert.equal(d, traced, name);
    assert.deepEqual([...PIECE_INFO[name as PieceName].box], parts[name]!.box, name);
  }
  // potrace's own scale and flip, as in every traced piece's <g transform>
  assert.match(parts.shell!.svg, /^<g transform="scale\(0\.25\) translate\(0\.000000,1684\.000000\) scale\(0\.100000,-0\.100000\)">/);
  near(RIG.base, parse("scale(0.25) translate(0,1684) scale(0.1,-0.1)"), 1e-12, "base");
});

test("every pose of the rig is here, as docs/brand/mascot/png names them, light and dark", () => {
  const pngs = readdirSync(new URL("docs/brand/mascot/png/", ROOT)).filter((f) => f.endsWith(".png"));
  const names = [...new Set(pngs.map((f) => f.replace(/(-dark)?\.png$/, "")))].sort();
  assert.deepEqual([...POSES].sort(), names);
  for (const n of names) assert.ok(pngs.includes(`${n}-dark.png`), `${n} has a dark picture`);
});

test("every app pose shows its rig pose", () => {
  assert.deepEqual(APP_POSES.sort(), ["asking", "blocked", "done", "error", "hello", "idle", "offline", "thinking", "working"]);
  for (const p of APP_POSES) assert.ok(RIG_POSES[RIG_POSE[p]], p);
});

test("each piece's numbers are the rig's own transform, three ways that agree", () => {
  for (const name of POSES) {
    for (const [p, placed] of Object.entries(RIG_POSES[name].pieces)) {
      const piece = p as PieceName;
      const fromRig = parse(placed.t);
      near(placed.m, fromRig, 1e-6, `${name} ${p} matrix`);
      const f: Frame = zeros(LAYOUT.size);
      const o = LAYOUT.piece[piece];
      [f[o], f[o + 1], f[o + 2], f[o + 3]] = placed.ch;
      near(pieceMatrix(f, piece), fromRig, 1e-6, `${name} ${p} from ch`);
    }
  }
});

test("a rest frame shows exactly the rig's pose: its pieces, cuts, closed eyes, carve and props", () => {
  for (const name of POSES) {
    const pose = RIG_POSES[name];
    const f = rigFrame(name);
    for (const p of PIECES) {
      const placed = pose.pieces[p];
      assert.equal(f[LAYOUT.piece[p] + OP], placed ? 1 : 0, `${name} ${p} drawn`);
      if (placed) near(pieceMatrix(f, p), parse(placed.t), 1e-6, `${name} ${p}`);
    }
    for (const c of ["claw_l", "claw_r"] as const) {
      assert.equal(f[LAYOUT.gap[c]], pose.pieces[c]?.cut ? RIG.gap : 0, `${name} ${c} gap`);
      assert.equal(f[LAYOUT.wave[c]], 0, `${name} ${c} still`);
    }
    for (const e of ["eye_l", "eye_r"] as const) assert.equal(f[LAYOUT.shut[e]], pose.closed ? 1 : 0, `${name} ${e} shut`);
    assert.deepEqual([f[LAYOUT.carveOpen], f[LAYOUT.carveShut]], [pose.carve === "open" ? 1 : 0, pose.carve === "closed" ? 1 : 0], name);
    for (const k of Object.keys(LAYOUT.prop) as (keyof typeof LAYOUT.prop)[]) {
      const placed = pose.props.find((pr) => pr.kind === k);
      assert.equal(f[LAYOUT.prop[k] + 3], placed ? 1 : 0, `${name} prop ${k}`);
      if (placed) near(propMatrix(f, k), [placed.s, 0, 0, placed.s, placed.x, placed.y], 1e-9, `${name} prop ${k}`);
    }
  }
});

test("the rig's layers: a moved claw and a prop cut their paper gap, tucked eyes are carved, as render() does", () => {
  for (const name of POSES) {
    const pose = RIG_POSES[name];
    const scene = buildScene({ poses: [name], blinks: false, dark: false, id: "t" });
    const masks = scene.masks.map((m) => m.id.replace("t-", "")).sort();
    const expected = [
      ...(["claw_l", "claw_r"] as const).filter((c) => pose.pieces[c]?.cut),
      ...(pose.carve ? ["carve"] : []),
      ...pose.props.filter((pr) => pr.cut).map((pr) => `prop-${pr.kind}`),
    ].sort();
    assert.deepEqual(masks, expected, name);
  }
  // A claw moves only by a transform the rig wrote; a claw that moved always cuts.
  for (const name of POSES) for (const c of ["claw_l", "claw_r"] as const) {
    const placed = RIG_POSES[name].pieces[c];
    if (placed) assert.equal(placed.cut, placed.t !== "", `${name} ${c}`);
  }
});

test("props are layered in one order the rig also uses", () => {
  for (const name of POSES) {
    const kinds = RIG_POSES[name].props.map((pr) => pr.kind);
    assert.deepEqual(kinds, [...kinds].sort(), name);
  }
});

test("a moving crab keeps one tree for every app pose, so pieces never remount while they move", () => {
  const keys = (n: SceneNode): string => `${n.key}${n.el === "g" && n.key.startsWith("under-") ? `[${n.children!.filter((c) => c.key.startsWith("under-")).map(keys).join()}]` : ""}`;
  const shapes = new Set<string>();
  for (const a of APP_POSES) for (const b of APP_POSES) {
    const scene = buildScene({ poses: [RIG_POSE[a], RIG_POSE[b]], blinks: true, dark: false, id: "t", live: true });
    shapes.add(keys(scene.root[0]!.children![0]!));
  }
  assert.equal(shapes.size, 1);
});

test("dark is foam with the glow accent, light is ink with sea glass; nothing else changes", () => {
  const light = sceneNodes(buildScene({ poses: ["02-thinking"], blinks: false, dark: false, id: "t" }));
  const dark = sceneNodes(buildScene({ poses: ["02-thinking"], blinks: false, dark: true, id: "t" }));
  const colors = (ns: SceneNode[]) => [...new Set(ns.flatMap((n) => [n.attrs.fill, n.attrs.stroke]).filter((c) => typeof c === "string" && c.startsWith("#")))].sort();
  assert.deepEqual(colors(light), ["#000", "#2B221B", "#4F7C6D", "#fff"]);
  assert.deepEqual(colors(dark), ["#000", "#4F7C6D", "#5EF0CF", "#E7F1F0", "#fff"].filter((c) => c !== "#4F7C6D"));
  assert.equal(light.length, dark.length);
});

// ---------------------------------------------------------------- every move comes to rest on the rig

test("every change between app poses starts where the crab was and rests exactly on the rig's pose", () => {
  for (const a of APP_POSES) for (const b of APP_POSES) {
    const from = rigFrame(RIG_POSE[a]);
    const to = rigFrame(RIG_POSE[b]);
    const track = buildPartsTrack(from, zeros(from.length), to, { spring: SPRINGS[POSE_MOTION[b].spring], ...(POSE_MOTION[b].wave ? { wave: HELLO_WAVE } : {}) });
    assert.deepEqual(shown(evalParts(track, 0)), shown(from), `${a} -> ${b} starts at ${a}`);
    assert.deepEqual(shown(evalParts(track, track.end)), shown(to), `${a} -> ${b} rests on ${b}`);
    assert.deepEqual(shown(evalParts(track, track.end + 5000)), shown(to), `${a} -> ${b} stays`);
    assert.ok(track.end <= 1900, `${a} -> ${b} takes ${track.end} ms`);
  }
});

test("a change mid-flight bends the path: no jump in position", () => {
  const idle = rigFrame("01-idle");
  const working = rigFrame("03-working");
  const first = buildPartsTrack(idle, zeros(idle.length), working, { spring: SPRINGS.pose });
  const mid = evalParts(first, 180);
  const second = buildPartsTrack(mid, partsVelocity(first, 180), rigFrame("05-done"), { spring: SPRINGS.pose });
  // (an invisible prop about to come in is placed at its entrance first; nothing shown moves)
  assert.deepEqual(shown(evalParts(second, 0)), shown(mid), "continuity");
  // and it moves on smoothly: the next 8 ms change it by about what the first move's velocity says
  const v = partsVelocity(first, 180);
  const step = evalParts(second, 8);
  const o = LAYOUT.piece.claw_r + 1;
  assert.ok(Math.abs(step[o]! - (mid[o]! + v[o]! * 0.008)) < 1.5, "velocity carried over");
});

test("springs are calm: about 1% overshoot, no visible bounce", () => {
  const idle = rigFrame("01-idle");
  const working = rigFrame("03-working");
  const track = buildPartsTrack(idle, zeros(idle.length), working, { spring: SPRINGS.pose });
  const o = LAYOUT.piece.claw_r + 1; // the claw's rise, -120 units
  let peak = 0;
  for (let t = 0; t <= track.end; t += 4) peak = Math.min(peak, evalParts(track, t)[o]!);
  const overshoot = (peak - working[o]!) / (working[o]! - idle[o]!);
  assert.ok(overshoot > 0 && overshoot < 0.02, `overshoot ${overshoot}`);
});

test("hello: the claw rises to WAVE_L, swings twice about its wrist, then rests exactly on the rig's hello", () => {
  const track = buildPartsTrack(rigFrame("01-idle"), zeros(LAYOUT.size), rigFrame("hello"), { spring: SPRINGS.pose, wave: HELLO_WAVE });
  const w = LAYOUT.wave.claw_l;
  const samples: number[] = [];
  for (let t = 0; t <= track.end; t += 5) samples.push(evalParts(track, t)[w]!);
  const peaks = samples.filter((v, i) => i > 0 && i < samples.length - 1 && Math.abs(v) > 3 && Math.abs(v) >= Math.abs(samples[i - 1]!) && Math.abs(v) >= Math.abs(samples[i + 1]!));
  assert.deepEqual(peaks.map(Math.sign), [1, -1, 1, -1], "two full swings");
  assert.ok(Math.max(...samples.map(Math.abs)) <= HELLO_WAVE.amp + 1e-9);
  assert.equal(evalParts(track, track.end)[w], 0);
  assert.deepEqual(shown(evalParts(track, track.end)), shown(rigFrame("hello")));
});

test("blocked tucks in: the head slides into the shell while it fades, the claws shut the door", () => {
  const track = buildPartsTrack(rigFrame("01-idle"), zeros(LAYOUT.size), rigFrame("07-blocked"), { spring: SPRINGS.tuck });
  const mid = evalParts(track, 90);
  const op = mid[LAYOUT.piece.head + OP]!;
  assert.ok(op > 0 && op < 1, "fading");
  assert.ok(mid[LAYOUT.piece.head]! < 0 && mid[LAYOUT.piece.head + 1]! < 0, "moving up and back, into the shell");
  assert.ok(mid[LAYOUT.gap.claw_l]! > 0, "the claws' gaps open as they move");
});

// ---------------------------------------------------------------- the body: small, finite, calm

function bodyPeak(moves: [number, number, number][], ms: number) {
  const track = buildBodyTrack(BODY_REST, zeros(5), moves);
  const peak = [0, 0, 0, 0, 0];
  for (let t = 0; t <= ms; t += 4) {
    const b = evalBody(track, t);
    peak[0] = Math.max(peak[0]!, Math.abs(b[0]!));
    peak[1] = Math.max(peak[1]!, Math.abs(b[1]!));
    peak[2] = Math.max(peak[2]!, Math.abs(b[2]!));
    peak[3] = Math.max(peak[3]!, Math.abs(b[3]! - 1));
    peak[4] = Math.max(peak[4]!, Math.abs(b[4]! - 1));
  }
  return { track, peak };
}

test("breathing is barely there: at most 2% scale, and it ends on the rest frame", () => {
  const { track, peak } = bodyPeak([[BODY.breath, 0, 1]], 5000);
  assert.ok(peak[3]! <= 0.02 && peak[4]! <= 0.02 && peak[4]! > 0.005, `scale ${peak[3]} ${peak[4]}`);
  assert.deepEqual(peak.slice(0, 3), [0, 0, 0]);
  assert.deepEqual(evalBody(track, track.end), BODY_REST);
});

test("every body move stays within 2 dp and a few degrees, at any size", () => {
  for (const width of [24, 44, 64, 96, 112, 148, 512]) {
    for (const pose of Object.keys(POSE_MOTION) as MotionPose[]) {
      const m = POSE_MOTION[pose];
      const moves = arriveMoves(pose, width);
      if (m.loop !== null) moves.push([m.loop, 0, bodyScale(width)]);
      const { peak } = bodyPeak(moves, 6000);
      assert.ok(peak[0]! <= 2 && peak[1]! <= 2, `${pose} at ${width}: ${peak[0]} ${peak[1]} dp`);
      assert.ok(peak[2]! <= 3, `${pose} at ${width}: ${peak[2]} degrees`);
      assert.ok(peak[3]! <= 0.02 && peak[4]! <= 0.02, `${pose} at ${width}: scale`);
    }
  }
});

test("only thinking and working loop; error and blocked recoil once; asking leans in and then holds still", () => {
  const loops = (Object.keys(POSE_MOTION) as MotionPose[]).filter((p) => POSE_MOTION[p].loop !== null).sort();
  assert.deepEqual(loops, ["thinking", "working"]);
  for (const pose of ["error", "blocked"] as const) {
    assert.deepEqual(POSE_MOTION[pose].arrive.map(([k]) => k), [BODY.recoil]);
    const track = buildBodyTrack(BODY_REST, zeros(5), arriveMoves(pose, 96));
    assert.ok(track.end > 0 && track.end <= 1000, `${pose} recoil ends (${track.end} ms)`);
    assert.deepEqual(evalBody(track, track.end), BODY_REST);
  }
  assert.deepEqual(POSE_MOTION.asking.arrive.map(([k]) => k), [BODY.lean]);
  assert.equal(POSE_MOTION.asking.breathes, false);
  const lean = buildBodyTrack(BODY_REST, zeros(5), arriveMoves("asking", 96));
  assert.ok(evalBody(lean, 500)[2]! >= BODY_AMP.leanTilt * 0.99, "leaning in at half a second");
  assert.deepEqual(evalBody(lean, lean.end), BODY_REST);
  assert.deepEqual(POSE_MOTION.done.arrive.map(([k]) => k), [BODY.settle]);
  assert.ok(arrivalEnd("done") > 0 && arrivalEnd("idle") === 0);
});

test("a loop keeps going until the pose changes; a new move starts from where the body is", () => {
  const bob = buildBodyTrack(BODY_REST, zeros(5), [[BODY.bob, 0, 1]]);
  assert.equal(bob.end, -1);
  const at = evalBody(bob, 1400);
  const next = buildBodyTrack(at, zeros(5), []);
  near(evalBody(next, 0), at, 1e-9, "continuity");
  assert.deepEqual(evalBody(next, next.end), BODY_REST);
});

test("blinks only where the eyes are open; breaths only at rest; both at irregular, seeded intervals", () => {
  assert.equal(POSE_MOTION.done.blinks, null, "done's eyes are shut");
  assert.equal(POSE_MOTION.blocked.blinks, null, "tucked in");
  assert.equal(POSE_MOTION.offline.blinks, null, "tucked in");
  for (const p of ["idle", "hello", "thinking", "working", "asking", "error"] as const) assert.ok(POSE_MOTION[p].blinks, p);
  const rng = seeded(7);
  const waits = Array.from({ length: 50 }, () => between(rng, POSE_MOTION.idle.blinks!));
  assert.ok(waits.every((w) => w >= 2800 && w < 6200));
  assert.ok(new Set(waits.map((w) => Math.round(w / 100))).size > 20, "irregular");
  const same = seeded(7);
  assert.deepEqual(Array.from({ length: 50 }, () => between(same, POSE_MOTION.idle.blinks!)), waits, "seeded");
  const patterns = Array.from({ length: 400 }, () => blinkPattern(rng).length);
  assert.ok(patterns.includes(1) && patterns.includes(3), "single and double blinks");
  assert.ok(BREATHS_FOR <= 60_000, "breathing winds down");
});

// ---------------------------------------------------------------- Quiet mode and reduced motion

test("Quiet mode hides the crab everywhere (HM-SET-06)", () => {
  const quiet = appearance({ quiet: "1", systemReduceMotion: false });
  for (const width of [24, 64, 148, undefined]) assert.deepEqual(mascotMotion(quiet, { width }), { show: false, live: false, ambient: false });
});

test("the phone's remove animations keeps the crab, still, in its rest pose (Q52)", () => {
  const reduced = appearance({ quiet: undefined, systemReduceMotion: true });
  assert.deepEqual(mascotMotion(reduced, { width: 148 }), { show: true, live: false, ambient: false });
  assert.deepEqual(mascotMotion(appearance({ quiet: "0", systemReduceMotion: false }), { width: 148 }), { show: true, live: true, ambient: true });
});

test("animate={false} asks for the same stillness; small crabs only change pose, bigger ones breathe and blink", () => {
  const on = appearance({ quiet: undefined, systemReduceMotion: false });
  assert.deepEqual(mascotMotion(on, { animate: false, width: 148 }), { show: true, live: false, ambient: false });
  assert.deepEqual(mascotMotion(on, { width: AMBIENT_MIN_WIDTH - 1 }), { show: true, live: true, ambient: false });
  assert.deepEqual(mascotMotion(on, { width: AMBIENT_MIN_WIDTH }), { show: true, live: true, ambient: true });
  assert.deepEqual(mascotMotion(on, {}), { show: true, live: true, ambient: true });
});

test("the component follows those rules: hidden in Quiet mode, still without motion, decorative for TalkBack", () => {
  const src = readFileSync(new URL("./components/Mascot.tsx", import.meta.url), "utf8");
  assert.match(src, /mascotMotion\(useAppearance\(\), \{ animate, width \}\)/);
  assert.match(src, /if \(!show\) return null;/);
  const art = readFileSync(new URL("./components/MascotArt.tsx", import.meta.url), "utf8");
  assert.match(art, /const moving = live && \(ambient \|\| seen\.prev !== undefined\);/);
  assert.match(art, /moving \? <LiveCrab/);
  for (const player of ["mascot-player.tsx", "mascot-player.web.tsx"]) {
    const p = readFileSync(new URL(`./components/${player}`, import.meta.url), "utf8");
    assert.match(p, /pointerEvents(="|: ")none"/, `${player}: touches pass through to what holds the crab`);
  }
  const phone = readFileSync(new URL("./components/mascot-player.tsx", import.meta.url), "utf8");
  assert.match(phone, /const HIDDEN = \{ accessible: false, importantForAccessibility: "no-hide-descendants", accessibilityElementsHidden: true/);
  assert.equal(phone.match(/\{\.\.\.HIDDEN\}/g)?.length, 2, "both the still and the moving crab are hidden from TalkBack");
});
