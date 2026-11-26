// The crab: the reference drawing, as vectors from the rig (docs/brand/mascot, never redrawn), moved only by transforms of
// its own pieces (docs/design/mascot). Quiet mode (HM-SET-06) hides it everywhere; whatever text sits beside it
// stays, so the state is never shown by the picture alone. With the phone's "remove animations" on (Q52), it stays,
// still, in the rig's rest pose, and pose changes swap without moving.
import type { ImageStyle, StyleProp } from "react-native";
import { useAppearance } from "../appearance";
import type { Pose } from "../mascot";
import { mascotMotion } from "../mascot-motion.ts";
import { MascotArt } from "./MascotArt";

/**
 * The rig's frame is 512 by 444: give `width` and the height follows, or pass a full style. `animate={false}` keeps
 * it still in its rest pose. Decorative: the label beside it says the same, so screen readers skip it.
 */
export function Mascot({ state, dark, style, width, animate }: { state: Pose; dark: boolean; style?: StyleProp<ImageStyle>; width?: number; animate?: boolean }) {
  const { show, live, ambient } = mascotMotion(useAppearance(), { animate, width });
  if (!show) return null;
  return <MascotArt pose={state} dark={dark} width={width} style={style} live={live} ambient={ambient} />;
}
