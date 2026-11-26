/**
 * HM-SET-03 (US-SET-03): the "Delete everything" screen as a pure state machine. The wallet warning comes
 * first when the wallet holds money; then a typed word and a fingerprint; then the erase with determinate
 * progress. Once the erase starts there is no way back to the confirmation: it finishes, or it fails and
 * resumes on retry or on the next launch (the plan and its journal live in @hermit/core).
 */
export type EraseScreen =
  | { kind: "wallet_warning"; balance: string }
  | { kind: "confirm"; typed: string; authFailed?: true }
  | { kind: "authenticating"; typed: string }
  | { kind: "erasing"; done: number; total: number; resumed: boolean }
  | { kind: "failed"; done: number; total: number }
  | { kind: "done" };

export type EraseAction =
  | { type: "wallet_ack" }
  | { type: "type"; text: string }
  /** `word` is the localized confirmation word (`HM-SET-03.confirmWord`). */
  | { type: "submit"; word: string }
  | { type: "auth"; ok: boolean }
  | { type: "progress"; done: number; total: number }
  | { type: "failed" }
  | { type: "retry" }
  | { type: "finished" };

/** Case, accents and surrounding spaces don't matter; the word itself must be exact. */
export function confirmationMatches(typed: string, word: string): boolean {
  const norm = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").trim().toLocaleUpperCase("en");
  return norm(typed) !== "" && norm(typed) === norm(word);
}

export function initialErase(opts: { walletBalance?: string; resume?: { done: number; total: number } }): EraseScreen {
  if (opts.resume) return { kind: "erasing", ...opts.resume, resumed: true };
  if (opts.walletBalance) return { kind: "wallet_warning", balance: opts.walletBalance };
  return { kind: "confirm", typed: "" };
}

export function eraseReducer(s: EraseScreen, a: EraseAction): EraseScreen {
  switch (s.kind) {
    case "wallet_warning":
      return a.type === "wallet_ack" ? { kind: "confirm", typed: "" } : s;
    case "confirm":
      if (a.type === "type") return { kind: "confirm", typed: a.text };
      if (a.type === "submit" && confirmationMatches(s.typed, a.word)) return { kind: "authenticating", typed: s.typed };
      return s;
    case "authenticating":
      if (a.type !== "auth") return s;
      return a.ok ? { kind: "erasing", done: 0, total: 0, resumed: false } : { kind: "confirm", typed: s.typed, authFailed: true };
    case "erasing":
      if (a.type === "progress") return { ...s, done: a.done, total: a.total };
      if (a.type === "failed") return { kind: "failed", done: s.done, total: s.total };
      if (a.type === "finished") return { kind: "done" };
      return s;
    case "failed":
      return a.type === "retry" ? { kind: "erasing", done: s.done, total: s.total, resumed: true } : s;
    case "done":
      return s;
  }
}
