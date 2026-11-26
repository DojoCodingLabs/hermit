import type { ApprovalSummary, JsonSchema, RenderContext } from "@hermit/core";

/*
 * People by name on the approval sheet (PDR-028). The loop resolves a name the user said to a number or address and
 * hands the result to the sheet as trusted data (RenderContext.found); these lines say where it came from.
 */

/** The optional argument a skill takes for the person's name. Code resolves it; the model never fills the number from it. */
export const personArg = (kind: "phone" | "email"): JsonSchema => ({
  type: "string",
  description: `The person's name exactly as the user said it ("mi mamá", "Carlos"), only when they gave no ${kind === "phone" ? "number" : "email address"}`,
  maxLength: 80,
});

const digits = (s: string) => s.replace(/\D/g, "");

/**
 * "From your contacts: Mamá" and "You emailed before: ana@x.com", for every value the sheet shows in `field` that
 * code found by name this turn. Only a value the sheet actually shows gets a line, so a label never vouches for
 * something else. Not part of any binding: the executor re-renders without them.
 */
export function foundLines(ctx: RenderContext | undefined, field: string, shown: readonly string[]): ApprovalSummary["lines"] {
  const out: ApprovalSummary["lines"] = [];
  for (const f of ctx?.found ?? []) {
    if (f.field !== field) continue;
    const match = shown.some((v) => (f.kind === "phone" ? digits(v) !== "" && digits(v) === digits(f.value) : v.trim().toLowerCase() === f.value));
    if (!match) continue;
    if (f.sources.includes("contacts")) out.push({ label: "From your contacts", value: f.name, flag: "from_contacts" });
    if (f.sources.includes("sent_mail")) out.push({ label: "You emailed before", value: f.value, flag: "emailed_before" });
  }
  return out;
}
