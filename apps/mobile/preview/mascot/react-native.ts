// Mascot page only: the preview's react-native stub (../src/stubs/react-native.ts), with the phone's "remove
// animations" setting read from the URL (?reduce=1), so the page can show the crab under reduced motion.
import { AccessibilityInfo as Shared } from "../src/stubs/react-native";

export * from "../src/stubs/react-native";

const reduce = new URLSearchParams(typeof location === "undefined" ? "" : location.search).get("reduce") === "1";

export const AccessibilityInfo = { ...Shared, isReduceMotionEnabled: () => Promise.resolve(reduce) };
