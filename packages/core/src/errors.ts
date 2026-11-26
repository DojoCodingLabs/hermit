/**
 * CT-04: user-facing outcomes. Every terminal state a person can see maps to one copy key,
 * so no screen invents its own error text and no stack trace or hash reaches the user.
 */
export const OUTCOMES = [
  "repair_failed",
  "max_steps",
  "model_error",
  "stopped",
  "stale",
  "blocked",
  "offline",
  "permission_missing",
  "over_cap",
] as const;

export type Outcome = (typeof OUTCOMES)[number];

/** The copy key for an outcome (CT-10). Both locale files must define every one. */
export function outcomeCopyKey(outcome: Outcome): `common.outcome.${Outcome}` {
  return `common.outcome.${outcome}`;
}

export function isOutcome(value: string): value is Outcome {
  return (OUTCOMES as readonly string[]).includes(value);
}
