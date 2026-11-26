import type { ApprovalKeyPort, ApprovalRequest } from "@hermit/core";
import { HermitApprovalKey, type PromptLocale } from "../../modules/hermit-approval-key";

/**
 * SL-37 (US-CAGE-03, FR-CAGE-06): the Keystore approval key (apps/mobile/modules/hermit-approval-key). The runtime
 * reads its state and enrolls it; the approval sheet asks it to sign. The private key never leaves the hardware,
 * and JavaScript sees only the public part and signatures. The system prompt's words are the module's own: the app
 * passes only a locale code, never display text.
 */
export const approvalKeyPort: ApprovalKeyPort = {
  state: () => HermitApprovalKey.state(),
  enroll: (message, locale) => HermitApprovalKey.enroll(message, locale),
  destroy: () => HermitApprovalKey.destroy(),
};

/** Why a signature didn't come back, as the sheet tells it. Anything unexpected reads as "not approved". */
export type SignFailure = "cancelled" | "lockout" | "lost" | "expired" | "no_biometric" | "failed";

export class ApprovalSignError extends Error {
  constructor(readonly code: SignFailure) {
    super(`Approval not signed: ${code}`);
    this.name = "ApprovalSignError";
  }
}

const KNOWN: readonly SignFailure[] = ["cancelled", "lockout", "lost", "expired", "no_biometric"];

/**
 * One fingerprint, one signature over this request's exact payload. The system prompt shows the amount and the
 * recipient (or the site) the module reads from the payload itself.
 */
export async function signApproval(req: ApprovalRequest, locale: PromptLocale): Promise<{ biometric: true; signature: string }> {
  if (!req.signed) throw new ApprovalSignError("failed");
  return { biometric: true, signature: await signMessage(req.signed.message, locale) };
}

/**
 * SL-36: one signature over one approval message (a login's payload from HM-APPR-01). The prompt shows the site, or
 * the app and its key, and the browser, read by the module from the message itself. Throws ApprovalSignError.
 */
export async function signMessage(message: string, locale: PromptLocale): Promise<string> {
  try {
    return await HermitApprovalKey.sign(message, locale);
  } catch (e) {
    const code = (e as { code?: string }).code;
    throw new ApprovalSignError(KNOWN.includes(code as SignFailure) ? (code as SignFailure) : "failed");
  }
}

/** Delete everything's `destroy_approval_key` step (idempotent). */
export function destroyApprovalKey(): Promise<void> {
  return HermitApprovalKey.destroy();
}
