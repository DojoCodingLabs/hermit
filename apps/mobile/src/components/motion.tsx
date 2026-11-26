// The motion layer (docs/design/polish/decisions.md, "Motion"): React Native's Animated on the native driver, reading the
// tokens in ../motion.ts. Each piece says what changed: a press, a block arriving, a status swapping, a row folding.
// With Quiet mode or the phone's "remove animations" (useAppearance().motion false) everything lands at once; a press
// still dims, because that is feedback, not movement.
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Animated, Easing, LayoutAnimation, type StyleProp, type ViewStyle } from "react-native";
import { useAppearance } from "../appearance";
import { distance, duration, easing as curves, press, spring } from "../motion";

type Curve = readonly [number, number, number, number];

/** A token curve as an Animated easing. */
export const bezier = (c: Curve) => Easing.bezier(c[0], c[1], c[2], c[3]);

/** True when things may move (no Quiet mode, no "remove animations"). */
export function useMotion(): boolean {
  return useAppearance().motion;
}

/**
 * Press feedback. Spread `handlers` on the Pressable and put `style` on the view inside it: buttons sink and dim
 * ("scale"); long rows only dim ("dim"), because a full-width row shrinking reads as a glitch.
 */
export function usePress(kind: "scale" | "dim" = "scale") {
  const motion = useMotion();
  const v = useRef(new Animated.Value(0)).current;
  const go = (to: number) => {
    if (!motion) return v.setValue(to);
    Animated.spring(v, { toValue: to, ...spring.press, useNativeDriver: true }).start();
  };
  const opacity = v.interpolate({ inputRange: [0, 1], outputRange: [1, press.opacity] });
  const style = kind === "scale" && motion ? { opacity, transform: [{ scale: v.interpolate({ inputRange: [0, 1], outputRange: [1, press.scale] }) }] } : { opacity };
  return { handlers: { onPressIn: () => go(1), onPressOut: () => go(0) }, style };
}

/** A block that rises a few dp and fades in when it first mounts (a screen's first content, a new message). */
export function Reveal({ children, delay = 0, rise = distance.rise, style }: { children: ReactNode; delay?: number; rise?: number; style?: StyleProp<ViewStyle> }) {
  const motion = useMotion();
  const v = useRef(new Animated.Value(motion ? 0 : 1)).current;
  useEffect(() => {
    if (!motion) return;
    const a = Animated.timing(v, { toValue: 1, duration: duration.long, delay, easing: bezier(curves.enter), useNativeDriver: true });
    a.start();
    return () => a.stop();
    // Runs once: a block reveals when it arrives, not when its props change.
  }, []);
  if (!motion) return <Animated.View style={style}>{children}</Animated.View>;
  return <Animated.View style={[style, { opacity: v, transform: [{ translateY: v.interpolate({ inputRange: [0, 1], outputRange: [rise, 0] }) }] }]}>{children}</Animated.View>;
}

/**
 * Swaps what it shows with a quick crossfade when `id` changes (a status word, an icon); the new content renders
 * right away when motion is off. `children` renders the content for an id.
 */
export function CrossFade({ id, children, style }: { id: string; children: (id: string) => ReactNode; style?: StyleProp<ViewStyle> }) {
  const motion = useMotion();
  const [shown, setShown] = useState(id);
  const v = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (id === shown) return;
    if (!motion) return setShown(id);
    // Stopping an Animated animation stops whatever runs on its value, so only an unfinished fade-out is stopped:
    // never the fade-in that follows it.
    let done = false;
    const out = Animated.timing(v, { toValue: 0, duration: duration.short * 0.75, easing: bezier(curves.exit), useNativeDriver: true });
    out.start(({ finished }) => {
      done = true;
      if (!finished) return;
      setShown(id);
      Animated.timing(v, { toValue: 1, duration: duration.short, easing: bezier(curves.standard), useNativeDriver: true }).start();
    });
    return () => {
      if (!done) out.stop();
    };
  }, [id, shown, motion, v]);
  return <Animated.View style={[style, { opacity: v }]}>{children(shown)}</Animated.View>;
}

/** Call right before a state change that adds, removes or folds rows: the layout eases into its new shape. */
export function easeLayout(motion: boolean): void {
  if (!motion) return;
  LayoutAnimation.configureNext({
    duration: duration.medium,
    create: { type: LayoutAnimation.Types.easeInEaseOut, property: LayoutAnimation.Properties.opacity },
    update: { type: LayoutAnimation.Types.easeInEaseOut },
    delete: { type: LayoutAnimation.Types.easeInEaseOut, property: LayoutAnimation.Properties.opacity },
  });
}

/** A value that springs to `to` whenever it changes (a segmented thumb, a switch's knob); jumps when motion is off. */
export function useSpringTo(to: number, kind: keyof typeof spring = "gentle"): Animated.Value {
  const motion = useMotion();
  const v = useRef(new Animated.Value(to)).current;
  useEffect(() => {
    if (!motion) return v.setValue(to);
    const a = Animated.spring(v, { toValue: to, ...spring[kind], useNativeDriver: true });
    a.start();
    return () => a.stop();
  }, [to, motion, kind, v]);
  return v;
}
