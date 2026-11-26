// SL-54: the add-a-server flow outlives a screen: the browser sign-in comes back through the hermit://oauth/mcp route
// (app/oauth/mcp.tsx), which hands its review to HM-CONN-03. In memory only: the draft holds no secret here (the
// PKCE verifier stays inside the runtime) and is dropped when the app closes.
import type { McpReviewResult } from "@hermit/runtime";

let draftId: string | undefined;
let result: McpReviewResult | undefined;

export function startDraft(id: string | undefined): void {
  draftId = id;
  result = undefined;
}

export function currentDraft(): string | undefined {
  return draftId;
}

export function finishDraft(r: McpReviewResult): void {
  result = r;
}

/** The review the redirect produced, once. */
export function takeResult(): McpReviewResult | undefined {
  const r = result;
  result = undefined;
  return r;
}
