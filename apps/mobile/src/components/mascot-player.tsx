// The phone's player for the crab (docs/design/mascot/decisions.md): the scene drawn with react-native-svg, and every
// moving number computed on the UI thread by Reanimated from the pure motion engine (mascot-motion.ts), so the crab
// stays smooth while the JS thread streams tokens. Pieces move only while a pose changes; loops (breathing, the bob)
// move the whole picture as a view transform on the compositor, so the drawing is not redrawn for them. When nothing
// moves, nothing runs: the clocks are Reanimated timings that end with the motion.
// The browser preview uses mascot-player.web.tsx instead (same scene, same engine, requestAnimationFrame).
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { View, type StyleProp, type ViewStyle } from "react-native";
import Animated, { cancelAnimation, Easing, useAnimatedProps, useAnimatedStyle, useDerivedValue, useSharedValue, withDelay, withSequence, withTiming, type SharedValue } from "react-native-reanimated";
import Svg, { Circle, Defs, G, Mask, Path, Rect } from "react-native-svg";
import { scheduleOnUI } from "react-native-worklets";
import { RIG } from "../mascot-rig.ts";
import { BODY_REST, bodyVelocity, buildBodyTrack, buildPartsTrack, evalBody, evalParts, partsVelocity, restTrack, type Body, type BodyMove, type BodyTrack, type Frame, type PartsOptions, type PartsTrack } from "../mascot-motion.ts";
import { bound, type Attrs, type Scene, type SceneNode } from "../mascot-scene.ts";
import { BODY_ORIGIN, type Player, type SvgFit } from "./mascot-player-types";

export type { Player };

const AnimatedG = Animated.createAnimatedComponent(G);
const AnimatedPath = Animated.createAnimatedComponent(Path);
/** A loop's clock runs this long (an hour); a pose change or the app going to the background stops it first. */
const LOOP_MS = 3_600_000;
const STILL_BODY: BodyTrack = { A: [0, 0, 0, 0, 0], B: [0, 0, 0, 0, 0], moves: [], end: 0 };

/** The phone's player: the frame, the body and the eyes' blink live on the UI thread as shared values. */
export interface PhonePlayer extends Player {
  frame: SharedValue<Frame>;
  body: SharedValue<Body>;
  shut: SharedValue<number>;
}

export function usePlayer(initial: Frame): PhonePlayer {
  const track = useSharedValue<PartsTrack>(restTrack(initial));
  const clock = useSharedValue(0);
  const bodyTrack = useSharedValue<BodyTrack>(STILL_BODY);
  const bodyClock = useSharedValue(0);
  const shut = useSharedValue(0);
  const frame = useDerivedValue(() => evalParts(track.value, clock.value));
  const body = useDerivedValue(() => evalBody(bodyTrack.value, bodyClock.value));

  const player = useMemo<PhonePlayer>(
    () => ({
      frame,
      body,
      shut,
      playParts(to: Frame, opt: PartsOptions, from?: Frame) {
        scheduleOnUI(() => {
          "worklet";
          const t = clock.value;
          const now = from ?? evalParts(track.value, t);
          const velocity = from ? new Array(now.length).fill(0) : partsVelocity(track.value, t);
          cancelAnimation(clock);
          const next = buildPartsTrack(now, velocity, to, opt);
          clock.value = 0;
          track.value = next;
          clock.value = withTiming(next.end, { duration: next.end, easing: Easing.linear });
        });
      },
      playBody(moves: BodyMove[]) {
        scheduleOnUI(() => {
          "worklet";
          const t = bodyClock.value;
          const now = evalBody(bodyTrack.value, t);
          const velocity = bodyVelocity(bodyTrack.value, t);
          cancelAnimation(bodyClock);
          const next = buildBodyTrack(now, velocity, moves);
          bodyClock.value = 0;
          bodyTrack.value = next;
          const end = next.end < 0 ? LOOP_MS : next.end;
          bodyClock.value = withTiming(end, { duration: end, easing: Easing.linear });
        });
      },
      blink(pattern: readonly number[]) {
        scheduleOnUI(() => {
          "worklet";
          const steps: number[] = [withTiming<number>(1, { duration: 0 })];
          let closed = true;
          for (const ms of pattern) {
            closed = !closed;
            steps.push(withDelay(ms, withTiming<number>(closed ? 1 : 0, { duration: 0 })));
          }
          shut.value = withSequence(...steps);
        });
      },
      snap(to: Frame) {
        scheduleOnUI(() => {
          "worklet";
          cancelAnimation(clock);
          cancelAnimation(bodyClock);
          cancelAnimation(shut);
          track.value = restTrack(to);
          clock.value = 0;
          bodyTrack.value = STILL_BODY;
          bodyClock.value = 0;
          shut.value = 0;
        });
      },
      stop() {
        scheduleOnUI(() => {
          "worklet";
          cancelAnimation(clock);
          cancelAnimation(bodyClock);
          cancelAnimation(shut);
          track.value = restTrack(track.value.to);
          clock.value = 0;
          bodyTrack.value = STILL_BODY;
          bodyClock.value = 0;
          shut.value = 0;
        });
      },
    }),
    // The player lives as long as the crab: its shared values never change identity.
    [frame, body, shut, track, clock, bodyTrack, bodyClock],
  );
  // Unmounted: nothing keeps ticking.
  useEffect(
    () => () => {
      cancelAnimation(clock);
      cancelAnimation(bodyClock);
      cancelAnimation(shut);
    },
    [clock, bodyClock, shut],
  );
  return player;
}

/** Decorative, as the PNG was: the label beside the crab says the same, so TalkBack skips it, and touches pass through. */
const HIDDEN = { accessible: false, importantForAccessibility: "no-hide-descendants", accessibilityElementsHidden: true, accessibilityIgnoresInvertColors: true, pointerEvents: "none" } as const;

/** The whole picture: its small loops are a view transform about the crab's feet, on the compositor. */
export function MascotBody({ player, style, children }: { player: PhonePlayer | null; style: StyleProp<ViewStyle>; children: ReactNode }) {
  if (!player) return <View style={style} {...HIDDEN}>{children}</View>;
  return <MovingBody player={player} style={style}>{children}</MovingBody>;
}

function MovingBody({ player, style, children }: { player: PhonePlayer; style: StyleProp<ViewStyle>; children: ReactNode }) {
  const body = player.body;
  const moving = useAnimatedStyle(() => {
    const b = body.value;
    return { transform: [{ translateX: b[0]! }, { translateY: b[1]! }, { rotate: `${b[2]!}deg` }, { scaleX: b[3]! }, { scaleY: b[4]! }] };
  });
  return (
    <Animated.View style={[style, { transformOrigin: BODY_ORIGIN }, moving]} {...HIDDEN}>
      {children}
    </Animated.View>
  );
}

/**
 * The drawing. A still crab (or reduced motion) draws `frame`. With a player, bound numbers follow its frame on the UI
 * thread; `first` is the frame the crab is in when an element first appears, given to it once as plain props.
 */
export function MascotSvg({ scene, player, frame, first, width, height, fit }: { scene: Scene; player: PhonePlayer | null; frame: Frame; first: Frame; width: number | string; height: number | string; fit: SvgFit }) {
  const draw = (n: SceneNode): ReactNode => <Node key={n.key} n={n} player={player} frame={frame} first={first} draw={draw} />;
  return (
    <Svg
      width={width}
      height={height}
      viewBox={RIG.viewBox.join(" ")}
      preserveAspectRatio={fit === "exact" ? "xMidYMin slice" : "xMidYMid meet"}
      accessible={false}
      importantForAccessibility="no-hide-descendants"
    >
      <Defs>
        {scene.masks.map((m) => (
          <Mask key={m.id} id={m.id} maskUnits="userSpaceOnUse" x={RIG.viewBox[0]} y={RIG.viewBox[1]} width={RIG.viewBox[2]} height={RIG.viewBox[3]}>
            {m.children.map(draw)}
          </Mask>
        ))}
      </Defs>
      {scene.root.map(draw)}
    </Svg>
  );
}

/** Scene attributes as react-native-svg props: a `matrix` becomes a transform, a mask id a url. */
function svgProps(n: SceneNode): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(n.attrs as Attrs)) {
    if (v === undefined) continue;
    out[k === "matrix" ? "transform" : k] = v;
  }
  if (n.mask) out.mask = `url(#${n.mask})`;
  return out;
}

/** What the UI thread changes on a moving element: react-native-svg's native `matrix`, its opacity, a gap's stroke. */
type MovingProps = { matrix?: readonly number[]; opacity?: number; strokeWidth?: number };

function staticProps(b: ReturnType<typeof bound>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (b.matrix) out.transform = b.matrix;
  if (b.opacity !== undefined) out.opacity = b.opacity;
  if (b.strokeWidth !== undefined) out.strokeWidth = b.strokeWidth;
  return out;
}

function Node({ n, player, frame, first, draw }: { n: SceneNode; player: PhonePlayer | null; frame: Frame; first: Frame; draw: (n: SceneNode) => ReactNode }) {
  const kids = n.children?.map(draw);
  const attrs = svgProps(n);
  if (n.bind && player) {
    const eyes = n.bind.t === "eyeOpen" || n.bind.t === "eyeShut";
    return eyes ? (
      <BoundEye n={n} attrs={attrs} player={player} first={first}>
        {kids}
      </BoundEye>
    ) : (
      <BoundFrame n={n} attrs={attrs} player={player} first={first}>
        {kids}
      </BoundFrame>
    );
  }
  const all = n.bind ? { ...attrs, ...staticProps(bound(n.bind, frame, 0)) } : attrs;
  switch (n.el) {
    case "g":
      return <G {...all}>{kids}</G>;
    case "path":
      return <Path {...all} />;
    case "rect":
      return <Rect {...all} />;
    case "circle":
      return <Circle {...all} />;
  }
}

/** A piece, a prop or a paper gap: follows the frame (and nothing else, so a blink redraws only the eyes). */
function BoundFrame({ n, attrs, player, first, children }: { n: SceneNode; attrs: Record<string, unknown>; player: PhonePlayer; first: Frame; children?: ReactNode }) {
  const bind = n.bind!;
  const frame = player.frame;
  const animatedProps = useAnimatedProps((): MovingProps => {
    const b = bound(bind, frame.value, 0);
    return b.strokeWidth !== undefined ? { strokeWidth: b.strokeWidth } : { matrix: b.matrix, opacity: b.opacity };
  });
  // Placed once, as plain props, where the crab is when this element appears; from then on only the UI thread moves
  // it, and React re-renders hand it the same values, so they never override a moving piece.
  const [placed] = useState(() => staticProps(bound(bind, first, 0)));
  if (n.el === "path") return <AnimatedPath {...attrs} {...placed} animatedProps={animatedProps} />;
  return (
    <AnimatedG {...attrs} {...placed} animatedProps={animatedProps}>
      {children}
    </AnimatedG>
  );
}

/** The open dots or the closed strokes of an eye: the frame's `shut` and the blink. */
function BoundEye({ n, attrs, player, first, children }: { n: SceneNode; attrs: Record<string, unknown>; player: PhonePlayer; first: Frame; children?: ReactNode }) {
  const bind = n.bind!;
  const frame = player.frame;
  const shut = player.shut;
  const animatedProps = useAnimatedProps(() => ({ opacity: bound(bind, frame.value, shut.value).opacity }));
  const [placed] = useState(() => staticProps(bound(bind, first, 0)));
  return (
    <AnimatedG {...attrs} {...placed} animatedProps={animatedProps}>
      {children}
    </AnimatedG>
  );
}
