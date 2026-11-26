// Preview only: react-native-svg's shapes as plain DOM SVG, so the mockups' icons render in Chromium. On the phone the
// same imports resolve to react-native-svg itself.
import type { ReactNode } from "react";

type P = Record<string, unknown> & { children?: ReactNode };

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export default function Svg({ children, accessible, importantForAccessibility, ...rest }: P) {
  return (
    <svg {...rest} style={{ display: "block", flexShrink: 0, ...(rest.style as object | undefined) }} aria-hidden="true">
      {children}
    </svg>
  );
}
export const Path = (p: P) => <path {...p} />;
export const Circle = (p: P) => <circle {...p} />;
export const Rect = (p: P) => <rect {...p} />;
export const Line = (p: P) => <line {...p} />;
export const Defs = (p: P) => <defs {...p} />;
export const RadialGradient = (p: P) => <radialGradient {...p} />;
export const LinearGradient = (p: P) => <linearGradient {...p} />;
export const Stop = (p: P) => <stop {...p} />;
