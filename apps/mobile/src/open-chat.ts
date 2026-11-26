import type { Href } from "expo-router";
import { hermitChatSteps } from "./roster-view";

/** Opens Hermit's chat with the roster beneath it, so Back returns to the roster (steps in roster-view.ts). */
export function openHermitChat(router: { replace(h: Href): void; push(h: Href): void; dismissAll(): void }, from: "onboarding" | "stack"): void {
  for (const step of hermitChatSteps(from)) {
    if (step.kind === "dismissAll") router.dismissAll();
    else router[step.kind](step.href as Href);
  }
}
