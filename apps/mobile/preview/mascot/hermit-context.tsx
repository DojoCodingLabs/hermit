// Mascot page only: replaces src/hermit-context.tsx. A ready Hermit whose only setting is Quiet mode (HM-SET-06),
// on when the URL says ?quiet=1, so the page shows what the real useAppearance() does with it.
import type { ReactNode } from "react";

const quiet = new URLSearchParams(typeof location === "undefined" ? "" : location.search).get("quiet") === "1";
const hermit = {
  settings: {
    get: async (key: string) => (key === "appearance.quiet" && quiet ? "1" : undefined),
    set: async () => {},
  },
};
const value = { status: { kind: "ready" as const, hermit, sessionId: "mascot" } };

export function HermitProvider({ children }: { children: ReactNode }) {
  return children;
}

export function useHermit() {
  return value;
}
