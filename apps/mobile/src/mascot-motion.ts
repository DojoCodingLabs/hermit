// The crab's motion as pure functions of time (docs/design/mascot/decisions.md). The phone runs them on the UI
// thread as Reanimated worklets (components/mascot-player.tsx), the browser preview runs them from
// requestAnimationFrame (mascot-player.web.tsx), and node tests run them as plain functions. Every motion is a
// transform of the rig's own pieces (mascot-rig.ts): nothing here draws, and every pose comes to rest on the rig's
// numbers exactly.
import { PIECES, PIECE_INFO, PROPS, RIG, RIG_POSES, type PieceName, type PropKind, type RigPoseName } from "./mascot-rig.ts";
import { duration } from "./motion.ts";

// ---------------------------------------------------------------- the frame: every number that can move

/** A frame of the drawing: for each piece tx, ty, rot, s, opacity, plus the extras below. */
export type Frame = number[];
/** The whole crab, moved as one picture on the compositor: tx, ty (dp), rot (degrees), sx, sy. */
export type Body = number[];

const PROP_KINDS = Object.keys(PROPS).sort() as PropKind[];

function layout() {
  let n = 0;
  const piece = {} as Record<PieceName, number>;
  const shut = { eye_l: 0, eye_r: 0 };
  const gap = { claw_l: 0, claw_r: 0 };
  const wave = { claw_l: 0, claw_r: 0 };
  for (const p of PIECES) {
    piece[p] = n;
    n += 5;
    if (p === "eye_l" || p === "eye_r") shut[p] = n++;
    if (p === "claw_l" || p === "claw_r") {
      gap[p] = n++;
      wave[p] = n++;
    }
  }
  const carveOpen = n++;
  const carveShut = n++;
  const prop = {} as Record<PropKind, number>;
  for (const k of PROP_KINDS) {
    prop[k] = n;
    n += 4;
  }
  return { piece, shut, gap, wave, carveOpen, carveShut, prop, size: n };
}

/** Where each number lives in a Frame. Pieces: +0 tx, +1 ty, +2 rot, +3 s, +4 opacity. Props: +0 x, +1 y, +2 s, +3 opacity. */
export const LAYOUT = layout();
export const FRAME_SIZE = LAYOUT.size;
export const OP = 4;

/** How a number moves: 0 springs (positions, angles, scales, the paper gap), 1 fades (opacities, eyes shutting). */
const KIND: number[] = new Array(FRAME_SIZE).fill(0);
/** Who moves with whom, for the small follow-through: 0 shell and head, 1 claws, 2 props, 3 eyes. */
const GROUP: number[] = new Array(FRAME_SIZE).fill(0);
/** Below this, a spring has arrived (symbol units, degrees, scale). */
const EPS: number[] = new Array(FRAME_SIZE).fill(0.01);
for (const p of PIECES) {
  const o = LAYOUT.piece[p];
  KIND[o + OP] = 1;
  EPS[o + 3] = 0.0002;
  const g = p.startsWith("claw") ? 1 : p.startsWith("eye") ? 3 : 0;
  for (let i = 0; i < 5; i++) GROUP[o + i] = g;
}
KIND[LAYOUT.shut.eye_l] = KIND[LAYOUT.shut.eye_r] = 1;
GROUP[LAYOUT.shut.eye_l] = GROUP[LAYOUT.shut.eye_r] = 3;
GROUP[LAYOUT.gap.claw_l] = GROUP[LAYOUT.gap.claw_r] = 1;
GROUP[LAYOUT.wave.claw_l] = GROUP[LAYOUT.wave.claw_r] = 1;
KIND[LAYOUT.carveOpen] = KIND[LAYOUT.carveShut] = 1;
for (const k of PROP_KINDS) {
  const o = LAYOUT.prop[k];
  KIND[o + 3] = 1;
  EPS[o + 2] = 0.0002;
  for (let i = 0; i < 4; i++) GROUP[o + i] = 2;
}
const PROP_START = LAYOUT.prop[PROP_KINDS[0]!];

// ---------------------------------------------------------------- rest frames: the rig's poses, as numbers

/**
 * Where a piece waits while a pose hides it (tucked in, or Quiet): pulled into the shell, smaller. It is invisible
 * there (opacity 0), so a rest frame still shows exactly the rig's pose; a transition passes through it, so the
 * head slides into the shell instead of vanishing. [tx, ty, rot, s].
 */
const HIDDEN: Record<PieceName, readonly [number, number, number, number]> = {
  shell_small: [0, 0, 0, 0],
  shell: [0, 0, 0, 0.9],
  head: [-26, -30, -4, 0.9],
  leg_out: [18, -24, 0, 0.85],
  eye_l: [-26, -30, 0, 0.9],
  eye_r: [-26, -30, 0, 0.9],
  claw_l: [30, -60, 0, 0.85],
  claw_r: [-40, -60, 0, 0.85],
};
const SMALL_SHELL = RIG_POSES["10-boost"].pieces.shell_small!.ch;

/** The rig's pose as a Frame: what the pose draws at rest, nothing more. */
export function rigFrame(name: RigPoseName): Frame {
  const pose = RIG_POSES[name];
  const f: Frame = new Array(FRAME_SIZE).fill(0);
  for (const p of PIECES) {
    const o = LAYOUT.piece[p];
    const placed = pose.pieces[p];
    const ch = placed ? placed.ch : p === "shell_small" ? [SMALL_SHELL[0], SMALL_SHELL[1], SMALL_SHELL[2], SMALL_SHELL[3] * 0.7] : HIDDEN[p];
    f[o] = ch[0];
    f[o + 1] = ch[1];
    f[o + 2] = ch[2];
    f[o + 3] = ch[3];
    f[o + OP] = placed ? 1 : 0;
  }
  f[LAYOUT.shut.eye_l] = f[LAYOUT.shut.eye_r] = pose.closed ? 1 : 0;
  f[LAYOUT.gap.claw_l] = pose.pieces.claw_l?.cut ? RIG.gap : 0;
  f[LAYOUT.gap.claw_r] = pose.pieces.claw_r?.cut ? RIG.gap : 0;
  f[LAYOUT.carveOpen] = pose.carve === "open" ? 1 : 0;
  f[LAYOUT.carveShut] = pose.carve === "closed" ? 1 : 0;
  for (const k of PROP_KINDS) {
    const o = LAYOUT.prop[k];
    const placed = pose.props.find((pr) => pr.kind === k);
    f[o] = placed ? placed.x : 0;
    f[o + 1] = placed ? placed.y : 0;
    f[o + 2] = placed ? placed.s : 1;
    f[o + 3] = placed ? 1 : 0;
  }
  return f;
}

// ---------------------------------------------------------------- matrices: a frame's numbers to SVG transforms

export type Mat = [number, number, number, number, number, number];

// Worklet helpers come before the worklets that call them: a worklet's closure is captured where the function is
// defined, so a helper declared further down reaches the UI thread as undefined (seen on the S26, 2026-11-24).
export function mul(m: Mat, n: Mat): Mat {
  "worklet";
  return [
    m[0] * n[0] + m[2] * n[1],
    m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3],
    m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4],
    m[1] * n[4] + m[3] * n[5] + m[5],
  ];
}

function rotateAbout(deg: number, c: readonly number[]): Mat {
  "worklet";
  const r = (deg * Math.PI) / 180;
  const cos = Math.cos(r);
  const sin = Math.sin(r);
  return [cos, sin, -sin, cos, c[0]! - cos * c[0]! + sin * c[1]!, c[1]! - sin * c[0]! - cos * c[1]!];
}

/** A piece's transform in the frame: translate, rotate and scale about its pivot; a claw's wave turns it about its wrist. */
export function pieceMatrix(f: Frame, p: PieceName): Mat {
  "worklet";
  const o = LAYOUT.piece[p];
  const pivot = PIECE_INFO[p].pivot;
  const rad = (f[o + 2]! * Math.PI) / 180;
  const s = f[o + 3]!;
  const a = s * Math.cos(rad);
  const b = s * Math.sin(rad);
  const cx = pivot[0];
  const cy = pivot[1];
  let m: Mat = [a, b, -b, a, f[o]! + cx - (a * cx - b * cy), f[o + 1]! + cy - (b * cx + a * cy)];
  if (p === "claw_l" || p === "claw_r") {
    const wave = f[LAYOUT.wave[p]]!;
    if (wave !== 0) m = mul(m, rotateAbout(wave, PIECE_INFO[p].wrist!));
  }
  return m;
}

/** A prop sits at x, y in its own size, as mascot.prop() writes translate(x y) scale(s). */
export function propMatrix(f: Frame, k: PropKind): Mat {
  "worklet";
  const o = LAYOUT.prop[k];
  const s = f[o + 2]!;
  return [s, 0, 0, s, f[o]!, f[o + 1]!];
}

// ---------------------------------------------------------------- springs and fades

/** A spring by feel: how long it takes (response, seconds) and how much it settles before arriving (damping, <1). */
export interface Spring {
  response: number;
  damping: number;
}
/**
 * The two springs. Calm, Apple-like: no visible bounce, about 1% overshoot, settled in well under a second.
 * `pose` moves between states; `tuck` is the quicker reflex of pulling into the shell.
 */
export const SPRINGS = {
  pose: { response: 0.52, damping: 0.86 },
  tuck: { response: 0.38, damping: 0.9 },
} as const satisfies Record<string, Spring>;

/**
 * Fades and the follow-through, in ms (decisions.md). The fades use the app's motion tokens (the polish round's
 * src/motion.ts): an entrance is duration.medium with the standard ease-out, an exit duration.short, ease-in cubic.
 */
export const TIMING = {
  /** Claws start this long after the head: the small lag of a real limb. */
  clawLag: 30,
  /** A prop that is already shown moves this long after the claw that holds it. */
  propLag: 40,
  /** A piece coming into view: wait, then fade in (ease-out quint). */
  appearDelay: 90,
  appearFade: duration.medium,
  /** A prop coming into view waits for the claw that holds it to arrive. */
  propAppearDelay: 200,
  /** Going out of view: right away, quicker (ease-in cubic). */
  vanishFade: duration.short,
  /** Eyes closing or opening during a pose change. */
  shutDelay: 40,
  shutFade: 110,
} as const;

export interface PartsTrack {
  from: Frame;
  to: Frame;
  /** Spring terms per number: value = to + e^(-zw t) (A cos(wd t) + B sin(wd t)). */
  A: number[];
  B: number[];
  delay: number[];
  /** Fade length per number (fades only). */
  fade: number[];
  zw: number;
  wd: number;
  /** The hello wave on the left claw: amplitude (degrees), when it starts and one swing's length (ms), swings. */
  wave: number;
  waveAt: number;
  wavePeriod: number;
  waveCycles: number;
  /** From here on the frame is `to`, exactly (ms). */
  end: number;
}

export interface PartsOptions {
  spring: Spring;
  /** The hello wave: two swings of the raised claw about its wrist. */
  wave?: { amp: number; at: number; period: number; cycles: number };
}

/** The hello wave (decisions.md): the left claw rises to WAVE_L, then two swings of 16 degrees, then rest. */
export const HELLO_WAVE = { amp: 16, at: 260, period: 620, cycles: 2 } as const;

/** Ease-out quint: a quick start and a long, soft landing. */
function easeOut(p: number): number {
  "worklet";
  const q = 1 - p;
  return 1 - q * q * q * q * q;
}
function easeIn(p: number): number {
  "worklet";
  return p * p * p;
}
function smoothstep(p: number): number {
  "worklet";
  const q = p < 0 ? 0 : p > 1 ? 1 : p;
  return q * q * (3 - 2 * q);
}

/**
 * A move from where the crab is now (`from`, moving at `velocity` per second) to a rest frame. Springs keep the
 * velocity of an interrupted move, so a pose change mid-flight bends the path instead of restarting it.
 */
export function buildPartsTrack(from: Frame, velocity: Frame, to: Frame, opt: PartsOptions): PartsTrack {
  "worklet";
  const n = to.length;
  const start = from.slice();
  const end = to.slice();
  // A prop coming into view rises into place from a little below; one leaving drifts up as it fades.
  for (let o = PROP_START; o < n; o += 4) {
    if (start[o + 3]! < 0.01 && end[o + 3]! > 0) {
      start[o] = end[o]!;
      start[o + 1] = end[o + 1]! + 10;
      start[o + 2] = end[o + 2]! * 0.9;
    } else if (end[o + 3] === 0 && start[o + 3]! > 0) {
      end[o] = start[o]!;
      end[o + 1] = start[o + 1]! - 6;
      end[o + 2] = start[o + 2]!;
    }
  }
  const w = (2 * Math.PI) / opt.spring.response;
  const zeta = opt.spring.damping;
  const zw = zeta * w;
  const wd = w * Math.sqrt(1 - zeta * zeta);
  const A: number[] = new Array(n).fill(0);
  const B: number[] = new Array(n).fill(0);
  const delay: number[] = new Array(n).fill(0);
  const fade: number[] = new Array(n).fill(0);
  let last = 0;
  for (let i = 0; i < n; i++) {
    const d = start[i]! - end[i]!;
    if (KIND[i] === 1) {
      if (d === 0) continue;
      const rising = end[i]! > start[i]!;
      const eyes = GROUP[i] === 3 && i !== LAYOUT.piece.eye_l + OP && i !== LAYOUT.piece.eye_r + OP;
      delay[i] = eyes ? TIMING.shutDelay : rising ? (GROUP[i] === 2 ? TIMING.propAppearDelay : TIMING.appearDelay) : 0;
      fade[i] = eyes ? TIMING.shutFade : rising ? TIMING.appearFade : TIMING.vanishFade;
      last = Math.max(last, delay[i]! + fade[i]!);
      continue;
    }
    const v = velocity[i] ?? 0;
    if (d === 0 && v === 0) continue;
    A[i] = d;
    B[i] = (v + zw * d) / wd;
    // The follow-through lag is for a piece starting from rest; one already moving keeps moving.
    const g = GROUP[i];
    delay[i] = v !== 0 ? 0 : g === 1 ? TIMING.clawLag : g === 2 && start[i - ((i - PROP_START) % 4) + 3]! > 0.01 ? TIMING.propLag : 0;
    const amp = Math.sqrt(A[i]! * A[i]! + B[i]! * B[i]!);
    const settle = amp > EPS[i]! ? (Math.log(amp / EPS[i]!) / zw) * 1000 : 0;
    last = Math.max(last, delay[i]! + settle);
  }
  const wave = opt.wave;
  if (wave) last = Math.max(last, wave.at + wave.period * wave.cycles);
  return {
    from: start,
    to: end,
    A,
    B,
    delay,
    fade,
    zw,
    wd,
    wave: wave ? wave.amp : 0,
    waveAt: wave ? wave.at : 0,
    wavePeriod: wave ? wave.period : 1,
    waveCycles: wave ? wave.cycles : 0,
    end: Math.ceil(last),
  };
}

/** The frame `t` ms into a track. At and after `end` it is the rest frame, number for number. */
export function evalParts(track: PartsTrack, t: number): Frame {
  "worklet";
  const to = track.to;
  const n = to.length;
  if (t >= track.end) return to.slice();
  const out: Frame = new Array(n);
  for (let i = 0; i < n; i++) {
    const local = t - track.delay[i]!;
    if (KIND[i] === 1) {
      const from = track.from[i]!;
      if (track.fade[i] === 0 || local >= track.fade[i]!) out[i] = to[i]!;
      else if (local <= 0) out[i] = from;
      else {
        const p = local / track.fade[i]!;
        out[i] = from + (to[i]! - from) * (to[i]! > from ? easeOut(p) : easeIn(p));
      }
      continue;
    }
    if (track.A[i] === 0 && track.B[i] === 0) {
      out[i] = to[i]!;
      continue;
    }
    if (local <= 0) {
      out[i] = track.from[i]!;
      continue;
    }
    const s = local / 1000;
    const e = Math.exp(-track.zw * s);
    out[i] = to[i]! + e * (track.A[i]! * Math.cos(track.wd * s) + track.B[i]! * Math.sin(track.wd * s));
  }
  if (track.wave !== 0) {
    const u = t - track.waveAt;
    const len = track.wavePeriod * track.waveCycles;
    if (u > 0 && u < len) {
      const env = smoothstep(u / (track.wavePeriod * 0.3)) * smoothstep((len - u) / (track.wavePeriod * 0.5));
      out[LAYOUT.wave.claw_l] = out[LAYOUT.wave.claw_l]! + track.wave * env * Math.sin((2 * Math.PI * u) / track.wavePeriod);
    }
  }
  return out;
}

/** How fast each number is moving `t` ms into a track, per second (for an interrupted move). */
export function partsVelocity(track: PartsTrack, t: number): Frame {
  "worklet";
  if (t <= 8 || t >= track.end) return new Array(track.to.length).fill(0);
  const a = evalParts(track, t - 8);
  const b = evalParts(track, t);
  const out: Frame = new Array(b.length);
  for (let i = 0; i < b.length; i++) out[i] = KIND[i] === 1 ? 0 : (b[i]! - a[i]!) / 0.008;
  return out;
}

/** A track that is already at rest: the frame stays `f`. */
export function restTrack(f: Frame): PartsTrack {
  "worklet";
  const n = f.length;
  const zero = new Array(n).fill(0);
  return { from: f.slice(), to: f.slice(), A: zero, B: zero.slice(), delay: zero.slice(), fade: zero.slice(), zw: 1, wd: 1, wave: 0, waveAt: 0, wavePeriod: 1, waveCycles: 0, end: 0 };
}

// ---------------------------------------------------------------- the body: small moves of the whole picture

/** Body moves (decisions.md). Each is [kind, start ms, amplitude scale], kinds below. */
export const BODY = { breath: 1, bob: 2, lean: 3, settle: 4, recoil: 5, work: 6 } as const;
export type BodyMove = [kind: number, at: number, k: number];

/** Durations of the finite body moves, ms. A bob loops until the pose changes. */
export const BODY_MS = {
  breath: 3400,
  bobThinking: 2800,
  bobWorking: 2000,
  lean: 1400,
  settle: 900,
  recoil: 800,
} as const;

/** Largest offsets, in dp at a 112 dp crab (smaller crabs move proportionally less), degrees, and scale. */
export const BODY_AMP = {
  breathY: 0.012,
  breathX: 0.006,
  bob: 1.6,
  workTilt: 0.6,
  leanTilt: 2.2,
  lean: 1.0,
  settle: 1.6,
  settleSquash: 0.008,
  recoil: 1.4,
  recoilTilt: 2.4,
} as const;

export interface BodyTrack {
  /** The previous track's offset when this one started, released to zero by a spring (A, B per number). */
  A: number[];
  B: number[];
  moves: BodyMove[];
  /** ms; -1 while a loop (a bob) runs. */
  end: number;
}

const BODY_REL = { zw: 0.86 * ((2 * Math.PI) / 0.5), wd: ((2 * Math.PI) / 0.5) * Math.sqrt(1 - 0.86 * 0.86) };

/** A kick that rises, falls back past zero a little and settles: 0 at u = 0, peak about 1. */
function kick(u: number, response: number, damping: number): number {
  "worklet";
  if (u <= 0) return 0;
  const w = (2 * Math.PI) / response;
  const zw = damping * w;
  const wd = w * Math.sqrt(1 - damping * damping);
  const s = u / 1000;
  // normalised so the first peak is 1
  const peak = Math.atan(wd / zw) / wd;
  const norm = Math.exp(-zw * peak) * Math.sin(wd * peak);
  return (Math.exp(-zw * s) * Math.sin(wd * s)) / norm;
}

function bodyMove(m: BodyMove, t: number, out: number[]): void {
  "worklet";
  const u = t - m[1];
  const k = m[2];
  if (u < 0) return;
  switch (m[0]) {
    case BODY.breath: {
      if (u > BODY_MS.breath) return;
      const b = (1 - Math.cos((2 * Math.PI * u) / BODY_MS.breath)) / 2;
      out[3] = out[3]! + BODY_AMP.breathX * b;
      out[4] = out[4]! + BODY_AMP.breathY * b;
      return;
    }
    case BODY.bob:
    case BODY.work: {
      const period = m[0] === BODY.bob ? BODY_MS.bobThinking : BODY_MS.bobWorking;
      const ramp = u < period ? smoothstep(u / period) : 1;
      out[1] = out[1]! - BODY_AMP.bob * k * ((1 - Math.cos((2 * Math.PI * u) / period)) / 2);
      if (m[0] === BODY.work) out[2] = out[2]! + BODY_AMP.workTilt * ramp * Math.sin((2 * Math.PI * u) / period);
      return;
    }
    case BODY.lean: {
      if (u > BODY_MS.lean) return;
      const p = u < 280 ? easeOut(u / 280) : u < 700 ? 1 : 1 - smoothstep((u - 700) / 700);
      out[0] = out[0]! + BODY_AMP.lean * k * p;
      out[2] = out[2]! + BODY_AMP.leanTilt * p;
      return;
    }
    case BODY.settle: {
      if (u > BODY_MS.settle) return;
      const v = kick(u, 0.42, 0.55) * (1 - smoothstep((u - BODY_MS.settle + 200) / 200));
      out[1] = out[1]! + BODY_AMP.settle * k * v;
      out[4] = out[4]! - BODY_AMP.settleSquash * v;
      return;
    }
    case BODY.recoil: {
      if (u > BODY_MS.recoil) return;
      const v = kick(u, 0.34, 0.6) * (1 - smoothstep((u - BODY_MS.recoil + 200) / 200));
      out[0] = out[0]! - BODY_AMP.recoil * k * v;
      out[1] = out[1]! - BODY_AMP.recoil * k * v;
      out[2] = out[2]! - BODY_AMP.recoilTilt * v;
      return;
    }
  }
}

function moveEnd(m: BodyMove): number {
  "worklet";
  switch (m[0]) {
    case BODY.breath:
      return m[1] + BODY_MS.breath;
    case BODY.lean:
      return m[1] + BODY_MS.lean;
    case BODY.settle:
      return m[1] + BODY_MS.settle;
    case BODY.recoil:
      return m[1] + BODY_MS.recoil;
    default:
      return -1;
  }
}

export const BODY_REST: Body = [0, 0, 0, 1, 1];

/** New body moves, starting from wherever the body is now (its offset springs back to zero underneath them). */
export function buildBodyTrack(now: Body, velocity: Body, moves: BodyMove[]): BodyTrack {
  "worklet";
  const A: number[] = [now[0]!, now[1]!, now[2]!, now[3]! - 1, now[4]! - 1];
  const B: number[] = new Array(5);
  let last = 0;
  for (let i = 0; i < 5; i++) {
    B[i] = ((velocity[i] ?? 0) + BODY_REL.zw * A[i]!) / BODY_REL.wd;
    const amp = Math.sqrt(A[i]! * A[i]! + B[i]! * B[i]!);
    if (amp > 0.0005) last = Math.max(last, (Math.log(amp / 0.0005) / BODY_REL.zw) * 1000);
  }
  let loops = false;
  for (const m of moves) {
    const e = moveEnd(m);
    if (e < 0) loops = true;
    else last = Math.max(last, e);
  }
  return { A, B, moves, end: loops ? -1 : Math.ceil(last) };
}

export function evalBody(track: BodyTrack, t: number): Body {
  "worklet";
  if (track.end >= 0 && t >= track.end) return [0, 0, 0, 1, 1];
  const s = t / 1000;
  const e = Math.exp(-BODY_REL.zw * s);
  const c = Math.cos(BODY_REL.wd * s);
  const sn = Math.sin(BODY_REL.wd * s);
  const out: number[] = new Array(5);
  for (let i = 0; i < 5; i++) out[i] = (i >= 3 ? 1 : 0) + e * (track.A[i]! * c + track.B[i]! * sn);
  for (const m of track.moves) bodyMove(m, t, out);
  return out;
}

export function bodyVelocity(track: BodyTrack, t: number): Body {
  "worklet";
  if (t <= 8) return [0, 0, 0, 0, 0];
  const a = evalBody(track, t - 8);
  const b = evalBody(track, t);
  return [0, 1, 2, 3, 4].map((i) => (b[i]! - a[i]!) / 0.008);
}

/** Body offsets scale with the crab: full size from 112 dp, proportionally less below, never more than 2 dp. */
export function bodyScale(width: number): number {
  return Math.min(1, Math.max(0.3, width / 112));
}

// ---------------------------------------------------------------- what each pose does

/** The app's poses (mascot.ts): every chat state, plus the hello of the first run. */
export type MotionPose = "idle" | "thinking" | "working" | "asking" | "done" | "error" | "blocked" | "offline" | "hello";

export interface PoseMotion {
  /** The spring of a change into this pose. */
  spring: keyof typeof SPRINGS;
  /** Body moves on arriving (each [kind, start ms]). */
  arrive: readonly (readonly [number, number])[];
  /** A body loop while the pose lasts. */
  loop: number | null;
  /** Blinks: the wait between two, ms. Only where the eyes are open. */
  blinks: readonly [number, number] | null;
  /** Occasional breaths while the pose rests. */
  breathes: boolean;
  /** The claw wave of the first hello. */
  wave: boolean;
}

/**
 * The motion of every pose (decisions.md): idle breathes and blinks; hello waves twice; thinking and working bob;
 * asking leans in and then holds still; done settles; error and blocked recoil once; nothing loops on a refusal.
 */
export const POSE_MOTION: Record<MotionPose, PoseMotion> = {
  idle: { spring: "pose", arrive: [], loop: null, blinks: [2800, 6200], breathes: true, wave: false },
  hello: { spring: "pose", arrive: [], loop: null, blinks: [2800, 6200], breathes: true, wave: true },
  thinking: { spring: "pose", arrive: [], loop: BODY.bob, blinks: [2600, 5600], breathes: false, wave: false },
  working: { spring: "pose", arrive: [], loop: BODY.work, blinks: [3000, 6500], breathes: false, wave: false },
  asking: { spring: "pose", arrive: [[BODY.lean, 120]], loop: null, blinks: [4200, 8500], breathes: false, wave: false },
  done: { spring: "pose", arrive: [[BODY.settle, 260]], loop: null, blinks: null, breathes: true, wave: false },
  error: { spring: "pose", arrive: [[BODY.recoil, 0]], loop: null, blinks: [4200, 8500], breathes: false, wave: false },
  blocked: { spring: "tuck", arrive: [[BODY.recoil, 0]], loop: null, blinks: null, breathes: false, wave: false },
  offline: { spring: "tuck", arrive: [], loop: null, blinks: null, breathes: false, wave: false },
};

/** Ambient life ends this long after the last pose change: breaths stop; blinks go on, sparse. */
export const BREATHS_FOR = 45_000;
/** A breath, then a pause of this range before the next one, ms. */
export const BREATH_PAUSE: readonly [number, number] = [700, 2400];
/** A blink keeps the eyes shut this long (ms); one in eight is a double blink. */
export const BLINK = { shut: 120, open: 110, doubleChance: 0.125 } as const;

/** The body moves of a change into `pose` (its arrival, not its loop), for a crab `width` dp wide. */
export function arriveMoves(pose: MotionPose, width: number): BodyMove[] {
  const k = bodyScale(width);
  return POSE_MOTION[pose].arrive.map(([kind, at]): BodyMove => [kind, at, k]);
}

/** When a pose's arrival has played out (ms after the change): its loop and its breaths start after it. */
export function arrivalEnd(pose: MotionPose): number {
  let end = 0;
  for (const [kind, at] of POSE_MOTION[pose].arrive) {
    const e = moveEnd([kind, at, 1]);
    if (e > end) end = e;
  }
  return end;
}

/** A blink's timing: shut, or shut, open, shut. */
export function blinkPattern(rng: () => number): number[] {
  return rng() < BLINK.doubleChance ? [BLINK.shut, BLINK.open, BLINK.shut] : [BLINK.shut];
}

/** Uniform in [lo, hi). */
export function between(rng: () => number, range: readonly [number, number]): number {
  return range[0] + (range[1] - range[0]) * rng();
}

/** A small seeded generator (mulberry32), so a preview or a test sees the same blinks every run. */
export function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------- when it moves at all

/** Crabs at least this wide (dp) breathe, blink and bob; smaller ones (list rows, sheet marks) only change pose. */
export const AMBIENT_MIN_WIDTH = 56;

/**
 * HM-SET-06 and the phone's "remove animations" (Q52): Quiet mode hides the crab; reduced motion keeps it, still,
 * in the rig's rest pose, and pose changes swap without moving. `animate={false}` asks for the same stillness.
 */
export function mascotMotion(a: { showMascot: boolean; motion: boolean }, opt: { animate?: boolean; width?: number }): { show: boolean; live: boolean; ambient: boolean } {
  const show = a.showMascot;
  const live = show && a.motion && opt.animate !== false;
  const ambient = live && (opt.width ?? AMBIENT_MIN_WIDTH) >= AMBIENT_MIN_WIDTH;
  return { show, live, ambient };
}
