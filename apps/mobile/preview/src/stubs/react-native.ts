// Preview only: react-native-web, with the scheme pinned by the URL and Platform reporting Android like the phone.
// With ?fontScale=2 it plays Android's font size setting: text size and line height (and letter spacing) scale
// together, as they do on the phone, and useWindowDimensions reports the scale so icons grow with the text.
import { createElement, forwardRef } from "react";
import * as RNW from "react-native-web/dist/index.js";
import { scene } from "../scene";

export * from "react-native-web/dist/index.js";

type Styled = { style?: unknown; [k: string]: unknown };
const scaleText = (style: unknown, balanced = false) => {
  // Android's balanced line breaking (textBreakStrategy="balanced") is CSS text-wrap: balance in the browser.
  if (balanced) style = [style, { textWrap: "balance" }];
  if (scene.fontScale === 1 || !style) return style;
  const flat = (RNW.StyleSheet.flatten(style as never) ?? {}) as Record<string, unknown>;
  const out = { ...flat };
  for (const k of ["fontSize", "lineHeight", "letterSpacing"]) if (typeof flat[k] === "number") out[k] = (flat[k] as number) * scene.fontScale;
  return out;
};
const scaled = (Base: unknown, name: string) => {
  const C = forwardRef<unknown, Styled>((props, ref) => createElement(Base as never, { ...props, ref, style: scaleText(props.style, props.textBreakStrategy === "balanced") }));
  C.displayName = name;
  return C;
};
export const Text = scaled(RNW.Text, "Text");
export const TextInput = scene.fontScale === 1 ? RNW.TextInput : scaled(RNW.TextInput, "TextInput");
export function useWindowDimensions() {
  const d = RNW.useWindowDimensions();
  return { ...d, fontScale: scene.fontScale };
}

export function useColorScheme(): "light" | "dark" {
  return scene.theme;
}

export const Appearance = {
  getColorScheme: () => scene.theme,
  setColorScheme: () => {},
  addChangeListener: () => ({ remove() {} }),
};

export const Platform = { ...RNW.Platform, OS: "android", Version: 36, select: (o: Record<string, unknown>) => ("android" in o ? o.android : o.default) };

// Accessibility queries resolve to the phone's defaults (no reduce motion, no screen reader).
export const AccessibilityInfo = {
  ...RNW.AccessibilityInfo,
  isReduceMotionEnabled: () => Promise.resolve(false),
  isScreenReaderEnabled: () => Promise.resolve(false),
  addEventListener: () => ({ remove() {} }),
  announceForAccessibility: () => {},
};

export const ToastAndroid = { show() {}, SHORT: 0, LONG: 1 };
export const PermissionsAndroid = { request: async () => "granted", check: async () => true, PERMISSIONS: {}, RESULTS: { GRANTED: "granted" } };
export const PlatformColor = (...names: string[]) => names[0];
export const DevSettings = { reload() {} };
