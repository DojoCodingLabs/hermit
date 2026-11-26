// One icon set for the app: Lucide (ISC, src/icons/LICENSE-lucide.txt), vendored in src/icons/lucide.ts and drawn
// with react-native-svg, so the app bundles the shapes and fetches nothing. 24 grid, 1.75 stroke, round caps and joins.
// Icons are decorative: the text or the label next to them says the same, so TalkBack skips them.
import { useWindowDimensions } from "react-native";
import Svg, { Circle, Line, Path, Rect } from "react-native-svg";
import { lucide, type IconName } from "../icons/lucide";

const parts = { path: Path, circle: Circle, rect: Rect, line: Line } as const;

export type { IconName };

/** An icon grows with the phone's font size, up to 1.5 times, so it keeps up with the text beside it. */
export function useIconSize(base = 24): number {
  const { fontScale } = useWindowDimensions();
  return Math.round(base * Math.min(Math.max(fontScale, 1), 1.5));
}

export function Icon({ name, size = 24, color, strokeWidth = 1.75, fixed }: { name: IconName; size?: number; color: string; strokeWidth?: number; fixed?: boolean }) {
  const scaled = useIconSize(size);
  const px = fixed ? size : scaled;
  const nodes = lucide[name] as unknown as [keyof typeof parts, Record<string, string>][];
  return (
    <Svg width={px} height={px} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" accessible={false} importantForAccessibility="no-hide-descendants">
      {nodes.map(([tag, attrs], i) => {
        const Part = parts[tag];
        return <Part key={i} {...attrs} />;
      })}
    </Svg>
  );
}
