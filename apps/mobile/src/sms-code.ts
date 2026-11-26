// SL-56b (Q138): a web task's one-time code from a text message, over Google's SMS User Consent API
// (play-services-auth-api-phone, no SMS permission). The native module (modules/hermit-sms-consent) starts the listener
// at the sign-in click; Android catches the next message that carries a code and, only when the task is paused at its
// code step and asks (`next`), shows the system dialog with that one message. The user taps Allow or Deny; on Allow the
// message comes back here, its code is taken by code and the message is kept only for the approval sheet. Pure, so it
// runs on Node with a fake native side.
import type { CodeWatch, OneTimeCodePort } from "@hermit/core";
// The files, not the package: this runs on Node's type stripping in the app's tests, which can't load all of core.
import { extractOneTimeCode } from "@hermit/core/one-time-code";
import { webOtpLine } from "@hermit/core/site-domain";

export type SmsNext = { kind: "message"; text: string; receivedAt: number } | { kind: "refused" } | { kind: "none" };

export interface SmsConsentNative {
  /** Starts the consent listener (Android listens up to five minutes for one message). False without Play services. */
  start(): Promise<boolean>;
  /** Waits up to `timeoutMs` for the message the listener caught, then shows the system dialog for it. */
  next(timeoutMs: number): Promise<SmsNext>;
  /** Stops listening and closes the dialog; safe to call more than once. */
  stop(): void;
}

export function createSmsCodeSource(native: SmsConsentNative, now: () => number): OneTimeCodePort {
  return {
    arm({ since }): CodeWatch {
      const started = native.start().catch(() => false);
      let stopped = false;
      const stop = () => {
        stopped = true;
        try {
          native.stop();
        } catch {
          // Nothing to stop.
        }
      };
      return {
        async take({ until, signal }) {
          try {
            if (!(await started) || stopped || signal.aborted) return undefined;
            const aborted = new Promise<undefined>((r) => signal.addEventListener("abort", () => r(undefined), { once: true }));
            const r = await Promise.race([native.next(Math.max(0, until - now())).catch((): SmsNext => ({ kind: "none" })), aborted]);
            if (!r || stopped || r.kind === "none") return undefined;
            if (r.kind === "refused") return "refused";
            if (!(r.receivedAt >= since && r.receivedAt <= until)) return undefined;
            const code = webOtpLine(r.text)?.code ?? extractOneTimeCode(r.text);
            return code ? { via: "sms", code, at: r.receivedAt, text: r.text } : undefined;
          } finally {
            stop();
          }
        },
        cancel: stop,
      };
    },
  };
}
