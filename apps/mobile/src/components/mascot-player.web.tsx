// The browser preview's player for the crab (apps/mobile/preview, react-native-web): the same scene and the same
// motion engine as the phone (mascot-player.tsx), drawn with DOM SVG and stepped by requestAnimationFrame. It exists
// so the preview harness renders and records the real component; the phone never loads this file.
import { createElement, useEffect, useMemo, useReducer, useRef, type ReactNode } from "react";
import { View, type StyleProp, type ViewStyle } from "react-native";
import { RIG } from "../mascot-rig.ts";
import { bodyVelocity, buildBodyTrack, buildPartsTrack, evalBody, evalParts, partsVelocity, restTrack, type Body, type BodyMove, type BodyTrack, type Frame, type PartsOptions, type PartsTrack } from "../mascot-motion.ts";
import { bound, type Scene, type SceneNode } from "../mascot-scene.ts";
import { BODY_ORIGIN, type Player, type SvgFit } from "./mascot-player-types";

export type { Player };

const STILL_BODY: BodyTrack = { A: [0, 0, 0, 0, 0], B: [0, 0, 0, 0, 0], moves: [], end: 0 };

interface State {
  parts: PartsTrack;
  partsAt: number;
  body: BodyTrack;
  bodyAt: number;
  /** [time, 1 shut or 0 open] */
  blinks: [number, number][];
  raf: number;
}

interface WebPlayer extends Player {
  read(): { frame: Frame; body: Body; blink: number };
}

export function usePlayer(initial: Frame): WebPlayer {
  const [, tick] = useReducer((n: number) => n + 1, 0);
  const s = useRef<State>({ parts: restTrack(initial), partsAt: 0, body: STILL_BODY, bodyAt: 0, blinks: [], raf: 0 });
  const player = useMemo<WebPlayer>(() => {
    const now = () => performance.now();
    const blinkAt = (st: State, t: number) => {
      let v = 0;
      for (const [at, value] of st.blinks) if (at <= t) v = value;
      return v;
    };
    const busy = (st: State, t: number) =>
      t - st.partsAt < st.parts.end || st.body.end < 0 || t - st.bodyAt < st.body.end || st.blinks.some(([at]) => at > t);
    const run = () => {
      cancelAnimationFrame(s.current.raf);
      const step = () => {
        tick();
        if (busy(s.current, now())) s.current.raf = requestAnimationFrame(step);
      };
      s.current.raf = requestAnimationFrame(step);
    };
    return {
      read() {
        const st = s.current;
        const t = now();
        return { frame: evalParts(st.parts, t - st.partsAt), body: evalBody(st.body, t - st.bodyAt), blink: blinkAt(st, t) };
      },
      playParts(to: Frame, opt: PartsOptions, from?: Frame) {
        const st = s.current;
        const t = now();
        const at = t - st.partsAt;
        const cur = from ?? evalParts(st.parts, at);
        const velocity = from ? new Array(cur.length).fill(0) : partsVelocity(st.parts, at);
        st.parts = buildPartsTrack(cur, velocity, to, opt);
        st.partsAt = t;
        run();
      },
      playBody(moves: BodyMove[]) {
        const st = s.current;
        const t = now();
        const at = t - st.bodyAt;
        st.body = buildBodyTrack(evalBody(st.body, at), bodyVelocity(st.body, at), moves);
        st.bodyAt = t;
        run();
      },
      blink(pattern: readonly number[]) {
        const st = s.current;
        let t = now();
        let shut = 1;
        st.blinks = [[t, 1]];
        for (const ms of pattern) {
          t += ms;
          shut = 1 - shut;
          st.blinks.push([t, shut]);
        }
        run();
      },
      snap(to: Frame) {
        const st = s.current;
        st.parts = restTrack(to);
        st.body = STILL_BODY;
        st.blinks = [];
        tick();
      },
      stop() {
        const st = s.current;
        cancelAnimationFrame(st.raf);
        st.parts = restTrack(st.parts.to);
        st.body = STILL_BODY;
        st.blinks = [];
        tick();
      },
    };
  }, []);
  useEffect(() => () => cancelAnimationFrame(s.current.raf), []);
  return player;
}

export function MascotBody({ player, style, children }: { player: Player | null; style: StyleProp<ViewStyle>; children: ReactNode }) {
  if (!player) return <View style={style} pointerEvents="none">{children}</View>;
  const b = (player as WebPlayer).read().body;
  const moving: ViewStyle = {
    transformOrigin: BODY_ORIGIN,
    transform: [{ translateX: b[0]! }, { translateY: b[1]! }, { rotate: `${b[2]!}deg` }, { scaleX: b[3]! }, { scaleY: b[4]! }],
  };
  return (
    <View style={[style, moving]} pointerEvents="none">
      {children}
    </View>
  );
}

export function MascotSvg({ scene, player, frame, width, height, fit }: { scene: Scene; player: Player | null; frame: Frame; first: Frame; width: number | string; height: number | string; fit: SvgFit }) {
  const st = player ? (player as WebPlayer).read() : { frame, blink: 0 };
  const draw = (n: SceneNode): ReactNode => {
    const attrs: Record<string, unknown> = { key: n.key };
    for (const [k, v] of Object.entries(n.attrs)) {
      if (v === undefined) continue;
      attrs[k === "matrix" ? "transform" : k] = k === "matrix" ? `matrix(${(v as number[]).join(" ")})` : v;
    }
    if (n.mask) attrs.mask = `url(#${n.mask})`;
    if (n.bind) {
      const b = bound(n.bind, st.frame, st.blink);
      if (b.matrix) attrs.transform = `matrix(${b.matrix.join(" ")})`;
      if (b.opacity !== undefined) attrs.opacity = b.opacity;
      if (b.strokeWidth !== undefined) attrs.strokeWidth = b.strokeWidth;
    }
    return createElement(n.el, attrs, n.children?.map(draw));
  };
  return (
    <svg
      width={width}
      height={height}
      viewBox={RIG.viewBox.join(" ")}
      preserveAspectRatio={fit === "exact" ? "xMidYMin slice" : "xMidYMid meet"}
      style={{ display: "block", overflow: "hidden" }}
      aria-hidden="true"
    >
      <defs>
        {scene.masks.map((m) => (
          <mask key={m.id} id={m.id} maskUnits="userSpaceOnUse" x={RIG.viewBox[0]} y={RIG.viewBox[1]} width={RIG.viewBox[2]} height={RIG.viewBox[3]}>
            {m.children.map(draw)}
          </mask>
        ))}
      </defs>
      {scene.root.map(draw)}
    </svg>
  );
}
