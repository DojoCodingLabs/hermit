// The crab, drawn from the rig and directed: which move plays when the pose changes, and the small life of a crab
// at rest (blinks, breaths, the bob while Hermit works). The numbers are in mascot-motion.ts; the drawing and the
// clocks are in mascot-player (Reanimated on the phone, requestAnimationFrame in the browser preview).
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { AppState, type ImageStyle, type StyleProp, type ViewStyle } from "react-native";
import { RIG_POSE, type Pose } from "../mascot";
import { arriveMoves, arrivalEnd, between, blinkPattern, BODY, BODY_MS, bodyScale, BREATH_PAUSE, BREATHS_FOR, HELLO_WAVE, POSE_MOTION, rigFrame, seeded, SPRINGS, type PartsOptions } from "../mascot-motion.ts";
import type { RigPoseName } from "../mascot-rig.ts";
import { buildScene } from "../mascot-scene.ts";
import { MascotBody, MascotSvg, usePlayer } from "./mascot-player";
import type { SvgFit } from "./mascot-player-types";

export interface MascotArtProps {
  pose: Pose;
  dark: boolean;
  width?: number;
  style?: StyleProp<ImageStyle | ViewStyle>;
  /** Moves at all (not Quiet, not reduced motion, not animate={false}). */
  live: boolean;
  /** Breathes, blinks and bobs (big enough to be a presence, not a mark in a row). */
  ambient: boolean;
  /** Fixes the blinks' and breaths' timing, for the preview and tests. */
  seed?: number;
}

interface Sizing {
  box: StyleProp<ViewStyle>;
  svg: { width: number | string; height: number | string; fit: SvgFit };
}

function sizing(width: number | undefined, style: MascotArtProps["style"]): Sizing {
  // The rig's frame is 512 by 444: with a width the height follows, and the drawing scales by width like the PNGs.
  if (width) {
    const height = Math.round((width * 444) / 512);
    return { box: [{ width, height }, style as StyleProp<ViewStyle>], svg: { width, height, fit: "exact" } };
  }
  return { box: style as StyleProp<ViewStyle>, svg: { width: "100%", height: "100%", fit: "contain" } };
}

export function MascotArt(props: MascotArtProps) {
  const { pose, live, ambient } = props;
  // Remember the pose being left, so a still crab that has to change can start moving from where it was.
  const [seen, setSeen] = useState<{ pose: Pose; prev?: Pose }>({ pose });
  if (seen.pose !== pose) setSeen({ pose, prev: live ? seen.pose : undefined });
  else if (!live && seen.prev !== undefined) setSeen({ pose });
  // A crab stays a plain drawing until it has to move: rows of small crabs never start a player.
  const moving = live && (ambient || seen.prev !== undefined);
  const size = sizing(props.width, props.style);
  return moving ? <LiveCrab {...props} from={seen.prev} size={size} /> : <StillCrab {...props} size={size} />;
}

function useMaskId(): string {
  return `crab${useId().replace(/[^a-zA-Z0-9]/g, "")}`;
}

function StillCrab({ pose, dark, size }: MascotArtProps & { size: Sizing }) {
  return <RigStill rig={RIG_POSE[pose]} dark={dark} size={size} />;
}

/**
 * A still crab in any pose of the rig, the same drawing a still or resting crab is in the app. The proof page
 * (docs/design/mascot) renders every pose of docs/brand/mascot/png with it.
 */
export function MascotStill({ rig, dark, width }: { rig: RigPoseName; dark: boolean; width: number }) {
  return <RigStill rig={rig} dark={dark} size={sizing(width, undefined)} />;
}

function RigStill({ rig, dark, size }: { rig: RigPoseName; dark: boolean; size: Sizing }) {
  const id = useMaskId();
  const scene = useMemo(() => buildScene({ poses: [rig], blinks: false, dark, id }), [rig, dark, id]);
  const frame = useMemo(() => rigFrame(rig), [rig]);
  return (
    <MascotBody player={null} style={size.box}>
      <MascotSvg scene={scene} player={null} frame={frame} first={frame} {...size.svg} />
    </MascotBody>
  );
}

function partsOptions(pose: Pose): PartsOptions {
  const m = POSE_MOTION[pose];
  return m.wave ? { spring: SPRINGS[m.spring], wave: HELLO_WAVE } : { spring: SPRINGS[m.spring] };
}

function LiveCrab({ pose, from, dark, width, ambient, seed, size }: MascotArtProps & { from?: Pose; size: Sizing }) {
  const id = useMaskId();
  // The first hello rises from the idle pose into its wave; a crab that starts moving on a change starts where it was.
  const [start] = useState<Pose>(() => from ?? (pose === "hello" ? "idle" : pose));
  const [pair, setPair] = useState<[Pose, Pose]>([start, pose]);
  if (pair[1] !== pose) setPair([pair[1], pose]);
  const player = usePlayer(useMemo(() => rigFrame(RIG_POSE[start]), [start]));
  const first = useMemo(() => rigFrame(RIG_POSE[pair[0]]), [pair]);
  const scene = useMemo(() => buildScene({ poses: [RIG_POSE[pair[0]], RIG_POSE[pair[1]]], blinks: true, dark, id, live: true }), [pair, dark, id]);
  const rng = useRef(seeded(seed ?? Math.floor(Math.random() * 2 ** 31)));
  const changedAt = useRef(0);
  const w = width ?? 112;

  // In the background, nothing moves (and nothing is scheduled). AppState can start as "unknown": only
  // "background" counts as away.
  const [active, setActive] = useState(() => AppState.currentState !== "background");
  const activeNow = useRef(active);
  useEffect(() => {
    const sub = AppState.addEventListener("change", (s) => setActive(s !== "background"));
    return () => sub.remove();
  }, []);
  useEffect(() => {
    activeNow.current = active;
    if (!active) player.stop();
  }, [active, player]);

  // A pose change: the pieces spring to the new pose, the body plays the arrival (a lean, a settle, a recoil).
  // Away in the background, the pose just swaps.
  const mounted = useRef(false);
  useEffect(() => {
    const to = rigFrame(RIG_POSE[pose]);
    changedAt.current = Date.now();
    if (!activeNow.current) {
      mounted.current = true;
      player.snap(to);
      return;
    }
    if (!mounted.current) {
      mounted.current = true;
      if (start !== pose) player.playParts(to, partsOptions(pose), rigFrame(RIG_POSE[start]));
    } else {
      player.playParts(to, partsOptions(pose));
    }
    player.playBody(arriveMoves(pose, w));
  }, [pose, player, start, w]);

  // Life at rest: blinks at irregular intervals, breaths for a while after a change, the bob while Hermit works.
  useEffect(() => {
    if (!ambient || !active) return;
    const m = POSE_MOTION[pose];
    const timers = new Set<ReturnType<typeof setTimeout>>();
    const after = (ms: number, fn: () => void) => {
      const t = setTimeout(() => {
        timers.delete(t);
        fn();
      }, Math.max(0, ms));
      timers.add(t);
    };
    const settle = changedAt.current + arrivalEnd(pose) - Date.now();
    if (m.loop !== null) {
      const loop = m.loop;
      after(settle, () => player.playBody([[loop, 0, bodyScale(w)]]));
    }
    if (m.blinks) {
      const range = m.blinks;
      const next = () =>
        after(between(rng.current, range), () => {
          player.blink(blinkPattern(rng.current));
          next();
        });
      next();
    }
    if (m.breathes) {
      const until = changedAt.current + BREATHS_FOR;
      const breathe = () => {
        if (Date.now() > until) return;
        player.playBody([[BODY.breath, 0, 1]]);
        after(BODY_MS.breath + between(rng.current, BREATH_PAUSE), breathe);
      };
      after(Math.max(settle, 600) + between(rng.current, BREATH_PAUSE), breathe);
    }
    return () => timers.forEach(clearTimeout);
  }, [pose, ambient, active, player, w]);

  return (
    <MascotBody player={player} style={size.box}>
      <MascotSvg scene={scene} player={player} frame={first} first={first} {...size.svg} />
    </MascotBody>
  );
}
