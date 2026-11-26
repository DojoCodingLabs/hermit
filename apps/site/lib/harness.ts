/**
 * The harness results on the home page: the same model in every run (MODEL), scored on the same tasks, once with a
 * generic setup and once with Hermit's harness. The chart, its table and the two figures beside it all read these.
 */
export const MODEL = "BotPsy-0.8B";

export interface EvalSet {
  /** Copy keys: `HM-SITE-01.set<Id>` and `...Note`. */
  id: "Phone" | "Mac" | "Dev" | "Blind";
  /** Tasks in the set. */
  total: number;
  /** Tasks done right with the generic setup. */
  generic: number;
  /** Tasks done right with Hermit's harness. */
  harness: number;
}

export const EVAL_SETS: readonly EvalSet[] = [
  { id: "Phone", total: 40, generic: 21, harness: 39 },
  { id: "Mac", total: 40, generic: 22, harness: 40 },
  { id: "Dev", total: 90, generic: 55, harness: 85 },
  { id: "Blind", total: 100, generic: 73, harness: 93 },
];

/** Fewer model calls with the harness, in percent, over the same conversations. */
export const MODEL_CALLS = { fewerPercent: 38, conversations: 120 } as const;

/** Median seconds from the request to Hermit's first action, on the phone. */
export const FIRST_ACTION_SECONDS = 13.5;

/** A score as a share of its set, in percent. */
export const share = (done: number, total: number) => (done / total) * 100;

/** What the harness added, in percentage points, rounded. */
export const gain = (s: EvalSet) => Math.round(share(s.harness, s.total) - share(s.generic, s.total));
