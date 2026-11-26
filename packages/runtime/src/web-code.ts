import { CODE_WINDOW_MS, codeSenderMatches, codeShapeOk, smsBoundToOrigin, type CodeWatch, type FoundCode } from "@hermit/core";

/**
 * SL-56b (Q138, Q140 to Q142): the code sources of one sign-in, armed at Hermit's own sign-in click. `since` is the
 * click; a code is taken only from a message that arrived after it and within CODE_WINDOW_MS.
 */
export interface ArmedCodes {
  since: number;
  watches: CodeWatch[];
}

export type CodeResult = FoundCode | "refused" | "ambiguous" | undefined;

/**
 * After the first code, how long the other sources keep looking before Hermit decides (security review): long enough
 * for the email source to check its mailbox once more (it polls every 5 s), short enough that the user isn't kept.
 */
export const CODE_SETTLE_MS = 6_000;

const isCode = (r: CodeResult): r is FoundCode => typeof r === "object" && r !== null;

/**
 * Asks every armed source at once. After the first code the others are not stopped: each keeps looking for up to
 * `settleMs` and every answer counts, so two codes in the window (from any sources, in any order) is `ambiguous`,
 * never the first or the latest. A declined dialog ends the wait (the user said no). A source that throws gives
 * nothing. Every source is stopped before this returns.
 */
export function firstCode(watches: readonly CodeWatch[], until: number, signal: AbortSignal, settleMs = CODE_SETTLE_MS): Promise<CodeResult> {
  if (!watches.length) return Promise.resolve(undefined);
  const inner = new AbortController();
  const onAbort = () => inner.abort();
  signal.addEventListener("abort", onAbort);
  const results: CodeResult[] = [];
  return new Promise<CodeResult>((resolve) => {
    let finished = false;
    let settling: ReturnType<typeof setTimeout> | undefined;
    let answered = 0;
    const finish = () => {
      if (finished) return;
      finished = true;
      if (settling) clearTimeout(settling);
      inner.abort();
      signal.removeEventListener("abort", onAbort);
      const codes = results.filter(isCode);
      resolve(
        results.includes("refused") ? "refused"
        : results.includes("ambiguous") || codes.length > 1 ? "ambiguous"
        : codes[0],
      );
    };
    for (const w of watches) {
      void w.take({ until, signal: inner.signal }).catch(() => undefined).then((r) => {
        if (finished) return;
        results.push(r);
        answered += 1;
        if (r === "refused" || r === "ambiguous" || answered === watches.length) return finish();
        if (isCode(r) && !settling) settling = setTimeout(finish, settleMs);
      });
    }
  });
}

export type CodeRefusal = "shape" | "before_click" | "after_window" | "wrong_sender" | "unverified" | "sms_unbound";

/** Why a found code can't be taken for this task, or undefined when it can. Nothing in it comes from the page. */
export function refuseCode(found: FoundCode, armed: ArmedCodes, origin: string): CodeRefusal | undefined {
  if (!codeShapeOk(found.code)) return "shape";
  if (!Number.isFinite(found.at) || found.at < armed.since) return "before_click";
  if (found.at > armed.since + CODE_WINDOW_MS) return "after_window";
  if (found.via === "email") {
    if (!codeSenderMatches(found.sender, origin)) return "wrong_sender";
    if (found.verified !== "dmarc" && found.verified !== "dkim") return "unverified";
  }
  if (found.via === "sms" && !smsBoundToOrigin(found.text, found.code, origin)) return "sms_unbound";
  return undefined;
}

/** Drops Hermit's references to the code and the message (JavaScript strings can't be overwritten in place). */
export function dropCode(found: FoundCode | undefined): void {
  if (!found) return;
  (found as { code: string }).code = "";
  if (found.via === "sms") (found as { text: string }).text = "";
}
