// What both players of the crab (mascot-player.tsx on the phone, mascot-player.web.tsx in the browser preview) offer.
import type { BodyMove, Frame, PartsOptions } from "../mascot-motion.ts";
import { RIG } from "../mascot-rig.ts";

export interface Player {
  /** Move the pieces to a rest frame, from where they are now (or from `from`, for a first move on mount). */
  playParts(to: Frame, opt: PartsOptions, from?: Frame): void;
  /** Replace the body's moves; whatever offset it had springs back to zero underneath the new ones. */
  playBody(moves: BodyMove[]): void;
  /** Shut the eyes for the pattern's first span, open for the next, and so on. */
  blink(pattern: readonly number[]): void;
  /** Show `to` at once, nothing moving (reduced motion, or a pose change while still). */
  snap(to: Frame): void;
  /** Stop everything and rest where the last move was going (the app went to the background). */
  stop(): void;
}

/** `exact` scales by width like the rig's PNGs (512 wide is 0.7388 of the canvas); `contain` fits any box. */
export type SvgFit = "exact" | "contain";

const pct = (v: number) => `${(v * 100).toFixed(2)}%`;
/** Loops move the picture about the crab's feet: the middle of the symbol, on its base line. */
export const BODY_ORIGIN = `${pct((RIG.size[0] / 2 - RIG.viewBox[0]) / RIG.viewBox[2])} ${pct((RIG.size[1] - RIG.viewBox[1]) / RIG.viewBox[3])}`;
