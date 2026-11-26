// Hermit's motion tokens (docs/design/polish/decisions.md, "Motion"). Plain numbers, no animation library: React
// Native's Animated reads them through ./components/motion.tsx, and the mascot reads the same values. Motion says
// what changed (a press, a sheet arriving, a status, a new message); nothing moves for decoration. Quiet mode and
// the phone's "remove animations" turn every one of these off (useAppearance().motion).

/** Durations in milliseconds. Exits run at about three quarters of their entrance. */
export const duration = {
  /** A press acknowledged: under the 100 ms that reads as instant. */
  press: 90,
  /** A status word or an icon swapping in place. */
  short: 160,
  /** Most state changes: a row folding, a badge appearing, a backdrop fading. */
  medium: 240,
  /** Content arriving: a screen's first block, a new message. */
  long: 360,
  /** The longest anything runs, a sheet settling from the bottom edge. */
  sheet: 420,
} as const;

/**
 * Cubic Béziers as [x1, y1, x2, y2], the same numbers a CSS cubic-bezier() takes. Everything decelerates into place;
 * nothing bounces or overshoots.
 */
export const easing = {
  /** The default: a quick start and a long, soft landing (ease-out quint). */
  standard: [0.22, 1, 0.36, 1],
  /** Things arriving from off screen or from nothing (ease-out expo). */
  enter: [0.16, 1, 0.3, 1],
  /** Things leaving: they accelerate away and are gone (ease-in cubic). */
  exit: [0.32, 0, 0.67, 0],
  /** A value crossfading in place, symmetric. */
  crossfade: [0.65, 0, 0.35, 1],
} as const;

/**
 * Springs as stiffness, damping and mass (the units React Native's Animated.spring and most spring solvers take).
 * Damping ratios sit at or just under 1: they settle without a visible wobble.
 */
export const spring = {
  /** A press going down and coming back: fast, firm. */
  press: { stiffness: 600, damping: 40, mass: 1 },
  /** A bottom sheet rising: a gentle settle over about 400 ms. */
  sheet: { stiffness: 320, damping: 36, mass: 1 },
  /** Small things moving into place (a thumb, a meter, a badge). */
  gentle: { stiffness: 220, damping: 28, mass: 1 },
} as const;

/** How far things travel. Short distances read as refinement; long ones as navigation. */
export const distance = {
  /** A first block or a new message rising into place. */
  rise: 10,
  /** A step or a row unfolding. */
  unfold: 6,
} as const;

/** What a press does to a control: a slight sink and dim, never a color flash. */
export const press = {
  scale: 0.97,
  /** Rows don't scale (a long row shrinking looks broken); their background darkens instead. */
  opacity: 0.88,
} as const;

/** The gap between items appearing in sequence (a list's first rows). Capped so a list never takes long to arrive. */
export const stagger = { step: 40, max: 6 } as const;

/** Delay for item `i` of a list arriving in sequence: the first few are staggered, the rest arrive together. */
export function staggerDelay(i: number): number {
  return Math.min(i, stagger.max) * stagger.step;
}
